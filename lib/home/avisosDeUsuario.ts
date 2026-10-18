import type { SupabaseClient } from "@supabase/supabase-js";
import { modulosVisibles, MODULOS_ORDEN } from "@/lib/core/access";
import type { Modulo, Rol, UsuarioModulo } from "@/lib/core/types";
import { hoyEnArgentina } from "@/lib/core/fechas";
import { filtrarDescartadas, type Notificacion } from "./notificaciones";
import { avisosDeConteos, avisosDeRitmo, type ConteosParaAvisos } from "./avisos";
import { ritmoPorModulo } from "./ritmo";
import { traerRitmo, sinClasificarDelUltimoDiaHabil, equiposTallerVialSinService } from "./consultas";

/** Lo que hace falta saber de alguien para armarle sus avisos. */
export interface QuienMira {
  id: string;
  rol: Rol;
  grants: UsuarioModulo[];
}

/**
 * Los avisos de una persona: lo que tiene para mirar hoy en los módulos a los
 * que tiene acceso, ya sin lo que descartó.
 *
 * Vive acá y no dentro de la ruta porque lo usan **dos** consumidores que no se
 * parecen en nada: `/api/home/avisos`, con la sesión de quien mira, y el cron
 * del resumen diario, que no tiene sesión y recorre a todos con el cliente
 * admin. Antes esto estaba pegado a `auth.getUser()`, así que el cron no podía
 * reusarlo y habría terminado en una segunda copia de las mismas trece
 * consultas — dos listas de avisos que se irían separando sin que nada avise.
 *
 * **POR QUÉ DA LO MISMO CON EL CLIENTE ADMIN.** El admin saltea RLS, así que la
 * pregunta obvia es si el cron le mostraría a alguien cosas que no debería ver.
 * No: el filtrado por módulo acá es **explícito** —cada conteo pasa por
 * `contarSiTiene`, y `avisosDeRitmo` recibe la lista de módulos— y el RLS de
 * este sistema gatea por acceso al módulo, no por fila. Quien tiene
 * Mantenimiento ve todas las órdenes; quien no lo tiene no cuenta ninguna, con
 * sesión o sin ella. Si algún día alguna tabla pasara a filtrar por fila, esto
 * deja de ser cierto y hay que volver acá.
 */
async function avisosDeLosModulos(
  supabase: SupabaseClient,
  modulos: Modulo[]
): Promise<Notificacion[]> {
  const tiene = (m: Modulo) => modulos.includes(m);
  const hoy = hoyEnArgentina();

  /** Un conteo, o 0 si la persona no tiene ese módulo. Sin `any`: eslint lo rechaza. */
  const contarSiTiene = async (
    modulo: Modulo,
    armar: () => PromiseLike<{ count: number | null }>
  ): Promise<number> => {
    if (!tiene(modulo)) return 0;
    const { count } = await armar();
    return count ?? 0;
  };
  const head = (tabla: string) =>
    supabase.from(tabla).select("id", { count: "exact", head: true });

  const [
    rrhhSinClasificar, mantenimientoAtrasadas, comprasEsperandoAprobacion,
    inventarioSinPlanilla, produccionSinPlanilla, despachoAbiertas, despachoSinPlanilla,
    facturacionSinVincular, calidadEnvasesSinPlanilla, trituracionSinPlanilla,
    tallerVialSinEquipo, tallerVialSinService, filasRitmo,
  ] = await Promise.all([
    tiene("rrhh") ? sinClasificarDelUltimoDiaHabil(supabase, hoy) : Promise.resolve(0),
    contarSiTiene("mantenimiento", () => head("ordenes_trabajo").eq("estado", "ATRASADO")),
    contarSiTiene("compras", () => head("compras_requerimientos").in("estado_aprobacion", ["PENDIENTE", "EN_REVISION"])),
    contarSiTiene("inventario", () => head("inventario_movimientos").not("sheets_pendiente", "is", null)),
    contarSiTiene("produccion", () => head("produccion_partes").not("sheets_pendiente", "is", null)),
    contarSiTiene("despacho", () => head("despacho_ordenes_carga").lt("fecha", hoy).is("salida_predio", null).not("cargado_por", "is", null)),
    contarSiTiene("despacho", () => head("despacho_ordenes_carga").not("sheets_pendiente", "is", null)),
    contarSiTiene("facturacion", () => head("facturas_proveedor").is("requerimiento_id", null).eq("estado", "recibida")),
    contarSiTiene("calidad", () => head("calidad_envases_movimientos").not("sheets_pendiente", "is", null)),
    contarSiTiene("trituracion", () => head("trituracion_partes").not("sheets_pendiente", "is", null)),
    // Una carga con `equipo_id` en null es un texto suelto —"empresa piparo" en
    // vez de un código EM— que no entra en ningún resumen por equipo hasta que
    // alguien la corrija. Se cuenta con una columna, así que sale igual de
    // barato que los otros diez.
    contarSiTiene("taller_vial", () => head("taller_vial_cargas").is("equipo_id", null)),
    // No es un `count … head` —hay que cruzar los equipos EM activos contra los
    // `equipo_id` de los services—, pero son dos lecturas de dos columnas sobre
    // tablas de 16 y 1 filas.
    tiene("taller_vial")
      ? equiposTallerVialSinService(supabase).then((r) => r.equiposSinService)
      : Promise.resolve(0),
    traerRitmo(supabase),
  ]);

  const conteos: Partial<ConteosParaAvisos> = {
    rrhhSinClasificar, mantenimientoAtrasadas, comprasEsperandoAprobacion,
    inventarioSinPlanilla, produccionSinPlanilla, despachoAbiertas, despachoSinPlanilla,
    facturacionSinVincular, calidadEnvasesSinPlanilla, trituracionSinPlanilla,
    tallerVialSinEquipo, tallerVialSinService,
  };

  return [...avisosDeConteos(conteos), ...avisosDeRitmo(ritmoPorModulo(filasRitmo), modulos)];
}

/**
 * Los avisos de **todo el sistema**, sin filtrar por persona ni por descartes.
 *
 * Existe para la foto diaria con la que el resumen calcula qué se movió, y la
 * foto es **global** porque los conteos son globales: `avisosDeLosModulos` los
 * saca con `count` sobre las tablas y lo único que cambia por persona es qué
 * módulos ve. Por eso son trece filas por día y no trece por persona.
 *
 * **No pasa por `filtrarDescartadas` a propósito.** Un descarte es de alguien;
 * la foto no es de nadie. Si la foto se calculara con los descartes de una
 * persona, el movimiento de todos quedaría atado a lo que esa persona silenció.
 */
export async function avisosDeTodoElSistema(
  supabase: SupabaseClient
): Promise<Notificacion[]> {
  return avisosDeLosModulos(supabase, [...MODULOS_ORDEN]);
}

/**
 * Los avisos de una persona: los de los módulos que ve, ya sin lo que descartó.
 */
export async function avisosDeUsuario(
  supabase: SupabaseClient,
  quien: QuienMira
): Promise<Notificacion[]> {
  const [avisos, descartes] = await Promise.all([
    avisosDeLosModulos(supabase, modulosVisibles(quien.rol, quien.grants)),
    supabase
      .from("notificaciones_descartes")
      .select("notificacion_id, cantidad_vista")
      .eq("usuario_id", quien.id)
      .then((r) => r.data ?? []),
  ]);

  return filtrarDescartadas(avisos, descartes);
}
