# Audio probe (`mgu-audio-probe`)

Primer paso para que Ambient config (Music wave) siga el volumen real de la música. Antes de escribir un
captador de audio hay que saber cómo está montado el sonido en la unidad, y eso solo se ve dentro de ella.

## Qué hace

Solo lee: no captura ni reproduce sonido, no abre ningún dispositivo de audio y no cambia nada. Mira:

- las tarjetas y dispositivos ALSA (`/proc/asound`) y **qué flujos están sonando ahora y en qué formato**;
- qué procesos tienen abiertos los dispositivos de sonido (el que reproduce la música);
- si hay un servidor de sonido (PulseAudio o PipeWire) y sus fuentes `.monitor`;
- si existe el módulo de bucle `snd-aloop`, la configuración de ALSA y los programas disponibles
  (`arecord`, `gst-inspect-1.0`...).

Tarda un segundo o dos, con la prioridad más baja de CPU y disco.

## Cómo usarla

1. Instala **Audio probe** desde el Store (origen `46Wen/apps`).
2. Antes, mete un **USB** en el coche y pon **música** (Bluetooth, CarPlay o USB), así el informe ve el flujo
   que suena.
3. Se ejecuta al instalarse y otra vez **3 minutos después de cada arranque**.
4. El informe queda en el USB como `mgu-audio-probe-<fecha>.txt`. Si el USB no admite escritura, queda en
   `/var/opt/mgu-audio-probe/reports/` (los 5 últimos) y en `/dev/shm/mgu-audio-probe.txt`.

Con acceso root por SSH también se puede ejecutar a mano, sin instalar nada:

```sh
ssh root@<unidad> 'sh -s' < native/mgu-audio-probe/files/probe.sh > informe.txt
```

## Qué buscamos en el informe

| Si el informe muestra | Entonces |
|---|---|
| Una fuente `.monitor` de PulseAudio | El caso fácil: se mide el nivel desde ahí |
| `snd_aloop` cargado o disponible, o una captura ALSA que reciba la música | Un captador pequeño puede leer el nivel |
| Un flujo `RUNNING` en una tarjeta propia de la unidad (no solo hacia el amplificador) | Hay que probar si ese flujo se puede compartir (`dsnoop`, plugin ALSA) |
| La música solo sale por un DSP o bus hacia el amplificador (A2B, TDM) | No se puede leer desde Linux: la Music wave se queda con el ritmo por canción |

Después de leerlo, el paso 2 sería un captador nativo que escriba `/dev/shm/mgu-audio-level.json`, el archivo
que la Music wave ya lee.
