'use strict';
/**
 * logring.js - the app log's last lines in memory, for the page's Log tab (Cluster Themes).
 *
 * The kit writes every line to <data>/<id>.log (rotated at 256 KiB), which on the car can only be read over SSH and
 * the USB stick is mounted read-only. attach() wraps the log object once (info / warn / error) so each line is also
 * kept here, and first reads the end of the log file, so the lines from just before the app (re)started are there
 * too (marked as earlier: the black box that went away only with a restart left its reason in them).
 *
 * Cheap: an array of at most MAX entries, no timers, no file writes of its own; the page reads it only while open.
 * Plain Node 8 (the car's 8.16.2).
 */
const fs = require('fs');

const MAX = 600;                 // lines kept
const TAIL_BYTES = 48 * 1024;    // how much of the log file is read at start
const LINE_MAX = 600;            // characters kept of one line

/** One log line as kept: { at (ms), level: 'info' | 'warn' | 'error', msg, earlier (from the file, before this run) }. */
function parseFileLine(s) {
    const m = /^(\d{4}-\d\d-\d\dT[\d:.]+Z) (INFO|WARN|ERROR|FATAL|DEBUG) (.*)$/.exec(s);
    if (!m) return null;
    const lv = m[2] === 'WARN' ? 'warn' : m[2] === 'INFO' || m[2] === 'DEBUG' ? 'info' : 'error';
    return { at: Date.parse(m[1]) || 0, level: lv, msg: m[3].slice(0, LINE_MAX), earlier: true };
}

/** The last lines of a log file (and of its rotated .1 when the file is short), oldest first; [] when missing. */
function readTail(file) {
    const out = [];
    const take = (f, bytes) => {
        let fd = null;
        try {
            fd = fs.openSync(f, 'r');
            const size = fs.fstatSync(fd).size, n = Math.min(size, bytes);
            if (!n) return 0;
            const buf = Buffer.alloc(n);
            fs.readSync(fd, buf, 0, n, size - n);
            const lines = buf.toString('utf8').split('\n');
            if (size > n) lines.shift();          // cut in the middle
            const got = lines.map(parseFileLine).filter(Boolean);
            out.unshift.apply(out, got);
            return n;
        } catch (e) { return 0; } finally { if (fd !== null) try { fs.closeSync(fd); } catch (e) { /* closed */ } }
    };
    const n = take(file, TAIL_BYTES);
    if (n < TAIL_BYTES / 2) take(file + '.1', TAIL_BYTES - n);
    return out.slice(-MAX);
}

/**
 * Keep `log`'s lines (once per log object; a second call returns the same ring). file: the kit's log file, read
 * once for the lines from before. Returns { lines (array, oldest first), seq (grows with every line), mark(text) }.
 */
function attach(log, file) {
    if (log.__ring) return log.__ring;
    const ring = { lines: file ? readTail(file) : [], seq: 0, startedAt: Date.now() };
    if (ring.lines.length) ring.lines.push({ at: Date.now(), level: 'info', msg: '---- app started (lines above are from before) ----', earlier: false, sep: true });
    ['info', 'warn', 'error'].forEach((level) => {
        const orig = log[level];
        if (typeof orig !== 'function') return;
        log[level] = function () {
            try {
                const msg = Array.prototype.slice.call(arguments).map((x) => (x && x.stack) || (typeof x === 'object' ? JSON.stringify(x) : String(x))).join(' ');
                ring.lines.push({ at: Date.now(), level, msg: msg.slice(0, LINE_MAX), earlier: false });
                if (ring.lines.length > MAX) ring.lines.splice(0, ring.lines.length - MAX);
                ring.seq++;
            } catch (e) { /* the log itself must never throw */ }
            return orig.apply(log, arguments);
        };
    });
    Object.defineProperty(log, '__ring', { value: ring, enumerable: false });
    return ring;
}

/**
 * Which filter a line belongs to (the Log tab's chips): 'waze' (the map inside the theme), 'mode' (drive mode, theme
 * picked, shown or hidden), else 'other'. Problems (warn / error) show under every filter's "problems" chip too.
 */
function kind(l) {
    const m = l.msg;
    if (/^\[waze#|^waze[: ]|map host|map window|cluster-render: the map|hosts from layers/.test(m)) return 'waze';
    if (/^drive mode|^theme |^"[^"]*" (ready|shown)|^off: |no drive mode|^\[adaptive\]|^\[mode\]/.test(m)) return 'mode';
    if (/^\[slots\]/.test(m)) return 'slots';
    return 'other';
}

module.exports = { attach, kind, parseFileLine, readTail, MAX };
