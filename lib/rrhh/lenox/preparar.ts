import { addUtcDays } from "../dates";
import type { DiaMarcacionesTokens } from "../excelImport";
import type { DiasDeEmpleado } from "../fichadas/decidir";
import type { Agrupadas } from "./agrupar";

/**
 * La parte pura de la sincronización con Lenox: lo que se decide entre traer
 * los datos y aplicarlos. Está acá y no en `sincronizar.ts` para que tenga
 * tests, y porque cada una de estas piezas es de las que fallan sin ruido.
 */

/** "30/09 → 06/10", como se lee en el listado de lotes. */
export function nombreDelLote(desde: Date, hasta: Date): string {
  const ddmm = (d: Date) =>
    `${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
  return `Lenox API · ${ddmm(desde)} → ${ddmm(hasta)}`;
}

/**
 * El aviso de lo que la API mandó y no se pudo usar, o null si se usó todo.
 *
 * Nunca se descarta en silencio: si un día volviera basura, sin esto la
 * sincronización cargaría nada y reportaría éxito — la divergencia que no
 * avisa, que es la peor. `fueraDeRango` es el que más importa de los cuatro,
 * por contraintuitivo: un desfase de huso o un filtro de fechas que la API
 * interpreta distinto deja TODAS las marcas afuera, y los otros tres
 * contadores quedarían en cero.
 */
export function avisoDeDescartadas(descartadas: Agrupadas["descartadas"], total: number): string | null {
  const { sinLegajo, fechaIlegible, horaIlegible, fueraDeRango } = descartadas;
  const perdidas = sinLegajo + fechaIlegible + horaIlegible + fueraDeRango;
  if (perdidas === 0) return null;
  return (
    `Lenox devolvió ${perdidas} marcaciones que no se usaron, de ${total} en total ` +
    `(${sinLegajo} sin legajo, ${fechaIlegible} con fecha ilegible, ` +
    `${horaIlegible} con hora ilegible, ${fueraDeRango} fuera del rango pedido)`
  );
}

/**
 * Pasa de legajo a empleado del SdG. Un legajo que Lenox tiene y el SdG no
 * queda afuera y se informa: enlazar al que se le parece es peor que dejar en
 * null — el dato aparecería en el lugar que no es y no se notaría nunca.
 */
export function resolverEmpleados(
  porLegajo: Map<string, DiaMarcacionesTokens[]>,
  legajoToId: Map<string, string>
): { empleados: DiasDeEmpleado[]; avisos: string[] } {
  const empleados: DiasDeEmpleado[] = [];
  const avisos: string[] = [];
  for (const [legajo, dias] of porLegajo) {
    const empleadoId = legajoToId.get(legajo);
    if (!empleadoId) {
      avisos.push(`Legajo ${legajo}: Lenox tiene marcaciones pero el legajo no existe en el SdG`);
      continue;
    }
    empleados.push({ empleadoId, legajo, dias });
  }
  return { empleados, avisos };
}

/** Un día por cada fecha del rango, sin ninguna marca. */
export function diasVacios(desde: Date, hasta: Date): DiaMarcacionesTokens[] {
  const dias: DiaMarcacionesTokens[] = [];
  for (let d = desde; d.getTime() <= hasta.getTime(); d = addUtcDays(d, 1)) {
    dias.push({ fecha: d, tokens: [] });
  }
  return dias;
}

/**
 * Suma, con días vacíos, a los que no tienen ninguna marcación en el rango
 * pero sí una fichada abierta de antes.
 *
 * El agrupador sólo devuelve legajos que aparecen en la respuesta de la API, y
 * ahí está la diferencia con el Excel: el reporte del Excel trae una fila por
 * día para TODOS, así que un turno que quedó sin salida se cierra —o al menos
 * se avisa— aunque la persona no haya vuelto a fichar. Por la API, si alguien
 * dejó una fichada abierta y después se tomó dos semanas de vacaciones, no
 * aparece en ninguna ventana de 7 días y esa fichada queda abierta para
 * siempre, sin que nada avise.
 *
 * Es equivalente a recorrer los 68 empleados —para alguien sin marcas y sin
 * fichada abierta, reconciliar días vacíos no produce nada— pero cuesta una
 * consulta en vez de 68.
 *
 * `idsConAbierta` puede repetir al mismo empleado (cada aviso de "turno sin
 * marcación de salida" deja una fichada, y alguien puede tener varias): entra
 * una sola vez, y nunca si ya venía con marcas — dos entradas del mismo
 * empleado en el lote harían que se reconcilie dos veces.
 */
export function sumarConAbiertasPrevias(
  empleados: DiasDeEmpleado[],
  idsConAbierta: string[],
  legajoDe: Map<string, string>,
  desde: Date,
  hasta: Date
): DiasDeEmpleado[] {
  const yaIncluidos = new Set(empleados.map((e) => e.empleadoId));
  const resultado = [...empleados];
  for (const empleadoId of idsConAbierta) {
    if (yaIncluidos.has(empleadoId)) continue;
    yaIncluidos.add(empleadoId);
    resultado.push({ empleadoId, legajo: legajoDe.get(empleadoId) ?? empleadoId, dias: diasVacios(desde, hasta) });
  }
  return resultado;
}
