"use client";

import { useEffect, useState } from "react";
import InfoTip from "@/components/InfoTip";
import { useConfirm } from "@/components/ConfirmProvider";

const ESTADOS = ["PENDIENTE", "TOMADO"] as const;

function firstOfMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}
function today() {
  return new Date().toISOString().slice(0, 10);
}

export default function FrancosClient() {
  const confirmar = useConfirm();
  const [estado, setEstado] = useState("");
  const [desde, setDesde] = useState(firstOfMonth());
  const [hasta, setHasta] = useState(today());
  const [francos, setFrancos] = useState<any[] | null>(null);
  const [cargando, setCargando] = useState(false);

  function queryParams() {
    const params = new URLSearchParams();
    if (estado) params.set("estado", estado);
    if (desde) params.set("desde", desde);
    if (hasta) params.set("hasta", hasta);
    return params.toString();
  }

  async function cargar() {
    setCargando(true);
    const data = await fetch(`/api/rrhh/francos?${queryParams()}`).then((r) => r.json());
    setFrancos(data);
    setCargando(false);
  }
  useEffect(() => { cargar(); }, [estado, desde, hasta]); // eslint-disable-line react-hooks/exhaustive-deps

  async function marcarTomado(id: string) {
    await fetch(`/api/rrhh/francos/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ estado: "TOMADO", fechaTomado: new Date().toISOString().slice(0, 10) }),
    });
    cargar();
  }

  async function eliminar(f: any) {
    const ok = await confirmar({
      title: "Eliminar franco compensatorio",
      message: `¿Eliminar el franco de ${f.empleados?.apellido}, ${f.empleados?.nombre} generado el ${new Date(f.fecha_generado).toLocaleDateString("es-AR", { timeZone: "UTC" })}? Esta acción no se puede deshacer. Si el día que lo generó sigue vigente, puede volver a crearse solo la próxima vez que se recalculen las horas de ese empleado.`,
      confirmText: "Eliminar",
      danger: true,
    });
    if (!ok) return;
    await fetch(`/api/rrhh/francos/${f.id}`, { method: "DELETE" });
    cargar();
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-bold text-gray-900 flex items-center gap-2">
          Francos compensatorios
          <InfoTip text="Días de descanso que genera el sistema cuando un empleado trabaja un domingo o feriado. Podés marcarlos como tomados; los que no, se pagan en la liquidación." />
        </h1>
        <a href={`/api/rrhh/francos/export?${queryParams()}`} className="text-sm text-blue-600 hover:underline">Exportar</a>
      </div>

      <div className="mb-4 flex gap-2 items-end flex-wrap">
        {["", ...ESTADOS].map((e) => (
          <button key={e} onClick={() => setEstado(e)} className={`px-3 py-1.5 rounded-md text-sm ${estado === e ? "bg-gray-900 text-white" : "bg-white text-gray-600"}`}>
            {e || "Todos"}
          </button>
        ))}
        <div className="ml-4">
          <label className="block text-xs text-gray-500 mb-1">Desde</label>
          <input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} className="border border-gray-300 rounded-md px-2 py-1.5 text-sm" />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Hasta</label>
          <input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} className="border border-gray-300 rounded-md px-2 py-1.5 text-sm" />
        </div>
        {(desde || hasta) && (
          <button onClick={() => { setDesde(""); setHasta(""); }} className="text-sm text-gray-500 hover:underline pb-1.5">
            Quitar filtro de fecha
          </button>
        )}
      </div>

      <div className="card p-5">
        {cargando || !francos ? (
          <p className="text-gray-500 text-sm">Cargando...</p>
        ) : (
          <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-500 border-b">
                <th className="pb-2">Legajo</th>
                <th className="pb-2">Empleado</th>
                <th className="pb-2">Generado el</th>
                <th className="pb-2">Horas</th>
                <th className="pb-2">Estado</th>
                <th className="pb-2"></th>
              </tr>
            </thead>
            <tbody>
              {francos.length === 0 && (
                <tr><td colSpan={6} className="py-3 text-center text-gray-400">No hay francos en el período elegido.</td></tr>
              )}
              {francos.map((f) => (
                <tr key={f.id} className="border-b last:border-0">
                  <td className="py-2">{f.empleados?.legajo}</td>
                  <td className="py-2">{f.empleados?.apellido}, {f.empleados?.nombre}</td>
                  <td className="py-2">{new Date(f.fecha_generado).toLocaleDateString("es-AR", { timeZone: "UTC" })}</td>
                  <td className="py-2">{f.horas}</td>
                  <td className="py-2">{f.estado}</td>
                  <td className="py-2 text-right whitespace-nowrap">
                    {f.estado === "PENDIENTE" && (
                      <button onClick={() => marcarTomado(f.id)} className="text-gray-700 underline text-sm">Marcar tomado</button>
                    )}
                    <button onClick={() => eliminar(f)} className="text-red-600 underline text-sm ml-3">Eliminar</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        )}
      </div>
    </div>
  );
}
