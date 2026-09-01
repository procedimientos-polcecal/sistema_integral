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
/**
 * En qué fila escribir, según la columna A.
 *
 * Va aparte de la llamada a Google para poder probarla. Se mira la columna A y
 * no la hoja entera porque es la que dice si una fila tiene datos: el formato,
 * las fórmulas y los desplegables llegan mucho más abajo que lo cargado.
 *
 * Una fila vacía en el medio no corta la cuenta: se busca la última con algo,
 * no la primera sin nada.
 */
export function filaSiguienteSegunColumnaA(columnaA: string[][]): number {
  for (let i = columnaA.length - 1; i >= 0; i--) {
    if (String(columnaA[i]?.[0] ?? "").trim()) return i + 2;
  }
  // Ni encabezado: se empieza en la 2 y la 1 queda para los títulos.
  return 2;
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
  valores: (string | number)[]
): Promise<number> {
  const token = await obtenerToken([SCOPE_SHEETS]);

  const lectura = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${planillaId}` +
      `/values/${encodeURIComponent(pestana + "!A:A")}`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!lectura.ok) {
    throw new Error(mensajeDeGoogle(lectura.status, await lectura.text(), cuentaDeServicio()));
  }
  const fila = filaSiguienteSegunColumnaA(((await lectura.json()).values ?? []) as string[][]);

  // El rango tiene que abarcar todas las columnas que se mandan: si se da uno
  // más chico, Google rechaza la escritura entera.
  const rango = `${pestana}!A${fila}:${letraDeColumna(valores.length - 1)}${fila}`;
  const res = await fetch(
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
