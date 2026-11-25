'use strict';
/**
 * Audio probe (46Wen): the screen for the mgu-audio-probe tool. Before anything is read it checks, on screen, the
 * three things the report needs:
 *   1. the tool is on the unit           /var/opt/mgu-audio-probe/current/probe.sh
 *   2. music plays, and it is seen       the head unit's now playing (HmiMediaState, front screen): the title, and
 *                                        its time moving (a source without a time, the radio, counts with a title)
 *   3. a USB stick is in                 a folder under /media
 * Only when the three are green does "Crear informe" ask the tool for a report (it writes the request file
 * /dev/shm/mgu-audio-probe.request; the tool's path unit starts the read-only probe as root). Nothing runs by itself.
 * "Prueba de captura" (step 2) asks for the capture test instead ({"mode":"capture"}): every capture device listened
 * to for 3 s, its level every 0.1 s; it needs the tool and the stick, and is meant to be run twice, with the music
 * playing and then paused, so the device that follows the music shows.
 * The tool writes its state to /dev/shm/mgu-audio-probe.status ({ state: running | done, usb, bytes, ... }) and the
 * report to /dev/shm/mgu-audio-probe.txt, which "Ver informe" shows here page by page: it can be photographed even
 * when the stick did not take the copy.
 *
 * Light on the unit: the screen is drawn only while it is shown, the checks are a few file looks every 2 s while it
 * is shown, the media state is a push signal. Node 8.
 */
const fs = require('fs');
const mgu = require('./kit/mgu');
const G = require('./kit/gauges');

const TOOL = '/var/opt/mgu-audio-probe/current/probe.sh';
const REQUEST = '/dev/shm/mgu-audio-probe.request';
const STATUS = '/dev/shm/mgu-audio-probe.status';
const REPORT = '/dev/shm/mgu-audio-probe.txt';
const MEDIA = '/media';
const MEDIA_IF = 'de.bmw.infotainment.hmi.hmimediastate.HmiMediaState';
const PLAY_MS = 3000;              // the track's time not moving this long: paused
const ANSWER_MS = 15000;           // the tool must say it runs within this, after the request
const LINES = 18;                  // report lines on a page

/** The now-playing feed, as the head unit sends it: what plays and whether it moves. */
function nowPlaying() {
    const m = { title: '', artist: '', timed: false, elapsed: null, movedAt: 0, seen: false };
    const text = (x) => String(x == null ? '' : x).replace(/[^\x20-\x7e -ÿ]/g, '').trim();
    m.feed = (kind, v) => {
        if (!v || typeof v !== 'object') return;
        if (v.sink !== undefined && v.sink !== 0 && v.sink !== 'FRONT') return;
        m.seen = true;
        if (kind === 'meta') {
            const a = text(v.firstLineText), b = text(v.secondLineText);
            const t3 = String(v.threeRowText || '').split(/[\r\n]+/).map(text).filter(Boolean);
            const title = a || t3[0] || '', artist = b || t3[1] || '';
            if (title !== m.title) { m.elapsed = null; m.timed = false; }
            m.title = title; m.artist = artist;
        } else {
            const e = Number(v.elapsed), t = Number(v.total);
            if (!isFinite(e) || !isFinite(t) || !t || v.hasProgress === false) { m.timed = false; return; }
            m.timed = true;
            if (e !== m.elapsed) { m.elapsed = e; m.movedAt = Date.now(); }
        }
    };
    m.playing = () => !!m.title && (!m.timed || Date.now() - m.movedAt < PLAY_MS);
    return m;
}

/** The sticks in: the folders under /media that are a mount of their own (an empty mount point left behind is
 *  on /media's own file system, so it is no stick). */
function sticks() {
    let names = [], dev;
    try { names = fs.readdirSync(MEDIA); dev = fs.statSync(MEDIA).dev; } catch (e) { return []; }
    return names.filter((n) => {
        try { const st = fs.statSync(MEDIA + '/' + n); return st.isDirectory() && st.dev !== dev; } catch (e) { return false; }
    });
}

function readJson(f) { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { return null; } }

mgu.run({
    async start(ctx) {
        const { ui, log } = ctx;
        const W = 1600, H = 520, SCREEN = 'MAIN';
        const C = { bg: '#0a0d12', tile: '#141a23', line: '#232c3a', text: '#f2f5f9', dim: '#8a95a6', faint: '#4a5466',
            blue: '#1c69d4', green: '#2fd27a', amber: '#ffb000', red: '#ff5a4f' };
        const music = nowPlaying();
        let page = 0;                  // 0: the checks; 1..n: the report's pages
        let asked = 0;                 // when the report was asked for (0: not)
        let note = '';
        let report = [];               // the report's lines, read when "Ver informe" is pressed or a report is done
        let lastDone = 0;
        let anywayUntil = 0;           // music not seen: a second press within 10 s starts anyway (CarPlay may not say)
        let askedMode = 'report';

        const state = () => {
            const st = readJson(STATUS);
            return {
                tool: fs.existsSync(TOOL),
                usb: sticks(),
                music: music.playing(),
                st,
                running: !!(st && st.state === 'running' && Date.now() / 1000 - st.at < 120),
            };
        };
        const loadReport = () => {
            try { report = fs.readFileSync(REPORT, 'utf8').split('\n').map((l) => l.replace(/\t/g, '    ').replace(/[^\x20-\x7e]/g, '?')); }
            catch (e) { report = []; }
            // the hints (what the report found) first: the page worth a photo if only one is taken
            const h = report.indexOf('===== hints');
            if (h > 0) report = report.slice(h).concat([''], report.slice(0, h));
            // long lines (a capture's 30 levels) wrapped, not cut
            report = report.reduce((out, l) => { for (let i = 0; i < l.length || i === 0; i += 140) out.push((i ? '    ' : '') + l.slice(i, i + 140)); return out; }, []);
        };
        const pages = () => Math.max(1, Math.ceil(report.length / LINES));

        // the kit's frame: the page tabs (Comprobar, Informe) up in the HMI's title strip where the kit runs the screen
        // (touch), else a slim bar on top; the page itself from G.TOP down, never under BMW's own header
        const TABS = ['Comprobar', 'Informe'];
        const TOP = G.TOP;
        const row = (cv, y, ok, wait, title, sub) => {
            cv.roundRect(24, y, 1000, 80, 14, C.tile);
            cv.circle(66, y + 40, 18, ok ? C.green : wait ? C.amber : C.red);
            const badge = ok ? 'OK' : wait ? '..' : 'NO';
            cv.text(badge, 66 - cv.textWidth(badge, 20, { font: 'bold', literal: true }) / 2, y + 47, 20, '#0a0d12', { font: 'bold', literal: true });
            cv.text(title, 102, y + 34, 26, C.text, { font: 'bold', literal: true });
            cv.text(sub, 102, y + 64, 19, ok ? C.dim : C.amber, { literal: true });
        };

        const mode = (st) => (st && st.mode === 'capture' ? 'capture' : 'report');
        const drawChecks = (cv, s, t) => {
            const y0 = TOP + 10;
            row(cv, y0, s.tool, false, '1. La herramienta Audio probe',
                s.tool ? 'Instalada en la unidad' : 'No está: instale "Audio probe" (herramienta) en el Store y reinicie la unidad');
            const song = music.title ? (music.title + (music.artist ? ' - ' + music.artist : '')).slice(0, 70) : '';
            row(cv, y0 + 90, s.music, !!music.title, '2. Música sonando',
                s.music ? 'Suena: ' + song : music.title ? 'En pausa: ' + song + ' (pulse play)' : music.seen ? 'Nada sonando: ponga música (Bluetooth, CarPlay o USB)' : 'Esperando a que la unidad diga qué suena...');
            row(cv, y0 + 180, s.usb.length > 0, false, '3. USB metido',
                s.usb.length ? 'Visto: ' + s.usb.map((n) => MEDIA + '/' + n).join(', ') : 'No hay ningún USB: meta uno (FAT32 o exFAT)');
            const ready = s.tool && s.music && s.usb.length > 0, busy = s.running || !!asked;
            // the right side: what happens next, the last result
            const px = 1044, pw = 532, ph = 260;
            cv.roundRect(px, y0, pw, ph, 14, C.tile);
            const tx = px + 24;
            if (busy) {
                cv.text(askedMode === 'capture' ? 'Escuchando cada entrada...' : 'Creando el informe...', tx, y0 + 44, 26, C.amber, { font: 'bold', literal: true });
                cv.text('Unos segundos. No quite el USB.', tx, y0 + 78, 19, C.dim, { literal: true });
            } else if (ready) {
                cv.text('Todo listo', tx, y0 + 44, 28, C.green, { font: 'bold', literal: true });
                cv.text('1. "Crear informe".', tx, y0 + 78, 19, C.text, { literal: true });
                cv.text('2. "Prueba de captura" con música y en pausa.', tx, y0 + 104, 19, C.text, { literal: true });
            } else {
                cv.text('Faltan condiciones', tx, y0 + 44, 26, C.red, { font: 'bold', literal: true });
                cv.text('El informe solo se crea con las tres en verde.', tx, y0 + 78, 19, C.dim, { literal: true });
            }
            const st = s.st;
            if (st && st.state === 'done') {
                const when = new Date(st.at * 1000), hh = ('0' + when.getHours()).slice(-2) + ':' + ('0' + when.getMinutes()).slice(-2);
                cv.text((mode(st) === 'capture' ? 'Última captura: ' : 'Último informe: ') + hh + ', ' + Math.round((st.bytes || 0) / 1024) + ' KB', tx, y0 + 150, 21, C.text, { literal: true });
                const okUsb = st.usb && st.usb.length;
                cv.text(okUsb ? 'Copiado en el USB: ' + st.usb.join(', ') : 'No se pudo copiar en el USB', tx, y0 + 180, 19, okUsb ? C.green : C.red, { literal: true });
                if (!okUsb && st.usbWhy) cv.text(String(st.usbWhy).slice(0, 52), tx, y0 + 206, 17, C.amber, { literal: true });
                cv.text('Está en la pestaña "Informe": hágale fotos.', tx, y0 + 236, 18, C.dim, { literal: true });
            }
            // the actions: on the page where the kit runs the screen (touch and controller), else in BMW's menu bar
            const by = y0 + 280;
            if (cv.own) {
                G.button(cv, t, 24, by, 320, 60, 'Crear informe', doStart, { key: 'BTN_START', primary: ready && !busy, busy });
                G.button(cv, t, 364, by, 400, 60, 'Prueba de captura', doCapture, { key: 'BTN_CAPTURE', primary: s.tool && s.usb.length > 0 && !busy, busy });
                G.button(cv, t, 784, by, 300, 60, 'Ver informe', () => openReport(), { key: 'BTN_PAGE' });
            } else {
                cv.text('Los botones "Crear informe", "Prueba de captura" y "Ver informe" están en el menú de BMW de esta', 24, by + 24, 19, C.text, { literal: true });
                cv.text('pantalla (como "Cambiar página" en Copiloto de voz). El informe también está en la pestaña "Informe".', 24, by + 50, 19, C.text, { literal: true });
            }
        };

        const drawReport = (cv, t) => {
            const n = pages(), p = Math.min(Math.max(page, 1), n);
            const y0 = TOP + 8;
            if (!report.length) {
                cv.text('Todavía no hay informe: créelo en "Comprobar".', 24, y0 + 40, 22, C.dim, { literal: true });
            } else {
                report.slice((p - 1) * LINES, p * LINES).forEach((l, i) => {
                    cv.text(l, 24, y0 + 24 + i * 22, 17, /^=====/.test(l) ? C.amber : C.text, { literal: true });
                });
            }
            const by = G.pageBottom(cv) - 56;
            cv.text('Página ' + p + ' de ' + n + '  (puede hacerle una foto)', cv.own ? 760 : 24, by + 34, 19, C.dim, { literal: true });
            if (cv.own) {
                G.button(cv, t, 24, by, 220, 50, 'Anterior', () => { page = p <= 1 ? n : p - 1; show(); }, { key: 'BTN_PREV' });
                G.button(cv, t, 264, by, 220, 50, 'Siguiente', () => { page = p >= n ? 1 : p + 1; show(); }, { key: 'BTN_PAGE', primary: true });
                G.button(cv, t, 504, by, 220, 50, 'Volver', () => { page = 0; show(); }, { key: 'BTN_BACK' });
            }
        };

        const openReport = () => { loadReport(); page = 1; note = ''; show(); };

        const show = () => {
            if (!ui.isVisible(SCREEN)) return;
            const s = state();
            // a report just done: read it, and say so
            if (s.st && s.st.state === 'done' && s.st.at !== lastDone) {
                if (lastDone || asked) { loadReport(); note = mode(s.st) === 'capture' ? 'Captura hecha: está en la pestaña "Informe".' : 'Informe creado: está en la pestaña "Informe".'; }
                lastDone = s.st.at; asked = 0;
            }
            if (asked && !s.running && Date.now() - asked > ANSWER_MS) {
                asked = 0;
                note = 'La herramienta no respondió: ¿está instalada? Reinicie la unidad una vez después de instalarla.';
            }
            const t = ctx.theme();
            const cv = ctx.canvas(W, H);
            cv.clear(C.bg);
            G.frame(cv, t, TABS, page === 0 ? 0 : 1, []);
            try { if (page === 0) drawChecks(cv, s, t); else drawReport(cv, t); } catch (e) { log.warn('draw: ' + e.message); }
            if (note && page === 0) cv.text(note, 24, G.pageBottom(cv) - 8, 19, C.amber, { literal: true });
            ui.image('MAIN_GFX', cv);
        };

        function doStart() {
            const s = state();
            const missing = [!s.tool && 'la herramienta', !s.music && 'la música', !s.usb.length && 'el USB'].filter(Boolean);
            const anyway = missing.length === 1 && !s.music && Date.now() < anywayUntil;
            page = 0;
            if (s.running || asked) note = 'Ya se está creando.';
            else if (missing.length === 1 && !s.music && !anyway) {
                // the unit may not say what CarPlay plays: the driver hears it, so a second press is enough
                anywayUntil = Date.now() + 10000;
                note = 'No veo la música (CarPlay puede no decirlo). Si suena, pulse "Crear informe" otra vez antes de 10 s.';
            } else if (missing.length && !anyway) note = 'Todavía no: falta ' + missing.join(', ') + '.';
            else {
                anywayUntil = 0;
                try {
                    fs.writeFileSync(REQUEST, JSON.stringify({ mode: 'report', at: Date.now(), title: music.title, usb: s.usb }));
                    asked = Date.now(); askedMode = 'report'; note = '';
                    log.info('report asked for (music: ' + music.title + ', usb: ' + s.usb.join(',') + ')');
                } catch (e) { note = 'No se pudo pedir: ' + e.message; }
            }
            show();
        }
        // step 2: the capture test; the tool and the stick needed, the music played and then paused (two runs)
        function doCapture() {
            const s = state();
            const missing = [!s.tool && 'la herramienta', !s.usb.length && 'el USB'].filter(Boolean);
            page = 0;
            if (s.running || asked) note = 'Ya se está haciendo.';
            else if (missing.length) note = 'Todavía no: falta ' + missing.join(', ') + '.';
            else {
                try {
                    fs.writeFileSync(REQUEST, JSON.stringify({ mode: 'capture', at: Date.now(), title: music.title, playing: s.music }));
                    asked = Date.now(); askedMode = 'capture';
                    note = s.music ? 'Captura con música sonando. Después, pause la música y repítala.' : 'Captura sin música (en pausa): compárela con la de música sonando.';
                    log.info('capture asked for (music playing: ' + s.music + ')');
                } catch (e) { note = 'No se pudo pedir: ' + e.message; }
            }
            show();
        }
        // BMW's menu bar (where the kit does not run the screen) and the page's own buttons do the same
        ui.onClick('BTN_START', doStart);
        ui.onClick('BTN_CAPTURE', doCapture);
        ui.onClick('BTN_PAGE', () => { if (page === 0) openReport(); else { page = page >= pages() ? 1 : page + 1; show(); } });
        // the tabs, touched or pressed: Comprobar, Informe (pressed again: its next page)
        if (ctx.onTab) ctx.onTab((i) => { if (i === 0) { page = 0; show(); } else if (page === 0) openReport(); else { page = page >= pages() ? 1 : page + 1; show(); } });
        ui.onVisible((name, on) => { if (name === SCREEN && on) show(); });
        if (ctx.onLayout) ctx.onLayout(show);
        setInterval(show, 2000);

        const w = await ctx.signals.watch(MEDIA_IF, 'HMI_CID', {
            playerMetadata: (v) => { music.feed('meta', v); },
            trackProgress: (v) => { music.feed('progress', v); },
        }, log);
        if (w && w.error) { music.seen = true; log.warn('now playing: ' + w.error); }
        show();
    },
});
