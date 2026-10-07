import type { SupabaseClient } from "@supabase/supabase-js";
import { traerMarcaciones, traerEmpleados } from "./cliente";
import { agruparPorLegajo } from "./agrupar";
import { cotejarPadron, type ResultadoDelCotejo } from "./cotejo";
import { avisoDeDescartadas, avisoDeRangoVacio, nombreDelLote, resolverEmpleados, sumarConAbiertasPrevias } from "./preparar";
import { aplicarDias } from "../fichadas/aplicar";
import { diaIso } from "../dates";
import { traerTodo } from "@/lib/core/paginado";

export interface ResumenSincronizacion {
  desde: string;
  hasta: string;
  marcacionesTraidas: number;
  insertados: number;
  reemplazados: number;
  salteados: number;
  avisos: string[];
  /**
   * Fichadas abiertas viejas que alguien tiene que cerrar a mano. Van aparte de
   * `avisos` porque no son un error de la corrida: mezcladas, toda corrida
   * arrancaría con decenas de "errores" y nadie leería ninguno.
   */
  pendientes: string[];
  batchId: string;
}

/**
 * Trae las marcaciones de Lenox para un rango y las aplica.
 *
 * El cotejo del padrón va adentro de la misma corrida y no en una pantalla
 * aparte: adelanta el aviso. Hoy un alta que no se cargó aparece como
 * `legajo "PC_241" no encontrado` recién cuando ya falló la carga; así
 * aparece antes y con nombre y apellido. No crea ni borra empleados — los
 * catálogos del núcleo se leen, no se rehacen desde un módulo.
 *
 * LLAMADAS A LA API: una de marcaciones por cada ventana de 7 días del rango
 * más una de empleados. Hay un límite duro y la API no dice cuál, así que acá
 * no se agrega ninguna que no haga falta: el cotejo reusa los empleados del
 * SdG que ya se leyeron para enlazar los legajos.
 */
export async function sincronizarMarcaciones(
  admin: SupabaseClient,
  desde: Date,
  hasta: Date,
  usuarioId: string | null
): Promise<ResumenSincronizacion> {
  const marcaciones = await traerMarcaciones(desde, hasta);
  const { porLegajo, descartadas } = agruparPorLegajo(marcaciones, desde, hasta);

  // traerTodo y no un select a secas: PostgREST corta en 1000 filas y no avisa,
  // y un padrón cortado se vería como "ese legajo no existe en el SdG".
  const empleadosData = await traerTodo<{
    id: string;
    legajo: string | null;
    nombre: string;
    apellido: string;
    activo: boolean;
  }>((d, h) => admin.from("empleados").select("id, legajo, nombre, apellido, activo").order("id").range(d, h));
  const legajoToId = new Map<string, string>();
  const legajoDe = new Map<string, string>();
  for (const e of empleadosData) {
    const legajo = String(e.legajo ?? "").trim();
    legajoToId.set(legajo, e.id);
    legajoDe.set(e.id, legajo);
  }

  const avisosPrevios: string[] = [];
  const descartes = avisoDeDescartadas(descartadas, marcaciones.length);
  if (descartes) avisosPrevios.push(descartes);
  // Cero marcaciones en un rango largo es casi seguro una falla de Lenox, y sin
  // este aviso se cargaría nada y se reportaría éxito.
  const rangoVacio = avisoDeRangoVacio(desde, hasta, marcaciones.length);
  if (rangoVacio) avisosPrevios.push(rangoVacio);

  const resueltos = resolverEmpleados(porLegajo, legajoToId);
  avisosPrevios.push(...resueltos.avisos);

  // Los que no tienen ninguna marcación en el rango pero sí una fichada
  // abierta de antes: ver `sumarConAbiertasPrevias` para el porqué.
  //
  // Va con traerTodo aunque al 07/10/2026 sean 54 filas de 23 empleados: cada
  // aviso de "turno sin marcación de salida" deja una, y son del orden de 50
  // a 80 por lote. PostgREST corta en 1000 y no avisa, y acá un corte mudo se
  // vería como "esa fichada abierta no existe" en vez de como un error.
  //
  // El `.order("id")` NO es decorativo: `.range()` es LIMIT/OFFSET, y sin un
  // orden determinístico dos páginas consecutivas pueden repetir o saltear
  // filas.
  const abiertas = await traerTodo<{ empleado_id: string }>((d, h) =>
    admin.from("fichadas").select("empleado_id")
      .is("hora_salida", null).lt("fecha", diaIso(desde)).order("id").range(d, h)
  );
  const empleados = sumarConAbiertasPrevias(
    resueltos.empleados,
    abiertas.map((f) => f.empleado_id),
    legajoDe,
    desde,
    hasta
  );

  const { data: batch, error: batchErr } = await admin
    .from("rrhh_import_batches")
    .insert({ nombre_archivo: nombreDelLote(desde, hasta), usuario_id: usuarioId })
    .select("id")
    .single();
  if (batchErr) throw new Error(batchErr.message);

  // `aplicarDias` se llama UNA sola vez con el rango entero, no una por
  // ventana de 7 días. El partido en ventanas es un detalle del cliente HTTP
  // y muere ahí: `traerMarcaciones` devuelve las filas de todo el rango.
  // Llamarlo por ventana repetiría el aviso agregado de fichadas abiertas
  // viejas —cada una con su propio "antes del" y su propia lista— y además
  // rompería el encadenamiento entre ventanas.
  //
  // `protegerCorregidos: true` porque el cron no elige nada: a diferencia de
  // quien sube un archivo a mano, nadie está decidiendo pisar un período.
  let resultado;
  try {
    resultado = await aplicarDias(
      admin,
      { tipo: "marcas", empleados },
      { batchId: batch.id, protegerCorregidos: true }
    );
  } catch (e) {
    // `aplicarDias` dice en el mensaje qué quedó a medias, y quien llama sólo
    // lo anota en `sincronizaciones`, que no sabe de lotes. Un lote sin
    // detalle ni conteos es un día vacío que nadie sabe que está vacío: se
    // deja escrito acá, con lo que ya quedó en la base contado de la base.
    const mensaje = e instanceof Error ? e.message : String(e);
    await anotarFallo(admin, batch.id, avisosPrevios, mensaje);
    throw e;
  }

  // El cotejo es lo último: que falle no puede voltear una sincronización de
  // marcaciones que sí funcionó (ver `cotejarElPadron`).
  const cotejo = await cotejarElPadron(empleadosData);

  // Un error es algo que hizo que un dato no se cargara. Una alta sin cargar
  // lo es —las marcaciones de esa persona no entraron—; una baja sin cargar o
  // un activo sin reloj no: es un dato maestro por actualizar, y probablemente
  // permanente y legítimo.
  const avisos = [...avisosPrevios, ...resultado.avisos, ...cotejo.errores];

  // `pendientes` va al detalle pero NO al conteo de errores: un número de
  // errores que incluye lo que no es un error es un número que nadie mira.
  const pendientes = [...resultado.pendientes, ...cotejo.pendientes];
  const detalle = [...avisos, ...pendientes];
  const { error: updateErr } = await admin
    .from("rrhh_import_batches")
    .update({
      cantidad_registros: resultado.insertados,
      cantidad_errores: avisos.length,
      log_detalle: detalle.length ? detalle.join("\n") : null,
    })
    .eq("id", batch.id);
  if (updateErr) {
    throw new Error(
      `Las fichadas se cargaron, pero no se pudo completar el registro del lote ${batch.id}: ${updateErr.message}`
    );
  }

  return {
    desde: diaIso(desde),
    hasta: diaIso(hasta),
    marcacionesTraidas: marcaciones.length,
    insertados: resultado.insertados,
    reemplazados: resultado.reemplazados,
    salteados: resultado.salteados.length,
    avisos,
    pendientes,
    batchId: batch.id,
  };
}

/** Compara el padrón de Lenox con el del SdG. Informa; no toca nada. */
async function cotejarElPadron(
  delSdG: { legajo: string | null; nombre: string; apellido: string; activo: boolean }[]
): Promise<ResultadoDelCotejo> {
  try {
    return cotejarPadron(delSdG, await traerEmpleados());
  } catch (e) {
    // El cotejo es accesorio: que falle no puede voltear una sincronización
    // de marcaciones que sí funcionó. Es un pendiente y no un error: no hizo
    // que ningún dato dejara de cargarse. Una alta que se nos pase por esto
    // igual aparece como error cuando sus marcaciones lleguen ("el legajo no
    // existe en el SdG").
    return {
      errores: [],
      pendientes: [`No se pudo cotejar el padrón con Lenox: ${e instanceof Error ? e.message : String(e)}`],
    };
  }
}

/** Deja en el lote que la corrida quedó a medias. Si ni eso se puede, no tapa el error original. */
async function anotarFallo(admin: SupabaseClient, batchId: string, avisosPrevios: string[], mensaje: string): Promise<void> {
  // El try es por si cae la red: sin él, el error de anotar taparía al que
  // importa, el de `aplicarDias`, que dice qué quedó a medias.
  try {
    const { count, error: countErr } = await admin
      .from("fichadas")
      .select("*", { count: "exact", head: true })
      .eq("import_batch_id", batchId);
    await admin
      .from("rrhh_import_batches")
      .update({
        ...(countErr ? {} : { cantidad_registros: count ?? 0 }),
        cantidad_errores: avisosPrevios.length + 1,
        log_detalle: [
          ...avisosPrevios,
          `La sincronización quedó a medias: ${mensaje}`,
          ...(countErr ? [`No se pudo contar las fichadas ya insertadas: ${countErr.message}`] : []),
        ].join("\n"),
      })
      .eq("id", batchId);
  } catch {
    // Nada más que hacer: el error original sigue su camino.
  }
}
