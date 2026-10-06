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
 *
 * TRES AVISOS DE `AVISOS` NO SE CALCULAN ACÁ, A PROPÓSITO
 *
 * `cantera-sin-conciliar`, `taller-vial-service-vencido` y
 * `taller-vial-service-proximo` están definidos en `lib/home/avisos.ts` pero no
 * tienen conteo en esta ruta, porque ninguno de los tres se puede contar barato:
 *
 *   - `sinConciliar` sale de `contarAvisos` (`lib/cantera/tablero.ts`), que
 *     filtra por `cruce`, `crucePerf` y `cruceVol`. Ninguno de los tres es una
 *     columna: los deriva `armarFilaVoladura` a partir de la voladura, su
 *     yacimiento y sus consumos. Contarlo exige traer las tres tablas enteras.
 *   - Los dos de service necesitan el último horómetro de cada equipo cruzado
 *     con el último service por escalón. Es historia, no un conteo.
 *
 * Traerlos acá sería volver a poner en **cada página del sistema** justo lo que
 * esta ruta existe para sacar.
 *
 * La información **no se pierde del sistema**: los tres se siguen viendo en las
 * tarjetas del Inicio, que las arma `/api/home/resumen`. Lo que sí se pierde es
 * la campana, y eso es una regresión real: a quien tenía un service de 250 hs
 * vencido, el globo dejó de avisarle.
 *
 * El arreglo, si alguna vez se decide pagarlo, es una vista que precalcule el
 * estado de service por equipo —y el cruce de Cantera—, igual que
 * `inicio_ritmo_modulos`: entonces vuelven acá como un `count … head` más.
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
    tallerVialSinEquipo, filasRitmo,
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
    // alguien la corrija. Es el único de los cuatro avisos de Cantera y Taller
    // Vial que sí se cuenta con una columna, así que acá sale igual de barato
    // que los otros diez.
    contarSiTiene("taller_vial", () => head("taller_vial_cargas").is("equipo_id", null)),
    traerRitmo(supabase),
  ]);

  const conteos: Partial<ConteosParaAvisos> = {
    rrhhSinClasificar, mantenimientoAtrasadas, comprasEsperandoAprobacion,
    inventarioSinPlanilla, produccionSinPlanilla, despachoAbiertas, despachoSinPlanilla,
    facturacionSinVincular, calidadEnvasesSinPlanilla, trituracionSinPlanilla,
    tallerVialSinEquipo,
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
