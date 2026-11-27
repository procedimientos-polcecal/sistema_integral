/**
 * Las planillas de comparativa que viven en una carpeta de Drive.
 *
 * Cada archivo es la comparativa de un artículo, con la forma de
 * "00. COMPARATIVA DE PROVEEDORES GENERICO". El vínculo con el requerimiento no
 * es el nombre del archivo —son genéricos y a veces no corresponden a lo que
 * pidió el RI— sino la columna A de cada fila.
 *
 * La cuenta de servicio necesita permiso de EDITOR sobre la carpeta: la app no
 * sólo lee, también agrega filas y marca la elección.
 */

import {
  obtenerToken, hayCredencialesGoogle, mensajeDeGoogle, cuentaDeServicio,
  SCOPE_SHEETS, SCOPE_DRIVE_LECTURA,
} from "@/lib/core/google";
import { letraDeColumna } from "@/lib/core/columnaDeSheets";
// La regla de en qué fila escribir vive en el núcleo: la usan las cuatro
// planillas y tenerla dos veces es cómo se corrige en una sola.
import {
  filaSiguienteSegunLaColumna, estaCalculando, errorDeCalculo,
  asegurarColumnas, textoParaLaCelda,
} from "@/lib/core/sheets";
import { anchoUsado, indiceDeLaColumnaDelId } from "@/lib/compras/comparativa";
import { rangoDelBloque } from "@/lib/compras/bloqueDeFilas";
export { filaSiguienteSegunLaColumna };
export { urlDePlanilla } from "@/lib/compras/vincular";

export interface ArchivoComparativa {
  id: string;
  nombre: string;
  modificado: string;
  /** Las planillas nativas se leen con la API; un .xlsx subido, no. */
  esPlanillaGoogle: boolean;
}

const MIME_PLANILLA = "application/vnd.google-apps.spreadsheet";

export function carpetaConfigurada(): boolean {
  return hayCredencialesGoogle() && Boolean(process.env.GOOGLE_DRIVE_COMPARATIVAS_FOLDER_ID);
}

const idCarpeta = () => {
  const id = process.env.GOOGLE_DRIVE_COMPARATIVAS_FOLDER_ID ?? "";
  if (!id) throw new Error("GOOGLE_DRIVE_COMPARATIVAS_FOLDER_ID no configurado");
  return id;
};

/**
 * El tope que se le pide a Drive por página. No es el total: ver abajo.
 *
 * Drive devuelve como máximo 1000 por página y además puede devolver menos de
 * lo pedido aunque haya más, así que la señal de que terminó es que no venga
 * `nextPageToken`, nunca que la página haya vuelto corta.
 */
const POR_PAGINA = 200;

/**
 * Un freno para no quedarse dando vueltas si Drive repite el token.
 *
 * 20 páginas son 4.000 archivos: veinte veces la carpeta de hoy. Si alguna vez
 * se llega acá, el síntoma es una lista incompleta y no una ruta colgada.
 */
const PAGINAS_MAXIMAS = 20;

/**
 * Los archivos de la carpeta, los más recientes primero.
 *
 * **Se pagina con `nextPageToken`, y eso no es una precaución para el futuro:**
 * el 26/11/2026 la carpeta tenía **200 planillas** y se pedían 200, o sea
 * exactamente el tope. La planilla 201 empuja a otra afuera del desplegable y
 * **el único síntoma es que no aparece**: quien la busca elige «Sin elegir», el
 * presupuesto se guarda sin respaldo, y el aviso que sale después dice «no tiene
 * comparativa vinculada», que manda a mirar el pedido cuando el problema estaba
 * en la lista.
 */
export async function listarComparativas(): Promise<ArchivoComparativa[]> {
  const token = await obtenerToken([SCOPE_DRIVE_LECTURA]);
  const archivos: ArchivoComparativa[] = [];
  let pagina: string | undefined;

  for (let i = 0; i < PAGINAS_MAXIMAS; i++) {
    const parametros = new URLSearchParams({
      q: `'${idCarpeta()}' in parents and trashed = false`,
      // `nextPageToken` tiene que estar en `fields` o Google no lo manda, y la
      // paginación se corta sola en la primera página sin decir nada.
      fields: "nextPageToken, files(id, name, modifiedTime, mimeType)",
      orderBy: "modifiedTime desc",
      pageSize: String(POR_PAGINA),
    });
    if (pagina) parametros.set("pageToken", pagina);

    const res = await fetch(`https://www.googleapis.com/drive/v3/files?${parametros}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error(mensajeDeGoogle(res.status, await res.text(), cuentaDeServicio()));

    const json = await res.json();
    for (const f of (json.files ?? []) as {
      id: string; name: string; modifiedTime: string; mimeType: string;
    }[]) {
      archivos.push({
        id: f.id,
        nombre: f.name,
        modificado: f.modifiedTime,
        esPlanillaGoogle: f.mimeType === MIME_PLANILLA,
      });
    }

    pagina = json.nextPageToken || undefined;
    if (!pagina) break;
  }

  return archivos;
}

/**
 * Cómo se llama el archivo y su primera pestaña.
 *
 * El nombre sale de acá y no de la API de Drive, así funciona aunque Drive no
 * esté habilitado en el proyecto de Google.
 */
async function cabecera(token: string, fileId: string): Promise<{ nombre: string; pestana: string }> {
  const url =
    `https://sheets.googleapis.com/v4/spreadsheets/${fileId}` +
    `?fields=properties.title,sheets.properties.title`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(mensajeDeGoogle(res.status, await res.text(), cuentaDeServicio()));

  const json = await res.json();
  const pestana = json.sheets?.[0]?.properties?.title;
  if (!pestana) throw new Error("La planilla no tiene pestañas");
  return { nombre: json.properties?.title ?? fileId, pestana };
}

export interface ComparativaLeida {
  /** Cómo se llama el archivo, para poder nombrarlo en la ficha. */
  nombre: string;
  pestana: string;
  encabezado: string[];
  filas: string[][];
}

/** Lee una comparativa completa: encabezado y filas. */
export async function leerComparativa(fileId: string): Promise<ComparativaLeida> {
  const token = await obtenerToken([SCOPE_SHEETS]);
  const { nombre, pestana } = await cabecera(token, fileId);

  const url =
    `https://sheets.googleapis.com/v4/spreadsheets/${fileId}` +
    `/values/${encodeURIComponent(pestana)}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(mensajeDeGoogle(res.status, await res.text(), cuentaDeServicio()));

  const valores = ((await res.json()).values ?? []) as string[][];
  if (estaCalculando(valores)) throw errorDeCalculo(pestana);
  return { nombre, pestana, encabezado: valores[0] ?? [], filas: valores.slice(1) };
}

/**
 * La primera fila libre según la columna A.
 *
 * Se mira la columna A y no la hoja entera porque es la que dice si una fila
 * tiene datos: en las comparativas el formato, las fórmulas y los desplegables
 * llegan mucho más abajo que los presupuestos cargados.
 *
 * **Y por eso mismo corta si la planilla está calculando.** Ésta es la función
 * con la forma exacta del accidente del 13/10/2026: una lectura de la columna A
 * que devolvió dos filas de 623 porque las fórmulas se estaban recalculando, y
 * una cuenta de "la primera libre" impecable sobre datos que no eran datos. Acá
 * el resultado sería escribir el presupuesto de un proveedor encima del de
 * otro, en una comparativa que después alguien usa para elegir a quién comprar.
 */
async function proximaFilaLibre(token: string, fileId: string, pestana: string): Promise<number> {
  const url =
    `https://sheets.googleapis.com/v4/spreadsheets/${fileId}` +
    `/values/${encodeURIComponent(pestana + "!A:A")}`;

  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(mensajeDeGoogle(res.status, await res.text(), cuentaDeServicio()));

  const columnaA = ((await res.json()).values ?? []) as string[][];
  if (estaCalculando(columnaA)) throw errorDeCalculo(pestana);
  return filaSiguienteSegunLaColumna(columnaA);
}

/**
 * Agrega una fila al final y devuelve qué número de fila quedó.
 *
 * Antes usaba `append` de Google, que en una sola llamada resuelve dónde
 * escribir. El problema es cómo lo resuelve: busca el final de "la tabla" y
 * salta después de cualquier contenido de la hoja, incluido el formato y las
 * fórmulas que no son datos. En la comparativa "ESPIRA SINFIN" eso mandó dos
 * presupuestos a las filas 1003 y 1004, mil filas más abajo de donde se los
 * podía ver: la app decía que los había escrito y en la planilla no aparecían.
 *
 * Ahora la fila se busca por la columna A, que es la que dice si una fila tiene
 * datos, y se escribe en un rango explícito.
 *
 * Lo que se pierde es la atomicidad: entre averiguar la fila y escribirla,
 * alguien podría agregar una a mano y quedaría pisada. Es un riesgo real pero
 * chico —son segundos, y las comparativas las edita una persona por vez— y a
 * cambio el presupuesto queda donde se lo puede leer, que es el punto de
 * escribirlo.
 */
export async function agregarFila(
  fileId: string,
  pestana: string,
  // Recibe la fila para poder armar las fórmulas con el número correcto.
  //
  // Antes tomaba los valores ya hechos y el llamador calculaba la fila por su
  // cuenta con `filas.length + 2`. Las dos cuentas no coincidían: la fórmula
  // del total del RI 1865 quedó apuntando a la fila 1001 mientras el
  // presupuesto se escribía en la 1003. Pasando la función, es imposible que
  // difieran.
  armarValores: (fila: number) => string[]
): Promise<number> {
  const token = await obtenerToken([SCOPE_SHEETS]);
  const fila = await proximaFilaLibre(token, fileId, pestana);
  const valores = armarValores(fila);

  // El rango tiene que abarcar todas las columnas que se mandan: si se da uno
  // más chico, Google rechaza la escritura entera.
  const rango = `${pestana}!A${fila}:${letraDeColumna(valores.length - 1)}${fila}`;
  const url =
    `https://sheets.googleapis.com/v4/spreadsheets/${fileId}` +
    `/values/${encodeURIComponent(rango)}?valueInputOption=USER_ENTERED`;

  const res = await fetch(url, {
    method: "PUT",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ values: [valores] }),
  });
  if (!res.ok) throw new Error(mensajeDeGoogle(res.status, await res.text(), cuentaDeServicio()));

  return fila;
}

/**
 * Agrega un bloque de filas de una sola vez y devuelve la primera que escribió.
 *
 * Existe por la cuota: la de lecturas de Google es de 60 por minuto y la
 * comparten todos los módulos. Siete renglones con `agregarFila()` son siete
 * lecturas de la columna A y siete escrituras, y eso fue lo que se agotó el
 * 26/11/2026 y dejó un requerimiento exportado a medias. Acá es una lectura y
 * una escritura sin importar cuántas filas sean.
 *
 * **Eso es lo que cuesta esta función, no lo que cuesta el respaldo entero.**
 * Escribir el respaldo en una planilla son **3 o 4 lecturas y de 1 a 3
 * escrituras**: `leerComparativa` gasta dos lecturas (la cabecera y los
 * valores), `asegurarLaColumnaDelId` una más y hasta dos escrituras la primera
 * vez, y de acá sale la lectura de la columna A y la escritura del bloque. El
 * número sirve para razonar contra la cuota de 60 por minuto, así que conviene
 * que sea el de verdad; lo que no cambia es que **nada de eso es por renglón**.
 *
 * Conserva las dos reglas de `agregarFila()`: la fila se busca por la columna A
 * con `proximaFilaLibre` —que corta si la planilla está calculando, así que no
 * se escribe sobre una lectura que no eran datos— y se escribe en un rango
 * explícito, nunca con `append`.
 *
 * **La cantidad de filas sale de lo que devuelve `armarValores` y de ningún
 * otro lado.** Con un `cantidad` aparte habría dos fuentes para el mismo número,
 * que es cómo la fórmula del RI 1865 apuntó a la fila 1001 mientras el
 * presupuesto iba a la 1003.
 */
export async function agregarFilas(
  fileId: string,
  pestana: string,
  armarValores: (filaInicial: number) => string[][]
): Promise<number> {
  const token = await obtenerToken([SCOPE_SHEETS]);
  const filaInicial = await proximaFilaLibre(token, fileId, pestana);
  const valores = armarValores(filaInicial);

  const rango = rangoDelBloque(pestana, filaInicial, valores);
  const url =
    `https://sheets.googleapis.com/v4/spreadsheets/${fileId}` +
    `/values/${encodeURIComponent(rango)}?valueInputOption=USER_ENTERED`;

  const res = await fetch(url, {
    method: "PUT",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ values: valores }),
  });
  if (!res.ok) throw new Error(mensajeDeGoogle(res.status, await res.text(), cuentaDeServicio()));

  return filaInicial;
}

/** Escribe un valor en una celda de una planilla de la carpeta. */
export async function escribirCelda(
  fileId: string,
  pestana: string,
  columna: number,
  numeroFila: number,
  valor: string
): Promise<void> {
  const token = await obtenerToken([SCOPE_SHEETS]);
  const rango = `${pestana}!${letraDeColumna(columna)}${numeroFila}`;
  const url =
    `https://sheets.googleapis.com/v4/spreadsheets/${fileId}` +
    `/values/${encodeURIComponent(rango)}?valueInputOption=USER_ENTERED`;

  const res = await fetch(url, {
    method: "PUT",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ values: [[valor]] }),
  });
  if (!res.ok) throw new Error(mensajeDeGoogle(res.status, await res.text(), cuentaDeServicio()));
}

/**
 * Devuelve el índice (0-based) de la columna `ID SISTEMA`, creándola si falta.
 *
 * Va **a continuación de lo último que se usa** y no en una letra fija: las
 * comparativas miden 16, 19 y 20 columnas, y una ya usa la T para EQUIPO.
 * Antes de escribir el encabezado se asegura que la pestaña tenga esa columna,
 * porque escribir fuera de su ancho real hace que Google rechace el pedido
 * entero con `exceeds grid limits` —el incidente de la `K` de carbonilla del
 * 14/10/2026—.
 *
 * Devuelve el número en vez de dejar que quien llama vuelva a mapear: la
 * columna pudo haberse creado en esta misma llamada, después de que se leyó el
 * encabezado.
 */
export async function asegurarLaColumnaDelId(
  fileId: string,
  pestana: string,
  encabezado: string[],
  filas: string[][]
): Promise<number> {
  const existente = indiceDeLaColumnaDelId(encabezado);
  if (existente >= 0) return existente;

  const indice = anchoUsado(encabezado, filas); // 0-based de la primera libre
  await asegurarColumnas(fileId, pestana, indice + 1);
  await escribirCelda(fileId, pestana, indice, 1, textoParaLaCelda("ID SISTEMA"));
  return indice;
}

/**
 * Vacía una fila, sin eliminarla.
 *
 * Eliminar la fila correría todas las de abajo y dejaría mal el `drive_fila` de
 * los demás presupuestos, que es justo lo que ese número existe para evitar.
 */
export async function vaciarFila(
  fileId: string,
  pestana: string,
  numeroFila: number,
  anchoColumnas: number
): Promise<void> {
  const token = await obtenerToken([SCOPE_SHEETS]);
  const rango =
    `${pestana}!A${numeroFila}:${letraDeColumna(anchoColumnas - 1)}${numeroFila}`;
  const url =
    `https://sheets.googleapis.com/v4/spreadsheets/${fileId}` +
    `/values/${encodeURIComponent(rango)}:clear`;

  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(mensajeDeGoogle(res.status, await res.text(), cuentaDeServicio()));
}

