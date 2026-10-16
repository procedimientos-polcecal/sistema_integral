# El SdG se instala en el teléfono y se ve bien ahí

Acordado el 16 de octubre de 2026. Es la **fase 1** de cuatro para poder
trabajar desde el celular.

## Lo que se quiere, y por qué en cuatro fases

El pedido fue que el SdG «sea realmente una app, para trabajar con
notificaciones desde el celu», y que sirva para las cuatro cosas que se hacen
desde un teléfono: enterarse, decidir, cargar en el campo y consultar un dato.
Los teléfonos son **mezcla de iPhone y Android**, lo que obliga a resolver los
dos caminos de instalación.

Eso son cuatro subsistemas independientes, y el tercero y el cuarto son de otro
tamaño:

| Fase | Qué |
|---|---|
| **1 — ésta** | Que se instale y que se vea bien: manifest, íconos, instalación explicada por plataforma, y las 22 pantallas del escaneo |
| 2 | Que avise: generalizar el push a los doce módulos sobre `/api/home/avisos`, y arreglar que hoy entre un solo dispositivo por persona. **Lo primero que tiene que hacer: que `enviarPush` mande `data: { url }`.** La fase 1 dejó el `notificationclick` leyendo ese campo, y el único emisor que existe —el cron de Remises— todavía manda sólo `{title, body}`, así que su notificación lleva a `/` en vez de `/mi-remis`. No afecta a nadie hoy porque hay **cero suscripciones**, pero es lo primero que se nota si alguien activa las notificaciones |
| 3 | Leer sin señal: cachear lo último visto |
| 4 | Cargar sin señal: la cola de escritura |

**La fase 1 va primera y no por ser la más chica.** En iPhone las notificaciones
push **sólo se entregan a una app agregada a la pantalla de inicio**: Safari no
las manda a una pestaña común. Así que instalar no es el paso cosmético, es el
requisito técnico de que la fase 2 exista para la mitad del equipo.

La fase 4 queda última a propósito. En este sistema **la planilla manda** en
Compras, Mantenimiento, Inventario y Envases, y un movimiento que no llegó allá
no existe. Un movimiento de stock encolado en el celular que aterriza tres horas
después cae sobre un stock que ya cambió, y nada avisa. Esa cola necesita reglas
propias de qué se puede encolar y qué no, y eso es un spec entero.

## Lo que ya existe (medido el 16/10/2026)

| | |
|---|---|
| `public/sw.js` | service worker con `push` y `notificationclick`. **No tiene `fetch`** |
| `lib/remises/webpush.ts` | envío con `web-push`, limpio |
| `remises_push_tokens` | la suscripción, con **clave primaria en `usuario_id`** |
| `/api/remises/mi-remis/push-token` | GET devuelve la clave pública, POST guarda la suscripción |
| Cron de Remises | avisa el remis asignado para mañana, 19:00 de Argentina |
| Claves VAPID | documentadas en `docs/VARIABLES-VERCEL.md`, puestas en Vercel |
| `app/layout.tsx` | ya declara `viewport` con `viewportFit: "cover"` y `themeColor: "#0A0F1C"` |
| El armazón | el sidebar de 240 px se vuelve un cajón abajo de `md`; `<main>` tiene `p-4 md:p-6` y `min-w-0` |

Y las dos cosas que faltan o están mal:

- **No hay `manifest.json`.** Por eso la app no se puede instalar: en el teléfono
  es una pestaña, no un ícono.
- **Hay cero suscripciones push**, sobre 14 usuarios activos. El código de
  Remises existe pero **nunca lo activó nadie**, así que nada de esto está
  probado en producción: ni que las claves VAPID estén bien, ni el límite de un
  dispositivo por persona, que nunca mordió porque nadie se suscribió.

## 1. Cómo se instala

### Android

Aparece una barra: «Instalar el SdG en tu teléfono», con un botón. Se toca,
Chrome pregunta, y queda el ícono. Un toque.

La barra sale de capturar `beforeinstallprompt`, que Chrome dispara sólo si la
app cumple los criterios de instalabilidad. Se guarda el evento y el botón lo
dispara con `prompt()`.

### iPhone

**No hay botón posible.** Apple no permite que una web dispare la instalación,
así que el gesto lo hace la persona: **Compartir → Agregar a inicio**, en
Safari. Lo que sí se puede es detectar que es un iPhone y mostrar esos dos pasos
con el ícono de Compartir dibujado, en vez de un botón que no va a funcionar.

### La compu

Chrome y Edge muestran su propio ícono de instalar en la barra de direcciones.
No se hace nada: no estorba y funciona solo.

### Cuando ya está instalada

No se muestra nada. Se detecta con
`window.matchMedia("(display-mode: standalone)")`, más
`navigator.standalone` para el caso de iOS.

### Dónde vive

Una pantalla **`/instalar`** con las instrucciones de la plataforma detectada,
enlazada desde el menú, y una **barra que aparece sola la primera vez** y se
puede descartar. Es el mismo molde que ya usa `mi-remis` para activar
notificaciones: un botón cuando se puede, y un texto que explica por qué no
cuando no se puede.

### Las dos trampas de la instalación

**El service worker necesita un manejador de `fetch`.** El nuestro sólo tiene
`push` y `notificationclick`. Chrome usa la presencia de un `fetch` como
criterio de instalabilidad, así que sin él `beforeinstallprompt` no se dispara y
el botón de Android no aparece nunca — sin ningún error. Se agrega uno de paso,
que no intercepta nada, y que además es el gancho donde la fase 3 va a colgar el
caché. **Hay que verificarlo en un Android real**: el criterio lo define Chrome y
cambió más de una vez.

**Instalar no se lleva la sesión.** En iPhone, una app agregada a la pantalla de
inicio tiene **su propio almacenamiento**, separado del Safari donde se la
instaló. La persona instala, abre, y **le pide la contraseña otra vez**. No es un
error y no se puede evitar; si nadie lo avisa, el primer día parece que la app
está rota. Va escrito en `/instalar`: «la primera vez que la abras te va a pedir
la contraseña de nuevo».

## 2. El manifest

`app/manifest.ts`, que es la ruta de metadata de Next 16 — tipada, no un JSON
suelto:

| | |
|---|---|
| `name` | `SdG — Polcecal / Polysan` |
| `short_name` | `SdG` (es el que entra abajo del ícono) |
| `start_url` | `/` |
| `display` | `standalone` |
| `background_color` / `theme_color` | `#0A0F1C`, el mismo que ya declara `viewport` en `app/layout.tsx` |
| `lang` | `es` |
| `icons` | los de abajo |

## 3. Los íconos, y los 2 MB que se van de paso

`public/logo.png` mide **4266×4266 y pesa 2 MB**, y se sirve tal cual en el
login, en `forgot-password`, en `reset-password`, en los PDF de impresión y como
ícono y badge de las notificaciones. Son 2 MB antes de ver nada, en un teléfono
que puede estar en la cantera con mala señal.

Un script `scripts/generar-iconos.mjs` genera del logo:

- `icon-192.png` y `icon-512.png` — los del manifest
- `icon-512-maskable.png` — con el margen que piden los íconos adaptativos de
  Android, para que el recorte circular no coma el logo
- `apple-touch-icon.png` de 180 — iOS usa éste y no los del manifest
- `logo-320.png` — para las tres pantallas de sesión, que hoy muestran el de
  4266 escalado por CSS

Usa **`sharp` como `devDependency`**. Está en `node_modules` porque lo arrastra
Next, pero depender de una transitiva es frágil; y como `devDependency` no viaja
a producción, porque los íconos se generan a mano y se commitean. El script se
corre cuando cambia el logo, igual que `copiar-activos-del-lector.mjs`.

**Las tres pantallas de sesión pasan a `logo-320.png`.** Los PDF de impresión se
dejan con el grande: salen en papel y ahí la resolución sirve.

## 4. El service worker

Dos cambios, los dos chicos:

**El `fetch` de paso**, por lo de arriba. No cachea nada en esta fase: deja pasar
todo. Va con un comentario que diga que está por la instalabilidad y que es el
gancho de la fase 3, para que nadie lo borre por parecer inútil.

**`notificationclick` deja de abrir siempre `/mi-remis`.** Hoy está cableado, así
que cualquier notificación futura llevaría al mismo lado. Pasa a abrir la URL que
venga en el payload (`data.url`), con `/` de respaldo. Es un cambio de la fase 1
y no de la 2 porque es una línea y porque dejarlo cableado haría que la primera
notificación de la fase 2 lleve al lugar equivocado.

**Y si ya hay una ventana abierta, se enfoca en vez de abrir otra.** Sin eso, cada
notificación abre una pestaña nueva y a los tres avisos hay cuatro copias de la
app.

## 5. Las pantallas: las 22 del escaneo

Se escanearon **313 archivos `.tsx`** buscando lo que no entra en los 343 px
útiles de un teléfono de 375 (375 menos los 32 de padding del layout).

### Lo que ya estaba bien

**95 de 106 tablas ya tienen contenedor con scroll horizontal**, y no hay **ni
un** ancho fijo mayor al ancho del teléfono. El armazón está resuelto. Esta fase
cierra lo que quedó.

### Lo que hay que arreglar

| | Cuántos | Qué se hace |
|---|---|---|
| Tablas sin scroll propio | **5** | Envolver en un contenedor con `overflow-x-auto`, como las otras 95 |
| Grillas de 3 columnas sin breakpoint | **20**, en 13 pantallas | A 110 px por columna no entra una etiqueta con su campo. Pasan a `grid-cols-1 sm:grid-cols-3`, o a `grid-cols-2 sm:grid-cols-3` si lo que llevan son números cortos |
| Filas de formulario de 12 columnas | **2**, en `/cantera/voladuras/[codigo]` | El nombre del insumo ocupa 7 de 12 y los inputs se reparten 143 px. Se apilan abajo de `sm` |

De las 11 tablas sin scroll, **3 son pantallas de imprimir** —una en
`/mantenimiento/planificacion/[id]/imprimir` y dos en
`/remises/hoja-ruta/[id]/imprimir`—: salen en papel y no se tocan. Quedan 5, en
cuatro pantallas: `/inventario/lista` (2), `/cantera/acarreo`, `/remises` y
`/rrhh/liquidaciones`.

Las otras **3** tablas de `/produccion/resumenes` **no faltan**: están dentro de
un componente (`Envoltorio`) que ya pone el `overflow-x-auto` alrededor de sus
hijos. El script no lo ve porque mira 12 líneas hacia arriba, así que las marca
como sin scroll. Son falsos positivos conocidos y van a su lista, en
`scripts/revisar-responsive.mjs`, con el mismo mecanismo que los calendarios.

### Lo que NO se toca, y es importante decirlo

El escaneo marcó **7 grillas como rotas y 5 son calendarios**: las de 7 columnas
de `/remises/semana`, `/cantera/destape` y `/trituracion/partes` son el
calendario del mes con los días de la semana. 49 px por celda es exactamente lo
que mide un día en el calendario de cualquier teléfono. **Ponerles un breakpoint
las rompería**: un calendario de una columna no es un calendario. Queda escrito
acá porque el script los va a seguir marcando.

### Las pantallas, por carga

```
ROMPE  APRET  MIRAR  pantalla
    2      1      0  /trituracion/partes        (2 son calendario: no se tocan)
    2      0      0  /cantera/destape           (los 2 son calendario: no se tocan)
    2      0      0  /cantera/voladuras/[codigo]
    1      0      0  /remises/semana            (calendario: no se toca)
    0      5      0  /mantenimiento/ordenes
    0      2      0  /rrhh/empleados
    0      2      0  /rrhh/empleados/[id]
    0      1      0  /cantera/cubicacion
    0      1      0  /cantera/destape/cargar
    0      1      0  /cantera/tarifas-acarreo
    0      1      0  /inventario/movimientos/nuevo
    0      1      0  /mantenimiento
    0      1      0  /mantenimiento/produccion
    0      1      0  /rrhh/fichadas
    0      1      0  /rrhh/vacaciones
    0      1      0  /taller-vial
    0      1      0  (componente compartido)
    0      0      3  /produccion/resumenes     (las 3 ya tienen scroll heredado: no se tocan)
    0      0      2  /inventario/lista
    0      0      1  /cantera/acarreo
    0      0      1  /remises
    0      0      1  /rrhh/liquidaciones
```

## 6. El script que lo vuelve repetible

El escaneo se queda como **`scripts/revisar-responsive.mjs`**, al lado de
`revisar-arbol-commiteado.mjs` y con la misma idea: que lo que costó encontrar
una vez lo encuentre una máquina la próxima.

Busca los cuatro patrones —tabla sin contenedor con scroll, grilla de 3 o más
columnas sin breakpoint, `w-[Npx]` y `min-w-[Npx]` mayores a 343— y los agrupa
por pantalla con una severidad.

**No va al CI todavía**, por la misma razón que el lint: los 5 calendarios son
falsos positivos conocidos y un CI que está siempre rojo no lo mira nadie. El
script los lista aparte, en una constante con el comentario de por qué. Cuando
esa lista esté estable, se agrega el paso.

**Escribir una pantalla nueva con una grilla apretada no rompe nada, y ése es el
problema** — igual que escribir un `<select>` nativo a mano. No hay error y no
hay test que lo note: esa pantalla simplemente queda inusable en el teléfono, y
nadie se entera hasta que alguien la abre desde la cantera.

## Qué se testea

Vitest sobre funciones puras, que es lo que este repo testea:

- `plataformaDeInstalacion(userAgent, standalone)` en `lib/core/instalacion.ts` —
  devuelve `"android"`, `"ios"`, `"escritorio"` o `"ya-instalada"`. Con los user
  agents reales de Safari en iPhone, Chrome en Android y Chrome en escritorio, y
  el caso de Chrome **en iOS**, que es un iPhone aunque el user agent diga
  `CriOS` y por lo tanto va por el camino de Apple.
- `scripts/revisar-responsive.mjs` se prueba contra casos armados: una tabla con
  y sin contenedor, una grilla con y sin breakpoint, que los calendarios y las
  tablas con scroll heredado de la lista de excepciones no salgan, y que una
  cuarta tabla en esa misma pantalla sí salga.

Lo demás —el manifest, los íconos, el service worker— **no se testea con vitest y
hay que decirlo**: que Chrome ofrezca instalar depende de criterios que define
Chrome, y que iOS muestre el ícono correcto depende de Safari. Eso se verifica en
un teléfono de verdad, y es el paso que necesita una persona.

## Riesgos asumidos

- **El criterio de instalabilidad de Chrome no está bajo nuestro control y
  cambió más de una vez.** El `fetch` de paso es lo que hoy se pide; si Chrome lo
  relaja o lo endurece, el botón de Android puede dejar de aparecer sin que
  cambie una línea nuestra. Por eso la verificación en un Android real es parte
  del trabajo y no un extra.
- **Nada de esto se puede ver desde acá.** Casi todo el SdG está detrás del
  login, así que las correcciones de las 22 pantallas se razonan sobre el código
  y se verifican mirando. Sin esa pasada visual, la fase 1 no está terminada
  aunque el script quede en verde.
- **Que una grilla de 2 columnas entre en 375 px es un juicio, no una medición.**
  El escaneo las deja pasar —165 px por columna alcanzan para un número con su
  etiqueta— pero si alguna lleva un campo de texto con su rótulo, no. Salen en la
  pasada visual o no salen.
- **Los íconos generados se commitean**, así que si alguien cambia `logo.png` y
  no corre el script, el ícono de la app queda con el logo viejo y nada avisa. El
  script va nombrado en el README de `scripts/` y en este spec.

## Pendiente de una persona

Dos cosas que un agente no puede hacer:

1. **Probar la instalación en un teléfono de cada tipo.** Que el botón aparezca
   en Android, que «Agregar a inicio» deje el ícono bien en iPhone, y que la app
   abra en modo standalone sin la barra del navegador.
2. **La pasada visual por las 22 pantallas a 375 px**, con sesión iniciada. El
   navegador del agente puede manejarse solo una vez que haya sesión, pero el
   login lo tiene que hacer una persona.
