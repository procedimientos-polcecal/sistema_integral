/**
 * Leer una planilla de Google, sea cual sea.
 *
 * `lib/compras/sheets.ts` tiene su propio lector, atado a la planilla de
 * PEDIDOS DE COMPRA y con todo el manejo de celdas protegidas que esa
 * sincronización necesita. Esto es lo mínimo para cualquier otra: se le pasa
 * qué planilla y qué pestaña.
 */

import { obtenerToken, SCOPE_SHEETS_LECTURA } from "@/lib/core/google";

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
