'use strict';
/**
 * notify.js - Copiloto de voz: a notification on the driver's iPhone through ntfy (https://ntfy.sh, the free ntfy app
 * from the App Store), with a link that opens Waze searching for the fuel station nearest to where the phone is.
 * Tapped with CarPlay connected, Waze opens on the car's screen.
 *
 * The internet comes through the MGU Store's mgu-uplink (app.json "mguInternet": true). The head unit's own resolver
 * does not reach the internet, so ntfy.sh is looked up with the DNS servers of this app's uplink lease
 * (<data>/uplink.json, which mgu-uplink writes while it is online, else /run/mgu-uplink/lease.json), and only ntfy.sh,
 * on port 443, at a public address, with its certificate checked against its name. Node 8.
 */
const crypto = require('crypto');
const dns = require('dns');
const fs = require('fs');
const https = require('https');
const net = require('net');
const path = require('path');

const HOST = 'ntfy.sh';
const TIMEOUT_MS = 10000;

const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { return null; } };

function publicIpv4(ip) {
    if (net.isIP(ip) !== 4) return false;
    const n = ip.split('.').map(Number), a = n[0], b = n[1];
    if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
    if (a === 100 && b >= 64 && b <= 127) return false;
    if (a === 169 && b === 254) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && b === 168) return false;
    return true;
}

/** The Waze link: search for `what` near the phone and drive there. */
function wazeLink(what) {
    return 'https://waze.com/ul?q=' + encodeURIComponent(what) + '&navigate=yes';
}

class Notifier {
    constructor(opts) {
        this.dataDir = opts.dataDir;
        this.log = opts.log;
        this.lastError = null;
        this.lastSent = null;
        const file = path.join(this.dataDir, 'ntfy.json');
        const saved = readJson(file);
        if (saved && /^[a-z0-9-]{12,64}$/.test(saved.topic || '')) this.topic = saved.topic;
        else {
            // a topic nobody can guess: on ntfy.sh, whoever knows the name can read it
            this.topic = 'bmw-' + crypto.randomBytes(9).toString('hex');
            try { fs.writeFileSync(file, JSON.stringify({ topic: this.topic }) + '\n'); } catch (e) { this.log.warn('ntfy: ' + e); }
        }
    }

    lease() {
        return readJson(path.join(this.dataDir, 'uplink.json')) || readJson('/run/mgu-uplink/lease.json');
    }

    online() {
        const l = this.lease();
        return !!(l && Array.isArray(l.dns) && l.dns.length);
    }

    _resolve() {
        const l = this.lease();
        const servers = l && Array.isArray(l.dns) ? l.dns.filter((ip) => net.isIP(ip)).slice(0, 4) : [];
        if (!servers.length) return Promise.reject(new Error('sin internet (MGU Store > Wi-Fi / uplink)'));
        return new Promise((resolve, reject) => {
            const r = new dns.Resolver();
            r.setServers(servers);
            const timer = setTimeout(() => reject(new Error('DNS: no answer')), TIMEOUT_MS);
            r.resolve4(HOST, (err, ips) => {
                clearTimeout(timer);
                const ip = !err && Array.isArray(ips) ? ips.filter(publicIpv4)[0] : null;
                if (!ip) return reject(new Error('DNS: ' + (err ? err.code || err.message : 'no public address')));
                resolve(ip);
            });
        });
    }

    /** Publish {title, message, click, actions, tags, priority} to our topic; resolves true, or false (lastError). */
    send(msg) {
        const body = Buffer.from(JSON.stringify(Object.assign({ topic: this.topic }, msg)));
        return this._resolve().then((ip) => new Promise((resolve, reject) => {
            const req = https.request({ host: ip, servername: HOST, port: 443, method: 'POST', path: '/', agent: false,
                headers: { Host: HOST, 'Content-Type': 'application/json', 'Content-Length': body.length } }, (res) => {
                res.resume();
                if (res.statusCode >= 200 && res.statusCode < 300) resolve(true);
                else reject(new Error('ntfy answered ' + res.statusCode));
            });
            req.setTimeout(TIMEOUT_MS, () => req.abort());
            req.on('error', reject);
            req.end(body);
        })).then(() => {
            this.lastSent = { title: msg.title, at: Date.now() };
            this.lastError = null;
            this.log.info('ntfy: sent "' + msg.title + '"');
            return true;
        }, (e) => {
            this.lastError = 'aviso no enviado: ' + String(e && e.message || e).slice(0, 100);
            this.log.warn('ntfy: ' + this.lastError);
            return false;
        });
    }

    /** The fuel station notification: tap -> Waze, to the nearest `brand`. */
    fuel(brand, rangeKm) {
        const url = wazeLink(brand);
        return this.send({
            title: 'Falta de combustible',
            message: (typeof rangeKm === 'number' ? 'Autonomía: ' + rangeKm + ' km. ' : '') + 'Toca para ir con Waze a la ' + brand + ' más cercana.',
            click: url,
            actions: [{ action: 'view', label: 'Ir con Waze', url: url, clear: true }],
            tags: ['fuelpump'],
            priority: 4,
        });
    }
}

module.exports = { Notifier, wazeLink };
