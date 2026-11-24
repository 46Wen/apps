'use strict';
/**
 * Copiloto de voz: el coche habla. Frases grabadas (voces/<aviso>.m4a), de usted, cuando pasa algo; por prioridad
 * (engine.js EVENTS), de una en una, nunca durante una llamada (announcer.js):
 *
 *    1 combustible     autonomía de 50 km o menos (ajuste), una vez hasta repostar
 *    2 neumaticos      el aviso de presión de BMW (Check Control), una vez por viaje
 *    3 hielo           3 °C o menos fuera, conduciendo, una vez por viaje
 *    4 motor_frio      aceite por debajo de 80 °C y más de 2.500 rpm, una vez por viaje
 *    5 bateria         la batería de 12 V por debajo de 11,8 V con el motor parado, al arrancar
 *    6 bienvenida      al arrancar el motor (bienvenida_manana / _tarde / _noche, o bienvenida)
 *    7 mantenimiento   al arrancar, si faltan 2.000 km o 60 días para algo (aceite, frenos, inspección), una vez por semana
 *    8 ventanillas     al apagar, una ventanilla o el techo abierto
 *    9 fin_viaje       al apagar después de conducir
 *   10 descanso        cada 2 horas conduciendo
 *   11 motor_caliente  el aceite llega a 80 °C (en un viaje que empezó en frío), siempre el último
 *
 * Arranca con el coche (app.json "autostart"): todo corre en background(), con o sin la pantalla abierta. Solo lee
 * del coche (la batería, con diagnosis de solo lectura: kit/readonly-diag.js); lo único que hace es reproducir sonido. La pantalla (start): cada aviso con su icono, si está activo y cuándo sonó, y el estado
 * de la voz y el coche. Node 8 (el del coche, 8.16.2).
 */
const fs = require('fs');
const path = require('path');
const mgu = require('./kit/mgu');
const Car = require('./kit/car');
const { ReadOnlyDiag } = require('./kit/readonly-diag');
const { Engine, EVENTS, PRIORITY, KEEP } = require('./engine');
const { Announcer } = require('./announcer');
const { Speaker } = require('./speaker');
const { phraseFor } = require('./phrases');
const D = require('./decode');

const PHRASES = ['bienvenida', 'bienvenida_manana', 'bienvenida_tarde', 'bienvenida_noche'].concat(EVENTS.filter((e) => e !== 'bienvenida'));
const TITLES = { combustible: 'Combustible', neumaticos: 'Neumáticos', hielo: 'Posible hielo', motor_frio: 'Motor frío',
    bateria: 'Batería', bienvenida: 'Bienvenida', mantenimiento: 'Mantenimiento', ventanillas: 'Ventanillas',
    fin_viaje: 'Fin del viaje', descanso: 'Pausa', motor_caliente: 'Motor caliente' };
const WHEN = { combustible: 'autonomía baja', neumaticos: 'aviso de presión BMW', hielo: '3 °C o menos', motor_frio: 'aceite < 80 °C y > 2.500 rpm',
    bateria: '< 11,8 V al arrancar', bienvenida: 'al arrancar', mantenimiento: '2.000 km o 60 días', ventanillas: 'abiertas al apagar',
    fin_viaje: 'al apagar', descanso: 'cada 2 horas', motor_caliente: 'aceite a 80 °C' };
const COND_TEXT = { 1: 'aparcado', 2: 'aparcado', 3: 'aparcado', 5: 'sin contacto', 7: 'contacto', 8: 'arrancando',
    10: 'en marcha', 12: 'apagando' };
const DME = 0x12;

mgu.run({
    async background(bg) {
        const log = bg.log, settings = bg.settings;
        const speaker = new Speaker({ signals: bg.signals, log, dataDir: bg.dataDir, dirs: [path.join(__dirname, 'voces')] });
        const memoFile = path.join(bg.dataDir, 'memo.json');
        const listeners = [];
        const changed = () => listeners.forEach((fn) => { try { fn(); } catch (e) { /* the page */ } });
        let call = null, ccActive = [], ccName = {};

        const announcer = new Announcer({
            priority: PRIORITY, keep: KEEP, log: (m) => log.info('voice: ' + m),
            inCall: () => call !== null && call > 0,
            speak: (ev) => { changed(); return speaker.say(phraseFor(ev, settings, speaker, Date.now())).then(changed); },
        });
        const engine = new Engine({
            log: (m) => log.info(m),
            enabled: (ev) => settings.get('on_' + ev) !== false,
            cfg: { fuelKm: settings.get('fuelKm') || 50 },
            say: (ev, info) => {
                announcer.add(ev);
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

        // the 12 V battery at ignition on, before the engine starts (read-only diagnostics, the engine unit), once a cycle
        const diag = new ReadOnlyDiag(bg.signals, log);
        let batteryRead = false;
        const readBattery = async () => {
            if (batteryRead || !bg.signals.hasNative()) return;
            batteryRead = true;
            try {
                if (!diag.ready) await diag.init();
                let v = D.voltsOf(await diag.read(DME, 0xF442, 1500));
                if (v === null) v = D.voltsOf(await diag.physical(DME, 0x01, [0x42], 1500, (u) => u[0] === 0x41 && u[1] === 0x42));
                log.info('battery: ' + (v === null ? 'no answer' : v.toFixed(2) + ' V'));
                engine.battery(v);
                changed();
            } catch (e) { log.warn('battery: ' + (e && e.message || e)); }
        };

        // what the car says: each signal on its own, so one the car lacks leaves the others working
        const W = (iface, handlers, opts) => bg.signals.watch(iface, '1', handlers, log, opts).then((r) => { if (r.error) log.warn(iface + ': ' + r.error); return r; });
        await W('de.bmw.infrastructure.VehicleCondition', { VehicleCondition: (v) => {
            const n = Car.conditionOf(v && v.statusConditionVehicle);
            if (n !== undefined && n <= 5) batteryRead = false;
            if (n === 7 || n === 8) readBattery();
            engine.condition(n);
            changed();
        } });
        await W('de.bmw.infotainment.vehicle.CDS', {
            statusEngineSpeed2: (v) => engine.engine(D.rpmOf(v), null),
            statusEngineTemperature: (v) => engine.engine(null, D.oilOf(v)),
        });
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
        await W('de.bmw.infotainment.connectivity.telephony.ConnectivityAggregator', { aggregatedCallState: (v) => {
            const was = call;
            call = D.callOf(v);
            if (was > 0 && !(call > 0)) announcer.pump();       // the call ended: what waited is said now
            changed();
        } });
        // BMW's tyre pressure message (Check Control): the active ids, named by the cluster's list
        const tyreCheck = () => engine.tyreWarning(ccActive.some((id) => D.isTyreCc(ccName[id])));
        await W('de.bmw.infotainment.checkcontrol.CheckControlMaster', { basicList: (v) => {
            ccActive = D.activeCc(v);
            if (ccActive.length) log.info('check control active: ' + ccActive.map((id) => id + (ccName[id] ? ' ' + ccName[id] : '')).join(' | '));
            tyreCheck();
        } });
        await W('de.bmw.infotainment.KombiInterface_2', {
            ccList: (v) => { D.ccNames(v).forEach((p) => { ccName[p[0]] = p[1]; }); tyreCheck(); },
            newCCMessage: (v) => { D.ccNames(v).forEach((p) => { ccName[p[0]] = p[1]; }); tyreCheck(); },
            cbsDataServiceList: (v) => {
                const items = D.serviceOf(v);
                log.info('service: ' + items.map((i) => i.name + ' ' + i.km + ' km ' + i.days + ' d ' + i.colour).join(' | '));
                engine.service(items);
            },
        }, { pollMs: 10 * 60000 });
        // windows and the roof: the fields this car sends are logged once, to confirm which ones say "open"
        let doorKeys = false;
        await W('de.bmw.body.DoorsWindowsRoofMirrors', { CentralLockingSystemAndPanelStatus: (v) => {
            if (!doorKeys && v && typeof v === 'object') { doorKeys = true; log.info('doors/windows fields: ' + JSON.stringify(v).slice(0, 900)); }
            engine.openings(D.openingsOf(v));
            changed();
        } });
        // the audio side ready before the first phrase
        speaker.init().catch(() => {});
        setInterval(() => { engine.tick(); announcer.pump(); saveMemo(); }, 5000);
        return { engine, speaker, announcer, inCall: () => call > 0, onChange: (fn) => listeners.push(fn) };
    },

    async start(ctx) {
        const bgs = ctx.background;
        const W = 1600, H = 520;
        // BMW: dark, the brand blue, the M colours in a thin stripe
        const C = { bg: '#0a0d12', tile: '#141a23', tileOff: '#0f131a', line: '#232c3a', text: '#f2f5f9', dim: '#8a95a6', faint: '#4a5466',
            blue: '#1c69d4', light: '#4fa3ff', mLight: '#0066b1', mDark: '#003d78', mRed: '#e22718', green: '#2fd27a', amber: '#ffb000', red: '#ff5a4f', ice: '#8fd3ff' };
        if (!bgs) {
            const cv = ctx.canvas(W, H);
            cv.clear(C.bg);
            cv.text('El copiloto no ha podido arrancar: mire el registro de la app (copiloto_voz.log).', 40, 80, 30, C.red, { literal: true });
            ctx.ui.image('MAIN_GFX', cv);
            return;
        }
        const { engine, speaker, announcer } = bgs;
        let testIdx = 0, note = '';
        const ago = (t) => { const m = Math.round((Date.now() - t) / 60000); return m < 1 ? 'ahora' : m < 120 ? 'hace ' + m + ' min' : m < 2880 ? 'hace ' + Math.round(m / 60) + ' h' : 'hace ' + Math.round(m / 1440) + ' días'; };
        const fit = (cv, s, size, w, o) => { s = String(s); o = Object.assign({ literal: true }, o || {}); if (cv.textWidth(s, size, o) <= w) return s; while (s.length > 1 && cv.textWidth(s + '…', size, o) > w) s = s.slice(0, -1); return s + '…'; };

        // an icon per notice, drawn with lines: (cv, cx, cy, colour)
        const ICONS = {
            combustible: (cv, x, y, c) => { cv.roundRect(x - 14, y - 16, 20, 32, 3, c); cv.fillRect(x - 10, y - 11, 12, 9, C.tile); cv.line(x + 6, y - 8, x + 14, y - 2, 3, c); cv.line(x + 14, y - 2, x + 14, y + 10, 3, c); },
            neumaticos: (cv, x, y, c) => { cv.arc(x, y, 11, 17, 0, 360, c); cv.fillRect(x - 2, y - 7, 4, 9, c); cv.circle(x, y + 6, 2, c); },
            hielo: (cv, x, y, c) => { for (let a = 0; a < 180; a += 60) { const r = a * Math.PI / 180; cv.line(x - 16 * Math.cos(r), y - 16 * Math.sin(r), x + 16 * Math.cos(r), y + 16 * Math.sin(r), 3, c); } },
            motor_frio: (cv, x, y, c) => { cv.line(x, y - 16, x, y + 6, 6, c); cv.circle(x, y + 10, 7, c); cv.line(x + 8, y - 10, x + 14, y - 10, 2, c); cv.line(x + 8, y - 3, x + 14, y - 3, 2, c); },
            bateria: (cv, x, y, c) => { cv.strokeRoundRect(x - 17, y - 11, 34, 24, 3, 3, c); cv.fillRect(x - 12, y - 15, 6, 4, c); cv.fillRect(x + 6, y - 15, 6, 4, c); cv.line(x - 10, y + 1, x - 4, y + 1, 2, c); cv.line(x + 4, y + 1, x + 10, y + 1, 2, c); cv.line(x + 7, y - 2, x + 7, y + 4, 2, c); },
            bienvenida: (cv, x, y, c) => { cv.arc(x - 7, y, 6, 10, 0, 360, c); cv.line(x + 3, y, x + 18, y, 4, c); cv.line(x + 13, y, x + 13, y + 7, 3, c); cv.line(x + 18, y, x + 18, y + 7, 3, c); },
            mantenimiento: (cv, x, y, c) => { cv.line(x - 12, y + 12, x + 6, y - 6, 5, c); cv.arc(x + 9, y - 9, 5, 10, 200, 520, c); },
            ventanillas: (cv, x, y, c) => { cv.quad([[x - 16, y + 12], [x - 16, y - 2], [x + 2, y - 14], [x + 16, y + 12]], c); cv.quad([[x + 2, y - 14], [x + 16, y - 14], [x + 16, y + 12], [x - 16, y + 12]], c); cv.quad([[x - 11, y + 7], [x - 11, y], [x + 1, y - 9], [x + 11, y + 7]], C.tile); cv.quad([[x + 1, y - 9], [x + 11, y - 9], [x + 11, y + 7], [x - 11, y + 7]], C.tile); cv.line(x - 11, y + 2, x + 11, y + 2, 2, c); },
            fin_viaje: (cv, x, y, c) => { cv.line(x - 12, y - 16, x - 12, y + 16, 3, c); for (let i = 0; i < 3; i++) for (let j = 0; j < 2; j++) cv.fillRect(x - 10 + i * 8 + (j ? 0 : 0), y - 15 + j * 7, 8, 7, (i + j) % 2 ? C.tile : c); cv.strokeRoundRect(x - 10, y - 15, 24, 14, 0, 2, c); },
            descanso: (cv, x, y, c) => { cv.roundRect(x - 14, y - 8, 22, 20, 4, c); cv.arc(x + 9, y + 1, 4, 8, 270, 450, c); cv.line(x - 8, y - 16, x - 8, y - 11, 2, c); cv.line(x - 2, y - 16, x - 2, y - 11, 2, c); },
            motor_caliente: (cv, x, y, c) => { cv.line(x, y - 16, x, y + 6, 6, c); cv.circle(x, y + 10, 7, c); cv.line(x - 10, y - 12, x - 6, y - 6, 2, c); cv.line(x + 10, y - 12, x + 6, y - 6, 2, c); },
        };
        const TONE = { combustible: C.amber, neumaticos: C.amber, hielo: C.ice, motor_frio: C.ice, bateria: C.amber, bienvenida: C.light,
            mantenimiento: C.light, ventanillas: C.light, fin_viaje: C.light, descanso: C.light, motor_caliente: C.red };

        const chip = (cv, x, label, ok, warn) => {
            const w = cv.textWidth(label, 19, { literal: true }) + 40;
            cv.roundRect(x - w, 18, w, 34, 17, C.tile);
            cv.circle(x - w + 17, 35, 6, ok ? C.green : warn ? C.amber : C.red);
            cv.text(label, x - w + 30, 42, 19, C.text, { literal: true });
            return x - w - 10;
        };

        const show = () => {
            const cv = ctx.canvas(W, H), s = engine.state(), a = announcer.state();
            cv.clear(C.bg);
            // the M stripe and the title
            cv.fillRect(24, 22, 8, 26, C.mLight); cv.fillRect(34, 22, 8, 26, C.mDark); cv.fillRect(44, 22, 8, 26, C.mRed);
            cv.text('Copiloto de voz', 66, 46, 30, C.text, { font: 'bold', literal: true });
            const found = speaker.found(PHRASES), have = PHRASES.filter((p) => found[p]).length;
            let x = 1576;
            x = chip(cv, x, a.call ? 'En llamada: espera' : a.speaking ? 'Hablando: ' + TITLES[a.speaking] : 'Voz: ' + (speaker.lastError ? 'error' : have + '/' + PHRASES.length + ' frases'),
                !speaker.lastError && have === PHRASES.length && !a.call, !speaker.lastError);
            chip(cv, x, 'Coche: ' + (s.cond === null ? 'esperando' : COND_TEXT[s.cond] || s.cond), s.cond !== null, true);

            // the notices: 4 x 3 tiles, in their order of priority
            const TW = 380, TH = 118, GX = 24, GY = 70, GAP = 10;
            EVENTS.forEach((ev, i) => {
                const col = i % 4, row = Math.floor(i / 4), tx = GX + col * (TW + GAP), ty = GY + row * (TH + GAP);
                const on = ctx.settings.get('on_' + ev) !== false, speaking = a.speaking === ev, waiting = a.waiting.indexOf(ev) >= 0;
                cv.roundRect(tx, ty, TW, TH, 12, on ? C.tile : C.tileOff);
                if (speaking) cv.strokeRoundRect(tx, ty, TW, TH, 12, 3, C.blue);
                cv.fillRect(tx, ty + 14, 4, TH - 28, on ? TONE[ev] : C.faint);
                ICONS[ev](cv, tx + 46, ty + 50, on ? TONE[ev] : C.faint);
                cv.text(TITLES[ev], tx + 84, ty + 40, 25, on ? C.text : C.faint, { font: 'bold', literal: true });
                cv.text(String(i + 1), tx + TW - 30, ty + 34, 18, C.faint, { literal: true });
                const last = s.lastAt[ev];
                const line = !on ? 'Desactivado' : speaking ? 'Hablando…' : waiting ? 'En cola' : last ? 'Último: ' + ago(last) : WHEN[ev];
                cv.text(fit(cv, line, 19, TW - 100), tx + 84, ty + 78, 19, speaking ? C.light : C.dim, { literal: true });
                if (!found[ev === 'bienvenida' ? 'bienvenida' : ev] && !(ev === 'bienvenida' && (found.bienvenida_manana || found.bienvenida_tarde || found.bienvenida_noche))) {
                    cv.text('sin grabación', tx + 84, ty + 104, 15, C.amber, { literal: true });
                }
            });
            // the twelfth tile: what the app reads from the car
            const f = (v, u, d) => (v === null || v === undefined ? '--' : (d ? v.toFixed(d).replace('.', ',') : Math.round(v)) + u);
            const tx = GX + 3 * (TW + GAP), ty = GY + 2 * (TH + GAP);
            cv.roundRect(tx, ty, TW, TH, 12, C.tile);
            cv.text('El coche', tx + 20, ty + 30, 18, C.dim, { literal: true });
            cv.text(fit(cv, 'Combustible ' + f(s.litres, ' L') + ' · ' + f(s.range, ' km'), 18, TW - 40), tx + 20, ty + 56, 18, C.text, { literal: true });
            cv.text(fit(cv, 'Aceite ' + f(s.oil, ' °C') + ' · fuera ' + f(s.outside, ' °C', 1), 18, TW - 40), tx + 20, ty + 80, 18, C.text, { literal: true });
            cv.text(fit(cv, 'Batería ' + f(s.volts, ' V', 2) + (s.open.length ? ' · abierto: ' + s.open.join(', ') : ''), 18, TW - 40), tx + 20, ty + 104, 18, C.text, { literal: true });
            if (note) cv.text(fit(cv, note, 18, 1550), 26, 506, 18, C.amber, { literal: true });
            ctx.ui.image('MAIN_GFX', cv);
        };
        bgs.onChange(show);
        if (ctx.ui.onClick) {
            ctx.ui.onClick('BTN_TEST', () => {
                const p = PHRASES[testIdx++ % PHRASES.length];
                note = 'Probando: ' + p;
                show();
                speaker.say(p).then(() => { note = speaker.lastError ? 'Error: ' + speaker.lastError : ''; show(); });
            });
        }
        setInterval(show, 15000);
        show();
    },
});
