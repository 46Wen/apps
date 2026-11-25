# Copiloto de voz

Su BMW le habla: frases grabadas, de usted, cuando pasa algo. Arranca sola con el coche y trabaja en segundo plano,
también con la pantalla cerrada.

## Los avisos, por prioridad

Si dos coinciden, suena antes el de número más bajo; **nunca dos voces a la vez**. **Durante una llamada no habla**:
los avisos esperan a que cuelgue. Un aviso que lleva más de 2 minutos esperando se descarta (ya no vendría a cuento),
salvo el de combustible y el de neumáticos.

| # | Aviso | Cuándo | Cada cuánto |
|---|---|---|---|
| 1 | Combustible | autonomía de 50 km o menos (ajuste): «Nivel de combustible bajo» | una vez, hasta repostar |
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

Solo lee del coche (la batería, con diagnosis de solo lectura). Lo único que hace es reproducir sonido. No necesita
internet ni el móvil.

## Idiomas y voces

Español, chino (mandarín) e inglés (británico), cada uno con voces naturales femeninas y masculinas. En el coche:
**Ajustes → Idioma de la voz** y **Voz en …** (una por idioma). Por defecto, español con **Elvira**, la voz femenina de
España más parecida a «Penélope» de Waze (la de Waze es de Google y no se puede sacar de Waze ni detectar).

| Idioma | Femeninas | Masculinas |
|---|---|---|
| Español | Elvira (por defecto), Ximena | Álvaro |
| Chino | Xiaoxiao, Xiaoyi | Yunxi, Yunjian |
| Inglés | Sonia, Libby | Ryan, Thomas |

**Dónde se instalan:** las grabaciones son una herramienta aparte del Store, **copiloto-voz-voces**, que se instala sola con la app en `/var/opt/copiloto-voz-voces/current/`. El reproductor de BMW abre los archivos con su propio usuario y no puede leerlos dentro de la carpeta de una app (ITEM_UNPLAYABLE); en `/var/opt` sí, como el audio de RideTube. `scripts/voces_componente.py` hace su `component.json` (y lo ejecuta `generar_voces.py`).

Las frases (14, en los 3 idiomas) están en [`voces/frases.json`](voces/frases.json); las grabaciones van en
`voces/<idioma>/<voz>/<aviso>.m4a` (AAC, como RideTube: el reproductor del coche rechaza el MP3). Si falta una frase en la voz elegida, se usa la misma frase de otra voz del idioma.

**Cambiar las frases:** con la página editora (`tools/editor_frases.html`, también publicada como artifact): una tabla
aviso × idioma, botón ▶ para escucharla con la voz del navegador, y descargar o copiar `frases.json`. Póngalo en
`voces/frases.json`.

**Generar las voces (en el PC, con internet):**

```
py -m pip install edge-tts
winget install ffmpeg                      (para pasar las voces a M4A)
py scripts\generar_voces.py               (todas; solo rehace las frases que cambiaron)
py scripts\generar_voces.py --idioma es   (solo español)
```

Luego commit y push, y actualizar la app desde el MGU Store. Son 154 archivos (14 frases × 11 voces), unos 11 MB.

## La pantalla

Tres páginas (**Cambiar página** en el menú):

- **Avisos**: estilo BMW, un recuadro por aviso, con su icono, su prioridad y si está activo, en cola, hablando o
  cuándo sonó; «sin grabación» si falta su frase. El último recuadro: lo que lee del coche.
- **Diagnóstico** (la lista de comprobación): cada señal del coche con ✓ (verde: llega, con su último valor), gris
  (aún no ha llegado) o rojo (error al suscribirse, con el motivo); la voz (grabaciones encontradas y cuáles faltan, el
  audio del coche, llamada); y el resultado de cada uno de los 11 avisos (de la demo o de la última vez que sonó).
- **Registro**: las últimas líneas del registro en la pantalla (avisos en ámbar, errores en rojo), para ver qué falla
  exactamente sin sacar el archivo `copiloto_voz.log`.

Arriba: el idioma y la voz, el estado de la voz y del coche.

## Demo: viaje simulado

**Demo: viaje simulado con los 11 avisos** (solo con el coche parado): simula un viaje completo (batería baja,
mantenimiento y aviso de neumáticos antes de salir; arranque; hielo y motor frío a los dos minutos; autonomía de 45 km;
dos horas conduciendo; aceite a 85 °C; ventanilla abierta y apagado) con las mismas reglas que el coche, y pasa los 11
avisos por la cola y el altavoz de verdad, por orden de prioridad (unos dos minutos). No toca las señales del coche.
Se abre la página Diagnóstico: cada aviso en azul (en cola), verde (sonó) o rojo con el motivo (p. ej. «falta la
grabación», «el coche no conectó el audio», «el reproductor no pudo con el archivo»). Lo que no suena en 5 minutos sale
en rojo. El detalle, en la página Registro. **Probar la siguiente frase** sigue reproduciéndolas una a una.

## Cómo suena

Como RideTube (JustAnotherPU/ridetube, probado en un X5 G05): el gestor de audio de BMW conecta la fuente de medios
de las apps a los altavoces, el reproductor de BMW reproduce la frase y se desconecta. **Mientras habla, la música se
pausa**; al terminar vuelve la fuente que sonaba. **La voz pasa por encima de todo:** radio, CarPlay o Bluetooth se cortan mientras habla y vuelven después; un vídeo de RideTube se detiene y queda en pausa donde estaba (se reanuda con Play).

## Por comprobar en el coche

Todo está probado fuera del coche, no en él todavía. Si algo no funciona, la pantalla y el registro
(`copiloto_voz.log`) dicen por qué:

- **El sonido** desde una app (RideTube lo hace desde un servicio): la demo.
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
lectura de las señales, la frase según la hora, la secuencia del audio, la carpeta de cada voz, las frases en los 3
idiomas y la demo (63 comprobaciones).
