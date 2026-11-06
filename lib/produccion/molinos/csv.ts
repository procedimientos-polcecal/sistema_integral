/**
 * Lee los CSV que deja el PC Robot de los dos molinos. Es lógica pura: recibe
 * el texto ya decodificado (cp1252) y devuelve filas crudas más los avisos de
 * lo que no pudo leer. No toca Drive ni la base.
 *
 * Los archivos son `;`, sin encabezado, con la fecha `d/m/yyyy`, y traen
 * líneas en blanco —`DAT00000001.CSV` de Filler 2 tiene 747 líneas para unas
 * 249 filas útiles—, así que una línea vacía no es un error.
 *
 * **`porMaterial` existe aunque ninguna pantalla lo muestre.** Los indicadores
 * van por molino, no por material. Pero la etiqueta `MATERIAL` de
 * `DAT00000001` de Filler 1 está mal el 11,3 % de las veces: de 809 turnos,
 * 127 mezclaron dos materiales, y la macro vieja mandaba el turno entero a la
 * etiqueta, con lo que inflaba la caliza un 21 %. Por eso se guarda el reparto
 * **correcto** —el de los archivos por corte, `DAT00000003..06`— y **la
 * etiqueta cruda no se guarda**: así nadie puede reconstruir mañana el error
 * por el camino corto. Las columnas `MATERIAL` y `MODO` se descartan acá.
 *
 * Los vocabularios de `porMaterial` son distintos por molino (ver `FilaCruda`).
 */

import type { CorteDeTurno, FilaCruda } from "./types";

const CORTES: readonly CorteDeTurno[] = ["3:59", "11:59", "19:59", "23:59"];

/**
 * Orden de las tres columnas de `DAT00000003..06` de Filler 1: verificado
 * contra el dato (18/10 a las 3:59 son `51511;0;0` y la etiqueta de DAT1 dice
 * MEMBRANERO; 19/10 son `0;0;46753` y dice CALIZA).
 */
const MATERIALES_FILLER_1 = ["membranero", "dolomita", "caliza"] as const;

/** Orden de los seis pares `kg;minutos` de Filler 2. */
const MATERIALES_FILLER_2 = [
  "piedra_membranero",
  "piedra_dolomita",
  "piedra_caliza",
  "arena_membranero",
  "arena_dolomita",
  "arena_caliza",
] as const;

interface Renglon {
  fecha: string;
  corte: CorteDeTurno;
  /** Los campos numéricos, después de fecha y hora. */
  campos: string[];
}

/** "d/m/yyyy" a "YYYY-MM-DD", o null si no es una fecha real. */
function fechaIso(texto: string): string | null {
  const m = texto.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  const d = Number(m[1]);
  const mes = Number(m[2]);
  const a = Number(m[3]);
  // Se valida contra el calendario: 31/2 no se corrige a marzo en silencio.
  const f = new Date(Date.UTC(a, mes - 1, d));
  if (f.getUTCFullYear() !== a || f.getUTCMonth() !== mes - 1 || f.getUTCDate() !== d) return null;
  return `${a}-${String(mes).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** "03:59" y "3:59" son la misma hora; el robot escribe la segunda. */
function normalizarHora(texto: string): string {
  const m = texto.trim().match(/^(\d{1,2}):(\d{2})$/);
  return m ? `${Number(m[1])}:${m[2]}` : texto.trim();
}

function esCorte(hora: string): hora is CorteDeTurno {
  return (CORTES as readonly string[]).includes(hora);
}

/** Entero no negativo, o null. Los kilos del robot son enteros. */
function numero(texto: string): number | null {
  const t = texto.trim();
  if (!/^\d+$/.test(t)) return null;
  return Number(t);
}

/**
 * Parte el texto en renglones con fecha y corte válidos. Lo que no sirve se
 * descarta con un aviso que dice cuál era la línea: un renglón mal formado no
 * se completa con ceros, porque un cero de relleno es un dato.
 */
function leerRenglones(
  texto: string,
  camposEsperados: number,
  archivo: string,
  avisos: string[],
): Renglon[] {
  const salida: Renglon[] = [];
  for (const [i, linea] of texto.split("\n").entries()) {
    // Un fin de línea CRLF deja un `\r` pegado al último campo. No se lo saca
    // aparte: el último campo que se lee es siempre numérico y `numero()` hace
    // `trim()`; en DAT1 el que queda con `\r` es MODO, que no se lee.
    if (linea.trim() === "") continue;
    const donde = `${archivo}, línea ${i + 1}`;

    const partes = linea.split(";");
    if (partes.length < 2 + camposEsperados) {
      avisos.push(`${donde}: tiene ${partes.length} campos y se esperaban al menos ${2 + camposEsperados}.`);
      continue;
    }
    const fecha = fechaIso(partes[0]);
    if (!fecha) {
      avisos.push(`${donde}: la fecha "${partes[0]}" no es una fecha d/m/aaaa válida.`);
      continue;
    }
    const hora = normalizarHora(partes[1]);
    if (!esCorte(hora)) {
      // Se imprime lo que traía el archivo, no la hora normalizada: es lo que
      // alguien va a buscar en el CSV.
      avisos.push(`${donde}: la hora ${partes[1].trim()} no es ninguno de los cuatro cortes (${CORTES.join(", ")}).`);
      continue;
    }
    salida.push({ fecha, corte: hora, campos: partes.slice(2, 2 + camposEsperados) });
  }
  return salida;
}

/** Convierte los campos a número; null (con aviso) si alguno no lo es. */
function numeros(r: Renglon, archivo: string, avisos: string[]): number[] | null {
  const valores = r.campos.map(numero);
  if (valores.some((v) => v === null)) {
    avisos.push(`${archivo}, ${r.fecha} ${r.corte}: hay un valor que no es un número entero (${r.campos.join(";")}).`);
    return null;
  }
  return valores as number[];
}

/**
 * Filler 1. `dat1` es `DAT00000001`: `fecha;hora;kg1;kg2;kg3;kg4;minutos;"min";MATERIAL;MODO`.
 * De los cuatro campos de kilos sólo uno trae valor, así que el kg del turno
 * es la suma de los cuatro. `desglose` es el texto de `DAT00000003..06`
 * indexado por la hora de cierre de cada uno (`fecha;hora;membranero;dolomita;caliza`).
 *
 * Sin desglose para un turno, `porMaterial` queda `{}` y no se inventa uno.
 */
export function leerFiller1(
  dat1: string,
  desglose: Partial<Record<CorteDeTurno, string>>,
): { filas: FilaCruda[]; avisos: string[] } {
  const avisos: string[] = [];

  // fecha|corte -> reparto. Se indexa por la hora que trae cada renglón y no
  // por la clave del archivo: el turno lo decide la hora, nunca el archivo.
  const repartos = new Map<string, Record<string, number>>();
  for (const corte of CORTES) {
    const texto = desglose[corte];
    if (texto === undefined) continue;
    const archivo = `desglose de las ${corte}`;
    for (const r of leerRenglones(texto, MATERIALES_FILLER_1.length, archivo, avisos)) {
      if (r.corte !== corte) {
        avisos.push(`${archivo}: el renglón del ${r.fecha} dice ${r.corte}; se usa la hora del renglón.`);
      }
      const v = numeros(r, archivo, avisos);
      if (!v) continue;
      const clave = `${r.fecha}|${r.corte}`;
      if (repartos.has(clave)) {
        avisos.push(`${archivo}: el ${r.fecha} ${r.corte} aparece más de una vez; se usa el último.`);
      }
      repartos.set(clave, Object.fromEntries(MATERIALES_FILLER_1.map((m, i) => [m, v[i]])));
    }
  }

  const filas: FilaCruda[] = [];
  // 4 de kilos + minutos; "min", MATERIAL y MODO no se leen.
  for (const r of leerRenglones(dat1, 5, "DAT00000001", avisos)) {
    const v = numeros(r, "DAT00000001", avisos);
    if (!v) continue;
    const [kg1, kg2, kg3, kg4, minutos] = v;
    filas.push({
      fecha: r.fecha,
      corte: r.corte,
      kg: kg1 + kg2 + kg3 + kg4,
      minutos,
      porMaterial: repartos.get(`${r.fecha}|${r.corte}`) ?? {},
    });
  }
  return { filas, avisos };
}

/**
 * Filler 2. Cada archivo es `fecha;hora;` y seis pares `kg;minutos`: piedra
 * membranero, piedra dolomita, piedra caliza, arena membranero, arena dolomita,
 * arena caliza. El kg y los minutos del turno son la suma de los seis pares.
 */
export function leerFiller2(
  porCorte: Partial<Record<CorteDeTurno, string>>,
): { filas: FilaCruda[]; avisos: string[] } {
  const avisos: string[] = [];
  const filas: FilaCruda[] = [];

  for (const corte of CORTES) {
    const texto = porCorte[corte];
    if (texto === undefined) continue;
    const archivo = `archivo de las ${corte}`;
    for (const r of leerRenglones(texto, MATERIALES_FILLER_2.length * 2, archivo, avisos)) {
      if (r.corte !== corte) {
        avisos.push(`${archivo}: el renglón del ${r.fecha} dice ${r.corte}; se usa la hora del renglón.`);
      }
      const v = numeros(r, archivo, avisos);
      if (!v) continue;
      let kg = 0;
      let minutos = 0;
      const porMaterial: Record<string, number> = {};
      MATERIALES_FILLER_2.forEach((m, i) => {
        porMaterial[m] = v[i * 2];
        kg += v[i * 2];
        minutos += v[i * 2 + 1];
      });
      filas.push({ fecha: r.fecha, corte: r.corte, kg, minutos, porMaterial });
    }
  }
  return { filas, avisos };
}
