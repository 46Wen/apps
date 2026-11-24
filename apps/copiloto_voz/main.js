'use strict';
/**
 * Copiloto de voz: el coche habla. Frases grabadas (voces/<frase>.m4a) cuando pasa algo:
 *
 *   bienvenida   al subir: la primera puerta que se abre, o el coche preparándose para arrancar
 *                (bienvenida_manana / _tarde / _noche según la hora, si están; si no, bienvenida)
 *   fin_viaje    al apagar después de conducir
 *   combustible  con poca autonomía; y, si quieres, un aviso en el iPhone (ntfy) que abre Waze hacia la
 *                gasolinera más cercana (en CarPlay, en la pantalla del coche)
 *   repostado    el depósito tiene bastantes litros más que antes
 *   hielo        3 °C o menos fuera, conduciendo (una vez por viaje)
 *   descanso     cada 2 horas de conducción seguida
 *
 * Arranca con el coche (app.json "autostart"): todo esto corre en background(), con o sin la pantalla abierta.
 * La pantalla (start) dice qué ha oído del coche, qué frases tiene grabadas, si el audio y el aviso al iPhone
 * funcionan, y deja probarlos. Solo lee del coche; lo único que hace es reproducir sonido y mandar el aviso.
 * Node 8 (el del coche, 8.16.2).
 */
const fs = require('fs');
const path = require('path');
const mgu = require('./kit/mgu');
const Car = require('./kit/car');
const { Engine } = require('./engine');
const { Speaker } = require('./speaker');
const { Notifier } = require('./notify');
const { phraseFor } = require('./phrases');

const PHRASES = ['bienvenida', 'bienvenida_manana', 'bienvenida_tarde', 'bienvenida_noche', 'fin_viaje', 'combustible',
    'repostado', 'hielo', 'descanso'];
const DOOR_FIELDS = { statusDoorSwitchDRD: 'conductor', statusDoorSwitchPSD: 'acompañante', statusDoorSwitchDRDR: 'trasera izquierda',
    statusDoorSwitchPSDR: 'trasera derecha' };
const doorsOf = (v) => Object.keys(DOOR_FIELDS).filter((k) => v && (v[k] === 1 || /_OFFEN$/.test(String(v[k])))).map((k) => DOOR_FIELDS[k]);
const COND_TEXT = { 1: 'aparcado', 2: 'aparcado', 3: 'aparcado, sin nadie', 5: 'encendido sin contacto', 7: 'contacto',
    8: 'preparando para arrancar', 10: 'listo para conducir', 12: 'apagando' };

mgu.run({
    async background(bg) {
        const log = bg.log, settings = bg.settings;
        const here = __dirname;
        const speaker = new Speaker({ signals: bg.signals, log, dataDir: bg.dataDir, dirs: [path.join(here, 'voces')] });
        const notifier = new Notifier({ dataDir: bg.dataDir, log });
        const memoFile = path.join(bg.dataDir, 'memo.json');
        const listeners = [];
        const changed = () => listeners.forEach((fn) => { try { fn(); } catch (e) { /* the page */ } });

        const engine = new Engine({
            log: (m) => log.info(m),
            enabled: (ev) => settings.get('on_' + ev) !== false,
            cfg: { fuelKm: settings.get('fuelKm') || 50 },
            say: (ev, info) => {
                speaker.say(phraseFor(ev, settings, speaker, Date.now())).then(changed);
                if (ev === 'combustible' && settings.get('phone') !== false) notifier.fuel(settings.get('brand') || 'Shell', info.range).then(changed);
                changed();
            },
        });
        try { engine.restore(JSON.parse(fs.readFileSync(memoFile, 'utf8'))); } catch (e) { /* first start */ }
        let memoSaved = '';
        const saveMemo = () => {
            const s = JSON.stringify(engine.memo());
            if (s === memoSaved) return;
            memoSaved = s;
            try { fs.writeFileSync(memoFile, s); } catch (e) { log.warn('memo: ' + e.message); }
        };
        settings.onChange((key) => { if (key === 'fuelKm') engine.cfg.fuelKm = settings.get('fuelKm') || 50; });

        const missing = PHRASES.filter((p) => !speaker.file(p));
        log.info('recordings: ' + (PHRASES.length - missing.length) + ' of ' + PHRASES.length + (missing.length ? ', missing ' + missing.join(' ') : ''));

        // what the car says: each signal on its own, so one the car lacks leaves the others working
        const W = (iface, handlers) => bg.signals.watch(iface, '1', handlers, log).then((r) => { if (r.error) log.warn(iface + ': ' + r.error); return r; });
        await W('de.bmw.infrastructure.VehicleCondition', { VehicleCondition: (v) => { engine.condition(Car.conditionOf(v && v.statusConditionVehicle)); changed(); } });
        await W('de.bmw.body.DoorsWindowsRoofMirrors', { CentralLockingSystemAndPanelStatus: (v) => { engine.doors(doorsOf(v)); changed(); } });
        await W('de.bmw.infotainment.KombiIF', { statusRangeTankStatus: (v) => {
            const f = v && v.fluidLevelFuelTank, r = v && v.range;
            engine.fuel(typeof f === 'number' && f >= 0 && f < 255 ? f : null, typeof r === 'number' && r >= 0 && r < 4095 ? r : null);
            saveMemo();
            changed();
        } });
        await W('de.bmw.infrastructure.EnvironmentalInformation', { ExteriorTemperature: (v) => {
            const t = v && v.temperatureExterior;
            if (typeof t === 'number' && t !== 255) engine.outside(t * 0.5 - 40);
        } });
        // the audio side ready before the first phrase (the welcome comes early)
        speaker.init().catch(() => {});
        setInterval(() => { engine.tick(); saveMemo(); }, 5000);
        return { engine, speaker, notifier, onChange: (fn) => listeners.push(fn) };
    },

    async start(ctx) {
        const bgs = ctx.background;
        const W = 1600, H = 520;
        const C = { bg: '#0b0e14', card: '#161b24', text: '#eef1f5', dim: '#8d97a8', blue: '#1c69d4', green: '#39c27a', yellow: '#ffd500', red: '#ff6b5b' };
        if (!bgs) {
            const cv = ctx.canvas(W, H);
            cv.clear(C.bg);
            cv.text('El copiloto no ha podido arrancar: mira el registro de la app (copiloto_voz.log).', 40, 80, 30, C.red, { literal: true });
            ctx.ui.image('MAIN_GFX', cv);
            return;
        }
        const { engine, speaker, notifier } = bgs;
        let testIdx = 0, note = '';
        const ago = (t) => { const m = Math.round((Date.now() - t) / 60000); return m < 1 ? 'ahora' : m < 120 ? 'hace ' + m + ' min' : 'hace ' + Math.round(m / 60) + ' h'; };
        // a line cut with … to fit w px
        const fit = (cv, s, size, w) => { s = String(s); if (cv.textWidth(s, size, { literal: true }) <= w) return s; while (s.length > 1 && cv.textWidth(s + '…', size, { literal: true }) > w) s = s.slice(0, -1); return s + '…'; };
        const card = (cv, x, y, w, h, title) => { cv.roundRect(x, y, w, h, 16, C.card); cv.text(title, x + 22, y + 38, 22, C.dim, { literal: true }); };

        const show = () => {
            const cv = ctx.canvas(W, H), s = engine.state();
            cv.clear(C.bg);
            // the car, as the app hears it
            card(cv, 24, 20, 500, 230, 'El coche');
            const lines = [
                'Estado: ' + (s.cond === null ? 'esperando al coche' : (COND_TEXT[s.cond] || s.cond)),
                'Puertas abiertas: ' + (s.doors.length ? s.doors.join(', ') : 'ninguna'),
                'Combustible: ' + (s.litres === null ? '--' : s.litres + ' L') + '   Autonomía: ' + (s.range === null ? '--' : s.range + ' km'),
                'Fuera: ' + (s.outside === null ? '--' : s.outside.toFixed(1) + ' °C') + '   Conduciendo: ' + s.driveMin + ' min',
            ];
            lines.forEach((l, i) => cv.text(l, 46, 92 + i * 38, 25, C.text, { literal: true }));
            // the voice
            const found = speaker.found(PHRASES), have = PHRASES.filter((p) => found[p]);
            card(cv, 548, 20, 500, 230, 'La voz');
            const st = speaker.status(), bad = !!speaker.lastError && !speaker.busy;
            cv.circle(578, 92, 10, bad ? C.red : have.length ? C.green : C.yellow);
            cv.text(fit(cv, 'Audio: ' + st, 24, 430), 600, 100, 24, bad ? C.red : C.text, { literal: true });
            cv.text('Frases grabadas: ' + have.length + ' de ' + PHRASES.length, 570, 146, 24, C.text, { literal: true });
            const miss = PHRASES.filter((p) => !found[p]);
            if (miss.length) cv.text(fit(cv, 'Faltan: ' + miss.join(', '), 19, 456), 570, 186, 19, C.dim, { literal: true });
            if (note) cv.text(note, 570, 224, 21, C.yellow, { literal: true });
            // the iPhone
            card(cv, 1072, 20, 504, 230, 'Aviso al iPhone (ntfy)');
            const on = notifier.online();
            cv.circle(1102, 92, 10, notifier.lastError ? C.red : on ? C.green : C.yellow);
            cv.text(fit(cv, notifier.lastError ? notifier.lastError : on ? 'Internet: sí' : 'Sin internet ahora', 24, 430), 1124, 100, 24, notifier.lastError ? C.red : C.text, { literal: true });
            cv.text('En la app ntfy, suscríbete a:', 1094, 146, 22, C.dim, { literal: true });
            cv.text(notifier.topic, 1094, 186, 28, C.blue, { font: 'bold', literal: true });
            if (notifier.lastSent) cv.text('Último aviso: ' + ago(notifier.lastSent.at), 1094, 224, 20, C.dim, { literal: true });
            // what it said lately
            card(cv, 24, 270, 1552, 230, 'Lo último');
            if (!s.history.length) cv.text('Todavía nada. Usa "Probar la siguiente frase" para oír la voz.', 46, 336, 25, C.dim, { literal: true });
            s.history.slice(0, 4).forEach((h, i) => cv.text(fit(cv, ago(h.at) + '  ·  ' + h.event.replace('_', ' ') + '  ·  ' + h.why, 24, 1500), 46, 336 + i * 40, 24, C.text, { literal: true }));
            cv.text('Copiloto de voz ' + ctx.spec.version + '  ·  bienvenida ' + (s.welcomeArmed ? 'preparada' : 'ya dada') + '  ·  aviso de combustible ' + (s.fuelArmed ? 'preparado' : 'ya dado'),
                46, 482, 19, C.dim, { literal: true });
            ctx.ui.image('MAIN_GFX', cv);
        };
        bgs.onChange(show);
        if (ctx.ui.onClick) {
            ctx.ui.onClick('BTN_TEST', () => {
                const p = PHRASES[testIdx++ % PHRASES.length];
                note = 'Probando: ' + p;
                show();
                speaker.say(p).then(() => { note = ''; show(); });
            });
            ctx.ui.onClick('BTN_PHONE', () => {
                note = 'Enviando el aviso de prueba al iPhone...';
                show();
                notifier.fuel(ctx.settings.get('brand') || 'Shell', engine.state().range).then((ok) => { note = ok ? 'Aviso enviado' : ''; show(); });
            });
        }
        setInterval(show, 10000);
        show();
    },
});

