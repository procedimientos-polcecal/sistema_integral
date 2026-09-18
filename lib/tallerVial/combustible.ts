/**
 * Cuánto trabajó un equipo entre dos cargas de combustible, y cuánto consumió
 * por hora o por km. Reproduce las columnas "HORAS ó KM" y "LTS/HR" de la
 * pestaña "DATOS" de la planilla real, pero calculadas y no tipeadas: la
 * planilla las carga a mano y no siempre coinciden con la resta de lecturas
 * consecutivas.
 *
 * Todo esto es puro: no lee la base. Quien llama arma `CargaPlana[]` con lo
 * que ya trajo de `consultas.ts`.
 */

export interface CargaPlana {
  id: string;
  equipoId: string;
  fecha: string; // "YYYY-MM-DD"
  litros: number;
  lectura: number | null;
}

export interface CargaConTrabajo extends CargaPlana {
  /**
   * Lectura actual menos la de la carga anterior del mismo equipo **con
   * lectura** (una carga sin lectura en el medio no corta la cadena, sólo no
   * aporta un punto). Null si no hay una anterior con lectura, o si esta
   * carga no tiene lectura.
   */
  trabajado: number | null;
  /** litros / trabajado. Null si no hay trabajado o dio cero. */
  consumoPorUnidad: number | null;
}

/**
 * Encadena las lecturas de cada equipo, ordenadas por fecha, y calcula lo
 * trabajado entre una y la anterior. No agrupa por unidad (horas vs. km): eso
 * es sólo una etiqueta de presentación (`lib/tallerVial/equipos.ts`), acá sólo
 * importa que la lectura sea comparable dentro de un mismo equipo.
 */
export function calcularTrabajoEntreCargas(cargas: CargaPlana[]): CargaConTrabajo[] {
  const porEquipo = new Map<string, CargaPlana[]>();
  for (const c of cargas) {
    const lista = porEquipo.get(c.equipoId) ?? [];
    lista.push(c);
    porEquipo.set(c.equipoId, lista);
  }

  const resultado: CargaConTrabajo[] = [];
  for (const lista of porEquipo.values()) {
    const ordenada = [...lista].sort((a, b) => a.fecha.localeCompare(b.fecha));
    let lecturaAnterior: number | null = null;
    for (const c of ordenada) {
      const trabajado = c.lectura != null && lecturaAnterior != null ? c.lectura - lecturaAnterior : null;
      const consumoPorUnidad = trabajado != null && trabajado > 0 ? c.litros / trabajado : null;
      resultado.push({ ...c, trabajado, consumoPorUnidad });
      if (c.lectura != null) lecturaAnterior = c.lectura;
    }
  }
  return resultado;
}

export interface ResumenMensualEquipo {
  equipoId: string;
  cargas: number;
  litrosTotal: number;
  /** Suma de lo trabajado entre cargas dentro del mes. Null si ninguna carga del mes tiene un trabajado calculable. */
  trabajadoTotal: number | null;
  /** litrosTotal / trabajadoTotal — igual que "L/h PROMEDIO" del informe real, sobre el total del mes y no el promedio de cada carga. */
  consumoPromedio: number | null;
}

/** El resumen del mes, por equipo — "RESUMEN DE CONSUMO POR EQUIPO" de los informes mensuales reales. */
export function resumenMensualPorEquipo(cargas: CargaConTrabajo[], mes: string): ResumenMensualEquipo[] {
  const delMes = cargas.filter((c) => c.fecha.startsWith(mes));
  const totales = new Map<string, { cargas: number; litros: number; trabajado: number }>();

  for (const c of delMes) {
    const acc = totales.get(c.equipoId) ?? { cargas: 0, litros: 0, trabajado: 0 };
    acc.cargas += 1;
    acc.litros += c.litros;
    if (c.trabajado != null && c.trabajado > 0) acc.trabajado += c.trabajado;
    totales.set(c.equipoId, acc);
  }

  return [...totales.entries()].map(([equipoId, acc]) => ({
    equipoId,
    cargas: acc.cargas,
    litrosTotal: acc.litros,
    trabajadoTotal: acc.trabajado > 0 ? acc.trabajado : null,
    consumoPromedio: acc.trabajado > 0 ? acc.litros / acc.trabajado : null,
  }));
}

export interface LitrosDelMes {
  mes: string; // "YYYY-MM"
  litrosTotal: number;
  cargas: number;
}

/**
 * Cuánto cargó toda la flota, mes a mes — para ver de un vistazo si el
 * consumo general viene subiendo o bajando. `meses` va explícito y ordenado
 * (de más viejo a más nuevo) porque un mes sin ninguna carga tiene que
 * aparecer en cero, no desaparecer de la tabla.
 */
export function evolucionMensualDeLitros(cargas: CargaPlana[], meses: string[]): LitrosDelMes[] {
  return meses.map((mes) => {
    const delMes = cargas.filter((c) => c.fecha.startsWith(mes));
    return {
      mes,
      litrosTotal: delMes.reduce((s, c) => s + c.litros, 0),
      cargas: delMes.length,
    };
  });
}

/** Los últimos `cantidad` meses hasta `mesHasta` inclusive, de más viejo a más nuevo. */
export function ultimosMeses(mesHasta: string, cantidad: number): string[] {
  const [anio, m] = mesHasta.split("-").map(Number);
  const meses: string[] = [];
  for (let i = cantidad - 1; i >= 0; i--) {
    const total = anio * 12 + (m - 1) - i;
    meses.push(`${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, "0")}`);
  }
  return meses;
}

/**
 * Horas trabajadas promedio por día calendario, sobre todo el historial de
 * lecturas del equipo — para estimar cuándo va a vencer el próximo service
 * (`fechaEstimadaDeProximoService`, `lib/tallerVial/service.ts`) a partir de
 * cómo viene usándose la máquina. Es el promedio de toda la vida registrada y
 * no de una ventana reciente: con las cargas espaciadas que hay hoy, una
 * ventana de 90 días se queda sin puntos para varios equipos.
 *
 * Null con menos de dos lecturas con `trabajado` calculable, o si las que hay
 * caen todas el mismo día (no hay sobre qué dividir).
 */
export function tasaDeUsoDiaria(cargasDelEquipo: { fecha: string; trabajado: number | null }[]): number | null {
  const validas = cargasDelEquipo.filter((c): c is { fecha: string; trabajado: number } => c.trabajado !== null && c.trabajado > 0);
  if (validas.length < 2) return null;

  const fechas = validas.map((c) => c.fecha).sort();
  const dias = diasEntreIso(fechas[0], fechas[fechas.length - 1]);
  if (dias <= 0) return null;

  const horasTotal = validas.reduce((s, c) => s + c.trabajado, 0);
  return horasTotal / dias;
}

function diasEntreIso(desde: string, hasta: string): number {
  const [a1, m1, d1] = desde.split("-").map(Number);
  const [a2, m2, d2] = hasta.split("-").map(Number);
  return Math.round((Date.UTC(a2, m2 - 1, d2) - Date.UTC(a1, m1 - 1, d1)) / 86400000);
}
