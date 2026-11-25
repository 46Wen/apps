'use strict';
/**
 * ondemand.js (46Wen): RideTube's service (jap-ridetube-d) only while RideTube is used.
 *
 * The service no longer starts with the car: it starts when this app's screen is opened (the file WANT, which the
 * tool's path unit jap-ridetube-d.path watches), and it stops after a minute without playing:
 *   - after IDLE_MS with nothing playing (stopped, paused, or never started) the screen asks "¿Sigues aquí?";
 *   - "Sí" counts as use again; "No", or no answer within ASK_MS (also while the screen is not shown), stops it:
 *     the app sends {cmd: 'quit'} (the tool's patch: the audio released, the daemon exits) and removes WANT.
 * Opening the screen again starts it again (a few seconds). A change of page or of focus counts as use.
 *
 * Plain Node 8. No timer of its own runs while the service is stopped and the screen is not shown.
 */
const fs = require('fs');

const WANT = '/dev/shm/jap-ridetube-d.want';
const IDLE_MS = 60000;     // the owner's choice: a minute without playing, then the question
const ASK_MS = 30000;      // no answer this long: stopped
const TICK_MS = 2000;

module.exports = function onDemand(o) {
    const { ui, model, ctl, log } = o;
    let busyAt = Date.now();   // the last use (playing, a page or focus change, "Sí")
    let askedAt = 0;           // the question on screen since (0: none)
    let stopped = false;       // stopped by us: nothing runs until the screen is opened again
    let timer = null, last = { mode: null, focus: null };

    const playing = () => model.state === 'playing' || model.state === 'preparing';
    function want() {
        stopped = false; busyAt = Date.now(); askedAt = 0;
        try { fs.writeFileSync(WANT, String(Date.now())); } catch (e) { log.warn('ondemand: ' + WANT + ': ' + e.message); }
        if (!timer) timer = setInterval(tick, TICK_MS);
    }
    function stop(why) {
        log.info('ondemand: stopping the RideTube service (' + why + ')');
        askedAt = 0; stopped = true;
        try { fs.unlinkSync(WANT); } catch (e) { /* gone */ }
        try { if (model.connected) ctl.send({ cmd: 'quit' }); } catch (e) { /* down already */ }
        if (timer) { clearInterval(timer); timer = null; }
    }
    function tick() {
        const now = Date.now();
        if (playing()) { busyAt = now; askedAt = 0; return; }
        if (!model.connected) { busyAt = now; return; }          // starting: the minute counts from when it is up
        if (!askedAt && now - busyAt >= IDLE_MS) { askedAt = now; log.info('ondemand: nothing played for a minute: asking'); }
        if (askedAt && now - askedAt >= ASK_MS) stop('no answer');
    }
    ui.onVisible((name, on) => { if (on && (name === 'VIEW' || name === 'MAIN') && (stopped || !timer)) want(); });
    want();   // the app was just opened (it does not start with the car): the service is wanted

    return {
        /** Over the page, before the volume: the question, or "starting" while the service comes up. */
        draw(cv, v) {
            if (v.mode !== last.mode || v.focus !== last.focus) { last = { mode: v.mode, focus: v.focus }; if (!askedAt) busyAt = Date.now(); }
            const { W, H, C } = v, MID = v.MID || W / 2;
            if (stopped || (!model.connected && timer)) {
                const t = stopped ? 'RideTube en pausa: vuelva a abrirlo para seguir' : 'Arrancando el servicio de RideTube...';
                const w = cv.textWidth(t, 26, { literal: true }) + 60, y = H - 110;
                cv.roundRect(MID - w / 2, y, w, 64, 32, '#4a3a10');
                cv.text(t, MID, y + 42, 26, '#ffd27a', { literal: true, align: 'center' });
                if (stopped && cv.own) cv.target(MID - w / 2, y, w, 64, () => want(), 'ondemand:start', 32);
                return;
            }
            if (!askedAt) return;
            const bw = 640, bh = 260, x = MID - bw / 2, y = (H - bh) / 2;
            cv.roundRect(x, y, bw, bh, 24, C.card || '#212121');
            cv.text('¿Sigues aquí?', MID, y + 70, 36, '#ffffff', { literal: true, font: 'bold', align: 'center' });
            const left = Math.max(0, Math.ceil((ASK_MS - (Date.now() - askedAt)) / 1000));
            cv.text('Sin respuesta, RideTube se cierra en ' + left + ' s', MID, y + 112, 22, C.dim || '#aaaaaa', { literal: true, align: 'center' });
            const btn = (cx, label, key, fn, accent) => {
                const w = 240, h = 72, by = y + bh - 100, f = v.focus === key;
                cv.roundRect(cx - w / 2, by, w, h, 36, f ? '#ffffff' : accent ? (C.red || '#ff3f8e') : '#3a3a3a');
                cv.text(label, cx, by + 47, 30, f ? '#0f0f0f' : '#ffffff', { literal: true, font: 'bold', align: 'center' });
                if (cv.own) cv.target(cx - w / 2, by, w, h, fn, key, 36);
            };
            btn(MID - 140, 'Sí', 'ondemand:yes', () => { askedAt = 0; busyAt = Date.now(); log.info('ondemand: still here'); }, true);
            btn(MID + 140, 'No', 'ondemand:no', () => stop('no'));
        },
        stopped: () => stopped,
    };
};
