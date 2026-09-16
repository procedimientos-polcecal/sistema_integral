/**
 * Exportación al libro SEGUIMIENTO DE COMPRA.
 *
 * Es de **una sola dirección**: el SdG manda y la planilla queda como el lugar
 * donde miran los que no entran al sistema, igual que en Producción. El SdG no
 * la vuelve a leer nunca, salvo la importación del histórico, que corre una vez.
 *
 * Escribe la pestaña `COMPRAS CON RI` y, si hay algo que decir, también las
 * nueve pestañas por área. Sus columnas A:M son `=FILTER('COMPRAS CON RI'!
 * A2:M3151; C2:C3151="<Área>")`, se recalculan solas y están protegidas contra
 * esta cuenta; de la N en adelante hay columnas propias del área, cargadas a
 * mano, y ahí es donde este archivo escribe `Se aplicó?` y `Fecha de
 * Aplicación` — decidido por `celdasDeAplicacion`, que ya sabe ubicarlas por
 * nombre y saltear las que son fórmula.
 *
 * ── LAS DOS REGLAS QUE NO SE DEDUCEN (del master) ──────────
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
import { leerValores, escribirCeldas, leerFormulasDeRango, listarPestanas } from "@/lib/core/sheets";
import {
  entraEnElSeguimiento, filaDeSeguimiento, celdasDeAplicacion,
  type DatosDeSeguimiento,
} from "@/lib/compras/seguimiento";
import type { Cumplio } from "@/lib/compras/types";

const HOJA = "COMPRAS CON RI";

/**
 * Dónde, dentro de las columnas propias del área (N en adelante), puede vivir
 * `Se aplicó?` o `Fecha de Aplicación`. Mantenimiento tiene tres columnas más
 * que el resto **antes** de esas dos (`Estimada Aplicación`, `ANALISIS`,
 * `Equipo` van en el medio), así que U alcanza de sobra en las nueve.
 */
const RANGO_COLUMNAS_DE_AREA = "N:U";
/** N es la columna índice 13 contando A = 0, que es como indexa `celdasDeAplicacion`. */
const OFFSET_COLUMNAS_DE_AREA = 13;

const idPlanilla = () => process.env.GOOGLE_SHEETS_SEGUIMIENTO_ID ?? "";

/** Si la exportación está configurada. Sin la variable no es un error: se omite. */
export const haySeguimiento = () => Boolean(idPlanilla());

/**
 * Dónde va la fila de este RI, y si hay que estrenarla.
 *
 * Busca **por el número de RI en la columna A** antes de tomar una fila libre,
 * que es lo mismo que hace `filaEnMaster` para el otro libro. Tomar siempre la
 * primera libre traía dos males que no avisan: si el `update` que guarda
 * `seguimiento_fila` falló después de una escritura buena, el intento
 * siguiente escribía una SEGUNDA fila para el mismo RI; y dos RI exportados a
 * la vez calculaban la misma fila y el segundo pisaba al primero.
 *
 * Por la columna A y no por `getLastRow`: debajo de la última fila real hay
 * 362 filas con `#N/A` cuya columna A está vacía, así que la A es la única que
 * dice de verdad si una fila tiene datos.
 */
async function ubicarFila(
  nroRi: number,
  cache?: CacheDeSeguimiento
): Promise<{ fila: number; esNueva: boolean }> {
  const columnaA = cache?.columnaA ?? (await leerValores(idPlanilla(), `${HOJA}!A:A`));
  if (cache) cache.columnaA = columnaA;

  let ultima = 1; // la 1 es el encabezado
  for (let i = 1; i < columnaA.length; i++) {
    const celda = String(columnaA[i]?.[0] ?? "").trim();
    if (celda === "") continue;
    if (Number(celda) === nroRi) return { fila: i + 1, esNueva: false };
    ultima = i + 1;
  }

  // La primera libre. En una corrida con varios pendientes nuevos se avanza en
  // memoria: releer la columna entera por cada uno gasta cuota y ensancha la
  // ventana en que dos se pisan.
  const fila = Math.max(ultima, cache?.ultimaTomada ?? 0) + 1;
  if (cache) cache.ultimaTomada = fila;
  return { fila, esNueva: true };
}

/** Lo que se leyó de una pestaña por área, para no releerlo por cada RI. */
interface InfoPestana {
  encabezado: string[];
  columnaA: string[][];
  /** `formulas[fila - 1]` son las columnas de `RANGO_COLUMNAS_DE_AREA` en esa fila. */
  formulas: boolean[][];
}

/** Lo que no cambia durante una corrida de escrituras. */
export interface CacheDeSeguimiento {
  columnaA?: string[][];
  ultimaTomada?: number;
  /** Los títulos de pestaña del libro, para saber si la del área existe sin adivinar por el texto de un error. */
  pestanasExistentes?: string[];
  /** Una entrada por pestaña de área ya leída en esta corrida. */
  pestanas?: Map<string, InfoPestana>;
}

/**
 * La fila de ESTE RI en la pestaña del área. `null` si todavía no aparece.
 *
 * No es lo mismo que `ubicarFila` del master: acá no hay fila para "estrenar"
 * —la pestaña es un `FILTER` que numera sola— así que si el RI no está, no hay
 * nada para calcular: se espera a que la fórmula lo traiga.
 */
function ubicarFilaEnPestana(nroRi: number, columnaA: string[][]): number | null {
  for (let i = 1; i < columnaA.length; i++) { // la 0 es el encabezado
    const celda = String(columnaA[i]?.[0] ?? "").trim();
    if (celda !== "" && Number(celda) === nroRi) return i + 1;
  }
  return null;
}

/** Lee (o devuelve de la caché) lo que hace falta saber de la pestaña de un área. */
async function datosDePestana(
  pestana: string,
  cache: CacheDeSeguimiento
): Promise<InfoPestana | null> {
  cache.pestanasExistentes ??= await listarPestanas(idPlanilla());
  if (!cache.pestanasExistentes.includes(pestana)) return null;

  cache.pestanas ??= new Map();
  const enCache = cache.pestanas.get(pestana);
  if (enCache) return enCache;

  const [encabezadoFilas, columnaA, formulas] = await Promise.all([
    leerValores(idPlanilla(), `${pestana}!1:1`),
    leerValores(idPlanilla(), `${pestana}!A:A`),
    leerFormulasDeRango(idPlanilla(), pestana, RANGO_COLUMNAS_DE_AREA),
  ]);

  const info: InfoPestana = { encabezado: encabezadoFilas[0] ?? [], columnaA, formulas };
  cache.pestanas.set(pestana, info);
  return info;
}

/**
 * Escribe, en la pestaña del área, si el material se aplicó y cuándo.
 *
 * Es aparte de `exportarSeguimiento` a propósito: ahí se escribe el master por
 * el número de RI en SU columna A, acá se busca la fila por el número de RI en
 * la columna A **de la pestaña**, que numera distinto porque es un `FILTER`.
 * Nunca lanza: lo que no se pudo escribir vuelve como texto, con el nombre de
 * la pestaña adelante, para sumarlo a la misma cola que el master.
 */
async function exportarAplicacionEnPestana(
  nroRi: number,
  area: string | null,
  datos: { seAplico: string | null; fechaAplicacion: string | null },
  cache: CacheDeSeguimiento
): Promise<string[]> {
  if (!area) return ["la aplicación no se pudo ubicar: el RI no tiene área"];

  const pestana = `COMPRAS ${area.toUpperCase()}`;

  try {
    const info = await datosDePestana(pestana, cache);
    if (!info) return [`${pestana}: la pestaña no existe`];

    const fila = ubicarFilaEnPestana(nroRi, info.columnaA);
    if (fila === null) {
      return [`${pestana}: el RI todavía no aparece (el FILTER puede tardar); se reintenta solo`];
    }

    const filaDeFormulas = info.formulas[fila - 1] ?? [];
    const conFormula = filaDeFormulas
      .map((esFormula, i) => (esFormula ? OFFSET_COLUMNAS_DE_AREA + i : -1))
      .filter((i) => i >= 0);

    const { aEscribir, salteadas } = celdasDeAplicacion(info.encabezado, conFormula, datos);

    if (aEscribir.length > 0) {
      await escribirCeldas(
        idPlanilla(),
        aEscribir.map((c) => ({ pestana, columna: c.columna, fila, valor: c.valor }))
      );
    }

    return salteadas.map((s) => `${pestana}: ${s}`);
  } catch (e) {
    const dijoGoogle = e instanceof Error ? e.message : String(e);
    const motivo = dijoGoogle.includes("429")
      ? `${pestana}: la planilla no dio lugar por cuota; se reintenta solo`
      : `${pestana}: ${dijoGoogle}`;
    console.error(`No se pudo escribir la aplicación del RI ${nroRi} en ${pestana}: ${dijoGoogle}`);
    return [motivo];
  }
}

/**
 * Escribe (o reescribe) la fila de este RI.
 *
 * Devuelve el motivo si no se pudo, o null si salió bien. El motivo se guarda
 * con **lo que dijo Google, sin traducir**: un diagnóstico que no se distingue
 * de otro no es un diagnóstico.
 */
export async function exportarSeguimiento(
  requerimientoId: string,
  cache?: CacheDeSeguimiento
): Promise<string | null> {
  if (!haySeguimiento()) return null;

  const admin = createAdminClient();
  const { data: r } = await admin
    .from("compras_requerimientos")
    // `!empresa_id`: `compras_odoo_ordenes` abre un segundo camino hasta `empresas` (PGRST201).
    .select("*, compras_areas(nombre), empresas!empresa_id(nombre), proveedores!proveedor_id(nombre)")
    .eq("id", requerimientoId)
    .single();

  if (!r) return null;

  // Un RI que todavía no se compró no va al libro de seguimiento, y sin esto
  // iba: esta función se llama desde el PATCH del requerimiento, por donde
  // pasan también aprobar, asignar y cargar un presupuesto.
  if (!entraEnElSeguimiento(r.estado_compra as string | null, r.seguimiento_fila != null)) {
    return null;
  }

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

  // Un solo objeto de caché para todo lo de esta corrida, sea o no la que pasó
  // el llamador: `exportarAplicacionEnPestana` necesita uno propio, y crear uno
  // nuevo por RI cuando no viene de `reintentarSeguimiento` perdería el sentido
  // de cachear (aunque acá sólo importa dentro de esta única llamada).
  const laCache = cache ?? {};

  try {
    const { fila, esNueva } = await ubicarFila(r.nro_ri as number, laCache);

    // Las celdas se arman salteando las `null`: hoy es sólo MAIL_ENVIADO, y
    // saltearla es lo que evita que el área reciba el aviso dos veces.
    const celdas = filaDeSeguimiento(datos)
      .map((valor, columna) => ({ pestana: HOJA, columna, fila, valor }))
      .filter((c): c is { pestana: string; columna: number; fila: number; valor: string } =>
        c.valor !== null
      );

    await escribirCeldas(idPlanilla(), celdas);

    // Una fila estrenada se comprueba: dos exportaciones simultáneas pueden
    // haber calculado la misma, y la segunda escritura no falla, pisa. Sin
    // esto el RI perdido no deja rastro en ningún lado.
    if (esNueva) {
      const [[quedo] = []] = await leerValores(idPlanilla(), `${HOJA}!A${fila}:A${fila}`);
      if (Number(String(quedo ?? "").trim()) !== r.nro_ri) {
        const motivo = `otra escritura tomó la fila ${fila}; se reubica en el próximo intento`;
        await admin
          .from("compras_requerimientos")
          .update({ seguimiento_pendiente: motivo })
          .eq("id", requerimientoId);
        return motivo;
      }
    }

    // La pestaña del área es otra escritura, sobre otro libro en la práctica
    // —distintas columnas, distinta fila—, así que se hace después de que el
    // master ya quedó bien. Sólo si hay algo que decir: sin esto, un RI sin
    // aplicación todavía gastaría una lectura de la pestaña por nada.
    const datosAplicacion = {
      seAplico: r.se_aplico as string | null,
      fechaAplicacion: r.fecha_aplicacion as string | null,
    };
    const pendientesAplicacion =
      datosAplicacion.seAplico !== null || datosAplicacion.fechaAplicacion !== null
        ? await exportarAplicacionEnPestana(
            r.nro_ri as number,
            (r.compras_areas as { nombre: string } | null)?.nombre ?? null,
            datosAplicacion,
            laCache
          )
        : [];

    // La fila que manda es la de la planilla, no la guardada en la base: si el
    // RI ya figuraba en la columna A, ésa es su fila aunque `seguimiento_fila`
    // dijera otra cosa (por ejemplo, si un `update` anterior falló después de
    // haber escrito bien).
    //
    // La cola es una sola: lo que quedó sin escribir en la pestaña del área se
    // suma a lo del master, con el nombre de la pestaña adelante para saber
    // dónde mirar.
    const motivoFinal = pendientesAplicacion.length > 0 ? pendientesAplicacion.join("; ") : null;
    const cambios: Record<string, unknown> = { seguimiento_pendiente: motivoFinal };
    if (fila !== (r.seguimiento_fila as number | null)) cambios.seguimiento_fila = fila;
    await admin.from("compras_requerimientos").update(cambios).eq("id", requerimientoId);

    return motivoFinal;
  } catch (e) {
    const dijoGoogle = e instanceof Error ? e.message : String(e);
    // Un 429 no es un rechazo: es "no ahora". Se nombra distinto para que no
    // mande a revisar la planilla algo que se arregla solo en la próxima
    // corrida. Es la misma lección que `escribirCelda` del otro libro.
    const motivo = dijoGoogle.includes("429")
      ? "la planilla no dio lugar por cuota; se reintenta solo"
      : dijoGoogle;
    console.error(`No se pudo escribir el RI ${r.nro_ri} en SEGUIMIENTO DE COMPRA: ${dijoGoogle}`);
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
 * Comparten un único `CacheDeSeguimiento`: la columna A se lee una vez para
 * los cinco, no cinco veces.
 */
export async function reintentarSeguimiento(): Promise<{ intentados: number; resueltos: number }> {
  if (!haySeguimiento()) return { intentados: 0, resueltos: 0 };

  const admin = createAdminClient();
  const { data } = await admin
    .from("compras_requerimientos")
    .select("id")
    .not("seguimiento_pendiente", "is", null)
    .limit(5);

  const cache: CacheDeSeguimiento = {};
  let resueltos = 0;
  for (const { id } of data ?? []) {
    if ((await exportarSeguimiento(id as string, cache)) === null) resueltos++;
  }
  return { intentados: (data ?? []).length, resueltos };
}
