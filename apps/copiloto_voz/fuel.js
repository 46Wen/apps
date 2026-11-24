'use strict';
/**
 * fuel.js - Copiloto de voz: the best Shell to fill up at, chosen in the car with the algorithm of 46Wen/shell-diesel
 * (index.html CORE, its car mode), so the car and the page agree:
 *   - prices: the Spanish Ministry of Industry's open data (Geoportal de Gasolineras), the Shells only (no Shell
 *     Express), as shell-diesel's hourly job keeps them: data/shell.json of 46Wen/shell-diesel. The last copy is kept
 *     in the data folder and used without internet (with its date);
 *   - candidates: within the radius (straight line) around the car, the cheapest 45 of the fuel;
 *   - the drive to each: OSRM's table (real road km and minutes); without internet, the straight line x 1.3 at 50 km/h;
 *   - the cost: litres to fill (tank - litres left) x price + the fuel the drive uses (km x l/100 km x price);
 *   - the pick: open on arrival (the station's hours, the car's local time) and at most half the range away by road,
 *     the lowest cost; none that close: the nearest open one, to get there.
 * Pure functions (tested in tools/test_copiloto_voz.js) and find(), which fetches through net.js. Node 8.
 */
const fs = require('fs');
const path = require('path');

const DATA = { host: 'raw.githubusercontent.com', path: '/46Wen/shell-diesel/main/data/shell.json' };
const OSRM = 'router.project-osrm.org';
const MAX_CANDS = 45;
const ROAD_FACTOR = 1.3, ROAD_KMH = 50;     // without OSRM: a road is about 1.3 x the straight line, at 50 km/h

const R = 6371;
const rad = (d) => d * Math.PI / 180;
/** km between two points (haversine). */
function km(a, b) {
    const dLat = rad(b.lat - a.lat), dLon = rad(b.lon - a.lon);
    const h = Math.pow(Math.sin(dLat / 2), 2) + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.pow(Math.sin(dLon / 2), 2);
    return 2 * R * Math.asin(Math.sqrt(h));
}
/** The stations within radiusKm of p that have the fuel, the cheapest max of them. */
function nearPoint(stations, p, fuel, radiusKm, max) {
    const near = stations.filter((s) => s[fuel] > 0 && km(p, s) <= radiusKm);
    near.sort((a, b) => a[fuel] - b[fuel]);
    return near.slice(0, max);
}

// ---- opening hours: "L-S: 08:00-19:00; D: 09:00-18:00", "L-V: 09:00-13:00 y 15:00-18:00", "L-D: 24H" (shell-diesel) ----
const DAY = { L: 1, M: 2, X: 3, J: 4, V: 5, S: 6, D: 0 };
function parseHours(text) {
    const t = String(text || '').toUpperCase().trim();
    if (!t) return null;
    const out = [], days = {};
    const segs = t.split(';');
    for (let i = 0; i < segs.length; i++) {
        const m = segs[i].match(/^\s*([LMXJVSD](?:\s*[-,Y]\s*[LMXJVSD])*)\s*:\s*(.+)$/);
        if (!m) return null;
        const list = [];
        m[1].replace(/\s/g, '').split(/[,Y]/).forEach((part) => {
            const r = part.split('-');
            if (r.length === 1) list.push(DAY[r[0]]);
            else { let d = DAY[r[0]]; const e = DAY[r[1]]; for (let n = 0; n < 7; n++) { list.push(d); if (d === e) break; d = (d + 1) % 7; } }
        });
        const times = [];
        if (/24\s*H/.test(m[2])) times.push([0, 1440]);
        m[2].replace(/(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})/g, (x, h1, m1, h2, m2) => {
            const a = +h1 * 60 + +m1; let b = +h2 * 60 + +m2;
            if (b === 1439) b = 1440;
            if (b <= a) b += 1440;
            times.push([a, b]);
            return x;
        });
        if (!times.length) return null;
        list.forEach((d) => {
            days[d] = true;
            const base = ((d + 6) % 7) * 1440;
            times.forEach((tm) => out.push([base + tm[0], base + tm[1]]));
        });
    }
    const dk = Object.keys(days);
    if (dk.length === 1 && dk[0] === '1') return null;   // "L: ..." only: not filled in
    return out.length ? out : null;
}
/** Open or not at weekday (0 Sunday) / minute: { open, always, mins } or null (hours unknown). */
function hoursAt(intervals, weekday, minute) {
    if (!intervals) return null;
    const W = 7 * 1440, now = ((weekday + 6) % 7) * 1440 + minute;
    const all = [];
    [-W, 0, W].forEach((o) => intervals.forEach((iv) => all.push([iv[0] + o, iv[1] + o])));
    all.sort((x, y) => x[0] - y[0]);
    const merged = [];
    all.forEach((iv) => { const l = merged[merged.length - 1]; if (l && iv[0] <= l[1]) l[1] = Math.max(l[1], iv[1]); else merged.push([iv[0], iv[1]]); });
    const cur = merged.filter((iv) => iv[0] <= now && now < iv[1])[0];
    if (cur) return cur[1] - cur[0] >= 2 * W ? { open: true, always: true, mins: Infinity } : { open: true, always: false, mins: cur[1] - now };
    const next = merged.filter((iv) => iv[0] > now)[0];
    return { open: false, always: false, mins: next ? next[0] - now : Infinity };
}
/** Open when you get there (arriveMin from now): 0 yes, 1 unknown, 2 no. */
function openOnArrival(s, weekday, minute, arriveMin) {
    const h = hoursAt(parseHours(s.h), weekday, minute);
    if (!h) return 1;
    if (h.always) return 0;
    if (h.open) return h.mins > arriveMin ? 0 : 2;
    return h.mins <= arriveMin ? 0 : 2;
}

/** "AVENIDA DE AMERICA, 25" -> "Avenida de America, 25" (Node 8: no \p{L}). */
function nice(t) {
    return String(t || '').toLowerCase().replace(/(^|[\s,.(\/-])([a-záéíóúñüç])/g, (m, a, b) => a + b.toUpperCase())
        .replace(/ (De|Del|La|Las|Los|El|Y)(?= )/g, (m, w) => ' ' + w.toLowerCase());
}

/**
 * The pick from the candidates and their drive ([{ m, s }] metres / seconds from the car, one per candidate, null: no
 * route): o = { fuel, litresLeft, tank, l100, rangeKm, weekday, minute }. -> { rows (by cost), pick, why } (pick null:
 * none open).
 */
function choose(cands, drives, o) {
    const litres = Math.max(0, o.tank - (o.litresLeft || 0));
    const rows = [];
    cands.forEach((s, i) => {
        const d = drives[i], price = s[o.fuel];
        if (!(price > 0) || !d || d.m === null || d.s === null || d.m === undefined) return;
        const fill = litres * price, driveCost = d.m / 1000 * o.l100 / 100 * price;
        rows.push({ s: s, price: price, litres: litres, fill: fill, driveCost: driveCost, total: fill + driveCost, km: d.m / 1000, min: d.s / 60,
            open: openOnArrival(s, o.weekday, o.minute, Math.round(d.s / 60)) });
    });
    rows.sort((a, b) => a.total - b.total || a.km - b.km);
    const maxKm = o.rangeKm > 0 ? o.rangeKm / 2 : Infinity;
    const open = rows.filter((r) => r.open === 0);
    let pick = open.filter((r) => r.km <= maxKm)[0], why = 'la más barata (llenar + trayecto) a menos de ' + (isFinite(maxKm) ? Math.round(maxKm) + ' km' : 'su radio');
    if (!pick) {
        pick = open.concat(rows.filter((r) => r.open === 1)).sort((a, b) => a.km - b.km)[0] || null;
        why = 'ninguna barata a menos de la mitad de su autonomía: la más cercana abierta';
    }
    return { rows: rows, pick: pick, why: why };
}

/** The car's local weekday and minute (the head unit runs on UTC; offsetMin from the "timeZone" setting). */
function localTime(now, offsetMin) {
    const d = new Date(now + (offsetMin || 0) * 60000);
    return { weekday: d.getUTCDay(), minute: d.getUTCHours() * 60 + d.getUTCMinutes() };
}

class FuelFinder {
    constructor(opts) {
        this.net = opts.net;
        this.log = opts.log;
        this.file = path.join(opts.dataDir, 'shell.json');
        this.data = null;
        try { this.data = JSON.parse(fs.readFileSync(this.file, 'utf8')); } catch (e) { /* none yet */ }
    }

    /** The prices: fresh when online (at most hourly), else the last copy. */
    prices() {
        const age = this.data && this.data.updated ? Date.now() / 1000 - this.data.updated : Infinity;
        if (age < 3600 || !this.net.online()) return Promise.resolve(this.data);
        return this.net.getJson(DATA.host, DATA.path).then((d) => {
            if (!d || !Array.isArray(d.stations) || !d.stations.length) throw new Error('precios vacíos');
            this.data = d;
            try { fs.writeFileSync(this.file, JSON.stringify(d)); } catch (e) { this.log.warn('fuel: cannot keep the prices: ' + e.message); }
            return d;
        }).catch((e) => { this.log.warn('fuel: prices: ' + e.message + (this.data ? ' (the last copy is used)' : '')); return this.data; });
    }

    /** The drive to each candidate: OSRM's table, else the straight line. -> { drives, how } */
    drives(from, cands) {
        const line = () => cands.map((c) => { const k = km(from, c) * ROAD_FACTOR; return { m: k * 1000, s: k / ROAD_KMH * 3600 }; });
        if (!this.net.online()) return Promise.resolve({ drives: line(), how: 'línea recta' });
        const pts = [from].concat(cands).map((p) => p.lon.toFixed(5) + ',' + p.lat.toFixed(5)).join(';');
        return this.net.getJson(OSRM, '/table/v1/driving/' + pts + '?sources=0&annotations=duration,distance').then((t) => {
            if (!t || t.code !== 'Ok') throw new Error('OSRM ' + (t && t.code));
            return { drives: cands.map((c, i) => ({ m: t.distances[0][i + 1], s: t.durations[0][i + 1] })), how: 'por carretera' };
        }).catch((e) => { this.log.warn('fuel: routes: ' + e.message + ' (straight line)'); return { drives: line(), how: 'línea recta' }; });
    }

    /**
     * The best Shell from where the car is: o = { lat, lon, fuel, litresLeft, rangeKm, tank, l100, radiusKm, offsetMin }.
     * -> { pick: { station, name, address, price, km, min, total, why, line }, count, how, pricesDate } or throws.
     */
    find(o) {
        return this.prices().then((d) => {
            if (!d) throw new Error('sin precios: hace falta internet la primera vez');
            const from = { lat: o.lat, lon: o.lon };
            const cands = nearPoint(d.stations, from, o.fuel, o.radiusKm, MAX_CANDS);
            if (!cands.length) throw new Error('ninguna Shell a menos de ' + o.radiusKm + ' km');
            return this.drives(from, cands).then((r) => {
                const t = localTime(Date.now(), o.offsetMin);
                const c = choose(cands, r.drives, { fuel: o.fuel, litresLeft: o.litresLeft, tank: o.tank, l100: o.l100, rangeKm: o.rangeKm, weekday: t.weekday, minute: t.minute });
                if (!c.pick) throw new Error('ninguna Shell abierta cuando llegue');
                const p = c.pick, s = p.s;
                const name = 'Shell ' + nice(s.mun || s.loc);
                const address = [nice(s.a), [s.cp, nice(s.mun || s.loc)].filter(Boolean).join(' ')].filter(Boolean).join(', ');
                const dec = (v, n) => v.toFixed(n).replace('.', ',');
                const line = dec(p.price, 3) + ' €/L · ' + dec(p.km, 1) + ' km · ' + Math.round(p.min) + ' min · total ' + dec(p.total, 2) + ' €';
                return { pick: { station: s, name: name, address: address, price: p.price, km: p.km, min: p.min, total: p.total, why: c.why, line: line },
                    count: c.rows.length, how: r.how, pricesDate: d.fecha || '' };
            });
        });
    }
}

module.exports = { FuelFinder, km, nearPoint, parseHours, hoursAt, openOnArrival, choose, localTime, nice };
