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

Se usa con la app **Audio probe**, que se instala junto con esta herramienta. Nada se ejecuta solo: el informe
se crea únicamente cuando se pulsa su botón.

1. En el Store instala la app **Audio probe** (instala también la herramienta). **Reinicia la unidad una vez.**
2. Mete un **USB** (FAT32 o exFAT) y pon **música** (Bluetooth, CarPlay o USB).
3. Abre la app. Muestra tres comprobaciones: la herramienta instalada, la música sonando (con el título que la
   unidad ve) y el USB metido.
4. Cuando las tres están en verde, pulsa **Crear informe**. Tarda unos segundos. Si la unidad no dice qué suena
   (puede pasar con CarPlay) y la música sí suena, pulsa **Crear informe** otra vez antes de 10 s.
5. El informe queda en el USB como `mgu-audio-probe-<fecha>.txt`. **Ver informe** lo muestra también en la
   pantalla, página a página (primero el resumen), por si el USB no admitió la copia: se le puede hacer una foto.
   También queda en `/var/opt/mgu-audio-probe/reports/` (los 5 últimos).
6. **Paso 2, Prueba de captura**: escucha 3 s cada entrada de captura de la unidad (sin reproducir ni cambiar nada;
   una entrada que usa otro programa se deja en paz) y da su nivel cada 0,1 s. Hazla con la música sonando y otra vez
   en pausa: la entrada cuyos niveles siguen a la música es la que lleva la música. Queda en el USB como
   `mgu-audio-capture-<fecha>.txt`. El programa que escucha es `files/mgu-audio-capture` (fuente en `src/`).

La lista paso a paso para ir al coche: [PRUEBA.md](../../docs/prueba-audio.md).

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
