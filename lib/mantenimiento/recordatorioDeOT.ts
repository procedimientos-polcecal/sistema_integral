import { diaDeLaSemana, sumarDias } from "@/lib/core/fechas";
import type { Aviso } from "@/lib/core/webpush";
import { fechaParaElCalendario } from "@/lib/agenda/evento";
import { ESTADOS_CERRADOS, estaAtrasada } from "./alertas";

/**
 * Qué órdenes nombra cada corrida del recordatorio de Mantenimiento, y cómo se
 * escribe el aviso. Todo puro: no lee la base, no manda nada y no sabe qué día
 * es —`hoy` entra como parámetro—. La ruta del cron lee, llama y envía.
 *
 * ── EL DOMINGO NO SALE, Y ESO MUEVE LOS DÍAS QUE SE MIRAN ─────────────────────
 *
 * El push no se manda los domingos (pedido), pero sí los sábados. Con la regla
 * «ayer» y «pasado mañana» a secas, saltar el domingo dejaría días huérfanos:
 *
 *  - Lo que cruzó en domingo se miraría el lunes de ayer... que es domingo, y
 *    nadie lo mira. Por eso **el lunes recoge sábado y domingo** (hacia atrás).
 *  - Lo que arranca el martes se miraría el domingo, dos días antes, y el
 *    domingo no corre. Por eso **el sábado adelanta**: mira lunes y martes
 *    (hacia adelante). Ese aviso sale tres días antes en vez de dos, y es
 *    aceptable; uno que no sale nunca, no.
 *
 * El test «ningún día queda sin cubrir» prueba que cada día del mes es mirado
 * por las dos puntas exactamente una vez: ni huérfano ni repetido.
 */

/** Hasta dónde entra la descripción de una orden antes de recortarse. */
const LARGO_DE_LA_DESCRIPCION = 60;

/** Cuántas órdenes se nombran antes de resumir el resto. Igual que los demás resúmenes. */
const CUANTAS_SE_NOMBRAN = 3;

/**
 * A dónde lleva el aviso de las atrasadas. Es el mismo literal que el `href` de
 * `lib/home/avisos.ts`, escrito a propósito en los dos lugares: ese archivo
 * tiene todos sus href inline, y una constante importada para uno solo rompería
 * ese patrón. Si cambia acá, cambia allá.
 */
export const URL_ATRASADAS = "/mantenimiento/ordenes?atrasada=1";

/** A dónde lleva el aviso de las que arrancan: el listado, sin filtro. */
export const URL_LISTADO = "/mantenimiento/ordenes";

/** Lo que hace falta de una orden para decidir si se nombra y para nombrarla. */
export interface OrdenParaRecordar {
  ot_number: number;
  estado: string | null;
  fecha_ejecucion: string | null;
  fecha_ejecucion_pendiente: string | null;
  fecha_fin: string | null;
  sector_raw: string | null;
  descripcion: string | null;
}

/** Qué días de inicio cuentan como «se atrasó» en la corrida de `hoy`. */
export function diasQueCruzaron(hoy: string): string[] {
  // El lunes la corrida anterior fue el sábado: faltan el sábado y el domingo.
  if (diaDeLaSemana(hoy) === 1) return [sumarDias(hoy, -2), sumarDias(hoy, -1)];
  return [sumarDias(hoy, -1)];
}

/** Qué días de inicio cuentan como «arranca en dos días» en la corrida de `hoy`. */
export function diasQueArrancan(hoy: string): string[] {
  // El sábado adelanta el aviso del martes, que le tocaría al domingo.
  if (diaDeLaSemana(hoy) === 6) return [sumarDias(hoy, 2), sumarDias(hoy, 3)];
  return [sumarDias(hoy, 2)];
}

/** El día en que la orden arranca para el calendario, recortado a `aaaa-mm-dd`. */
function inicioEfectivo(orden: OrdenParaRecordar): string {
  const inicio = fechaParaElCalendario({
    fecha_ejecucion: orden.fecha_ejecucion,
    fecha_ejecucion_pendiente: orden.fecha_ejecucion_pendiente,
  });
  return (inicio ?? "").slice(0, 10);
}

/** Las que arrancaban el día que cruzó, y siguen abiertas pasada su ventana. */
export function lasQueSeAtrasaron(ordenes: OrdenParaRecordar[], hoy: string): OrdenParaRecordar[] {
  const dias = diasQueCruzaron(hoy);
  return ordenes.filter((o) => estaAtrasada(o, hoy) && dias.includes(inicioEfectivo(o)));
}

/**
 * Las abiertas que todavía no están atrasadas y arrancan el día que toca.
 * «No atrasada» no alcanza para decir «abierta»: una realizada o cancelada con
 * fecha futura tampoco lo está, y no hay que recordarla.
 */
export function lasQueArrancan(ordenes: OrdenParaRecordar[], hoy: string): OrdenParaRecordar[] {
  const dias = diasQueArrancan(hoy);
  return ordenes.filter(
    (o) =>
      !ESTADOS_CERRADOS.includes(String(o.estado ?? "").toUpperCase()) &&
      !estaAtrasada(o, hoy) &&
      dias.includes(inicioEfectivo(o))
  );
}

const limpio = (t: string | null) => (t ?? "").trim();

function recortar(t: string): string {
  return t.length > LARGO_DE_LA_DESCRIPCION ? `${t.slice(0, LARGO_DE_LA_DESCRIPCION)}…` : t;
}

/** Con una sola orden: número, sector y qué es, lo que deja decidir si hay que entrar. */
function nombreEntero(o: OrdenParaRecordar): string {
  const sector = limpio(o.sector_raw);
  const descripcion = limpio(o.descripcion);
  return (
    `OT ${o.ot_number}` +
    (sector ? ` · ${sector}` : "") +
    (descripcion ? ` — ${recortar(descripcion)}` : "")
  );
}

/** Con varias: número y sector, que es lo que cabe en tres nombres. */
function nombreCorto(o: OrdenParaRecordar): string {
  const sector = limpio(o.sector_raw);
  return `OT ${o.ot_number}` + (sector ? ` (${sector})` : "");
}

function cuerpoDeVarias(ordenes: OrdenParaRecordar[]): string {
  const nombradas = ordenes.slice(0, CUANTAS_SE_NOMBRAN).map(nombreCorto);
  const restantes = ordenes.length - nombradas.length;
  return restantes > 0
    ? `${nombradas.join(", ")} y ${restantes} más`
    : `${nombradas.slice(0, -1).join(", ")} y ${nombradas[nombradas.length - 1]}`;
}

/** El aviso de las que se atrasaron. `null` si no hay ninguna: no se manda un push para decir que no pasa nada. */
export function textoDeLasAtrasadas(ordenes: OrdenParaRecordar[]): Aviso | null {
  if (ordenes.length === 0) return null;
  if (ordenes.length === 1) {
    return { title: "Se atrasó una orden de trabajo", body: nombreEntero(ordenes[0]), url: URL_ATRASADAS };
  }
  return {
    title: `${ordenes.length} órdenes de trabajo se atrasaron`,
    body: cuerpoDeVarias(ordenes),
    url: URL_ATRASADAS,
  };
}

/** El aviso de las que arrancan en dos días. `null` si no hay ninguna. */
export function textoDeLasQueArrancan(ordenes: OrdenParaRecordar[]): Aviso | null {
  if (ordenes.length === 0) return null;
  if (ordenes.length === 1) {
    return { title: "Una orden de trabajo arranca en dos días", body: nombreEntero(ordenes[0]), url: URL_LISTADO };
  }
  return {
    title: `${ordenes.length} órdenes de trabajo arrancan en dos días`,
    body: cuerpoDeVarias(ordenes),
    url: URL_LISTADO,
  };
}
