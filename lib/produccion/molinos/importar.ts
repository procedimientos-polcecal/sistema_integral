/**
 * De los CSV de un molino a la tabla `produccion_molino_turnos`.
 *
 * **Esta importación sólo toca `produccion_molino_turnos` y nunca
 * `produccion_molino_paradas`.** Los turnos son lo que dijo el robot y se
 * rehacen enteros desde el zip; las paradas son lo que escribió una persona
 * para explicar un turno y no se rehacen desde ningún lado. La garantía es
 * estructural y no un valor de retorno: acá no hay una sola referencia a la
 * tabla de paradas, así que no hay una línea que un cambio futuro pueda
 * "completar" por error. Lo que prueba que no se pisan es el test que
 * reconcilia un molino cuyo zip perdió un día y comprueba que la parada de ese
 * día sigue en la base.
 */

import type { createAdminClient } from "@/lib/supabase/admin";
import { traerTodo } from "@/lib/core/paginado";
import type { CorteDeTurno, FilaCruda, TurnoDeMolino, EstadoDeTurno } from "./types";
import { leerFiller1, leerFiller2 } from "./csv";
import { armarTurnos, type TurnoDeRobot } from "./turnos";

type Admin = ReturnType<typeof createAdminClient>;

export interface MolinoACargar {
  id: string;
  clave: string;
  nombre: string;
  formato: "filler_1" | "filler_2";
}

export interface PlanDeReconciliacion {
  /** Los turnos del zip que no están en la base o que cambiaron: se upsertean. */
  turnosAInsertar: TurnoDeRobot[];
  /** Los de la base que el zip ya no tiene. */
  turnosABorrar: { fecha: string; turno: TurnoDeMolino }[];
}

const claveDe = (t: { fecha: string; turno: TurnoDeMolino }) => `${t.fecha}|${t.turno}`;

/** Los jsonb no conservan el orden de las claves; para comparar se ordenan. */
const repartoEstable = (r: Record<string, number>) =>
  JSON.stringify(Object.keys(r).sort().map((k) => [k, Number(r[k])]));

function esIgual(a: TurnoDeRobot, b: TurnoDeRobot): boolean {
  return (
    a.kg === b.kg &&
    a.minutosMarcha === b.minutosMarcha &&
    a.minutosTeoricos === b.minutosTeoricos &&
    a.estado === b.estado &&
    repartoEstable(a.porMaterial) === repartoEstable(b.porMaterial)
  );
}

/**
 * Qué hay que escribir y qué borrar para que la base quede igual al zip.
 *
 * **Lanza si el zip trae menos días que la base.** Un zip que se achicó es casi
 * siempre un zip incompleto —el robot rotó sus archivos, la tarea subió uno
 * recortado—, y aplicarlo borraría historia que nadie va a poder recuperar del
 * otro lado. Se prefiere cortar y que alguien mire a conciliar en silencio.
 * Los días son los distintos `fecha`, no los turnos: un día en curso puede
 * traer menos turnos que antes sin que se haya perdido nada.
 *
 * **Pura y exportada**: es la decisión, y la base no hace falta para probarla.
 */
export function planDeReconciliacion(
  delZip: TurnoDeRobot[],
  enLaBase: TurnoDeRobot[],
): PlanDeReconciliacion {
  const diasZip = new Set(delZip.map((t) => t.fecha)).size;
  const diasBase = new Set(enLaBase.map((t) => t.fecha)).size;
  if (diasZip < diasBase) {
    throw new Error(
      `El zip se encogió: trae ${diasZip} días y la base ya tiene ${diasBase}. ` +
        `No se aplica, para no borrar historia; si el robot rotó sus archivos hay que resolverlo a mano.`,
    );
  }

  const base = new Map(enLaBase.map((t) => [claveDe(t), t]));
  const zip = new Set(delZip.map(claveDe));

  return {
    turnosAInsertar: delZip.filter((t) => {
      const previo = base.get(claveDe(t));
      return !previo || !esIgual(t, previo);
    }),
    turnosABorrar: enLaBase
      .filter((t) => !zip.has(claveDe(t)))
      .map((t) => ({ fecha: t.fecha, turno: t.turno })),
  };
}

/**
 * Garantiza que nada negativo llegue a la base.
 *
 * La tabla tiene `check (kg >= 0)` y `check (minutos_marcha >= 0)`, y un solo
 * renglón que no lo cumpla hace fallar el lote entero con 23514: un turno malo
 * dejaría sin importar los otros 800. El parseo ya descarta lo que no es un
 * entero sin signo, así que esto es el cinturón sobre los tirantes; si alguna
 * vez se dispara, el valor se lleva a 0 **y se dice**.
 */
export function sanearTurnos(turnos: TurnoDeRobot[]): { turnos: TurnoDeRobot[]; avisos: string[] } {
  const avisos: string[] = [];
  const no_neg = (v: number, cual: string, t: TurnoDeRobot) => {
    if (Number.isFinite(v) && v >= 0) return v;
    avisos.push(`${t.fecha} ${t.turno}: ${cual} vale ${v}; se guardó 0.`);
    return 0;
  };
  return {
    turnos: turnos.map((t) => ({
      ...t,
      kg: no_neg(t.kg, "kg", t),
      minutosMarcha: no_neg(t.minutosMarcha, "minutos de marcha", t),
      minutosTeoricos: no_neg(t.minutosTeoricos, "minutos teóricos", t),
    })),
    avisos,
  };
}

/** Un CSV del zip por su nombre sin extensión, sin importar mayúsculas. */
function csvDe(csvs: Record<string, string>, nombre: string): string | undefined {
  const buscado = `${nombre}.csv`.toLowerCase();
  const clave = Object.keys(csvs).find((k) => k.toLowerCase() === buscado);
  return clave === undefined ? undefined : csvs[clave];
}

/**
 * Qué archivo del zip trae cada corte. Filler 1 trae el desglose por material
 * en `DAT00000003..06` y Filler 2 sus datos en `DAT00000001..04`; los dos en el
 * orden 3:59, 11:59, 19:59, 23:59 (medido sobre los zips reales del 29/10/2026).
 * Esto sólo dice de qué archivo leer: el turno lo sigue decidiendo la hora que
 * trae cada renglón.
 */
const CORTES_EN_ORDEN: CorteDeTurno[] = ["3:59", "11:59", "19:59", "23:59"];

/**
 * Del zip ya abierto a las filas crudas, según el formato del molino.
 * Pura: recibe el texto y devuelve filas más avisos.
 */
export function leerCsvsDelMolino(
  formato: "filler_1" | "filler_2",
  csvs: Record<string, string>,
): { filas: FilaCruda[]; avisos: string[] } {
  const numeroDeArchivo = (n: number) => `DAT${String(n).padStart(8, "0")}`;
  const avisos: string[] = [];

  if (formato === "filler_1") {
    const dat1 = csvDe(csvs, numeroDeArchivo(1));
    if (dat1 === undefined) throw new Error("El zip no trae DAT00000001.CSV, que es el parte de Filler 1");
    const desglose: Partial<Record<CorteDeTurno, string>> = {};
    CORTES_EN_ORDEN.forEach((corte, i) => {
      const t = csvDe(csvs, numeroDeArchivo(3 + i));
      if (t === undefined) avisos.push(`El zip no trae ${numeroDeArchivo(3 + i)}.CSV: los turnos de las ${corte} quedan sin reparto por material.`);
      else desglose[corte] = t;
    });
    const r = leerFiller1(dat1, desglose);
    return { filas: r.filas, avisos: [...avisos, ...r.avisos] };
  }

  const porCorte: Partial<Record<CorteDeTurno, string>> = {};
  CORTES_EN_ORDEN.forEach((corte, i) => {
    const t = csvDe(csvs, numeroDeArchivo(1 + i));
    if (t === undefined) avisos.push(`El zip no trae ${numeroDeArchivo(1 + i)}.CSV: no hay turnos de las ${corte}.`);
    else porCorte[corte] = t;
  });
  if (Object.keys(porCorte).length === 0) throw new Error("El zip no trae ninguno de los cuatro archivos de Filler 2");
  const r = leerFiller2(porCorte);
  return { filas: r.filas, avisos: [...avisos, ...r.avisos] };
}

export interface ResultadoDeMolino {
  /** Turnos que trae el zip, cuenten o no. */
  turnos: number;
  insertados: number;
  actualizados: number;
  borrados: number;
  diasNoOperativos: string[];
  /** Lo que el parseo no pudo leer. La importación se hizo igual. */
  avisos: string[];
}

/** Lo que devuelve una fila de la base, vuelto a la forma del cálculo. */
function filaATurno(f: {
  fecha: string; turno: TurnoDeMolino; kg: number | string; minutos_marcha: number | string;
  minutos_teoricos: number | string; estado: EstadoDeTurno; por_material: Record<string, number> | null;
}): TurnoDeRobot {
  return {
    fecha: f.fecha,
    turno: f.turno,
    kg: Number(f.kg),
    minutosMarcha: Number(f.minutos_marcha),
    minutosTeoricos: Number(f.minutos_teoricos),
    estado: f.estado,
    porMaterial: f.por_material ?? {},
  };
}

/** Los turnos que la base ya tiene de un molino. Crece ~1.460 por año: se pagina. */
export async function turnosDeLaBase(admin: Admin, molinoId: string): Promise<TurnoDeRobot[]> {
  const filas = await traerTodo((desde, hasta) =>
    admin
      .from("produccion_molino_turnos")
      .select("fecha, turno, kg, minutos_marcha, minutos_teoricos, estado, por_material")
      .eq("molino_id", molinoId)
      .order("fecha")
      .order("turno")
      .range(desde, hasta),
  );
  return filas.map(filaATurno);
}

const TANDA = 500;

/**
 * Reconcilia un molino con su zip: escribe lo nuevo o cambiado, borra lo que el
 * zip ya no trae, y deja las paradas como estaban (ver el encabezado).
 */
export async function importarMolino(
  admin: Admin,
  molino: MolinoACargar,
  csvs: Record<string, string>,
): Promise<ResultadoDeMolino> {
  const { filas, avisos: avisosDeLectura } = leerCsvsDelMolino(molino.formato, csvs);
  const { turnos: armados, diasNoOperativos } = armarTurnos(filas);
  const { turnos: delZip, avisos: avisosDeSaneo } = sanearTurnos(armados);
  const avisos = [...avisosDeLectura, ...avisosDeSaneo];

  const enLaBase = await turnosDeLaBase(admin, molino.id);
  // Lanza acá, antes de escribir nada, si el zip se encogió.
  const plan = planDeReconciliacion(delZip, enLaBase);

  const yaEstaban = new Set(enLaBase.map(claveDe));
  const nuevos = plan.turnosAInsertar.filter((t) => !yaEstaban.has(claveDe(t))).length;

  for (let i = 0; i < plan.turnosAInsertar.length; i += TANDA) {
    const lote = plan.turnosAInsertar.slice(i, i + TANDA).map((t) => ({
      molino_id: molino.id,
      fecha: t.fecha,
      turno: t.turno,
      kg: t.kg,
      minutos_marcha: t.minutosMarcha,
      minutos_teoricos: t.minutosTeoricos,
      estado: t.estado,
      por_material: t.porMaterial,
    }));
    const { error } = await admin
      .from("produccion_molino_turnos")
      .upsert(lote, { onConflict: "molino_id,fecha,turno" });
    if (error) throw new Error(`No se pudieron guardar los turnos de ${molino.nombre}: ${error.message}`);
  }

  // Lo que se borra va **después** de lo que se escribe: si algo falla a la
  // mitad, la base queda con de más y no con de menos.
  const porFecha = new Map<string, TurnoDeMolino[]>();
  for (const b of plan.turnosABorrar) porFecha.set(b.fecha, [...(porFecha.get(b.fecha) ?? []), b.turno]);
  for (const [fecha, turnos] of porFecha) {
    const { error } = await admin
      .from("produccion_molino_turnos")
      .delete()
      .eq("molino_id", molino.id)
      .eq("fecha", fecha)
      .in("turno", turnos);
    if (error) throw new Error(`No se pudieron borrar los turnos viejos de ${molino.nombre}: ${error.message}`);
  }

  return {
    turnos: delZip.length,
    insertados: nuevos,
    actualizados: plan.turnosAInsertar.length - nuevos,
    borrados: plan.turnosABorrar.length,
    diasNoOperativos,
    avisos,
  };
}
