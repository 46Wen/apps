# mgu-audio-capture

`capture.c`: el paso 2 de Audio probe. Escucha 3 s cada dispositivo de captura ALSA (directamente con los ioctl del
kernel, sin alsa-lib) y dice el nivel cada 0,1 s. La unidad es x86-64; el binario es estático, así que no necesita
ninguna biblioteca de la unidad.

Compilarlo de nuevo (en Linux x86-64), desde `native/mgu-audio-probe`:

```sh
gcc -static -O2 -Wall -o files/mgu-audio-capture src/capture.c -lm && strip files/mgu-audio-capture
```

Probarlo sin dispositivo de sonido (PCM por la entrada estándar):

```sh
head -c 400000 /dev/zero | files/mgu-audio-capture - 48000 2 2
```
