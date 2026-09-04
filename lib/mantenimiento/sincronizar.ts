/**
 * Traer de las planillas lo que el módulo espeja.
 *
 * Vive acá y no dentro de las rutas porque lo llaman dos cosas: el botón "Traer
 * de la planilla", que exige sesión y permisos, y el reloj, que no tiene
 * ninguna de las dos. Mientras estuvo en los handlers, el cron no podía usarlo.
 *
 * Cada una registra su corrida —salga bien o mal— para que la pantalla pueda
 * decir cuándo se actualizó por última vez.
 */

import { createAdminClient } from "@/lib/supabase/admin";
import { registrarSincronizacion } from "@/lib/core/sincronizaciones";
import { leerValores, leerFormulas, listarPestanas } from "@/lib/core/sheets";
import { linkDeCelda } from "@/lib/core/links";
import { cargarEnlaces, resolver, proveedorDe } from "@/lib/mantenimiento/enlaces";
import { filaDeAviso } from "@/lib/mantenimiento/avisos";
import { filaDeOrden } from "@/lib/mantenimiento/ordenes";
import {
  COMPARATIVA_PESTANAS, filaDeComparativa, pareceCotizacion,
} from "@/lib/mantenimiento/comparativas";
import {
  OS_PESTANAS, mapearEncabezados, filaDeOS, seguimientoHuerfano,
} from "@/lib/mantenimiento/os";

type Datos = Record<string, unknown>;

/**
 * Cómo salió una sincronización.
 *
 * El fallo lleva `status` para que la ruta lo devuelva tal cual: el cron lo
 * ignora, pero quien aprieta el botón merece saber si el problema fue de
 * configuración (503), de la planilla (502) o de la base (400).
 */
export type Resultado =
  | { ok: true; datos: Datos }
  | { ok: false; status: number; error: string; datos?: Datos };

const logra = (datos: Datos): Resultado => ({ ok: true, datos });
const falla = (status: number, error: string, datos?: Datos): Resultado =>
  ({ ok: false, status, error, datos });

/**
 * Una sola fila por número, y cuáles venían repetidos.
 *
 * Las tres planillas se espejan con un `upsert` sobre su número —`oa_number`,
 * `ot_number`, `os_number`—. Si el lote trae dos filas con el mismo, Postgres
 * aborta **el lote entero** con "ON CONFLICT DO UPDATE command cannot affect
 * row a second time": un número repetido en la planilla dejaba sin sincronizar
 * las otras 1.760 órdenes, y el mensaje no decía cuál era.
 *
 * Gana la última, que en una planilla es la de más abajo: el trabajo nuevo se
 * agrega al final, así que ante dos filas con el mismo número la de abajo es la
 * más reciente. No se elige en silencio: los repetidos se devuelven para que la
 * pantalla los nombre y alguien los corrija en la planilla, que es donde está
 * el problema de verdad.
 */
export function unaPorNumero<T extends Datos>(
  registros: T[],
  clave: string
): { unicos: T[]; repetidos: number[] } {
  const porNumero = new Map<unknown, T>();
  const repetidos = new Set<number>();

  for (const r of registros) {
    const numero = r[clave];
    if (porNumero.has(numero)) repetidos.add(Number(numero));
    porNumero.set(numero, r);
  }

  return {
    unicos: [...porNumero.values()],
    repetidos: [...repetidos].sort((a, b) => a - b),
  };
}

/**
 * Una sola fila por celda de la planilla, y cuáles venían repetidas.
 *
 * Las comparativas no se espejan por número: varias filas comparten el N° de OS
 * —son las ofertas que se comparan entre sí— así que lo que identifica a cada
 * cotización es la celda de la que salió, `(sheets_tab, sheets_row)`. Ésa es la
 * clave única que la tabla trae del esquema original de la app de
 * Mantenimiento.
 *
 * La dedupe hace falta por lo mismo que `unaPorNumero`: un `upsert` cuyo lote
 * trae dos veces la misma clave aborta **el lote entero**, y ahí se caen las 152
 * cotizaciones por una celda leída dos veces.
 *
 * Gana la última por la misma razón que allá, y los repetidos se devuelven con
 * el nombre de la celda —`Compresores!14`— para que se puedan buscar en la
 * planilla, que es donde está el problema de verdad.
 */
export function unaPorCelda<T extends Datos>(
  registros: T[]
): { unicos: T[]; repetidos: string[] } {
  const porCelda = new Map<string, T>();
  const repetidos = new Set<string>();

  for (const r of registros) {
    const celda = `${r.sheets_tab}!${r.sheets_row}`;
    if (porCelda.has(celda)) repetidos.add(celda);
    porCelda.set(celda, r);
  }

  return { unicos: [...porCelda.values()], repetidos: [...repetidos].sort() };
}

/** El texto que explica por qué no se pudo leer una pestaña. */
async function porQueNoSeLeyo(
  planilla: string, pestana: string, e: unknown, variable: string
): Promise<string> {
  // El error de Google no dice qué pestañas hay, y adivinar el nombre es la
  // primera cosa que sale mal. Se lo decimos.
  let disponibles: string[] = [];
  try {
    disponibles = await listarPestanas(planilla);
  } catch {
    // Si tampoco se puede listar, el problema es de acceso: vale el de arriba.
  }

  return (
    `No se pudo leer la pestaña "${pestana}". ` +
    (disponibles.length > 0
      ? `La planilla tiene: ${disponibles.join(", ")}. Configurá ${variable}.`
      : e instanceof Error ? e.message : String(e))
  );
}

/** Trae los avisos de su planilla. */
export async function sincronizarAvisos(): Promise<Resultado> {
  const planilla = process.env.GOOGLE_SHEETS_AVISOS_ID ?? "";
  const pestana = process.env.GOOGLE_SHEETS_AVISOS_TAB ?? "AVISOS";
  if (!planilla) return falla(503, "Falta configurar GOOGLE_SHEETS_AVISOS_ID");

  let filas: string[][];
  try {
    filas = await leerValores(planilla, pestana, { sinFormato: true });
  } catch (e) {
    return falla(502, await porQueNoSeLeyo(planilla, pestana, e, "GOOGLE_SHEETS_AVISOS_TAB"));
  }

  if (filas.length < 2) return logra({ leidas: 0, guardados: 0, sin_equipo: 0 });

  const admin = createAdminClient();
  const enlaces = await cargarEnlaces(admin);

  const registros: Datos[] = [];
  let sinEquipo = 0;

  for (let i = 0; i < filas.length - 1; i++) {
    const aviso = filaDeAviso(filas[i + 1], i + 2);
    if (!aviso) continue;

    const { equipment_id, sector_id } = resolver(enlaces, aviso);
    if (!equipment_id) sinEquipo += 1;

    registros.push({ ...aviso, equipment_id, sector_id, synced_at: new Date().toISOString() });
  }

  let guardados = 0;
  const { unicos, repetidos } = unaPorNumero(registros, "oa_number");

  for (let i = 0; i < unicos.length; i += 500) {
    const lote = unicos.slice(i, i + 500);
    const { error } = await admin.from("avisos").upsert(lote, { onConflict: "oa_number" });

    if (error) {
      await registrarSincronizacion({
        modulo: "mantenimiento", recurso: "avisos", ok: false, error: error.message,
      });
      return falla(400, error.message);
    }
    guardados += lote.length;
  }

  await registrarSincronizacion({
    modulo: "mantenimiento", recurso: "avisos", ok: true, filas: guardados,
  });
  return logra({
    leidas: filas.length - 1, guardados, sin_equipo: sinEquipo,
    numeros_repetidos: repetidos,
  });
}

/** Trae las órdenes de trabajo de su planilla. */
export async function sincronizarOrdenes(): Promise<Resultado> {
  const planilla = process.env.GOOGLE_SHEETS_OT_ID ?? "";
  const pestana = process.env.GOOGLE_SHEETS_OT_TAB ?? "OT";
  if (!planilla) return falla(503, "Falta configurar GOOGLE_SHEETS_OT_ID");

  let filas: string[][];
  try {
    filas = await leerValores(planilla, pestana, { sinFormato: true });
  } catch (e) {
    return falla(502, await porQueNoSeLeyo(planilla, pestana, e, "GOOGLE_SHEETS_OT_TAB"));
  }

  if (filas.length < 2) return logra({ leidas: 0, guardadas: 0, sin_equipo: 0 });

  const admin = createAdminClient();
  const enlaces = await cargarEnlaces(admin);

  const registros: Datos[] = [];
  const sinProveedor = new Set<string>();
  let sinEquipo = 0;

  for (let i = 0; i < filas.length - 1; i++) {
    const orden = filaDeOrden(filas[i + 1], i + 2);
    if (!orden) continue;

    const { equipment_id, sector_id } = resolver(enlaces, orden);
    if (!equipment_id) sinEquipo += 1;

    // El contratista es un proveedor del SdG: si lo reconocemos, se enlaza.
    // El nombre crudo se conserva porque es lo que dice la planilla.
    const proveedor_id = proveedorDe(enlaces, orden.contratista);
    if (orden.contratista && !proveedor_id) sinProveedor.add(orden.contratista);

    registros.push({
      ...orden, equipment_id, sector_id, proveedor_id,
      synced_at: new Date().toISOString(),
    });
  }

  let guardadas = 0;
  const { unicos, repetidos } = unaPorNumero(registros, "ot_number");

  for (let i = 0; i < unicos.length; i += 500) {
    const lote = unicos.slice(i, i + 500);
    const { error } = await admin
      .from("ordenes_trabajo")
      .upsert(lote, { onConflict: "ot_number" });

    if (error) {
      await registrarSincronizacion({
        modulo: "mantenimiento", recurso: "ordenes", ok: false, error: error.message,
      });
      return falla(400, error.message);
    }
    guardadas += lote.length;
  }

  await registrarSincronizacion({
    modulo: "mantenimiento", recurso: "ordenes", ok: true, filas: guardadas,
  });
  return logra({
    leidas: filas.length - 1,
    guardadas,
    sin_equipo: sinEquipo,
    numeros_repetidos: repetidos,
    sin_proveedor: [...sinProveedor],
  });
}

/** Trae las órdenes de servicio de su planilla, una pestaña por área. */
export async function sincronizarOrdenesDeServicio(): Promise<Resultado> {
  const planilla = process.env.GOOGLE_SHEETS_OS_ID ?? "";
  if (!planilla) return falla(503, "Falta configurar GOOGLE_SHEETS_OS_ID");

  const admin = createAdminClient();
  const enlaces = await cargarEnlaces(admin);
  const cuando = new Date().toISOString();

  // Una OS puede aparecer en la hoja maestra y en la de su área: se queda la
  // última leída, que es la que trae el seguimiento.
  const porNumero = new Map<number, Datos>();
  const sinLeer: string[] = [];
  const huerfanas: string[] = [];
  const sinProveedor = new Set<string>();
  let sinEquipo = 0;

  for (const pestana of OS_PESTANAS) {
    let filas: string[][];
    try {
      filas = await leerValores(planilla, pestana, { sinFormato: true });
    } catch {
      sinLeer.push(pestana);
      continue;
    }
    if (filas.length < 2) continue;

    const idx = mapearEncabezados(filas[0]);

    // La comparativa es un `HYPERLINK` y la celda sólo muestra "LINK": la URL
    // hay que sacarla de la fórmula o se guarda la palabra.
    const formulas = idx.comparativa >= 0
      ? await leerFormulas(planilla, pestana).catch(() => [] as string[][])
      : [];

    for (let i = 1; i < filas.length; i++) {
      const os = filaDeOS(filas[i], idx, pestana, i + 1);

      if (!os) {
        // Seguimiento sin orden: el FILTER corrió las filas y lo escrito a
        // mano quedó colgado de ninguna OS. No se importa, se avisa.
        if (seguimientoHuerfano(filas[i])) huerfanas.push(`${pestana}!${i + 1}`);
        continue;
      }

      const link = linkDeCelda(formulas[i]?.[idx.comparativa], null);
      const { equipment_id, sector_id } = resolver(enlaces, os);
      if (!equipment_id) sinEquipo += 1;

      const proveedor_id = proveedorDe(enlaces, os.proveedor_elegido);
      if (os.proveedor_elegido && !proveedor_id) sinProveedor.add(os.proveedor_elegido);

      porNumero.set(os.os_number, {
        ...os,
        comparativa: link ?? os.comparativa,
        equipment_id,
        sector_id,
        proveedor_id,
        synced_at: cuando,
      });
    }
  }

  const registros = [...porNumero.values()];
  if (registros.length === 0) {
    return falla(
      502,
      sinLeer.length === OS_PESTANAS.length
        ? "No se pudo leer ninguna pestaña de la planilla."
        : "La planilla no tiene ninguna orden de servicio cargada.",
      { sin_leer: sinLeer, pestanas: await listarPestanas(planilla).catch(() => []) }
    );
  }

  let guardadas = 0;
  for (let i = 0; i < registros.length; i += 500) {
    const lote = registros.slice(i, i + 500);
    const { error } = await admin
      .from("ordenes_servicio")
      .upsert(lote, { onConflict: "os_number" });

    if (error) {
      await registrarSincronizacion({
        modulo: "mantenimiento", recurso: "ordenes-servicio", ok: false, error: error.message,
      });
      return falla(400, error.message);
    }
    guardadas += lote.length;
  }

  await registrarSincronizacion({
    modulo: "mantenimiento", recurso: "ordenes-servicio", ok: true, filas: guardadas,
  });
  return logra({
    guardadas,
    sin_equipo: sinEquipo,
    sin_leer: sinLeer,
    huerfanas,
    sin_proveedor: [...sinProveedor],
  });
}

/** Trae las comparativas de proveedores de su planilla. */
export async function sincronizarComparativas(): Promise<Resultado> {
  const planilla = process.env.GOOGLE_SHEETS_COMPARATIVAS_ID ?? "";
  if (!planilla) return falla(503, "Falta configurar GOOGLE_SHEETS_COMPARATIVAS_ID");

  const admin = createAdminClient();
  const enlaces = await cargarEnlaces(admin);

  const cotizaciones: Datos[] = [];
  const sinLeer: string[] = [];
  const sinProveedor = new Set<string>();
  const cuando = new Date().toISOString();

  // Cuántas cotizaciones tenía la planilla y cuáles quedaron a medias.
  //
  // No se cuentan "filas no vacías": las pestañas traen miles de filas de
  // plantilla —formato, fórmulas, textos fijos— y contarlas daba 11.725 contra
  // 159 cargadas, un aviso que decía que faltaban 11.566 cotizaciones que no
  // existen. Se cuenta lo que `pareceCotizacion` reconoce: la fila que trae N°
  // de OS o proveedor, o sea la que alguien escribió.
  //
  // La diferencia con `guardadas` son las que tienen uno de los dos datos y no
  // el otro: quedaron a medias y hay que ir a mirarlas a la planilla.
  let leidas = 0;
  const sinParsear: string[] = [];

  for (const pestana of COMPARATIVA_PESTANAS) {
    let filas: string[][];
    try {
      filas = await leerValores(planilla, pestana, { sinFormato: true });
    } catch {
      // Una pestaña que se renombró o se borró no puede frenar a las otras
      // once, pero tiene que verse en el resultado.
      sinLeer.push(pestana);
      continue;
    }

    for (let i = 1; i < filas.length; i++) {
      if (!pareceCotizacion(filas[i])) continue;
      leidas += 1;

      const cot = filaDeComparativa(filas[i], i + 1, pestana);
      if (!cot) {
        sinParsear.push(`${pestana}!${i + 1}`);
        continue;
      }

      const proveedor_id = proveedorDe(enlaces, cot.proveedor);
      if (!proveedor_id) sinProveedor.add(cot.proveedor);

      // La cotización dice de qué máquina es: sirve para ver lo que se cotizó
      // de un equipo sin pasar por la OS.
      const { equipment_id } = resolver(enlaces, cot);

      cotizaciones.push({ ...cot, proveedor_id, equipment_id, synced_at: cuando });
    }
  }

  // Sin nada leído no se toca el espejo: una planilla inaccesible lo borraría
  // entero y no habría con qué volver a armarlo.
  if (cotizaciones.length === 0) {
    return falla(
      502,
      sinLeer.length === COMPARATIVA_PESTANAS.length
        ? "No se pudo leer ninguna pestaña de la planilla."
        : "La planilla no tiene ninguna cotización cargada.",
      { sin_leer: sinLeer }
    );
  }

  // Refresco completo: en la planilla se corrigen y se borran filas, y sólo
  // volviendo a leerla entera queda igual de los dos lados.
  //
  // SE ESCRIBE CADA FILA SOBRE LA SUYA, DESPUÉS SE BORRA LO QUE SOBRÓ. Las dos
  // formas anteriores estaban mal, cada una a su manera:
  //
  //   - Borrar y después insertar deja la tabla VACÍA entre el DELETE y el
  //     primer INSERT, y esto corre cada 15 minutos: una pantalla que lea justo
  //     ahí no ve ninguna cotización. Y si falla el lote 3 de 5, el espejo
  //     queda borrado a medias: lo viejo ya no está y lo nuevo está incompleto.
  //
  //   - Insertar y después borrar —que es como estaba— apostaba a que por unos
  //     segundos hubiera filas repetidas, distinguidas por `synced_at`. Con un
  //     comentario que decía "no hace falta clave única". La clave única existe
  //     desde el esquema original de la app de Mantenimiento —
  //     `os_comparativas_sheets_tab_sheets_row_key`, sobre (sheets_tab,
  //     sheets_row)— y no está en ninguna migración de este repo, así que no se
  //     la vio. La copia nueva de cada fila chocaba con la vieja y el primer
  //     lote se caía entero: el espejo quedó congelado tres días con 152
  //     cotizaciones del 1 de septiembre, y cada corrida repitiendo el mismo
  //     error.
  //
  // El `upsert` sobre esa clave no tiene ninguna de las dos ventanas: cada
  // cotización se escribe encima de la suya, la tabla nunca queda vacía ni con
  // duplicados, y si falla un lote lo anterior sigue completo. De paso el `id`
  // de cada cotización deja de cambiar en cada corrida —antes se borraba y se
  // insertaba de nuevo—, así que la pantalla que tenía una lista cargada puede
  // elegir una sin que el id ya no exista.
  //
  // La dedupe es la trampa de siempre: un lote con la misma clave dos veces
  // aborta el lote entero.
  const { unicos, repetidos } = unaPorCelda(cotizaciones);

  let guardadas = 0;
  for (let i = 0; i < unicos.length; i += 500) {
    const lote = unicos.slice(i, i + 500);
    const { error } = await admin
      .from("os_comparativas")
      .upsert(lote, { onConflict: "sheets_tab,sheets_row" });

    if (error) {
      await registrarSincronizacion({
        modulo: "mantenimiento", recurso: "comparativas", ok: false, error: error.message,
      });
      return falla(400, `No se guardó nada nuevo y el espejo anterior quedó intacto. ${error.message}`);
    }
    guardadas += lote.length;
  }

  // Lo que sobró son las cotizaciones cuya celda ya no está en la planilla:
  // filas que alguien borró, o que el orden movió. El `upsert` no las puede
  // alcanzar —nadie escribió encima de ellas— así que se van por `synced_at`.
  //
  // Que esto falle no tira abajo la corrida: lo nuevo ya está guardado y no
  // falta nada, sólo quedan de más unas cotizaciones que la planilla ya no
  // tiene. Se avisa y la próxima limpia.
  //
  // Las cargadas desde la app no corren riesgo acá aunque su celda sea nueva:
  // el POST escribe primero la fila en la planilla y guarda esa celda, así que
  // la corrida siguiente la lee y la pisa.
  const { error: errorBorrado } = await admin
    .from("os_comparativas")
    .delete()
    .neq("synced_at", cuando);

  const sobrantes = errorBorrado
    ? `Quedaron cotizaciones que la planilla ya no tiene, sin borrar (${errorBorrado.message}). ` +
      "Se van a ver de más hasta la próxima sincronización."
    : null;

  // Una celda leída dos veces no se resuelve en silencio: se dice cuál, porque
  // el problema está en la planilla y ahí hay que ir a mirarlo.
  const celdasRepetidas = repetidos.length > 0
    ? `Se leyeron ${repetidos.length} celda(s) más de una vez: ${repetidos.join(", ")}. ` +
      "Quedó la última de cada una."
    : null;

  // Las filas que la planilla tiene y no se pudieron leer van al registro, no
  // sólo a la respuesta: la respuesta la ve quien apretó el botón, el registro
  // queda para el día que alguien pregunte por qué falta una cotización.
  const noEntraron = sinParsear.length > 0
    ? `${sinParsear.length} fila(s) quedaron a medias —tienen N° de OS o proveedor, no los dos—: ` +
      `${sinParsear.slice(0, 20).join(", ")}${sinParsear.length > 20 ? "…" : ""}.`
    : null;

  const aviso = [sobrantes, celdasRepetidas, noEntraron].filter(Boolean).join(" ") || null;

  const ordenes = new Set(unicos.map((c) => c.os_number)).size;
  await registrarSincronizacion({
    modulo: "mantenimiento", recurso: "comparativas", ok: true, filas: guardadas,
    error: aviso ?? undefined,
  });
  return logra({
    leidas, guardadas, ordenes,
    sin_leer: sinLeer, sin_proveedor: [...sinProveedor],
    ...(sinParsear.length > 0 ? { sin_parsear: sinParsear } : {}),
    ...(sobrantes ? { sobrantes } : {}),
    ...(celdasRepetidas ? { celdas_repetidas: repetidos } : {}),
  });
}

/** Las cuatro, en el orden en que conviene traerlas. */
export const SINCRONIZACIONES = [
  // Los equipos y sectores ya están; lo demás cuelga de ellos. Las órdenes de
  // servicio antes que sus comparativas, para que una cotización nunca quede
  // apuntando a una OS que todavía no existe.
  { recurso: "avisos", correr: sincronizarAvisos },
  { recurso: "ordenes", correr: sincronizarOrdenes },
  { recurso: "ordenes-servicio", correr: sincronizarOrdenesDeServicio },
  { recurso: "comparativas", correr: sincronizarComparativas },
] as const;
