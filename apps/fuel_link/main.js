'use strict';
/**
 * Fuel Link: the fuel left and the range, as JSON, for your own phone over your tailnet. Read-only: it only listens to
 * the cluster's fuel and range (KombiIF statusRangeTankStatus, the same signal Cluster Themes reads) and never writes
 * anything to the car.
 *
 *   GET http://127.0.0.1:8473/fuel  ->  { litres, rangeKm, l100km, at }
 *
 * It listens on the head unit's loopback only, so nothing on the car's Wi-Fi reaches it; "tailscale serve" (run once
 * as root) publishes it to the tailnet at https://<name>.<tailnet>.ts.net/fuel. l100km is litres over range: BMW works
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
            ctx.ui.cells('ROW_LINK', 0, { Text2ndCol: (serving ? 'on, port ' + port : 'off') + (t ? ', ' + t : '') });
        };
        let serving = false, saved = 0;

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

        const server = http.createServer((req, res) => {
            const head = { 'Access-Control-Allow-Origin': origin, 'Vary': 'Origin', 'Cache-Control': 'no-store' };
            if (req.method === 'OPTIONS') {
                res.writeHead(204, Object.assign(head, { 'Access-Control-Allow-Methods': 'GET', 'Access-Control-Allow-Private-Network': 'true' }));
                return res.end();
            }
            if (req.method !== 'GET' || req.url.split('?')[0] !== '/fuel') { res.writeHead(404, head); return res.end(); }
            res.writeHead(200, Object.assign(head, { 'Content-Type': 'application/json' }));
            res.end(JSON.stringify(Object.assign({}, last, { now: Date.now() })));
        });
        server.on('error', (e) => { serving = false; ctx.log.error('cannot listen on 127.0.0.1:' + port + ': ' + e.message); show(); });
        server.listen(port, '127.0.0.1', () => { serving = true; ctx.log.info('fuel at http://127.0.0.1:' + port + '/fuel'); show(); });
        show();
    },
});
