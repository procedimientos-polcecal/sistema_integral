"use client";

import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import Link from "next/link";
import InfoTip from "@/components/InfoTip";
import type { VentanaDeReparacion } from "@/lib/mantenimiento/dashboard";
import { diasDeAtraso } from "@/lib/mantenimiento/alertas";

/**
 * Los gráficos, aparte: `recharts` son ~350 KB y su JS bloqueaba el primer
 * pintado de todo el tablero —indicadores, avisos, listas de atrasos—, que no
 * lo necesitan. `ssr: false` porque miden el contenedor para dibujarse.
 */
const esqueleto = () => <div className="h-full w-full animate-pulse rounded-lg bg-slate-100" />;
const OtsPorMes = dynamic(() => import("./GraficosMantenimiento").then((m) => m.OtsPorMes), { ssr: false, loading: esqueleto });
const EstadoDeEquipos = dynamic(() => import("./GraficosMantenimiento").then((m) => m.EstadoDeEquipos), { ssr: false, loading: esqueleto });
const Criticidad = dynamic(() => import("./GraficosMantenimiento").then((m) => m.Criticidad), { ssr: false, loading: esqueleto });
const EjecucionesPorSemana = dynamic(() => import("./GraficosMantenimiento").then((m) => m.EjecucionesPorSemana), { ssr: false, loading: esqueleto });

// ── Constants ────────────────────────────────────────────────────────────────

// Mismos tokens de estado que usa el resto del sistema (globals.css), no
// colores propios de este dashboard — para que un equipo "en reparación" se
// vea del mismo rojo acá que en cualquier badge del resto de la app.
const STATUS_META: Record<string, { label: string; color: string }> = {
  OPERATIVO:         { label: "Operativo",        color: "var(--status-op)" },
  EN_MANTENIMIENTO:  { label: "En mantenimiento", color: "var(--status-mant)" },
  EN_REPARACION:     { label: "En reparación",    color: "var(--status-rep)" },
  STANDBY:           { label: "Standby",           color: "var(--status-st)" },
  FUERA_DE_SERVICIO: { label: "Fuera de servicio", color: "var(--status-fs)" },
  DADO_DE_BAJA:      { label: "Dado de baja",      color: "var(--status-baja)" },
};

const PLANT_STATUS_META: Record<string, { label: string; color: string; bg: string; border: string }> = {
  ACTIVA:        { label: "Activa",        color: "var(--status-op)",  bg: "#F0FDF4", border: "#BBF7D0" },
  PARADA:        { label: "Parada",        color: "var(--status-rep)", bg: "#FEF2F2", border: "#FECACA" },
  EN_REPARACION: { label: "En reparación", color: "var(--status-st)",  bg: "#FFFBEB", border: "#FDE68A" },
};

const PLANT_STATUS_OPTIONS = [
  { value: "ACTIVA",        label: "Activa" },
  { value: "PARADA",        label: "Parada" },
  { value: "EN_REPARACION", label: "En reparación" },
];

const ROLE_LABEL: Record<string, string> = {
  admin_sistema: "Admin sistema",
  encargado: "Encargado", operario: "Operario",
};

const PLANT_COLORS: Record<string, string> = {
  POLYSAN: "var(--accent)", POLCECAL: "var(--primary)", TRANSVERSAL: "var(--status-mant)",
};

const OT_ESTADO_META: Record<string, { label: string; color: string }> = {
  POR_HACER:  { label: "Por hacer",  color: "var(--text-muted)" },
  EN_PROCESO: { label: "En proceso", color: "var(--status-mant)" },
  ATRASADO:   { label: "Atrasado",   color: "var(--status-rep)" },
  REALIZADO:  { label: "Realizado",  color: "var(--primary)" },
  SUSPENDIDA: { label: "Suspendida", color: "var(--accent)" },
};

const TIPO_COLORS: Record<string, string> = {
  Correctivo: "var(--status-rep)", Preventivo: "var(--primary)", Otro: "var(--text-muted)",
};
const QUIEN_COLORS: Record<string, string> = {
  Propio: "var(--status-mant)", Contratado: "#7E22CE", Mixto: "var(--accent)", Otro: "var(--text-muted)",
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
 * Las órdenes que se pasaron de fecha.
 *
 * Es lo único que avisa que algo quedó colgado, así que va arriba y sólo
 * aparece cuando hay: un panel que dice "cero atrasadas" todos los días enseña
 * a no mirarlo, y el día que diga otra cosa nadie lo va a ver.
 *
 * Agrupadas por sector porque es como se resuelven: las cuatro de Calcinación
 * son un problema de Calcinación, no cuatro problemas sueltos.
 */
function OrdenesAtrasadas({ resumen, hoy }: {
  resumen: {
    total: number;
    urgentes: number;
    atrasadas: any[];
    porSector: { sector: string; cuantas: number }[];
  };
  hoy: string;
}) {
  if (resumen.total === 0) return null;

  return (
    <div className="rounded-xl border border-red-200 bg-red-50/60 p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold text-red-900">
          {resumen.total} orden{resumen.total === 1 ? "" : "es"} de trabajo atrasada
          {resumen.total === 1 ? "" : "s"}
          {resumen.urgentes > 0 && (
            <span className="ml-2 font-normal text-red-700">
              · {resumen.urgentes} de prioridad alta
            </span>
          )}
        </h2>
        <Link
          href="/mantenimiento/ordenes?estado=ATRASADO"
          className="text-xs font-semibold text-red-700 hover:underline"
        >
          Verlas todas →
        </Link>
      </div>

      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-red-800">
        {resumen.porSector.map((s) => (
          <span key={s.sector}>
            <span className="font-semibold">{s.cuantas}</span> {s.sector}
          </span>
        ))}
      </div>

      <ul className="mt-3 space-y-1">
        {resumen.atrasadas.slice(0, 5).map((o: any) => {
          const dias = diasDeAtraso(o, hoy);
          return (
            <li key={o.ot_number} className="flex items-baseline gap-2 text-sm">
              <span className="font-mono text-xs text-red-400">#{o.ot_number}</span>
              <span className="min-w-0 flex-1 truncate text-red-900">
                {o.descripcion ?? o.equipo_raw ?? "—"}
              </span>
              {/* Sin fecha de vencimiento no se sabe hace cuánto: la marcaron
                  a mano en la planilla y no dice desde cuándo. */}
              <span className="shrink-0 text-xs text-red-600">
                {dias === null ? "sin fecha" : `${dias} día${dias === 1 ? "" : "s"}`}
              </span>
            </li>
          );
        })}
      </ul>

      {resumen.total > 5 && (
        <p className="mt-1.5 text-xs text-red-600">y {resumen.total - 5} más.</p>
      )}
    </div>
  );
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
    <div className="card p-5">
      <div className="flex items-baseline justify-between gap-3 mb-3">
        <h2 className="text-sm font-semibold text-slate-700">Ventanas para reparar</h2>
        <Link href="/mantenimiento/produccion" className="text-xs text-[var(--primary)] hover:underline">
          Semana del {desde} →
        </Link>
      </div>

      {ventanas.length === 0 ? (
        <p className="py-4 text-center text-sm text-slate-400">
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

/**
 * Las órdenes del mes y cómo viene el año.
 *
 * El número solo no dice nada —139 puede ser mucho o poco— y la serie sola
 * obliga a buscar el último mes con la vista. Juntos se leen de un vistazo, y
 * por eso la barra del mes en curso va en otro color.
 */
function OrdenesPorMes({ datos, delMes, mes }: {
  datos: { mes: string; cantidad: number }[];
  delMes: number;
  mes: string;
}) {
  return (
    <div className="card p-5">
      <div className="flex flex-col gap-5 md:flex-row">
        <Link
          href="/mantenimiento/ordenes"
          className="flex shrink-0 flex-col justify-center rounded-xl transition-colors hover:bg-slate-50 md:-m-2 md:w-44 md:p-2"
        >
          <div className="text-4xl font-bold text-slate-900">{delMes}</div>
          <div className="mt-1 text-xs text-slate-500">OTs generadas en {mes}</div>
          <div className="mt-1 text-xs text-[var(--primary)]">Ver órdenes →</div>
        </Link>

        <div className="min-w-0 flex-1">
          <p className="mb-2 text-xs font-medium text-slate-400">
            OTs generadas por mes (últimos 12)
          </p>
          <OtsPorMes datos={datos} />
        </div>
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
  otPorMes, otMes, mesActual, ventanas, semanaQueViene, sectoresParados, atrasadas, hoy,
  avisosSinOT, osPendientes, canEdit, esAdmin,
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
  mesActual: string;
  atrasadas: {
    total: number;
    urgentes: number;
    atrasadas: any[];
    porSector: { sector: string; cuantas: number }[];
  };
  hoy: string;
  ventanas: VentanaDeReparacion[];
  semanaQueViene: string;
  sectoresParados: string[];
  avisosSinOT: number;
  osPendientes: number;
  canEdit: boolean;
  esAdmin: boolean;
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
      return { criticalityData: data, criticalityKeys: ["Equipos"], criticalityColors: { Equipos: "var(--primary)" } };
    }
    if (plantFilter !== "TODAS") {
      const plantSectors = sectores.filter((s: any) => empresaDe(s) === plantFilter).map((s: any) => s.nombre);
      // Misma paleta categórica que usa Compras para sus gráficos, extendida
      // con dos tonos más para cuando hay más de 6 sectores en una planta.
      const colors = ["#1E7D34","#E8A020","#2563EB","#DC2626","#7E22CE","#0891B2","#B45309","#0F766E"];
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
    <div className="md:p-6 max-w-6xl mx-auto space-y-5">

      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900 flex items-center gap-2">
            Dashboard
            <InfoTip text="Vista general del estado de las plantas: equipos por estado y criticidad, mantenimientos vencidos y próximos, órdenes de trabajo por estado, y qué trabajos fueron correctivos/preventivos o propios/contratados. Usá los filtros de empresa y sector para acotar." />
          </h1>
          <p className="text-sm text-slate-400 mt-0.5">
            {nombreCompleto(usuario)}
            <span className="mx-2 text-slate-200">·</span>
            <span className="bg-[var(--accent-light)] text-[var(--accent-dark)] text-xs font-semibold px-2 py-0.5 rounded">
              {ROLE_LABEL[usuario?.rol] ?? usuario?.rol}
            </span>
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-1 bg-slate-100 rounded-xl p-1">
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
              className="card px-3 py-2 text-xs font-medium text-slate-700 focus:outline-none focus:ring-2 focus:ring-amber-300">
              <option value="TODOS">Todos los sectores</option>
              {availableSectors.map((s: any) => <option key={s.nombre} value={s.nombre}>{s.nombre}</option>)}
            </select>
          )}
        </div>
      </div>

      <div>
        <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2">Más</h2>
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
          <Acceso href="/mantenimiento/equipos" label="Equipos" />
          <Acceso href="/mantenimiento/avisos" label="Avisos" />
          <Acceso href="/mantenimiento/ordenes" label="Órdenes de trabajo" />
          <Acceso href="/mantenimiento/ordenes-servicio" label="Órdenes de servicio" />
          <Acceso href="/mantenimiento/planificacion" label="Planificación" />
          <Acceso href="/mantenimiento/produccion" label="Producción" />
          <Acceso href="/mantenimiento/historial" label="Historial" />
          {esAdmin && <Acceso href="/mantenimiento/configuracion" label="Configuración" />}
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
                        <span className="font-semibold text-slate-900 text-sm">
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
                        <p className="text-xs text-slate-400 mt-0.5">{empresaDe(sector) === "TRANSVERSAL" ? "Transversal" : empresaDe(sector)}</p>
                      )}
                      {lastChange && (
                        <p className="text-xs text-slate-500 mt-1.5 leading-snug">
                          <span className="font-medium">{nombreCompleto(lastChange.changed_by_user)}</span>
                          {" · "}{new Date(lastChange.changed_at).toLocaleDateString("es-AR", { day:"2-digit", month:"2-digit" })}
                          {lastChange.reason && <> · <span className="italic">“{lastChange.reason}”</span></>}
                        </p>
                      )}
                    </div>
                    {canEdit && (
                      <button onClick={() => openStatusModal(sector)}
                        className="shrink-0 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 transition-colors">
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
                  className="text-xs text-slate-400 hover:text-slate-700 flex items-center gap-1 transition-colors">
                  <svg className={`w-3 h-3 transition-transform ${showLog ? "rotate-90" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                  {showLog ? "Ocultar" : "Ver"} historial de cambios de sector
                </button>
                {showLog && (
                  <div className="mt-2 card overflow-hidden">
                    {sectoresStatusLog.map((log: any, i: number) => {
                      const meta = PLANT_STATUS_META[log.new_status] ?? PLANT_STATUS_META.ACTIVA;
                      return (
                        <div key={log.id} className={`px-4 py-3 text-sm ${i < sectoresStatusLog.length - 1 ? "border-b border-slate-100" : ""}`}>
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-medium text-slate-800">{log.sector?.nombre}</span>
                            <span className="text-xs text-slate-400">{empresaDe(log.sector)}</span>
                            <span className="text-slate-400">→</span>
                            <span className="font-semibold text-xs px-2 py-0.5 rounded-full" style={{ color: meta.color, background: meta.bg }}>
                              {meta.label}
                            </span>
                            <span className="text-xs text-slate-400 ml-auto">
                              {nombreCompleto(log.changed_by_user)} · {new Date(log.changed_at).toLocaleDateString("es-AR", { day:"2-digit", month:"2-digit", year:"numeric", hour:"2-digit", minute:"2-digit" })}
                            </span>
                          </div>
                          {log.reason && <p className="text-xs text-slate-500 mt-0.5 italic">“{log.reason}”</p>}
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
        <KpiCard label="Total equipos"    value={total}           accent="var(--text-primary)" />
        <KpiCard label="Operativos"       value={operativos}      accent="var(--status-op)" sub={`${pctOperativo}% del total`} />
        <KpiCard label="Vencidos"         value={overdue.length}  accent={overdue.length > 0 ? "var(--status-rep)" : "var(--status-op)"} />
        <KpiCard label="Próximos 7 días"  value={upcoming.length} accent="var(--accent)" />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <KpiCard label="Avisos sin OT"      value={avisosSinOT}  accent={avisosSinOT > 0 ? "var(--accent)" : "var(--status-op)"} />
        <KpiCard label="OS sin terminar"    value={osPendientes} accent="var(--status-mant)" />
        <KpiCard
          label="Sectores a parar"
          value={sectoresParados.length}
          accent={sectoresParados.length > 0 ? "var(--status-rep)" : "var(--status-op)"}
          sub={sectoresParados.length > 0 ? nombresDeSectores(sectores, sectoresParados) : undefined}
        />
      </div>

      <OrdenesAtrasadas resumen={atrasadas} hoy={hoy} />

      <VentanasDeReparacion ventanas={ventanas} semana={semanaQueViene} />

      <OrdenesPorMes datos={otPorMes} delMes={otMes} mes={mesActual} />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="card p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-slate-700">Estado de equipos</h2>
            {filterLabel && <span className="text-xs text-slate-400 bg-slate-100 px-2 py-0.5 rounded-full">{filterLabel}</span>}
          </div>
          {statusData.length === 0 ? (
            <div className="h-48 flex items-center justify-center text-sm text-slate-400">Sin datos</div>
          ) : (
            <div className="flex items-center gap-4">
              <div className="w-44 h-44 shrink-0">
                <EstadoDeEquipos datos={statusData} />
              </div>
              <div className="space-y-2 flex-1 min-w-0">
                {statusData.map((d) => (
                  <div key={d.key} className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: d.color }} />
                      <span className="text-xs text-slate-600 truncate">{d.name}</span>
                    </div>
                    <span className="text-xs font-semibold text-slate-900 shrink-0">{d.value}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="card p-5">
          <h2 className="text-sm font-semibold text-slate-700 mb-4">
            {sectorFilter !== "TODOS" ? `Criticidad — ${sectorFilter}` : plantFilter !== "TODAS" ? `Criticidad por sector — ${plantFilter}` : "Criticidad por empresa"}
          </h2>
          <Criticidad datos={criticalityData} claves={criticalityKeys} colores={criticalityColors} />
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
          <h2 className="text-sm font-semibold text-slate-700">
            Órdenes de trabajo por estado
          </h2>
          <div className="flex items-center gap-2 text-xs">
            <span className="text-slate-400">Total: <span className="font-semibold text-slate-700">{otTotal}</span></span>
            <span className="text-slate-200">·</span>
            <span className="text-amber-600 font-semibold">{otPendientes} pendientes</span>
          </div>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
          {otStats.map((s) => {
            const meta = OT_ESTADO_META[s.estado] ?? { label: s.estado, color: "var(--text-muted)" };
            const pct = otTotal > 0 ? Math.round((s.count / otTotal) * 100) : 0;
            return (
              <Link
                key={s.estado}
                href={`/mantenimiento/ordenes?estado=${s.estado}`}
                className="card p-4 relative overflow-hidden block transition hover:-translate-y-0.5 hover:shadow-lg"
              >
                <div className="absolute top-0 left-0 right-0 h-1" style={{ background: meta.color }} />
                <div className="flex items-center gap-2 mb-2">
                  <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: meta.color }} />
                  <span className="text-xs font-medium text-slate-500 truncate">{meta.label}</span>
                </div>
                <div className="text-3xl font-bold text-slate-900">{s.count}</div>
                <div className="text-xs text-slate-400 mt-0.5">{pct}% del total</div>
              </Link>
            );
          })}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <IndicatorGroup title="Tipo de trabajo" tally={tipoTally} colors={TIPO_COLORS} />
        <IndicatorGroup title="Ejecución del trabajo" tally={quienTally} colors={QUIEN_COLORS} />
      </div>

      {executionTrend.length > 0 && (
        <div className="card p-5">
          <h2 className="text-sm font-semibold text-slate-700 mb-4">
            Ejecuciones por semana (últimas 8 semanas)
          </h2>
          <EjecucionesPorSemana datos={executionTrend} />
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
          <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
            Próximos 7 días — {upcoming.length}
          </h2>
        </div>
        {upcoming.length > 0 ? (
          <div className="card overflow-hidden">
            {upcoming.map((s: any, i: number) => <ScheduleRow key={s.id} schedule={s} last={i === upcoming.length - 1} />)}
          </div>
        ) : (
          <div className="empty-state">
            Sin mantenimientos programados esta semana.
          </div>
        )}
      </section>

      {statusModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl space-y-4">
            <h2 className="text-base font-bold text-slate-900">
              Cambiar estado — {statusModal.sector.nombre}
            </h2>

            <div className="space-y-1">
              <label className="block text-xs font-medium text-slate-600">Nuevo estado</label>
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
                <label className="block text-xs font-medium text-slate-600">
                  Justificación <span className="text-red-500">*</span>
                  <span className="font-normal text-slate-400 ml-1">— requerida para este estado</span>
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
              <p className="text-xs text-slate-400 bg-slate-50 rounded-lg px-3 py-2">
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
                className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors">
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

function Acceso({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className="card flex items-center justify-between px-4 py-3 text-sm font-medium text-slate-700 transition hover:-translate-y-0.5 hover:shadow-lg"
    >
      {label}
      <span className="text-slate-400">→</span>
    </Link>
  );
}

function IndicatorGroup({ title, tally, colors }: {
  title: string; tally: Record<string, number>; colors: Record<string, string>;
}) {
  const entries = Object.entries(tally).filter(([, v]) => v > 0);
  const total = entries.reduce((a, [, v]) => a + v, 0);
  return (
    <div className="card p-5">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-semibold text-slate-700">{title}</h2>
        <span className="text-xs text-slate-400">Total: <span className="font-semibold text-slate-700">{total}</span></span>
      </div>
      {total === 0 ? (
        <div className="h-24 flex items-center justify-center text-sm text-slate-400">Sin datos</div>
      ) : (
        <div className="space-y-3">
          {entries.map(([label, value]) => {
            const color = colors[label] ?? "var(--text-muted)";
            const pct = Math.round((value / total) * 100);
            return (
              <div key={label}>
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full" style={{ background: color }} />
                    <span className="text-xs font-medium text-slate-600">{label}</span>
                  </div>
                  <span className="text-xs text-slate-500">
                    <span className="font-bold text-slate-900">{value}</span> · {pct}%
                  </span>
                </div>
                <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
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
    <div className="card p-4 relative overflow-hidden">
      <div className="absolute top-0 left-0 right-0 h-0.5" style={{ background: accent }} />
      <div className="text-3xl font-bold text-slate-900">{value}</div>
      <div className="text-xs text-slate-500 mt-1">{label}</div>
      {sub && <div className="text-xs mt-0.5" style={{ color: accent }}>{sub}</div>}
    </div>
  );
}

function ScheduleRow({ schedule, overdue, last }: { schedule: any; overdue?: boolean; last?: boolean }) {
  return (
    <div className={`flex items-center justify-between gap-4 px-4 py-3 ${!last ? `border-b ${overdue ? "border-red-100" : "border-slate-100"}` : ""} ${overdue ? "bg-red-50" : "bg-white"}`}>
      <div className="min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-mono text-xs text-slate-400 bg-slate-50 border border-slate-200 px-1.5 py-0.5 rounded">
            {schedule.equipos?.code}
          </span>
          <span className="text-sm font-medium text-slate-900">{schedule.equipos?.name}</span>
          <span className="text-xs text-slate-400">{schedule.maintenance_type}</span>
        </div>
        {schedule.assigned_user && (
          <p className="text-xs text-slate-400 mt-0.5">{nombreCompleto(schedule.assigned_user)}</p>
        )}
      </div>
      <div className={`text-sm font-semibold shrink-0 ${overdue ? "text-red-600" : "text-slate-700"}`}>
        {schedule.next_date ? new Date(schedule.next_date + "T00:00:00").toLocaleDateString("es-AR") : "—"}
      </div>
    </div>
  );
}
