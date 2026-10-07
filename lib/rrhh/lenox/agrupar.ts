import { addUtcDays, toUtcDateOnly } from "../dates";
import type { DiaMarcacionesTokens, TokenMarcacion } from "../excelImport";
import type { MarcacionLenox } from "./tipos";

/**
 * "2026-10-02" → el día calendario como medianoche UTC. Null si no se entiende
 * o si el día no existe.
 *
 * El formato solo no alcanza: `Date.UTC` normaliza en vez de rechazar, así que
 * "2026-02-31" pasaba como el 3 de marzo (medido: la marca del 31 de febrero
 * apareció en el día 2026-03-03) y "2026-13-01" como el 1 de enero de 2027.
 * Una fecha que no existe no es un dato, y convertirla en el día de al lado
 * es peor que descartarla: el turno aparece en un lugar que no es y nadie lo
 * nota. Es la misma regla que gobierna los enlaces por texto libre en este
 * repo. Por eso se reconstruye la fecha y se compara con lo que se leyó.
 */
function fechaDe(valor: string): Date | null {
  const m = valor.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const [anio, mes0, dia] = [Number(m[1]), Number(m[2]) - 1, Number(m[3])];
  const fecha = toUtcDateOnly(anio, mes0, dia);
  if (
    fecha.getUTCFullYear() !== anio ||
    fecha.getUTCMonth() !== mes0 ||
    fecha.getUTCDate() !== dia
  ) {
    return null;
  }
  return fecha;
}

/**
 * "07:58:00" → "07:58". Null si no se entiende o si la hora no existe ("25:99"
 * se arrastraría hasta `horaStringToDate`, que la normalizaría al día
 * siguiente sin avisar). Se asume formato de 24 horas, con los segundos
 * opcionales que manda la API, y el regex está anclado al final: sin eso
 * "07:58 PM" se leía como las 07:58 y "07:581" también, la misma lectura
 * silenciosa que se evita en `fechaDe`. Siempre devuelve la hora con dos
 * dígitos: el `sort()` de strings de más abajo coincide con el orden
 * cronológico sólo si "7:05" se normaliza a "07:05"; sin eso quedaría después
 * de "10:00".
 */
function horaDe(valor: string): string | null {
  const m = valor.trim().match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!m) return null;
  if (Number(m[1]) > 23 || Number(m[2]) > 59 || Number(m[3] ?? 0) > 59) return null;
  return `${m[1].padStart(2, "0")}:${m[2]}`;
}

export interface Agrupadas {
  porLegajo: Map<string, DiaMarcacionesTokens[]>;
  /**
   * Filas que no se pudieron usar. Quien sincroniza tiene que mirarlo: si la
   * API devolviera basura un día, sin esto se cargaría nada y se reportaría
   * éxito. Una fila cuenta una sola vez, en el primer motivo que se le
   * encuentra, en este orden: sin legajo, fecha ilegible, hora ilegible, fuera
   * de rango.
   *
   * `fueraDeRango` es el más importante: es lo que pasa si un desfase de huso
   * horario, o un filtro de fechas que la API interpreta distinto de lo que
   * creemos, deja TODAS las marcas afuera. Sin contarlas, se cargaría cero y
   * los otros tres contadores quedarían en cero: éxito reportado sobre nada.
   */
  descartadas: {
    sinLegajo: number;
    fechaIlegible: number;
    horaIlegible: number;
    fueraDeRango: number;
  };
}

/**
 * Convierte las marcaciones sueltas que devuelve la API en la forma que espera
 * `reconciliarTokens`: por legajo, un día por cada día del rango —incluidos
 * los que no tienen ninguna marca— con los tokens ordenados por hora.
 *
 * DOS COSAS QUE PARECEN DE MÁS Y NO LO SON:
 *
 * 1. **Los días vacíos se generan.** El Excel trae una fila por día aunque la
 *    celda esté vacía, y `reconciliarTokens` usa esos días para decidir cerrar
 *    un turno pendiente. Se verificó que la guarda de 2 a 14 horas del cruce
 *    de medianoche ya rechaza cualquier cierre lejano, así que el resultado es
 *    el mismo con o sin ellos: lo que cambia es el texto del aviso. Se generan
 *    igual porque vamos a mantener los dos caminos de carga, y que produzcan
 *    la misma salida palabra por palabra es lo que permite comparar uno contra
 *    el otro cuando algo no cierre.
 *
 * 2. **El tipo E/S lo pone esto, alternando por posición.** La API no dice si
 *    una marca es entrada o salida. Da igual: `pairTokens` empareja por
 *    posición y no por la letra, justamente porque en el borde entre días la
 *    letra del Excel tampoco era confiable. La letra queda sólo para que los
 *    mensajes se lean.
 *
 * UNA CONSECUENCIA QUE NO SE DEDUCE DEL CÓDIGO: una marcación con fecha
 * **fuera** de `[desde, hasta]` se descarta (no hay día donde ponerla), pero
 * su legajo igual queda en el resultado, con todos los días del rango vacíos.
 * Es lo correcto —ese legajo existe en la API— y se cuenta en
 * `descartadas.fueraDeRango`.
 *
 * CONTRATO DE `desde` Y `hasta`: medianoche UTC, ambos inclusive, como los
 * produce `toUtcDateOnly`. Si llegara una fecha con hora, las claves y el
 * `fecha` de salida no coincidirían con lo que espera `reconciliarTokens`.
 * Si `desde > hasta` el bucle no itera y cada legajo queda con `[]`, sin
 * aviso: no se defiende acá, lo fija un test, y es responsabilidad de quien
 * llama no pedir un rango invertido.
 */
export function agruparPorLegajo(
  marcaciones: MarcacionLenox[],
  desde: Date,
  hasta: Date
): Agrupadas {
  const descartadas = { sinLegajo: 0, fechaIlegible: 0, horaIlegible: 0, fueraDeRango: 0 };
  // legajo → "YYYY-MM-DD" → horas "HH:MM"
  const horasPorDia = new Map<string, Map<string, string[]>>();

  for (const m of marcaciones) {
    // El `?? ""` sí hace trabajo: la respuesta viene de un JSON.parse sin
    // validar, y sin él un legajo `null` se leería como el legajo "null". Con
    // la fecha y la hora no hace falta: String(undefined) no matchea el regex
    // y cae igual en su contador.
    const legajo = String(m.legajo ?? "").trim();
    if (!legajo) {
      descartadas.sinLegajo++;
      continue;
    }
    // El legajo se registra antes de leer la fecha: una persona cuya única
    // marca vino ilegible tiene que aparecer igual (con sus días vacíos) y no
    // desaparecer del resultado como si la API no la hubiera mencionado.
    if (!horasPorDia.has(legajo)) horasPorDia.set(legajo, new Map());
    const dias = horasPorDia.get(legajo)!;

    // Una fila ilegible se descarta, no se le inventa un día.
    const fecha = fechaDe(String(m.marcacionFecha));
    if (!fecha) {
      descartadas.fechaIlegible++;
      continue;
    }
    const hora = horaDe(String(m.marcacionHora));
    if (!hora) {
      descartadas.horaIlegible++;
      continue;
    }
    if (fecha.getTime() < desde.getTime() || fecha.getTime() > hasta.getTime()) {
      descartadas.fueraDeRango++;
      continue;
    }

    const clave = fecha.toISOString().slice(0, 10);
    if (!dias.has(clave)) dias.set(clave, []);
    dias.get(clave)!.push(hora);
  }

  const resultado = new Map<string, DiaMarcacionesTokens[]>();
  for (const [legajo, dias] of horasPorDia) {
    const delLegajo: DiaMarcacionesTokens[] = [];
    for (let f = desde; f.getTime() <= hasta.getTime(); f = addUtcDays(f, 1)) {
      const horas = (dias.get(f.toISOString().slice(0, 10)) ?? []).slice().sort();
      const tokens: TokenMarcacion[] = horas.map((hora, i) => ({
        tipo: i % 2 === 0 ? "E" : "S",
        hora,
      }));
      delLegajo.push({ fecha: f, tokens });
    }
    resultado.set(legajo, delLegajo);
  }
  return { porLegajo: resultado, descartadas };
}
