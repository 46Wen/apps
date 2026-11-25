#!/bin/sh
# mgu-audio-probe (46Wen), 0.6: only the last step, the music's live level (Music level / mgu-audio-level). One report,
# asked for by the Audio probe app's "Explorar SmartXbar": first why Music level gives a level or not (its service,
# journal, files, and what it sees: --once), then SmartXbar's ring buffers read (mgu-audio-shmpeek), the Audio
# Manager's lists (the app's, /dev/shm/mgu-audio-am.txt), who maps which buffer and SmartXbar's configuration.
# Read only: nothing played, captured or changed. Steps 1 and 2 (the general report, the capture test) are done and
# left out. Output: /dev/shm/mgu-audio-probe.txt (the app's Informe tab), /var/opt/mgu-audio-probe/reports (the last
# 5) and stdout (the journal). Run as root by mgu-audio-probe.service when the app writes the request file
# /dev/shm/mgu-audio-probe.request (mgu-audio-probe.path); its state for the app in /dev/shm/mgu-audio-probe.status.
# By hand over SSH:  ssh root@<head unit> 'sh -s' < probe.sh > report.txt

VERSION=0.6.0
STAMP=$(date +%Y%m%d-%H%M%S 2>/dev/null || echo now)
DIR=/var/opt/mgu-audio-probe/reports
TMP=/tmp/mgu-audio-probe.$$
MAX=6000                                   # bytes kept of any one look
REQUEST=/dev/shm/mgu-audio-probe.request
STATUS=/dev/shm/mgu-audio-probe.status
NOW=$(date +%s 2>/dev/null || echo 0)

MODE=smartx
NAME=mgu-audio-smartx
# the request taken (the path unit would start this again while it is there), the app told it runs
rm -f "$REQUEST" 2>/dev/null
status() { echo "$1" > "$STATUS.tmp" 2>/dev/null && chmod 0644 "$STATUS.tmp" && mv -f "$STATUS.tmp" "$STATUS"; }
status "{\"state\":\"running\",\"mode\":\"$MODE\",\"at\":$NOW}"

T=""
command -v timeout >/dev/null 2>&1 && T="timeout 8"

sec() { echo; echo "===== $1"; }
show() {                                   # a file, its first $2 bytes
    if [ -e "$1" ]; then echo "--- $1"; head -c "${2:-$MAX}" "$1" 2>&1; echo; else echo "--- $1: none"; fi
}
run() {                                    # a command, cut short
    echo "\$ $*"
    if command -v "$1" >/dev/null 2>&1; then $T "$@" 2>&1 | head -c "$MAX"; echo; else echo "($1: not on this unit)"; fi
}


mkdir -p "$DIR" 2>/dev/null
# Step 3, SmartXbar (mode smartx): the first report showed ALSA only carries the hands-free phone (BT Playback /
# Capture, held by AlsaRoutingAdapter) and no stream running with music on; the music goes through Intel's SmartXbar
# (the smartx / avb ALSA plugins) under BMW's Audio Manager. This looks, read only, at how SmartXbar is built on this
# unit: its processes (their command lines: system services, no personal data), the shared-memory buffers they map,
# its libraries and configuration, the Audio Manager's configuration and units, and its sockets. The app adds the
# Audio Manager's own lists (sinks, sources, connections) in /dev/shm/mgu-audio-am.txt before asking.
AUDIO_RE='audio|smartx|xbar|ias|avb|alsa|routing|amp|dsp|media|carplay|handsfree|genivi|tuner|radio|sound'
strs() {                                   # printable strings of a binary, 6 chars or more
    if busybox strings "$1" >/dev/null 2>&1; then busybox strings "$1" 2>/dev/null
    else tr -c '[:print:]' '\n' < "$1" 2>/dev/null | grep -E '.{6,}'; fi
}
# Step 5, why the Music level tool gives no level: its service, its last lines in the journal, its files in /dev/shm
# (owner and mode: an app's uid owning the want file kept the others from touching it), and what it sees (--once:
# ten looks, nothing written). First in the SmartXbar report, so it is on the first page photographed.
level() {
    L=/var/opt/mgu-audio-level/current/mgu-audio-level
    sec "Music level (mgu-audio-level)"
    [ -x "$L" ] && echo "installed: $L" || echo "NOT installed ($L missing)"
    if command -v systemctl >/dev/null 2>&1; then
        echo "active: $(systemctl is-active mgu-audio-level.service 2>&1)  enabled: $(systemctl is-enabled mgu-audio-level.service 2>&1)"
        systemctl show mgu-audio-level.service -p ExecMainStatus -p ExecMainPID -p NRestarts -p User -p Result 2>&1 | tr '\n' ' '; echo
    fi
    command -v journalctl >/dev/null 2>&1 && $T journalctl -u mgu-audio-level.service -n 14 --no-pager -o cat 2>&1 | cut -c 1-160
    ls -ln /dev/shm/mgu-audio-level* 2>&1
    echo "now $(date +%s 2>/dev/null)"
    show /dev/shm/mgu-audio-level.status 400
    show /dev/shm/mgu-audio-level.json 200
    [ -x "$L" ] && $T "$L" --once 2>&1 | head -n 40
}

smartx() {
    echo "mgu-audio-smartx $VERSION  $STAMP"
    echo "Read only: SmartXbar and the Audio Manager as they are on this unit. Nothing played, connected or changed."
    PEEK=$(dirname "$0")/mgu-audio-shmpeek
    sec "hints"
    echo "Step 4: SmartXbar's ring buffers read (mapped read only, 6 looks 50 ms apart). 'changed' = what moved between"
    echo "the looks (the counters up top, the audio below); s16 / s32 / f32 = the level of that area read three ways (dBFS)."
    echo "The music's buffer is the one that changes and whose level moves with it (and stops when paused)."
    echo "music: $(grep -o 'music [^,]*' /dev/shm/mgu-audio-am.txt 2>/dev/null | head -n 1)"
    level
    sec "SmartXbar's buffers"
    if [ -x "$PEEK" ]; then
        k=0
        for f in /dev/shm/smartx_*_ringbuffer /dev/shm/avb_*_ringbuffer; do
            [ -e "$f" ] || continue
            k=$((k + 1)); [ "$k" -gt 70 ] && { echo "(more than 70 ring buffers: the rest left out)"; break; }
            "$PEEK" "$f" 6 50 2>&1 | head -c 600
        done
        [ "$k" -eq 0 ] && echo "no ring buffer in /dev/shm"
    else echo "mgu-audio-shmpeek missing next to probe.sh"; fi
    sec "Audio Manager (from the app: sinks, sources, connections)"
    show /dev/shm/mgu-audio-am.txt 9000
    sec "SmartXbar ports in /dev/shm (names, without _connection / _ringbuffer)"
    ls -1 /dev/shm 2>/dev/null | grep -E '^(smartx|avb)_' | sed -e 's/_connection$//' -e 's/_ringbuffer$//' | sort -u | xargs -n 6 echo
    echo
    echo "other /dev/shm entries: $(ls -1 /dev/shm 2>/dev/null | grep -vE '^(smartx|avb)_' | tr '\n' ' ')"
    sec "/run/smartx"
    ls -1 /run/smartx 2>&1 | xargs -n 6 echo
    echo
    sec "who maps which SmartXbar buffer"
    for p in /proc/[0-9]*; do
        m=$(grep -oE '/dev/shm/(smartx|avb)_[^ ]+' "$p/maps" 2>/dev/null | sed -e 's|/dev/shm/||' -e 's/_connection$//' -e 's/_ringbuffer$//' | sort -u | tr '\n' ' ')
        [ -n "$m" ] && echo "${p#/proc/} $(cat "$p/comm" 2>/dev/null): $m"
    done
    sec "audio processes (pid, name, memory, command line)"
    for p in /proc/[0-9]*; do
        c=$(cat "$p/comm" 2>/dev/null)
        echo "$c" | grep -qiE "$AUDIO_RE" || continue
        echo "${p#/proc/} $c $(awk '/^VmRSS/ {print $2 " kB"}' "$p/status" 2>/dev/null): $(tr '\0' ' ' < "$p/cmdline" 2>/dev/null | cut -c1-200)"
    done
    sec "SmartXbar configuration"
    show /etc/smartx_config.txt 4000
    show /etc/tmpfiles.d/15-run-smartx.conf 800
    echo "end"
}

mkdir -p "$DIR" 2>/dev/null
smartx > "$TMP" 2>&1
cp "$TMP" "$DIR/$MODE-$STAMP.txt" 2>/dev/null
cp "$TMP" /dev/shm/mgu-audio-probe.txt 2>/dev/null && chmod 0644 /dev/shm/mgu-audio-probe.txt
# the last 5 reports only
ls -1t "$DIR"/*.txt 2>/dev/null | tail -n +6 | while read -r f; do rm -f "$f"; done
size=$(wc -c < "$TMP" 2>/dev/null)
status "{\"state\":\"done\",\"mode\":\"$MODE\",\"at\":$(date +%s 2>/dev/null || echo 0),\"bytes\":${size:-0},\"usb\":[],\"file\":\"$NAME-$STAMP.txt\"}"
# the report on stdout too: in the journal when the service runs it, in the file when run by hand over SSH
cat "$TMP"
rm -f "$TMP"
msg="report of $size bytes in $DIR/$MODE-$STAMP.txt and /dev/shm/mgu-audio-probe.txt"
command -v logger >/dev/null 2>&1 && logger -t mgu-audio-probe "$msg"
echo "mgu-audio-probe: $msg"
exit 0
