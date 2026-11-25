/*
 * mgu-audio-shmpeek (46Wen): step 4 of the Audio probe. Looks, read only, into one of SmartXbar's shared-memory ring
 * buffers (/dev/shm/smartx_<port>_p_ringbuffer, the audio a player such as mediaengine writes into SmartXbar), to find
 * where in it the audio and the read / write counters are, and how loud what is in it is.
 *
 *   mgu-audio-shmpeek <file> [snapshots] [ms between]       (default 6 snapshots, 50 ms apart)
 *
 * The file is opened O_RDONLY and mapped PROT_READ, MAP_SHARED: nothing in it is written, its writer and readers do not
 * notice. Several snapshots: the bytes that change between them are the counters (small, near the top) and the audio
 * (large); the level of the changing area is read as 16-bit, 32-bit and float samples, so the format that gives
 * sensible numbers shows how SmartXbar keeps it.
 *
 * Output: <name> <size> | changed <ranges> | head <first 8 u32> | s16 <dBFS per snapshot> | s32 ... | f32 ...
 * Build: gcc -static -O2 -o mgu-audio-shmpeek shmpeek.c -lm
 */
#include <fcntl.h>
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

#define MAXSNAP 12
#define MAXSIZE (8 * 1024 * 1024)

static void on_alarm(int s) { (void)s; puts("shmpeek: stopped (took too long)"); _exit(3); }
static double db(double x) { return x > 1e-9 ? 20.0 * log10(x) : -99.0; }

int main(int argc, char **argv) {
    struct stat st;
    int fd, n = argc > 2 ? atoi(argv[2]) : 6, ms = argc > 3 ? atoi(argv[3]) : 50, i;
    const char *name;
    unsigned char *map, *snap[MAXSNAP];
    size_t size, a, b, lo = (size_t)-1, hi = 0;
    if (argc < 2) { fprintf(stderr, "usage: %s <file> [snapshots] [ms]\n", argv[0]); return 2; }
    if (n < 2) n = 2;
    if (n > MAXSNAP) n = MAXSNAP;
    if (ms < 5) ms = 5;
    if (ms > 500) ms = 500;
    signal(SIGALRM, on_alarm);
    alarm(5);
    name = strrchr(argv[1], '/') ? strrchr(argv[1], '/') + 1 : argv[1];
    fd = open(argv[1], O_RDONLY | O_CLOEXEC);
    if (fd < 0 || fstat(fd, &st) < 0) { printf("%s: cannot open\n", name); return 1; }
    size = (size_t)st.st_size;
    if (!size || size > MAXSIZE) { printf("%s: size %zu left out\n", name, size); return 1; }
    map = mmap(NULL, size, PROT_READ, MAP_SHARED, fd, 0);
    close(fd);
    if (map == MAP_FAILED) { printf("%s: cannot map\n", name); return 1; }
    for (i = 0; i < n; i++) {
        struct timespec ts = { 0, (long)ms * 1000000L };
        snap[i] = malloc(size);
        if (!snap[i]) return 1;
        memcpy(snap[i], map, size);
        if (i < n - 1) nanosleep(&ts, NULL);
    }
    printf("%s %zu | changed", name, size);
    {   /* the ranges that changed between any two snapshots, merged over gaps under 16 bytes, at most 10 shown */
        int shown = 0;
        size_t start = (size_t)-1, last = 0;
        for (a = 0; a < size; a++) {
            int ch = 0;
            for (i = 1; i < n && !ch; i++) ch = snap[i][a] != snap[0][a];
            if (!ch) continue;
            if (a < lo) lo = a;
            if (a > hi) hi = a;
            if (start != (size_t)-1 && a - last <= 16) { last = a; continue; }
            if (start != (size_t)-1 && shown < 10) { printf(" %zu-%zu", start, last); shown++; }
            start = last = a;
        }
        if (start != (size_t)-1 && shown < 10) printf(" %zu-%zu", start, last);
        if (start == (size_t)-1) printf(" none");
    }
    printf(" | head");
    for (i = 0; i < 8 && (size_t)(i + 1) * 4 <= size; i++) { uint32_t w; memcpy(&w, map + i * 4, 4); printf(" %x", w); }
    /* the level of the changing area beyond the first 256 bytes (the counters live up top), else the whole file
     * past 256, read three ways, one value per snapshot */
    a = lo != (size_t)-1 && hi > 256 ? (lo > 256 ? lo : 256) : 256;
    b = lo != (size_t)-1 && hi > 256 ? hi + 1 : size;
    if (b > size) b = size;
    if (a >= b) { puts(" | no audio area"); return 0; }
    a &= ~(size_t)3; b &= ~(size_t)3;
    printf(" | area %zu-%zu s16", a, b);
    for (i = 0; i < n; i++) { double s = 0; size_t k, c = 0; for (k = a; k + 2 <= b; k += 2) { int16_t v; memcpy(&v, snap[i] + k, 2); s += (double)v * v; c++; } printf(" %.0f", c ? db(sqrt(s / c) / 32768.0) : -99.0); }
    printf(" | s32");
    for (i = 0; i < n; i++) { double s = 0; size_t k, c = 0; for (k = a; k + 4 <= b; k += 4) { int32_t v; memcpy(&v, snap[i] + k, 4); s += (double)v * v; c++; } printf(" %.0f", c ? db(sqrt(s / c) / 2147483648.0) : -99.0); }
    printf(" | f32");
    for (i = 0; i < n; i++) {
        double s = 0; size_t k, c = 0, bad = 0;
        for (k = a; k + 4 <= b; k += 4) { float v; memcpy(&v, snap[i] + k, 4); if (isfinite(v) && fabsf(v) <= 2.0f) { s += (double)v * v; c++; } else bad++; }
        printf(" %.0f%s", c ? db(sqrt(s / c)) : -99.0, bad > c ? "?" : "");
    }
    putchar('\n');
    munmap(map, size);
    return 0;
}
