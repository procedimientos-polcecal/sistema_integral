"use client";

import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import {
  PieChart, Pie, Cell, Tooltip, ResponsiveContainer,
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Legend,
} from "recharts";
import Link from "next/link";
import InfoTip from "@/components/InfoTip";
import type { VentanaDeReparacion } from "@/lib/mantenimiento/dashboard";

// ── Constants ────────────────────────────────────────────────────────────────

const STATUS_META: Record<string, { label: string; color: string }> = {
  OPERATIVO:         { label: "Operativo",        color: "#22C55E" },
  EN_MANTENIMIENTO:  { label: "En mantenimiento", color: "#3B82F6" },
  EN_REPARACION:     { label: "En reparación",    color: "#EF4444" },
  STANDBY:           { label: "Standby",           color: "#F59E0B" },
  FUERA_DE_SERVICIO: { label: "Fuera de servicio", color: "#94A3B8" },
  DADO_DE_BAJA:      { label: "Dado de baja",      color: "#64748B" },
};

const PLANT_STATUS_META: Record<string, { label: string; color: string; bg: string; border: string }> = {
  ACTIVA:        { label: "Activa",        color: "#16A34A", bg: "#F0FDF4", border: "#BBF7D0" },
  PARADA:        { label: "Parada",        color: "#DC2626", bg: "#FEF2F2", border: "#FECACA" },
  EN_REPARACION: { label: "En reparación", color: "#D97706", bg: "#FFFBEB", border: "#FDE68A" },
};

const PLANT_STATUS_OPTIONS = [
  { value: "ACTIVA",        label: "Activa" },
  { value: "PARADA",        label: "Parada" },
  { value: "EN_REPARACION", label: "En reparación" },
];

const ROLE_LABEL: Record<string, string> = {
  admin_sistema: "Admin sistema", admin: "Admin",
  encargado: "Encargado", operario: "Operario",
};

const PLANT_COLORS: Record<string, string> = {
  POLYSAN: "#F59E0B", POLCECAL: "#22C55E", TRANSVERSAL: "#3B82F6",
};

const OT_ESTADO_META: Record<string, { label: string; color: string }> = {
  POR_HACER:  { label: "Por hacer",  color: "#94A3B8" },
  EN_PROCESO: { label: "En proceso", color: "#3B82F6" },
  ATRASADO:   { label: "Atrasado",   color: "#EF4444" },
  REALIZADO:  { label: "Realizado",  color: "#22C55E" },
  SUSPENDIDA: { label: "Suspendida", color: "#F59E0B" },
};

const TIPO_COLORS: Record<string, string> = {
  Correctivo: "#EF4444", Preventivo: "#22C55E", Otro: "#94A3B8",
};
const QUIEN_COLORS: Record<string, string> = {
  Propio: "#3B82F6", Contratado: "#8B5CF6", Mixto: "#F59E0B", Otro: "#94A3B8",
};

/** Los nombres de esos sectores, para decir cuáles hay que parar. */
function nombresDeSectores(sectores: any[], ids: string[]): string {
  const nombres = ids
    .map((id) => sectores.find((s) => s.id === id)?.nombre)
    .filter(Boolean);
  return nombres.length <= 3
    ? nombres.join(", ")
    : `${nombres.slice(0, 3).join(", ")} y ${nombres.length - 3} más`;
}

/**
 * Dónde se puede reparar la semana que viene sin frenar el despacho.
 *
 * Es lo que vuelve útil la planificación de producción: los días en que una
 * planta entera está libre son la ventana para intervenir.
 */
function VentanasDeReparacion({ ventanas, semana }: {
  ventanas: VentanaDeReparacion[];
  semana: string;
}) {
  const [a, m, d] = semana.split("-");
  const desde = `${d}/${m}/${a}`;

  return (
    <div className="bg-white rounded-2xl border border-gray-200 p-5">
      <div className="flex items-baseline justify-between gap-3 mb-3">
        <h2 className="text-sm font-semibold text-gray-700">Ventanas para reparar</h2>
        <Link href="/mantenimiento/produccion" className="text-xs text-blue-500 hover:underline">
          Semana del {desde} →
        </Link>
      </div>

      {ventanas.length === 0 ? (
        <p className="py-4 text-center text-sm text-gray-400">
          Ninguna planta queda libre un día entero la semana que viene, o todavía no se cargó
          la producción.
        </p>
      ) : (
        <div className="space-y-2">
          {ventanas.map((v) => (
            <div key={v.empresa} className="rounded-xl border border-emerald-100 bg-emerald-50/60 px-4 py-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="text-sm font-semibold text-emerald-900">{v.empresa}</span>
                <span className="text-xs text-emerald-800">{v.dias.join(", ")}</span>
              </div>
              {v.pendientes > 0 && (
                <p className="mt-0.5 text-xs text-amber-700">
                  {v.pendientes} pendiente{v.pendientes === 1 ? "" : "s"} de mantenimiento
                  {v.aParar > 0 && `, ${v.aParar} que exige${v.aParar === 1 ? "" : "n"} parar el sector`}.
                </p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Cuántas órdenes de trabajo se abrieron cada mes del último año. */
function OrdenesPorMes({ datos }: { datos: { mes: string; cantidad: number }[] }) {
  const maximo = Math.max(1, ...datos.map((d) => d.cantidad));

  return (
    <div className="bg-white rounded-2xl border border-gray-200 p-5">
      <h2 className="text-sm font-semibold text-gray-700 mb-4">Órdenes de trabajo por mes</h2>
      <div className="flex items-end gap-1.5 h-36">
        {datos.map((d) => (
          <div key={d.mes} className="flex-1 flex flex-col items-center gap-1 min-w-0">
            <span className="text-[10px] text-gray-400">{d.cantidad || ""}</span>
            <div
              className="w-full rounded-t bg-slate-800"
              style={{ height: `${Math.max(2, (d.cantidad / maximo) * 100)}%` }}
              title={`${d.mes}: ${d.cantidad}`}
            />
            <span className="text-[10px] text-gray-400 truncate w-full text-center">{d.mes}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function nombreCompleto(u: { nombre?: string; apellido?: string } | null | undefined): string {
  if (!u) return "—";
  return `${u.nombre ?? ""} ${u.apellido ?? ""}`.trim() || "—";
}

function empresaDe(s: any): string {
  return s?.empresas?.nombre ?? "TRANSVERSAL";
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function DashboardClient({
  usuario, equipos, upcoming, overdue,
  empresas, sectores, sectoresStatusLog, recentExecutions, otStats, tipoTally, quienTally,
  otPorMes, otMes, ventanas, semanaQueViene, sectoresParados, avisosSinOT, osPendientes, canEdit,
}: {
  usuario: any;
  equipos: any[];
  upcoming: any[];
  overdue: any[];
  empresas: any[];
  sectores: any[];
  sectoresStatusLog: any[];
  recentExecutions: any[];
  otStats: { estado: string; count: number }[];
  tipoTally: Record<string, number>;
  quienTally: Record<string, number>;
  otPorMes: { mes: string; cantidad: number }[];
  otMes: number;
  ventanas: VentanaDeReparacion[];
  semanaQueViene: string;
  sectoresParados: string[];
  avisosSinOT: number;
  osPendientes: number;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [plantFilter, setPlantFilter] = useState("TODAS");
  const [sectorFilter, setSectorFilter] = useState("TODOS");

  const [statusModal, setStatusModal] = useState<{ sector: any } | null>(null);
  const [newStatus, setNewStatus] = useState("");
  const [reason, setReason] = useState("");
  const [statusSaving, setStatusSaving] = useState(false);
  const [statusError, setStatusError] = useState("");
  const [showLog, setShowLog] = useState(false);

  const hayTransversales = useMemo(() => sectores.some((s: any) => !s.empresas), [sectores]);
  const plantChips = ["TODAS", ...empresas.map((p: any) => p.nombre), ...(hayTransversales ? ["TRANSVERSAL"] : [])];

  const availableSectors = useMemo(() =>
    plantFilter === "TODAS" ? sectores : sectores.filter((s: any) => empresaDe(s) === plantFilter),
    [sectores, plantFilter]
  );

  function handlePlantChange(plant: string) {
    setPlantFilter(plant);
    setSectorFilter("TODOS");
  }

  const filteredEquipment = useMemo(() => equipos.filter((e: any) => {
    if (plantFilter !== "TODAS" && empresaDe(e.sectores) !== plantFilter) return false;
    if (sectorFilter !== "TODOS" && e.sectores?.nombre !== sectorFilter) return false;
    return true;
  }), [equipos, plantFilter, sectorFilter]);

  const statusData = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const e of filteredEquipment) counts[e.status] = (counts[e.status] ?? 0) + 1;
    return Object.entries(STATUS_META)
      .map(([key, meta]) => ({ name: meta.label, value: counts[key] ?? 0, color: meta.color, key }))
      .filter((d) => d.value > 0);
  }, [filteredEquipment]);

  const { criticalityData, criticalityKeys, criticalityColors } = useMemo(() => {
    if (sectorFilter !== "TODOS") {
      const data = ["ALTA", "MEDIA", "BAJA"].map((crit) => ({
        criticidad: crit,
        Equipos: filteredEquipment.filter((e) => e.criticality === crit).length,
      }));
      return { criticalityData: data, criticalityKeys: ["Equipos"], criticalityColors: { Equipos: "#3B82F6" } };
    }
    if (plantFilter !== "TODAS") {
      const plantSectors = sectores.filter((s: any) => empresaDe(s) === plantFilter).map((s: any) => s.nombre);
      const colors = ["#3B82F6","#8B5CF6","#EC4899","#14B8A6","#F97316","#84CC16","#06B6D4","#A78BFA"];
      const colorMap: Record<string, string> = {};
      plantSectors.forEach((s: string, i: number) => { colorMap[s] = colors[i % colors.length]; });
      const data = ["ALTA", "MEDIA", "BAJA"].map((crit) => {
        const row: any = { criticidad: crit };
        for (const s of plantSectors) {
          row[s] = equipos.filter((e) => e.criticality === crit && e.sectores?.nombre === s && empresaDe(e.sectores) === plantFilter).length;
        }
        return row;
      });
      return { criticalityData: data, criticalityKeys: plantSectors, criticalityColors: colorMap };
    }
    const plantNames = empresas.map((p: any) => p.nombre);
    const data = ["ALTA", "MEDIA", "BAJA"].map((crit) => {
      const row: any = { criticidad: crit };
      for (const p of plantNames) row[p] = equipos.filter((e) => e.criticality === crit && empresaDe(e.sectores) === p).length;
      return row;
    });
    return { criticalityData: data, criticalityKeys: plantNames, criticalityColors: PLANT_COLORS };
  }, [equipos, filteredEquipment, plantFilter, sectorFilter, empresas, sectores]);

  const executionTrend = useMemo(() => {
    const weeks: Record<string, number> = {};
    for (const ex of recentExecutions) {
      if (!ex.executed_at) continue;
      const d = new Date(ex.executed_at);
      const monday = new Date(d);
      monday.setDate(d.getDate() - ((d.getDay() + 6) % 7));
      const key = monday.toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit" });
      weeks[key] = (weeks[key] ?? 0) + 1;
    }
    return Object.entries(weeks).slice(-8).map(([semana, cantidad]) => ({ semana, cantidad }));
  }, [recentExecutions]);

  const otTotal = useMemo(() => otStats.reduce((a, s) => a + s.count, 0), [otStats]);
  const otPendientes = useMemo(() =>
    otStats.filter((s) => ["POR_HACER", "EN_PROCESO", "ATRASADO"].includes(s.estado))
      .reduce((a, s) => a + s.count, 0),
    [otStats]
  );

  const total = filteredEquipment.length;
  const operativos = filteredEquipment.filter((e) => e.status === "OPERATIVO").length;
  const pctOperativo = total > 0 ? Math.round((operativos / total) * 100) : 0;
  const filterLabel = sectorFilter !== "TODOS" ? sectorFilter : plantFilter !== "TODAS" ? plantFilter : null;

  function openStatusModal(sector: any) {
    setStatusModal({ sector });
    setNewStatus(sector.status ?? "ACTIVA");
    setReason("");
    setStatusError("");
  }

  const requiresReason = ["PARADA", "EN_REPARACION"].includes(newStatus);

  async function saveStatus() {
    if (requiresReason && !reason.trim()) {
      setStatusError("Ingresá una justificación para este cambio.");
      return;
    }
    setStatusSaving(true);
    setStatusError("");
    const res = await fetch("/api/mantenimiento/sectores/status", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sector_id: statusModal!.sector.id, new_status: newStatus, reason }),
    });
    const data = await res.json();
    if (!res.ok) { setStatusError(data.error ?? "Error al actualizar"); setStatusSaving(false); return; }
    setStatusSaving(false);
    setStatusModal(null);
    router.refresh();
  }

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto space-y-5">

      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-gray-900 flex items-center gap-2">
            Dashboard
            <InfoTip text="Vista general del estado de las plantas: equipos por estado y criticidad, mantenimientos vencidos y próximos, órdenes de trabajo por estado, y qué trabajos fueron correctivos/preventivos o propios/contratados. Usá los filtros de empresa y sector para acotar." />
          </h1>
          <p className="text-sm text-gray-400 mt-0.5">
            {nombreCompleto(usuario)}
            <span className="mx-2 text-gray-200">·</span>
            <span className="bg-amber-100 text-amber-700 text-xs font-semibold px-2 py-0.5 rounded">
              {ROLE_LABEL[usuario?.rol] ?? usuario?.rol}
            </span>
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-1 bg-gray-100 rounded-xl p-1">
            {plantChips.map((p) => (
              <button key={p} onClick={() => handlePlantChange(p)}
                className="px-3 py-1.5 rounded-lg text-xs font-semibold transition-all"
                style={{ background: plantFilter === p ? (PLANT_COLORS[p] ?? "#0F172A") : "transparent", color: plantFilter === p ? "#fff" : "#64748B" }}>
                {p === "TRANSVERSAL" ? "Transversal" : p}
              </button>
            ))}
          </div>
          {plantFilter !== "TODAS" && availableSectors.length > 0 && (
            <select value={sectorFilter} onChange={(e) => setSectorFilter(e.target.value)}
              className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-medium text-gray-700 focus:outline-none focus:ring-2 focus:ring-amber-300">
              <option value="TODOS">Todos los sectores</option>
              {availableSectors.map((s: any) => <option key={s.nombre} value={s.nombre}>{s.nombre}</option>)}
            </select>
          )}
        </div>
      </div>

      {(() => {
        const aParar = new Set(sectoresParados);
        const visibleSectors = plantFilter === "TODAS"
          ? sectores
          : sectores.filter((s: any) => empresaDe(s) === plantFilter);
        return (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {visibleSectors.map((sector: any) => {
                const meta = PLANT_STATUS_META[sector.status ?? "ACTIVA"] ?? PLANT_STATUS_META.ACTIVA;
                const lastChange = sectoresStatusLog.find((l: any) => l.sector_id === sector.id);
                return (
                  <div key={sector.id} className="rounded-xl border p-4 flex items-start justify-between gap-3"
                    style={{ background: meta.bg, borderColor: meta.border }}>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="w-2 h-2 rounded-full shrink-0" style={{ background: meta.color }} />
                        <span className="font-semibold text-gray-900 text-sm">
                          {sector.nombre}
                        </span>
                        <span className="text-xs font-semibold px-2 py-0.5 rounded-full border"
                          style={{ color: meta.color, borderColor: meta.border, background: "white" }}>
                          {meta.label}
                        </span>
                        {/* Hay una OT pendiente que necesita el sector parado. */}
                        {aParar.has(sector.id) && (
                          <span
                            className="text-[10px] font-bold px-1.5 py-0.5 rounded-full border border-red-200 bg-red-50 text-red-600"
                            title="Hay una OT pendiente que requiere parar este sector"
                          >Parar</span>
                        )}
                      </div>
                      {plantFilter === "TODAS" && (
                        <p className="text-xs text-gray-400 mt-0.5">{empresaDe(sector) === "TRANSVERSAL" ? "Transversal" : empresaDe(sector)}</p>
                      )}
                      {lastChange && (
                        <p className="text-xs text-gray-500 mt-1.5 leading-snug">
                          <span className="font-medium">{nombreCompleto(lastChange.changed_by_user)}</span>
                          {" · "}{new Date(lastChange.changed_at).toLocaleDateString("es-AR", { day:"2-digit", month:"2-digit" })}
                          {lastChange.reason && <> · <span className="italic">"{lastChange.reason}"</span></>}
                        </p>
                      )}
                    </div>
                    {canEdit && (
                      <button onClick={() => openStatusModal(sector)}
                        className="shrink-0 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 transition-colors">
                        Cambiar estado
                      </button>
                    )}
                  </div>
                );
              })}
            </div>

            {sectoresStatusLog.length > 0 && (
              <div>
                <button onClick={() => setShowLog((v) => !v)}
                  className="text-xs text-gray-400 hover:text-gray-700 flex items-center gap-1 transition-colors">
                  <svg className={`w-3 h-3 transition-transform ${showLog ? "rotate-90" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                  {showLog ? "Ocultar" : "Ver"} historial de cambios de sector
                </button>
                {showLog && (
                  <div className="mt-2 rounded-xl border border-gray-200 bg-white overflow-hidden">
                    {sectoresStatusLog.map((log: any, i: number) => {
                      const meta = PLANT_STATUS_META[log.new_status] ?? PLANT_STATUS_META.ACTIVA;
                      return (
                        <div key={log.id} className={`px-4 py-3 text-sm ${i < sectoresStatusLog.length - 1 ? "border-b border-gray-100" : ""}`}>
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-medium text-gray-800">{log.sector?.nombre}</span>
                            <span className="text-xs text-gray-400">{empresaDe(log.sector)}</span>
                            <span className="text-gray-400">→</span>
                            <span className="font-semibold text-xs px-2 py-0.5 rounded-full" style={{ color: meta.color, background: meta.bg }}>
                              {meta.label}
                            </span>
                            <span className="text-xs text-gray-400 ml-auto">
                              {nombreCompleto(log.changed_by_user)} · {new Date(log.changed_at).toLocaleDateString("es-AR", { day:"2-digit", month:"2-digit", year:"numeric", hour:"2-digit", minute:"2-digit" })}
                            </span>
                          </div>
                          {log.reason && <p className="text-xs text-gray-500 mt-0.5 italic">"{log.reason}"</p>}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </>
        );
      })()}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard label="Total equipos"    value={total}           accent="#0F172A" />
        <KpiCard label="Operativos"       value={operativos}      accent="#22C55E" sub={`${pctOperativo}% del total`} />
        <KpiCard label="Vencidos"         value={overdue.length}  accent={overdue.length > 0 ? "#EF4444" : "#22C55E"} />
        <KpiCard label="Próximos 7 días"  value={upcoming.length} accent="#F59E0B" />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard label="OT este mes"        value={otMes}        accent="#0F172A" />
        <KpiCard label="Avisos sin OT"      value={avisosSinOT}  accent={avisosSinOT > 0 ? "#F59E0B" : "#22C55E"} />
        <KpiCard label="OS sin terminar"    value={osPendientes} accent="#3B82F6" />
        <KpiCard
          label="Sectores a parar"
          value={sectoresParados.length}
          accent={sectoresParados.length > 0 ? "#EF4444" : "#22C55E"}
          sub={sectoresParados.length > 0 ? nombresDeSectores(sectores, sectoresParados) : undefined}
        />
      </div>

      <VentanasDeReparacion ventanas={ventanas} semana={semanaQueViene} />

      <OrdenesPorMes datos={otPorMes} />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-white rounded-2xl border border-gray-200 p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-gray-700">Estado de equipos</h2>
            {filterLabel && <span className="text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">{filterLabel}</span>}
          </div>
          {statusData.length === 0 ? (
            <div className="h-48 flex items-center justify-center text-sm text-gray-400">Sin datos</div>
          ) : (
            <div className="flex items-center gap-4">
              <div className="w-44 h-44 shrink-0">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={statusData} cx="50%" cy="50%" innerRadius={44} outerRadius={70} paddingAngle={2} dataKey="value" strokeWidth={0}>
                      {statusData.map((d) => <Cell key={d.key} fill={d.color} />)}
                    </Pie>
                    <Tooltip formatter={(val: any, name: any) => [`${val} equipos`, name]}
                      contentStyle={{ borderRadius: 8, fontSize: 12, border: "1px solid #E2E8F0" }} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="space-y-2 flex-1 min-w-0">
                {statusData.map((d) => (
                  <div key={d.key} className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: d.color }} />
                      <span className="text-xs text-gray-600 truncate">{d.name}</span>
                    </div>
                    <span className="text-xs font-semibold text-gray-900 shrink-0">{d.value}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="bg-white rounded-2xl border border-gray-200 p-5">
          <h2 className="text-sm font-semibold text-gray-700 mb-4">
            {sectorFilter !== "TODOS" ? `Criticidad — ${sectorFilter}` : plantFilter !== "TODAS" ? `Criticidad por sector — ${plantFilter}` : "Criticidad por empresa"}
          </h2>
          <ResponsiveContainer width="100%" height={176}>
            <BarChart data={criticalityData} barSize={18} barCategoryGap="35%">
              <CartesianGrid strokeDasharray="3 3" stroke="#F1F5F9" vertical={false} />
              <XAxis dataKey="criticidad" tick={{ fontSize: 11, fill: "#94A3B8" }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 11, fill: "#94A3B8" }} axisLine={false} tickLine={false} allowDecimals={false} />
              <Tooltip contentStyle={{ borderRadius: 8, fontSize: 12, border: "1px solid #E2E8F0" }} cursor={{ fill: "#F8FAFC" }} />
              {criticalityKeys.length > 1 && <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11 }} />}
              {criticalityKeys.map((key) => <Bar key={key} dataKey={key} fill={criticalityColors[key] ?? "#94A3B8"} radius={[4,4,0,0]} />)}
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
          <h2 className="text-sm font-semibold text-gray-700">
            Órdenes de trabajo por estado
          </h2>
          <div className="flex items-center gap-2 text-xs">
            <span className="text-gray-400">Total: <span className="font-semibold text-gray-700">{otTotal}</span></span>
            <span className="text-gray-200">·</span>
            <span className="text-amber-600 font-semibold">{otPendientes} pendientes</span>
          </div>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
          {otStats.map((s) => {
            const meta = OT_ESTADO_META[s.estado] ?? { label: s.estado, color: "#94A3B8" };
            const pct = otTotal > 0 ? Math.round((s.count / otTotal) * 100) : 0;
            return (
              <div key={s.estado} className="bg-white rounded-xl border border-gray-200 p-4 relative overflow-hidden">
                <div className="absolute top-0 left-0 right-0 h-1" style={{ background: meta.color }} />
                <div className="flex items-center gap-2 mb-2">
                  <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: meta.color }} />
                  <span className="text-xs font-medium text-gray-500 truncate">{meta.label}</span>
                </div>
                <div className="text-3xl font-bold text-gray-900">{s.count}</div>
                <div className="text-xs text-gray-400 mt-0.5">{pct}% del total</div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <IndicatorGroup title="Tipo de trabajo" tally={tipoTally} colors={TIPO_COLORS} />
        <IndicatorGroup title="Ejecución del trabajo" tally={quienTally} colors={QUIEN_COLORS} />
      </div>

      {executionTrend.length > 0 && (
        <div className="bg-white rounded-2xl border border-gray-200 p-5">
          <h2 className="text-sm font-semibold text-gray-700 mb-4">
            Ejecuciones por semana (últimas 8 semanas)
          </h2>
          <ResponsiveContainer width="100%" height={150}>
            <BarChart data={executionTrend} barSize={28}>
              <CartesianGrid strokeDasharray="3 3" stroke="#F1F5F9" vertical={false} />
              <XAxis dataKey="semana" tick={{ fontSize: 11, fill: "#94A3B8" }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 11, fill: "#94A3B8" }} axisLine={false} tickLine={false} allowDecimals={false} />
              <Tooltip contentStyle={{ borderRadius: 8, fontSize: 12, border: "1px solid #E2E8F0" }} formatter={(v: any) => [`${v} ejecuciones`]} cursor={{ fill: "#F8FAFC" }} />
              <Bar dataKey="cantidad" fill="#3B82F6" radius={[4,4,0,0]} name="Ejecuciones" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {overdue.length > 0 && (
        <section>
          <div className="flex items-center gap-2 mb-3">
            <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
            <h2 className="text-xs font-semibold text-red-600 uppercase tracking-wider">
              Vencidos — {overdue.length}
            </h2>
          </div>
          <div className="rounded-xl border border-red-100 overflow-hidden bg-white">
            {overdue.map((s: any, i: number) => <ScheduleRow key={s.id} schedule={s} overdue last={i === overdue.length - 1} />)}
          </div>
        </section>
      )}

      <section>
        <div className="flex items-center gap-2 mb-3">
          <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
            Próximos 7 días — {upcoming.length}
          </h2>
        </div>
        {upcoming.length > 0 ? (
          <div className="rounded-xl border border-gray-200 overflow-hidden bg-white">
            {upcoming.map((s: any, i: number) => <ScheduleRow key={s.id} schedule={s} last={i === upcoming.length - 1} />)}
          </div>
        ) : (
          <div className="rounded-xl border border-dashed border-gray-200 py-8 text-center">
            <p className="text-sm text-gray-400">Sin mantenimientos programados esta semana.</p>
          </div>
        )}
      </section>

      {statusModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl space-y-4">
            <h2 className="text-base font-bold text-gray-900">
              Cambiar estado — {statusModal.sector.nombre}
            </h2>

            <div className="space-y-1">
              <label className="block text-xs font-medium text-gray-600">Nuevo estado</label>
              <div className="grid grid-cols-3 gap-2">
                {PLANT_STATUS_OPTIONS.map((opt) => {
                  const meta = PLANT_STATUS_META[opt.value];
                  const selected = newStatus === opt.value;
                  return (
                    <button key={opt.value} onClick={() => { setNewStatus(opt.value); setStatusError(""); }}
                      className="rounded-xl border-2 px-3 py-2.5 text-xs font-semibold text-center transition-all"
                      style={{
                        borderColor: selected ? meta.color : "#E2E8F0",
                        background: selected ? meta.bg : "#fff",
                        color: selected ? meta.color : "#64748B",
                      }}>
                      {opt.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {requiresReason && (
              <div className="space-y-1">
                <label className="block text-xs font-medium text-gray-600">
                  Justificación <span className="text-red-500">*</span>
                  <span className="font-normal text-gray-400 ml-1">— requerida para este estado</span>
                </label>
                <textarea
                  value={reason}
                  onChange={(e) => { setReason(e.target.value); setStatusError(""); }}
                  rows={3}
                  className="input resize-none w-full"
                  placeholder="Ej: Paro por mantenimiento programado de caldera principal..."
                />
              </div>
            )}

            {newStatus === statusModal.sector.status && (
              <p className="text-xs text-gray-400 bg-gray-50 rounded-lg px-3 py-2">
                El sector ya se encuentra en este estado.
              </p>
            )}

            {statusError && <p className="text-sm text-red-600">{statusError}</p>}

            <div className="flex gap-2 pt-1">
              <button
                onClick={saveStatus}
                disabled={statusSaving || newStatus === statusModal.sector.status}
                className="rounded-lg btn-primary disabled:opacity-50"
              >
                {statusSaving ? "Guardando..." : "Confirmar cambio"}
              </button>
              <button onClick={() => setStatusModal(null)}
                className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors">
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function IndicatorGroup({ title, tally, colors }: {
  title: string; tally: Record<string, number>; colors: Record<string, string>;
}) {
  const entries = Object.entries(tally).filter(([, v]) => v > 0);
  const total = entries.reduce((a, [, v]) => a + v, 0);
  return (
    <div className="bg-white rounded-2xl border border-gray-200 p-5">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-semibold text-gray-700">{title}</h2>
        <span className="text-xs text-gray-400">Total: <span className="font-semibold text-gray-700">{total}</span></span>
      </div>
      {total === 0 ? (
        <div className="h-24 flex items-center justify-center text-sm text-gray-400">Sin datos</div>
      ) : (
        <div className="space-y-3">
          {entries.map(([label, value]) => {
            const color = colors[label] ?? "#94A3B8";
            const pct = Math.round((value / total) * 100);
            return (
              <div key={label}>
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full" style={{ background: color }} />
                    <span className="text-xs font-medium text-gray-600">{label}</span>
                  </div>
                  <span className="text-xs text-gray-500">
                    <span className="font-bold text-gray-900">{value}</span> · {pct}%
                  </span>
                </div>
                <div className="h-2 rounded-full bg-gray-100 overflow-hidden">
                  <div className="h-full rounded-full" style={{ width: `${pct}%`, background: color }} />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function KpiCard({ label, value, accent, sub }: { label: string; value: number; accent: string; sub?: string }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4 relative overflow-hidden">
      <div className="absolute top-0 left-0 right-0 h-0.5" style={{ background: accent }} />
      <div className="text-3xl font-bold text-gray-900">{value}</div>
      <div className="text-xs text-gray-500 mt-1">{label}</div>
      {sub && <div className="text-xs mt-0.5" style={{ color: accent }}>{sub}</div>}
    </div>
  );
}

function ScheduleRow({ schedule, overdue, last }: { schedule: any; overdue?: boolean; last?: boolean }) {
  return (
    <div className={`flex items-center justify-between gap-4 px-4 py-3 ${!last ? `border-b ${overdue ? "border-red-100" : "border-gray-100"}` : ""} ${overdue ? "bg-red-50" : "bg-white"}`}>
      <div className="min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-mono text-xs text-gray-400 bg-gray-50 border border-gray-200 px-1.5 py-0.5 rounded">
            {schedule.equipos?.code}
          </span>
          <span className="text-sm font-medium text-gray-900">{schedule.equipos?.name}</span>
          <span className="text-xs text-gray-400">{schedule.maintenance_type}</span>
        </div>
        {schedule.assigned_user && (
          <p className="text-xs text-gray-400 mt-0.5">{nombreCompleto(schedule.assigned_user)}</p>
        )}
      </div>
      <div className={`text-sm font-semibold shrink-0 ${overdue ? "text-red-600" : "text-gray-700"}`}>
        {schedule.next_date ? new Date(schedule.next_date + "T00:00:00").toLocaleDateString("es-AR") : "—"}
      </div>
    </div>
  );
}
