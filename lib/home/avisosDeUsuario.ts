import type { SupabaseClient } from "@supabase/supabase-js";
import { modulosVisibles, nivelEnModulo, MODULOS_ORDEN } from "@/lib/core/access";
import { FILTRO_FALTA_ALGO } from "@/lib/seguridadHigiene/condicion";
import { corteDeFotosAtascadas } from "@/lib/seguridadHigiene/respaldoDeFotos";
import { puedeAprobarCompras } from "@/lib/compras/auth";
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
    rrhhSinClasificar, mantenimientoAtrasadas, mantenimientoDivergencias,
    comprasEsperandoAprobacion,
    inventarioSinPlanilla, produccionSinPlanilla, despachoAbiertas, despachoSinPlanilla,
    facturacionSinVincular, calidadEnvasesSinPlanilla, calidadCarbonillaBandeja,
    trituracionSinPlanilla,
    tallerVialSinEquipo, tallerVialSinService, syhVencidas, syhSinCompletar, syhFotosSinRespaldar, filasRitmo,
  ] = await Promise.all([
    tiene("rrhh") ? sinClasificarDelUltimoDiaHabil(supabase, hoy) : Promise.resolve(0),
    contarSiTiene("mantenimiento", () => head("ordenes_trabajo").eq("estado", "ATRASADO")),
    // La tabla se rehace entera en cada sincronización, así que su tamaño ES
    // la divergencia de hoy. Su PK es `(ot_number, campo)` y no `id`, así que
    // el conteo va por una de esas columnas.
    //
    // Y si la tabla todavía no existe —la migración la corre una persona—,
    // PostgREST devuelve el error en el resultado en vez de tirar, así que
    // `count` llega en null y esto da 0: sin aviso y sin romper la campana,
    // que es el modo correcto de fallar mientras la migración no esté.
    tiene("mantenimiento")
      ? supabase
          .from("mantenimiento_divergencias")
          .select("ot_number", { count: "exact", head: true })
          .then(({ count }) => count ?? 0)
      : Promise.resolve(0),
    contarSiTiene("compras", () => head("compras_requerimientos").in("estado_aprobacion", ["PENDIENTE", "EN_REVISION"])),
    contarSiTiene("inventario", () => head("inventario_movimientos").not("sheets_pendiente", "is", null)),
    contarSiTiene("produccion", () => head("produccion_partes").not("sheets_pendiente", "is", null)),
    contarSiTiene("despacho", () => head("despacho_ordenes_carga").lt("fecha", hoy).is("salida_predio", null).not("cargado_por", "is", null)),
    contarSiTiene("despacho", () => head("despacho_ordenes_carga").not("sheets_pendiente", "is", null)),
    contarSiTiene("facturacion", () => head("facturas_proveedor").is("requerimiento_id", null).eq("estado", "recibida")),
    contarSiTiene("calidad", () => head("calidad_envases_movimientos").not("sheets_pendiente", "is", null)),
    // La bandeja se rehace entera en cada lectura, así que su tamaño ES la
    // divergencia de hoy: lo que la planilla dice y el SdG no pudo aplicar.
    // La PK es `fila`, no `id`, así que el conteo va por esa columna.
    tiene("calidad")
      ? supabase
          .from("calidad_planilla_sin_reconocer")
          .select("fila", { count: "exact", head: true })
          .then(({ count }) => count ?? 0)
      : Promise.resolve(0),
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
    // Vencida es no cerrada y con la fecha máxima ya pasada: la misma que
    // `estadoDe` (`<` y no `<=`, porque la máxima de hoy todavía vence mañana).
    contarSiTiene("seguridad_higiene", () => head("syh_condiciones").is("fecha_ejecucion", null).lt("fecha_maxima", hoy)),
    // Tiene que decir lo mismo que `faltasPendientes` (gestion.ts): no cerrada y
    // con algo de `loQueFalta()` (condicion.ts, la versión probada de esa regla).
    // Por eso es una consulta propia: son varias condiciones `or` sobre columnas
    // nullables. `FILTRO_FALTA_ALGO` vive junto a `loQueFalta` y un test las ata.
    contarSiTiene("seguridad_higiene", () => head("syh_condiciones").is("fecha_ejecucion", null).or(FILTRO_FALTA_ALGO)),
    // Las que nunca se respaldaron y llevan más de tres días: ver el aviso en
    // `avisos.ts`. `subida_el` y no una fecha de corrida, porque lo que importa es
    // cuánto hace que esa foto está expuesta.
    contarSiTiene("seguridad_higiene", () =>
      head("syh_fotos").is("respaldada_en_drive_el", null).lt("subida_el", corteDeFotosAtascadas(new Date()))
    ),
    traerRitmo(supabase),
  ]);

  const conteos: Partial<ConteosParaAvisos> = {
    rrhhSinClasificar, mantenimientoAtrasadas, mantenimientoDivergencias,
    comprasEsperandoAprobacion,
    inventarioSinPlanilla, produccionSinPlanilla, despachoAbiertas, despachoSinPlanilla,
    facturacionSinVincular, calidadEnvasesSinPlanilla, calidadCarbonillaBandeja,
    trituracionSinPlanilla,
    tallerVialSinEquipo, tallerVialSinService, syhVencidas, syhSinCompletar, syhFotosSinRespaldar,
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
 * Qué puede atender quien mira: las listas de responsables que integra y los
 * niveles que le habilitan una acción.
 *
 * Hay una lista porque hoy hay un solo aviso con lista. **Falta el de las
 * órdenes de servicio**: `os_aprobadores` existe y el aviso al instante ya la
 * usa, pero la campana no tiene un aviso de OS esperando aprobación. El día que
 * se agregue, va acá con su `apruebaOS` — no se deja preparado porque sería una
 * consulta por persona y por día que hoy no la usa nadie.
 *
 * `evaluaSyh` no sale de una lista sino de un **nivel**: evaluar y cerrar una
 * condición insegura lo puede hacer el `admin` de Seguridad e Higiene. Sale sin
 * consulta, porque los grants ya vienen en `QuienMira`.
 */
export interface QuePuedeAtender {
  apruebaCompras: boolean;
  evaluaSyh: boolean;
}

/** Los avisos que piden algo que no todos pueden hacer, y qué lo habilita. */
const DE_UNA_LISTA: Record<string, keyof QuePuedeAtender> = {
  "compras-por-aprobar": "apruebaCompras",
  "syh-vencidas": "evaluaSyh",
  "syh-sin-completar": "evaluaSyh",
  "syh-fotos-sin-respaldar": "evaluaSyh",
};

/**
 * Saca los avisos que esta persona no puede atender.
 *
 * **Esto no es repartir por rol.** Lo que se mira es quién puede **hacer** lo
 * que el aviso pide, y eso es de dos clases: una **lista de responsables** que
 * ya existe —`compras_aprobadores`, `os_aprobadores`, la misma regla que usa el
 * aviso al instante en `lib/core/avisoAlInstante.ts`— o el **nivel** que
 * habilita la acción —acá, `admin` en Seguridad e Higiene, que es quien evalúa
 * y cierra las condiciones—. Aprobar un gasto no lo habilita el nivel del
 * módulo ni ser admin del sistema: lo habilita estar en la lista, y eso ya lo
 * explica `puedeAprobarCompras` en `lib/compras/auth.ts`.
 *
 * Por qué hizo falta: medido el 18/10/2026, «Requerimientos esperando
 * aprobación» le llegaba a **6 personas y 3 no podían aprobar nada**. Un push
 * diario sobre trabajo que uno no tiene permiso de hacer enseña que un aviso
 * tuyo puede no ser tuyo, y esa lección se paga en todos los demás avisos. Con
 * los de Seguridad e Higiene es la misma razón: quien sólo carga condiciones
 * desde el teléfono no puede evaluarlas ni cerrarlas.
 *
 * **Los administradores siguen recibiendo todo lo demás**, decidido a pedido el
 * 18/10/2026: sólo se filtran los avisos que están en `DE_UNA_LISTA`.
 */
export function sinLoQueNoPuedeAtender(
  avisos: Notificacion[],
  puede: QuePuedeAtender
): Notificacion[] {
  return avisos.filter((a) => {
    const lista = DE_UNA_LISTA[a.id];
    return lista === undefined || puede[lista];
  });
}

/**
 * Los avisos de una persona: los de los módulos que ve, sin lo que descartó y
 * sin lo que no puede atender.
 */
export async function avisosDeUsuario(
  supabase: SupabaseClient,
  quien: QuienMira
): Promise<Notificacion[]> {
  const [avisos, descartes, apruebaCompras] = await Promise.all([
    avisosDeLosModulos(supabase, modulosVisibles(quien.rol, quien.grants)),
    supabase
      .from("notificaciones_descartes")
      .select("notificacion_id, cantidad_vista")
      .eq("usuario_id", quien.id)
      .then((r) => r.data ?? []),
    puedeAprobarCompras(supabase, quien.id),
  ]);

  const evaluaSyh = nivelEnModulo(quien.rol, quien.grants, "seguridad_higiene") === "admin";

  return sinLoQueNoPuedeAtender(filtrarDescartadas(avisos, descartes), { apruebaCompras, evaluaSyh });
}
