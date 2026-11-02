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
