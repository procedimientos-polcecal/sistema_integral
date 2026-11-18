import type { SupabaseClient } from "@supabase/supabase-js";
import type { Notificacion } from "./notificaciones";
import type { Foto } from "./movimiento";
import { SIN_AVISOS } from "./fotoDeAvisos";
import { esHoraDeAvisar } from "@/lib/core/avisoAlInstante";

/**
 * El vistazo anterior: contra qué compara el aviso al instante.
 *
 * Por qué es otra tabla y no `avisos_fotos`, y por qué el borrado es parte del
 * contrato y no un detalle, está en el encabezado de la migración
 * `20261117084425_vistazo_de_avisos.sql`. Acá están las tres operaciones y lo
 * que hay que saber de cada una.
 *
 * ── UNA ADVERTENCIA DE EMPAQUETADO ───────────────────────────────────────────
 *
 * Este archivo vive en `lib/home/` —de donde la campana importa cosas en el
 * cliente— y arrastra `lib/core/avisoAlInstante.ts`, que importa `web-push`,
 * que es sólo de Node. Hoy no rompe porque **nada del cliente lo importa**: lo
 * usa únicamente el cron. Si alguna pantalla llegara a importarlo, el build de
 * Next falla con `Module not found` y ni `tsc` ni los tests lo ven venir — ya
 * pasó una vez, con `lib/compras/sheets.ts`.
 */

/** La tabla la escribe y la lee sólo el cliente admin: no tiene policies. */
const TABLA = "avisos_vistos";

/**
 * Lo que había en la corrida anterior, con la hora en que se guardó.
 *
 * `cuando: null` es que no hay ninguna corrida anterior: la primera de todas.
 *
 * **Es una sola consulta a propósito.** `ultimaFoto` necesita dos —primero la
 * fecha más alta, después sus filas— porque guarda una foto por día; acá hay
 * una sola fila por aviso, unas veinte en total, así que se traen todas y la
 * hora sale de cualquiera de ellas. De paso se evita el agujero que aquélla
 * tuvo: una segunda consulta cuyo error se tragaba y devolvía un mapa vacío,
 * que el llamador no distingue de "no había nada".
 *
 * **`error` y «no hay vistazo» son cosas distintas y el llamador las trata
 * distinto.** Entre el deploy y la aplicación de la migración —que la hace una
 * persona a mano— la tabla no existe. Confundir eso con la primera corrida
 * deja al cron guardando y no mandando nunca, sin que nadie se entere.
 */
export async function ultimoVistazo(
  admin: SupabaseClient
): Promise<{ cuando: string | null; vistos: Foto; error?: string }> {
  const { data: filas, error } = await admin
    .from(TABLA)
    .select("notificacion_id, cantidad, visto_en");

  if (error) return { cuando: null, vistos: new Map(), error: error.message };

  const todas = (filas ?? []) as { notificacion_id: string; cantidad: number; visto_en: string }[];
  if (todas.length === 0) return { cuando: null, vistos: new Map() };

  return {
    // Todas las filas se escriben juntas, así que llevan la misma hora.
    cuando: todas[0].visto_en,
    vistos: new Map(
      todas.filter((f) => f.notificacion_id !== SIN_AVISOS).map((f) => [f.notificacion_id, f.cantidad])
    ),
  };
}

/**
 * Deja en la tabla **exactamente** los avisos de ahora.
 *
 * Reemplaza, no acumula, y eso es el contrato del que depende el flanco de la
 * salud: un recurso que se arregló tiene que salir de la tabla, o el día que
 * vuelva a romperse ya figura como visto y no se avisa nunca más. Un `upsert`
 * sin borrado deja las filas viejas para siempre y rompe el flanco en
 * silencio.
 *
 * **El orden importa**: borrar y después escribir. Al revés, el borrado se
 * llevaría lo recién escrito.
 *
 * **Los dos fallos posibles no son iguales, y el llamador tiene que saberlo:**
 *
 *   - si el borrado anda y la escritura falla, la tabla queda vacía: la
 *     corrida siguiente ve `cuando: null`, se trata como la primera y **no
 *     manda nada**. Se pierde una pasada de quince minutos, que es el lado
 *     seguro del fallo;
 *   - si falla **el borrado**, la tabla queda **congelada** con los valores
 *     viejos, y entonces cada corrida vuelve a calcular la misma novedad
 *     contra la misma referencia: **el mismo push cada quince minutos hasta
 *     las nueve de la noche**, cuarenta veces. Por eso el `error` de esta
 *     función no es para loguear y seguir: quien la llama tiene que contestar
 *     con un código de error, o el log va a decir 200 cuarenta veces mientras
 *     el teléfono de alguien suena cuarenta veces.
 *
 * Recibe `{ id, cantidad }` y no `Notificacion` entera porque lo que se guarda
 * son esos dos campos, y porque el llamador a veces arma filas que no son
 * avisos de nadie: ver el arrastre de la salud en el cron.
 */
export async function guardarElVistazo(
  admin: SupabaseClient,
  avisos: { id: string; cantidad: number }[],
  cuando: string
): Promise<{ error?: string }> {
  // El `neq` está porque PostgREST se niega a borrar sin ningún filtro, y
  // ningún id de aviso es la cadena vacía.
  const { error: errorAlBorrar } = await admin.from(TABLA).delete().neq("notificacion_id", "");
  if (errorAlBorrar) return { error: errorAlBorrar.message };

  // Una corrida sin ningún aviso **igual deja marcada la hora**, con la
  // centinela. Sin ella `cuando` volvería a ser null y la corrida siguiente se
  // trataría como la primera: tampoco mandaría nada.
  const filas =
    avisos.length === 0
      ? [{ notificacion_id: SIN_AVISOS, cantidad: 0, visto_en: cuando }]
      : avisos.map((a) => ({ notificacion_id: a.id, cantidad: a.cantidad, visto_en: cuando }));

  const { error } = await admin.from(TABLA).insert(filas);
  return error ? { error: error.message } : {};
}

/**
 * Si esta corrida tiene que mandar algo, o sólo guardar.
 *
 * Son dos frenos y los dos son AND:
 *
 *   - **la ventana 7:00–21:00 de Argentina**, la misma que el resto de los
 *     avisos al instante. Se importa de `avisoAlInstante.ts` en vez de
 *     repetirse: dos ventanas que pueden separarse terminan en un push a las
 *     tres de la mañana que nadie entiende de dónde salió. Fuera de hora no se
 *     encola nada, **y el repesque de la noche no es el resumen de las 8:30**
 *     —ése manda sólo los lunes— sino esta misma tabla: el vistazo no se borra
 *     a la noche, así que la corrida de las 7:11 compara contra las 20:56 del
 *     día anterior y lo que pasó de madrugada sale ahí. Decirlo importa porque
 *     el día que alguien agregue un corte o cambie el horario del cron, la red
 *     que lo sostiene es ésta y no aquélla;
 *   - **tiene que haber un vistazo anterior.** Sin él no hay con qué comparar
 *     y todo parecería nuevo: un push de estreno con el stock entero rotulado
 *     como novedad, que es exactamente lo que este diseño evita.
 *
 * En los dos casos el llamador igual guarda el vistazo. "Nada" es nada que
 * **mandar**, no nada que hacer.
 */
export function queMandarAhora({
  cuando,
  ahora,
}: {
  cuando: string | null;
  ahora: Date;
}): "nada" | "novedades" {
  if (!esHoraDeAvisar(ahora)) return "nada";
  if (cuando === null) return "nada";
  return "novedades";
}

/** El id que `avisosDeSalud` emite cuando no pudo leer la salud. */
const SIN_COMPROBAR = "salud-sin-comprobar";

/**
 * Lo que el vistazo tiene que guardar cuando **la salud no se pudo
 * comprobar**.
 *
 * `leerLaSalud` falla cerrado: si la vista `ultima_sincronizacion` no
 * contesta, devuelve cero caídas y emite su propio aviso,
 * `salud-sin-comprobar`. Eso está bien para la campana —«no sé» no es «todo
 * bien»— pero sería un desastre para el vistazo: los `salud-*` que sí estaban
 * caídos desaparecerían de la tabla, y la corrida siguiente, al verlos volver,
 * **dispararía el flanco de nuevo** — un push por cada recurso roto, a
 * `admin_sistema`, sin que nada se haya roto. Y como `salud-sin-comprobar`
 * está en `CRECE_CON_EL_DIA`, el instantáneo tampoco avisa que el vigilante se
 * quedó ciego: el admin vería el re-anuncio sin la causa.
 *
 * Así que en esa corrida los `salud-*` del vistazo anterior **se arrastran tal
 * cual**. Una lectura que falló no afirma nada —ni que siguen rotos ni que se
 * arreglaron—, y arrastrarlos es lo único que no inventa una novedad.
 *
 * Lo que esto **no** cubre, dicho: un recurso que se rompe justo durante la
 * corrida ciega no se ve hasta la siguiente. Quince minutos tarde, que es el
 * lado barato del error.
 */
export function conLaSaludQueNoSePudoComprobar(
  todos: { id: string; cantidad: number }[],
  vistos: ReadonlyMap<string, number>
): { id: string; cantidad: number }[] {
  if (!todos.some((a) => a.id === SIN_COMPROBAR)) return todos;

  const ahora = new Set(todos.map((a) => a.id));
  const arrastradas = [...vistos]
    .filter(([id]) => id.startsWith("salud-") && !ahora.has(id))
    .map(([id, cantidad]) => ({ id, cantidad }));

  return [...todos, ...arrastradas];
}
