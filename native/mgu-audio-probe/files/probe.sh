#!/bin/sh
# mgu-audio-probe (46Wen): a read-only look at how the head unit's sound is built, to find out whether the music can
# be listened to (its level, for Ambient config's Music wave). It only reads: no sound is captured or played, no
# device is opened for audio, no setting is changed. What it writes: its report, in
#   /var/opt/mgu-audio-probe/reports/  (the last 5),  /dev/shm/mgu-audio-probe.txt,
#   and a copy on every USB stick it can write to (/media/<label>/mgu-audio-probe-<time>.txt).
# Each look is cut short (timeout, head -c) so a report stays small and nothing can hang the run.
# Run as root by mgu-audio-probe.service: once after the install, and 3 minutes after each start of the head unit.
# Also by hand over SSH:  ssh root@<head unit> 'sh -s' < probe.sh > report.txt
# Busybox sh. No personal data: process names only (never their command lines or environment), no file contents
# but sound configuration.

VERSION=0.1.0
STAMP=$(date +%Y%m%d-%H%M%S 2>/dev/null || echo now)
DIR=/var/opt/mgu-audio-probe/reports
TMP=/tmp/mgu-audio-probe.$$
MAX=6000                                   # bytes kept of any one look

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

probe() {
    echo "mgu-audio-probe $VERSION  $STAMP"
    echo "Read only: nothing captured, played or changed."

    sec "unit"
    run uname -a
    show /etc/os-release 1500
    show /proc/uptime 100
    head -n 3 /proc/meminfo 2>/dev/null
    show /proc/cpuinfo 1200

    sec "programs for sound"
    for b in arecord aplay amixer alsactl alsaucm pactl pacmd pulseaudio pipewire pw-cli pw-dump wpctl \
             gst-launch-1.0 gst-inspect-1.0 ffmpeg sox strace ldd node python3 busybox; do
        p=$(command -v "$b" 2>/dev/null); echo "$b: ${p:-none}"
    done

    sec "ALSA: cards, devices, streams"
    show /proc/asound/version 200
    show /proc/asound/cards
    show /proc/asound/devices
    show /proc/asound/pcm
    show /proc/asound/timers 1500
    for c in /proc/asound/card*; do
        [ -d "$c" ] || continue
        show "$c/id" 100
        for f in "$c"/pcm*/info; do [ -e "$f" ] && show "$f" 800; done
        # which streams run now (state RUNNING) and in what format: the music's own stream shows here
        for f in "$c"/pcm*/sub*/status "$c"/pcm*/sub*/hw_params; do
            [ -e "$f" ] || continue
            v=$(head -c 600 "$f" 2>/dev/null)
            [ "$v" = "closed" ] && continue
            echo "--- $f"; echo "$v"
        done
    done
    echo "(streams not listed above are closed)"

    sec "device files"
    ls -l /dev/snd 2>&1 | head -n 80
    ls -l /dev 2>/dev/null | grep -iE "snd|audio|dsp|pcm|tdm|i2s|a2b|most|mixer|loop" | head -n 40

    sec "kernel"
    grep -iE "snd|sound|audio|aloop|a2b|most|asoc" /proc/modules 2>/dev/null | head -n 60
    echo "snd-aloop (loopback) module on the unit:"
    find /lib/modules -name "*aloop*" 2>/dev/null | head -n 5
    echo "kernel log (sound lines):"
    dmesg 2>/dev/null | grep -iE "asoc|snd|alsa|audio|a2b|codec|i2s|tdm" | tail -n 60

    sec "who holds the sound devices"
    for p in /proc/[0-9]*; do
        d=$(ls -l "$p/fd" 2>/dev/null | grep -oE "/dev/(snd/[^ ]+|[^ ]*(audio|dsp|a2b|tdm)[^ ]*)" | sort -u | tr '\n' ' ')
        [ -n "$d" ] && echo "${p#/proc/} $(cat "$p/comm" 2>/dev/null): $d"
    done
    echo "processes with a sound-like name:"
    for p in /proc/[0-9]*; do
        n=$(cat "$p/comm" 2>/dev/null)
        case "$n" in *[Aa]udio*|*[Pp]ulse*|*[Pp]ipe[Ww]ire*|*[Ww]ireplumb*|*gst*|*[Mm]edia*|*[Ss]ound*|*[Aa]mp*|*[Dd]sp*|*a2dp*|*[Bb]t*|*[Cc]ar[Pp]lay*|*iap*|*[Aa]lsa*|*[Aa][Mm]_*|*[Gg]enivi*|*[Tt]uner*|*[Rr]adio*|*[Mm]ixer*)
            echo "${p#/proc/} $n $(awk '/^VmRSS/ {print $2" kB"}' "$p/status" 2>/dev/null)";;
        esac
    done

    sec "sound configuration"
    show /etc/asound.conf
    show /usr/share/alsa/asound.conf
    ls -la /etc/alsa /usr/share/alsa/alsa.conf.d /etc/alsa/conf.d 2>&1 | head -n 60
    for f in /etc/alsa/conf.d/* /usr/share/alsa/alsa.conf.d/*; do [ -f "$f" ] && show "$f" 2500; done
    for f in /etc/pulse/default.pa /etc/pulse/system.pa /etc/pulse/daemon.conf; do [ -e "$f" ] && show "$f" 4000; done
    echo "sound-related files (names only):"
    find /etc /opt /usr/share /usr/lib /var/opt -maxdepth 4 \( -iname "*asound*" -o -iname "*audiomanager*" -o -iname "*audio_manager*" \
        -o -iname "*pulse*" -o -iname "*pipewire*" -o -iname "*alsa*" -o -iname "*.pa" -o -iname "*ucm*" \) 2>/dev/null \
        | grep -v "^/var/opt/mgu-audio-probe" | head -n 120

    sec "sound servers"
    ls -la /run/pulse /var/run/pulse /run/pipewire* /run/user 2>&1 | head -n 40
    for s in /run/pulse/native /var/run/pulse/native /run/user/*/pulse/native; do
        [ -S "$s" ] || continue
        echo "PulseAudio socket $s:"
        run env PULSE_SERVER="unix:$s" pactl info
        run env PULSE_SERVER="unix:$s" pactl list short sinks
        # a ".monitor" source here is the music as it goes out: the easiest place to measure its level
        run env PULSE_SERVER="unix:$s" pactl list short sources
    done

    sec "ALSA's own lists"
    run aplay -l
    run arecord -l
    echo "\$ arecord -L (names only)"
    command -v arecord >/dev/null 2>&1 && $T arecord -L 2>&1 | grep -v "^ " | head -n 120

    sec "GStreamer"
    if command -v gst-inspect-1.0 >/dev/null 2>&1; then
        $T gst-inspect-1.0 2>/dev/null | grep -iE "alsa|pulse|level|spectrum|tee|appsink|interaudio|shm" | head -n 40
    else echo "(no gst-inspect-1.0)"; fi

    sec "hints"
    r=$(grep -l "RUNNING" /proc/asound/card*/pcm*/sub*/status 2>/dev/null)
    if [ -n "$r" ]; then echo "streams running now:"; echo "$r"; else echo "no stream running now (was music playing?)"; fi
    grep -q "snd_aloop" /proc/modules 2>/dev/null && echo "loopback (snd_aloop) loaded: a copy of the sound may be readable"
    find /lib/modules -name "*aloop*" 2>/dev/null | grep -q . && ! grep -q "snd_aloop" /proc/modules && echo "loopback module present but not loaded"
    ls /run/pulse/native /var/run/pulse/native /run/user/*/pulse/native >/dev/null 2>&1 && echo "PulseAudio runs: look for a .monitor source above"
    grep -l "capture" /proc/asound/card*/pcm*c/info >/dev/null 2>&1 && echo "capture devices exist: listed under ALSA"
    command -v arecord >/dev/null 2>&1 || echo "no arecord: a capture test needs a small program of our own"
    echo "end"
}

mkdir -p "$DIR" 2>/dev/null
probe > "$TMP" 2>&1
cp "$TMP" "$DIR/probe-$STAMP.txt" 2>/dev/null
cp "$TMP" /dev/shm/mgu-audio-probe.txt 2>/dev/null && chmod 0644 /dev/shm/mgu-audio-probe.txt
# the last 5 reports only
ls -1t "$DIR"/probe-*.txt 2>/dev/null | tail -n +6 | while read -r f; do rm -f "$f"; done
copied=""
for m in /media/*; do
    [ -d "$m" ] || continue
    cp "$TMP" "$m/mgu-audio-probe-$STAMP.txt" 2>/dev/null && sync && copied="$copied $m"
done
size=$(wc -c < "$TMP" 2>/dev/null)
rm -f "$TMP"
msg="report of $size bytes in $DIR/probe-$STAMP.txt and /dev/shm/mgu-audio-probe.txt; USB:${copied:- none writable}"
command -v logger >/dev/null 2>&1 && logger -t mgu-audio-probe "$msg"
echo "mgu-audio-probe: $msg"
exit 0
