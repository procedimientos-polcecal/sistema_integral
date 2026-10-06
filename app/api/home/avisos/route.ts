import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { modulosVisibles } from "@/lib/core/access";
import type { Modulo, Rol, UsuarioModulo } from "@/lib/core/types";
import { hoyEnArgentina } from "@/lib/core/fechas";
import { filtrarDescartadas } from "@/lib/home/notificaciones";
import { avisosDeConteos, avisosDeRitmo, type ConteosParaAvisos } from "@/lib/home/avisos";
import { ritmoPorModulo } from "@/lib/home/ritmo";
import { traerRitmo, sinClasificarDelUltimoDiaHabil } from "@/lib/home/consultas";

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
    facturacionSinVincular, calidadEnvasesSinPlanilla, trituracionSinPlanilla, filasRitmo,
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
    traerRitmo(supabase),
  ]);

  const conteos: Partial<ConteosParaAvisos> = {
    rrhhSinClasificar, mantenimientoAtrasadas, comprasEsperandoAprobacion,
    inventarioSinPlanilla, produccionSinPlanilla, despachoAbiertas, despachoSinPlanilla,
    facturacionSinVincular, calidadEnvasesSinPlanilla, trituracionSinPlanilla,
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
