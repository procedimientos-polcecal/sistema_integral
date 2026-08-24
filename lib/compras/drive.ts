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
} from "@/lib/compras/google";
import { letraColumna } from "@/lib/compras/comparativa";

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

/** Nombre de la primera pestaña de una planilla. */
async function primeraPestana(token: string, fileId: string): Promise<string> {
  const url =
    `https://sheets.googleapis.com/v4/spreadsheets/${fileId}` +
    `?fields=sheets.properties.title`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(mensajeDeGoogle(res.status, await res.text(), cuentaDeServicio()));

  const json = await res.json();
  const titulo = json.sheets?.[0]?.properties?.title;
  if (!titulo) throw new Error("La planilla no tiene pestañas");
  return titulo;
}

export interface ComparativaLeida {
  pestana: string;
  encabezado: string[];
  filas: string[][];
}

/** Lee una comparativa completa: encabezado y filas. */
export async function leerComparativa(fileId: string): Promise<ComparativaLeida> {
  const token = await obtenerToken([SCOPE_SHEETS]);
  const pestana = await primeraPestana(token, fileId);

  const url =
    `https://sheets.googleapis.com/v4/spreadsheets/${fileId}` +
    `/values/${encodeURIComponent(pestana)}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(mensajeDeGoogle(res.status, await res.text(), cuentaDeServicio()));

  const valores = ((await res.json()).values ?? []) as string[][];
  return { pestana, encabezado: valores[0] ?? [], filas: valores.slice(1) };
}

/**
 * Agrega una fila al final y devuelve qué número de fila quedó.
 *
 * Se usa `append`, que resuelve en una sola llamada dónde va: buscar la primera
 * fila vacía a mano es una carrera con cualquiera que esté editando la planilla
 * en ese momento.
 */
export async function agregarFila(
  fileId: string,
  pestana: string,
  valores: string[]
): Promise<number> {
  const token = await obtenerToken([SCOPE_SHEETS]);
  const url =
    `https://sheets.googleapis.com/v4/spreadsheets/${fileId}` +
    `/values/${encodeURIComponent(pestana)}:append` +
    `?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`;

  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ values: [valores] }),
  });
  if (!res.ok) throw new Error(mensajeDeGoogle(res.status, await res.text(), cuentaDeServicio()));

  // updatedRange viene como "Hoja 1!A7:S7".
  const rango: string = (await res.json()).updates?.updatedRange ?? "";
  const fila = rango.match(/!([A-Z]+)(\d+)/);
  if (!fila) throw new Error(`No se pudo leer la fila escrita: ${rango}`);
  return Number(fila[2]);
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

/** El link para abrir la planilla. */
export const urlDePlanilla = (fileId: string) =>
  `https://docs.google.com/spreadsheets/d/${fileId}`;
