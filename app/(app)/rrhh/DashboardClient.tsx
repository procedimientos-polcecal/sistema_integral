"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import InfoTip from "@/components/InfoTip";

type CategoriaHoy = "presentes" | "ausentes" | "tardes" | "vacaciones";

const TITULOS_CATEGORIA: Record<CategoriaHoy, string> = {
  presentes: "Presentes hoy",
  ausentes: "Ausentes hoy",
  tardes: "Tardanzas hoy",
  vacaciones: "Vacaciones hoy",
};

function firstOfMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}
function today() {
  return new Date().toISOString().slice(0, 10);
}

function buildQS(params: Record<string, string | undefined>) {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) qs.set(k, v);
  const s = qs.toString();
  return s ? `?${s}` : "";
}

function StatCard({
  titulo, cantidad, porcentaje, cargando, bg, onClick,
}: { titulo: string; cantidad: number; porcentaje: number; cargando?: boolean; bg: string; onClick: () => void }) {
  return (
    <button onClick={onClick} className={`rounded-xl p-5 flex items-center justify-between text-white text-left w-full transition hover:brightness-110 ${bg}`}>
      <div>
        <div className="text-sm opacity-90">{titulo}</div>
        <div className="text-3xl font-bold">{cargando ? "…" : cantidad}</div>
      </div>
      <div className="text-lg font-semibold opacity-90">{cargando ? "" : `${porcentaje}%`}</div>
    </button>
  );
}

export default function DashboardClient({
  nombreUsuario, empresas, sectores,
}: { nombreUsuario: string; empresas: any[]; sectores: any[] }) {
  const [empresaId, setEmpresaId] = useState("");
  const [sectorId, setSectorId] = useState("");
  const [desdeGraficos, setDesdeGraficos] = useState(firstOfMonth());
  const [hastaGraficos, setHastaGraficos] = useState(today());

  const [resumen, setResumen] = useState<any | null>(null);
  const [cargandoResumen, setCargandoResumen] = useState(false);
  const [topAusencias, setTopAusencias] = useState<any[] | null>(null);
  const [topTardanzas, setTopTardanzas] = useState<any[] | null>(null);
  const [horasSector, setHorasSector] = useState<any[] | null>(null);
  const [horasExtraSector, setHorasExtraSector] = useState<any[] | null>(null);

  const [categoriaHoy, setCategoriaHoy] = useState<CategoriaHoy | null>(null);
  const [detalleHoy, setDetalleHoy] = useState<any | null>(null);
  const [sectorSeleccionado, setSectorSeleccionado] = useState<{ sectorId: string; desde: string; hasta: string } | null>(null);
  const [detalleSector, setDetalleSector] = useState<any | null>(null);

  useEffect(() => {
    setCargandoResumen(true);
    fetch(`/api/rrhh/dashboard/resumen-hoy${buildQS({ empresaId, sectorId })}`).then((r) => r.json()).then((d) => { setResumen(d); setCargandoResumen(false); });
    fetch(`/api/rrhh/dashboard/top-ausencias${buildQS({ empresaId, sectorId })}`).then((r) => r.json()).then(setTopAusencias);
    fetch(`/api/rrhh/dashboard/top-tardanzas${buildQS({ empresaId, sectorId })}`).then((r) => r.json()).then(setTopTardanzas);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [empresaId, sectorId]);

  useEffect(() => {
    fetch(`/api/rrhh/dashboard/horas-por-sector${buildQS({ empresaId, desde: desdeGraficos, hasta: hastaGraficos })}`)
      .then((r) => r.json()).then(setHorasSector);
    fetch(`/api/rrhh/dashboard/horas-extra-por-sector${buildQS({ empresaId, desde: desdeGraficos, hasta: hastaGraficos })}`)
      .then((r) => r.json()).then(setHorasExtraSector);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [empresaId, desdeGraficos, hastaGraficos]);

  useEffect(() => {
    if (categoriaHoy === null) return;
    setDetalleHoy(null);
    fetch(`/api/rrhh/dashboard/detalle-hoy${buildQS({ empresaId, sectorId })}`).then((r) => r.json()).then(setDetalleHoy);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [categoriaHoy]);

  useEffect(() => {
    if (!sectorSeleccionado) return;
    setDetalleSector(null);
    fetch(
      `/api/rrhh/dashboard/detalle-sector${buildQS({
        sectorId: sectorSeleccionado.sectorId,
        desde: sectorSeleccionado.desde,
        hasta: sectorSeleccionado.hasta,
        empresaId,
      })}`
    )
      .then((r) => r.json()).then(setDetalleSector);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sectorSeleccionado]);

  return (
    <div>
      <h1 className="text-xl font-bold text-gray-900 mb-1">Hola, {nombreUsuario}</h1>
      <p className="text-gray-500 mb-6">Resumen general</p>

      <div className="flex gap-4 mb-6 card p-4">
        <div>
          <label className="block text-xs text-gray-500 mb-1">Empresa</label>
          <select value={empresaId} onChange={(e) => setEmpresaId(e.target.value)} className="border border-gray-300 rounded-md px-2 py-1.5 text-sm min-w-[160px]">
            <option value="">Todas</option>
            {empresas.map((e) => <option key={e.id} value={e.id}>{e.nombre}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Sector</label>
          <select value={sectorId} onChange={(e) => setSectorId(e.target.value)} className="border border-gray-300 rounded-md px-2 py-1.5 text-sm min-w-[160px]">
            <option value="">Todos</option>
            {sectores.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <StatCard titulo="Presentes" cargando={cargandoResumen} cantidad={resumen?.presentes.cantidad ?? 0} porcentaje={resumen?.presentes.porcentaje ?? 0} bg="bg-emerald-600" onClick={() => setCategoriaHoy("presentes")} />
        <StatCard titulo="Ausentes" cargando={cargandoResumen} cantidad={resumen?.ausentes.cantidad ?? 0} porcentaje={resumen?.ausentes.porcentaje ?? 0} bg="bg-rose-500" onClick={() => setCategoriaHoy("ausentes")} />
        <StatCard titulo="Tardes" cargando={cargandoResumen} cantidad={resumen?.tardes.cantidad ?? 0} porcentaje={resumen?.tardes.porcentaje ?? 0} bg="bg-amber-500" onClick={() => setCategoriaHoy("tardes")} />
        <StatCard titulo="Vacaciones" cargando={cargandoResumen} cantidad={resumen?.vacaciones.cantidad ?? 0} porcentaje={resumen?.vacaciones.porcentaje ?? 0} bg="bg-violet-500" onClick={() => setCategoriaHoy("vacaciones")} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
        <div className="card p-5">
          <h2 className="font-medium text-gray-700 mb-3">Top 10 ausencias (mes en curso)</h2>
          {topAusencias?.length === 0 && <p className="text-sm text-gray-500">Sin ausencias registradas.</p>}
          {topAusencias && topAusencias.length > 0 && (
            <table className="w-full text-sm">
              <thead><tr className="text-left text-gray-500 border-b"><th className="pb-2">Legajo</th><th className="pb-2">Nombre</th><th className="pb-2">Ausencias</th></tr></thead>
              <tbody>
                {topAusencias.map((a) => (
                  <tr key={a.employeeId} className="border-b last:border-0">
                    <td className="py-2">{a.legajo}</td>
                    <td className="py-2"><Link href={`/rrhh/empleados/${a.employeeId}`} className="text-gray-700 hover:underline">{a.nombre}</Link></td>
                    <td className="py-2 font-medium text-red-600">{a.ausencias}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="card p-5">
          <h2 className="font-medium text-gray-700 mb-3">Top 10 llegadas tarde / salidas tempranas (mes en curso)</h2>
          {topTardanzas?.length === 0 && <p className="text-sm text-gray-500">Sin tardanzas ni retiros anticipados registrados.</p>}
          {topTardanzas && topTardanzas.length > 0 && (
            <table className="w-full text-sm">
              <thead><tr className="text-left text-gray-500 border-b"><th className="pb-2">Legajo</th><th className="pb-2">Nombre</th><th className="pb-2">Tarde</th><th className="pb-2">Retiro ant.</th></tr></thead>
              <tbody>
                {topTardanzas.map((t) => (
                  <tr key={t.employeeId} className="border-b last:border-0">
                    <td className="py-2">{t.legajo}</td>
                    <td className="py-2"><Link href={`/rrhh/empleados/${t.employeeId}`} className="text-gray-700 hover:underline">{t.nombre}</Link></td>
                    <td className="py-2 font-medium text-amber-600">{t.tardanzas || "-"}</td>
                    <td className="py-2 font-medium text-orange-600">{t.retirosAnticipados || "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <div className="flex gap-4 mb-6 card p-4 items-end">
        <div>
          <label className="block text-xs text-gray-500 mb-1">Gráficos desde</label>
          <input type="date" value={desdeGraficos} onChange={(e) => setDesdeGraficos(e.target.value)} className="border border-gray-300 rounded-md px-2 py-1.5 text-sm" />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Hasta</label>
          <input type="date" value={hastaGraficos} onChange={(e) => setHastaGraficos(e.target.value)} className="border border-gray-300 rounded-md px-2 py-1.5 text-sm" />
        </div>
        <p className="text-xs text-gray-400 pb-2">Aplica a los 3 gráficos de abajo.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="card p-5">
          <h2 className="font-medium text-gray-700 mb-3">Horas trabajadas vs Teóricas por Sector</h2>
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={horasSector ?? []}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="sector" tick={{ fontSize: 12 }} />
              <YAxis tick={{ fontSize: 12 }} />
              <Tooltip />
              <Legend />
              <Bar dataKey="horasTrabajadas" name="Trabajadas" fill="#0ea5e9" onClick={(data: any) => setSectorSeleccionado({ sectorId: data.payload.sectorId, desde: desdeGraficos, hasta: hastaGraficos })} cursor="pointer" />
              <Bar dataKey="horasTeoricas" name="Teóricas" fill="#94a3b8" onClick={(data: any) => setSectorSeleccionado({ sectorId: data.payload.sectorId, desde: desdeGraficos, hasta: hastaGraficos })} cursor="pointer" />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="card p-5">
          <h2 className="font-medium text-gray-700 mb-3">Horas extra por Sector</h2>
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={horasExtraSector ?? []}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="sector" tick={{ fontSize: 12 }} />
              <YAxis tick={{ fontSize: 12 }} />
              <Tooltip />
              <Legend />
              <Bar dataKey="horasExtra50" name="Extra 50%" fill="#f59e0b" onClick={(data: any) => setSectorSeleccionado({ sectorId: data.payload.sectorId, desde: desdeGraficos, hasta: hastaGraficos })} cursor="pointer" />
              <Bar dataKey="horasExtra100" name="Extra 100%" fill="#ef4444" onClick={(data: any) => setSectorSeleccionado({ sectorId: data.payload.sectorId, desde: desdeGraficos, hasta: hastaGraficos })} cursor="pointer" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="card p-5 mt-6">
        <h2 className="font-medium text-gray-700 flex items-center gap-1.5 mb-3">
          Costo de horas extra por Sector ($)
          <InfoTip text="Estimado a partir del valor hora normal de cada empleado y los multiplicadores configurados en Administración." />
        </h2>
        <ResponsiveContainer width="100%" height={280}>
          <BarChart data={horasExtraSector ?? []}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="sector" tick={{ fontSize: 12 }} />
            <YAxis tick={{ fontSize: 12 }} tickFormatter={(v) => `$${Number(v).toLocaleString("es-AR")}`} />
            <Tooltip formatter={(v: any) => `$${Number(v).toLocaleString("es-AR")}`} />
            <Legend />
            <Bar dataKey="montoExtra50" name="Extra 50%" fill="#f59e0b" onClick={(data: any) => setSectorSeleccionado({ sectorId: data.payload.sectorId, desde: desdeGraficos, hasta: hastaGraficos })} cursor="pointer" />
            <Bar dataKey="montoExtra100" name="Extra 100%" fill="#ef4444" onClick={(data: any) => setSectorSeleccionado({ sectorId: data.payload.sectorId, desde: desdeGraficos, hasta: hastaGraficos })} cursor="pointer" />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {categoriaHoy && (
        <ModalListaEmpleados titulo={TITULOS_CATEGORIA[categoriaHoy]} empleados={detalleHoy?.[categoriaHoy]} onClose={() => setCategoriaHoy(null)} />
      )}
      {sectorSeleccionado && (
        <ModalDetalleSector
          titulo={detalleSector?.sector ?? sectores.find((s) => s.id === sectorSeleccionado.sectorId)?.nombre ?? ""}
          detalle={detalleSector}
          onClose={() => setSectorSeleccionado(null)}
        />
      )}
    </div>
  );
}

function ModalListaEmpleados({ titulo, empleados, onClose }: { titulo: string; empleados: any[] | undefined; onClose: () => void }) {
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-lg shadow-lg p-6 w-full max-w-md max-h-[80vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-medium text-gray-800">{titulo}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">&times;</button>
        </div>
        {!empleados ? (
          <p className="text-sm text-gray-500">Cargando...</p>
        ) : empleados.length === 0 ? (
          <p className="text-sm text-gray-500">Sin resultados.</p>
        ) : (
          <table className="w-full text-sm">
            <thead><tr className="text-left text-gray-500 border-b"><th className="pb-2">Legajo</th><th className="pb-2">Nombre</th><th className="pb-2">Sector</th></tr></thead>
            <tbody>
              {empleados.map((e) => (
                <tr key={e.employeeId} className="border-b last:border-0">
                  <td className="py-2">{e.legajo}</td>
                  <td className="py-2"><Link href={`/rrhh/empleados/${e.employeeId}`} className="text-gray-700 hover:underline" onClick={onClose}>{e.nombre}</Link></td>
                  <td className="py-2 text-gray-500">{e.sector ?? "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function ModalDetalleSector({ titulo, detalle, onClose }: { titulo: string; detalle: any | undefined; onClose: () => void }) {
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-lg shadow-lg p-6 w-full max-w-2xl max-h-[80vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-medium text-gray-800">{titulo}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">&times;</button>
        </div>
        {!detalle ? (
          <p className="text-sm text-gray-500">Cargando...</p>
        ) : detalle.empleados.length === 0 ? (
          <p className="text-sm text-gray-500">Sin datos en el período.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-500 border-b">
                <th className="pb-2">Legajo</th><th className="pb-2">Nombre</th><th className="pb-2">Trabajadas</th>
                <th className="pb-2">Teóricas</th><th className="pb-2">Extra 50%</th><th className="pb-2">Extra 100%</th><th className="pb-2">$ Extra</th>
              </tr>
            </thead>
            <tbody>
              {detalle.empleados.map((e: any) => (
                <tr key={e.employeeId} className="border-b last:border-0">
                  <td className="py-2">{e.legajo}</td>
                  <td className="py-2"><Link href={`/rrhh/empleados/${e.employeeId}`} className="text-gray-700 hover:underline" onClick={onClose}>{e.nombre}</Link></td>
                  <td className="py-2">{e.horasTrabajadas}</td>
                  <td className="py-2 text-gray-500">{e.horasTeoricas}</td>
                  <td className="py-2">{e.horasExtra50 || "-"}</td>
                  <td className="py-2">{e.horasExtra100 || "-"}</td>
                  <td className="py-2">{e.montoExtra50 + e.montoExtra100 > 0 ? `$${(e.montoExtra50 + e.montoExtra100).toLocaleString("es-AR")}` : "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
