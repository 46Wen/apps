'use strict';
/**
 * Audio probe (46Wen), 0.6: the last step of the audio work, the music's live level for Ambient config's Music wave.
 *   - the level live, from the tool Music level (/dev/shm/mgu-audio-level.json), and when there is none, why (its
 *     heartbeat /dev/shm/mgu-audio-level.status: not running, not asked, no buffers, cannot write);
 *   - "Explorar SmartXbar" (the tool mgu-audio-probe, read only, as root through its path unit): first the Music level
 *     section (its service, journal, files and what it sees), then SmartXbar's ring buffers, the Audio Manager's lists
 *     (read here, written to /dev/shm/mgu-audio-am.txt for the tool) and who maps which buffer; shown on the
 *     "Informe" tab page by page, to be photographed.
 * It asks for the report only with the tool installed and music playing (a second press within 10 s goes on anyway:
 * CarPlay may not say what plays). Steps 1 and 2 (the general report, the capture test, the USB stick) are done and
 * left out.
 *
 * Light on the unit: the screen is drawn only while it is shown and only when something on it changed (the level bar
 * at most twice a second, the checks every 3 s), the media state is a push signal. Node 8.
 */
const fs = require('fs');
const mgu = require('./kit/mgu');
const G = require('./kit/gauges');

const TOOL = '/var/opt/mgu-audio-probe/current/probe.sh';
const REQUEST = '/dev/shm/mgu-audio-probe.request';
const STATUS = '/dev/shm/mgu-audio-probe.status';
const REPORT = '/dev/shm/mgu-audio-probe.txt';
const MEDIA_IF = 'de.bmw.infotainment.hmi.hmimediastate.HmiMediaState';
const PLAY_MS = 3000;              // the track's time not moving this long: paused
const ANSWER_MS = 15000;           // the tool must say it runs within this, after the request
const LINES = 22;                  // report lines on a page
const AM_FILE = '/dev/shm/mgu-audio-am.txt';
const LEVEL_FILE = '/dev/shm/mgu-audio-level.json';   // mgu-audio-level: the music's level, live (step 5)
const LEVEL_WANT = '/dev/shm/mgu-audio-level.want';   // touched: the tool reads for the next 15 s
const LEVEL_STATUS = '/dev/shm/mgu-audio-level.status'; // the tool's heartbeat, once a second (0.1.1+)
const LEVEL_BIN = '/var/opt/mgu-audio-level/current/mgu-audio-level';
const CC_IF = 'org.genivi.am.commandinterface.CommandControl';

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

function readJson(f) { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { return null; } }

/** What the Music level tool says now: its level when fresh, else why not, from its heartbeat (0.1.1+). */
let wantErr = '';
function touchWant() {
    try { fs.writeFileSync(LEVEL_WANT, ''); wantErr = ''; } catch (e) { wantErr = e.code || e.message; }
}
function levelInfo() {
    const now = Date.now();
    if (!fs.existsSync(LEVEL_BIN)) return { text: 'falta la herramienta Music level', why: 'Instale "Music level" en el Store y reinicie la unidad.' };
    const lv = readJson(LEVEL_FILE);
    if (lv && typeof lv.level === 'number' && now - lv.at < 1500) {
        const level = Math.max(0, Math.min(1, lv.level));
        return { lv: { level }, text: lv.src === 'none' ? 'nada suena (ningún buffer se mueve)' : Math.round(lv.db) + ' dB  ' + lv.src,
            key: Math.round(level * 40) + lv.src };
    }
    const st = readJson(LEVEL_STATUS);
    if (!st || now - st.at > 5000) return { text: 'la herramienta no está en marcha',
        why: st ? 'Se paró. Haga "Explorar SmartXbar" y fotografíe la sección "Music level".'
            : 'Sin señal de vida: actualícela a 0.1.1 en el Store y reinicie la unidad. Si sigue, "Explorar SmartXbar".' };
    if (!st.wanted) return { text: 'en marcha, pero no le llega la petición',
        why: wantErr ? 'Esta app no puede tocar ' + LEVEL_WANT + ' (' + wantErr + ').' : 'Espere 2 s.' };
    if (st.err) return { text: 'no puede escribir el nivel', why: st.err };
    if (!st.ports) return { text: 'en marcha, pero no encuentra los buffers de SmartXbar', why: 'Haga "Explorar SmartXbar" y fotografíe la sección "Music level".' };
    return { text: 'leyendo ' + st.ports + ' buffers...', why: '' };
}

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
            report = report.reduce((out, l) => { for (let i = 0; i < l.length || i === 0; i += 165) out.push((i ? '    ' : '') + l.slice(i, i + 165)); return out; }, []);
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

        const mode = (st) => (st && (st.mode === 'capture' || st.mode === 'smartx') ? st.mode : 'report');
        const drawChecks = (cv, s, t) => {
            const y0 = TOP + 10;
            row(cv, y0, s.tool, false, '1. La herramienta Audio probe',
                s.tool ? 'Instalada en la unidad' : 'No está: instale "Audio probe" (herramienta) en el Store y reinicie la unidad');
            const song = music.title ? (music.title + (music.artist ? ' - ' + music.artist : '')).slice(0, 70) : '';
            row(cv, y0 + 90, s.music, !!music.title, '2. Música sonando',
                s.music ? 'Suena: ' + song : music.title ? 'En pausa: ' + song + ' (pulse play)' : music.seen ? 'Nada sonando: ponga música (Bluetooth, CarPlay o USB)' : 'Esperando a que la unidad diga qué suena...');
            const ready = s.tool && s.music, busy = s.running || !!asked;
            // the right side: what happens next, the last result
            const px = 1044, pw = 532, ph = 260;
            cv.roundRect(px, y0, pw, ph, 14, C.tile);
            const tx = px + 24;
            if (busy) {
                cv.text(askedMode === 'capture' ? 'Escuchando cada entrada...' : askedMode === 'smartx' ? 'Explorando SmartXbar...' : 'Creando el informe...', tx, y0 + 44, 26, C.amber, { font: 'bold', literal: true });
                cv.text(askedMode === 'smartx' ? 'Hasta 30 s. Deje la música sonando.' : 'Unos segundos. Deje la música sonando.', tx, y0 + 78, 19, C.dim, { literal: true });
            } else if (ready) {
                cv.text('Todo listo', tx, y0 + 44, 28, C.green, { font: 'bold', literal: true });
                cv.text('Pulse "Explorar SmartXbar" con la música sonando.', tx, y0 + 78, 19, C.text, { literal: true });
                cv.text('Luego haga una foto de cada página del informe.', tx, y0 + 104, 19, C.dim, { literal: true });
            } else {
                cv.text('Faltan condiciones', tx, y0 + 44, 26, C.red, { font: 'bold', literal: true });
                cv.text('Hacen falta la herramienta y la música sonando.', tx, y0 + 78, 19, C.dim, { literal: true });
            }
            const st = s.st;
            if (st && st.state === 'done') {
                const when = new Date(st.at * 1000), hh = ('0' + when.getHours()).slice(-2) + ':' + ('0' + when.getMinutes()).slice(-2);
                cv.text((mode(st) === 'capture' ? 'Última captura: ' : mode(st) === 'smartx' ? 'Última exploración: ' : 'Último informe: ') + hh + ', ' + Math.round((st.bytes || 0) / 1024) + ' KB', tx, y0 + 150, 21, C.text, { literal: true });
                cv.text('Está en la pestaña "Informe": hágale fotos.', tx, y0 + 236, 18, C.dim, { literal: true });
            }
            // step 5: the music's level, live, from mgu-audio-level (it reads while this screen touches LEVEL_WANT)
            const L = levelInfo(), ly = y0 + 372;
            cv.text('Nivel de la música en vivo (Music level):', 24, ly, 20, C.text, { font: 'bold', literal: true });
            cv.roundRect(470, ly - 20, 600, 26, 13, C.tile);
            if (L.lv) {
                cv.roundRect(470, ly - 20, Math.max(26, 600 * L.lv.level), 26, 13, L.lv.level > 0.8 ? C.amber : C.green);
                cv.text(L.text, 1090, ly, 18, C.dim, { literal: true });
            } else cv.text(L.text, 1090, ly, 18, C.amber, { literal: true });
            if (L.why) cv.text(L.why, 24, ly + 28, 17, C.amber, { literal: true });
            // the actions: on the page where the kit runs the screen (touch and controller), else in BMW's menu bar
            const by = y0 + 280;
            if (cv.own) {
                G.button(cv, t, 24, by, 420, 60, 'Explorar SmartXbar', doSmartx, { key: 'BTN_SMARTX', primary: ready && !busy, busy });
                G.button(cv, t, 464, by, 300, 60, 'Ver informe', () => openReport(), { key: 'BTN_PAGE' });
            } else {
                cv.text('Los botones "Explorar SmartXbar" y "Ver informe" están en el menú de BMW de esta', 24, by + 24, 19, C.text, { literal: true });
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
                    cv.text(l, 24, y0 + 22 + i * 18, 15, /^=====/.test(l) ? C.amber : C.text, { literal: true });
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

        let wantAt = 0;
        const show = () => {
            if (!ui.isVisible(SCREEN)) return;
            if (Date.now() - wantAt > 5000) { wantAt = Date.now(); touchWant(); }
            const s = state();
            // a report just done: read it, and say so
            if (s.st && s.st.state === 'done' && s.st.at !== lastDone) {
                if (lastDone || asked) { loadReport(); note = (mode(s.st) === 'capture' ? 'Captura hecha' : mode(s.st) === 'smartx' ? 'Exploración hecha' : 'Informe creado') + ': está en la pestaña "Informe".'; }
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

        // step 3: SmartXbar. The Audio Manager's own lists first (sinks, sources, connections: read only, as Copiloto
        // de voz reads them), written to AM_FILE for the tool, which adds them to its report on SmartXbar
        let cc = null;
        async function amLists() {
            const out = ['asked ' + new Date().toISOString() + ', music ' + (music.playing() ? 'playing: ' + music.title : 'not seen')];
            const line = (k, x) => out.push(k + ' ' + JSON.stringify(x).slice(0, 400));
            try {
                // (the first time "Service unavailable": asked before the Audio Manager's service was found. watch()
                // follows its availability; up to 4 s for it)
                if (!cc) {
                    const w = await ctx.signals.watch(CC_IF, '1', { listOfMainConnections: () => {} }, log);
                    for (let i = 0; i < 20 && w && !w.available && !w.error; i++) await new Promise((r) => setTimeout(r, 200));
                    out.push('audio manager: ' + (w && w.error ? 'error ' + w.error : w && w.available ? 'available' : 'not available after 4 s'));
                    cc = w && w.proxy;
                }
                const sinks = await ctx.signals.call(cc, 'getListMainSinks', {}, 3000).catch((e) => ({ error: String(e && e.message || e) }));
                ((sinks && sinks.listMainSinks) || [sinks]).forEach((k) => line('sink', k));
                const srcs = await ctx.signals.call(cc, 'getListMainSources', {}, 3000).catch((e) => ({ error: String(e && e.message || e) }));
                ((srcs && srcs.listMainSources) || [srcs]).forEach((k) => line('source', k));
                const conns = await ctx.signals.get(cc, 'listOfMainConnections', 3000).catch((e) => ({ error: String(e && e.message || e) }));
                (Array.isArray(conns) ? conns : [conns]).forEach((k) => line('connection', k));
            } catch (e) { out.push('Audio Manager: ' + (e && e.message || e)); }
            return out.join('\n') + '\n';
        }
        async function doSmartx() {
            const s = state();
            const anyway = s.tool && !s.music && Date.now() < anywayUntil;
            page = 0;
            if (s.running || asked) { note = 'Ya se está haciendo.'; return show(); }
            if (!s.tool) { note = 'Todavía no: falta la herramienta.'; return show(); }
            if (!s.music && !anyway) {
                anywayUntil = Date.now() + 10000;
                note = 'No veo la música (CarPlay puede no decirlo). Si suena, pulse "Explorar SmartXbar" otra vez antes de 10 s.';
                return show();
            }
            anywayUntil = 0;
            asked = Date.now(); askedMode = 'smartx'; note = 'Leyendo el Audio Manager...';
            show();
            let am = '';
            try { am = await amLists(); } catch (e) { am = 'Audio Manager: ' + e + '\n'; }
            try {
                fs.writeFileSync(AM_FILE, am);
                fs.writeFileSync(REQUEST, JSON.stringify({ mode: 'smartx', at: Date.now(), title: music.title, playing: s.music }));
                asked = Date.now(); note = '';
                log.info('smartx asked for (music: ' + music.title + '); audio manager: ' + am.split('\n').length + ' lines');
            } catch (e) { asked = 0; note = 'No se pudo pedir: ' + e.message; }
            show();
        }
        // BMW's menu bar (where the kit does not run the screen) and the page's own buttons do the same
        ui.onClick('BTN_SMARTX', doSmartx);
        ui.onClick('BTN_PAGE', () => { if (page === 0) openReport(); else { page = page >= pages() ? 1 : page + 1; show(); } });
        // the tabs, touched or pressed: Comprobar, Informe (pressed again: its next page)
        if (ctx.onTab) ctx.onTab((i) => { if (i === 0) { page = 0; show(); } else if (page === 0) openReport(); else { page = page >= pages() ? 1 : page + 1; show(); } });
        ui.onVisible((name, on) => { if (name === SCREEN && on) show(); });
        if (ctx.onLayout) ctx.onLayout(show);
        // Light: the screen is drawn again only when something on it changed. Every 0.5 s while it is shown, one look at
        // the level (a small file): drawn when the bar moved a step or the message changed; the checks every 3 s.
        // Hidden: nothing at all (not even the want file: the tool goes idle 15 s later).
        let ticks = 0, lastKey = '';
        setInterval(() => {
            if (!ui.isVisible(SCREEN)) return;
            ticks++;
            if (Date.now() - wantAt > 5000) { wantAt = Date.now(); touchWant(); }
            if (page !== 0) return;
            const L = levelInfo(), key = L.key || L.text + L.why;
            if (key !== lastKey || ticks % 6 === 0) { lastKey = key; show(); }
        }, 500);

        const w = await ctx.signals.watch(MEDIA_IF, 'HMI_CID', {
            playerMetadata: (v) => { music.feed('meta', v); },
            trackProgress: (v) => { music.feed('progress', v); },
        }, log);
        if (w && w.error) { music.seen = true; log.warn('now playing: ' + w.error); }
        show();
    },
});
