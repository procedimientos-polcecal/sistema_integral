import type { GrupoDeCuaderno } from "./cuadernoGrupos";
import { repuestoSinElCosto, textoDeRepuesto } from "./costoEnRepuesto";

/**
 * Qué escribe la generación del cuaderno en cada OT.
 *
 * Es pura y es **lo que comparten la vista previa y la generación**: las dos
 * llaman a `valoresDeLaOrden` y a nada más para decidir qué lleva la orden. Si
 * la pantalla armara su propio texto, mostraría una cosa y se crearía otra, y
 * una OT escrita en la planilla no se deshace —se borra a mano, fila por fila—.
 */

/**
 * Los valores de una OT de PIPARO. **No se eligieron: se midieron** sobre sus
 * 380 OT ya cargadas (01/11/2026): `MECÁNICO` 282 · `PROGRAMADO` 292 ·
 * `CONTRATADO` 373 · `REALIZADO` 376.
 *
 * Ojo con el primero: el otro contratista es `CIVIL`. Copiar su default habría
 * puesto 282 órdenes en la especialidad equivocada, y no habría fallado nada.
 */
export const VALORES_DE_PIPARO = {
  especialidad: "MECÁNICO",
  tipo: "PROGRAMADO",
  quien: "CONTRATADO",
  // Nace realizada: es trabajo que ya se hizo y el cuaderno lo prueba.
  estado: "REALIZADO",
} as const;

export type SectorConNombre = { nombre: string; codigo: string | null };
export type EquipoConNombre = { name: string; code: string | null };

/**
 * Cómo se llama el equipo en la planilla.
 *
 * Con equipo, el formato de las órdenes del formulario:
 * `"PO-A1-15 - Cinta transportadora 9"`. Sin equipo, `"<código> - Edificio"`,
 * que es lo que ya dicen las OT del otro contratista que no tienen máquina: no
 * se inventa un texto nuevo para que la planilla tenga dos formas de decir lo
 * mismo. (Las de PIPARO sin equipo dicen «Edificio» a secas, escrito a mano de
 * cualquier manera; no hay una forma que copiar.)
 */
export function equipoParaLaPlanilla(
  equipo: EquipoConNombre | null,
  sector: SectorConNombre | null
): string {
  if (equipo) return equipo.code ? `${equipo.code} - ${equipo.name}` : equipo.name;
  return sector?.codigo ? `${sector.codigo} - Edificio` : "Edificio";
}

/** "2026-09-17" → "17/9". El día y el mes, que es como se nombra una fecha acá. */
function fechaCorta(fecha: string | null): string {
  const [, mes, dia] = String(fecha ?? "").split("-");
  return mes && dia ? `${Number(dia)}/${Number(mes)}` : "sin fecha";
}

const verHoras = (n: number) => String(Math.round(n * 100) / 100).replace(".", ",");

/**
 * El texto de la orden: qué se hizo, cuándo, cuántas horas y lo que escribió
 * PIPARO en el cuaderno.
 *
 * Lleva el rango de fechas **del grupo entero**, así que al sumarle un renglón
 * a una orden que ya existe se reescribe con el rango nuevo. El precio no va
 * acá: viaja en `REPUESTO UTILIZADO` (ver `costoEnRepuesto`).
 *
 * Sin horas no dice «0 h»: un renglón con precio se cobra por trabajo y un cero
 * ahí es un dato que nadie midió.
 */
export function descripcionDeLaOrden(grupo: GrupoDeCuaderno, contratista: string): string {
  const cuando = grupo.desde && grupo.hasta && grupo.desde !== grupo.hasta
    ? `Del ${fechaCorta(grupo.desde)} al ${fechaCorta(grupo.hasta)}`
    : `El ${fechaCorta(grupo.hasta ?? grupo.desde)}`;

  const horas = grupo.horas > 0 ? ` ${verHoras(grupo.horas)} h en total.` : "";

  const detalle = grupo.detalle
    .map((d) => {
      const lugar = d.lugar_raw?.trim();
      const h = Number(d.horas) > 0 ? `, ${verHoras(Number(d.horas))} h` : "";
      return `${d.tarea}${lugar ? ` — ${lugar}` : ""} (${fechaCorta(d.fecha)}${h})`;
    })
    .join("; ");

  return `${grupo.tarea} — ${contratista}. ${cuando}.${horas} Según el cuaderno: ${detalle}.`;
}

/**
 * Lo que la OT ya tiene de la generación anterior, cuando el grupo suma a una
 * que existe. Sirve para no repetir el costo viejo dentro del texto.
 */
export type LoQueLaOrdenYaTiene = { costo: number | null; repuesto: string | null };

export type ValoresDeLaOrden = typeof VALORES_DE_PIPARO & {
  /** Null sólo si el grupo no trae ninguna fecha: la generación se niega. */
  fecha: string | null;
  fecha_cierre: string | null;
  sector_id: string | null;
  sector_nombre: string;
  equipment_id: string | null;
  equipo_raw: string;
  equipo_code: string | null;
  descripcion: string;
  horas: number;
  costo: number | null;
  /** El texto de `REPUESTO UTILIZADO`: el repuesto que hubiera, con el costo sumado. */
  repuesto: string | null;
};

/**
 * Todo lo que lleva la OT de un grupo. La vista previa lo muestra y la
 * generación lo escribe: **es la misma función**.
 *
 * `antes` sólo se pasa cuando el grupo suma a una orden existente: la cuenta
 * del grupo es el total entero (renglones viejos y nuevos), así que el repuesto
 * se rearma sacando el costo que ya tenía y sumando el nuevo, no apilándolos.
 */
export function valoresDeLaOrden(
  grupo: GrupoDeCuaderno,
  contexto: { sector: SectorConNombre | null; equipo: EquipoConNombre | null; contratista: string },
  antes?: LoQueLaOrdenYaTiene
): ValoresDeLaOrden {
  const base = antes ? repuestoSinElCosto(antes.costo, antes.repuesto) : null;

  return {
    ...VALORES_DE_PIPARO,
    fecha: grupo.hasta,
    fecha_cierre: grupo.hasta,
    sector_id: grupo.sector_id,
    sector_nombre: contexto.sector?.nombre ?? "",
    equipment_id: grupo.equipo_id,
    equipo_raw: equipoParaLaPlanilla(grupo.equipo_id ? contexto.equipo : null, contexto.sector),
    equipo_code: grupo.equipo_id ? contexto.equipo?.code ?? null : null,
    descripcion: descripcionDeLaOrden(grupo, contexto.contratista),
    horas: grupo.horas,
    costo: grupo.costo,
    repuesto: textoDeRepuesto(grupo.costo, base),
  };
}

// ── El freno de los duplicados ──────────────────────────────

/** Una OT que ya existe, vista sólo para decidir si es un duplicado. */
export type OrdenParaComparar = { id: string; ot_number: number; fecha: string | null };

/**
 * El período que mira el freno: **del primer día del mes del grupo más
 * temprano al último día del mes del más tardío**, entre los que se crean.
 *
 * Es el mes entero y no los días exactos de los grupos a propósito. Medido el
 * 01/11/2026: de las 29 OT manuales de septiembre, **28 están fechadas el
 * 01/09**. Con el rango justo, un cuaderno cuyo primer renglón cae el 02/09 —o
 * cuyos grupos más tempranos quedaron para la segunda corrida por el tope de
 * 25— no la atrapa, y se duplica exactamente lo que el freno existe para
 * evitar. Un período que se carga por cuaderno es un mes o una quincena, así
 * que mirar el mes es mirar lo que de verdad se está cubriendo.
 *
 * Null si no hay ningún grupo que se cree.
 */
export function rangoDelFreno(grupos: readonly GrupoDeCuaderno[]): { desde: string; hasta: string } | null {
  const nuevas = grupos.filter((g) => g.accion === "crear");
  const desdes = nuevas.map((g) => g.desde).filter((f): f is string => !!f).sort();
  const hastas = nuevas.map((g) => g.hasta).filter((f): f is string => !!f).sort();
  if (desdes.length === 0 || hastas.length === 0) return null;

  const [anioD, mesD] = desdes[0].split("-").map(Number);
  const [anioH, mesH] = hastas[hastas.length - 1].split("-").map(Number);
  if (![anioD, mesD, anioH, mesH].every(Number.isFinite)) return null;

  // El día 0 del mes siguiente es el último de éste: no hace falta saber
  // cuántos días tiene ni si el año es bisiesto.
  const ultimo = new Date(Date.UTC(anioH, mesH, 0)).getUTCDate();
  const dos = (n: number) => String(n).padStart(2, "0");
  return {
    desde: `${anioD}-${dos(mesD)}-01`,
    hasta: `${anioH}-${dos(mesH)}-${dos(ultimo)}`,
  };
}

/**
 * Las OT **del proveedor** que ya existen dentro del período que están por
 * cubrir las órdenes nuevas, y que **no salieron de ningún cuaderno**.
 *
 * ── POR QUÉ ESTÁ ACÁ Y NO EN UN DOCUMENTO ───────────────────────────────────
 *
 * Septiembre de 2026 ya tiene 29 OT de PIPARO cargadas a mano —todas del
 * 01/09, agrupadas, «Limpieza general de la planta · 32 h»— y el cuaderno de
 * ese mes tiene ~118 renglones: generarlo las duplica. El spec lo dejaba como
 * advertencia operativa, y confiar en que alguien se acuerde es apostar lo
 * irreversible a la memoria de una persona apurada: una OT escrita en la
 * planilla se borra a mano, fila por fila. Es la misma forma y la misma razón
 * que el freno de los 50 renglones del borrado de espejo.
 *
 * El período es el de `rangoDelFreno`: los meses enteros de los grupos que
 * **se van a crear** (los que suman a una orden existente no crean nada). Las OT enlazadas a un
 * renglón de **cualquier carga del contratista** quedan afuera: son lo que
 * generó el propio sistema. No sólo las de esta carga: si un mes se carga en
 * dos cuadernos (una quincena cada uno), lo que creó el primero cae dentro del
 * mes del segundo, y un freno que salta cuando no corresponde enseña a tildar
 * siempre «confirmar» y deja de proteger. El freno apunta a lo que no salió de
 * ningún cuaderno, que es lo que son las 29 de septiembre cargadas a mano. Es
 * pura: la ruta trae las candidatas y los ids de la base.
 */
export function posiblesDuplicados(
  grupos: readonly GrupoDeCuaderno[],
  existentes: readonly OrdenParaComparar[],
  idsGeneradosPorCuadernos: ReadonlySet<string>
): OrdenParaComparar[] {
  const rango = rangoDelFreno(grupos);
  if (!rango) return [];
  const { desde, hasta } = rango;

  const vistas = new Map<string, OrdenParaComparar>();
  for (const o of existentes) {
    if (!o.fecha || o.fecha < desde || o.fecha > hasta) continue;
    if (idsGeneradosPorCuadernos.has(o.id)) continue;
    vistas.set(o.id, o);
  }
  return [...vistas.values()].sort((a, b) => a.ot_number - b.ot_number);
}

/** Cuántos números se imprimen antes de decir «y N más». */
const NUMEROS_A_LA_VISTA = 10;

/**
 * Qué dice el freno: cuántas son, cuáles, y qué significa. Es lo que se le
 * muestra a quien mira la vista previa y lo que devuelve la generación cuando
 * se niega, para que la decisión se tome mirando y no a ciegas.
 */
export function avisoDeDuplicados(contratista: string, ordenes: readonly OrdenParaComparar[]): string {
  const n = ordenes.length;
  const numeros = ordenes.slice(0, NUMEROS_A_LA_VISTA).map((o) => o.ot_number).join(", ");
  const resto = n > NUMEROS_A_LA_VISTA ? ` y ${n - NUMEROS_A_LA_VISTA} más` : "";
  return (
    `Ya hay ${n} ${n === 1 ? "orden" : "órdenes"} de ${contratista} en el período que cubren las órdenes ` +
    `nuevas y que no salieron de ningún cuaderno (OT ${numeros}${resto}). Ese período ya se cargó por otro ` +
    `camino, y generar ahora lo duplica: una orden escrita en la planilla se borra a mano, fila por fila. ` +
    `Si es lo que querés, confirmalo de forma explícita.`
  );
}
