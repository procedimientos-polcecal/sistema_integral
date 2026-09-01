"use client";

import { useState } from "react";
import InfoTip from "@/components/InfoTip";
import { useConfirm } from "@/components/ConfirmProvider";
import { useCargar } from "@/lib/core/useCargar";

export default function FeriadosClient() {
  const confirmar = useConfirm();
  const [feriados, setFeriados] = useState<any[] | null>(null);
  const [nuevo, setNuevo] = useState({ fecha: "", nombre: "" });
  const [guardando, setGuardando] = useState(false);

  const cargar = useCargar(async (vigente) => {
    const data = await fetch("/api/rrhh/feriados").then((r) => r.json());
    if (!vigente()) return;
    setFeriados(data);
  }, []);

  async function crear(e: React.FormEvent) {
    e.preventDefault();
    setGuardando(true);
    const res = await fetch("/api/rrhh/feriados", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(nuevo),
    });
    setGuardando(false);
    if (res.ok) { setNuevo({ fecha: "", nombre: "" }); cargar(); }
  }

  async function eliminar(f: any) {
    const ok = await confirmar({
      title: "Eliminar feriado",
      message: `¿Eliminar el feriado "${f.nombre}"? Esta acción no se puede deshacer.`,
      confirmText: "Eliminar",
      danger: true,
    });
    if (!ok) return;
    await fetch(`/api/rrhh/feriados/${f.id}`, { method: "DELETE" });
    cargar();
  }

  return (
    <div>
      <h1 className="text-xl font-bold text-gray-900 mb-4">Feriados</h1>
      <div className="card p-5 max-w-xl">
        <h2 className="font-medium text-gray-700 mb-3 flex items-center gap-1.5">
          Feriados
          <InfoTip text="Los días feriados del año. El sistema los usa para el cálculo de horas: trabajar un feriado genera francos compensatorios y se paga con recargo, igual que un domingo." />
        </h2>
        {!feriados ? (
          <p className="text-gray-500 text-sm mb-3">Cargando...</p>
        ) : (
          <ul className="text-sm mb-3 space-y-1 max-h-64 overflow-auto">
            {feriados.map((f) => (
              <li key={f.id} className="flex justify-between items-center text-gray-600">
                <span>{new Date(f.fecha).toLocaleDateString("es-AR", { timeZone: "UTC" })} - {f.nombre}</span>
                <button onClick={() => eliminar(f)} className="text-red-500 text-xs">eliminar</button>
              </li>
            ))}
            {feriados.length === 0 && <li className="text-gray-400">Todavía no hay feriados cargados</li>}
          </ul>
        )}
        <form onSubmit={crear} className="flex gap-2">
          <input type="date" required value={nuevo.fecha} onChange={(e) => setNuevo({ ...nuevo, fecha: e.target.value })}
            className="border border-gray-300 rounded-md px-2 py-1.5 text-sm" />
          <input required placeholder="Nombre" value={nuevo.nombre} onChange={(e) => setNuevo({ ...nuevo, nombre: e.target.value })}
            className="flex-1 border border-gray-300 rounded-md px-2 py-1.5 text-sm" />
          <button type="submit" disabled={guardando} className="btn-primary disabled:opacity-50">Agregar</button>
        </form>
      </div>
    </div>
  );
}
