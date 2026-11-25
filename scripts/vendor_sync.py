#!/usr/bin/env python3
"""Bring the apps in vendor/ and the native components in tools-prebuilt/ up to their origins.

    python3 scripts/vendor_sync.py            update what changed upstream, then check the repo
    python3 scripts/vendor_sync.py --check    only check the repo (as the MGU Store reads and builds it)

What comes from where is in vendor/sources.json. For each origin whose commit moved, the apps it lists
are replaced by the origin's, the kit and the other folders it lists likewise, the files under "drop" are
removed again and the "patch" for an app is applied again (Redline without the HUD). A native component
is updated when its author's release catalog has a newer version: the artifact is downloaded, checked
against the catalog's sha256 and unpacked as a repo-tree tool folder. Cluster Themes comes from
bimmer-lab/apps by a git merge (scripts/README.md), not from here.

Needs git, node and network to github.com. Exit status 0 when everything checks out; the summary
(what changed, what failed) is printed as JSON on the last line and written to <work>/summary.json.
"""
import hashlib
import json
import os
import shutil
import subprocess
import sys
import tarfile
import tempfile
import urllib.request

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
SOURCES = os.path.join(ROOT, 'vendor', 'sources.json')
IGNORE = shutil.ignore_patterns('dist', 'oap-sdk', '__pycache__', '*.log', '.git', 'node_modules', 'preview')


class PatchError(Exception):
    pass


def run(cmd, cwd=None, timeout=900):
    return subprocess.run(cmd, cwd=cwd, check=True, capture_output=True, text=True, timeout=timeout).stdout.strip()


def head_of(repo):
    return run(['git', 'ls-remote', 'https://github.com/' + repo, 'HEAD']).split()[0]


def clone(repo, into):
    if not os.path.isdir(into):
        run(['git', 'clone', '-q', '--depth', '1', 'https://github.com/' + repo, into])
    return into


def replace(src, dst):
    if os.path.isdir(dst):
        shutil.rmtree(dst)
    elif os.path.exists(dst):
        os.remove(dst)
    if os.path.isdir(src):
        shutil.copytree(src, dst, ignore=IGNORE)
    else:
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        shutil.copy2(src, dst)


def version_of(app_dir):
    for name in ('app.json', 'mgu-app.json'):
        p = os.path.join(app_dir, name)
        if os.path.exists(p):
            return json.load(open(p, encoding='utf-8')).get('version')
    return None


# ---------- patches: our changes to an origin's app, applied again after every update ----------

def redline_no_hud(app_dir):
    """Redline without the HUD output (this car has none). Fails (PatchError) when Redline's code moved
    so far that the edits no longer fit: then the old Redline is kept and the summary says so."""
    p = os.path.join(app_dir, 'main.js')
    s = open(p, encoding='utf-8').read()

    def rep(a, b):
        nonlocal s
        if s.count(a) != 1:
            raise PatchError('redline main.js: %r found %d times, expected once' % (a[:60], s.count(a)))
        s = s.replace(a, b)
    rep("const Sheet = require('./kit/sheet');",
        "const Sheet = require('./kit/sheet');\n// 46Wen: this car has no head-up display. The HUD output, its directions probe, its call watch and the\n"
        "// HUD looks page are left out; hud.js stays only for the shift cue and the helpers the screen shares.\nconst HUD = false;")
    rep("tyres.handlers(), torqueWatch, powerLog.handlers(), call.handlers()]",
        "tyres.handlers(), torqueWatch, powerLog.handlers()].concat(HUD ? [call.handlers()] : [])")
    rep("const call = Call.start({ log });", "const call = HUD ? Call.start({ log }) : null;")
    rep("G.frame(cv, t, ['Tach', 'Shift log', 'Learned', 'HUD looks'], page,",
        "G.frame(cv, t, ['Tach', 'Shift log', 'Learned'].concat(HUD ? ['HUD looks'] : []), page,")
    rep("        let nav = null;\n        try {", "        let nav = null;\n        if (HUD) try {")
    rep("        hud = Hud.start(ctx, {", "        if (HUD) hud = Hud.start(ctx, {")
    rep("        const PAGES = 4;", "        const PAGES = HUD ? 4 : 3;")
    # 46Wen: nothing of Redline's own runs while its screen is not shown (the launch timer was 10 looks a second
    # for as long as the app stayed up, which on this unit is until the next restart)
    rep("        const launchIdle = setInterval(() => { if (!car.data().demo) launch.idle(Date.now()); }, 100);\n"
        "        if (launchIdle.unref) launchIdle.unref();\n",
        "        // 46Wen: only while the screen is shown (the app stays up after it is left: nothing of it runs then)\n"
        "        whileShown(ui, 'MAIN', () => { if (!car.data().demo) launch.idle(Date.now()); }, 100);\n")
    rep("const HUD = false;", "const HUD = false;\n" + WHILE_SHOWN)
    open(p, 'w', encoding='utf-8', newline='\n').write(s)
    subprocess.run(['node', '--check', p], check=True)

    p = os.path.join(app_dir, 'app.json')
    a = json.load(open(p, encoding='utf-8'))
    for iface in ['de.bmw.infotainment.connectivity.telephony.ConnectivityAggregator',
                  'de.bmw.infotainment.navigation.guiding.Guidance',
                  'de.bmw.infotainment.navigation.guiding.GuidanceEventList',
                  'de.bmw.infotainment.navigation.projectedmodeguiding.ProjectedModeGuiding',
                  'de.bmw.infotainment.a4a.carplay.CarPlayManager',
                  'de.bmw.infotainment.sdi.aap.androidautoprojectedmanager.AndroidAutoProjectedManager']:
        a['signals'].pop(iface, None)
    a['description'] = a['description'].split('; HUD by')[0] + ' (46Wen: without the HUD output; idle when not shown)'
    mark_version(a, 1)
    keep = {'hudLead', 'hudTempUnit', 'hudTorqueUnit', 'hudPowerUnit', 'hudBoostUnit', 'hudFuelUnit', 'hudTyreUnit'}
    for st in a['settings']:
        if st['key'] == 'hud' or (st['key'].startswith('hud') and st['key'] not in keep):
            st['hidden'] = True
            if st['key'] == 'hud':
                st['default'] = 'off'
    open(p, 'w', encoding='utf-8', newline='\n').write(json.dumps(a, indent=2, ensure_ascii=False) + '\n')


# 46Wen: a timer that runs only while an app's screen is shown. OAP apps stay up after their screen is left (until
# the head unit restarts) and an app must not exit by itself (the car takes an exit for a crash: its data wiped, a
# second one uninstalls it), so "closed when left" is: nothing of its own runs once it is not shown.
WHILE_SHOWN = (
    "/** 46Wen: fn every ms while screen `name` is shown, nothing while it is not (the app stays up after it is left). */\n"
    "function whileShown(ui, name, fn, ms) {\n"
    "    let t = null;\n"
    "    const set = (on) => { if (on && !t) t = setInterval(fn, ms); else if (!on && t) { clearInterval(t); t = null; } };\n"
    "    ui.onVisible((n, on) => { if (n === name) set(on); });\n"
    "    try { set(ui.isVisible(name)); } catch (e) { set(true); }\n"
    "}")


def mark_version(a, rev):
    """x.y.z -> x.y.(z*100 + rev): newer than the original for the Store, older than the original's next one."""
    x, y, z = [int(n) for n in a['version'].split('.')]
    a['version'] = '%d.%d.%d' % (x, y, z * 100 + rev)


def draggy_idle_hidden(app_dir):
    """Draggy idle while its screen is not shown (46Wen): its 20-a-second run timer and its 5 s air pressure look
    only while shown. Fails (PatchError) when Draggy's code moved so far that the edits no longer fit."""
    p = os.path.join(app_dir, 'main.js')
    s = open(p, encoding='utf-8').read()

    def rep(a, b):
        nonlocal s
        if s.count(a) != 1:
            raise PatchError('draggy main.js: %r found %d times, expected once' % (a[:60], s.count(a)))
        s = s.replace(a, b)
    rep("const { Diag } = require('./kit/diag');", "const { Diag } = require('./kit/diag');\n" + WHILE_SHOWN)
    rep("        setInterval(() => { readBaro(); }, 5000);",
        "        // 46Wen: only while the screen is shown (the app stays up after it is left: nothing of it runs then)\n"
        "        whileShown(ctx.ui, 'MAIN', () => { readBaro(); }, 5000);")
    i = s.index("        // demo feed at 20 Hz; switching source starts a clean run\n\n        setInterval(() => {")
    j = s.index("        }, 50);\n", i)
    body = s[i:j]
    s = s[:i] + body.replace("        setInterval(() => {", "        whileShown(ctx.ui, 'MAIN', () => {", 1) + "        }, 50);\n" + s[j + len("        }, 50);\n"):]
    open(p, 'w', encoding='utf-8', newline='\n').write(s)
    subprocess.run(['node', '--check', p], check=True)
    p = os.path.join(app_dir, 'app.json')
    a = json.load(open(p, encoding='utf-8'))
    a['description'] = a['description'] + ' (46Wen: idle when not shown)'
    mark_version(a, 1)
    open(p, 'w', encoding='utf-8', newline='\n').write(json.dumps(a, indent=2, ensure_ascii=False) + '\n')


def ambient_music(app_dir):
    """Ambient config with the Music wave (46Wen): music.js from vendor/patches/ambient_config, a 'music' scene in
    scenes.js, its button on the Animations tab, the media state as an optional signal, and the version as
    x.y.(z*100 + PATCH_REV) so the Store sees it as newer than the original and older than the original's next one.
    Fails (PatchError) when Ambient config's code moved so far that the edits no longer fit."""
    PATCH_REV = 3
    shutil.copy2(os.path.join(ROOT, 'vendor', 'patches', 'ambient_config', 'music.js'), os.path.join(app_dir, 'music.js'))

    def edit(name, pairs):
        p = os.path.join(app_dir, name)
        s = open(p, encoding='utf-8').read()
        for a, b in pairs:
            if s.count(a) != 1:
                raise PatchError('ambient_config %s: %r found %d times, expected once' % (name, a[:60], s.count(a)))
            s = s.replace(a, b)
        open(p, 'w', encoding='utf-8', newline='\n').write(s)
        subprocess.run(['node', '--check', p], check=True)

    edit('scenes.js', [
        (" *   welcome    a sweep",
         " *   music      (46Wen, music.js) the Colour wave going with the music: rolling only while something plays, a new\n"
         " *              track's colours further round; with an audio level, louder = faster, a wider swing and brighter\n"
         " *   welcome    a sweep"),
        ("const KINDS = ['solid', 'breathing', 'rainbow', 'fade', 'wave'];",
         "const KINDS = ['solid', 'breathing', 'rainbow', 'fade', 'wave', 'music'];"),
        ("wave: 'Colour wave',", "wave: 'Colour wave', music: 'Music wave',"),
        ("/** What a light shows: the scene,",
         "/* 46Wen: the Music wave's music (music.js: clock(), level(), hueShift()); without it, a Colour wave. */\n"
         "let music = null;\n"
         "function setMusic(m) { music = m; }\n\n"
         "/** What a light shows: the scene,"),
        ("    case 'welcome': {",
         "    case 'music': {\n"
         "        // (46Wen) the Colour wave on the music's clock: still in a pause; a level widens the swing and brightens it,\n"
         "        // the brightness in steps of 5 so a level's small changes don't cost writes\n"
         "        const at = typeof light.bus === 'number' ? light.bus * 0.25 : light.y;\n"
         "        const lv = music ? music.level() : null, clock = music ? music.clock() : t;\n"
         "        const swing = lv == null ? 60 : 25 + 65 * lv, turn = music ? music.hueShift() : 0;\n"
         "        const h = hueOf(base.rgb) + turn + swing * Math.sin(2 * Math.PI * (clock / (5000 * k) - at));\n"
         "        const bright = lv == null ? base.bright : Math.max(5, Math.round(base.bright * (0.35 + 0.65 * lv) / 5) * 5);\n"
         "        return { rgb: hsv(((h % 360) + 360) % 360, 1, 1), bright };\n"
         "    }\n"
         "    case 'welcome': {"),
        ("module.exports = { KINDS, NAMES, lightAt, setDecor,", "module.exports = { KINDS, NAMES, lightAt, setDecor, setMusic,"),
    ])

    edit('main.js', [
        (" *   Animations     Solid, Breathing, Rainbow, Smooth fade, Colour wave, how fast,",
         " *   Animations     Solid, Breathing, Rainbow, Smooth fade, Colour wave, Music wave (46Wen: music.js), how fast,"),
        ("const S = require('./scenes');", "const S = require('./scenes');\nconst { Music } = require('./music');"),
        ("    S.setDecor(settings.get('decorWith'));\n",
         "    S.setDecor(settings.get('decorWith'));\n"
         "    // 46Wen: the Music wave's music (music.js), before the first scene goes on\n"
         "    const music = new Music({ log });\n"
         "    S.setMusic(music);\n"),
        ("    control.start();\n",
         "    control.start();\n"
         "    // (46Wen) the media state watched only while a Music wave is on (the driver's look or a driving mode's)\n"
         "    const musicOn = () => music.use(!!lights.scene && lights.scene.kind === 'music', signals);\n"
         "    lights.on('change', musicOn);\n"
         "    musicOn();\n"),
        ("    return { ambient, lights, control, active, others, strobe, checks, lookAgain:",
         "    return { ambient, lights, control, active, others, strobe, checks, music, lookAgain:"),
        ("const { ambient, lights, control, active, others, strobe, checks, lookAgain } = ctx.background",
         "const { ambient, lights, control, active, others, strobe, checks, music, lookAgain } = ctx.background"),
        ("['wave', 'Colour rolling from side to side']];",
         "['wave', 'Colour rolling from side to side'], ['music', music.label()]];"),
        ("const y = 92 + i * 66, on = isOn() && l.kind === k;", "const y = 92 + i * 58, on = isOn() && l.kind === k;"),
        ("G.button(cv, t, 44, y, 220, 50, S.NAMES[k],", "G.button(cv, t, 44, y, 220, 46, S.NAMES[k],"),
        ("cv.text(d, 284, y + 32, 20,", "cv.text(d, 284, y + 30, 20,"),
    ])

    p = os.path.join(app_dir, 'app.json')
    a = json.load(open(p, encoding='utf-8'))
    x, y, z = (int(n) for n in a['version'].split('.'))
    a['version'] = '%d.%d.%d' % (x, y, z * 100 + PATCH_REV)
    a['description'] = a['description'] + ' (46Wen: with a Music wave)'
    # the music's level, read from SmartXbar by the tool mgu-audio-level (installed with the app)
    a.setdefault('requires', {})['mgu-audio-level'] = '0.1.1'
    a['signals']['de.bmw.infotainment.hmi.hmimediastate.HmiMediaState'] = {
        '_instances': 'HMI_CID',
        '_optional': 'now playing: the Music wave rolls while something plays, new colours each track (46Wen)',
        'playerMetadata': 'rs',
        'trackProgress': 'rs',
    }
    open(p, 'w', encoding='utf-8', newline='\n').write(json.dumps(a, indent=2, ensure_ascii=False) + '\n')


def ridetube_on_demand(app_dir):
    """RideTube only while it is used (46Wen): ondemand.js from vendor/patches/jap_ridetube (the service started
    when the app is opened, "¿Sigues aquí?" after a minute without playing, stopped on No or no answer), and the
    downloads, auto-downloads and phone remote hidden (the owner uses none). yt-dlp's own updates stay. Goes with
    the tool patch ridetube_d_on_demand. Fails (PatchError) when RideTube's code moved too far."""
    shutil.copy2(os.path.join(ROOT, 'vendor', 'patches', 'jap_ridetube', 'ondemand.js'), os.path.join(app_dir, 'ondemand.js'))

    def edit(name, pairs):
        p = os.path.join(app_dir, name)
        s = open(p, encoding='utf-8').read()
        for a, b in pairs:
            if s.count(a) != 1:
                raise PatchError('jap_ridetube %s: %r found %d times, expected once' % (name, a[:60], s.count(a)))
            s = s.replace(a, b)
        open(p, 'w', encoding='utf-8', newline='\n').write(s)
        subprocess.run(['node', '--check', p], check=True)

    edit('main.js', [
        ("        ctx.loop('VIEW', 10, render);",
         "        // 46Wen: the service only while RideTube is used (ondemand.js)\n"
         "        const onDemand = require('./ondemand')({ ui, model, ctl, log });\n"
         "        ctx.loop('VIEW', 10, render);"),
        ("                drawVolume(cv);\n                last = cv;",
         "                onDemand.draw(cv, { mode, focus: focusKey, MID, W, H, C });\n                drawVolume(cv);\n                last = cv;"),
    ])
    edit('yt.js', [
        ("    can(cap) { return this.caps.indexOf(cap) >= 0; }",
         "    // 46Wen: no downloads and no phone remote (not used on this car): their pages and buttons stay hidden\n"
         "    can(cap) { return cap !== 'download' && cap !== 'remote' && this.caps.indexOf(cap) >= 0; }"),
    ])
    p = os.path.join(app_dir, 'app.json')
    a = json.load(open(p, encoding='utf-8'))
    for st in a.get('settings', []):
        if st['key'] == 'auto_download':
            st['hidden'] = True
            st['default'] = 0
    a['description'] = a['description'] + ' (46Wen: its service only while used; no downloads or phone remote)'
    # the tool as patched here (tools-prebuilt): its 'quit' and its path unit
    tc = json.load(open(os.path.join(ROOT, 'tools-prebuilt', 'jap-ridetube-d', 'component.json'), encoding='utf-8'))
    a.setdefault('requires', {})['jap-ridetube-d'] = tc['version']
    mark_version(a, 1)
    open(p, 'w', encoding='utf-8', newline='\n').write(json.dumps(a, indent=2, ensure_ascii=False) + '\n')


RIDETUBE_D_REV = 1


def ridetube_d_on_demand(tool_dir):
    """RideTube's service only while RideTube is used (46Wen): not started with the car but by the path unit
    jap-ridetube-d.path when the app writes /dev/shm/jap-ridetube-d.want; a 'quit' command (the app's "No" or no
    answer) and, as a safety net, 3 minutes with no app connected and nothing playing end it (SIGTERM to itself: the
    daemon's own clean stop); ExecStopPost removes the want file. Auto-downloads off. Fails (PatchError) when the
    daemon's code moved too far."""
    p = os.path.join(tool_dir, 'files', 'ytd.js')
    s = open(p, encoding='utf-8').read()

    def rep(a, b):
        nonlocal s
        if s.count(a) != 1:
            raise PatchError('jap-ridetube-d ytd.js: %r found %d times, expected once' % (a[:60], s.count(a)))
        s = s.replace(a, b)
    rep("    case 'stop': return this.stop('idle');",
        "    case 'stop': return this.stop('idle');\n"
        "    // 46Wen: the app's \"¿Sigues aquí?\" answered No (or not): the daemon's own clean stop, started again by the app\n"
        "    case 'quit': this.log('quit: asked by the app'); setTimeout(() => process.kill(process.pid, 'SIGTERM'), 200); return undefined;")
    rep("    this.timers.push(setInterval(() => this.guard(() => this.downloadTick()), this.opts.tickMs));",
        "    this.timers.push(setInterval(() => this.guard(() => this.downloadTick()), this.opts.tickMs));\n"
        "    // 46Wen: no app connected and nothing playing for 3 minutes: stop (the app starts it again when opened)\n"
        "    this.usedLast = Date.now();\n"
        "    this.timers.push(setInterval(() => this.guard(() => {\n"
        "        if (this.client || this.state === 'playing' || this.state === 'preparing') { this.usedLast = Date.now(); return; }\n"
        "        if (Date.now() - this.usedLast > 180000) { this.log('no app and nothing playing for 3 min: stopping'); process.kill(process.pid, 'SIGTERM'); }\n"
        "    }), 10000));")
    rep("Daemon.prototype.autoMax = function () {\n",
        "Daemon.prototype.autoMax = function () {\n    if (process.env.MGU_YT_AUTODL !== 'on') return 0;   // 46Wen: auto-downloads off\n")
    open(p, 'w', encoding='utf-8', newline='\n').write(s)
    subprocess.run(['node', '--check', p], check=True)

    u = os.path.join(tool_dir, 'units', 'jap-ridetube-d.service')
    s = open(u, encoding='utf-8').read()
    rep("ExecStopPost=-/bin/sh -c 'umount /run/jap-ridetube-media 2>/dev/null; rmdir /run/jap-ridetube-media 2>/dev/null; true'",
        "ExecStopPost=-/bin/sh -c 'umount /run/jap-ridetube-media 2>/dev/null; rmdir /run/jap-ridetube-media 2>/dev/null; true'\n"
        "# 46Wen: started by jap-ridetube-d.path while RideTube is used; the want file goes with it\n"
        "ExecStopPost=-/bin/rm -f /dev/shm/jap-ridetube-d.want")
    open(u, 'w', encoding='utf-8', newline='\n').write(s)
    open(os.path.join(tool_dir, 'units', 'jap-ridetube-d.path'), 'w', encoding='utf-8', newline='\n').write(
        "# 46Wen: RideTube's service only while RideTube is used: the app writes the want file when it is opened,\n"
        "# the service removes it when it stops (\"¿Sigues aquí?\" answered No, or no app for 3 minutes).\n"
        "[Unit]\nDescription=jap-ridetube-d on demand: started when the RideTube app is opened\n\n"
        "[Path]\nPathExists=/dev/shm/jap-ridetube-d.want\nUnit=jap-ridetube-d.service\n\n"
        "[Install]\nWantedBy=multi-user.target\n")
    p = os.path.join(tool_dir, 'component.json')
    c = json.load(open(p, encoding='utf-8'))
    if not any(x['name'] == 'jap-ridetube-d.path' for x in c['units']):
        c['units'].append({'name': 'jap-ridetube-d.path', 'from': 'units/jap-ridetube-d.path'})
    c['enable'] = [{'unit': 'jap-ridetube-d.path', 'target': 'multi-user.target'}]
    c['restart'] = ['jap-ridetube-d.path']
    c['description'] = c.get('description', '') + ' (46Wen: started only while the RideTube app is used)'
    x, y, z = [int(n) for n in c['version'].split('.')]
    c['version'] = '%d.%d.%d' % (x, y, z * 100 + RIDETUBE_D_REV)
    open(p, 'w', encoding='utf-8', newline='\n').write(json.dumps(c, indent=2, ensure_ascii=False) + '\n')


TOOL_PATCHES = {'jap-ridetube-d': ridetube_d_on_demand}


PATCHES = {'redline_no_hud': redline_no_hud, 'ambient_music': ambient_music, 'draggy_idle_hidden': draggy_idle_hidden, 'ridetube_on_demand': ridetube_on_demand}

PRIORITY_MARK = "require('./priority').lower(log, SPEC.config)"


def kit_low_priority(base):
    """Every app of an origin's kit below the car's own processes, CarPlay first (kit/runtime/priority.js, ours):
    the module is copied in and the kit's mgu.js calls it at start. Applied again after every kit update; nothing is
    done to an origin without kit/runtime/mgu.js. Fails (PatchError) when mgu.js no longer has the line it goes after."""
    mgu = os.path.join(base, 'kit', 'runtime', 'mgu.js')
    if not os.path.exists(mgu):
        return
    shutil.copy2(os.path.join(ROOT, 'kit', 'runtime', 'priority.js'), os.path.join(base, 'kit', 'runtime', 'priority.js'))
    s = open(mgu, encoding='utf-8').read()
    if PRIORITY_MARK in s:
        return
    a = "    const app = new OnlineApp();\n"
    if s.count(a) != 1:
        raise PatchError('kit mgu.js: %r found %d times, expected once' % (a.strip(), s.count(a)))
    s = s.replace(a, a + "    // 46Wen: below the car's own processes (CarPlay first): kit/runtime/priority.js, app.json config.nice\n"
                  "    try { " + PRIORITY_MARK + "; } catch (e) { log.warn('priority: ' + e); }\n")
    open(mgu, 'w', encoding='utf-8', newline='\n').write(s)
    subprocess.run(['node', '--check', mgu], check=True)


# ---------- native components ----------

def kit_to_folder(tgz, out):
    """An author's tool kit (component.json, files/, units/, dropins/) as a repo-tree tool folder."""
    keep = {}
    for extra in ('LICENSE',):
        p = os.path.join(out, extra)
        if os.path.exists(p):
            keep[extra] = open(p, 'rb').read()
    if os.path.isdir(out):
        shutil.rmtree(out)
    os.makedirs(out)
    with tarfile.open(tgz) as t:
        t.extractall(out, filter='data')
    m = json.load(open(os.path.join(out, 'component.json')))
    for f in m.get('files', []):
        f.pop('sha256', None)
        f['from'] = 'files/' + f['path']
    for u in m.get('units', []):
        u['from'] = 'units/' + u['name']
    for d in m.get('dropins', []):
        d['from'] = 'dropins/%s.d/%s' % (d['unit'], d['name'])
    open(os.path.join(out, 'component.json'), 'w').write(json.dumps(m, indent=2) + '\n')
    for name, data in keep.items():
        open(os.path.join(out, name), 'wb').write(data)
    return m


def vtuple(v):
    return tuple(int(x) for x in v.split('-')[0].split('.'))


# ---------- the check: the repo as the Store's updater reads it, every build from its shared files ----------

VALIDATE_JS = r"""
const fs = require('fs'), path = require('path');
const S = require(process.argv[2]);
const root = process.argv[3];
const readFile = (rel) => new Promise((res, rej) => fs.readFile(path.join(root, rel), (e, b) => e ? rej(Object.assign(e, { missing: e.code === 'ENOENT' })) : res(b)));
const listDir = (rel) => Promise.resolve(fs.readdirSync(path.join(root, rel), { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name));
const walk = (dir, base = '') => fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => d.isDirectory() ? walk(path.join(dir, d.name), base + d.name + '/') :
    [{ name: base + d.name, data: fs.readFileSync(path.join(dir, d.name)), mode: fs.statSync(path.join(dir, d.name)).mode }]);
S.repoCatalog(readFile, null, null, listDir, null).then((r) => {
    const out = { skipped: r.skipped, components: [], errors: [] };
    r.components.forEach((c) => {
        if (c.kind === 'tool' || c.script === null) {
            try { S.packComponent(c, walk(path.join(root, c.path))); } catch (e) { out.errors.push(c.id + ': ' + e.message); }
        }
        out.components.push({ id: c.id, kind: c.kind, version: c.version });
    });
    console.log(JSON.stringify(out));
}).catch((e) => { console.log(JSON.stringify({ errors: ['mgu-repo.json: ' + e.message] })); });
"""


def check(work):
    problems = []
    store = clone('robertnisipeanu/mgu-store', os.path.join(work, 'mgu-store'))
    tree = os.path.join(work, 'tree')
    if os.path.isdir(tree):
        shutil.rmtree(tree)
    run(['git', 'add', '-A'], cwd=ROOT)
    run(['git', 'checkout-index', '-a', '--prefix=' + tree + '/'], cwd=ROOT)
    js = os.path.join(work, 'validate.js')
    open(js, 'w').write(VALIDATE_JS)
    v = json.loads(run(['node', js, os.path.join(store, 'native/mgu-updater/js/sources.js'), tree]).splitlines()[-1])
    problems += ['skipped ' + s for s in v.get('skipped', [])] + v.get('errors', [])
    doc = json.load(open(os.path.join(tree, 'mgu-repo.json')))
    builds = [e for e in doc['components'] if isinstance(e.get('build'), dict)]
    # our own apps are listed one by one, each with only what its build reads (build.shared), so one app's change
    # leaves the others as they are in the Store; an "apps" pattern, if any, still builds each folder
    if 'apps' in doc:
        listed = set(e['id'] for e in builds)
        for name in sorted(os.listdir(os.path.join(tree, 'apps'))):
            if name not in listed:
                builds.append({'id': name, 'path': 'apps/' + name, 'build': dict(doc['apps']['build'], shared=['kit', 'shared', 'oap-sdk'])})
    for e in builds:
        b = e['build']
        t = tempfile.mkdtemp(dir=work)
        for p in [e['path']] + b['shared'] + [b['python']]:
            d = os.path.join(t, p)
            if p.endswith('oap-sdk'):           # the car makes the real one; a stub that throws if loaded
                os.makedirs(d, exist_ok=True)
                open(os.path.join(d, 'index.js'), 'w').write("throw new Error('stub oap-sdk')\n")
                open(os.path.join(d, 'package.json'), 'w').write('{"name": "oap-sdk", "version": "0.0.0"}\n')
            elif os.path.isdir(os.path.join(tree, p)):
                shutil.copytree(os.path.join(tree, p), d)
            elif os.path.exists(os.path.join(tree, p)):
                os.makedirs(os.path.dirname(d), exist_ok=True)
                shutil.copy2(os.path.join(tree, p), d)
        r = subprocess.run(['python3', b['python'], e['id']], cwd=t, capture_output=True, text=True, timeout=600)
        if r.returncode:
            problems.append('build %s: %s' % (e['id'], (r.stdout + r.stderr).strip().splitlines()[-1:]))
        shutil.rmtree(t)
    # Redline's own run test, on the patched copy
    red = os.path.join(ROOT, 'vendor/idrive7-apps/kit/tools/test_redline_running.js')
    if os.path.exists(red):
        r = subprocess.run(['node', red], capture_output=True, text=True, timeout=600)
        if r.returncode or ' 0 failed' not in r.stdout:
            problems.append('test_redline_running: ' + r.stdout.strip().splitlines()[-1:][0] if r.stdout.strip() else 'test_redline_running failed')
    return v.get('components', []), problems


def main():
    only_check = '--check' in sys.argv
    work = tempfile.mkdtemp(prefix='vendor-sync-')
    src = json.load(open(SOURCES, encoding='utf-8'))
    summary = {'apps': [], 'tools': [], 'failed': [], 'problems': []}
    clones = {}
    if not only_check:
        for v in src['vendor']:
            try:
                head = head_of(v['repo'])
                if head == v['commit']:
                    continue
                up = clones[v['dir']] = clone(v['repo'], os.path.join(work, v['dir']))
                base = os.path.join(ROOT, 'vendor', v['dir'])
                for app in v['apps']:
                    dst = os.path.join(base, 'apps', app)
                    old = version_of(dst)
                    backup = os.path.join(work, 'backup-' + app)
                    shutil.copytree(dst, backup)
                    replace(os.path.join(up, 'apps', app), dst)
                    try:
                        if app in v.get('patch', {}):
                            PATCHES[v['patch'][app]](dst)
                    except (PatchError, subprocess.CalledProcessError) as e:
                        replace(backup, dst)
                        summary['failed'].append('%s: our patch no longer fits the new version (%s); the old one is kept' % (app, e))
                        continue
                    new = version_of(dst)
                    if new != old:
                        summary['apps'].append({'id': app, 'from': old, 'to': new, 'repo': v['repo']})
                for frm, to in v.get('copy', {}).items():
                    if os.path.exists(os.path.join(up, frm)):
                        replace(os.path.join(up, frm), os.path.join(base, to))
                for d in v.get('drop', []):
                    p = os.path.join(base, d)
                    if os.path.isdir(p):
                        shutil.rmtree(p)
                    elif os.path.exists(p):
                        os.remove(p)
                try:
                    kit_low_priority(base)
                except (PatchError, subprocess.CalledProcessError) as e:
                    summary['failed'].append('%s: the low priority patch no longer fits its kit (%s)' % (v['repo'], e))
                for readme in ('vendor/README.md',):
                    p = os.path.join(ROOT, readme)
                    s = open(p, encoding='utf-8').read().replace('`%s`' % v['commit'][:7], '`%s`' % head[:7])
                    for a in summary['apps']:
                        if a['repo'] == v['repo'] and a['from']:
                            s = s.replace('%s %s' % (a['id'], a['from']), '%s %s' % (a['id'], a['to']))
                    open(p, 'w', encoding='utf-8').write(s)
                v['commit'] = head
            except Exception as e:  # one origin failing leaves the others to update
                summary['failed'].append('%s: %s' % (v['repo'], e))
        catalogs = {}
        for t in src['tools']:
            try:
                out = os.path.join(ROOT, 'tools-prebuilt', t['id'])
                if 'catalog' in t:
                    if t['catalog'] not in catalogs:
                        url = 'https://github.com/%s/releases/download/catalog/catalog.json' % t['catalog']
                        catalogs[t['catalog']] = {c['id']: c for c in json.load(urllib.request.urlopen(url, timeout=60))['components']}
                    c = catalogs[t['catalog']][t['id']]
                    if vtuple(c['version']) <= vtuple(t['version']):
                        continue
                    a = c['artifact']
                    tgz = os.path.join(work, a['name'])
                    urllib.request.urlretrieve(a['url'], tgz)
                    if hashlib.sha256(open(tgz, 'rb').read()).hexdigest() != a['sha256']:
                        raise RuntimeError('%s: sha256 does not match the catalog' % a['name'])
                    kit_to_folder(tgz, out)
                    new = c['version']
                else:
                    vdir, rel = t['folder'].split(':')
                    if vdir not in clones:
                        continue                     # that origin did not move
                    folder = os.path.join(clones[vdir], rel)
                    new = json.load(open(os.path.join(folder, 'component.json')))['version']
                    if new == t['version']:
                        continue
                    replace(folder, out)
                if t['id'] in TOOL_PATCHES:
                    TOOL_PATCHES[t['id']](out)
                summary['tools'].append({'id': t['id'], 'from': t['version'], 'to': new})
                p = os.path.join(ROOT, 'tools-prebuilt', 'README.md')
                s = open(p, encoding='utf-8').read().replace('| `%s/` | %s |' % (t['id'], t['version']), '| `%s/` | %s |' % (t['id'], new))
                s = s.replace('%s@%s' % (t['id'], t['version']), '%s@%s' % (t['id'], new))
                open(p, 'w', encoding='utf-8').write(s)
                t['version'] = new
            except Exception as e:
                summary['failed'].append('%s: %s' % (t['id'], e))
        open(SOURCES, 'w', encoding='utf-8').write(json.dumps(src, indent=2, ensure_ascii=False) + '\n')
    try:
        _, summary['problems'] = check(work)
    except Exception as e:
        summary['problems'].append('check: %s' % e)
    open(os.path.join(work, 'summary.json'), 'w').write(json.dumps(summary, indent=2))
    print(json.dumps(summary))
    return 1 if summary['problems'] else 0


if __name__ == '__main__':
    sys.exit(main())
