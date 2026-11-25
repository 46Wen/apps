'use strict';
// Ambient config's Music wave (46Wen, vendor/patches/ambient_config/music.js, applied by scripts/vendor_sync.py):
// playing or paused from the media state, the wave's clock still in a pause, a new track's colours turned on, the
// audio level file (fresh, stale, half-written, missing), the scene in scenes.js, the media state watched only while a
// Music wave is on, and the lights' writes with it (no more than a Colour wave's, none in a pause).
//   node tools/test_ambient_music.js
const path = require('path');

const APP = path.join(__dirname, '..', 'vendor', 'idrive7-apps', 'apps', 'ambient_config');
const { Music, parseLevel, LEVEL_MS, LEVEL_STALE_MS, PLAY_MS, TRACK_HUE, MEDIA_IF, MEDIA_INSTANCE } = require(path.join(APP, 'music'));
const S = require(path.join(APP, 'scenes'));
const { Lights } = require(path.join(APP, 'lights'));

let fails = 0, checks = 0;
const ok = (c, msg) => { checks++; if (!c) { fails++; console.log('FAIL ' + msg); } };
const log = { info() {}, warn() {}, error() {} };

// a level file on a clock of our own
let now = 1000000;
const file = { text: null, mtime: 0, stats: 0, reads: 0 };
const fakeFs = {
    statSync: () => { file.stats++; if (file.text == null) { const e = new Error('ENOENT'); e.code = 'ENOENT'; throw e; } return { mtimeMs: file.mtime }; },
    readFileSync: () => { file.reads++; return file.text; },
    writeFileSync: (f) => { file.wants = (file.wants || 0) + (f === '/dev/shm/mgu-audio-level.want' ? 1 : 0); },
};
const write = (text) => { file.text = text; file.mtime = now; };
const mk = () => new Music({ log, now: () => now, fs: fakeFs, file: '/x' });

// the level as written
ok(parseLevel('0.5') === 0.5 && parseLevel('{"level":0.25}') === 0.25 && parseLevel('{"level":3}') === 1 && parseLevel('-1') === 0, 'levels read');
ok(parseLevel('{"lev') === null && parseLevel('"x"') === null && parseLevel('{}') === null && parseLevel('NaN') === null, 'half-written or wrong: none');

// playing: a unit that never says plays; a time moving plays, standing still is a pause; a title without a time plays
let m = mk();
ok(m.playing(), 'no media state: plays');
m.feed('meta', { firstLineText: 'Song A', firstLineType: 3, secondLineText: 'Artist', sink: 'FRONT' });
m.feed('progress', { elapsed: 10, total: 200, sink: 'FRONT' });
ok(m.playing(), 'a track that just moved plays');
now += PLAY_MS + 100;
ok(!m.playing(), 'its time standing still: paused');
m.feed('progress', { elapsed: 13, total: 200 });
ok(m.playing(), 'moving again: plays');
m.feed('progress', { elapsed: 0, total: 0, hasProgress: false });
ok(m.playing(), 'a source without a time (radio) with a title: plays');
m.feed('meta', { firstLineText: '', secondLineText: '' });
ok(!m.playing(), 'nothing with a title, no time: nothing plays');
m.feed('progress', { elapsed: 50, total: 200, sink: 'REAR' });
ok(!m.playing(), 'the rear screens\' player is left out');

// a new track turns the colours; the first one does not
m = mk();
m.feed('meta', { firstLineText: 'One' });
ok(m.hueShift() === 0, 'the first track: the colours as they are');
m.feed('meta', { firstLineText: 'Two' });
m.feed('meta', { firstLineText: 'Two' });
ok(m.hueShift() === TRACK_HUE, 'a new track: ' + TRACK_HUE + ' degrees on, the same one again nothing');

// the clock: moves while playing, still in a pause, never jumps more than a second
m = mk();
m.feed('meta', { firstLineText: 'Song' });
m.feed('progress', { elapsed: 1, total: 100 });
m.clock(); now += 400; m.feed('progress', { elapsed: 1.4, total: 100 });
const c1 = m.clock();
ok(Math.abs(c1 - 400) < 1, 'no level: the clock at the track\'s pace (' + c1 + ')');
now += PLAY_MS + 500;
const c2 = m.clock(); now += 800; const c3 = m.clock();
ok(c3 === c2, 'paused: the clock stands still');
m.feed('progress', { elapsed: 9, total: 100 });
now += 60000;
ok(m.clock() - c3 <= 1000, 'a long gap: at most a second on');

// the level: fresh drives it, smoothed fast up and slow down; stale or missing: none; not read more than every LEVEL_MS
m = mk();
file.text = null; file.stats = 0; file.wants = 0;
ok(m.level() === null, 'no file: no level');
now += 100; m.level(); now += 100; m.level();
ok(file.stats === 1, 'a missing file is not looked for on every frame (' + file.stats + ')');
ok(file.wants === 1, 'the level helper asked to read (mgu-audio-level.want touched), once per 5 s (' + file.wants + ')');
now += 6000; write('1');
const up = m.level();
ok(up === 1, 'the first level as it is');
now += LEVEL_MS; write('0');
const down = m.level();
ok(down > 0.7 && down < 0.9, 'quieter: down slowly (' + down + ')');
now += LEVEL_MS; write('{"level":1}');
const back = m.level();
ok(back > down + 0.1, 'louder: up quickly (' + back + ')');
const reads = file.reads;
now += 10; m.level(); m.level();
ok(file.reads === reads, 'not read again within LEVEL_MS');
now += LEVEL_MS; m.level();
ok(file.reads === reads, 'not read again while the file has not changed');
now += LEVEL_STALE_MS + 10;
ok(m.level() === null, 'a level gone stale (the helper stopped): none');
now += LEVEL_MS; write('{"lev');
ok(m.level() === null, 'a half-written file: none yet');

// with a level, louder: a faster clock
m = mk();
m.feed('meta', { firstLineText: 'Loud' }); m.feed('progress', { elapsed: 1, total: 100 });
write('1'); m.clock(); now += 200; write('1'); m.feed('progress', { elapsed: 2, total: 100 });
const loud = m.clock();
const q = mk();
q.feed('meta', { firstLineText: 'Quiet' }); q.feed('progress', { elapsed: 1, total: 100 });
write('0'); q.clock(); now += 200; write('0'); q.feed('progress', { elapsed: 2, total: 100 });
const quiet = q.clock();
ok(loud > quiet * 2, 'louder rolls faster (' + loud.toFixed(0) + ' against ' + quiet.toFixed(0) + ' ms)');

// the scene
ok(S.KINDS.indexOf('music') >= 0 && S.NAMES.music === 'Music wave' && S.moves({ kind: 'music' }), 'a Music wave is a moving scene');
const scene = { kind: 'music', upper: { rgb: [255, 0, 0], bright: 80 }, lower: { rgb: [255, 0, 0], bright: 80 }, speed: 2 };
S.setMusic(null);
const plain = S.lightAt(scene, { bus: 0, y: 0 }, 1250), wave = S.lightAt(Object.assign({}, scene, { kind: 'wave' }), { bus: 0, y: 0 }, 1250);
ok(plain.rgb.join() === wave.rgb.join() && plain.bright === 80, 'without music.js: a Colour wave');
const fake = { lv: null, c: 0, sh: 0, level() { return this.lv; }, clock() { return this.c; }, hueShift() { return this.sh; } };
S.setMusic(fake);
const a0 = S.lightAt(scene, { bus: 0 }, 0), a1 = S.lightAt(scene, { bus: 0 }, 99999);
ok(a0.rgb.join() === a1.rgb.join(), 'on the music\'s clock, not the scene\'s (still in a pause)');
fake.c = 1250;
ok(S.lightAt(scene, { bus: 0 }, 0).rgb.join() !== a0.rgb.join(), 'the clock moving: the colour moves');
fake.lv = 0; const dim = S.lightAt(scene, { bus: 0 }, 0);
fake.lv = 1; const bright = S.lightAt(scene, { bus: 0 }, 0);
ok(dim.bright < bright.bright && bright.bright === 80 && dim.bright % 5 === 0 && dim.bright >= 5, 'quiet dim, loud the look\'s brightness, in steps of 5');
fake.lv = null; fake.c = 0; fake.sh = 0; const h0 = S.hueOf(S.lightAt(scene, { bus: 0 }, 0).rgb);
fake.sh = 120; const h1 = S.hueOf(S.lightAt(scene, { bus: 0 }, 0).rgb);
ok(Math.abs(((h1 - h0 + 540) % 360) - 180 - 120) < 3, 'a new track: the colours turned');

// watched only while on, let go after
(async () => {
    const watched = [];
    let shut = 0;
    const signals = { watch: async (iface, inst, h) => { watched.push([iface, inst, Object.keys(h).join()]); return { error: null, shutdown: () => { shut++; } }; } };
    m = mk();
    m.use(false, signals);
    ok(!watched.length, 'off: nothing watched');
    m.use(true, signals); m.use(true, signals);
    await new Promise((r) => setImmediate(r));
    ok(watched.length === 1 && watched[0][0] === MEDIA_IF && watched[0][1] === MEDIA_INSTANCE && watched[0][2] === 'playerMetadata,trackProgress', 'on: the media state, once, HMI_CID');
    m.feed('meta', { firstLineText: 'x' });
    m.use(false, signals);
    await new Promise((r) => setImmediate(r));
    ok(shut === 1 && m.playing(), 'off again: let go, and what it knew forgotten');
    const bad = { watch: async () => ({ error: 'no SOME/IP config', shutdown() {} }) };
    const n = mk(); n.use(true, bad);
    await new Promise((r) => setImmediate(r));
    ok(n.playing(), 'a unit without the media state: the wave just rolls');

    // the lights' writes: a moving Music wave no more than a Colour wave, a paused one none past its renewals
    const lightsFor = (clock) => {
        const sent = [];
        const diag = {};
        const known = [0, 1].map((bus) => [1, 2, 3].map((nad) => ({ bus, nad, name: 'L' + bus + nad, part: 'upper', x: nad / 4, y: nad / 4 }))).reduce((a, b) => a.concat(b), []);
        const l = new Lights({ diag, log, known, now: () => clock.t, sleep: () => Promise.resolve() });
        l._stopped = true;          // (no writing loop of its own: the frames are taken here, one write = 200 ms)
        return { l, sent };
    };
    const run = async (kind, playing) => {
        const clock = { t: 0 };
        const mm = new Music({ log, now: () => clock.t, fs: fakeFs, file: '/none' });
        file.text = null;
        mm.feed('meta', { firstLineText: 'Song' });
        mm.feed('progress', { elapsed: 1, total: 300 });
        if (!playing) clock.t += PLAY_MS + 500;      // paused before the scene comes on
        S.setMusic(mm);
        const { l, sent } = lightsFor(clock);
        l.state = 'ours';
        l.show(Object.assign({}, scene, { kind }));
        // ten seconds of frames, the song's time moving only while playing
        for (let i = 0; i < 50; i++) {
            if (playing) mm.feed('progress', { elapsed: clock.t / 1000, total: 300 });
            const w = l._next();
            if (w) { sent.push(w.frame); clock.t += 200; if (w.lights && w.want) w.lights.forEach((x) => l._last.set(x, Object.assign({ at: clock.t, hold: w.hold }, w.want))); }
            else clock.t += 200;
        }
        return sent.length;
    };
    const waveWrites = await run('wave', true), musicWrites = await run('music', true), pausedWrites = await run('music', false);
    ok(musicWrites <= waveWrites + 2, 'playing: about as many writes as a Colour wave (' + musicWrites + ' against ' + waveWrites + ')');
    ok(pausedWrites <= 8 && pausedWrites < musicWrites / 3, 'paused: only the renewals (' + pausedWrites + ' in 10 s against ' + musicWrites + ' playing)');
    S.setMusic(null);

    console.log('writes in 10 s: Colour wave ' + waveWrites + ', Music wave ' + musicWrites + ', paused ' + pausedWrites);
    console.log('ambient music: ' + checks + ' checks, ' + fails + ' failed');
    process.exit(fails ? 1 : 0);
})();
