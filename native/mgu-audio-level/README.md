# Music level (`mgu-audio-level`)

El volumen de la música en vivo para la **Music wave** de Ambient config. Lo encontró Audio probe (pasos 3 y 4):
la música no pasa por ALSA sino por **SmartXbar**, y cada reproductor escribe en un *ring buffer* en `/dev/shm`.

## Cómo lo lee

- Abre esos buffers **en solo lectura** (`O_RDONLY`, `PROT_READ`): nadie lo nota, no reproduce ni cambia nada.
- Formato visto en el coche (48 kHz): 240 bytes de cabecera, luego un bloque de 1536 muestras `float` por canal
  (6144 bytes, uno tras otro) y 4436 bytes de contadores al final.
- Los bloques que cambian entre dos miradas llevan audio en vivo; su RMS es el nivel.
- Primero los puertos de los reproductores (`smartx_*_p`: MediaSink de mediaengine para USB y Bluetooth, CarPlayMain,
  AndroidAutoMedia...), antes del volumen de BMW; si ninguno suena, las salidas AVB al amplificador.
- Escribe `/dev/shm/mgu-audio-level.json` (`{"level":0..1,"db":...,"src":"..."}`), que la Music wave ya lee.

## Consumo

- En reposo: mira un archivo una vez por segundo.
- Solo trabaja (20 veces por segundo, unos pocos KB leídos de memoria) mientras alguien toca
  `/dev/shm/mgu-audio-level.want`: la Music wave mientras está puesta y la app Audio probe mientras se ve. Límite del servicio: 5 % de CPU, 16 MB.
- Sin root: usuario propio en los grupos `mgu_alsa` y `mgu_avbs`, solo lectura.

## Compilar

```sh
gcc -static -O2 -Wall -o files/mgu-audio-level src/level.c -lm && strip files/mgu-audio-level
```
