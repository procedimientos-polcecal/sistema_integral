import ExcelJS from "exceljs";

/**
 * Leer y escribir .xlsx, con `exceljs`.
 *
 * POR QUÉ EXISTE ESTE ARCHIVO
 *
 * Hasta el 03/10/2026 esto lo hacía `xlsx` (SheetJS) en cinco lugares. Esa
 * librería tiene **dos vulnerabilidades altas sin arreglo posible**
 * —prototype pollution (GHSA-4r6h-8v6p-xvw6) y ReDoS (GHSA-5pgg-2g8v-p4x9)—
 * porque SheetJS dejó de publicar en npm después de la 0.18.5, así que
 * `npm audit fix` no puede hacer nada. Y lo que parsea son **archivos que sube
 * la gente**: el padrón de RRHH, las marcaciones del reloj, los equipos de
 * Mantenimiento, los vehículos de Remises.
 *
 * `exceljs` ya era dependencia y ya lo usaban los tres exportadores de informes
 * (Cantera, Trituración, Taller Vial), así que no entra nada nuevo al repo.
 *
 * ── LO QUE SE MIDIÓ ANTES DE MIGRAR, PORQUE ACÁ HAY FECHAS ──
 *
 * El repo ya se comió dar vuelta 885 fechas una vez, así que la pregunta era si
 * las dos librerías leen una fecha igual. **No leen igual, y la que estaba mal
 * era SheetJS.** Medido el 03/10/2026:
 *
 * - `excelToDate` de exceljs es aritmética UTC pura:
 *   `new Date(Math.round((serial - 25569) * 86400000))`. Idéntica al
 *   `excelSerialToDate()` que `lib/rrhh/excelImport.ts` ya tenía escrito a mano.
 * - El **escritor** de SheetJS, en cambio, aplica el huso local: pedirle que
 *   guarde el 2026-06-01 en una máquina en Buenos Aires deja el serial
 *   `46173,874…` en vez de `46174`. Su lector lo compensa, así que SheetJS
 *   consigo mismo cierra — y por eso nunca se notó.
 * - Leyendo un archivo **correcto** (serial `46174`, que es lo que escribe
 *   Excel, Google Sheets o un reloj biométrico), SheetJS en Buenos Aires
 *   devuelve `2026-06-01T03:00:48Z` y exceljs devuelve `2026-06-01T00:00:00Z`.
 *
 * O sea: en Vercel, que corre en UTC, las dos coincidían; en la máquina de
 * quien desarrolla, SheetJS corría las fechas tres horas. Migrar no arriesga
 * las fechas, **las arregla**, y de paso hace que leer un archivo dé lo mismo
 * acá que allá — que es la misma regla que `lib/core/fechas.ts` defiende para
 * el resto del sistema.
 *
 * ── QUÉ SE REPLICA DE `sheet_to_json`, Y POR QUÉ TAL CUAL ──
 *
 * Las cinco llamadas que se migran usaban `sheet_to_json` con `defval: ""`, en
 * sus dos modos. Replicar la forma exacta es lo que permite que el resto del
 * código no cambie. Cada regla de `clavesDeEncabezado` y `aFilas` salió de
 * correr SheetJS y mirar qué devolvía, no de leer su documentación.
 */

/** Una hoja ya leída: su nombre y su contenido como array de arrays. */
export interface HojaLeida {
  nombre: string;
  /**
   * Equivalente a `sheet_to_json(hoja, { header: 1, defval: "" })`: una fila
   * por renglón, rellenada hasta el ancho de la hoja, con `""` donde no hay
   * nada.
   */
  matriz: unknown[][];
}

/**
 * El valor de una celda, llevado a lo que devolvía SheetJS.
 *
 * `exceljs` es más expresivo y devuelve objetos donde SheetJS devolvía el valor
 * pelado: una fórmula llega como `{ formula, result }`, un texto con formato
 * como `{ richText: [...] }` y un enlace como `{ text, hyperlink }`. Nada de
 * eso le sirve a quien después hace `String(celda).trim()`, así que se aplana
 * acá y no en cada lector.
 *
 * Una celda vacía va a `""` y no a `null`, que es lo que hacía `defval: ""`.
 */
function valorDeCelda(valor: unknown): unknown {
  if (valor === null || valor === undefined) return "";
  if (valor instanceof Date) return valor;
  if (typeof valor === "object") {
    const o = valor as Record<string, unknown>;
    // Fórmula: SheetJS devolvía el valor cacheado, no la fórmula.
    if ("result" in o) return valorDeCelda(o.result);
    if ("formula" in o || "sharedFormula" in o) return "";
    // Texto con formato: las partes concatenadas.
    if (Array.isArray(o.richText)) {
      return (o.richText as { text?: unknown }[]).map((p) => String(p?.text ?? "")).join("");
    }
    // Enlace: el texto visible, que es lo que se ve en la celda.
    if ("hyperlink" in o && "text" in o) return valorDeCelda(o.text);
    // `#N/A`, `#REF!`: no son un dato.
    if ("error" in o) return "";
  }
  return valor;
}

/**
 * La matriz recortada al rectángulo que de verdad tiene datos.
 *
 * ES LA DIFERENCIA MÁS GRANDE ENTRE LAS DOS LIBRERÍAS, y no se ve hasta que se
 * prueba con una planilla real. SheetJS se guía por el **rango declarado** de
 * la hoja (`!ref`), así que si la tabla empieza en C9 su primera fila es la 9 y
 * su primera columna la C. `exceljs` arranca siempre en A1 e informa como
 * "fila" todo renglón que tenga algún rastro en el archivo: un formato, un
 * borde, una celda que alguna vez tuvo algo.
 *
 * Sin este recorte pasaban las dos cosas, medidas sobre dieciséis planillas
 * reales el 03/10/2026:
 *
 * - **Filas de más al final**: 18 contra 29 en un libro de Compras, 7 contra 32
 *   en otro. Una importación levantaría decenas de filas en blanco y las
 *   contaría como importadas.
 * - **Todo corrido** cuando la tabla no empieza en A1: el encabezado real caía
 *   como un dato más y las claves salían `__EMPTY_8`, `__EMPTY_9`. Eso no es
 *   un detalle cosmético: es el importador leyendo la columna equivocada.
 *
 * Se recortan los dos extremos, en las dos dimensiones.
 */
export function recortarAlRango(matriz: unknown[][]): unknown[][] {
  const vacia = (v: unknown) => v === "" || v === null || v === undefined;

  let arriba = 0;
  let abajo = matriz.length;
  while (arriba < abajo && (matriz[arriba] ?? []).every(vacia)) arriba++;
  while (abajo > arriba && (matriz[abajo - 1] ?? []).every(vacia)) abajo--;
  if (arriba >= abajo) return [];

  const filas = matriz.slice(arriba, abajo);
  const ancho = filas.reduce((max, f) => Math.max(max, f.length), 0);

  let izq = 0;
  let der = ancho;
  while (izq < der && filas.every((f) => vacia(f[izq]))) izq++;
  while (der > izq && filas.every((f) => vacia(f[der - 1]))) der--;

  return filas.map((f) => {
    const recortada = f.slice(izq, der);
    // Todas las filas quedan del mismo ancho: de eso depende `aFilas` para que
    // a ninguna le falte una clave.
    while (recortada.length < der - izq) recortada.push("");
    return recortada;
  });
}

/**
 * Todas las hojas de un .xlsx, en orden.
 *
 * Es `async` porque `exceljs` lo es — SheetJS leía sincrónico. Las cinco
 * llamadas que se migraron ya estaban adentro de funciones `async`, así que el
 * cambio no se propaga más allá de un `await`.
 */
export async function leerLibro(datos: ArrayBuffer | Buffer | Uint8Array): Promise<HojaLeida[]> {
  const libro = new ExcelJS.Workbook();
  // `exceljs` pide un ArrayBuffer o un Buffer; un Uint8Array que no sea Buffer
  // hay que desenvolverlo o lo rechaza.
  const entrada =
    datos instanceof ArrayBuffer
      ? datos
      : Buffer.isBuffer(datos)
        ? datos
        : Buffer.from(datos as Uint8Array);
  await libro.xlsx.load(entrada as ArrayBuffer);

  return libro.worksheets.map((hoja) => {
    const ancho = hoja.columnCount;
    const matriz: unknown[][] = [];
    // `includeEmpty: true` para que una fila en blanco en el medio no corra
    // todo lo de abajo un lugar para arriba.
    hoja.eachRow({ includeEmpty: true }, (fila, numero) => {
      const celdas: unknown[] = [];
      for (let c = 1; c <= ancho; c++) celdas.push(valorDeCelda(fila.getCell(c).value));
      matriz[numero - 1] = celdas;
    });
    // `eachRow` saltea índices si el archivo no trae esa fila; los huecos se
    // rellenan para que `matriz[i]` siempre sea un array.
    for (let i = 0; i < matriz.length; i++) {
      if (!matriz[i]) matriz[i] = new Array(ancho).fill("");
    }
    return { nombre: hoja.name, matriz: recortarAlRango(matriz) };
  });
}

/**
 * Las claves que SheetJS le ponía a cada columna en el modo objeto.
 *
 * Las tres reglas salieron de medirlo (03/10/2026), y ninguna es obvia:
 *
 * - Un encabezado **repetido** lleva sufijo: `X`, `X_1`, `X_2`.
 * - Un encabezado **vacío** se llama `__EMPTY`, y el siguiente vacío cae en la
 *   regla del repetido: `__EMPTY_1`, `__EMPTY_2`. Esto costó una vuelta: con un
 *   libro armado a mano, donde la celda del encabezado **existe** y está en
 *   blanco, SheetJS devuelve la clave `""`; en un archivo real la celda
 *   directamente **no está** y ahí usa `__EMPTY`. Lo segundo es lo que pasa en
 *   la práctica —se vio en seis de dieciséis planillas reales el 03/10/2026— y
 *   es lo que se replica.
 * - Un encabezado que **no es texto** se convierte: `2026` da `"2026"` y `true`
 *   da `"TRUE"`, en mayúsculas.
 */
export function clavesDeEncabezado(encabezado: unknown[]): string[] {
  const vistas = new Map<string, number>();
  return encabezado.map((celda) => {
    const base =
      typeof celda === "boolean"
        ? String(celda).toUpperCase()
        : celda === null || celda === undefined || celda === ""
          ? "__EMPTY"
          : String(celda);
    const repetida = vistas.get(base) ?? 0;
    vistas.set(base, repetida + 1);
    return repetida === 0 ? base : `${base}_${repetida}`;
  });
}

/**
 * La matriz pasada a objetos, como `sheet_to_json(hoja, { defval: "" })`.
 *
 * `desdeFila` es el `range` de SheetJS: en qué renglón está el encabezado,
 * contando desde cero. Lo usa el importador de marcaciones, donde el reporte
 * del reloj trae filas de filtros antes del encabezado de verdad.
 *
 * Toda fila devuelve **todas** las claves: a la que le falta una columna le
 * queda `""`, no `undefined`. De eso dependen los lectores, que hacen
 * `String(fila[clave]).trim()` sin preguntar.
 *
 * Es una función pura sobre la matriz —no toca `exceljs` ni el archivo— para
 * poder probar estas reglas sin armar un .xlsx, que es donde están las
 * decisiones.
 */
export function aFilas(matriz: unknown[][], desdeFila = 0): Record<string, unknown>[] {
  const encabezado = matriz[desdeFila];
  if (!encabezado) return [];
  const claves = clavesDeEncabezado(encabezado);

  const filas: Record<string, unknown>[] = [];
  for (let i = desdeFila + 1; i < matriz.length; i++) {
    const cruda = matriz[i] ?? [];
    const fila: Record<string, unknown> = {};
    claves.forEach((clave, c) => {
      const v = cruda[c];
      fila[clave] = v === undefined || v === null ? "" : v;
    });
    filas.push(fila);
  }
  return filas;
}

/** Lee un .xlsx y devuelve la primera hoja ya pasada a objetos. */
export async function leerPrimeraHoja(
  datos: ArrayBuffer | Buffer | Uint8Array
): Promise<{ filas: Record<string, unknown>[]; encabezados: string[] }> {
  const hojas = await leerLibro(datos);
  if (hojas.length === 0) return { filas: [], encabezados: [] };
  const { matriz } = hojas[0];
  return {
    filas: aFilas(matriz),
    encabezados: matriz[0] ? clavesDeEncabezado(matriz[0]) : [],
  };
}

/** Una hoja a escribir: su nombre, sus filas y, si hace falta, los anchos. */
export interface HojaAEscribir {
  nombre: string;
  filas: unknown[][];
  /** En caracteres, una entrada por columna. */
  anchos?: number[];
}

/**
 * Arma el .xlsx en memoria.
 *
 * El nombre de hoja se recorta a 31 caracteres porque es el límite de Excel y
 * pasarse hace que el archivo no abra — misma guarda que tenía el exportador
 * anterior.
 */
export async function libroXlsx(hojas: HojaAEscribir[]): Promise<Buffer> {
  const libro = new ExcelJS.Workbook();
  for (const { nombre, filas, anchos } of hojas) {
    const hoja = libro.addWorksheet(nombre.slice(0, 31));
    if (anchos?.length) hoja.columns = anchos.map((width) => ({ width }));
    for (const fila of filas) hoja.addRow(fila as ExcelJS.CellValue[]);
  }
  return Buffer.from(await libro.xlsx.writeBuffer());
}
