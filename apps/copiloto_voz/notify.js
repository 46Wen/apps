'use strict';
/**
 * notify.js - Copiloto de voz: optional, a copy of the chosen fuel station on the iPhone through ntfy (https://ntfy.sh,
 * the free ntfy app), with its Waze link. Off by default: the station is chosen and offered in the car (fuel.js and the
 * iDrive pop-up). Through net.js (the Store's uplink). Node 8.
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { return null; } };
const wazeLink = (s) => 'https://waze.com/ul?ll=' + s.lat + ',' + s.lon + '&navigate=yes';

class Notifier {
    constructor(opts) {
        this.net = opts.net;
        this.log = opts.log;
        this.lastError = null;
        this.lastSent = null;
        const file = path.join(opts.dataDir, 'ntfy.json');
        const saved = readJson(file);
        if (saved && /^[a-z0-9-]{12,64}$/.test(saved.topic || '')) this.topic = saved.topic;
        else {
            // a topic nobody can guess: on ntfy.sh, whoever knows the name can read it
            this.topic = 'bmw-' + crypto.randomBytes(9).toString('hex');
            try { fs.writeFileSync(file, JSON.stringify({ topic: this.topic }) + '\n'); } catch (e) { this.log.warn('ntfy: ' + e); }
        }
    }

    online() { return this.net.online(); }

    send(msg) {
        return this.net.request('POST', 'ntfy.sh', '/', JSON.stringify(Object.assign({ topic: this.topic }, msg))).then((r) => {
            if (r.status < 200 || r.status >= 300) throw new Error('ntfy respondió ' + r.status);
            this.lastSent = { title: msg.title, at: Date.now() };
            this.lastError = null;
            this.log.info('ntfy: sent "' + msg.title + '"');
            return true;
        }).catch((e) => {
            this.lastError = 'aviso no enviado: ' + String(e && e.message || e).slice(0, 100);
            this.log.warn('ntfy: ' + this.lastError);
            return false;
        });
    }

    /** The chosen station (fuel.js pick) on the iPhone, with its Waze link. */
    station(p) {
        const url = wazeLink(p.station);
        return this.send({ title: 'Gasolinera: ' + p.name, message: p.line, click: url,
            actions: [{ action: 'view', label: 'Ir con Waze', url: url, clear: true }], tags: ['fuelpump'], priority: 4 });
    }
}

module.exports = { Notifier, wazeLink };
