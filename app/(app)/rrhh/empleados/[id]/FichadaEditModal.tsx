"use client";

import { useState } from "react";

interface Fichada {
  id: string;
  hora_entrada: string;
  hora_salida: string | null;
}

interface FilaFichada {
  id: string | null;
  fechaEntrada: string;
  horaEntrada: string;
  fechaSalida: string;
  horaSalida: string;
  eliminar: boolean;
}

interface Props {
  employeeId: string;
  empleadoNombre: string;
  fecha: string; // YYYY-MM-DD, día calendario que se está corrigiendo
  fichadas: Fichada[];
  horasNormales: number;
  horasExtra50: number;
  horasExtra100: number;
  horasManual: boolean;
  onClose: () => void;
  onSaved: () => void;
}

const TZ_ARGENTINA = "America/Argentina/Buenos_Aires";
function toLocalDateStr(iso: string): string {
  return new Date(iso).toLocaleDateString("en-CA", { timeZone: TZ_ARGENTINA });
}
function toLocalTimeStr(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-GB", { timeZone: TZ_ARGENTINA, hour: "2-digit", minute: "2-digit", hour12: false });
}

export default function FichadaEditModal({
  employeeId, empleadoNombre, fecha, fichadas,
  horasNormales, horasExtra50, horasExtra100, horasManual, onClose, onSaved,
}: Props) {
  const totalActual = horasNormales + horasExtra50 + horasExtra100;

  const [filas, setFilas] = useState<FilaFichada[]>(() =>
    fichadas.length > 0
      ? fichadas.map((f) => ({
          id: f.id,
          fechaEntrada: toLocalDateStr(f.hora_entrada),
          horaEntrada: toLocalTimeStr(f.hora_entrada),
          fechaSalida: f.hora_salida ? toLocalDateStr(f.hora_salida) : toLocalDateStr(f.hora_entrada),
          horaSalida: f.hora_salida ? toLocalTimeStr(f.hora_salida) : "",
          eliminar: false,
        }))
      : [{ id: null, fechaEntrada: fecha, horaEntrada: "", fechaSalida: fecha, horaSalida: "", eliminar: false }]
  );
  const [horasInput, setHorasInput] = useState(totalActual.toFixed(1));
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function actualizarFila(idx: number, cambios: Partial<FilaFichada>) {
    setFilas((prev) => prev.map((f, i) => (i === idx ? { ...f, ...cambios } : f)));
  }
  function agregarFila() {
    setFilas((prev) => [...prev, { id: null, fechaEntrada: fecha, horaEntrada: "", fechaSalida: fecha, horaSalida: "", eliminar: false }]);
  }
  function quitarFila(idx: number) {
    setFilas((prev) => {
      const fila = prev[idx];
      if (fila.id) return prev.map((f, i) => (i === idx ? { ...f, eliminar: !f.eliminar } : f));
      return prev.filter((_, i) => i !== idx);
    });
  }

  async function guardar() {
    setGuardando(true);
    setError(null);
    try {
      for (const fila of filas) {
        if (fila.id && fila.eliminar) {
          await fetch(`/api/rrhh/fichadas/${fila.id}`, { method: "DELETE" });
          continue;
        }
        if (fila.eliminar || !fila.horaEntrada) continue;
        const body = {
          employeeId,
          fecha: fila.fechaEntrada,
          horaEntrada: `${fila.fechaEntrada}T${fila.horaEntrada}:00`,
          horaSalida: fila.horaSalida ? `${fila.fechaSalida}T${fila.horaSalida}:00` : null,
        };
        const res = await fetch(fila.id ? `/api/rrhh/fichadas/${fila.id}` : "/api/rrhh/fichadas", {
          method: fila.id ? "PUT" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.error ?? "No se pudo guardar la fichada");
        }
      }

      const nuevoTotal = Number(horasInput);
      if (!Number.isNaN(nuevoTotal) && Math.abs(nuevoTotal - totalActual) > 0.01) {
        const res = await fetch("/api/rrhh/asistencia/horas-manual", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ employeeId, fecha, horasTrabajadas: nuevoTotal }),
        });
        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.error ?? "No se pudo fijar las horas manuales");
        }
      }

      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo guardar la corrección");
    } finally {
      setGuardando(false);
    }
  }

  async function restablecerHoras() {
    setGuardando(true);
    setError(null);
    try {
      const res = await fetch("/api/rrhh/asistencia/horas-manual", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ employeeId, fecha, horasTrabajadas: null }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error ?? "No se pudo restablecer el cálculo");
      }
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo restablecer el cálculo");
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-lg shadow-lg p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <h3 className="font-medium text-gray-800 mb-1">Corregir fichada</h3>
        <p className="text-sm text-gray-500 mb-4">
          {empleadoNombre} · {new Date(`${fecha}T00:00:00`).toLocaleDateString("es-AR", { timeZone: "UTC" })}
        </p>

        <div className="space-y-3 mb-4">
          {filas.map((fila, idx) => (
            <div key={idx} className={`border rounded-md p-3 ${fila.eliminar ? "opacity-40 border-red-200 bg-red-50" : "border-gray-200"}`}>
              <div className="grid grid-cols-2 gap-3 mb-2">
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Fecha de ingreso</label>
                  <input type="date" disabled={fila.eliminar} value={fila.fechaEntrada}
                    onChange={(e) => actualizarFila(idx, { fechaEntrada: e.target.value })}
                    className="w-full border border-gray-300 rounded-md px-2 py-1.5 text-sm disabled:bg-gray-100" />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Hora de ingreso</label>
                  <input type="time" disabled={fila.eliminar} value={fila.horaEntrada}
                    onChange={(e) => actualizarFila(idx, { horaEntrada: e.target.value })}
                    className="w-full border border-gray-300 rounded-md px-2 py-1.5 text-sm disabled:bg-gray-100" />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Fecha de salida</label>
                  <input type="date" disabled={fila.eliminar} value={fila.fechaSalida}
                    onChange={(e) => actualizarFila(idx, { fechaSalida: e.target.value })}
                    className="w-full border border-gray-300 rounded-md px-2 py-1.5 text-sm disabled:bg-gray-100" />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Hora de salida</label>
                  <input type="time" disabled={fila.eliminar} value={fila.horaSalida}
                    onChange={(e) => actualizarFila(idx, { horaSalida: e.target.value })}
                    className="w-full border border-gray-300 rounded-md px-2 py-1.5 text-sm disabled:bg-gray-100" />
                </div>
              </div>
              <button type="button" onClick={() => quitarFila(idx)} className="text-xs text-red-600 hover:underline">
                {fila.id ? (fila.eliminar ? "Deshacer eliminación" : "Eliminar esta marcación") : "Quitar"}
              </button>
            </div>
          ))}
        </div>

        <button type="button" onClick={agregarFila} className="text-sm text-blue-600 hover:underline mb-5">
          + Agregar marcación
        </button>

        <div className="border-t border-gray-200 pt-4 mb-2">
          <label className="block text-xs text-gray-500 mb-1">Horas trabajadas (total del día)</label>
          <div className="flex items-center gap-3">
            <input type="number" step="0.1" min="0" max="24" value={horasInput}
              onChange={(e) => setHorasInput(e.target.value)}
              className="w-28 border border-gray-300 rounded-md px-2 py-1.5 text-sm" />
            <span className="text-xs text-gray-400">Calculado automáticamente: {totalActual.toFixed(1)}hs</span>
          </div>
          <p className="text-xs text-gray-400 mt-1">
            Si cambiás este valor, queda fijado manualmente y no se recalcula solo con las marcaciones de arriba.
          </p>
          {horasManual && (
            <button type="button" onClick={restablecerHoras} disabled={guardando} className="text-xs text-amber-700 hover:underline mt-1">
              Restablecer al cálculo automático
            </button>
          )}
        </div>

        {error && <p className="text-sm text-red-600 mb-3">{error}</p>}

        <div className="flex justify-end gap-2 mt-4">
          <button onClick={onClose} type="button" className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors">
            Cancelar
          </button>
          <button onClick={guardar} disabled={guardando} type="button" className="btn-primary disabled:opacity-50">
            {guardando ? "Guardando..." : "Guardar cambios"}
          </button>
        </div>
      </div>
    </div>
  );
}
