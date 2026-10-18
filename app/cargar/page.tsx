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
 * Que esta pantalla quede guardada para poder abrirse sin conexión es la tarea
 * 7 del plan; hasta entonces se puede abrir con señal como cualquier otra.
 */
export default function CargarPage() {
  return <CargarClient />;
}
