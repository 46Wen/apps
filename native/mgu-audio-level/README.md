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
- Escribe `/dev/shm/mgu-audio-level.json` (`{"level":0..1,"db":...,"bass":0..1,"beats":n,"beatAgo":ms,"src":"..."}`), que la Music wave lee.
- **Beats (0.2):** los graves (filtro de paso bajo a ~150 Hz) del bloque más fuerte; un beat es un salto de su energía a
  más del doble de su media del último segundo y medio, más de una desviación típica por encima, con al menos el 5 % de
  la energía del sonido en graves, subiendo y como mínimo 280 ms después del anterior (214 BPM). Probado con bombos
  simulados: 90, 120 y 174 BPM se cuentan bien; ruido y una línea de bajo continua no dan beats.

## Consumo

- En reposo: mira un archivo una vez por segundo.
- Solo trabaja (20 veces por segundo, unos pocos KB leídos de memoria) mientras alguien toca
  `/dev/shm/mgu-audio-level.want`: la Music wave mientras está puesta y la app Audio probe mientras se ve. Límite del servicio: 5 % de CPU, 16 MB.
- Corre como root (como la herramienta de Audio probe): la 0.1.0, con un usuario dinámico, nunca dio un nivel en el
  coche. Solo mapea los buffers en lectura y escribe sus tres archivos en `/dev/shm`.

## Por qué no daba nivel (0.1.0) y qué cambió en 0.1.1

- **El archivo `.want` era de la primera app que lo creaba.** Cada app OAP corre con su propio uid y `/dev/shm`
  tiene el bit *sticky*: si Ambient config lo creaba (0644), Audio probe ya no podía tocarlo, y al revés. El error se
  callaba y la herramienta seguía en reposo. Ahora la herramienta lo crea y lo mantiene en 0666.
- **Latido:** `/dev/shm/mgu-audio-level.status` una vez por segundo (`wanted`, `wantAge`, `ports`, `live`, `src`, `err`).
  Audio probe dice con él qué pasa en vez de «esperando».
- `mgu-audio-level --once`: diez miradas, imprime cada buffer que se mueve con sus canales y su nivel; no escribe nada.
  Sale en el informe «Explorar SmartXbar» (sección «Music level»), junto con el estado del servicio y su journal.

## Compilar

```sh
gcc -static -O2 -Wall -o files/mgu-audio-level src/level.c -lm && strip files/mgu-audio-level
```
