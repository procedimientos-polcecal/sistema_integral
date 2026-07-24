import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { nivelMantenimientoDe } from "@/lib/mantenimiento/auth";
import DashboardClient from "./DashboardClient";

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
    { data: sectores },
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
    supabase.from("sectores").select("id, nombre, status, empresas(nombre)").order("nombre"),
    supabase.from("sectores_status_log")
      .select("*, sector:sector_id(nombre, empresas(nombre)), changed_by_user:changed_by(nombre, apellido)")
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
  const { data: woMeta } = await supabase
    .from("ordenes_trabajo")
    .select("tipo, quien")
    .range(0, 9999);

  const tipoTally: Record<string, number> = { Correctivo: 0, Preventivo: 0, Otro: 0 };
  const quienTally: Record<string, number> = { Propio: 0, Contratado: 0, Mixto: 0, Otro: 0 };
  for (const w of woMeta ?? []) {
    const t = (w.tipo ?? "").toString().toLowerCase();
    if (t) {
      if (t.includes("correctiv")) tipoTally.Correctivo++;
      else if (t.includes("prevent") || t.includes("program")) tipoTally.Preventivo++;
      else tipoTally.Otro++;
    }
    const q = (w.quien ?? "").toString().toLowerCase();
    if (q) {
      if (q.includes("contrat")) quienTally.Contratado++;
      else if (q.includes("propio") || q.includes("interno")) quienTally.Propio++;
      else if (q.includes("mixto")) quienTally.Mixto++;
      else quienTally.Otro++;
    }
  }

  const nivel = await nivelMantenimientoDe(supabase, user.id);
  const canEdit = nivel === "edicion" || nivel === "admin";

  return (
    <DashboardClient
      usuario={usuario}
      equipos={equipos ?? []}
      upcoming={upcoming ?? []}
      overdue={overdue ?? []}
      empresas={empresas ?? []}
      sectores={sectores ?? []}
      sectoresStatusLog={sectoresStatusLog ?? []}
      recentExecutions={recentExecutions ?? []}
      otStats={otStats}
      tipoTally={tipoTally}
      quienTally={quienTally}
      canEdit={canEdit}
    />
  );
}
