/**
 * Leer una planilla de Google, sea cual sea.
 *
 * `lib/compras/sheets.ts` tiene su propio lector, atado a la planilla de
 * PEDIDOS DE COMPRA y con todo el manejo de celdas protegidas que esa
 * sincronización necesita. Esto es lo mínimo para cualquier otra: se le pasa
 * qué planilla y qué pestaña.
 */

import {
  obtenerToken, SCOPE_SHEETS, SCOPE_SHEETS_LECTURA, mensajeDeGoogle, cuentaDeServicio,
} from "@/lib/core/google";
// Las planillas de mantenimiento pasan de veintiseis columnas: la letra no se
// saca sumandole el indice a la "A". La cuenta vive en el nucleo, una sola vez.
import { letraDeColumna } from "@/lib/core/columnaDeSheets";
export { letraDeColumna };

/**
 * Cuánto se espera a Google antes de dar la llamada por perdida.
 *
 * `fetch` sin `AbortSignal` **no tiene cota**: si Google acepta la conexión y no
 * contesta, la llamada queda colgada hasta que la plataforma mate la función. Y
 * una función muerta no es un error que alguien pueda leer: no se anota el
 * pendiente, no se le avisa a nadie y quien hizo la acción ve un fallo genérico
 * sobre algo que a lo mejor se guardó. Con la cota, un Google colgado se
 * convierte en un pendiente con motivo, que es lo que el módulo pide para
 * cualquier fallo de escritura.
 *
 * Treinta segundos son **holgados a propósito**: este archivo lo comparten los
 * siete módulos y la lectura más grande que hay hoy —las ~1.900 filas del master
 * de Compras, las ~1.766 del libro de Mantenimiento— vuelve en uno o dos
 * segundos. O sea que no puede cortar una llamada que iba a andar; sólo corta
 * las que no iban a volver. Ningún llamador espera indefinidamente a propósito:
 * todos corren dentro de un Route Handler o de un cron, que ya tienen su propio
 * `maxDuration`, así que la elección no es "esperar o no" sino "quién corta y
 * con qué diagnóstico".
 */
const CORTE_MS = 30_000;

/**
 * `fetch` con cota de tiempo y un mensaje que se distingue.
 *
 * El `TimeoutError` de `AbortSignal` dice "The operation was aborted due to
 * timeout" y nada más: no dice a qué planilla ni en qué paso. Se traduce a algo
 * que sirva en `sheets_pendiente`, que es lo que alguien lee para saber si tiene
 * que ir a mirar la planilla o esperar.
 */
async function pedir(url: string, init: RequestInit = {}): Promise<Response> {
  try {
    return await fetch(url, { ...init, signal: AbortSignal.timeout(CORTE_MS) });
  } catch (e) {
    if (e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError")) {
      throw new Error(
        `Google no contestó en ${CORTE_MS / 1000} segundos y se cortó la espera; ` +
          `se reintenta solo`,
        { cause: e }
      );
    }
    throw e;
  }
}

/**
 * Los valores de una pestaña, incluida la fila de encabezados.
 *
 * `sinFormato` pide los valores crudos en vez del texto que se ve: las fechas
 * llegan como serial numérico en lugar de "1/12/2025". Es preferible cuando hay
 * fechas de por medio — el texto formateado depende del locale de la planilla,
 * y confundir el día con el mes ya nos costó corregir 885 registros en Compras.
 */
export async function leerValores(
  planillaId: string,
  pestana: string,
  opciones: { sinFormato?: boolean } = {}
): Promise<string[][]> {
  const token = await obtenerToken([SCOPE_SHEETS_LECTURA]);

  const url =
    `https://sheets.googleapis.com/v4/spreadsheets/${planillaId}` +
    `/values/${encodeURIComponent(pestana)}` +
    (opciones.sinFormato ? "?valueRenderOption=UNFORMATTED_VALUE" : "");

  const res = await pedir(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) {
    throw new Error(mensajeDeGoogle(res.status, await res.text(), cuentaDeServicio(), "leer"));
  }

  return ((await res.json()).values ?? []) as string[][];
}

/** Los nombres de las pestañas de una planilla. */
export async function listarPestanas(planillaId: string): Promise<string[]> {
  const token = await obtenerToken([SCOPE_SHEETS_LECTURA]);

  const url =
    `https://sheets.googleapis.com/v4/spreadsheets/${planillaId}` +
    `?fields=sheets.properties.title`;

  const res = await pedir(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) {
    throw new Error(mensajeDeGoogle(res.status, await res.text(), cuentaDeServicio(), "leer"));
  }

  const json = await res.json();
  return (json.sheets ?? []).map((s: { properties: { title: string } }) => s.properties.title);
}

/**
 * Ensanchar una pestaña hasta que tenga al menos `cantidad` columnas.
 *
 * **Una pestaña tiene un ancho de verdad, y escribir afuera no agranda nada.**
 * Google contesta `400 … exceeds grid limits. Max rows: 3400, max columns: 10`
 * y rechaza el `batchUpdate` entero, no la celda que sobra. Eso es lo que pasó
 * el 14/10/2026 al querer escribir la `K` del libro de carbonilla: la columna
 * se veía vacía en la planilla porque **no existía**, que no es lo mismo.
 *
 * Devuelve cuántas columnas se agregaron. Si ya alcanzaban, no llama a Google
 * para escribir y devuelve 0.
 */
export async function asegurarColumnas(
  planillaId: string,
  pestana: string,
  cantidad: number
): Promise<number> {
  const token = await obtenerToken([SCOPE_SHEETS]);

  const url =
    `https://sheets.googleapis.com/v4/spreadsheets/${planillaId}` +
    `?fields=sheets.properties(sheetId,title,gridProperties.columnCount)`;

  const res = await pedir(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) {
    throw new Error(mensajeDeGoogle(res.status, await res.text(), cuentaDeServicio(), "leer"));
  }

  type Hoja = {
    properties: { sheetId: number; title: string; gridProperties?: { columnCount?: number } };
  };
  const hoja = ((await res.json()).sheets ?? ([] as Hoja[])).find(
    (s: Hoja) => s.properties.title === pestana
  ) as Hoja | undefined;

  if (!hoja) throw new Error(`La planilla no tiene una pestaña llamada "${pestana}".`);

  const tiene = hoja.properties.gridProperties?.columnCount ?? 0;
  if (tiene >= cantidad) return 0;

  const faltan = cantidad - tiene;
  const esc = await pedir(
    `https://sheets.googleapis.com/v4/spreadsheets/${planillaId}:batchUpdate`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        requests: [
          {
            appendDimension: {
              sheetId: hoja.properties.sheetId,
              dimension: "COLUMNS",
              length: faltan,
            },
          },
        ],
      }),
    }
  );
  if (!esc.ok) {
    throw new Error(mensajeDeGoogle(esc.status, await esc.text(), cuentaDeServicio(), "escribir"));
  }

  return faltan;
}

/**
 * Escribe celdas sueltas de una planilla, todas de una.
 *
 * Una llamada por celda gastaría una cuota que no hace falta gastar, y dejaría
 * la planilla a medio escribir si falla la tercera de cinco.
 */
/*
 * `valor` acepta número desde el 16/09/2026, y conviene usarlo.
 *
 * La escritura va con `USER_ENTERED`, así que un `"19,58"` lo interpreta la
 * planilla según su locale — la misma trampa que leyendo m/d en vez de d/m dio
 * vuelta 885 fechas en Compras. `agregarFila` ya aceptaba `string | number`;
 * esto empareja las dos. Un número no se interpreta.
 */
export async function escribirCeldas(
  planillaId: string,
  celdas: { pestana: string; columna: number; fila: number; valor: string | number }[]
): Promise<void> {
  if (celdas.length === 0) return;

  const token = await obtenerToken([SCOPE_SHEETS]);
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${planillaId}/values:batchUpdate`;

  const res = await pedir(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      valueInputOption: "USER_ENTERED",
      data: celdas.map((c) => ({
        range: `${c.pestana}!${letraDeColumna(c.columna)}${c.fila}`,
        values: [[c.valor]],
      })),
    }),
  });

  if (!res.ok) {
    throw new Error(mensajeDeGoogle(res.status, await res.text(), cuentaDeServicio()));
  }
}

/** Agrega una fila al final de una pestaña y devuelve en qué fila quedó. */
/**
 * En qué fila escribir, según la columna que dice si una fila tiene datos.
 *
 * Va aparte de la llamada a Google para poder probarla. Se mira **una** columna
 * y no la hoja entera porque el formato, las fórmulas y los desplegables llegan
 * mucho más abajo que lo cargado.
 *
 * Cuál es esa columna depende de la planilla, y no siempre es la A: en el kardex
 * del almacén la A es el N° de requerimiento y viene vacía en la mayoría de las
 * filas, así que ahí la que manda es la B, el código del artículo. Elegir mal
 * deja la fila nueva en medio de los datos.
 *
 * Una fila vacía en el medio no corta la cuenta: se busca la última con algo,
 * no la primera sin nada.
 */
export function filaSiguienteSegunLaColumna(columna: string[][]): number {
  for (let i = columna.length - 1; i >= 0; i--) {
    if (String(columna[i]?.[0] ?? "").trim()) return i + 2;
  }
  // Ni encabezado: se empieza en la 2 y la 1 queda para los títulos.
  return 2;
}

/**
 * Si la planilla trae mucho menos de lo que ya sabíamos que tenía.
 *
 * ESTO PASÓ, Y COSTÓ UNA PLANILLA. El 13/10/2026 la pestaña `OT` quedó vacía
 * —alguien la borró a las 11:22 y la restauró recién a las 12:13—. A las 12:09,
 * en el medio, se creó una OT desde la app: leyó la columna A, encontró **dos
 * filas**, concluyó que la siguiente libre era la 3 y escribió ahí, encima de
 * donde vive la OT 623. La app hizo exactamente lo que le pedía su cuenta; lo
 * que faltaba era que se diera cuenta de que la planilla no estaba en
 * condiciones de recibir nada.
 *
 * El número de OT se salvó de casualidad: `proximoNumeroDeOT` se cae al máximo
 * de la base cuando la planilla dice menos, así que salió 2777 y no 623. La
 * fila no tenía esa red.
 *
 * La regla no lleva umbral inventado: **cada `sheets_row` que tenemos guardado
 * es la promesa de que esa fila existe.** Si la planilla devuelve menos filas
 * que la mayor que anotamos, esa promesa ya está rota y cualquier cosa que
 * escribamos cae sobre datos de otro. Se niega y se dice por qué, que es lo
 * único que convierte una pérdida silenciosa en un problema que alguien mira.
 */
export function laPlanillaEncogio(filasLeidas: number, filaMasAltaConocida: number): boolean {
  if (filaMasAltaConocida <= 0) return false;
  return filasLeidas < filaMasAltaConocida;
}

/**
 * Los tramos contiguos de una fila, salteando lo que no hay que tocar.
 *
 * Un `null` es "esta celda no se escribe". Hacía falta porque escribir la fila
 * entera como un solo rango obliga a mandar **algo** en cada columna, y ese
 * algo era `""`: en la planilla de OT, la columna L es una fórmula que calcula
 * atrasado/al día, y el comentario del código decía que se dejaba vacía "porque
 * la planilla la completa sola al agregarse la fila". No se agrega ninguna
 * fila: se hace un PUT sobre un rango que ya existe, así que ese `""` no la
 * dejaba vacía — la borraba.
 *
 * Se devuelven tramos y no celdas sueltas para no mandar veintitrés rangos de
 * una celda cuando alcanzan dos.
 */
export function tramosDeLaFila(
  valores: readonly (string | number | null)[]
): { desde: number; hasta: number; valores: (string | number)[] }[] {
  const tramos: { desde: number; hasta: number; valores: (string | number)[] }[] = [];
  let actual: { desde: number; valores: (string | number)[] } | null = null;

  for (let i = 0; i < valores.length; i++) {
    const v = valores[i];
    if (v === null) {
      if (actual) {
        tramos.push({ desde: actual.desde, hasta: i - 1, valores: actual.valores });
        actual = null;
      }
      continue;
    }
    if (!actual) actual = { desde: i, valores: [] };
    actual.valores.push(v);
  }
  if (actual) {
    tramos.push({ desde: actual.desde, hasta: valores.length - 1, valores: actual.valores });
  }
  return tramos;
}

/**
 * Agrega una fila al final y devuelve qué número de fila quedó.
 *
 * Antes usaba `append` de Google, que en una sola llamada resuelve dónde
 * escribir. El problema es cómo lo resuelve: busca el final de "la tabla" y
 * salta después de cualquier contenido de la hoja, incluido el formato y las
 * fórmulas que no son datos. Es el mismo error que en Compras mandó dos
 * presupuestos mil filas más abajo de donde se los podía ver.
 *
 * Acá salió más caro. La OT 2381 quedó en la fila 3717 de una planilla con
 * ~1.766 filas de datos: invisible para quien trabaja en el Sheets, que siguió
 * numerando desde la última fila que sí veía y volvió a usar el 2381. Dos
 * órdenes con el mismo número rompen la sincronización entera y dejan la
 * escritura de vuelta apuntando a la fila equivocada.
 *
 * Ahora la fila se busca por la columna A y se escribe en un rango explícito.
 * Se pierde la atomicidad de `append`: entre averiguar la fila y escribirla
 * alguien podría agregar una a mano y quedaría pisada. Es el mismo riesgo
 * aceptado en Compras —son segundos— y a cambio la fila queda donde se la ve.
 */
export async function agregarFila(
  planillaId: string,
  pestana: string,
  valores: (string | number)[],
  /*
   * Qué columna decide dónde termina lo cargado. Por defecto la `A`, que es lo
   * que necesitan las tres planillas de Mantenimiento.
   *
   * Se puede cambiar porque **no siempre la A se ve**, y elegir mal pisa datos.
   * Esta lectura no pide `valueRenderOption`, así que Google devuelve el texto
   * formateado — y en el libro de Despacho hay renglones cuya celda de fecha
   * tiene el dato (el serial `46273`) pero un formato de número que la muestra
   * vacía. Por la A, la última fila con algo resulta ser la anterior a ésas, y
   * la escritura las sobreescribe. Ahí la que nunca falta es la B, el Nº de
   * orden. Es el mismo problema que `filaSiguienteSegunLaColumna` ya explica
   * para el kardex del almacén, sólo que esta función tenía la A clavada.
   */
  columnaQueManda = "A"
): Promise<number> {
  const token = await obtenerToken([SCOPE_SHEETS]);

  const lectura = await pedir(
    `https://sheets.googleapis.com/v4/spreadsheets/${planillaId}` +
      `/values/${encodeURIComponent(`${pestana}!${columnaQueManda}:${columnaQueManda}`)}`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!lectura.ok) {
    throw new Error(mensajeDeGoogle(lectura.status, await lectura.text(), cuentaDeServicio()));
  }
  const fila = filaSiguienteSegunLaColumna(((await lectura.json()).values ?? []) as string[][]);

  // El rango tiene que abarcar todas las columnas que se mandan: si se da uno
  // más chico, Google rechaza la escritura entera.
  const rango = `${pestana}!A${fila}:${letraDeColumna(valores.length - 1)}${fila}`;
  const res = await pedir(
    `https://sheets.googleapis.com/v4/spreadsheets/${planillaId}` +
      `/values/${encodeURIComponent(rango)}?valueInputOption=USER_ENTERED`,
    {
      method: "PUT",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ values: [valores] }),
    }
  );
  if (!res.ok) {
    throw new Error(mensajeDeGoogle(res.status, await res.text(), cuentaDeServicio()));
  }

  return fila;
}

/** Un rango combinado, como lo da la API: base 0 y el final no entra. */
export interface RangoCombinado {
  startRowIndex?: number;
  endRowIndex?: number;
  startColumnIndex?: number;
  endColumnIndex?: number;
}

/**
 * Las celdas combinadas de una pestaña.
 *
 * **Una celda combinada sólo trae su valor en la primera fila del bloque**, así
 * que `leerValores` deja en vacío a todas las demás y no hay forma de
 * distinguirlo de una celda que de verdad está vacía. Esto dice dónde están los
 * bloques, para poder repartir el valor entre sus filas.
 *
 * Lo necesitó el listado de envases, donde el stock de seguridad de los
 * bolsones es uno solo para todo el grupo y vive en una celda que abarca nueve
 * filas.
 */
export async function leerCombinaciones(
  planillaId: string,
  pestana: string
): Promise<RangoCombinado[]> {
  const token = await obtenerToken([SCOPE_SHEETS_LECTURA]);

  const url =
    `https://sheets.googleapis.com/v4/spreadsheets/${planillaId}` +
    `?fields=${encodeURIComponent("sheets(properties(title),merges)")}`;

  const res = await pedir(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) {
    throw new Error(mensajeDeGoogle(res.status, await res.text(), cuentaDeServicio(), "leer"));
  }

  const json = (await res.json()) as {
    sheets?: { properties?: { title?: string }; merges?: RangoCombinado[] }[];
  };
  const hoja = (json.sheets ?? []).find((h) => h.properties?.title === pestana);
  return hoja?.merges ?? [];
}

/**
 * Las fórmulas de una pestaña, en vez de sus valores.
 *
 * Sirve para rescatar lo que la celda esconde: un `HYPERLINK` muestra "LINK" y
 * guarda la URL adentro. Leer valores devolvería la palabra.
 */
export async function leerFormulas(
  planillaId: string,
  pestana: string
): Promise<string[][]> {
  const token = await obtenerToken([SCOPE_SHEETS_LECTURA]);

  const url =
    `https://sheets.googleapis.com/v4/spreadsheets/${planillaId}` +
    `/values/${encodeURIComponent(pestana)}?valueRenderOption=FORMULA`;

  const res = await pedir(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) {
    throw new Error(mensajeDeGoogle(res.status, await res.text(), cuentaDeServicio(), "leer"));
  }

  return ((await res.json()).values ?? []) as string[][];
}

/**
 * Qué celdas de un rango son fórmula, fila por fila.
 *
 * `leerValores` y `leerFormulas` piden `/values`, que sólo da lo que se ve o
 * el texto de la fórmula como si fuera un valor más: no alcanza para separar
 * "esta celda la carga una persona" de "esta celda la calcula el libro", que es
 * justo lo que hace falta antes de escribir al lado de una fórmula ajena. Para
 * eso pide `includeGridData`, que en `userEnteredValue` sí distingue
 * `formulaValue` de un literal.
 *
 * Devuelve una fila por cada una del rango pedido —con huecos si la fila no
 * tiene nada en esas columnas— y en cada una `true` en la posición que es
 * fórmula. La columna 0 del resultado es la primera del rango, no la A de la
 * planilla: quien llama es quien sabe el corrimiento.
 */
export async function leerFormulasDeRango(
  planillaId: string,
  pestana: string,
  rango: string
): Promise<boolean[][]> {
  const token = await obtenerToken([SCOPE_SHEETS_LECTURA]);

  const url =
    `https://sheets.googleapis.com/v4/spreadsheets/${planillaId}` +
    `?ranges=${encodeURIComponent(`${pestana}!${rango}`)}` +
    `&includeGridData=true` +
    `&fields=${encodeURIComponent("sheets(data(rowData(values(userEnteredValue))))")}`;

  const res = await pedir(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) {
    throw new Error(mensajeDeGoogle(res.status, await res.text(), cuentaDeServicio(), "leer"));
  }

  const json = await res.json();
  const filas = json.sheets?.[0]?.data?.[0]?.rowData ?? [];
  return (filas as { values?: { userEnteredValue?: { formulaValue?: string } }[] }[]).map(
    (fila) => (fila.values ?? []).map((celda) => celda.userEnteredValue?.formulaValue !== undefined)
  );
}

/**
 * Crea una pestaña y le escribe los encabezados. Devuelve si la creó.
 *
 * Existe para los libros que llevan **una hoja por mes**, como el de Despacho:
 * el 1º de octubre la pestaña de octubre no existe todavía, y sin esto el espejo
 * dejaría de escribir justo el día que empieza el mes — un mes entero de órdenes
 * anotadas como pendientes antes de que alguien se diera cuenta.
 *
 * Los encabezados se pasan desde afuera, copiados de la pestaña anterior, para
 * no clavar acá los títulos de una planilla en particular.
 *
 * Si la pestaña ya existe **no es un error**: devuelve `false` y no toca nada.
 * Google contesta 400 con "already exists" y eso se distingue del resto de los
 * fallos, que sí se lanzan.
 */
export async function crearPestana(
  planillaId: string,
  titulo: string,
  encabezados: string[] = []
): Promise<boolean> {
  const token = await obtenerToken([SCOPE_SHEETS]);

  const res = await pedir(
    `https://sheets.googleapis.com/v4/spreadsheets/${planillaId}:batchUpdate`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        requests: [{ addSheet: { properties: { title: titulo, index: 0 } } }],
      }),
    }
  );

  if (!res.ok) {
    const cuerpo = await res.text();
    if (res.status === 400 && /already exists/i.test(cuerpo)) return false;
    throw new Error(mensajeDeGoogle(res.status, cuerpo, cuentaDeServicio(), "escribir"));
  }

  if (encabezados.length > 0) {
    const rango = `${titulo}!A1:${letraDeColumna(encabezados.length - 1)}1`;
    const esc = await pedir(
      `https://sheets.googleapis.com/v4/spreadsheets/${planillaId}` +
        `/values/${encodeURIComponent(rango)}?valueInputOption=USER_ENTERED`,
      {
        method: "PUT",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ values: [encabezados] }),
      }
    );
    if (!esc.ok) {
      throw new Error(mensajeDeGoogle(esc.status, await esc.text(), cuentaDeServicio()));
    }
  }

  return true;
}
