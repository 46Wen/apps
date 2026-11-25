# Prueba en el coche: Audio probe

## Paso 5, segundo intento: el volumen real (unos 10 minutos)

La primera vez salía "esperando" todo el rato: el archivo con el que las apps piden el volumen era de la primera app
que lo creaba, y la otra no podía tocarlo. Arreglado en Music level 0.1.1.

1. Arranca el coche. En el Store (rama **pruebas**) actualiza **Music level** (0.1.1), **Audio probe** (app 0.5.1 y
   herramienta 0.5.1) y **Ambient config** (2.7.2603). **Reinicia la unidad** después, aunque no lo pida.
2. Pon música por **Bluetooth o USB**.
3. Abre **Audio probe**: abajo, **Nivel de la música en vivo** debe moverse con la música. Si no, ahora dice por qué
   (por ejemplo "la herramienta no está en marcha" o "no encuentra los buffers"): haz una foto de esa línea.
4. Pulsa **Explorar SmartXbar** y, en **Informe**, fotografía la primera página y la siguiente (sección
   **Music level**: estado del servicio, sus últimos mensajes y qué buffers se mueven).
5. Cierra Audio probe y pon **CarPlay**: dime si sigue yendo lento.
6. **Ambient config → Animations → Music wave** con la música sonando: la ola debe ir más rápida y brillante cuanto
   más alto suena, y casi parada en los silencios.

## Paso 4 (hecho el 25 de noviembre): los buffers de SmartXbar

1. Arranca el coche. En el Store (origen `46Wen/apps`, rama **pruebas**) actualiza **Audio probe**: app 0.4.0 y
   herramienta 0.5.0. Reinicia la unidad si lo pide.
2. Pon **música** desde el **USB o Bluetooth** del coche (no CarPlay la primera vez) y déjala sonando con buen volumen.
3. Abre **Audio probe** y pulsa **Explorar SmartXbar**. Tarda hasta 30 s. Espera a "Exploración hecha".
4. Pestaña **Informe**: haz una foto de las páginas hasta la sección **SmartXbar ports** (las primeras, unas 6).
5. Si puedes, repítelo con CarPlay sonando y haz fotos de las mismas páginas.

## Paso 3 (hecho el 25 de noviembre): SmartXbar explorado

## Pasos 1 y 2 (ya hechos el 25 de noviembre)

Objetivo: saber si la música se puede leer desde Linux (paso 1, el informe) y en qué entrada (paso 2, la captura),
en una sola visita.

## Antes de ir (en casa)

- [ ] Un USB en FAT32 o exFAT, vacío o con espacio. Si Windows pide "Examinar y reparar", hazlo antes.
- [ ] El móvil con la música lista (Bluetooth o CarPlay). Mejor una canción con ritmo fuerte y algún silencio.

## En el coche

1. **Arranca el coche** (motor en marcha o contacto puesto) para que la unidad no se apague.
2. **Store → Settings → Sources**: el origen `46Wen/apps` en la rama **pruebas**
   (Remove, y Add source `github.com/46Wen/apps/tree/pruebas`, o `46Wen/apps` y elegir *Branch pruebas*).
   Las apps instaladas no se pierden.
3. **Store → Apps**: instala **Audio probe** (instala también la herramienta). Si ya estaba, actualízala.
   Actualiza también **Ambient config** (2.7.2601, Music wave).
4. **Reinicia la unidad una vez** si el Store lo pide (para que la herramienta quede esperando el botón).
5. **Mete el USB** y **pon música**.
6. Abre **Audio probe**. Espera a ver las tres comprobaciones en verde (OK):
   herramienta, música (con el título de la canción) y USB.
   Si la música suena pero sale en rojo o ámbar (puede pasar con CarPlay), pulsa *Crear informe* dos veces.
7. Los botones están **en la propia pantalla** (táctiles; si no aparecen, en el menú de BMW de esa pantalla):
   - **Crear informe** → espera a "Informe creado".
   - **Prueba de captura** con la música **sonando** → espera a "Captura hecha" (unos 3 s por cada entrada).
   - **Pausa la música** y pulsa **Prueba de captura** otra vez.
8. Pestaña **Informe** (o **Ver informe**): pasa las páginas con *Siguiente* y **haz una foto de cada página**.
   Si el USB no admite la copia (la pantalla dice por qué, por ejemplo *Read-only file system*), las fotos son el
   informe: con las de la primera página del informe y de cada captura basta para empezar.
9. Si el USB sí la admitió, sácalo. Deben estar:
   - `mgu-audio-probe-<fecha>.txt` (el informe)
   - dos `mgu-audio-capture-<fecha>.txt` (con música y en pausa)
10. Mándame los tres archivos (o las fotos).

## De paso: Music wave

En **Ambient config → Animations** elige **Music wave** con la música sonando: la ola avanza; en pausa se queda
quieta; al cambiar de canción cambia de color. Dime si es así.

## Si algo falla

| Qué ves | Qué hacer |
|---|---|
| "La herramienta no respondió" | Reinicia la unidad una vez y vuelve a pulsar |
| El USB no tiene los archivos | En "Ver informe" está todo: haz fotos de las páginas |
| La comprobación 1 en rojo | En el Store, Tools: instala o actualiza **Audio probe** (0.3.0) |
| Ningún botón en el menú | Haz una foto de la pantalla y del menú y mándamela |
| Un corte de sonido de un instante al hacer la captura | Es posible al abrir una entrada; dímelo junto con el archivo |
