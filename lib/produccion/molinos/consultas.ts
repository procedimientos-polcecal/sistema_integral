/**
 * Lo que leen las pantallas de los molinos: un día y un mes de un molino.
 *
 * Las funciones se parten en dos a propósito. Las que hablan con la base
 * (`diaDeMolino`, `mesDeMolino`) son finas; las decisiones —qué es un día no
 * operativo, qué turno sin renglón está cubierto por un acumulado, qué entra en
 * los indicadores— están en funciones puras que se prueban sin base.
 *
 * Tres cosas que no se deducen del código:
 *
 * - **Un día no operativo no existe en la base.** La importación no guarda nada
 *   de él (no hay renglones: la planta no trabajó), así que se reconstruye acá
 *   con la misma regla que `armarTurnos`: un día sin ningún renglón **entre el
 *   primero y el último** que tiene el molino. Antes del primero y después del
 *   último no se sabe nada, y eso se dice distinto: "sin datos" no es "no operó".
 * - **Un turno absorbido por un acumulado tampoco tiene renglón.** `armarTurnos`
 *   guarda los huérfanos pero no los turnos que una fila posterior cubrió, así
 *   que en un día con datos un turno sin renglón es uno de ésos, y lo cubre el
 *   primer renglón que viene después.
 * - **`traerTodo()` en el mes.** Un molino acumula ~1.460 turnos por año y ya
 *   pasó las mil filas; PostgREST corta ahí y no avisa.
 */

import type { createAdminClient } from "@/lib/supabase/admin";
import { traerTodo } from "@/lib/core/paginado";
import { rangoDelMes, sumarDias } from "@/lib/core/fechas";
import type { EstadoDeTurno, TurnoDeMolino } from "./types";
import type { TurnoDeRobot } from "./turnos";
import { indicadoresDe, type Indicadores } from "./indicadores";
import { TURNOS_EN_ORDEN_DE_RELOJ } from "./formato";

type Admin = ReturnType<typeof createAdminClient>;

export interface MolinoDeLaPantalla {
  id: string;
  clave: string;
  /** Como figura en el catálogo ("Filler 1"). Para decirlo en pantalla, `nombreDelMolino`. */
  nombre: string;
}

/** El primer y el último día que el molino tiene renglones, o null si no tiene ninguno. */
export interface RangoDeDatos {
  primero: string;
  ultimo: string;
}

export type CondicionDelDia = "con_datos" | "no_operativo" | "sin_datos";

export interface CasillaDelDia {
  turno: TurnoDeMolino;
  /** El renglón del robot; null si el turno no tiene (lo cubrió un acumulado). */
  dato: TurnoDeRobot | null;
  /** Sólo cuando `dato` es null: el renglón posterior que lo absorbió. */
  cubiertoPor: { fecha: string; turno: TurnoDeMolino } | null;
}

export interface DiaDeMolino {
  fecha: string;
  condicion: CondicionDelDia;
  /** Siempre los cuatro, en orden de reloj, si hay datos; vacío si no. */
  casillas: CasillaDelDia[];
  /** null si el día no tiene datos: un día no operativo no es cuatro ceros. */
  indicadores: Indicadores | null;
}

export interface MesDeMolino {
  mes: string;
  turnos: TurnoDeRobot[];
  /** Los días del mes entre el primero y el último con datos que no tienen renglones. */
  diasNoOperativos: string[];
  /** Los días del mes con al menos un renglón. */
  diasConDatos: number;
  indicadores: Indicadores;
  conteoPorEstado: Record<EstadoDeTurno, number>;
  /** Los turnos que no son `normal`, en orden: acumulados, inconsistentes y huérfanos se listan. */
  senalados: TurnoDeRobot[];
}

const posicionDelTurno = (t: TurnoDeMolino) => TURNOS_EN_ORDEN_DE_RELOJ.indexOf(t);

/** Cronológico: por fecha y, dentro del día, por reloj. No por el orden del enum de la base. */
export function enOrdenCronologico(turnos: TurnoDeRobot[]): TurnoDeRobot[] {
  return [...turnos].sort((a, b) =>
    a.fecha === b.fecha ? posicionDelTurno(a.turno) - posicionDelTurno(b.turno) : a.fecha < b.fecha ? -1 : 1,
  );
}

/**
 * Cómo está un día respecto de lo que el robot informó. Pura.
 *
 * `con_datos` si hay renglones; si no, `no_operativo` sólo cuando el día queda
 * **estrictamente entre** el primero y el último con datos del molino —la misma
 * frontera que `armarTurnos`—, y `sin_datos` en cualquier otro caso.
 */
export function condicionDelDia(
  fecha: string,
  hayRenglones: boolean,
  rango: RangoDeDatos | null,
): CondicionDelDia {
  if (hayRenglones) return "con_datos";
  if (!rango) return "sin_datos";
  return fecha > rango.primero && fecha < rango.ultimo ? "no_operativo" : "sin_datos";
}

/**
 * Un día de un molino, con sus cuatro turnos. Pura.
 *
 * `posteriores` son los renglones de los días siguientes, en orden
 * cronológico: sólo se leen para decir qué acumulado cubre un turno sin renglón.
 */
export function armarElDia(
  fecha: string,
  delDia: TurnoDeRobot[],
  posteriores: TurnoDeRobot[],
  rango: RangoDeDatos | null,
): DiaDeMolino {
  const condicion = condicionDelDia(fecha, delDia.length > 0, rango);
  if (condicion !== "con_datos") return { fecha, condicion, casillas: [], indicadores: null };

  const ordenados = enOrdenCronologico(delDia);
  const porTurno = new Map(ordenados.map((t) => [t.turno, t]));

  const casillas: CasillaDelDia[] = TURNOS_EN_ORDEN_DE_RELOJ.map((turno, i) => {
    const dato = porTurno.get(turno) ?? null;
    if (dato) return { turno, dato, cubiertoPor: null };

    // Sin renglón en un día con datos = lo absorbió el primer renglón que viene
    // después (`armarTurnos` guarda los huérfanos, pero no los absorbidos).
    const siguienteEnElDia = TURNOS_EN_ORDEN_DE_RELOJ.slice(i + 1)
      .map((t) => porTurno.get(t))
      .find((t): t is TurnoDeRobot => t !== undefined);
    const quien = siguienteEnElDia ?? enOrdenCronologico(posteriores)[0];
    const cubre = quien && quien.estado === "acumulado" ? quien : undefined;
    return { turno, dato: null, cubiertoPor: cubre ? { fecha: cubre.fecha, turno: cubre.turno } : null };
  });

  return { fecha, condicion, casillas, indicadores: indicadoresDe(ordenados, []) };
}

/**
 * Los días de un mes sin renglones que quedan dentro del rango del molino. Pura.
 * Es la reconstrucción de lo que la importación no guarda.
 */
export function diasNoOperativosDelMes(
  mes: string,
  fechasConRenglones: Iterable<string>,
  rango: RangoDeDatos | null,
): string[] {
  if (!rango) return [];
  const con = new Set(fechasConRenglones);
  const { primerDia, ultimoDia } = rangoDelMes(mes);
  const dias: string[] = [];
  for (let d = primerDia; d <= ultimoDia; d = sumarDias(d, 1)) {
    if (d > rango.primero && d < rango.ultimo && !con.has(d)) dias.push(d);
  }
  return dias;
}

/** Un mes de un molino con sus indicadores. Pura. */
export function armarElMes(mes: string, turnos: TurnoDeRobot[], rango: RangoDeDatos | null): MesDeMolino {
  const ordenados = enOrdenCronologico(turnos);
  const diasNoOperativos = diasNoOperativosDelMes(mes, ordenados.map((t) => t.fecha), rango);
  const conteoPorEstado: Record<EstadoDeTurno, number> = { normal: 0, acumulado: 0, inconsistente: 0, huerfano: 0 };
  for (const t of ordenados) conteoPorEstado[t.estado]++;

  return {
    mes,
    turnos: ordenados,
    diasNoOperativos,
    diasConDatos: new Set(ordenados.map((t) => t.fecha)).size,
    indicadores: indicadoresDe(ordenados, diasNoOperativos),
    conteoPorEstado,
    senalados: ordenados.filter((t) => t.estado !== "normal"),
  };
}

/** Lo que devuelve una fila de la base, vuelto a la forma del cálculo. */
interface FilaDeTurno {
  fecha: string;
  turno: TurnoDeMolino;
  kg: number | string;
  minutos_marcha: number | string;
  minutos_teoricos: number | string;
  estado: EstadoDeTurno;
  por_material: Record<string, number> | null;
}

function filaATurno(f: FilaDeTurno): TurnoDeRobot {
  return {
    fecha: f.fecha,
    turno: f.turno,
    kg: Number(f.kg),
    minutosMarcha: Number(f.minutos_marcha),
    minutosTeoricos: Number(f.minutos_teoricos),
    estado: f.estado,
    // El reparto por material no se muestra en este frente; se arrastra tal cual.
    porMaterial: f.por_material ?? {},
  };
}

export async function traerMolinos(admin: Admin): Promise<MolinoDeLaPantalla[]> {
  const { data, error } = await admin
    .from("produccion_molinos")
    .select("id, clave, nombre")
    .eq("activo", true)
    .order("clave");
  if (error) throw new Error(`No se pudo leer el catálogo de molinos: ${error.message}`);
  return data ?? [];
}

/** El primer y el último día con renglones de un molino. Dos lecturas de una fila, no un barrido. */
export async function rangoDeDatosDelMolino(admin: Admin, molinoId: string): Promise<RangoDeDatos | null> {
  const [primero, ultimo] = await Promise.all([
    admin
      .from("produccion_molino_turnos")
      .select("fecha")
      .eq("molino_id", molinoId)
      .order("fecha", { ascending: true })
      .limit(1),
    admin
      .from("produccion_molino_turnos")
      .select("fecha")
      .eq("molino_id", molinoId)
      .order("fecha", { ascending: false })
      .limit(1),
  ]);
  if (primero.error) throw new Error(`No se pudo leer el primer día del molino: ${primero.error.message}`);
  if (ultimo.error) throw new Error(`No se pudo leer el último día del molino: ${ultimo.error.message}`);
  const p = primero.data?.[0]?.fecha;
  const u = ultimo.data?.[0]?.fecha;
  return p && u ? { primero: p, ultimo: u } : null;
}

/** Un día de un molino. Son cuatro renglones a lo sumo: no hace falta paginar. */
export async function diaDeMolino(admin: Admin, molinoId: string, fecha: string): Promise<DiaDeMolino> {
  const [delDia, posteriores, rango] = await Promise.all([
    admin
      .from("produccion_molino_turnos")
      .select("fecha, turno, kg, minutos_marcha, minutos_teoricos, estado, por_material")
      .eq("molino_id", molinoId)
      .eq("fecha", fecha),
    // El renglón que cubre un turno sin renglón está en este día o en el
    // siguiente con datos; cuatro renglones alcanzan para llegar a él.
    admin
      .from("produccion_molino_turnos")
      .select("fecha, turno, kg, minutos_marcha, minutos_teoricos, estado, por_material")
      .eq("molino_id", molinoId)
      .gt("fecha", fecha)
      .order("fecha", { ascending: true })
      .limit(4),
    rangoDeDatosDelMolino(admin, molinoId),
  ]);
  if (delDia.error) throw new Error(`No se pudo leer el día del molino: ${delDia.error.message}`);
  if (posteriores.error) throw new Error(`No se pudo leer los días siguientes del molino: ${posteriores.error.message}`);

  return armarElDia(
    fecha,
    (delDia.data ?? []).map(filaATurno),
    (posteriores.data ?? []).map(filaATurno),
    rango,
  );
}

/** Un mes de un molino. ~124 renglones, pero **por `traerTodo()`**: ver el encabezado. */
export async function mesDeMolino(admin: Admin, molinoId: string, mes: string): Promise<MesDeMolino> {
  const { primerDia, ultimoDia } = rangoDelMes(mes);
  const [filas, rango] = await Promise.all([
    traerTodo((desde, hasta) =>
      admin
        .from("produccion_molino_turnos")
        .select("fecha, turno, kg, minutos_marcha, minutos_teoricos, estado, por_material")
        .eq("molino_id", molinoId)
        .gte("fecha", primerDia)
        .lte("fecha", ultimoDia)
        .order("fecha")
        .order("turno")
        .range(desde, hasta),
    ),
    rangoDeDatosDelMolino(admin, molinoId),
  ]);
  return armarElMes(mes, filas.map(filaATurno), rango);
}
