'use strict';
// Copiloto de voz off the car: the event engine on a clock of its own, which phrase for the welcome, and the
// speaker's SOME/IP sequence against a stand-in Audio Manager and media player.
//   node tools/test_copiloto_voz.js
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');

const APP = path.join(__dirname, '..', 'apps', 'copiloto_voz');
// the app requires './tz' (shared/, copied next to it by the build)
const load = Module._load;
Module._load = function (req, parent, isMain) {
    if (req === './tz') return load.call(this, path.join(__dirname, '..', 'shared', 'tz.js'), parent, isMain);
    return load.call(this, req, parent, isMain);
};
const { Engine } = require(path.join(APP, 'engine'));
const { phraseFor } = require(path.join(APP, 'phrases'));
const { Speaker } = require(path.join(APP, 'speaker'));

let checks = 0, fails = 0;
const ok = (cond, msg) => { checks++; if (!cond) { fails++; console.log('FAIL ' + msg); } };

function rig(enabled) {
    const r = { t: 0, said: [] };
    r.e = new Engine({ now: () => r.t, say: (ev) => r.said.push(ev), enabled: enabled || (() => true) });
    r.at = (min) => { while (r.t < min * 60000) { r.t = Math.min(min * 60000, r.t + 5000); r.e.tick(); } };
    return r;
}
const MIN = 60000;

// 1. getting in: the door welcomes once; starting the car does not welcome again
let r = rig();
r.e.condition(5);
r.e.doors(['conductor']);
r.e.doors([]);
r.e.doors(['conductor']);
r.e.condition(7); r.e.condition(8); r.e.condition(10);
ok(r.said.join() === 'bienvenida', 'one welcome on getting in, got ' + r.said);

// 2. low fuel while driving, once; not again just under the limit
r.at(20);
r.e.fuel(30, 60); r.e.fuel(6, 50); r.e.fuel(6, 49);
ok(r.said.filter((x) => x === 'combustible').length === 1, 'low fuel said once, got ' + r.said);

// 3. switching off after the trip: the end; the door to get out is not a welcome
r.at(45);
r.e.condition(12); r.e.condition(5);
r.e.doors(['conductor']); r.e.doors([]);
ok(r.said.slice(-1)[0] === 'fin_viaje' && r.said.filter((x) => x === 'bienvenida').length === 1, 'trip end, no welcome getting out, got ' + r.said);

// 4. a while later someone gets in again: welcomed
r.at(65);
r.e.doors(['acompañante']);
ok(r.said.slice(-1)[0] === 'bienvenida', 'welcome after a while, got ' + r.said);

// 5. the car left and locked (3): the welcome is ready at once
r = rig();
r.e.condition(5); r.e.doors(['conductor']); r.e.doors([]); r.e.condition(10); r.at(10); r.e.condition(12); r.e.condition(3); r.e.condition(5);
r.e.doors(['conductor']);
ok(r.said.join() === 'bienvenida,fin_viaje,bienvenida', 'locked and back: welcomed, got ' + r.said);

// 6. a refuel (more litres than the lowest seen) and the low fuel warning ready again
r = rig();
r.e.condition(10); r.e.fuel(12, 45);
r.e.condition(5); r.e.fuel(12, 45); r.e.fuel(52, 700);
ok(r.said.indexOf('repostado') >= 0 && r.e.state().fuelArmed, 'refuel said and fuel warning armed, got ' + r.said);
// ... and kept across a restart of the head unit (memo / restore)
const memo = r.e.memo();
const r2 = rig(); r2.e.restore({ minLitres: 9, fuelArmed: false }); r2.e.fuel(50, 650);
ok(r2.said.join() === 'repostado' && memo.minLitres === 52, 'refuel seen after a restart, got ' + r2.said);

// 7. ice: not in the first minute, then once a trip
r = rig();
r.e.condition(10); r.e.outside(1.5);
ok(r.said.indexOf('hielo') < 0, 'no ice warning in the first minute');
r.at(2); r.e.outside(1); r.at(5);
ok(r.said.filter((x) => x === 'hielo').length === 1, 'ice once, got ' + r.said);

// 8. a break after 2 h of driving, again at 4 h; a long stop starts again
r = rig();
r.e.condition(10); r.at(119);
ok(r.said.indexOf('descanso') < 0, 'no break before 2 h');
r.at(121); r.at(241);
ok(r.said.filter((x) => x === 'descanso').length === 2, 'break at 2 h and 4 h, got ' + r.said);
r.e.condition(5); r.at(270); r.e.condition(10); r.at(300);
ok(r.said.filter((x) => x === 'descanso').length === 2, 'a 29 min stop starts the count again, got ' + r.said);

// 9. the app starting while the car is already drive-ready (a restart on the road): no welcome
r = rig();
r.e.condition(10); r.e.doors(['conductor']);
ok(r.said.length === 0, 'no welcome on a restart on the road, got ' + r.said);

// 10. an event switched off in the settings is not said
r = rig((ev) => ev !== 'bienvenida');
r.e.condition(5); r.e.doors(['conductor']);
ok(r.said.length === 0, 'welcome off in the settings');

// 11. a short move (under a minute) says no trip end
r = rig();
r.e.condition(5); r.e.doors(['conductor']); r.e.condition(10); r.t += 30000; r.e.condition(12);
ok(r.said.join() === 'bienvenida', 'no trip end for 30 s, got ' + r.said);

// 12. the welcome by the time of day (Central Europe: 08:00 local = 07:00 UTC in winter)
const settings = { get: (k) => (k === 'timeZone' ? 10012 : undefined) };
const have = (names) => ({ file: (n) => (names.indexOf(n) >= 0 ? '/x/' + n + '.m4a' : null) });
const jan = Date.UTC(2026, 0, 15);
ok(phraseFor('bienvenida', settings, have(['bienvenida_manana']), jan + 7 * 3600000) === 'bienvenida_manana', 'morning welcome');
ok(phraseFor('bienvenida', settings, have(['bienvenida_manana']), jan + 19 * 3600000) === 'bienvenida', 'evening, no evening recording: the plain one');
ok(phraseFor('bienvenida', settings, have(['bienvenida_noche']), jan + 21 * 3600000) === 'bienvenida_noche', 'night welcome');
ok(phraseFor('fin_viaje', settings, have([]), jan) === 'fin_viaje', 'other events: their own name');

// 13. the speaker: connect, play, wait for the end, stop, disconnect, and the radio back
(async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cv-'));
    const voces = path.join(dir, 'voces'); fs.mkdirSync(voces);
    fs.writeFileSync(path.join(voces, 'fin_viaje.m4a'), 'x');
    const calls = [];
    let conns = [{ mainConnectionID: 7, sourceID: 300, sinkID: 1024 }], handlers = {};
    const signals = {
        hasNative: () => true,
        proxy: (iface) => Promise.resolve({ iface }),
        on: (p, name, fn) => { handlers[name] = fn; return Promise.resolve(); },
        get: () => Promise.resolve(conns.slice()),
        call: (p, m, args) => {
            calls.push(m + (args && args.sourceID ? ' ' + args.sourceID : ''));
            if (m === 'connect') {
                if (args.sourceID === 1046) conns = [{ mainConnectionID: 9, sourceID: 1046, sinkID: 1024 }];
                else conns.push({ mainConnectionID: 10, sourceID: args.sourceID, sinkID: 1024 });
                return Promise.resolve({ mainConnectionID: args.sourceID === 1046 ? 9 : 10, amError: 'E_OK' });
            }
            if (m === 'disconnect') { conns = conns.filter((c) => c.mainConnectionID !== args.mainConnectionID); return Promise.resolve({ amError: 'E_OK' }); }
            if (m === 'playFile') {
                setTimeout(() => { handlers.playerState('PLAYER_STATE_PLAY'); handlers.currentItemTime({ elapsed: 900, total: 1000 }); }, 20);
                return Promise.resolve({ EntError: 'OK' });
            }
            return Promise.resolve({ EntError: 'OK' });
        },
    };
    const log = { info: () => {}, warn: (m) => console.log('  log: ' + m) };
    const sp = new Speaker({ signals, log, dataDir: dir, dirs: [voces] });
    await sp.say('fin_viaje');
    ok(calls.join(',') === 'connect 1046,playFile,sendButtonEvent,disconnect,connect 300', 'speaker sequence, got ' + calls);
    ok(sp.status() === 'última: fin_viaje', 'speaker status, got ' + sp.status());
    // a phrase not recorded: nothing called, the page says so
    calls.length = 0;
    await sp.say('hielo');
    ok(calls.length === 0 && /falta la grabación hielo/.test(sp.status()), 'missing recording, got ' + sp.status());
    // RideTube playing (the same source): it does not talk over it
    conns = [{ mainConnectionID: 3, sourceID: 1046, sinkID: 1024 }];
    calls.length = 0;
    await sp.say('fin_viaje');
    ok(calls.length === 0 && /RideTube/.test(sp.status()), 'source in use, got ' + sp.status());
    console.log('copiloto_voz: ' + checks + ' checks, ' + fails + ' failed');
    process.exit(fails ? 1 : 0);
})().catch((e) => { console.log('FAIL ' + (e && e.stack || e)); process.exit(1); });
