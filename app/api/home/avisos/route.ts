import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { modulosVisibles } from "@/lib/core/access";
import type { Modulo, Rol, UsuarioModulo } from "@/lib/core/types";
import { hoyEnArgentina } from "@/lib/core/fechas";
import { filtrarDescartadas } from "@/lib/home/notificaciones";
import { avisosDeConteos, avisosDeRitmo, type ConteosParaAvisos } from "@/lib/home/avisos";
import { ritmoPorModulo } from "@/lib/home/ritmo";
import { traerRitmo, sinClasificarDelUltimoDiaHabil, equiposTallerVialSinService } from "@/lib/home/consultas";

/**
 * Sólo las notificaciones del globo. La consume la campana, que vive en
 * `components/Header.tsx` —o sea, en el layout— y por lo tanto corre en
 * **todas** las páginas del sistema.
 *
 * Existe aparte de `/api/home/resumen` justamente por eso: el resumen arma los
 * números de las tarjetas y es caro, y hasta ahora se pagaba ese costo en cada
 * navegación aunque la campana sólo usara `notificaciones`. Acá no hay ningún
 * `select` que traiga filas salvo el de RRHH: todo lo demás es `count … head` y
 * una lectura de la vista de ritmo.
 *
 * UN AVISO DE `AVISOS` NO SE CALCULA ACÁ, A PROPÓSITO
 *
 * `cantera-sin-conciliar` está definido en `lib/home/avisos.ts` pero no tiene
 * conteo en esta ruta, porque no se puede contar barato: `sinConciliar` sale de
 * `contarAvisos` (`lib/cantera/tablero.ts`), que filtra por `cruce`, `crucePerf`
 * y `cruceVol`. Ninguno de los tres es una columna: los deriva
 * `armarFilaVoladura` a partir de la voladura, su yacimiento y sus consumos.
 * Contarlo exige traer las tres tablas enteras, o sea volver a poner en **cada
 * página del sistema** justo lo que esta ruta existe para sacar.
 *
 * Eran tres hasta el 07/10/2026: los otros dos eran los de service de Taller
 * Vial, que no se podían contar barato porque necesitaban el último horómetro de
 * cada equipo cruzado con el último service por escalón. Ya no existen —medían
 * una tabla con un solo service y sólo podían decir 0 o 1; el porqué está en
 * `/api/home/resumen`—, y el que los reemplaza, `taller-vial-sin-service`, sí
 * entra acá: le alcanza con los `equipo_id` distintos de `taller_vial_services`.
 *
 * La información de Cantera **no se pierde del sistema**: se sigue viendo en la
 * tarjeta del Inicio, que arma `/api/home/resumen`. Lo que se pierde es la
 * campana.
 *
 * El arreglo, si alguna vez se decide pagarlo, es una vista que precalcule el
 * cruce de Cantera, igual que `inicio_ritmo_modulos`: entonces vuelve acá como
 * un `count … head` más.
 */
export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const { data: usuario } = await supabase.from("usuarios").select("rol").eq("id", user.id).single();
  if (!usuario) return NextResponse.json({ error: "Sin acceso" }, { status: 403 });

  const { data: grants } = await supabase
    .from("usuario_modulos").select("id, usuario_id, modulo, nivel").eq("usuario_id", user.id);
  const modulos = modulosVisibles(usuario.rol as Rol, (grants ?? []) as UsuarioModulo[]);
  const tiene = (m: Modulo) => modulos.includes(m);

  const hoy = hoyEnArgentina();

  /** Un conteo, o 0 si el usuario no tiene ese módulo. Sin `any`: eslint lo rechaza. */
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
    // alguien la corrija. Se cuenta con una columna, así que acá sale igual de
    // barato que los otros diez.
    contarSiTiene("taller_vial", () => head("taller_vial_cargas").is("equipo_id", null)),
    // No es un `count … head` —hay que cruzar los equipos EM activos contra los
    // `equipo_id` de los services—, pero son dos lecturas de dos columnas sobre
    // tablas de 16 y 1 filas: nada que ver con el pull de historia que hacían
    // los dos avisos de service que éste reemplaza.
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

  const { data: descartes } = await supabase
    .from("notificaciones_descartes")
    .select("notificacion_id, cantidad_vista")
    .eq("usuario_id", user.id);

  const notificaciones = [
    ...avisosDeConteos(conteos),
    ...avisosDeRitmo(ritmoPorModulo(filasRitmo), modulos),
  ];

  return NextResponse.json({ notificaciones: filtrarDescartadas(notificaciones, descartes ?? []) });
}
