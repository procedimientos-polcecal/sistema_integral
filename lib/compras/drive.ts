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
import { letraColumna } from "@/lib/compras/comparativa";
// La regla de en qué fila escribir vive en el núcleo: la usan las cuatro
// planillas y tenerla dos veces es cómo se corrige en una sola.
import { filaSiguienteSegunColumnaA } from "@/lib/core/sheets";
export { filaSiguienteSegunColumnaA };
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

/** Los archivos de la carpeta, los más recientes primero. */
export async function listarComparativas(): Promise<ArchivoComparativa[]> {
  const token = await obtenerToken([SCOPE_DRIVE_LECTURA]);
  const parametros = new URLSearchParams({
    q: `'${idCarpeta()}' in parents and trashed = false`,
    fields: "files(id, name, modifiedTime, mimeType)",
    orderBy: "modifiedTime desc",
    pageSize: "200",
  });

  const res = await fetch(`https://www.googleapis.com/drive/v3/files?${parametros}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(mensajeDeGoogle(res.status, await res.text(), cuentaDeServicio()));

  const json = await res.json();
  return (json.files ?? []).map(
    (f: { id: string; name: string; modifiedTime: string; mimeType: string }) => ({
      id: f.id,
      nombre: f.name,
      modificado: f.modifiedTime,
      esPlanillaGoogle: f.mimeType === MIME_PLANILLA,
    })
  );
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
  return { nombre, pestana, encabezado: valores[0] ?? [], filas: valores.slice(1) };
}

/**
 * La primera fila libre según la columna A.
 *
 * Se mira la columna A y no la hoja entera porque es la que dice si una fila
 * tiene datos: en las comparativas el formato, las fórmulas y los desplegables
 * llegan mucho más abajo que los presupuestos cargados.
 */
async function proximaFilaLibre(token: string, fileId: string, pestana: string): Promise<number> {
  const url =
    `https://sheets.googleapis.com/v4/spreadsheets/${fileId}` +
    `/values/${encodeURIComponent(pestana + "!A:A")}`;

  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(mensajeDeGoogle(res.status, await res.text(), cuentaDeServicio()));

  const columnaA = ((await res.json()).values ?? []) as string[][];
  return filaSiguienteSegunColumnaA(columnaA);
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
  const rango = `${pestana}!A${fila}:${letraColumna(valores.length - 1)}${fila}`;
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

/** Escribe un valor en una celda de una planilla de la carpeta. */
export async function escribirCelda(
  fileId: string,
  pestana: string,
  columna: number,
  numeroFila: number,
  valor: string
): Promise<void> {
  const token = await obtenerToken([SCOPE_SHEETS]);
  const rango = `${pestana}!${letraColumna(columna)}${numeroFila}`;
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
    `${pestana}!A${numeroFila}:${letraColumna(anchoColumnas - 1)}${numeroFila}`;
  const url =
    `https://sheets.googleapis.com/v4/spreadsheets/${fileId}` +
    `/values/${encodeURIComponent(rango)}:clear`;

  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(mensajeDeGoogle(res.status, await res.text(), cuentaDeServicio()));
}

