# Prueba en el coche: todo lo del 25 y 26 de noviembre (unos 25 minutos)

Todo está en la rama **pruebas** de `46Wen/apps`. Nada de esto se ha probado todavía en el coche. Marca cada punto
con sí / no y haz las fotos marcadas con 📷.

## 1. Instalar (10 min, coche arrancado)

1. **Store:** desinstala **Cluster Themes** e instala **M Cluster**. No tengas las dos a la vez.
2. **Store → actualizar todo.** Versiones esperadas:

| App / herramienta | Versión |
|---|---|
| M Cluster | 0.2.1 (nueva) |
| Copiloto de voz | 0.8.3 |
| Ambient config | 2.7.2704 |
| Audio probe | app 0.6.0, herramienta 0.6.0 |
| Music level | 0.1.1 |
| RideTube | 0.6.401, servicio 0.5.401 |
| Redline / Draggy / Dyno | 2.0.5401 / 2.7.301 / 1.6.6 |
| Maps on cluster | 0.6.17 (Waze on Cluster 0.14.17, cluster-render 0.8.14) |

3. **Reinicia la unidad una vez**, aunque no lo pida (el servicio antiguo de RideTube sigue en marcha hasta entonces).
4. 📷 La lista del Store con las versiones (o el mensaje si alguna falla).

## 2. CarPlay (durante toda la prueba)

- Conecta CarPlay con Waze navegando. Apunta: ¿conecta solo y a la primera? ¿Cuánto tarda?
- Apunta la hora si se corta, se queda lento o la música da saltos.

## 3. M Cluster (3 min)

1. En **Comfort** y **Eco Pro**: el cuadro de BMW de siempre, con el mapa de Waze. ¿Sí?
2. Pasa a **Sport** y a **Sport+**: sale el cuadro M en uno o dos segundos. ¿Sí?
3. ¿Se ven los **recuadros negros**? Si salen: 📷 foto del cuadro (que se vea dónde están), y sin salir de Sport abre
   **M Cluster → Log → Cluster slots**: 📷 foto de esas líneas (dicen qué está dibujando BMW en cada hueco del cuadro).
   Prueba también a poner D y R con el freno pisado y repite la foto del Log si cambian.
4. Vuelve a Comfort: ¿vuelve el mapa de Waze al cuadro de BMW?

## 4. Música y Music wave (5 min)

1. Música por Bluetooth o USB. Abre **Audio probe**: la barra **Nivel de la música en vivo** ¿se mueve con la música?
   - Si no: 📷 foto de la línea en naranja (dice el motivo). Pulsa **Explorar SmartXbar**, espera, y en **Informe**
     📷 fotos de las dos primeras páginas (sección **Music level**).
2. Repite con **CarPlay** sonando: ¿qué pone a la derecha de la barra?
3. **Ambient config → Animations → Music wave**: ¿va más viva cuanto más alto suena la música?
4. **Ambient config → Settings → Animation pace**: está en **Light**. ¿Las animaciones se ven bien o a saltos?
   Si van a saltos, prueba **Normal** y dime cuál prefieres.

## 5. RideTube (3 min)

1. Ábrelo: sale «Arrancando el servicio de RideTube...» y en unos segundos funciona. ¿Sí?
2. Pon un vídeo y páusalo: al minuto pregunta **«¿Sigues aquí?»**. Pulsa **Sí**: sigue. ¿Sí?
3. Otro minuto en pausa y no contestes: a los 30 s pone «RideTube en pausa». ¿Sí?
4. Sal de la app y vuelve a abrirla: arranca otra vez solo. ¿Sí?

## 6. Copiloto de voz y apps de conducción (2 min)

1. ¿Bienvenida al arrancar y fin de viaje al apagar, como siempre?
2. Abre **Redline** o **Draggy** y sal: deben seguir funcionando igual al volver.

## 7. Al final (2 min)

1. Abre **Sysmon**: 📷 foto (CPU y memoria con todo funcionando).
2. Dime si CarPlay ha ido mejor que antes.
3. Si CarPlay sigue fallando: el siguiente paso es quitar unos días el parche del mapa en la app de Waze
   (**Maps on cluster**) para ver si el culpable es Waze on Cluster.

## Qué mandarme

Las fotos 📷 y un sí / no por punto. Con eso:
- **Music level:** si no da nivel, la sección Music level dice el motivo exacto y lo arreglo.
- **Cuadro:** si siguen las cajas negras, busco otra forma de quitarlas.
- **CarPlay:** según lo que apuntes, decidimos si probar sin el parche de Waze.
