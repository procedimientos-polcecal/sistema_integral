"use client";

import { useEffect, useState } from "react";
import InfoTip from "@/components/InfoTip";
import { useConfirm } from "@/components/ConfirmProvider";

export default function TurnosClient() {
  const confirmar = useConfirm();
  const [jornadas, setJornadas] = useState<any[] | null>(null);
  const [form, setForm] = useState({ nombre: "", horaInicio: "08:00", horaFin: "16:00", toleranciaMinutos: "15" });
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function cargar() {
    const data = await fetch("/api/rrhh/jornadas").then((r) => r.json());
    setJornadas(data);
  }
  useEffect(() => { cargar(); }, []);

  async function crear(e: React.FormEvent) {
    e.preventDefault();
    setGuardando(true);
    const res = await fetch("/api/rrhh/jornadas", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        nombre: form.nombre,
        horaInicio: form.horaInicio,
        horaFin: form.horaFin,
        toleranciaMinutos: Number(form.toleranciaMinutos),
      }),
    });
    setGuardando(false);
    if (res.ok) {
      setForm({ nombre: "", horaInicio: "08:00", horaFin: "16:00", toleranciaMinutos: "15" });
      cargar();
    }
  }

  async function eliminar(j: any) {
    const ok = await confirmar({
      title: "Eliminar turno",
      message: `¿Eliminar el turno "${j.nombre}" (${j.hora_inicio} - ${j.hora_fin})? Esta acción no se puede deshacer.`,
      confirmText: "Eliminar",
      danger: true,
    });
    if (!ok) return;
    const res = await fetch(`/api/rrhh/jornadas/${j.id}`, { method: "DELETE" });
    if (res.ok) { setError(null); cargar(); }
    else setError("No se pudo eliminar el turno");
  }

  return (
    <div>
      <h1 className="text-xl font-bold text-gray-900 mb-4">Turnos</h1>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="card p-5 md:col-span-1">
          <h2 className="font-medium text-gray-700 mb-3 flex items-center gap-1.5">
            Nuevo turno
            <InfoTip text="Los horarios de trabajo (ej. 08:00 a 16:00) con su tolerancia de minutos. El sistema los usa para detectar entradas tarde y salidas tempranas al procesar las marcaciones. No hace falta asignarlos a cada empleado: todos los días, el sistema detecta automáticamente cuál turno activo es el más parecido a la marcación real." />
          </h2>
          <form onSubmit={crear} className="space-y-3">
            <div>
              <label className="block text-xs text-gray-500 mb-1">Nombre</label>
              <input required placeholder="Oficina, Turno mañana..." value={form.nombre} onChange={(e) => setForm({ ...form, nombre: e.target.value })}
                className="w-full border border-gray-300 rounded-md px-2 py-1.5 text-sm" />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-xs text-gray-500 mb-1">Hora inicio</label>
                <input type="time" required value={form.horaInicio} onChange={(e) => setForm({ ...form, horaInicio: e.target.value })}
                  className="w-full border border-gray-300 rounded-md px-2 py-1.5 text-sm" />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Hora fin</label>
                <input type="time" required value={form.horaFin} onChange={(e) => setForm({ ...form, horaFin: e.target.value })}
                  className="w-full border border-gray-300 rounded-md px-2 py-1.5 text-sm" />
              </div>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1 flex items-center gap-1">
                Margen (minutos)
                <InfoTip text="Un desvío de hasta este margen (para llegar o para salir) se redondea a la hora exacta del turno; pasado este margen, la entrada se marca como tardanza y la salida como hora extra a validar." />
              </label>
              <input type="number" min={0} max={120} value={form.toleranciaMinutos} onChange={(e) => setForm({ ...form, toleranciaMinutos: e.target.value })}
                className="w-full border border-gray-300 rounded-md px-2 py-1.5 text-sm" />
            </div>
            <button type="submit" disabled={guardando} className="w-full btn-primary disabled:opacity-50">
              {guardando ? "Guardando..." : "Agregar turno"}
            </button>
          </form>
        </div>

        <div className="card p-5 md:col-span-2">
          <h2 className="font-medium text-gray-700 mb-3">Turnos definidos</h2>
          {error && <p className="text-sm text-red-600 mb-3">{error}</p>}
          {!jornadas ? (
            <p className="text-gray-500 text-sm">Cargando...</p>
          ) : (
            <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-gray-500 border-b">
                  <th className="pb-2">Nombre</th><th className="pb-2">Horario</th><th className="pb-2">Margen</th><th className="pb-2"></th>
                </tr>
              </thead>
              <tbody>
                {jornadas.map((j) => (
                  <tr key={j.id} className="border-b last:border-0">
                    <td className="py-2">{j.nombre}</td>
                    <td className="py-2">{j.hora_inicio} - {j.hora_fin}</td>
                    <td className="py-2">{j.tolerancia_minutos} min</td>
                    <td className="py-2 text-right">
                      <button onClick={() => eliminar(j)} className="text-red-500 text-xs">eliminar</button>
                    </td>
                  </tr>
                ))}
                {jornadas.length === 0 && (
                  <tr><td colSpan={4} className="py-4 text-center text-gray-400">Todavía no hay turnos definidos</td></tr>
                )}
              </tbody>
            </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
