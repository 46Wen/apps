# Prueba en el coche: Audio probe (unos 15 minutos)

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
