"use client";

import { useEffect, useState } from "react";
import InfoTip from "@/components/InfoTip";

const ESTADOS = ["PENDIENTE", "TOMADO"] as const;

export default function FrancosClient() {
  const [estado, setEstado] = useState("");
  const [francos, setFrancos] = useState<any[] | null>(null);
  const [cargando, setCargando] = useState(false);

  async function cargar() {
    setCargando(true);
    const data = await fetch(`/api/rrhh/francos${estado ? `?estado=${estado}` : ""}`).then((r) => r.json());
    setFrancos(data);
    setCargando(false);
  }
  useEffect(() => { cargar(); }, [estado]); // eslint-disable-line react-hooks/exhaustive-deps

  async function marcarTomado(id: string) {
    await fetch(`/api/rrhh/francos/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ estado: "TOMADO", fechaTomado: new Date().toISOString().slice(0, 10) }),
    });
    cargar();
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-bold text-gray-900 flex items-center gap-2">
          Francos compensatorios
          <InfoTip text="Días de descanso que genera el sistema cuando un empleado trabaja un domingo o feriado. Podés marcarlos como tomados; los que no, se pagan en la liquidación." />
        </h1>
        <a href={`/api/rrhh/francos/export${estado ? `?estado=${estado}` : ""}`} className="text-sm text-blue-600 hover:underline">Exportar</a>
      </div>

      <div className="mb-4 flex gap-2">
        {["", ...ESTADOS].map((e) => (
          <button key={e} onClick={() => setEstado(e)} className={`px-3 py-1.5 rounded-md text-sm ${estado === e ? "bg-gray-900 text-white" : "bg-white text-gray-600"}`}>
            {e || "Todos"}
          </button>
        ))}
      </div>

      <div className="card p-5">
        {cargando || !francos ? (
          <p className="text-gray-500 text-sm">Cargando...</p>
        ) : (
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
              {francos.map((f) => (
                <tr key={f.id} className="border-b last:border-0">
                  <td className="py-2">{f.empleados?.legajo}</td>
                  <td className="py-2">{f.empleados?.apellido}, {f.empleados?.nombre}</td>
                  <td className="py-2">{new Date(f.fecha_generado).toLocaleDateString("es-AR", { timeZone: "UTC" })}</td>
                  <td className="py-2">{f.horas}</td>
                  <td className="py-2">{f.estado}</td>
                  <td className="py-2 text-right">
                    {f.estado === "PENDIENTE" && (
                      <button onClick={() => marcarTomado(f.id)} className="text-gray-700 underline text-sm">Marcar tomado</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
