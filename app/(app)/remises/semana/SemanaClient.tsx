"use client";

import { useEffect, useMemo, useState } from "react";
import InfoTip from "@/components/InfoTip";
import { hoyEnArgentina, semanaDe } from "@/lib/core/fechas";
import { useCargar } from "@/lib/core/useCargar";

const DAY_NAMES = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];

/**
 * La semana se armaba con getters locales y se serializaba con `toISOString()`,
 * que convierte a UTC: desde las 21:00 de Argentina la semana entera salia
 * corrida un dia. La cuenta ahora es sobre textos "YYYY-MM-DD", que no tienen
 * huso — ver `lib/core/fechas.ts`.
 */
const getWeekDates = (offset: number) => semanaDe(hoyEnArgentina(), offset);

function fmt(d: string): string {
  const [y, m, dd] = d.split("-");
  return `${+dd}/${m}/${y}`;
}

export default function SemanaClient({ turnos }: { turnos: any[] }) {
  const [turnoId, setTurnoId] = useState(turnos[0]?.id ?? "");
  const [offset, setOffset] = useState(0);
  const dates = useMemo(() => getWeekDates(offset), [offset]);
  const today = hoyEnArgentina();
  const [selectedDate, setSelectedDate] = useState(dates.includes(today) ? today : dates[0]);

  // Al moverse de semana, el dia elegido tiene que caer dentro de la nueva. Se
  // ajusta durante el render: con un efecto quedaba un commit mostrando la
  // semana nueva con un dia de la anterior seleccionado.
  const [semanaPrevia, setSemanaPrevia] = useState(dates[0]);
  if (dates[0] !== semanaPrevia) {
    setSemanaPrevia(dates[0]);
    if (!dates.includes(selectedDate)) setSelectedDate(dates.includes(today) ? today : dates[0]);
  }

  const [empleados, setEmpleados] = useState<any[] | null>(null);
  useEffect(() => { fetch("/api/remises/empleados").then((r) => r.json()).then(setEmpleados); }, []);

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-bold text-gray-900 flex items-center gap-2">
          Semana
          <InfoTip text="Planificá con anticipación quién viaja cada día de la semana, sin afectar la asistencia real de Hoy hasta que generés las rutas para ese día." />
        </h1>
        <a href="/api/remises/export?scope=week" className="text-sm text-blue-600 hover:underline">Exportar semana</a>
      </div>

      {turnos.length > 1 && (
        <div className="flex gap-1.5 mb-4">
          {turnos.map((t) => (
            <button key={t.id} onClick={() => setTurnoId(t.id)}
              className="px-3 py-1.5 rounded-md text-sm border"
              style={turnoId === t.id ? { background: t.color, borderColor: t.color, color: "#fff" } : { color: t.color, borderColor: `${t.color}44` }}>
              {t.nombre}
            </button>
          ))}
        </div>
      )}

      <div className="flex items-center gap-3 mb-4">
        <button onClick={() => setOffset((o) => o - 1)} className="border border-gray-300 rounded-md px-3 py-1.5 text-sm hover:bg-gray-50">← Anterior</button>
        <span className="text-sm font-medium text-gray-700">{fmt(dates[0])} – {fmt(dates[6])}</span>
        <button onClick={() => setOffset((o) => o + 1)} className="border border-gray-300 rounded-md px-3 py-1.5 text-sm hover:bg-gray-50">Siguiente →</button>
      </div>

      <div className="grid grid-cols-7 gap-2 mb-6">
        {dates.map((d, i) => (
          <button key={d} onClick={() => setSelectedDate(d)}
            className={`rounded-lg py-2 text-sm text-center ${d === selectedDate ? "bg-gray-900 text-white" : d === today ? "bg-amber-50 text-amber-700" : "bg-white border border-gray-200 text-gray-600 hover:bg-gray-50"}`}>
            {DAY_NAMES[(i + 1) % 7]}<br /><strong>{+d.split("-")[2]}</strong>
          </button>
        ))}
      </div>

      {!empleados ? (
        <p className="text-sm text-gray-500">Cargando...</p>
      ) : empleados.length === 0 ? (
        <p className="text-sm text-gray-500">Todavía no hay empleados con datos de Remises cargados.</p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <TripCard tipo="ida" fecha={selectedDate} turnoId={turnoId} empleados={empleados} />
          <TripCard tipo="vuelta" fecha={selectedDate} turnoId={turnoId} empleados={empleados} />
        </div>
      )}
    </div>
  );
}

function TripCard({ tipo, fecha, turnoId, empleados }: { tipo: "ida" | "vuelta"; fecha: string; turnoId: string; empleados: any[] }) {
  const [plan, setPlan] = useState<Set<string> | null>(null);
  const [generado, setGenerado] = useState(false);
  const [generando, setGenerando] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);

  const cargar = useCargar(async (vigente) => {
    if (!fecha || !turnoId) return;
    setPlan(null);
    const [ids, hojas] = await Promise.all([
      fetch(`/api/remises/plan-semana?fecha=${fecha}&turnoId=${turnoId}&tipo=${tipo}`).then((r) => r.json()),
      fetch(`/api/remises/hojas-ruta?fecha=${fecha}&turnoId=${turnoId}&tipo=${tipo}`).then((r) => r.json()),
    ]);
    if (!vigente()) return;
    setPlan(new Set(ids));
    setGenerado(hojas.length > 0);
  }, [fecha, turnoId, tipo]);

  async function toggle(empleadoId: string) {
    const res = await fetch("/api/remises/plan-semana", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ empleadoId, fecha, turnoId, tipo }),
    });
    const { va } = await res.json();
    setPlan((p) => {
      const next = new Set(p);
      if (va) next.add(empleadoId); else next.delete(empleadoId);
      return next;
    });
  }

  async function seleccionar(todos: boolean) {
    await fetch("/api/remises/plan-semana/seleccionar-todos", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fecha, turnoId, tipo, todos }),
    });
    cargar();
  }

  async function generar() {
    setGenerando(true);
    setAviso(null);
    const res = await fetch("/api/remises/plan-semana/generar", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fecha, turnoId, tipo }),
    });
    setGenerando(false);
    const data = await res.json();
    if (!res.ok) { setAviso(data.error ?? "No se pudo generar"); return; }
    setGenerado(true);
    if (data.empleadosSinCoordenadas > 0) setAviso(`${data.empleadosSinCoordenadas} empleado(s) sin coordenadas fueron ignorados.`);
  }

  const activos = empleados;
  const cuenta = plan ? activos.filter((e) => plan.has(e.id)).length : 0;

  return (
    <div className="card p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-medium text-gray-700">{tipo === "ida" ? "IDA – Búsqueda" : "VUELTA – Retorno"}</h3>
        <span className="text-xs text-gray-400">{cuenta}/{activos.length}</span>
      </div>
      <div className="max-h-64 overflow-y-auto space-y-1 mb-3">
        {!plan ? (
          <p className="text-sm text-gray-500">Cargando...</p>
        ) : (
          activos.map((e) => {
            const inc = plan.has(e.id);
            const sinCoords = e.remises_empleados_datos?.lat == null;
            return (
              <div key={e.id} className="flex items-center justify-between text-sm py-1">
                <span className="truncate">{e.apellido}, {e.nombre}{sinCoords && <span className="text-amber-600 text-xs ml-1">sin coords</span>}</span>
                <button onClick={() => toggle(e.id)}
                  className={`text-xs px-2 py-0.5 rounded-full shrink-0 ${inc ? "bg-emerald-100 text-emerald-700" : "bg-gray-100 text-gray-500"}`}>
                  {inc ? "Va" : "No va"}
                </button>
              </div>
            );
          })
        )}
      </div>
      {aviso && <p className="text-xs text-amber-600 mb-2">{aviso}</p>}
      <div className="flex items-center gap-2 flex-wrap">
        <button onClick={generar} disabled={generando} className="btn-primary text-sm disabled:opacity-50">
          {generando ? "Generando..." : "▶ Generar rutas"}
        </button>
        <button onClick={() => seleccionar(true)} className="text-xs text-gray-500 hover:underline">Todos</button>
        <button onClick={() => seleccionar(false)} className="text-xs text-gray-500 hover:underline">Ninguno</button>
        {generado && <span className="text-xs text-emerald-600 ml-auto">Generado</span>}
      </div>
    </div>
  );
}
