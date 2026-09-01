import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { modulosVisibles } from "@/lib/core/access";
import type { Rol, UsuarioModulo } from "@/lib/core/types";
import { idsOrDummy } from "@/lib/rrhh/dashboardHelpers";
import { utcDateOnlyFrom } from "@/lib/rrhh/dates";
import { traerTodo } from "@/lib/core/paginado";

/** Resumen liviano para la página de Inicio: solo los números de los módulos a los que el usuario tiene acceso. */
export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const { data: usuario } = await supabase.from("usuarios").select("rol").eq("id", user.id).single();
  if (!usuario) return NextResponse.json({ error: "Sin acceso" }, { status: 403 });

  const { data: grants } = await supabase.from("usuario_modulos").select("id, usuario_id, modulo, nivel").eq("usuario_id", user.id);
  const rol = usuario.rol as Rol;
  const modulos = new Set(modulosVisibles(rol, (grants ?? []) as UsuarioModulo[]));

  const hoy = utcDateOnlyFrom(new Date());
  const hoyStr = hoy.toISOString().slice(0, 10);

  const [rrhh, remises, mantenimiento, compras] = await Promise.all([
    modulos.has("rrhh") ? resumenRrhh(supabase, hoy, hoyStr) : Promise.resolve(null),
    modulos.has("remises") ? resumenRemises(supabase, hoyStr) : Promise.resolve(null),
    modulos.has("mantenimiento") ? resumenMantenimiento(supabase) : Promise.resolve(null),
    modulos.has("compras") ? resumenCompras(supabase) : Promise.resolve(null),
  ]);

  // Notificaciones reales: solo lo que amerita atención, no un contador decorativo.
  const notificaciones: { id: string; titulo: string; cantidad: number; href: string }[] = [];
  if (rrhh && rrhh.sinClasificarHoy > 0) {
    notificaciones.push({
      id: "rrhh-sin-clasificar",
      titulo: "Ausencias sin clasificar hoy",
      cantidad: rrhh.sinClasificarHoy,
      href: "/rrhh/asistencia?tab=dia",
    });
  }
  // Decía "mantenimientos vencidos" y salía de la misma tabla de una fila que
  // el titular. Dejarla ahí mostraría el número inútil en la misma pantalla de
  // la que se lo sacó.
  if (mantenimiento && mantenimiento.atrasadas > 0) {
    notificaciones.push({
      id: "mant-atrasadas",
      titulo: "Órdenes de trabajo atrasadas",
      cantidad: mantenimiento.atrasadas,
      href: "/mantenimiento/ordenes?estado=ATRASADO",
    });
  }

  if (compras && compras.esperandoAprobacion > 0) {
    notificaciones.push({
      id: "compras-por-aprobar",
      titulo: "Requerimientos esperando aprobación",
      cantidad: compras.esperandoAprobacion,
      href: "/compras/aprobaciones",
    });
  }

  return NextResponse.json({ rrhh, remises, mantenimiento, compras, notificaciones });
}

async function resumenRrhh(supabase: Awaited<ReturnType<typeof createClient>>, hoy: Date, hoyStr: string) {
  const { data: empleados } = await supabase.from("empleados").select("id").eq("activo", true);
  const empleadoIds = (empleados ?? []).map((e) => e.id);

  const { data: calculos } = await supabase
    .from("calculos_diarios")
    .select("ausente, justificada")
    .in("empleado_id", idsOrDummy(empleadoIds))
    .eq("fecha", hoyStr);

  const totalActivos = empleadoIds.length;
  const ausentesHoy = (calculos ?? []).filter((c) => c.ausente).length;
  const sinClasificarHoy = (calculos ?? []).filter((c) => c.ausente && c.justificada === null).length;
  return { empleadosActivos: totalActivos, presentesHoy: totalActivos - ausentesHoy, ausentesHoy, sinClasificarHoy };
}

async function resumenRemises(supabase: Awaited<ReturnType<typeof createClient>>, hoyStr: string) {
  const [{ count: vehiculosActivos }, { data: asistenciaHoy }] = await Promise.all([
    supabase.from("vehiculos").select("id", { count: "exact", head: true }).eq("activo", true),
    supabase.from("remises_asistencia").select("empleado_id").eq("fecha", hoyStr),
  ]);
  const empleadosConTurnoHoy = new Set((asistenciaHoy ?? []).map((a) => a.empleado_id)).size;
  return { vehiculosActivos: vehiculosActivos ?? 0, empleadosConTurnoHoy };
}

/**
 * Lo que Mantenimiento tiene sin hacer.
 *
 * El titular era "mantenimientos vencidos" y medía una tabla con **una sola
 * fila**: hay un único mantenimiento programado cargado en todo el sistema, así
 * que ese número sólo podía decir 0 o 1. No es que no hubiera trabajo atrasado
 * —hay 12 órdenes en ATRASADO—, es que el indicador miraba donde no había nada.
 * Vuelve cuando la programación se use de verdad.
 *
 * Los tres de ahora se mueven todas las semanas y los tres piden hacer algo,
 * que es lo único que justifica ocupar la tarjeta del inicio.
 */
async function resumenMantenimiento(supabase: Awaited<ReturnType<typeof createClient>>) {
  const [otCounts, avisos] = await Promise.all([
    Promise.all(
      ["POR_HACER", "EN_PROCESO", "ATRASADO"].map((estado) =>
        supabase.from("ordenes_trabajo").select("id", { count: "exact", head: true }).eq("estado", estado)
      )
    ),
    // Los avisos se cuentan en memoria porque "sin orden" son dos columnas: la
    // sincronización guarda el número de la planilla como texto en
    // `ot_asignada` y sólo los generados desde la app llenan `work_order_id`.
    // Mirando una sola, los 141 avisos parecerían estar todos sin atender.
    traerTodo<{ work_order_id: string | null; ot_asignada: string | null }>((desde, hasta) =>
      supabase.from("avisos").select("work_order_id, ot_asignada").range(desde, hasta)
    ),
  ]);

  const [porHacer, enProceso, atrasadas] = otCounts.map((r) => r.count ?? 0);

  // Un guión suelto es cómo se escribe "acá no va nada" en la planilla.
  const tieneOrden = (a: { work_order_id: string | null; ot_asignada: string | null }) =>
    Boolean(a.work_order_id) || !["", "-"].includes(String(a.ot_asignada ?? "").trim());

  return {
    atrasadas,
    otPendientes: porHacer + enProceso + atrasadas,
    avisosSinOrden: avisos.filter((a) => !tieneOrden(a)).length,
  };
}

/**
 * El estado del circuito de compras.
 *
 * Sale de la misma vista que alimenta el tablero, así que los números del
 * inicio y los del tablero no pueden decir cosas distintas. Lo que espera
 * aprobación de gerencia se cuenta aparte: esa cola vive antes del circuito
 * de compra y no está en la vista.
 */
async function resumenCompras(supabase: Awaited<ReturnType<typeof createClient>>) {
  const [{ data: porEstado }, { count: esperandoAprobacion }] = await Promise.all([
    supabase.from("compras_resumen_por_estado").select("estado_compra, cantidad"),
    supabase
      .from("compras_requerimientos")
      .select("id", { count: "exact", head: true })
      .in("estado_aprobacion", ["PENDIENTE", "EN_REVISION"]),
  ]);

  const cantidad = (estado: string) =>
    Number((porEstado ?? []).find((f) => f.estado_compra === estado)?.cantidad ?? 0);

  // Lo que de verdad es trabajo por hacer: ni lo ya pedido, ni lo frenado a
  // propósito.
  const enCurso =
    cantidad("SIN_INICIAR") + cantidad("EN_COMPARATIVA") +
    cantidad("PARA_COMPRAR") + cantidad("APROBADO");

  return {
    enCurso,
    esperandoAprobacion: esperandoAprobacion ?? 0,
    paraComprar: cantidad("PARA_COMPRAR"),
  };
}
