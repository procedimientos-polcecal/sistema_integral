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

  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`Sheets API ${res.status}: ${await res.text()}`);

  return ((await res.json()).values ?? []) as string[][];
}

/** Los nombres de las pestañas de una planilla. */
export async function listarPestanas(planillaId: string): Promise<string[]> {
  const token = await obtenerToken([SCOPE_SHEETS_LECTURA]);

  const url =
    `https://sheets.googleapis.com/v4/spreadsheets/${planillaId}` +
    `?fields=sheets.properties.title`;

  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`Sheets API ${res.status}: ${await res.text()}`);

  const json = await res.json();
  return (json.sheets ?? []).map((s: { properties: { title: string } }) => s.properties.title);
}

/**
 * La letra de una columna: 0 → A, 25 → Z, 26 → AA.
 *
 * Las planillas de mantenimiento pasan de veintiséis columnas, así que no
 * alcanza con sumarle el índice a la "A".
 */
export function letraDeColumna(indice: number): string {
  let s = "";
  for (let i = indice + 1; i > 0; i = Math.floor((i - 1) / 26)) {
    s = String.fromCharCode(65 + ((i - 1) % 26)) + s;
  }
  return s;
}

/**
 * Escribe celdas sueltas de una planilla, todas de una.
 *
 * Una llamada por celda gastaría una cuota que no hace falta gastar, y dejaría
 * la planilla a medio escribir si falla la tercera de cinco.
 */
export async function escribirCeldas(
  planillaId: string,
  celdas: { pestana: string; columna: number; fila: number; valor: string }[]
): Promise<void> {
  if (celdas.length === 0) return;

  const token = await obtenerToken([SCOPE_SHEETS]);
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${planillaId}/values:batchUpdate`;

  const res = await fetch(url, {
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
export async function agregarFila(
  planillaId: string,
  pestana: string,
  valores: (string | number)[]
): Promise<number> {
  const token = await obtenerToken([SCOPE_SHEETS]);
  const url =
    `https://sheets.googleapis.com/v4/spreadsheets/${planillaId}` +
    `/values/${encodeURIComponent(pestana)}:append` +
    `?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`;

  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ values: [valores] }),
  });
  if (!res.ok) {
    throw new Error(mensajeDeGoogle(res.status, await res.text(), cuentaDeServicio()));
  }

  // updatedRange viene como "SERVICIOS!A7:T7".
  const rango: string = (await res.json()).updates?.updatedRange ?? "";
  const fila = rango.match(/!(?:[A-Z]+)(\d+)/);
  if (!fila) throw new Error(`No se pudo leer la fila escrita: ${rango}`);
  return Number(fila[1]);
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

  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`Sheets API ${res.status}: ${await res.text()}`);

  return ((await res.json()).values ?? []) as string[][];
}
