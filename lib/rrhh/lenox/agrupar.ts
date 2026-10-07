import { addUtcDays, toUtcDateOnly } from "../dates";
import type { DiaMarcacionesTokens, TokenMarcacion } from "../excelImport";
import type { MarcacionLenox } from "./tipos";

/** "2026-10-02" → el día calendario como medianoche UTC. Null si no se entiende. */
function fechaDe(valor: string): Date | null {
  const m = valor.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  return toUtcDateOnly(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

/** "07:58:00" → "07:58". Null si no se entiende. */
function horaDe(valor: string): string | null {
  const m = valor.trim().match(/^(\d{1,2}):(\d{2})/);
  if (!m) return null;
  return `${m[1].padStart(2, "0")}:${m[2]}`;
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
 */
export function agruparPorLegajo(
  marcaciones: MarcacionLenox[],
  desde: Date,
  hasta: Date
): Map<string, DiaMarcacionesTokens[]> {
  // legajo → "YYYY-MM-DD" → horas "HH:MM"
  const horasPorDia = new Map<string, Map<string, string[]>>();

  for (const m of marcaciones) {
    const legajo = String(m.legajo ?? "").trim();
    if (!legajo) continue;
    // El legajo se registra antes de leer la fecha: una persona cuya única
    // marca vino ilegible tiene que aparecer igual (con sus días vacíos) y no
    // desaparecer del resultado como si la API no la hubiera mencionado.
    if (!horasPorDia.has(legajo)) horasPorDia.set(legajo, new Map());
    const dias = horasPorDia.get(legajo)!;

    const fecha = fechaDe(String(m.marcacionFecha ?? ""));
    const hora = horaDe(String(m.marcacionHora ?? ""));
    if (!fecha || !hora) continue; // una fila ilegible se descarta, no se le inventa un día

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
  return resultado;
}
