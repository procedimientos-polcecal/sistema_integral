import CargarClient from "./CargarClient";

/**
 * Cargar un aviso o una OT de Mantenimiento, con señal o sin ella.
 *
 * ESTÁ FUERA DEL GRUPO `(app)`, y es lo único que hay que entender de este
 * archivo: `app/(app)/layout.tsx` es `async`, le pregunta a Supabase quién sos
 * y hace `redirect("/login")`. Una pantalla que tiene que dibujarse **sin
 * servidor** no puede vivir ahí abajo — sin conexión ese layout no contesta, y
 * entonces no hay nada que mostrar justo cuando más hace falta.
 *
 * Por eso acá no se consulta nada: es un componente de servidor que devuelve el
 * cliente y se va. Todo lo que se ve lo dibuja el navegador con lo que quedó
 * guardado en el teléfono.
 *
 * EL ACCESO LO SIGUE RESOLVIENDO `proxy.ts` cuando hay señal: `/cargar` pasa
 * por el chequeo de sesión como cualquier otra ruta, y sin sesión va al login.
 * Sin señal no hay servidor a quien preguntarle, y la pantalla no filtra nada:
 * los catálogos que muestra los bajó alguien logueado en este mismo teléfono, y
 * lo que se cargue acá no sale del aparato hasta que haya una sesión válida que
 * lo firme.
 *
 * **Y «no filtra nada» incluye el módulo**: `proxy.ts` sólo exige sesión, y
 * `public/sw.js` contesta con esta pantalla **cualquier** navegación que se
 * quede sin red, así que acá puede aterrizar alguien que no tenga
 * Mantenimiento. No se le avisa antes de escribir, y desde `f7bd2ed` ya no hace
 * falta: **el alta de un aviso no pide el módulo**, la puede cargar cualquier
 * usuario activo —quien ve la máquina rota trabaja en Producción o en la
 * cantera—, así que no hay un permiso del que enterarse antes. Lo que sigue
 * gateado a Mantenimiento es **el menú** que lleva a `/cargar`, no lo que se
 * hace acá. El único rechazo definitivo que le queda al alta de un aviso es el
 * 403 de «Tu usuario está desactivado», y un fallo pasajero de la base contesta
 * 503, que la cola reintenta. Lo que sí pasa es que **se entera con el texto de
 * la ruta y no con uno inventado**: un rechazo definitivo no se encola y lo
 * escrito queda en el formulario; sin señal se encola y ese mismo rechazo la
 * deja `parada` y a la vista, acá y en la barra del layout —que nunca le
 * esconde a alguien una carga suya—.
 *
 * **La OT sí sigue pidiendo nivel de edición en Mantenimiento**, y su 403 se
 * trata igual: es definitivo, y lo que queda parado se ve.
 *
 * Esta pantalla queda guardada para poder abrirse sin conexión: el `install`
 * de `public/sw.js` la precachea con los archivos que pide. A ella se llega por
 * el menú de Mantenimiento, por la barra de «hay algo esperando» del layout, o
 * porque el service worker la sirve cuando una navegación no tiene red.
 */
export default function CargarPage() {
  return <CargarClient />;
}
