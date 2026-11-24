# Copiloto de voz

El coche habla: frases grabadas cuando pasa algo.

| Cuándo | Qué dice (por defecto) | Además |
|---|---|---|
| Al subir: la primera puerta que se abre, o el coche preparándose para arrancar | «Buenos días / Buenas tardes / Buenas noches. Bienvenido a bordo…» | según la hora (ajuste *Zona horaria*) |
| Al apagar después de conducir | «Fin del viaje. Hasta la próxima.» | al bajar del coche no vuelve a dar la bienvenida |
| Autonomía de 50 km o menos, conduciendo | «Falta de combustible…» | un aviso en el iPhone que abre **Waze** hacia la **Shell** más cercana |
| Después de repostar | «Depósito repostado. Buen viaje.» | |
| 3 °C o menos fuera, conduciendo | «…puede haber hielo en la carretera.» | una vez por viaje |
| Cada 2 horas conduciendo | «…le recomiendo hacer una pausa.» | |

Cada aviso se puede apagar en **Ajustes**, y también se elige ahí la autonomía del aviso y la gasolinera (Shell,
Repsol, Cepsa, BP, Galp o la más cercana de cualquier marca).

Solo lee del coche. Lo único que hace es reproducir sonido y mandar el aviso al móvil.

## 1. Las voces

Las frases son archivos de sonido en [`voces/`](voces/FRASES.md), uno por frase, con el nombre que dice cuándo suena.

### Con una voz de Apple, en el iPhone

1. **Descarga una voz femenina de calidad:** Ajustes → Accesibilidad → Contenido leído → Voces → Español (España).
   Elige una voz *Mejorada* o *Premium* (por ejemplo Mónica o Marisol, si aparecen) y descárgala.
   La voz de Siri no se puede usar para crear archivos; estas sí.
2. **Crea un atajo** en la app Atajos:
   1. Acción **Diccionario**, con una fila por frase: la clave es el nombre del archivo y el valor, el texto
      (copia las nueve filas de [`voces/FRASES.md`](voces/FRASES.md), sin el `.m4a`).
   2. **Repetir con cada** elemento del diccionario (las claves).
   3. Dentro: **Obtener valor del diccionario** (clave: *Elemento de repetición*).
   4. **Crear audio hablado a partir del texto** (en inglés *Make Spoken Audio from Text*; búscala con «audio
      hablado»). Idioma: Español (España). Voz: la que descargaste. Velocidad algo por debajo de la mitad suena
      más pausada y elegante.
   5. **Establecer nombre** del audio: *Elemento de repetición* (el nombre del archivo).
   6. **Guardar archivo** en iCloud Drive, carpeta `BMW voces`, con «Preguntar dónde guardar» desactivado.
3. **Ejecuta el atajo:** en la carpeta `BMW voces` de la app Archivos aparecen los nueve `.m4a`. Escúchalos y, si
   alguno no te gusta, cambia su texto y vuelve a ejecutarlo.
4. **Súbelos a esta carpeta `voces/`**: mándamelos en el chat y los subo yo, o súbelos desde GitHub
   (*Add file → Upload files*). El Store los instala con la app en la siguiente actualización.

También puedes grabarlas con tu voz (Notas de voz del iPhone guarda `.m4a`), siempre con el mismo nombre de archivo.

## 2. El aviso en el iPhone (gasolinera en Waze)

1. Instala **ntfy** (gratis, App Store).
2. Abre *Copiloto de voz* en el coche: en el recuadro *Aviso al iPhone* aparece el tema, por ejemplo
   `bmw-3fa9c1d27e4b8a06d2`. En ntfy, pulsa **+** y suscríbete a ese tema en el servidor `ntfy.sh`.
   Es un nombre al azar que solo conoce tu coche: quien lo sepa puede leer los avisos, así que no lo compartas.
3. Pulsa **Probar el aviso al iPhone** en el coche. Te llega «Falta de combustible»: al tocarlo se abre Waze
   buscando la Shell más cercana y, con CarPlay conectado, sale en la pantalla del coche.

El coche necesita internet para el aviso: el *uplink* del MGU Store (MGU Store → Ajustes → Wi-Fi, el punto de
acceso del iPhone). Sin internet la frase suena igual y la pantalla dice por qué no llegó el aviso.

El iPhone no deja que otra cosa abra una app sin que lo toques: por eso es un aviso que tocas, no Waze abriéndose solo.

## 3. Cómo suena (y qué falta probar en el coche)

Hace sonar la frase como lo hace RideTube (JustAnotherPU/ridetube, probado en un X5 G05): el gestor de audio de BMW
conecta la fuente de medios de las apps a los altavoces, el reproductor de BMW reproduce el archivo y después se
desconecta. **Mientras habla, la música se pausa**; al terminar vuelve la fuente que sonaba (radio, CarPlay...).
Si RideTube está reproduciendo un vídeo, no habla por encima.

Esto todavía no se ha probado desde una app como esta (RideTube lo hace desde un servicio aparte). Con **Probar la
siguiente frase** se oye cada frase en orden, y la pantalla dice qué ha pasado:

- *Audio: última: …*: ha sonado.
- *audio connect: …* o *the media player could not play it*: el coche no lo deja hacer desde una app, o el
  reproductor no puede abrir el archivo. La app prueba sola una copia del archivo en su carpeta de datos.
  Mándame el registro (`copiloto_voz.log`) y lo arreglamos.

## Memoria y CPU

Corre siempre, también con la pantalla cerrada: escucha cuatro señales que el coche manda cuando cambian y hace una
cuenta cada 5 s. Sin la pantalla abierta no dibuja nada. El sonido lo reproduce el reproductor de BMW, no la app.

## Pruebas

`node tools/test_copiloto_voz.js`: los eventos (subir, arrancar, bajar, repostar, hielo, pausas, reinicio en marcha),
la frase según la hora y la secuencia del audio contra un gestor de audio simulado.
