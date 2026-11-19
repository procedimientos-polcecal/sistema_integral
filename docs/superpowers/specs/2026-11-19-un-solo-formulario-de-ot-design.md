# Un solo formulario de orden de trabajo

19/11/2026 · diseño corto

## Qué y por qué

Generar una OT desde un aviso abre hoy un formulario **recortado**
(`GenerarOTModal`), distinto del que abre «Nueva OT» en Órdenes de trabajo
(`NuevaOTModal`). El pedido es que sea el mismo.

El disparador es concreto y lo dio el usuario: **le faltó poder cargar el
contratista**. Desde un aviso ese campo no existe, así que hubo que generar la
orden y después ir a Órdenes de trabajo a completarla —o cargarla de cero
allá y perder el enlace con el aviso—.

No es un campo suelto. El formulario del aviso no dibuja **once** cosas que el
completo sí: repuestos utilizados, horas estimadas, contratista, operario 1 a
3, fecha de creación, fecha de cierre, estado inicial, «requiere parada de
sector», la falla (cuando la orden nace cerrada) y «reutilizar el número de una
OT dada de baja». Además manda por un `fetch` pelado en vez de la cola.

Y tiene un callejón sin salida escrito en el propio archivo: si la regla de
obligatorios crece y pide un campo que esta pantalla no sabe dibujar, aparece
un cartel que dice *«esta pantalla no sabe preguntar X: la orden hay que
cargarla desde Órdenes de trabajo»*. Existe porque ya pasó.

## Lo que ya está compartido, y que es lo que hace esto chico

Las dos mitades caras **ya son una sola**, y conviene saberlo antes de
estimar:

- **La misma ruta.** Los dos postean a `/api/mantenimiento/ordenes`.
- **La misma regla de obligatorios.** Los dos llaman a `loQueFaltaParaCrear`
  de `lib/mantenimiento/altaDeOT.ts`. Se unificó el 19/10/2026 porque tenerlas
  separadas dejó el botón de generar OT contestando «falta la especialidad» sin
  generar nada durante días: la regla era una lista de strings en un archivo y
  el botón un `JSON.stringify` a mano en otro, y nada los cruzaba.
- **El enlace al aviso es un solo campo.** `aviso_id` en el cuerpo; la ruta
  llama sola a `marcarElAviso`, que escribe `work_order_id`, `ot_asignada` y lo
  exporta a la planilla.
- **Los vocabularios** (`ESPECIALIDADES`, `TIPOS_DE_OT`, `QUIENES_DE_OT`) se
  importan de `lib/` en los dos. Eran listas propias y divergentes hasta el
  21/10/2026.

Lo único que sobra, entonces, es **el dibujo de los campos**.

## Objetivos

- Que desde un aviso se pueda cargar todo lo que se puede cargar desde Órdenes
  de trabajo, el contratista incluido.
- Que quede **un** formulario de OT en Mantenimiento, no dos parecidos.
- Que el aviso siga proponiendo lo que sabe —sector, equipo, descripción,
  prioridad— y que el enlace al aviso siga funcionando igual.

## No objetivos

- **`FormularioOTOffline`** (`app/cargar`) no se toca. Es el tercer formulario
  de OT del sistema y vive fuera del grupo `(app)` justamente porque tiene que
  dibujarse sin servidor. Unificarlo es otro trabajo.
- **No se cambia la regla de obligatorios** ni la ruta.
- **No se toca el aviso.** Sigue diciendo lo que escribió quien reportó la
  falla, que es lo que lo hace una prueba de qué se reportó y cuándo.

## Anti-objetivo

Que queden **dos** formularios completos. Sería el fracaso aunque funcionara el
día que se entrega: es exactamente la forma del bug de octubre —dos mitades que
tienen que decir lo mismo, en archivos distintos, sin nada que las cruce— y la
segunda vez no habría excusa.

## Restricciones

- El árbol está compartido con otras sesiones: se commitea con rutas
  explícitas, nunca `git add -A`.
- Un desplegable se escribe `<Select>`, no `<select>`.
- `className="input w-20"` no mide 20: `.input` está fuera de capa y su
  `width: 100%` le gana a cualquier `w-*` al lado. El ancho va en un `div` que
  envuelva al campo.
- Una grilla de tres o más columnas lleva breakpoint.

## Approaches

**A. La pantalla de avisos abre `NuevaOTModal`, sembrado desde el aviso.**
`GenerarOTModal` se borra. **Elegida.**

**B. Sacar un `FormularioDeOT` compartido** que usen los dos modales. Más
prolijo en el papel y hoy no compra nada: la regla y la ruta ya son
compartidas, y lo único duplicado es el dibujo. Además obliga a decidir qué
hacer con el tercer formulario, el de `/cargar`, que es un rediseño más grande
que lo pedido. Si algún día entra ése, se hace entonces.

**C. Copiarle a `GenerarOTModal` los once campos que le faltan.** Descartada:
es la forma exacta del bug de octubre. Dos formularios que tienen que decir lo
mismo terminan diciendo cosas distintas, y nada avisa.

## Cómo queda

`NuevaOTModal` recibe un **aviso opcional**. Sin aviso se comporta igual que
hoy. Con aviso:

1. **Arranca sembrado** con `loQuePropone(aviso, …)`: descripción, sector,
   equipo, prioridad derivada de la urgencia, tipo `CORRECTIVO`, `quien`
   `INTERNO` y la fecha de inicio en hoy. El GUT arranca **vacío** a propósito
   —tres desplegables en 3 fabricarían un 27 que nadie contestó—.
2. **Dice de dónde viene**: «Del aviso A123. Viene con lo que el aviso dice;
   todo se puede corregir antes de crearla, y el aviso no se toca.»
3. **Avisa lo que el aviso no trae** (`loQueElAvisoNoTrae`), en la misma barra
   ámbar que ya usa «reutilizar una OT» para decir que esos campos no los
   escribió quien está mirando.
4. **Manda `aviso_id` y `repuesto`** en el cuerpo, que es lo que hace que la
   ruta marque el aviso.
5. **El mensaje de éxito** nombra la OT y dice que el aviso quedó marcado, y
   avisa aparte si no se pudo marcar en la planilla (`aviso_error`).

`AvisosClient` abre `NuevaOTModal` en vez de `GenerarOTModal`.
`GenerarOTModal.tsx` se borra; el tipo `EquipoDelAviso` que hoy vive ahí —y que
importa `avisos/page.tsx`— se muda a `lib/mantenimiento/otDesdeAviso.ts`.

De `otDesdeAviso.ts` **sobreviven** `loQuePropone`, `loQueElAvisoNoTrae` y los
tipos. **Se retiran** `loQueHayQuePreguntar` y `CAMPOS_QUE_DIBUJA` —con el
formulario completo no hay campo que la regla pida y la pantalla no sepa
dibujar, así que el callejón sin salida desaparece— y `loQueFaltaDelAviso` y
`cuerpoDeLaOT`, cuyo trabajo lo hace `NuevaOTModal`, que ya valida con
`loQueFaltaParaCrear` sobre su propio estado. Sus tests se ajustan en la misma
tanda: los de `loQuePropone` y `loQueElAvisoNoTrae` quedan, y los de las
funciones retiradas se reemplazan por los del sembrado nuevo.

## Tres decisiones que tomé yo, para que las mires

**1. «Estado inicial» y «fecha de cierre» quedan visibles desde un aviso**, y
eso contradice un comentario que hoy está escrito en `cuerpoDeLaOT`: *«una OT
que nace de un aviso no nace cerrada: se está pidiendo trabajo, no cargando
trabajo hecho»*. Lo dejo visible por tres razones: el pedido fue el mismo
formulario; registrar trabajo ya hecho contra un aviso es un caso real —lo
arreglaron y lo están anotando—; y no queda sin control, porque
`loQueFaltaParaCrear` ya exige las horas y quién la hizo cuando hay fecha de
cierre. **El comentario se actualiza, no se borra en silencio.**

**2. El envío va por `mandarOEncolar`**, igual que el formulario completo, sin
excepción para el aviso. A la pantalla de avisos **no se llega sin señal** —vive
dentro de `(app)`, cuyo layout le pregunta al servidor quién sos, y el service
worker contesta con `/cargar` cualquier navegación que se quede sin red—, así
que el único caso es que la pantalla haya cargado con señal y se haya caído
mientras se completaba. Ahí la orden queda encolada y **el aviso no queda
marcado hasta que se mande**, así que por un rato la lista lo muestra como
pendiente. Se acepta: hacer que desde un aviso exija señal sería volver a tener
dos conductas para lo mismo, que es lo que descartó la C.

**3. «Reutilizar una OT» queda visible desde un aviso**, y traer una vieja
**pisa lo que el aviso propuso** —copia todo menos las fechas—. Es correcto:
quien aprieta «Traer» está eligiendo explícitamente reciclar. Pueden quedar las
dos barras ámbar a la vez, la del aviso y la del reciclado; las dos dicen
cosas distintas y ninguna es ruido.

## Qué queda para quien lo construya

- Cómo mapear `RespuestasDelAviso` sobre el estado de `NuevaOTModal`, que tiene
  más campos. Lo que no venga del aviso queda con el valor por defecto que ya
  tiene el formulario.
- Dónde poner el encabezado y la barra ámbar del aviso dentro del `<form>`.
- Si el título del modal cambia a «Generar la orden de trabajo» cuando viene de
  un aviso, o queda «Nueva Orden de Trabajo» con el subtítulo del aviso abajo.

## Cómo se comprueba

Las pantallas no tienen tests, así que lo que se puede fijar con vitest es el
sembrado (`loQuePropone`) y la advertencia (`loQueElAvisoNoTrae`), que ya
tienen suite. Lo demás es `npx tsc --noEmit`, `npm test`, `npm run build`,
`node scripts/revisar-responsive.mjs` y `node scripts/revisar-exportaciones.mjs`
—este último importa aunque acá no se escriba ninguna planilla: si marca algo,
quiere decir que se tocó un camino de escritura sin querer—.

La prueba que no da ningún script: **generar una OT desde un aviso con un
contratista cargado**, y ver que la orden queda con el contratista y el aviso
queda marcado.
