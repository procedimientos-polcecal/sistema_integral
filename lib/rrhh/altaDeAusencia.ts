import type { SupabaseClient } from "@supabase/supabase-js";
import { recalcularEmpleadoPeriodo } from "./engine/recalcular";
import { sincronizarPeriodoVacaciones } from "./vacacionesDeAusencia";
import { TIPOS_AUSENCIA } from "./tiposAusencia";

/**
 * El alta de una ausencia, fuera de la ruta de RRHH para que la compartan las
 * dos puntas que la crean.
 *
 * Esto no es una refactorización por prolijidad. Dar de alta una ausencia **no
 * es insertar una fila**: después hay que sincronizar el período de vacaciones
 * vinculado y recalcular `calculos_diarios` del empleado en ese rango. Una
 * segunda ruta que inserte y se saltee los dos pasos deja una ausencia que
 * existe en la pantalla y que la liquidación no ve — y eso no se nota del lado
 * que la cargó, se nota en el sueldo de alguien. Mientras el cuerpo sea uno
 * solo, eso no puede pasar por olvido.
 *
 * Devuelve `{ error, status }` en vez de una `NextResponse` a propósito: cada
 * ruta arma su propia respuesta, y así esto se puede probar sin Next.
 */

/**
 * Los tipos que acepta la base (`tipo_ausencia` de `008_rrhh_schema.sql`).
 *
 * Sale de `TIPOS_AUSENCIA` de `tiposAusencia.ts`, que es la lista de la
 * pantalla de RRHH: había tres copias de los mismos doce valores (la base, la
 * pantalla y ésta) y cualquiera podía quedar atrás sin que nada lo notara. Se
 * deriva en vez de copiarse, así un tipo nuevo se agrega en un solo lugar.
 */
export const TIPOS_DE_AUSENCIA: readonly string[] = TIPOS_AUSENCIA.map(([valor]) => valor);

/**
 * Los cuatro tipos que puede elegir el encargado del taller desde
 * Mantenimiento, para tapar un hueco del turno sin entrar a RRHH.
 *
 * Es un subconjunto corto a propósito. Los que quedan afuera no son "los
 * difíciles": son los que tienen consecuencias que el encargado no puede
 * juzgar ni deshacer. `VACACIONES` descuenta días del balance anual del
 * empleado, `LICENCIA_ART` abre un expediente, `SUSPENSION` es una sanción y
 * `LICENCIA_SIN_GOCE_SUELDO` toca el recibo. Esos los sigue cargando RRHH.
 *
 * La restricción la aplica quien llama: `altaDeAusencia` valida contra
 * `TIPOS_DE_AUSENCIA`, que es lo que acepta la base.
 */
export const TIPOS_DEL_ENCARGADO: readonly string[] = [
  "PERMISO_PERSONAL", "ENFERMEDAD_ACCIDENTE_INCULPABLE", "INJUSTIFICADA", "OTRA",
];

/**
 * Una liquidación ya cerrada no se vuelve a calcular, así que una ausencia
 * cargada sobre un período cerrado queda escrita y no llega al recibo: es
 * exactamente la divergencia silenciosa que esta tarea trata de evitar.
 *
 * `liquidaciones` es la lista de **ese** empleado —la tabla es por empleado— y
 * sus columnas son `fecha_desde`/`fecha_hasta`. Las fechas son ISO `YYYY-MM-DD`,
 * así que comparar como texto ordena igual que como fecha y no mete husos
 * horarios en el medio.
 *
 * Es una función pura y hoy **no la llama RRHH**: está acá para que la punta de
 * Mantenimiento pueda negarse antes de insertar. RRHH nunca tuvo este freno y
 * agregárselo ahora sería cambiarle el comportamiento en una refactorización,
 * que es la peor forma de cambiarlo.
 */
export function periodoEstaCerrado(
  liquidaciones: { fecha_desde: string; fecha_hasta: string; estado: string }[],
  fecha: string
): boolean {
  return liquidaciones.some(
    (liq) => liq.estado === "CERRADA" && liq.fecha_desde <= fecha && fecha <= liq.fecha_hasta
  );
}

export interface DatosDeAusencia {
  employeeId: string;
  fechaDesde: string;
  fechaHasta: string;
  tipo: string;
  justificada: boolean;
  observaciones?: string | null;
  anioCorrespondiente?: number;
  /** El usuario que la carga; queda en `cargado_por_id`. */
  cargadoPorId: string;
}

export interface ResultadoDeAlta {
  ausencia?: unknown;
  error?: string;
  status?: number;
}

/**
 * Valida, inserta y deja la ausencia vista por la liquidación.
 *
 * Los campos vienen del cuerpo de un request, que es `any`: el tipo de
 * `DatosDeAusencia` dice qué se espera, no qué llegó, así que las
 * comprobaciones de abajo siguen haciendo falta aunque TypeScript las vea
 * redundantes.
 *
 * Los mensajes de error son los que la ruta de RRHH ya tenía. Se mudaron tal
 * cual: son mejores que cualquier texto genérico y son los que ya conoce quien
 * usa la pantalla.
 */
export async function altaDeAusencia(
  supabase: SupabaseClient,
  datos: DatosDeAusencia
): Promise<ResultadoDeAlta> {
  const {
    employeeId, fechaDesde, fechaHasta, tipo, justificada,
    observaciones, anioCorrespondiente, cargadoPorId,
  } = datos;

  if (!employeeId || !fechaDesde || !fechaHasta || !TIPOS_DE_AUSENCIA.includes(tipo) || typeof justificada !== "boolean") {
    return { error: "Datos inválidos", status: 400 };
  }
  if (tipo === "OTRA" && !(observaciones ?? "").trim()) {
    return { error: "Para el tipo 'Otra' hay que aclarar el motivo en observaciones", status: 400 };
  }
  if (tipo === "VACACIONES" && justificada && !Number.isInteger(anioCorrespondiente)) {
    return { error: "Para Vacaciones hay que indicar a qué año corresponden los días", status: 400 };
  }

  const { data: ausencia, error } = await supabase
    .from("ausencias")
    .insert({
      empleado_id: employeeId,
      fecha_desde: fechaDesde,
      fecha_hasta: fechaHasta,
      tipo,
      justificada,
      observaciones: observaciones || null,
      cargado_por_id: cargadoPorId,
    })
    .select()
    .single();
  if (error) return { error: error.message, status: 500 };

  await sincronizarPeriodoVacaciones(supabase, ausencia, anioCorrespondiente);
  await recalcularEmpleadoPeriodo(supabase, employeeId, new Date(fechaDesde), new Date(fechaHasta));
  return { ausencia };
}
