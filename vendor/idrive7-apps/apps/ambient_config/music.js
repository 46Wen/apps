'use strict';
/**
 * music.js - 46Wen: the Music wave (scenes.js kind 'music'), the Colour wave going with the music.
 *
 * What it knows of the music:
 *   now playing   the head unit's own media state (HmiMediaState, front screen; the one Cluster Themes' Vector panel
 *                 reads): a track's title and whether it plays (its elapsed time moving; a source without a time, the
 *                 radio, plays while it has a title). The wave rolls only while something plays and stands still in a
 *                 pause; each new track moves the colours on TRACK_HUE degrees. A unit that never says (no HmiMediaState)
 *                 counts as playing: the wave just rolls.
 *   audio level   LEVEL_FILE, { "level": 0..1 } or a bare number, written whole 20 times a second by the tool
 *                 mgu-audio-level (native/mgu-audio-level: it reads SmartXbar's audio buffers, read only), which works
 *                 only while WANT_FILE was touched in the last 15 s: this touches it every WANT_MS while it is asked
 *                 for the level (a Music wave drawn). With a fresh level (under LEVEL_STALE_MS old) louder is a faster wave, a wider
 *                 swing of colour and brighter, quiet is slow, narrow and dim, smoothed (fast up, slow down) so a beat
 *                 shows as a push and the lights don't flicker. Without one, a steady wave with the track.
 *
 * Cost: no timers of its own. The media state is a push signal, watched only while a Music wave is on (use(true)),
 * and let go after it. The level file is looked at (one stat, a read only when it changed) at most every LEVEL_MS,
 * only while a Music wave is drawn and something plays; a missing file only every MISSING_MS. The lights' writes are
 * the same as any moving scene's: the gateway takes ~5 a second, so the wave shows about 2-3 steps a second.
 *
 *   const m = new Music({ log }); S.setMusic(m); m.use(true, signals);
 *   m.clock() -> wave time (ms)   m.level() -> 0..1 or null   m.hueShift() -> degrees   m.playing() -> bool
 * Node 8.
 */
const fs = require('fs');

const LEVEL_FILE = process.env.MGU_AUDIO_LEVEL || '/dev/shm/mgu-audio-level.json';
const WANT_FILE = '/dev/shm/mgu-audio-level.want';  // touched: mgu-audio-level reads the music for the next 15 s
const WANT_MS = 5000;
const MEDIA_IF = 'de.bmw.infotainment.hmi.hmimediastate.HmiMediaState';
const MEDIA_INSTANCE = 'HMI_CID';          // the centre display's (none is '1': BMW's app manager refuses that)
const LEVEL_MS = 120;                      // the level file looked at at most this often
const MISSING_MS = 5000;                   // ... and only this often while it is not there
const LEVEL_STALE_MS = 1500;               // a level older than this: no level (the helper stopped)
const PLAY_MS = 2500;                      // elapsed time not moving for this long: paused
const TRACK_HUE = 45;                      // a new track: the colours this far round
const ATTACK = 0.6, RELEASE = 0.18;        // the level's smoothing, a step of each reading
const MAX_STEP_MS = 1000;                  // the wave's clock moves at most this much between two looks

const clamp01 = (x) => Math.max(0, Math.min(1, x));
/** A level as the helper writes it: { level } or a bare number, 0..1; null for anything else. */
function parseLevel(text) {
    let v;
    try { v = JSON.parse(text); } catch (e) { return null; }
    if (v && typeof v === 'object') v = v.level;
    return typeof v === 'number' && isFinite(v) ? clamp01(v) : null;
}

class Music {
    constructor(o) {
        o = o || {};
        this.log = o.log || { info() {}, warn() {} };
        this.now = o.now || Date.now;
        this.file = o.file || LEVEL_FILE;
        this.fs = o.fs || fs;
        this.title = null;                 // null: the unit has not said (no media state)
        this.timed = false;                // the track has an elapsed time
        this.elapsed = null; this.movedAt = 0;
        this.tracks = 0;
        this._clock = 0; this._at = 0;
        this._env = null;                  // the smoothed level, null: none
        this._levelAt = 0;                 // when the last level was read (its file's time)
        this._mtime = 0; this._lookAt = 0; this._missing = false; this._wantAt = 0;
        this._watch = null; this._want = false; this._logged = 0;
    }

    /** The media state's fields as the signal sends them (playerMetadata, trackProgress). */
    feed(kind, v) {
        if (!v || typeof v !== 'object') return;
        if (v.sink !== undefined && v.sink !== 0 && v.sink !== 'FRONT') return;
        if (this._logged < 4) { this._logged++; this.log.info('music: ' + kind + ' ' + JSON.stringify(v).slice(0, 200)); }
        if (kind === 'meta') {
            const t = [v.firstLineText, v.secondLineText, v.threeRowText].map((x) => String(x == null ? '' : x).trim()).filter(Boolean).join(' / ');
            if (t !== (this.title || '')) {
                if (t && this.title) this.tracks++;
                this.title = t; this.elapsed = null; this.timed = false;
            }
        } else {
            const e = Number(v.elapsed), tot = Number(v.total);
            if (!isFinite(e) || !isFinite(tot) || !tot || v.hasProgress === false) { this.timed = false; return; }
            if (this.title == null) this.title = '';
            this.timed = true;
            if (e !== this.elapsed) { this.elapsed = e; this.movedAt = this.now(); }
        }
    }

    /** Something plays: the time moving, a title without a time (the radio), or a unit that never says. */
    playing() {
        if (this.title == null) return true;
        if (this.timed) return this.now() - this.movedAt < PLAY_MS;
        return !!this.title;
    }

    /** The audio level now, 0..1 (smoothed), or null: none fresh. Looks at the file when it is due. */
    level() {
        const now = this.now();
        if (now - this._wantAt >= WANT_MS) {
            this._wantAt = now;
            // (the helper's "keep reading"; a car without it: a small empty file, nothing else)
            try { this.fs.writeFileSync(WANT_FILE, ''); } catch (e) { /* no /dev/shm: no level */ }
        }
        if (now - this._lookAt >= (this._missing ? MISSING_MS : LEVEL_MS)) { this._lookAt = now; this._read(); }
        if (this._env == null || now - this._levelAt > LEVEL_STALE_MS) return null;
        return this._env;
    }

    _read() {
        let st;
        try { st = this.fs.statSync(this.file); } catch (e) { this._missing = true; return; }
        this._missing = false;
        if (st.mtimeMs === this._mtime) return;
        this._mtime = st.mtimeMs;
        let x;
        try { x = parseLevel(this.fs.readFileSync(this.file, 'utf8')); } catch (e) { return; }
        if (x == null) return;     // half-written: the next one
        // (a stale file from before keeps the time it was written: level() leaves it out)
        this._levelAt = Math.min(this.now(), st.mtimeMs);
        const was = this._env == null || this.now() - this._levelAt > LEVEL_STALE_MS ? x : this._env;
        this._env = was + (x - was) * (x > was ? ATTACK : RELEASE);
    }

    /** The wave's time (ms): moving only while something plays, faster the louder it is. */
    clock() {
        const now = this.now(), dt = this._at ? Math.min(MAX_STEP_MS, Math.max(0, now - this._at)) : 0;
        this._at = now;
        if (this.playing()) {
            const lv = this.level();
            this._clock += dt * (lv == null ? 1 : 0.4 + 1.6 * lv);
        }
        return this._clock;
    }

    /** The colours turned on with each new track. */
    hueShift() { return (this.tracks * TRACK_HUE) % 360; }

    /** One line for the Animations tab. */
    label() {
        if (!this.playing()) return 'Waits for the music (paused)';
        return this.level() != null ? 'Rolls with the music\'s volume' : 'Rolls while music plays, new colours each track';
    }

    /** A Music wave on (true) or off: the media state watched only meanwhile. */
    use(on, signals) {
        on = !!on;
        if (on === this._want) return;
        this._want = on;
        if (on && signals && !this._watch) {
            this._watch = Promise.resolve(signals.watch(MEDIA_IF, MEDIA_INSTANCE, {
                playerMetadata: (v) => this.feed('meta', v),
                trackProgress: (v) => this.feed('progress', v),
            }, this.log)).then((w) => {
                if (w && w.error) this.log.warn('music: no media state (' + w.error + '): the wave rolls without it');
                return w;
            }).catch((e) => { this._watch = null; this.log.warn('music: ' + (e && e.message || e)); });
        } else if (!on && this._watch) {
            const p = this._watch;
            this._watch = null;
            // let go of the signal; what it knew is forgotten (a different source may play next time)
            p.then((w) => { if (w && w.shutdown) w.shutdown(); });
            this.title = null; this.timed = false; this.elapsed = null;
        }
    }
}

module.exports = { Music, parseLevel, LEVEL_FILE, LEVEL_MS, LEVEL_STALE_MS, PLAY_MS, TRACK_HUE, MEDIA_IF, MEDIA_INSTANCE };
