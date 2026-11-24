# Copiloto de voz

Su BMW le habla: frases grabadas, de usted, cuando pasa algo. Arranca sola con el coche y trabaja en segundo plano,
también con la pantalla cerrada.

## Los avisos, por prioridad

Si dos coinciden, suena antes el de número más bajo; **nunca dos voces a la vez**. **Durante una llamada no habla**:
los avisos esperan a que cuelgue. Un aviso que lleva más de 2 minutos esperando se descarta (ya no vendría a cuento),
salvo el de combustible y el de neumáticos.

| # | Aviso | Cuándo | Cada cuánto |
|---|---|---|---|
| 1 | Combustible | autonomía de 50 km o menos (ajuste); el coche busca la mejor Shell y pregunta «¿Ir?» | una vez, hasta repostar |
| 2 | Neumáticos | el propio BMW avisa de presión baja | una vez por viaje |
| 3 | Posible hielo | 3 °C o menos fuera, conduciendo | una vez por viaje |
| 4 | Motor frío | aceite por debajo de 80 °C y más de 2.500 rpm | una vez por viaje |
| 5 | Batería | menos de 11,8 V con el motor parado, dicho al arrancar | una vez por arranque |
| 6 | Bienvenida | al arrancar el motor: buenos días / tardes / noches | una vez por viaje (no al volver a arrancar en menos de 3 min) |
| 7 | Mantenimiento | al arrancar, si faltan 2.000 km o 60 días para el aceite, los frenos o la inspección | como mucho una vez por semana |
| 8 | Ventanillas | al apagar, con una ventanilla o el techo abierto | una vez por apagado |
| 9 | Fin del viaje | al apagar después de conducir más de 1 minuto | una vez por viaje |
| 10 | Pausa | cada 2 horas conduciendo (una parada de 15 min reinicia la cuenta) | cada 2 horas |
| 11 | Motor caliente | el aceite llega a 80 °C, en un viaje que empezó en frío | una vez por viaje, siempre el último |

Cada aviso se activa o desactiva en **Ajustes**, donde también se elige la autonomía del aviso de combustible.

Solo lee del coche (la batería, con diagnosis de solo lectura). Lo único que hace es reproducir sonido y mandar el
aviso al iPhone.

## La pantalla

Estilo BMW: un recuadro por aviso, con su icono, su número de prioridad y si está activo, en cola, hablando o cuándo
sonó por última vez; «sin grabación» si falta su frase. Arriba, el estado del coche, del iPhone y de la voz (o «En
llamada: espera»); abajo, lo que lee del coche (combustible, autonomía, aceite, temperatura exterior, batería,
ventanillas abiertas). **Probar la siguiente frase** reproduce las frases una a una; **Buscar gasolinera ahora**
hace la búsqueda de combustible.

## Combustible: la mejor Shell, elegida en el coche

Con el aviso de combustible, **el coche busca solo** la Shell más conveniente, con el mismo algoritmo que su página
shell-diesel, sin tocar el móvil:

1. **Dónde está:** la posición del navegador del coche (GPS + estima), o el GPS.
2. **Precios:** los del Ministerio de Industria (Geoportal de Gasolineras), solo Shell y sin Shell Express, tal como
   los guarda cada hora su repositorio shell-diesel (`data/shell.json`). La última copia se guarda en el coche y sirve
   sin internet (con su fecha).
3. **Candidatas:** las 45 más baratas a menos de 25 km (ajuste *Buscar a menos de*).
4. **Trayecto:** km y minutos reales por carretera (OSRM); sin internet, la línea recta × 1,3 a 50 km/h.
5. **Coste:** llenar (depósito − litros que quedan) × precio + el combustible del trayecto (km × consumo × precio). El
   consumo es el del coche (litros / autonomía).
6. **Elección:** abierta cuando llegue (su horario, hora local) y a menos de la mitad de la autonomía por carretera, la
   de menor coste; si no hay ninguna tan cerca, la más cercana abierta, para llegar seguro.

El resultado sale en una **ventana del iDrive**: «Shell Getafe · 1,669 €/L · 15,7 km · 19 min · total 91,95 €. Calle
…, ¿Ir?» y en el recuadro *Gasolinera* de la pantalla de la app. **Buscar gasolinera ahora** la prueba en cualquier
momento. En Ajustes: diésel normal o premium, el depósito (59 L) y el radio.

**«Ir» todavía no arranca el navegador de BMW:** ninguna app lo ha hecho aún. Esta versión lee (sin cambiar nada) el
catálogo de servicios del iDrive unos minutos después de arrancar y guarda en `navegador.json` y en el registro qué
ofrece el navegador para recibir un destino. Con ese archivo de su coche se conecta «Ir» en la siguiente versión.
Mientras, la gasolinera elegida y su dirección quedan en pantalla. Opcional: *Copia de la gasolinera al iPhone (ntfy)*,
apagado por defecto.

El coche necesita internet para precios frescos y rutas reales: el *uplink* del MGU Store (MGU Store → Ajustes →
Wi-Fi, el punto de acceso del iPhone).

## Las voces

Una grabación por frase en [`voces/`](voces/FRASES.md) (allí están los 14 nombres de archivo y los textos).

**Voz femenina de Apple, en el iPhone:**

1. Ajustes → Accesibilidad → Contenido leído → Voces → Español (España): descargue una voz *Mejorada* o *Premium*
   (por ejemplo Mónica o Marisol, si aparecen). La voz de Siri no se puede guardar como archivo; estas sí.
2. En Atajos, un atajo con: **Diccionario** (clave = nombre del archivo sin `.m4a`, valor = el texto; las 14 filas de
   `voces/FRASES.md`) → **Repetir con cada** clave → **Obtener valor del diccionario** → **Crear audio hablado a partir
   del texto** (en inglés *Make Spoken Audio from Text*; Español (España), la voz descargada, velocidad algo por
   debajo de la mitad) → **Establecer nombre** (el *Elemento de repetición*) → **Guardar archivo** en iCloud Drive,
   carpeta `BMW voces`, sin preguntar dónde.
3. Ejecútelo, escuche los `.m4a` en Archivos y mándelos para subirlos a `voces/`. El Store los instala con la app.

## Cómo suena

Como RideTube (JustAnotherPU/ridetube, probado en un X5 G05): el gestor de audio de BMW conecta la fuente de medios
de las apps a los altavoces, el reproductor de BMW reproduce la frase y se desconecta. **Mientras habla, la música se
pausa**; al terminar vuelve la fuente que sonaba. Si RideTube reproduce un vídeo, no habla encima.

## Por comprobar en el coche

Todo está probado fuera del coche, no en él todavía. Si algo no funciona, la pantalla y el registro
(`copiloto_voz.log`) dicen por qué:

- **El sonido** desde una app (RideTube lo hace desde un servicio): «Probar la siguiente frase».
- **Ventanillas y techo**: ninguna app los lee aún; el registro guarda una vez los campos que manda el coche
  (`doors/windows fields: …`) para ajustarlo.
- **El aviso de neumáticos de BMW**: se reconoce por el nombre del mensaje de Check Control (en español, alemán o
  inglés); el registro anota los mensajes activos.
- **Batería** (diagnosis del motor, como eDrive), **mantenimiento** (la lista de Service), **aceite**, **llamadas**:
  señales que otras apps ya leen en coches reales.

## Memoria y CPU

Escucha señales que el coche manda cuando cambian, hace una cuenta cada 5 s y lee la batería una vez por arranque.
Sin la pantalla abierta no dibuja nada. El sonido lo reproduce el reproductor de BMW, no la app.

## Pruebas

`node tools/test_copiloto_voz.js`: los 11 avisos, la cola (prioridad, de una en una, llamadas, avisos caducados), la
lectura de las señales, la frase según la hora, el enlace a shell-diesel y la secuencia del audio la búsqueda de gasolinera (68 comprobaciones).
