/**
 * Exportación al libro SEGUIMIENTO DE COMPRA.
 *
 * Es de **una sola dirección**: el SdG manda y la planilla queda como el lugar
 * donde miran los que no entran al sistema, igual que en Producción. El SdG no
 * la vuelve a leer nunca, salvo la importación del histórico, que corre una vez.
 *
 * Escribe SÓLO la pestaña `COMPRAS CON RI`. Las nueve pestañas por área son
 * `=FILTER('COMPRAS CON RI'!A2:M3151; C2:C3151="<Área>")` y se recalculan
 * solas; además sus columnas A:M están protegidas contra esta cuenta.
 *
 * ── LAS DOS REGLAS QUE NO SE DEDUCEN ──────────────────────
 *
 * 1. NUNCA `values.append`. Debajo de la última fila real (la 1.759) hay 362
 *    filas con `#N/A` hasta la 2.121, y `append` no escribe después de los
 *    datos: escribe después de **todo**. Mandaría la fila a la 2.122. Es el
 *    mismo bug que llevó dos presupuestos del RI 1865 a las filas 1003 y 1004
 *    de una comparativa, con la app diciendo que los había escrito. La fila
 *    libre se busca por la **columna A**.
 *
 * 2. NUNCA insertar en el medio ni ordenar. Las columnas `Se aplicó?` y
 *    `Fecha de Aplicación` de cada pestaña por área viven al lado del `FILTER`
 *    y son posicionales: correr una fila del master hace que cada una pase a
 *    describir el RI de al lado, sin que nada avise.
 */

import { createAdminClient } from "@/lib/supabase/admin";
import { leerValores, escribirCeldas } from "@/lib/core/sheets";
import { filaDeSeguimiento, type DatosDeSeguimiento } from "@/lib/compras/seguimiento";
import type { Cumplio } from "@/lib/compras/types";

const HOJA = "COMPRAS CON RI";

const idPlanilla = () => process.env.GOOGLE_SHEETS_SEGUIMIENTO_ID ?? "";

/** Si la exportación está configurada. Sin la variable no es un error: se omite. */
export const haySeguimiento = () => Boolean(idPlanilla());

/**
 * La primera fila libre del master, mirando la columna A.
 *
 * Por la columna A y no por `getLastRow`: lo que hay debajo son restos de
 * fórmula con `#N/A` en C..H y la A vacía, así que la A es la única que dice
 * de verdad si una fila tiene datos.
 */
async function primeraFilaLibre(): Promise<number> {
  const filas = await leerValores(idPlanilla(), `${HOJA}!A:A`);
  let ultima = 1; // la 1 es el encabezado
  for (let i = 0; i < filas.length; i++) {
    if (String(filas[i]?.[0] ?? "").trim() !== "") ultima = i + 1;
  }
  return ultima + 1;
}

/**
 * Escribe (o reescribe) la fila de este RI.
 *
 * Devuelve el motivo si no se pudo, o null si salió bien. El motivo se guarda
 * con **lo que dijo Google, sin traducir**: un diagnóstico que no se distingue
 * de otro no es un diagnóstico.
 */
export async function exportarSeguimiento(requerimientoId: string): Promise<string | null> {
  if (!haySeguimiento()) return null;

  const admin = createAdminClient();
  const { data: r } = await admin
    .from("compras_requerimientos")
    // `!empresa_id`: `compras_odoo_ordenes` abre un segundo camino hasta `empresas` (PGRST201).
    .select("*, compras_areas(nombre), empresas!empresa_id(nombre), proveedores!proveedor_id(nombre)")
    .eq("id", requerimientoId)
    .single();

  if (!r) return null;

  const datos: DatosDeSeguimiento = {
    nro_ri: r.nro_ri as number,
    codigo: r.codigo as string | null,
    area: (r.compras_areas as { nombre: string } | null)?.nombre ?? null,
    descripcion: r.descripcion as string | null,
    proveedor: (r.proveedores as { nombre: string } | null)?.nombre ?? null,
    empresa: (r.empresas as { nombre: string } | null)?.nombre ?? null,
    paga_ambas: r.paga_ambas === true,
    cantidad: r.cantidad as number | null,
    cantidad_comprada: r.cantidad_comprada as number | null,
    cantidad_recibida: r.cantidad_recibida as number | null,
    fecha_estimada_recepcion: r.fecha_estimada_recepcion as string | null,
    fecha_recepcion: r.fecha_recepcion as string | null,
    cumplio_compras: r.cumplio_compras as Cumplio | null,
    cumplio_proveedor: r.cumplio_proveedor as Cumplio | null,
  };

  let fila = r.seguimiento_fila as number | null;
  const esNueva = !fila;

  try {
    if (!fila) fila = await primeraFilaLibre();

    // Las celdas se arman salteando las `null`: hoy es sólo MAIL_ENVIADO, y
    // saltearla es lo que evita que el área reciba el aviso dos veces.
    const celdas = filaDeSeguimiento(datos)
      .map((valor, columna) => ({ pestana: HOJA, columna, fila: fila as number, valor }))
      .filter((c): c is { pestana: string; columna: number; fila: number; valor: string } =>
        c.valor !== null
      );

    await escribirCeldas(idPlanilla(), celdas);

    const cambios: Record<string, unknown> = { seguimiento_pendiente: null };
    if (esNueva) cambios.seguimiento_fila = fila;
    await admin.from("compras_requerimientos").update(cambios).eq("id", requerimientoId);

    return null;
  } catch (e) {
    const motivo = e instanceof Error ? e.message : String(e);
    console.error(`No se pudo escribir el RI ${r.nro_ri} en SEGUIMIENTO DE COMPRA: ${motivo}`);
    await admin
      .from("compras_requerimientos")
      .update({ seguimiento_pendiente: motivo })
      .eq("id", requerimientoId);
    return motivo;
  }
}

/**
 * Reintenta lo que había quedado sin escribir.
 *
 * Cinco por corrida, como el otro libro: la cuota de Sheets se cuenta por
 * minuto y un 429 anotado como rechazo hace pensar que la planilla no quiso.
 */
export async function reintentarSeguimiento(): Promise<{ intentados: number; resueltos: number }> {
  if (!haySeguimiento()) return { intentados: 0, resueltos: 0 };

  const admin = createAdminClient();
  const { data } = await admin
    .from("compras_requerimientos")
    .select("id")
    .not("seguimiento_pendiente", "is", null)
    .limit(5);

  let resueltos = 0;
  for (const { id } of data ?? []) {
    if ((await exportarSeguimiento(id as string)) === null) resueltos++;
  }
  return { intentados: (data ?? []).length, resueltos };
}
