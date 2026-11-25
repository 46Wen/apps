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

static int wanted(void) {
    struct stat st;
    return stat(WANT, &st) == 0 && time(NULL) - st.st_mtime <= WANT_S;
}

static void publish(double rms, const char *src) {
    char buf[256];
    double db = rms > 1e-7 ? 20.0 * log10(rms) : -140.0;
    double level = (db + 48.0) / 42.0;           /* -48 dBFS = 0, -6 dBFS = 1 */
    if (level < 0) level = 0;
    if (level > 1) level = 1;
    int n = snprintf(buf, sizeof buf, "{\"level\":%.3f,\"db\":%.1f,\"src\":\"%s\",\"at\":%lld}\n", level, db, src, wall_ms());
    int fd = open(OUT ".tmp", O_WRONLY | O_CREAT | O_TRUNC | O_CLOEXEC, 0644);
    if (fd < 0) return;
    if (write(fd, buf, (size_t)n) == n) { fchmod(fd, 0644); close(fd); rename(OUT ".tmp", OUT); }
    else close(fd);
}

int main(int argc, char **argv) {
    long long last_scan = 0;
    int once = argc > 1 && !strcmp(argv[1], "--once");     /* one look, printed: for tests */
    signal(SIGTERM, on_term); signal(SIGINT, on_term);
    while (!stop) {
        if (!once && !wanted()) { if (nports) unmap_all(); sleep(1); last_scan = 0; continue; }
        long long t = now_ms();
        if (!last_scan || t - last_scan > RESCAN_MS) { scan(); last_scan = t; }
        double best = 0, best_amp = 0;
        const char *src = "none", *src_amp = "none";
        int i, c;
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
            if (p->amp) { if (lv > best_amp) { best_amp = lv; src_amp = p->name; } }
            else if (lv > best) { best = lv; src = p->name; }
        }
        /* a player's own port when one plays, else what goes to the amplifier */
        if (strcmp(src, "none")) publish(best, src); else publish(best_amp, src_amp);
        if (once && once++ < 3) { struct timespec w = { 0, TICK_MS * 1000000L }; nanosleep(&w, NULL); continue; }
        if (once) { FILE *f = fopen(OUT, "r"); char l[256]; if (f && fgets(l, sizeof l, f)) fputs(l, stdout); if (f) fclose(f); break; }
        struct timespec ts = { 0, TICK_MS * 1000000L };
        nanosleep(&ts, NULL);
    }
    unmap_all();
    return 0;
}
