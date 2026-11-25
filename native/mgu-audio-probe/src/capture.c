/*
 * mgu-audio-capture (46Wen): the second step of the Audio probe. Listens to one ALSA capture device (or to raw PCM
 * on stdin) for a few seconds and says how loud it was, every 0.1 s, so the report shows which device carries the
 * music (a level that moves with it) and which only silence or the cabin microphone.
 *
 *   mgu-audio-capture <card> <device> [seconds]     /dev/snd/pcmC<card>D<device>c, straight through the kernel's
 *                                                   ioctls (no alsa-lib on the unit needed)
 *   mgu-audio-capture - <rate> <channels> [seconds]  S16_LE on stdin (a PulseAudio monitor through parec)
 *
 * It only reads: a device another program holds answers "busy" and is left alone (opened non-blocking); nothing is
 * played or set. At most 10 s, and an alarm ends it 3 s after that whatever happens. Static x86-64 build (the head
 * unit is x86-64): no library it needs from the unit.
 *
 * Output, one line:  <what>: <format> <ch>ch <rate>Hz rms <dBFS per 0.1 s ...> | per channel <dBFS ...> | peak <dBFS>
 *                    | overruns <n>      or      <what>: <why not>
 * Build: gcc -static -O2 -o mgu-audio-capture capture.c -lm
 */
#include <errno.h>
#include <fcntl.h>
#include <limits.h>
#include <math.h>
#include <signal.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/ioctl.h>
#include <unistd.h>
#include <sound/asound.h>

#define MAX_CH 16
#define MAX_WIN 100

static const char *what = "capture";

static void on_alarm(int s) { (void)s; printf("%s: stopped (took too long)\n", what); fflush(stdout); _exit(3); }

static struct snd_mask *mask(struct snd_pcm_hw_params *p, int n) { return &p->masks[n - SNDRV_PCM_HW_PARAM_FIRST_MASK]; }
static struct snd_interval *iv(struct snd_pcm_hw_params *p, int n) { return &p->intervals[n - SNDRV_PCM_HW_PARAM_FIRST_INTERVAL]; }
static void mask_one(struct snd_pcm_hw_params *p, int n, unsigned bit) {
    struct snd_mask *m = mask(p, n);
    memset(m, 0, sizeof *m);
    m->bits[bit >> 5] |= 1u << (bit & 31);
}
static void iv_one(struct snd_pcm_hw_params *p, int n, unsigned v) {
    struct snd_interval *i = iv(p, n);
    memset(i, 0, sizeof *i);
    i->min = i->max = v; i->integer = 1;
}
static void any(struct snd_pcm_hw_params *p) {
    int n;
    memset(p, 0, sizeof *p);
    for (n = SNDRV_PCM_HW_PARAM_FIRST_MASK; n <= SNDRV_PCM_HW_PARAM_LAST_MASK; n++) memset(mask(p, n), 0xff, sizeof(struct snd_mask));
    for (n = SNDRV_PCM_HW_PARAM_FIRST_INTERVAL; n <= SNDRV_PCM_HW_PARAM_LAST_INTERVAL; n++) { iv(p, n)->min = 0; iv(p, n)->max = UINT_MAX; }
    p->rmask = ~0u; p->cmask = 0; p->info = ~0u;
}

static const char *fmt_name(int f) {
    return f == SNDRV_PCM_FORMAT_S16_LE ? "S16_LE" : f == SNDRV_PCM_FORMAT_S32_LE ? "S32_LE" : f == SNDRV_PCM_FORMAT_S24_LE ? "S24_LE" : "?";
}
static double db(double x) { return x > 1e-9 ? 20.0 * log10(x) : -99.0; }

/* The level of one block of samples: sum of squares per channel, the peak. */
struct acc { double sq[MAX_CH]; double win; long n; double peak; };
static void add(struct acc *a, const void *buf, long frames, int ch, int fmt) {
    long i; int c;
    for (i = 0; i < frames; i++) {
        for (c = 0; c < ch; c++) {
            double v;
            if (fmt == SNDRV_PCM_FORMAT_S16_LE) v = ((const int16_t *)buf)[i * ch + c] / 32768.0;
            else if (fmt == SNDRV_PCM_FORMAT_S24_LE) { int32_t s = ((const int32_t *)buf)[i * ch + c] << 8; v = (s >> 8) / 8388608.0; }
            else v = ((const int32_t *)buf)[i * ch + c] / 2147483648.0;
            if (c < MAX_CH) a->sq[c] += v * v;
            a->win += v * v;
            if (fabs(v) > a->peak) a->peak = fabs(v);
        }
    }
    a->n += frames;
}

static void report(int fmt, int ch, int rate, double *wins, int nw, struct acc *a, int overruns) {
    int i;
    printf("%s: %s %dch %dHz rms", what, fmt_name(fmt), ch, rate);
    for (i = 0; i < nw; i++) printf(" %.0f", db(wins[i]));
    printf(" | per channel");
    for (i = 0; i < ch && i < MAX_CH; i++) printf(" %.0f", a->n ? db(sqrt(a->sq[i] / a->n)) : -99.0);
    printf(" | peak %.0f | overruns %d\n", db(a->peak), overruns);
    fflush(stdout);
}

static int from_stdin(int rate, int ch, int secs) {
    long per = rate / 10, got;
    int nw = 0;
    double wins[MAX_WIN];
    struct acc a; memset(&a, 0, sizeof a);
    int16_t *buf = malloc((size_t)per * ch * 2);
    what = "stdin";
    if (!buf || ch < 1 || ch > MAX_CH) { printf("%s: bad arguments\n", what); return 2; }
    while (nw < secs * 10) {
        size_t want = (size_t)per * ch * 2, have = 0;
        while (have < want) { ssize_t r = read(0, (char *)buf + have, want - have); if (r <= 0) break; have += (size_t)r; }
        if (have < want) break;
        got = per;
        a.win = 0; add(&a, buf, got, ch, SNDRV_PCM_FORMAT_S16_LE);
        wins[nw++] = sqrt(a.win / (got * ch));
    }
    if (!nw) { printf("%s: no sound came\n", what); return 1; }
    report(SNDRV_PCM_FORMAT_S16_LE, ch, rate, wins, nw, &a, 0);
    return 0;
}

int main(int argc, char **argv) {
    char path[64], name[96];
    int card, dev, secs = 3, fd, i, fmt = -1, ch = 0, rate = 0;
    static const int fmts[] = { SNDRV_PCM_FORMAT_S16_LE, SNDRV_PCM_FORMAT_S32_LE, SNDRV_PCM_FORMAT_S24_LE };
    struct snd_pcm_hw_params hp;
    signal(SIGALRM, on_alarm);
    if (argc >= 4 && strcmp(argv[1], "-") == 0) {
        secs = argc > 4 ? atoi(argv[4]) : 3; if (secs < 1) secs = 1; if (secs > 10) secs = 10;
        alarm((unsigned)secs + 3);
        return from_stdin(atoi(argv[2]), atoi(argv[3]), secs);
    }
    if (argc < 3) { fprintf(stderr, "usage: %s <card> <device> [seconds] | - <rate> <channels> [seconds]\n", argv[0]); return 2; }
    card = atoi(argv[1]); dev = atoi(argv[2]);
    if (argc > 3) secs = atoi(argv[3]);
    if (secs < 1) secs = 1;
    if (secs > 10) secs = 10;
    snprintf(path, sizeof path, "/dev/snd/pcmC%dD%dc", card, dev);
    snprintf(name, sizeof name, "pcmC%dD%dc", card, dev);
    what = name;
    alarm((unsigned)secs + 3);

    /* non-blocking: a device in use answers EBUSY at once instead of waiting for it */
    fd = open(path, O_RDONLY | O_NONBLOCK | O_CLOEXEC);
    if (fd < 0) { printf("%s: cannot open (%s)\n", what, errno == EBUSY ? "busy: another program uses it" : strerror(errno)); return 1; }
    fcntl(fd, F_SETFL, fcntl(fd, F_GETFL) & ~O_NONBLOCK);

    for (i = 0; i < 3 && fmt < 0; i++) {
        struct snd_interval *c, *r;
        any(&hp);
        mask_one(&hp, SNDRV_PCM_HW_PARAM_ACCESS, SNDRV_PCM_ACCESS_RW_INTERLEAVED);
        mask_one(&hp, SNDRV_PCM_HW_PARAM_FORMAT, (unsigned)fmts[i]);
        if (ioctl(fd, SNDRV_PCM_IOCTL_HW_REFINE, &hp) < 0) continue;
        c = iv(&hp, SNDRV_PCM_HW_PARAM_CHANNELS); r = iv(&hp, SNDRV_PCM_HW_PARAM_RATE);
        /* two channels where it can, else the fewest it has; 48 kHz, 44.1 kHz, else the lowest rate */
        ch = c->min <= 2 && c->max >= 2 ? 2 : (int)c->min;
        if (ch < 1) ch = 1;
        rate = r->min <= 48000 && r->max >= 48000 ? 48000 : r->min <= 44100 && r->max >= 44100 ? 44100 : (int)r->min;
        if (ch > MAX_CH || rate < 4000) continue;
        iv_one(&hp, SNDRV_PCM_HW_PARAM_CHANNELS, (unsigned)ch);
        iv_one(&hp, SNDRV_PCM_HW_PARAM_RATE, (unsigned)rate);
        if (ioctl(fd, SNDRV_PCM_IOCTL_HW_PARAMS, &hp) < 0) continue;
        fmt = fmts[i];
    }
    if (fmt < 0) { printf("%s: no format it takes (S16, S32, S24 interleaved)\n", what); close(fd); return 1; }
    if (ioctl(fd, SNDRV_PCM_IOCTL_PREPARE) < 0) { printf("%s: prepare refused (%s)\n", what, strerror(errno)); close(fd); return 1; }

    {
        long per = rate / 10;
        int bytes = fmt == SNDRV_PCM_FORMAT_S16_LE ? 2 : 4, nw = 0, overruns = 0, tries = 0;
        double wins[MAX_WIN];
        struct acc a; memset(&a, 0, sizeof a);
        void *buf = malloc((size_t)per * ch * bytes);
        if (!buf) { close(fd); return 1; }
        ioctl(fd, SNDRV_PCM_IOCTL_START);
        while (nw < secs * 10 && tries < secs * 30) {
            struct snd_xferi x;
            long done = 0;
            tries++;
            while (done < per) {
                x.result = 0; x.buf = (char *)buf + done * ch * bytes; x.frames = (snd_pcm_uframes_t)(per - done);
                if (ioctl(fd, SNDRV_PCM_IOCTL_READI_FRAMES, &x) < 0) {
                    if (errno == EPIPE) { overruns++; ioctl(fd, SNDRV_PCM_IOCTL_PREPARE); ioctl(fd, SNDRV_PCM_IOCTL_START); continue; }
                    printf("%s: read refused (%s) after %d blocks\n", what, strerror(errno), nw);
                    ioctl(fd, SNDRV_PCM_IOCTL_DROP); close(fd); return 1;
                }
                done += (long)x.result;
            }
            a.win = 0; add(&a, buf, per, ch, fmt);
            wins[nw++] = sqrt(a.win / ((double)per * ch));
        }
        ioctl(fd, SNDRV_PCM_IOCTL_DROP);
        close(fd);
        report(fmt, ch, rate, wins, nw, &a, overruns);
    }
    return 0;
}
