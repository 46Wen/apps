'use strict';
/**
 * net.js - Copiloto de voz: HTTPS through the MGU Store's mgu-uplink (app.json "mguInternet": true). The head unit's
 * own resolver does not reach the internet, so each host is looked up with the DNS servers of this app's uplink lease
 * (<data>/uplink.json, which mgu-uplink writes while online, else /run/mgu-uplink/lease.json); only the hosts in HOSTS,
 * on port 443, at a public address, with the certificate checked against the host's name. Node 8.
 *
 *   const net = new Net(dataDir);
 *   net.online()                                  -> bool (a lease with DNS servers)
 *   net.request('GET', host, path, body?, type?)  -> Promise<{ status, body: Buffer }>
 */
const dns = require('dns');
const fs = require('fs');
const https = require('https');
const netmod = require('net');
const path = require('path');

const HOSTS = ['ntfy.sh', 'raw.githubusercontent.com', 'router.project-osrm.org'];
const TIMEOUT_MS = 12000;
const MAX_BODY = 2 * 1024 * 1024;

const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { return null; } };

function publicIpv4(ip) {
    if (netmod.isIP(ip) !== 4) return false;
    const n = ip.split('.').map(Number), a = n[0], b = n[1];
    if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
    if (a === 100 && b >= 64 && b <= 127) return false;
    if (a === 169 && b === 254) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && b === 168) return false;
    return true;
}

class Net {
    constructor(dataDir) { this.dataDir = dataDir; this.cache = {}; }

    lease() { return readJson(path.join(this.dataDir, 'uplink.json')) || readJson('/run/mgu-uplink/lease.json'); }
    online() { const l = this.lease(); return !!(l && Array.isArray(l.dns) && l.dns.length); }

    resolve(host) {
        const c = this.cache[host];
        if (c && Date.now() - c.at < 5 * 60000) return Promise.resolve(c.ip);
        const l = this.lease();
        const servers = l && Array.isArray(l.dns) ? l.dns.filter((ip) => netmod.isIP(ip)).slice(0, 4) : [];
        if (!servers.length) return Promise.reject(new Error('sin internet (MGU Store > Wi-Fi)'));
        return new Promise((resolve, reject) => {
            const r = new dns.Resolver();
            r.setServers(servers);
            const timer = setTimeout(() => reject(new Error('DNS sin respuesta')), TIMEOUT_MS);
            r.resolve4(host, (err, ips) => {
                clearTimeout(timer);
                const ip = !err && Array.isArray(ips) ? ips.filter(publicIpv4)[0] : null;
                if (!ip) return reject(new Error('DNS: ' + (err ? err.code || err.message : 'sin dirección pública')));
                this.cache[host] = { ip: ip, at: Date.now() };
                resolve(ip);
            });
        });
    }

    request(method, host, p, body, type) {
        if (HOSTS.indexOf(host) < 0) return Promise.reject(new Error(host + ' no está permitido'));
        const data = body === undefined || body === null ? null : Buffer.isBuffer(body) ? body : Buffer.from(String(body));
        return this.resolve(host).then((ip) => new Promise((resolve, reject) => {
            const headers = { Host: host, 'User-Agent': 'copiloto-voz (BMW iDrive 7)', Accept: '*/*' };
            if (data) { headers['Content-Type'] = type || 'application/json'; headers['Content-Length'] = data.length; }
            const req = https.request({ host: ip, servername: host, port: 443, method: method, path: p, agent: false, headers: headers }, (res) => {
                const parts = []; let size = 0;
                res.on('data', (d) => { size += d.length; if (size > MAX_BODY) { req.abort(); reject(new Error('respuesta demasiado grande')); } else parts.push(d); });
                res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(parts) }));
                res.on('error', reject);
            });
            req.setTimeout(TIMEOUT_MS, () => { req.abort(); reject(new Error(host + ': sin respuesta')); });
            req.on('error', reject);
            req.end(data || undefined);
        }));
    }

    getJson(host, p) {
        return this.request('GET', host, p).then((r) => {
            if (r.status < 200 || r.status >= 300) throw new Error(host + ' respondió ' + r.status);
            return JSON.parse(r.body.toString('utf8'));
        });
    }
}

module.exports = { Net, HOSTS };
