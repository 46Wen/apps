# Copiloto de voz

Su BMW le habla: frases grabadas, de usted, cuando pasa algo. Arranca sola con el coche y trabaja en segundo plano,
también con la pantalla cerrada.

## Los avisos, por prioridad

Si dos coinciden, suena antes el de número más bajo; **nunca dos voces a la vez**. **Durante una llamada no habla**:
los avisos esperan a que cuelgue. Un aviso que lleva más de 2 minutos esperando se descarta (ya no vendría a cuento),
salvo el de combustible y el de neumáticos.

| # | Aviso | Cuándo | Cada cuánto |
|---|---|---|---|
| 1 | Combustible | autonomía de 50 km o menos (ajuste) | una vez, hasta repostar |
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
ventanillas abiertas). **Probar la siguiente frase** reproduce las frases una a una; **Probar el aviso al iPhone**
manda el aviso de combustible.

## Combustible: la mejor Shell en Waze

1. Instale **ntfy** en el iPhone (gratis, App Store) y suscríbase al tema que muestra la pantalla de la app
   (`bmw-…`, en el servidor `ntfy.sh`). Es un nombre al azar que solo conoce su coche: no lo comparta.
2. Cuando falta combustible, además de la frase, llega «Combustible bajo» al iPhone. Al tocarlo se abre su página
   **shell-diesel** en modo coche, con los litros y el consumo del coche: busca alrededor de usted (el «radio
   cercano» de la página), elige la Shell más barata (llenar + trayecto) abierta cuando llegue y a menos de la mitad
   de su autonomía, y abre Waze (iOS pregunta «¿Abrir en Waze?»: toque *Abrir*). Con CarPlay, Waze sale en el coche.
3. El coche necesita internet: el *uplink* del MGU Store (MGU Store → Ajustes → Wi-Fi, el punto de acceso del iPhone).

El iPhone no deja que nada abra una app o una página sin un toque: por eso es un aviso que se toca.

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
lectura de las señales, la frase según la hora, el enlace a shell-diesel y la secuencia del audio (54 comprobaciones).
