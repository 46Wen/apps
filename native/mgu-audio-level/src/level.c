/*
 * mgu-audio-level (46Wen): the music's level, live, for Ambient config's Music wave. Reads SmartXbar's ring buffers in
 * /dev/shm read only (O_RDONLY, PROT_READ: no player, mixer or amplifier notices) and writes, 20 times a second,
 *   /dev/shm/mgu-audio-level.json   {"level":0..1,"db":-35.2,"src":"MediaSink_AudioOut_Front","at":<ms>}
 * which music.js reads.
 *
 * What the car showed (Audio probe 0.5.0, 25 Nov 2026, music on Bluetooth): a 48 kHz ring buffer is
 *   [0,240) header | nch channel blocks of 1536 frames, one after the other (planar), 6144 bytes each | 4436 bytes of
 *   counters at the end
 * (16964 = 240 + 2 x 6144 + 4436 for stereo, 41540 with 6 channels, 53828 with 8). The blocks that change between two
 * looks carry live audio; their RMS over the whole block (32 ms) is the level. Samples are float (checked on every
 * look: else read as 32-bit integers).
 * Which buffer: the players' own ports first (smartx_*_CF_48_*_p: mediaengine's MediaSink for USB / Bluetooth,
 * CarPlayMain, AndroidAutoMedia...: before BMW's volume), else the AVB outputs to the amplifier (avb_MGU_GW_*_SINK_CF_48_*).
 *
 * Only while someone wants it: /dev/shm/mgu-audio-level.want touched in the last 15 s (music.js touches it while a
 * Music wave is on, the Audio probe app while it is shown). Otherwise one look at that file a second and nothing else.
 * Also, once a second, /dev/shm/mgu-audio-level.status {"v","pid","uid","wanted","wantAge","ports","live","src","err","at"}:
 * Audio probe shows from it why there is no level. --once prints what it sees, for a check by hand.
 * Build: gcc -static -O2 -o mgu-audio-level level.c -lm
 */
#include <dirent.h>
#include <errno.h>
#include <fcntl.h>
#include <fnmatch.h>
#include <math.h>
#include <signal.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/mman.h>
#include <sys/stat.h>
#include <time.h>
#include <unistd.h>

#define SHM "/dev/shm"
#define OUT SHM "/mgu-audio-level.json"
#define WANT SHM "/mgu-audio-level.want"
#define STATUS SHM "/mgu-audio-level.status"
#define VERSION "0.1.1"
#define HEAD 240
#define TAIL 4436
#define BLOCK 6144                 /* 1536 frames x 4 bytes, one channel */
#define FRAMES (BLOCK / 4)
#define MAXPORTS 48
#define MAXCH 16
#define TICK_MS 50
#define RESCAN_MS 10000
#define WANT_S 15

struct port {
    char name[96];                 /* without smartx_ / avb_ and the _ringbuffer */
    int amp;                       /* an AVB output (after the mixer and the volume) */
    const unsigned char *map;
    size_t size;
    int nch;
    uint32_t sig[MAXCH];           /* a fingerprint of each block at the last look */
};
static struct port ports[MAXPORTS];
static int nports;
static volatile sig_atomic_t stop;
static void on_term(int s) { (void)s; stop = 1; }

static long long now_ms(void) { struct timespec t; clock_gettime(CLOCK_MONOTONIC, &t); return (long long)t.tv_sec * 1000 + t.tv_nsec / 1000000; }
static long long wall_ms(void) { struct timespec t; clock_gettime(CLOCK_REALTIME, &t); return (long long)t.tv_sec * 1000 + t.tv_nsec / 1000000; }

static void unmap_all(void) {
    int i;
    for (i = 0; i < nports; i++) munmap((void *)ports[i].map, ports[i].size);
    nports = 0;
}

static uint32_t fingerprint(const unsigned char *b) {
    uint32_t h = 2166136261u, w;
    int i;
    for (i = 0; i < FRAMES; i += 37) { memcpy(&w, b + i * 4, 4); h = (h ^ w) * 16777619u; }
    return h;
}

/* (re)maps the 48 kHz playback ports and AVB outputs whose size fits the layout */
static void scan(void) {
    DIR *d = opendir(SHM);
    struct dirent *e;
    unmap_all();
    if (!d) return;
    while ((e = readdir(d)) && nports < MAXPORTS) {
        const char *n = e->d_name;
        int amp = !fnmatch("avb_MGU_GW_*_SINK_CF_48_*_p_ringbuffer", n, 0);
        if (!amp && fnmatch("smartx_*_CF_48_*_p_ringbuffer", n, 0)) continue;
        char path[300];
        struct stat st;
        snprintf(path, sizeof path, SHM "/%s", n);
        int fd = open(path, O_RDONLY | O_CLOEXEC);
        if (fd < 0) continue;
        if (fstat(fd, &st) < 0 || st.st_size < HEAD + BLOCK + TAIL || (st.st_size - HEAD - TAIL) % BLOCK) { close(fd); continue; }
        void *m = mmap(NULL, (size_t)st.st_size, PROT_READ, MAP_SHARED, fd, 0);
        close(fd);
        if (m == MAP_FAILED) continue;
        struct port *p = &ports[nports++];
        memset(p, 0, sizeof *p);
        p->map = m; p->size = (size_t)st.st_size; p->amp = amp;
        p->nch = (int)((st.st_size - HEAD - TAIL) / BLOCK);
        if (p->nch > MAXCH) p->nch = MAXCH;
        const char *s = n + (amp ? 4 : 7);
        size_t l = strlen(s) - strlen("_ringbuffer");
        if (l >= sizeof p->name) l = sizeof p->name - 1;
        memcpy(p->name, s, l); p->name[l] = 0;
        /* the name without the _CF_48... format part */
        char *cf = strstr(p->name, "_CF_");
        if (cf) *cf = 0;
        /* what is in the blocks now is the baseline: a port left with old audio in it is not live */
        for (int c = 0; c < p->nch; c++) p->sig[c] = fingerprint(p->map + HEAD + (size_t)c * BLOCK);
    }
    closedir(d);
}

/* RMS of one channel block, 0..1 full scale: float samples when they look like floats, else 32-bit integers */
static double block_rms(const unsigned char *b) {
    int i, ok = 0;
    double s = 0;
    for (i = 0; i < FRAMES; i += 16) { float f; memcpy(&f, b + i * 4, 4); if (isfinite(f) && fabsf(f) <= 8.0f) ok++; }
    if (ok * 10 >= (FRAMES / 16) * 9) {
        for (i = 0; i < FRAMES; i++) { float f; memcpy(&f, b + i * 4, 4); if (isfinite(f)) s += (double)f * f; }
    } else {
        for (i = 0; i < FRAMES; i++) { int32_t v; memcpy(&v, b + i * 4, 4); double x = v / 2147483648.0; s += x * x; }
    }
    return sqrt(s / FRAMES);
}

/* The want file is touched by the apps, each under a uid of its own (OAP): the first one to make it owns it, and in
 * /dev/shm (sticky, 0644 by their umask) no other app could touch it again: Audio probe's touches failed silently
 * when Ambient config had made it, and the other way round. So it is kept here as everybody's: made 0666 at the start,
 * and given back 0666 whenever an app made it again. Its time is what counts. */
static int want_age = -1;          /* seconds since the last touch, -1: no file */
static int wanted(void) {
    struct stat st;
    if (stat(WANT, &st)) { want_age = -1; return 0; }
    if ((st.st_mode & 0777) != 0666) chmod(WANT, 0666);
    want_age = (int)(time(NULL) - st.st_mtime);
    return want_age <= WANT_S;
}
static void make_want(void) {
    int fd = open(WANT, O_WRONLY | O_CREAT | O_CLOEXEC, 0666);
    if (fd >= 0) { fchmod(fd, 0666); close(fd); }
    else fprintf(stderr, "mgu-audio-level: cannot make %s: %s\n", WANT, strerror(errno));
}

/* whole-file writes, replaced at once (a reader never sees half a file) */
static int put(const char *path, const char *buf, int n) {
    char tmp[128];
    snprintf(tmp, sizeof tmp, "%s.tmp", path);
    unlink(tmp);
    int fd = open(tmp, O_WRONLY | O_CREAT | O_TRUNC | O_CLOEXEC, 0644);
    if (fd < 0) return -1;
    int ok = write(fd, buf, (size_t)n) == n;
    fchmod(fd, 0644); close(fd);
    if (!ok || rename(tmp, path)) { unlink(tmp); return -1; }
    return 0;
}

/* The heartbeat, once a second, idle or not: what Audio probe shows when there is no level ("the tool runs, nobody
 * asks", "no buffers"...). */
static char last_err[160];
static void heartbeat(int w, const char *src, int live) {
    char buf[400];
    int n = snprintf(buf, sizeof buf, "{\"v\":\"%s\",\"pid\":%d,\"uid\":%d,\"wanted\":%s,\"wantAge\":%d,\"ports\":%d,"
        "\"live\":%d,\"src\":\"%s\",\"err\":\"%s\",\"at\":%lld}\n", VERSION, (int)getpid(), (int)getuid(),
        w ? "true" : "false", want_age, nports, live, src, last_err, wall_ms());
    static int warned;
    if (put(STATUS, buf, n) && !warned++) fprintf(stderr, "mgu-audio-level: cannot write %s: %s\n", STATUS, strerror(errno));
}

static void publish(double rms, const char *src) {
    char buf[256];
    double db = rms > 1e-7 ? 20.0 * log10(rms) : -140.0;
    double level = (db + 48.0) / 42.0;           /* -48 dBFS = 0, -6 dBFS = 1 */
    if (level < 0) level = 0;
    if (level > 1) level = 1;
    int n = snprintf(buf, sizeof buf, "{\"level\":%.3f,\"db\":%.1f,\"src\":\"%s\",\"at\":%lld}\n", level, db, src, wall_ms());
    if (put(OUT, buf, n)) {
        snprintf(last_err, sizeof last_err, "cannot write %s: %s", OUT, strerror(errno));
        static int warned;
        if (!warned++) fprintf(stderr, "mgu-audio-level: %s\n", last_err);
    } else last_err[0] = 0;
}

/* --once (Audio probe's "Music level" check, by hand over SSH): ten looks 50 ms apart, every buffer it maps printed
 * with its channels, how many of them moved and their level. Nothing is written. */
static int diagnose(void) {
    int i, c, k;
    int moved[MAXPORTS][MAXCH];
    double peak[MAXPORTS];
    memset(moved, 0, sizeof moved); memset(peak, 0, sizeof peak);
    scan();
    printf("mgu-audio-level %s --once: %d buffers mapped (uid %d)\n", VERSION, nports, (int)getuid());
    for (k = 0; k < 10; k++) {
        struct timespec ts = { 0, TICK_MS * 1000000L };
        nanosleep(&ts, NULL);
        for (i = 0; i < nports; i++) for (c = 0; c < ports[i].nch; c++) {
            const unsigned char *b = ports[i].map + HEAD + (size_t)c * BLOCK;
            uint32_t f = fingerprint(b);
            if (f != ports[i].sig[c]) { moved[i][c]++; double r = block_rms(b); if (r > peak[i]) peak[i] = r; }
            ports[i].sig[c] = f;
        }
    }
    for (i = 0; i < nports; i++) {
        int any = 0;
        char mv[3 * MAXCH + 1] = "";
        for (c = 0; c < ports[i].nch; c++) { any |= moved[i][c]; snprintf(mv + strlen(mv), sizeof mv - strlen(mv), "%d%s", moved[i][c], c + 1 < ports[i].nch ? "," : ""); }
        if (!any) continue;
        printf("  %-44s %s %dch moved/10 [%s] %.1f dB\n", ports[i].name, ports[i].amp ? "avb" : "sx ", ports[i].nch, mv,
               peak[i] > 1e-7 ? 20 * log10(peak[i]) : -140.0);
    }
    int quiet = 0;
    for (i = 0; i < nports; i++) { int any = 0; for (c = 0; c < ports[i].nch; c++) any |= moved[i][c]; quiet += !any; }
    printf("  (%d more mapped, not moving)\n", quiet);
    unmap_all();
    return 0;
}

int main(int argc, char **argv) {
    long long last_scan = 0, last_beat = 0;
    if (argc > 1 && !strcmp(argv[1], "--once")) return diagnose();
    signal(SIGTERM, on_term); signal(SIGINT, on_term);
    umask(0);
    int was = -1;
    fprintf(stderr, "mgu-audio-level %s: started as uid %d, waiting for %s\n", VERSION, (int)getuid(), WANT);
    if (wanted() == 0 && want_age < 0) make_want();
    while (!stop) {
        int w = wanted();
        long long t = now_ms();
        if (w != was) { fprintf(stderr, "mgu-audio-level: %s\n", w ? "asked for the level: reading" : "nobody asks: idle"); was = w; }
        if (!w) {
            if (nports) unmap_all();
            last_scan = 0;
            heartbeat(0, "none", 0);
            sleep(1);
            continue;
        }
        if (!last_scan || t - last_scan > RESCAN_MS) {
            int before = nports; scan(); last_scan = t;
            if (nports != before) fprintf(stderr, "mgu-audio-level: %d SmartXbar buffers mapped\n", nports);
        }
        double best = 0, best_amp = 0;
        const char *src = "none", *src_amp = "none";
        int i, c, nlive = 0;
        for (i = 0; i < nports; i++) {
            struct port *p = &ports[i];
            double lv = 0;
            int live = 0;
            for (c = 0; c < p->nch; c++) {
                const unsigned char *b = p->map + HEAD + (size_t)c * BLOCK;
                uint32_t f = fingerprint(b);
                if (f != p->sig[c]) { live = 1; double r = block_rms(b); if (r > lv) lv = r; }
                p->sig[c] = f;
            }
            if (!live) continue;
            nlive++;
            if (p->amp) { if (lv >= best_amp) { best_amp = lv; src_amp = p->name; } }
            else if (lv >= best) { best = lv; src = p->name; }
        }
        /* a player's own port when one plays, else what goes to the amplifier */
        const char *from = strcmp(src, "none") ? src : src_amp;
        publish(strcmp(src, "none") ? best : best_amp, from);
        if (t - last_beat >= 1000) { last_beat = t; heartbeat(1, from, nlive); }
        struct timespec ts = { 0, TICK_MS * 1000000L };
        nanosleep(&ts, NULL);
    }
    unlink(STATUS);
    unmap_all();
    return 0;
}
