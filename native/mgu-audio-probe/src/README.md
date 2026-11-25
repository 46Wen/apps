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

# mgu-audio-shmpeek

`shmpeek.c`: el paso 4. Mira, en solo lectura (`O_RDONLY`, `PROT_READ`), dentro de un ring buffer de SmartXbar en
`/dev/shm` (por ejemplo `smartx_MediaSink_AudioOut_Front_..._p_ringbuffer`, donde mediaengine escribe la música).
Toma varias instantáneas y dice qué bytes cambian (los contadores arriba, el audio abajo) y el nivel de esa zona leída
como 16 bits, 32 bits y float. Nadie lo nota: no escribe nada.

```sh
gcc -static -O2 -Wall -o files/mgu-audio-shmpeek src/shmpeek.c -lm && strip files/mgu-audio-shmpeek
```
