'use strict';
/**
 * navcat.js - Copiloto de voz: what the car's navigation offers apps, read once from the head unit's interface catalog
 * (/etc/oap/someip/someip-interfaces.json, the file the Store's installer checks apps against), to find out whether an
 * app can give BMW's navigation a destination (the "Ir" of the fuel pop-up). Nobody has done that yet; this only READS
 * the catalog and writes what it found to <data>/navegador.json and the log: every interface about navigation,
 * destinations, routes or places, with its methods and their arguments, and its instances. Once per app version, a few
 * minutes after the start (the catalog is a few MB of JSON). Node 8.
 */
const fs = require('fs');
const path = require('path');

const CATALOG = '/etc/oap/someip/someip-interfaces.json';
const NAME_RE = /navigation|destination|guidance|route|addressbook|\bpoi\b|positioning|map/i;

/** The navigation part of a catalog object: { interface: { serviceId, version, instances, methods: { name: args } } }. */
function navPart(db) {
    const ifs = (db && db.interfaces) || {}, inst = (db && db.instanceIDs) || {};
    const out = {};
    Object.keys(ifs).filter((n) => NAME_RE.test(n)).forEach((n) => {
        const it = ifs[n] || {};
        const methods = {};
        const ms = it.methods || {};
        Object.keys(ms).forEach((m) => {
            const x = ms[m] || {};
            const args = x.inArgs || x.in || x.arguments || x.schema || x.params || null;
            methods[m] = args ? JSON.stringify(args).slice(0, 400) : '';
        });
        out[n] = { serviceId: it.serviceId, version: it.version, instances: inst[n] || null, methods: methods };
    });
    return out;
}

/** Read the catalog (once for this version) and keep its navigation part. -> Promise<summary text|null> */
function explore(dataDir, version, log) {
    const out = path.join(dataDir, 'navegador.json');
    try { const old = JSON.parse(fs.readFileSync(out, 'utf8')); if (old && old.version === version) return Promise.resolve(null); } catch (e) { /* not yet */ }
    return new Promise((resolve) => {
        fs.readFile(CATALOG, 'utf8', (err, text) => {
            if (err) { log.warn('navegador: catalog not readable: ' + err.code); return resolve(null); }
            let part;
            try { part = navPart(JSON.parse(text)); } catch (e) { log.warn('navegador: catalog: ' + e.message); return resolve(null); }
            text = null;
            try { fs.writeFileSync(out, JSON.stringify({ version: version, at: new Date().toISOString(), interfaces: part }, null, 1)); } catch (e) { log.warn('navegador: ' + e.message); }
            const lines = Object.keys(part).map((n) => n + ' [' + Object.keys(part[n].methods).join(', ') + ']');
            lines.forEach((l) => log.info('navegador: ' + l.slice(0, 600)));
            resolve(Object.keys(part).length + ' servicios de navegación leídos (navegador.json)');
        });
    });
}

module.exports = { navPart, explore, CATALOG };
