'use strict';
// Copiloto de voz off the car: the notices (engine.js) on a clock of their own, the queue (announcer.js: priority, one
// at a time, calls, stale ones), what the signals mean (decode.js), the welcome by the time of day, the link to the
// shell-diesel page, and the speaker's SOME/IP sequence against a stand-in Audio Manager and media player.
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
const { Engine, EVENTS, PRIORITY, KEEP } = require(path.join(APP, 'engine'));
const { Announcer, KEEP_MS } = require(path.join(APP, 'announcer'));
const { phraseFor } = require(path.join(APP, 'phrases'));
const { Speaker } = require(path.join(APP, 'speaker'));
const F = require(path.join(APP, 'fuel'));
const { wazeLink } = require(path.join(APP, 'notify'));
const D = require(path.join(APP, 'decode'));

let checks = 0, fails = 0;
const ok = (cond, msg) => { checks++; if (!cond) { fails++; console.log('FAIL ' + msg); } };
const MIN = 60000;

function rig(enabled, cfg) {
    const r = { t: 0, said: [] };
    r.e = new Engine({ now: () => r.t, say: (ev) => r.said.push(ev), enabled: enabled || (() => true), cfg: cfg });
    r.at = (min) => { while (r.t < min * MIN) { r.t = Math.min(min * MIN, r.t + 5000); r.e.tick(); } };
    r.start = () => { r.e.condition(5); r.e.condition(7); r.e.condition(8); r.e.condition(10); };
    r.stop = () => { r.e.condition(12); r.e.condition(5); };
    return r;
}
const count = (r, ev) => r.said.filter((x) => x === ev).length;

// ---------- the notices ----------
// welcome at the engine start, not at a door, not when the app starts on the road, not on a quick restart
let r = rig();
r.e.condition(5); r.e.openings([]);
ok(r.said.length === 0, 'nothing before the engine starts');
r.e.condition(7); r.e.condition(8); r.e.condition(10);
ok(r.said.join() === 'bienvenida', 'welcome at the start, got ' + r.said);
r.at(20); r.stop(); r.t += MIN; r.start();
ok(count(r, 'bienvenida') === 1, 'no welcome on a restart within 3 min, got ' + r.said);
r.at(40); r.stop(); r.at(60); r.start();
ok(count(r, 'bienvenida') === 2, 'welcome again later, got ' + r.said);
r = rig(); r.e.condition(10);
ok(r.said.length === 0, 'no welcome when the app starts on the road');

// end of the trip, and the windows left open
r = rig(); r.start(); r.at(10); r.e.openings(['ventanilla del conductor']); r.stop();
ok(r.said.join() === 'bienvenida,ventanillas,fin_viaje', 'windows and end at the switch-off, got ' + r.said);
r = rig(); r.start(); r.at(10); r.stop(); r.t += 5000; r.e.openings(['techo']);
ok(r.said.join() === 'bienvenida,fin_viaje,ventanillas', 'a window reported just after the switch-off, got ' + r.said);
r = rig(); r.start(); r.t += 30000; r.stop();
ok(r.said.join() === 'bienvenida', 'no end for a 30 s move, got ' + r.said);

// fuel: once, again only after a refuel (kept across a restart of the head unit)
r = rig(); r.start(); r.e.fuel(30, 400); r.e.fuel(6, 50); r.e.fuel(6, 45);
ok(count(r, 'combustible') === 1, 'fuel once, got ' + r.said);
r.stop(); r.e.fuel(50, 700); r.start(); r.e.fuel(6, 40);
ok(count(r, 'combustible') === 2, 'fuel again after a refuel, got ' + r.said);
const r2 = rig(); r2.e.restore({ minLitres: 6, fuelArmed: false }); r2.start(); r2.e.fuel(6, 40);
ok(count(r2, 'combustible') === 0, 'no repeat after a restart without refuel');
r2.e.fuel(52, 700); r2.e.fuel(52, 45);
ok(count(r2, 'combustible') === 1, 'refuel seen after a restart, got ' + r2.said);

// ice: not in the first minute, then once a trip
r = rig(); r.start(); r.e.outside(1.5);
ok(count(r, 'hielo') === 0, 'no ice in the first minute');
r.at(2); r.e.outside(1); r.at(5);
ok(count(r, 'hielo') === 1, 'ice once, got ' + r.said);

// cold engine over 2,500 rpm, once; warm at 80 °C on a trip that started cold, once
r = rig(); r.e.engine(800, 25); r.start(); r.e.engine(2400, 40);
ok(count(r, 'motor_frio') === 0, 'no cold warning at 2,400 rpm');
r.e.engine(2700, 45); r.e.engine(3000, 50);
ok(count(r, 'motor_frio') === 1, 'cold warning once, got ' + r.said);
r.e.engine(2000, 79); r.e.engine(2000, 80); r.e.engine(2000, 82);
ok(count(r, 'motor_caliente') === 1, 'warm once, got ' + r.said);
r = rig(); r.e.engine(800, 90); r.start(); r.e.engine(3000, 91);
ok(count(r, 'motor_frio') + count(r, 'motor_caliente') === 0, 'a warm start: neither, got ' + r.said);

// battery: under 11.8 V with the engine off, said at the start; a charging voltage is not counted
r = rig(); r.e.condition(7); r.e.battery(11.6); r.e.condition(8); r.e.condition(10);
ok(r.said.join() === 'bienvenida,bateria', 'low battery at the start, got ' + r.said);
r = rig(); r.e.condition(7); r.e.battery(12.4); r.e.condition(10);
ok(count(r, 'bateria') === 0, 'a good battery: nothing');

// tyres: BMW's warning, once a trip (also when it was already on at the start)
r = rig(); r.e.tyreWarning(true); r.start(); r.e.tyreWarning(true);
ok(count(r, 'neumaticos') === 1, 'tyres once, got ' + r.said);

// service: within 2,000 km or 60 days, at most once a week
const svc = [{ name: 'aceite', km: 1500, days: 200, colour: 'GREEN' }];
r = rig(); r.e.service(svc); r.start();
ok(count(r, 'mantenimiento') === 1, 'service due: said at the start, got ' + r.said);
r.at(30); r.stop(); r.at(60); r.start();
ok(count(r, 'mantenimiento') === 1, 'not again the same week');
r.t += 7 * 24 * 60 * MIN; r.stop(); r.t += 10 * MIN; r.start();
ok(count(r, 'mantenimiento') === 2, 'again a week later, got ' + count(r, 'mantenimiento'));
r = rig(); r.e.service([{ name: 'frenos', km: 9000, days: 300, colour: 'GREEN' }]); r.start();
ok(count(r, 'mantenimiento') === 0, 'nothing due: nothing');

// a break after 2 h, again at 4 h; a long stop starts the count again
r = rig(); r.start(); r.at(119);
ok(count(r, 'descanso') === 0, 'no break before 2 h');
r.at(121); r.at(241);
ok(count(r, 'descanso') === 2, 'break at 2 h and 4 h, got ' + count(r, 'descanso'));

// an event switched off is not said
r = rig((ev) => ev !== 'bienvenida'); r.start();
ok(r.said.length === 0, 'welcome off in the settings');

// ---------- the queue ----------
(async () => {
    const tick = () => new Promise((res) => setImmediate(res));
    const q = { t: 0, said: [], call: false, release: null };
    const an = new Announcer({ priority: PRIORITY, keep: KEEP, now: () => q.t, inCall: () => q.call,
        speak: (ev) => new Promise((res) => { q.said.push(ev); q.release = res; }) });
    // two at once: the higher priority first, never together
    an.add('motor_caliente'); await tick(); an.add('bienvenida');
    ok(q.said.join() === 'motor_caliente', 'the first one starts at once (nothing playing)');
    an.add('combustible'); an.add('bienvenida');
    await tick();
    ok(q.said.length === 1, 'one voice at a time');
    q.release(); await tick(); await tick();
    ok(q.said.join() === 'motor_caliente,combustible', 'then the highest priority waiting, got ' + q.said);
    q.release(); await tick(); await tick();
    q.release(); await tick(); await tick();
    ok(q.said.join() === 'motor_caliente,combustible,bienvenida' && an.state().waiting.length === 0, 'the same one waiting twice is said once, got ' + q.said);
    // during a call: nothing; after it, what waited (stale ones dropped, fuel kept)
    q.call = true; q.said = [];
    an.add('descanso'); an.add('combustible');
    ok(q.said.length === 0, 'nothing during a call');
    q.t += KEEP_MS + 1000; q.call = false; an.pump(); await tick();
    ok(q.said.join() === 'combustible' && an.state().waiting.length === 0, 'after the call: fuel said, the stale break dropped, got ' + q.said);
    q.release(); await tick();
    ok(EVENTS.length === 11 && PRIORITY.combustible === 1 && PRIORITY.motor_caliente === 11, 'eleven notices, fuel first, warm engine last');

    // ---------- what the signals mean ----------
    ok(D.oilOf({ temperatureEngineOilDrive: 128 }) === 80 && D.oilOf({ temperatureEngineOilDrive: 255 }) === null, 'oil temperature');
    ok(D.rpmOf({ actualValueRPMEngineCrankshaft: 10000 }) === 2500, 'rpm');
    ok(D.callOf('ACTIVE') === 2 && D.callOf({ aggregatedCallState: 0 }) === 0 && D.callOf('x') === null, 'call state');
    ok(D.voltsOf([0x62, 0xF4, 0x42, 0x2E, 0x18]) === 11.8 && D.voltsOf([0x41, 0x42, 0x30, 0xD4]) === 12.5 && D.voltsOf([0x7F, 0x22, 0x31]) === null, 'battery voltage replies');
    ok(D.kmOf('12.000 km') === 12000 && D.kmOf('1,500 mi') === 2414 && D.kmOf('-200 km') === -200 && D.kmOf('') === null, 'service distances');
    const now = Date.UTC(2026, 10, 24);
    ok(D.daysOf('01/2027', now) === 38 && D.daysOf('15.12.2026', now) === 21 && D.daysOf('x', now) === null, 'service dates');
    const items = D.serviceOf({ cbsDataServiceList: [{ cBSIdentifier: 1, cBSServcieName: 'Motoröl', cBSServiceWay: '1.800 km', cBSServiceDate: '05/2027', cBSColor: 'GREEN' }] }, now);
    ok(items.length === 1 && items[0].name === 'aceite' && items[0].km === 1800 && items[0].colour === 'GREEN', 'service list, got ' + JSON.stringify(items));
    ok(D.activeCc({ basicList: [{ ccmId: 141, activeState: 'AKTIV' }, { ccmId: 50, activeState: 'INAKTIV' }] }).join() === '141', 'active Check Control');
    ok(D.ccNames({ ccList: [{ cCIdentifer: 141, cCShortName: 'Presión de neumáticos baja' }] })[0][1] === 'Presión de neumáticos baja', 'Check Control names');
    ok(D.isTyreCc('Presión de neumáticos baja') && D.isTyreCc('Reifendruck niedrig') && D.isTyreCc('Low tyre pressure') && !D.isTyreCc('Aceite del motor'), 'tyre messages in Spanish, German, English');
    ok(D.openingsOf({ statusDoorSwitchDRD: 1, statusWindowDR: 'FENSTER_OFFEN', statusSunroof: 'GESCHLOSSEN', positionWindowPSR: 12 }).join() === 'ventanilla del conductor,ventanilla trasera', 'windows open, doors not counted, got ' + D.openingsOf({ statusDoorSwitchDRD: 1, statusWindowDR: 'FENSTER_OFFEN', statusSunroof: 'GESCHLOSSEN', positionWindowPSR: 12 }));

    // ---------- the welcome by the time of day; the page link ----------
    const settings = { get: (k) => (k === 'timeZone' ? 10012 : undefined) };
    const have = (names) => ({ file: (n) => (names.indexOf(n) >= 0 ? '/x/' + n + '.m4a' : null) });
    const jan = Date.UTC(2026, 0, 15);
    ok(phraseFor('bienvenida', settings, have(['bienvenida_manana']), jan + 7 * 3600000) === 'bienvenida_manana', 'morning welcome');
    ok(phraseFor('bienvenida', settings, have(['bienvenida_manana']), jan + 19 * 3600000) === 'bienvenida', 'no evening recording: the plain one');
    ok(phraseFor('motor_frio', settings, have([]), jan) === 'motor_frio', 'other notices: their own name');
    ok(wazeLink({ lat: 40.1, lon: -3.2 }) === 'https://waze.com/ul?ll=40.1,-3.2&navigate=yes', 'waze link');

    // ---------- where the car is ----------
    ok(JSON.stringify(D.navPositionOf({ coordinatesValid: true, latitude: 40.4, longitude: -3.7 })) === '{"lat":40.4,"lon":-3.7}' && D.navPositionOf({ coordinatesValid: false, latitude: 40.4, longitude: -3.7 }) === null, 'navigation position');
    const raw = (deg) => Math.round((deg * 3600 + 2147483.648) * 1000);
    const g = D.gnssPositionOf({ statusGPSLatitudeCAN: raw(40.4168), statusGPSLongitudeCAN: raw(-3.7038) });
    ok(g && Math.abs(g.lat - 40.4168) < 1e-5 && Math.abs(g.lon + 3.7038) < 1e-5 && D.gnssPositionOf({ statusGPSLatitudeCAN: 4294967295, statusGPSLongitudeCAN: 1 }) === null, 'GPS position, got ' + JSON.stringify(g));

    // ---------- the fuel station: shell-diesel's algorithm in the car ----------
    ok(F.parseHours('L-D: 24H') && F.hoursAt(F.parseHours('L-D: 24H'), 3, 600).always, '24 h');
    const iv = F.parseHours('L-V: 07:00-22:00; S-D: 08:00-14:00');
    ok(F.hoursAt(iv, 2, 8 * 60).open && !F.hoursAt(iv, 0, 15 * 60).open && F.parseHours('L: 08:00-20:00') === null, 'opening hours');
    ok(F.openOnArrival({ h: 'L-D: 07:00-22:00' }, 2, 21 * 60 + 50, 15) === 2 && F.openOnArrival({ h: 'L-D: 07:00-22:00' }, 2, 6 * 60 + 50, 15) === 0, 'open on arrival');
    ok(F.nice('AVENIDA DE AMERICA, 25') === 'Avenida de America, 25' && F.nice('LEGANÉS') === 'Leganés', 'names, got ' + F.nice('AVENIDA DE AMERICA, 25'));
    const lt = F.localTime(Date.UTC(2026, 10, 24, 22, 30), 60);
    ok(lt.weekday === 2 && lt.minute === 23 * 60 + 30, 'local time, got ' + JSON.stringify(lt));
    const st = (id, ga, h) => ({ id: id, n: 'SHELL', a: 'CALLE ' + id, mun: 'PUEBLO ' + id, lat: 40, lon: -3, ga: ga, gp: ga + 0.1, h: h || 'L-D: 24H' });
    const o = { fuel: 'ga', litresLeft: 9, tank: 59, l100: 6, rangeKm: 50, weekday: 2, minute: 600 };
    // the cheapest within half the range wins, even with a dearer one nearer; one further than half the range is left out
    let c = F.choose([st('a', 1.60), st('b', 1.50), st('c', 1.40)], [{ m: 2000, s: 180 }, { m: 12000, s: 900 }, { m: 40000, s: 2400 }], o);
    ok(c.pick.s.id === 'b', 'cheapest within half the range, got ' + (c.pick && c.pick.s.id));
    // a closed one is not picked
    c = F.choose([st('a', 1.60), st('b', 1.50, 'L-D: 20:00-21:00')], [{ m: 2000, s: 180 }, { m: 3000, s: 240 }], o);
    ok(c.pick.s.id === 'a', 'not a closed one, got ' + c.pick.s.id);
    // none within half the range: the nearest open one
    c = F.choose([st('a', 1.40), st('b', 1.30)], [{ m: 30000, s: 1800 }, { m: 60000, s: 3600 }], o);
    ok(c.pick.s.id === 'a' && /más cercana/.test(c.why), 'none that close: the nearest, got ' + c.pick.s.id + ' ' + c.why);
    // the cost: fill (59 - 9 = 50 L) + the drive (12 km at 6 L/100 km)
    c = F.choose([st('b', 1.50)], [{ m: 12000, s: 900 }], o);
    ok(Math.abs(c.pick.total - (50 * 1.5 + 12 * 6 / 100 * 1.5)) < 1e-9, 'cost = fill + drive, got ' + c.pick.total);
    // find(): the prices from shell-diesel, the drive from OSRM, as the car does it (a stand-in network)
    const prices = { fecha: '24/11/2026', updated: Date.now() / 1000, stations: [
        Object.assign(st('near', 1.70), { lat: 40.42, lon: -3.70 }), Object.assign(st('cheap', 1.55), { lat: 40.33, lon: -3.76 }),
        Object.assign(st('far', 1.40), { lat: 41.6, lon: -0.9 }), Object.assign(st('express', 0), { lat: 40.41, lon: -3.70 })] };
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cvf-'));
    const asked = [];
    const fakeNet = { online: () => true, getJson: (host, p) => { asked.push(host); return Promise.resolve(host === 'router.project-osrm.org'
        ? { code: 'Ok', distances: [[0, 1500, 14000]], durations: [[0, 180, 1000]] } : prices); } };
    const ff = new F.FuelFinder({ net: fakeNet, log: { info: () => {}, warn: () => {} }, dataDir: tmp });
    ff.data = Object.assign({}, prices, { updated: 0 });
    const res = await ff.find({ lat: 40.4168, lon: -3.7038, fuel: 'ga', litresLeft: 8, rangeKm: 50, tank: 59, l100: 6.2, radiusKm: 25, offsetMin: 60 });
    ok(res.pick.station.id === 'cheap' && res.how === 'por carretera' && asked.join() === 'raw.githubusercontent.com,router.project-osrm.org', 'find: the cheapest by road, got ' + res.pick.station.id + ' ' + asked);
    ok(/^Shell Pueblo Cheap$/.test(res.pick.name) && /€\/L/.test(res.pick.line) && fs.existsSync(path.join(tmp, 'shell.json')), 'find: name, line, prices kept, got ' + res.pick.name + ' | ' + res.pick.line);
    // without internet: the last prices and the straight line
    const ff2 = new F.FuelFinder({ net: { online: () => false }, log: { info: () => {}, warn: () => {} }, dataDir: tmp });
    const res2 = await ff2.find({ lat: 40.4168, lon: -3.7038, fuel: 'ga', litresLeft: 8, rangeKm: 50, tank: 59, l100: 6.2, radiusKm: 25, offsetMin: 60 });
    ok(res2.how === 'línea recta' && res2.pick, 'find offline: straight line, got ' + res2.how);

    // ---------- the speaker: connect, play, wait for the end, stop, disconnect, the radio back ----------
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
    const log = { info: () => {}, warn: () => {} };
    const sp = new Speaker({ signals, log, dataDir: dir, dirs: [voces] });
    await sp.say('fin_viaje');
    ok(calls.join(',') === 'connect 1046,playFile,sendButtonEvent,disconnect,connect 300', 'speaker sequence, got ' + calls);
    ok(sp.status() === 'última: fin_viaje', 'speaker status, got ' + sp.status());
    calls.length = 0;
    await sp.say('hielo');
    ok(calls.length === 0 && /falta la grabación hielo/.test(sp.status()), 'missing recording, got ' + sp.status());
    conns = [{ mainConnectionID: 3, sourceID: 1046, sinkID: 1024 }];
    calls.length = 0;
    await sp.say('fin_viaje');
    ok(calls.length === 0 && /RideTube/.test(sp.status()), 'source in use, got ' + sp.status());

    console.log('copiloto_voz: ' + checks + ' checks, ' + fails + ' failed');
    process.exit(fails ? 1 : 0);
})().catch((e) => { console.log('FAIL ' + (e && e.stack || e)); process.exit(1); });
