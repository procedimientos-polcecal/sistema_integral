import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { nivelMantenimientoDe } from "@/lib/mantenimiento/auth";
import { lunesDe } from "@/lib/mantenimiento/produccion";
import {
  ultimosMeses, sectoresAParar, ventanasDeReparacion, nombreDelMes,
} from "@/lib/mantenimiento/dashboard";
import DashboardClient from "./DashboardClient";
import { sectoresDePlanta, empresaDelSector } from "@/lib/mantenimiento/sectores";


export default async function MantenimientoDashboardPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const hoy = new Date().toISOString().split("T")[0];
  const en7dias = new Date(Date.now() + 7 * 86400000).toISOString().split("T")[0];

  const [
    { data: usuario },
    { data: equipos },
    { data: upcoming },
    { data: overdue },
    { data: empresas },
    sectores,
    { data: sectoresStatusLog },
    { data: recentExecutions },
  ] = await Promise.all([
    supabase.from("usuarios").select("nombre, apellido, rol").eq("id", user.id).single(),
    supabase.from("equipos")
      .select("status, criticality, sectores(nombre, empresas(nombre))")
      .eq("is_active", true),
    supabase.from("mantenimientos_programados")
      .select("*, equipos(name, code), assigned_user:assigned_to(nombre, apellido)")
      .eq("status", "active")
      .lte("next_date", en7dias)
      .gte("next_date", hoy)
      .order("next_date", { ascending: true })
      .limit(10),
    supabase.from("mantenimientos_programados")
      .select("*, equipos(name, code), assigned_user:assigned_to(nombre, apellido)")
      .eq("status", "active")
      .lt("next_date", hoy)
      .order("next_date", { ascending: true })
      .limit(10),
    supabase.from("empresas").select("id, nombre, status").order("nombre"),
    sectoresDePlanta(supabase, "id, nombre, codigo, status, empresas(nombre)"),
    // Sólo los cambios de sectores de planta: los organizativos los mueve RRHH
    // y en este tablero no dicen nada.
    supabase.from("sectores_status_log")
      .select("*, sector:sector_id!inner(nombre, es_de_planta, empresas(nombre)), changed_by_user:changed_by(nombre, apellido)")
      .eq("sector.es_de_planta", true)
      .order("changed_at", { ascending: false })
      .limit(20),
    supabase.from("mantenimientos_ejecuciones")
      .select("execution_status, executed_at")
      .order("executed_at", { ascending: false })
      .limit(60),
  ]);

  // ── Conteo de OTs por estado (count queries, sin traer todas las filas) ──────
  const OT_ESTADOS = ["POR_HACER", "EN_PROCESO", "ATRASADO", "REALIZADO", "SUSPENDIDA"];
  const otCounts = await Promise.all(
    OT_ESTADOS.map((e) =>
      supabase.from("ordenes_trabajo").select("id", { count: "exact", head: true }).eq("estado", e)
    )
  );
  const otStats = OT_ESTADOS.map((estado, i) => ({ estado, count: otCounts[i].count ?? 0 }));

  // ── Tipo de trabajo (correctivo/preventivo) y ejecución (propio/contratado) ──
  // Con `count` y `head`: contar en la base en vez de traer las 1.700 órdenes
  // para contarlas acá, que además choca contra el tope de filas.
  const cuantasOT = (arma: (q: ReturnType<typeof consultaOT>) => ReturnType<typeof consultaOT>) =>
    arma(consultaOT());
  function consultaOT() {
    return supabase.from("ordenes_trabajo").select("id", { count: "exact", head: true });
  }

  const [
    conTipo, correctivo, preventivo,
    conQuien, contratado, propio, mixto,
  ] = await Promise.all([
    cuantasOT((q) => q.not("tipo", "is", null).neq("tipo", "")),
    cuantasOT((q) => q.ilike("tipo", "%correctiv%")),
    cuantasOT((q) => q.or("tipo.ilike.%prevent%,tipo.ilike.%program%")),
    cuantasOT((q) => q.not("quien", "is", null).neq("quien", "")),
    cuantasOT((q) => q.ilike("quien", "%contrat%")),
    cuantasOT((q) => q.or("quien.ilike.%propio%,quien.ilike.%interno%")),
    cuantasOT((q) => q.ilike("quien", "%mixto%")),
  ]);

  const tipoTally: Record<string, number> = {
    Correctivo: correctivo.count ?? 0,
    Preventivo: preventivo.count ?? 0,
    Otro: Math.max(0, (conTipo.count ?? 0) - (correctivo.count ?? 0) - (preventivo.count ?? 0)),
  };
  const quienTally: Record<string, number> = {
    Propio: propio.count ?? 0,
    Contratado: contratado.count ?? 0,
    Mixto: mixto.count ?? 0,
    Otro: Math.max(
      0,
      (conQuien.count ?? 0) - (propio.count ?? 0) - (contratado.count ?? 0) - (mixto.count ?? 0)
    ),
  };

  // ── Cuántas órdenes por mes, el último año ──────────────────────────
  const meses = ultimosMeses(new Date(), 12);
  const porMes = await Promise.all(
    meses.map((m) => cuantasOT((q) => q.gte("fecha", m.desde).lt("fecha", m.hasta)))
  );
  const otPorMes = meses.map((m, i) => ({ mes: m.etiqueta, cantidad: porMes[i].count ?? 0 }));
  const otMes = otPorMes[otPorMes.length - 1]?.cantidad ?? 0;
  const mesActual = nombreDelMes(new Date());

  // ── Ventanas de reparación de la semana que viene ───────────────────
  const semanaQueViene = (() => {
    const d = new Date();
    d.setDate(d.getDate() + 7);
    return lunesDe(d);
  })();

  const [{ data: planes }, { data: otPendientes }, { count: avisosSinOT }, { count: osPendientes }] =
    await Promise.all([
      supabase.from("produccion_semanal").select("sector_id, days").eq("week_start", semanaQueViene),
      supabase
        .from("ordenes_trabajo")
        .select("sector_id, requiere_parada_sector")
        .in("estado", ["POR_HACER", "EN_PROCESO", "ATRASADO"])
        .not("sector_id", "is", null),
      supabase
        .from("avisos")
        .select("id", { count: "exact", head: true })
        .is("work_order_id", null)
        .is("ot_asignada", null),
      supabase
        .from("ordenes_servicio")
        .select("id", { count: "exact", head: true })
        .is("fecha_realizacion", null),
    ]);

  const pendientes = otPendientes ?? [];
  const conEmpresa = sectores.map((s) => ({
    id: s.id as string,
    // Los transversales —compresores, equipos móviles— sirven a las dos
    // empresas y forman su propio grupo para la ventana de reparación.
    empresa: empresaDelSector(s.empresas) ?? "Las dos empresas",
  }));

  const ventanas = ventanasDeReparacion(conEmpresa, planes ?? [], pendientes);
  const sectoresParados = [...sectoresAParar(pendientes)];

  const nivel = await nivelMantenimientoDe(supabase, user.id);
  const canEdit = nivel === "edicion" || nivel === "admin";

  return (
    <DashboardClient
      usuario={usuario}
      equipos={equipos ?? []}
      upcoming={upcoming ?? []}
      overdue={overdue ?? []}
      empresas={empresas ?? []}
      sectores={sectores}
      sectoresStatusLog={sectoresStatusLog ?? []}
      recentExecutions={recentExecutions ?? []}
      otStats={otStats}
      tipoTally={tipoTally}
      quienTally={quienTally}
      otPorMes={otPorMes}
      otMes={otMes}
      mesActual={mesActual}
      ventanas={ventanas}
      semanaQueViene={semanaQueViene}
      sectoresParados={sectoresParados}
      avisosSinOT={avisosSinOT ?? 0}
      osPendientes={osPendientes ?? 0}
      canEdit={canEdit}
    />
  );
}
