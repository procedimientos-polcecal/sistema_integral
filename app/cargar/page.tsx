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
 * Mantenimiento. No se le avisa antes de escribir, y es una decisión: desde el
 * navegador no hay cómo saberlo sin inventarlo —los catálogos que baja esta
 * pantalla son `equipos` y `sectores`, que son del núcleo y los lee cualquier
 * autenticado, así que no hay un 403 del que enterarse—, y un cartel genérico
 * para todos sería ruido permanente para los trece que sí tienen acceso. Lo que
 * sí pasa es que **se entera con el texto de la ruta y no con uno inventado**:
 * con señal, el alta contesta «Cargar un aviso requiere nivel de edición en
 * Mantenimiento», que para la cola es un fallo definitivo, así que la carga ni
 * se encola y lo escrito queda en el formulario. Sin señal se encola y ese
 * mismo 403 la deja `parada` y a la vista, acá y en la barra del layout —que
 * nunca le esconde a alguien una carga suya, justamente por este camino—.
 *
 * Esta pantalla queda guardada para poder abrirse sin conexión: el `install`
 * de `public/sw.js` la precachea con los archivos que pide. A ella se llega por
 * el menú de Mantenimiento, por la barra de «hay algo esperando» del layout, o
 * porque el service worker la sirve cuando una navegación no tiene red.
 */
export default function CargarPage() {
  return <CargarClient />;
}
