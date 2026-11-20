'use strict';
/**
 * Fuel Link: the fuel left and the range, as JSON, for your own phone over your tailnet. Read-only: it only listens to
 * the cluster's fuel and range (KombiIF statusRangeTankStatus, the same signal Cluster Themes reads) and never writes
 * anything to the car.
 *
 *   GET /fuel         ->  { litres, rangeKm, l100km, at, now }
 *   GET /go?to=<url>  ->  302 to <url>#car=<litres>,<l100km>,<at>,<now>   (<url> must start with config.allowOrigin)
 *
 * It listens on the head unit's loopback and on its tailnet address (100.64.0.0/10, looked for every 30 s until the
 * tailnet is up), never on the car's Wi-Fi or hotspot. A tailnet without "tailscale serve" reaches it over plain http,
 * which an https page cannot fetch; /go hands the reading to the page through a redirect instead. l100km is litres over range: BMW works
 * the range out from the recent consumption, so this is the consumption it uses. The last reading is kept in the
 * data folder, so the page gets one right after a restart, with its time.
 */
const fs = require('fs');
const http = require('http');
const path = require('path');
const mgu = require('./kit/mgu');

mgu.run({
    async start(ctx) {
        const cfg = ctx.spec.config || {};
        const port = cfg.port || 8473, origin = cfg.allowOrigin || '*';
        const memo = path.join(ctx.dataDir, 'last.json');
        let last = { litres: null, rangeKm: null, l100km: null, at: null };
        try { last = Object.assign(last, JSON.parse(fs.readFileSync(memo, 'utf8'))); } catch (e) { /* first run */ }

        const show = () => {
            const t = last.at ? new Date(last.at).toISOString().slice(11, 16) + ' UTC' : '';
            ctx.ui.cells('ROW_FUEL', 0, { Text2ndCol: last.litres != null ? last.litres + ' L' : '--' });
            ctx.ui.cells('ROW_RANGE', 0, { Text2ndCol: last.rangeKm != null ? last.rangeKm + ' km' : '--' });
            ctx.ui.cells('ROW_CONS', 0, { Text2ndCol: last.l100km != null ? last.l100km.toFixed(1) + ' L/100km' : '--' });
            ctx.ui.cells('ROW_LINK', 0, { Text2ndCol: (serving ? (tailnet ? tailnet + ':' + port : 'on, port ' + port + ', no tailnet yet') : 'off') + (t ? ', ' + t : '') });
        };
        let serving = false, saved = 0, tailnet = null;

        // the cluster's fuel and range: litres (255: none) and km (4095: none)
        await ctx.signals.watch('de.bmw.infotainment.KombiIF', '1', {
            statusRangeTankStatus: (v) => {
                const f = v && v.fluidLevelFuelTank, r = v && v.range;
                const litres = typeof f === 'number' && f >= 0 && f < 255 ? f : null;
                const rangeKm = typeof r === 'number' && r >= 0 && r < 4095 ? r : null;
                if (litres == null) return;
                last = { litres, rangeKm, l100km: rangeKm > 20 ? Math.round(litres / rangeKm * 1000) / 10 : null, at: Date.now() };
                // kept at most once a minute: the signal comes often while driving
                if (Date.now() - saved > 60000) {
                    saved = Date.now();
                    try { fs.writeFileSync(memo, JSON.stringify(last)); } catch (e) { ctx.log.warn('cannot save ' + memo + ': ' + e.message); }
                }
                show();
            },
        }, ctx.log);

        const handler = (req, res) => {
            const head = { 'Access-Control-Allow-Origin': origin, 'Vary': 'Origin', 'Cache-Control': 'no-store' };
            if (req.method === 'OPTIONS') {
                res.writeHead(204, Object.assign(head, { 'Access-Control-Allow-Methods': 'GET', 'Access-Control-Allow-Private-Network': 'true' }));
                return res.end();
            }
            const p = req.url.split('?')[0];
            if (req.method === 'GET' && p === '/go') {
                // back to the page with the reading in the URL's hash; only to the allowed page, never anywhere else
                let to = '';
                try { to = decodeURIComponent((req.url.split('?')[1] || '').replace(/^.*?\bto=([^&]*).*$/, '$1')); } catch (e) { to = ''; }
                if (origin === '*' || to.indexOf(origin + '/') !== 0) { res.writeHead(400, head); return res.end('to must be a page of ' + origin); }
                const v = [last.litres, last.l100km, last.at, Date.now()].map((x) => (x == null ? '' : x)).join(',');
                res.writeHead(302, Object.assign(head, { Location: to.split('#')[0] + '#car=' + v }));
                return res.end();
            }
            if (req.method !== 'GET' || p !== '/fuel') { res.writeHead(404, head); return res.end(); }
            res.writeHead(200, Object.assign(head, { 'Content-Type': 'application/json' }));
            res.end(JSON.stringify(Object.assign({}, last, { now: Date.now() })));
        };

        // loopback always; the tailnet address once it is up (CGNAT 100.64.0.0/10, the range Tailscale gives out)
        const os = require('os'), bound = {};
        const listen = (host) => {
            if (bound[host]) return;
            bound[host] = true;
            const srv = http.createServer(handler);
            srv.on('error', (e) => { delete bound[host]; ctx.log.error('cannot listen on ' + host + ':' + port + ': ' + e.message); if (host === '127.0.0.1') { serving = false; show(); } });
            srv.listen(port, host, () => {
                ctx.log.info('fuel at http://' + host + ':' + port + '/fuel');
                if (host === '127.0.0.1') serving = true; else tailnet = host;
                show();
            });
        };
        const tailnetAddr = () => {
            const all = os.networkInterfaces();
            for (const name of Object.keys(all)) {
                for (const a of all[name] || []) {
                    if (a.family !== 'IPv4' && a.family !== 4) continue;
                    const o = a.address.split('.').map(Number);
                    if (o[0] === 100 && o[1] >= 64 && o[1] <= 127) return a.address;
                }
            }
            return null;
        };
        listen('127.0.0.1');
        const look = () => { try { const a = tailnetAddr(); if (a) listen(a); } catch (e) { ctx.log.warn('tailnet address: ' + e.message); } };
        look();
        setInterval(look, 30000);
        show();
    },
});
