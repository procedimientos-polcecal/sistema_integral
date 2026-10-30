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
import { turnosSinExplicar } from "./cola";

type Admin = ReturnType<typeof createAdminClient>;

export interface MolinoDeLaPantalla {
  id: string;
  clave: string;
  /** Como figura en el catálogo ("Filler 1"). Para decirlo en pantalla, `nombreDelMolino`. */
  nombre: string;
  /** Desde cuántos minutos de parada se pide un motivo. Dato del catálogo, hoy 5. */
  umbral_minutos: number;
  /** La puesta en servicio ("YYYY-MM-DD"): antes de ese día la cola no pide nada. */
  desde: string;
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
    .select("id, clave, nombre, umbral_minutos, desde")
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

// ── La cola de turnos sin explicar ──────────────────────────────────────────

/** Una parada que una persona ya explicó, lista para mostrarse. */
export interface ParadaExplicada {
  id: string;
  fecha: string;
  /** null = el día entero ("planta parada"). */
  turno: TurnoDeMolino | null;
  motivo: string;
  ordenTrabajoId: string | null;
  /**
   * El número de la OT enlazada. Se lee **con el cliente admin**, a propósito:
   * las tablas de Mantenimiento están cerradas con su propia función de acceso,
   * y con la sesión de quien carga sin acceso a Mantenimiento esto llegaría
   * `null` **sin error** y la parada parecería no tener OT. Un número no es el
   * detalle de la OT: mostrarlo no abre nada que esa persona no pueda ver.
   */
  otNumero: number | null;
}

export interface ColaDeMolino {
  sinExplicar: TurnoDeRobot[];
  explicadas: ParadaExplicada[];
}

interface FilaDeParada {
  id: string;
  fecha: string;
  turno: TurnoDeMolino | null;
  motivo: string;
  orden_trabajo_id: string | null;
}

/** Lotes de 200: un `.in()` con más ids arma una URL que PostgREST rechaza con un 400 sin decir por qué. */
async function numerosDeOt(admin: Admin, ids: string[]): Promise<Map<string, number>> {
  const numeros = new Map<string, number>();
  const unicos = [...new Set(ids)];
  for (let i = 0; i < unicos.length; i += 200) {
    const { data, error } = await admin
      .from("ordenes_trabajo")
      .select("id, ot_number")
      .in("id", unicos.slice(i, i + 200));
    if (error) throw new Error(`No se pudo leer el número de las órdenes de trabajo: ${error.message}`);
    for (const o of data ?? []) numeros.set(o.id, o.ot_number);
  }
  return numeros;
}

/**
 * Lo que hay que explicar en un molino y lo que ya se explicó, desde la puesta
 * en servicio. **Por `traerTodo()` las dos lecturas**: los turnos pasan las mil
 * filas en el primer año, y una cola que se corta en 1.000 sin avisar dejaría
 * turnos sin pedir motivo sin que nadie lo note.
 */
export async function colaDeMolino(
  admin: Admin,
  molino: Pick<MolinoDeLaPantalla, "id" | "umbral_minutos" | "desde">,
): Promise<ColaDeMolino> {
  const [filasDeTurnos, filasDeParadas] = await Promise.all([
    traerTodo((desde, hasta) =>
      admin
        .from("produccion_molino_turnos")
        .select("fecha, turno, kg, minutos_marcha, minutos_teoricos, estado, por_material")
        .eq("molino_id", molino.id)
        .gte("fecha", molino.desde)
        .order("fecha")
        .order("turno")
        .range(desde, hasta),
    ),
    traerTodo((desde, hasta) =>
      admin
        .from("produccion_molino_paradas")
        .select("id, fecha, turno, motivo, orden_trabajo_id")
        .eq("molino_id", molino.id)
        .gte("fecha", molino.desde)
        .order("fecha", { ascending: false })
        .order("creado_en", { ascending: false })
        .range(desde, hasta),
    ),
  ]);

  const paradas = filasDeParadas as FilaDeParada[];
  const numeros = await numerosDeOt(
    admin,
    paradas.flatMap((p) => (p.orden_trabajo_id ? [p.orden_trabajo_id] : [])),
  );

  return {
    sinExplicar: turnosSinExplicar(
      enOrdenCronologico(filasDeTurnos.map(filaATurno)),
      paradas.map((p) => ({ fecha: p.fecha, turno: p.turno })),
      molino.umbral_minutos,
      molino.desde,
    ),
    explicadas: paradas.map((p) => ({
      id: p.id,
      fecha: p.fecha,
      turno: p.turno,
      motivo: p.motivo,
      ordenTrabajoId: p.orden_trabajo_id,
      otNumero: p.orden_trabajo_id ? (numeros.get(p.orden_trabajo_id) ?? null) : null,
    })),
  };
}

/** Una OT de la lista para enlazar. */
export interface OtParaEnlazar {
  id: string;
  numero: number;
  fecha: string | null;
  estado: string;
  equipo: string | null;
  descripcion: string | null;
}

/** Cuántos días hacia atrás llegan las OT ya realizadas que se ofrecen para enlazar. */
export const DIAS_DE_VENTANA_DE_OT = 90;

/**
 * El filtro de PostgREST de las OT que se ofrecen: las abiertas de cualquier
 * fecha **o** las de los últimos `diasAtras` días. Aparte de la consulta para
 * poder fijarlo con un test: cambiar el criterio no rompe nada y el
 * desplegable simplemente cambia de tamaño.
 */
export function filtroDeVentanaDeOt(hoy: string, diasAtras = DIAS_DE_VENTANA_DE_OT): string {
  return `fecha.gte.${sumarDias(hoy, -diasAtras)},estado.neq.REALIZADO`;
}

/**
 * Las OT entre las que una persona puede elegir: las de la ventana
 * (`filtroDeVentanaDeOt`) **más las que ya están enlazadas a una parada**, caigan
 * donde caigan. Una parada se explica con una orden reciente o en curso; las
 * 2.900 del historial sólo harían el desplegable más lento. Pero una parada
 * vieja puede tener una OT ya realizada de hace seis meses, y si esa orden no
 * está en la lista el desplegable no encuentra su valor y dice "Seleccionar…"
 * mientras la etiqueta de al lado dice "OT 2929": la pantalla se contradice.
 *
 * **Sólo se llama con quien tiene acceso a Mantenimiento**: lee con el cliente
 * admin, y ahí RLS no corre. Quien no lo tiene recibe el aviso en la pantalla y
 * no una lista vacía.
 */
export async function otsParaEnlazar(
  admin: Admin,
  hoy: string,
  enlazadas: string[] = [],
  diasAtras = DIAS_DE_VENTANA_DE_OT,
): Promise<OtParaEnlazar[]> {
  const filas = await traerTodo((desde, hasta) =>
    admin
      .from("ordenes_trabajo")
      .select("id, ot_number, fecha, estado, equipo_raw, descripcion")
      .or(filtroDeVentanaDeOt(hoy, diasAtras))
      .order("ot_number", { ascending: false })
      .range(desde, hasta),
  );

  // Las enlazadas que la ventana no trajo, de a lotes de 200 (ver el encabezado).
  const traidas = new Set(filas.map((o) => o.id));
  const faltan = [...new Set(enlazadas)].filter((id) => !traidas.has(id));
  for (let i = 0; i < faltan.length; i += 200) {
    const { data, error } = await admin
      .from("ordenes_trabajo")
      .select("id, ot_number, fecha, estado, equipo_raw, descripcion")
      .in("id", faltan.slice(i, i + 200));
    if (error) throw new Error(`No se pudo leer las órdenes de trabajo enlazadas: ${error.message}`);
    filas.push(...(data ?? []));
  }

  return filas
    .map((o) => ({
      id: o.id,
      numero: o.ot_number,
      fecha: o.fecha,
      estado: o.estado,
      equipo: o.equipo_raw,
      descripcion: o.descripcion,
    }))
    .sort((a, b) => b.numero - a.numero);
}
