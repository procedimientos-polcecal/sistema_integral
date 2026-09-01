"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import InfoTip from "@/components/InfoTip";
import { useCargar } from "@/lib/core/useCargar";

export default function VacacionesClient({ empleados }: { empleados: any[] }) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const [tab, setTabState] = useState<"balance" | "historial">(
    searchParams.get("tab") === "historial" ? "historial" : "balance"
  );
  function setTab(t: "balance" | "historial") {
    setTabState(t);
    router.replace(`${pathname}?tab=${t}`, { scroll: false });
  }

  return (
    <div>
      <h1 className="text-xl font-bold text-gray-900 mb-4 flex items-center gap-2">
        Vacaciones
        <InfoTip text="El balance de días de vacaciones de cada empleado según su antigüedad, y los períodos que ya se tomó." />
      </h1>
      <div className="flex gap-2 mb-6">
        {(["balance", "historial"] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-4 py-2 rounded-md text-sm ${tab === t ? "bg-gray-900 text-white" : "bg-white text-gray-600 hover:bg-gray-100"}`}>
            {t === "balance" ? "Balance por empleado" : "Historial"}
          </button>
        ))}
      </div>
      {tab === "balance" ? <Balance empleados={empleados} /> : <Historial />}
    </div>
  );
}

function Balance({ empleados }: { empleados: any[] }) {
  const [employeeId, setEmployeeId] = useState("");
  const [anio, setAnio] = useState(new Date().getFullYear());
  const [balance, setBalance] = useState<any | null>(null);
  const [form, setForm] = useState({ fechaDesde: "", fechaHasta: "", diasTomados: "" });
  const [guardando, setGuardando] = useState(false);

  const cargarBalance = useCargar(async (vigente) => {
    if (!employeeId) { setBalance(null); return; }
    const data = await fetch(`/api/rrhh/vacaciones/${employeeId}/balance?anio=${anio}`).then((r) => r.json());
    if (!vigente()) return;
    setBalance(data);
  }, [employeeId, anio]);

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    setGuardando(true);
    await fetch("/api/rrhh/vacaciones", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        employeeId, anioCorrespondiente: anio,
        fechaDesde: form.fechaDesde, fechaHasta: form.fechaHasta, diasTomados: Number(form.diasTomados),
      }),
    });
    setGuardando(false);
    setForm({ fechaDesde: "", fechaHasta: "", diasTomados: "" });
    cargarBalance();
  }

  return (
    <div>
      <div className="flex gap-4 items-end mb-6 card p-4">
        <div>
          <label className="block text-xs text-gray-500 mb-1">Empleado</label>
          <select value={employeeId} onChange={(e) => setEmployeeId(e.target.value)} className="border border-gray-300 rounded-md px-2 py-1.5 text-sm min-w-[220px]">
            <option value="">Seleccionar...</option>
            {empleados.map((e) => <option key={e.id} value={e.id}>{e.legajo} - {e.apellido}, {e.nombre}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Año</label>
          <input type="number" value={anio} onChange={(e) => setAnio(Number(e.target.value))} className="border border-gray-300 rounded-md px-2 py-1.5 text-sm w-24" />
        </div>
      </div>

      {employeeId && balance && (
        <>
          <div className="grid grid-cols-3 gap-4 mb-6">
            <div className="card p-5">
              <div className="text-sm text-gray-500">Días correspondientes</div>
              <div className="text-3xl font-semibold mt-1">{balance.correspondientes}</div>
            </div>
            <div className="card p-5">
              <div className="text-sm text-gray-500">Días tomados</div>
              <div className="text-3xl font-semibold mt-1">{balance.tomados}</div>
            </div>
            <div className="card p-5">
              <div className="text-sm text-gray-500">Días restantes</div>
              <div className="text-3xl font-semibold text-blue-600 mt-1">{balance.restantes}</div>
            </div>
          </div>

          <div className="card p-5 mb-6">
            <h2 className="font-medium text-gray-700 mb-3">Cargar período tomado</h2>
            <form onSubmit={guardar} className="flex gap-3 items-end">
              <div>
                <label className="block text-xs text-gray-500 mb-1">Desde</label>
                <input type="date" required value={form.fechaDesde} onChange={(e) => setForm({ ...form, fechaDesde: e.target.value })} className="border border-gray-300 rounded-md px-2 py-1.5 text-sm" />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Hasta</label>
                <input type="date" required value={form.fechaHasta} onChange={(e) => setForm({ ...form, fechaHasta: e.target.value })} className="border border-gray-300 rounded-md px-2 py-1.5 text-sm" />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Días</label>
                <input type="number" required value={form.diasTomados} onChange={(e) => setForm({ ...form, diasTomados: e.target.value })} className="border border-gray-300 rounded-md px-2 py-1.5 text-sm w-20" />
              </div>
              <button type="submit" disabled={guardando} className="btn-primary disabled:opacity-50">
                {guardando ? "Guardando..." : "Guardar"}
              </button>
            </form>
          </div>

          <div className="card p-5">
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-medium text-gray-700">Períodos tomados en {anio}</h2>
              <a href={`/api/rrhh/vacaciones/export?employeeId=${employeeId}`} className="text-sm text-blue-600 hover:underline">Exportar</a>
            </div>
            <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-gray-500 border-b">
                  <th className="pb-2">Desde</th>
                  <th className="pb-2">Hasta</th>
                  <th className="pb-2">Días</th>
                </tr>
              </thead>
              <tbody>
                {balance.periodos.map((p: any) => (
                  <tr key={p.id} className="border-b last:border-0">
                    <td className="py-2">{new Date(p.fecha_desde).toLocaleDateString("es-AR", { timeZone: "UTC" })}</td>
                    <td className="py-2">{new Date(p.fecha_hasta).toLocaleDateString("es-AR", { timeZone: "UTC" })}</td>
                    <td className="py-2">{p.dias_tomados}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function Historial() {
  const [historial, setHistorial] = useState<any[] | null>(null);
  useEffect(() => {
    fetch("/api/rrhh/vacaciones").then((r) => r.json()).then(setHistorial);
  }, []);

  return (
    <div className="card p-5">
      <h2 className="font-medium text-gray-700 mb-3">Historial de vacaciones (todo el personal)</h2>
      {!historial ? (
        <p className="text-gray-500 text-sm">Cargando...</p>
      ) : (
        <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-gray-500 border-b">
              <th className="pb-2">Legajo</th>
              <th className="pb-2">Empleado</th>
              <th className="pb-2">Año</th>
              <th className="pb-2">Desde</th>
              <th className="pb-2">Hasta</th>
              <th className="pb-2">Días</th>
            </tr>
          </thead>
          <tbody>
            {historial.map((p) => (
              <tr key={p.id} className="border-b last:border-0">
                <td className="py-2">{p.empleados?.legajo}</td>
                <td className="py-2">{p.empleados?.apellido}, {p.empleados?.nombre}</td>
                <td className="py-2">{p.anio_correspondiente}</td>
                <td className="py-2">{new Date(p.fecha_desde).toLocaleDateString("es-AR", { timeZone: "UTC" })}</td>
                <td className="py-2">{new Date(p.fecha_hasta).toLocaleDateString("es-AR", { timeZone: "UTC" })}</td>
                <td className="py-2">{p.dias_tomados}</td>
              </tr>
            ))}
            {historial.length === 0 && (
              <tr><td colSpan={6} className="py-4 text-center text-gray-400">Todavía no hay períodos de vacaciones cargados</td></tr>
            )}
          </tbody>
        </table>
        </div>
      )}
    </div>
  );
}
