"use client";

import { useMemo, useState } from "react";
import { AVISO_DIA_SIN_PROTEGER, traeDiaSinProteger } from "@/lib/rrhh/fichadas/diaSinProteger";
import { acreditarDia, instanteDePared, type CalculoDelDia } from "@/lib/rrhh/fichadas/acreditado";
import type { TurnoLike } from "@/lib/rrhh/engine/recalcular-puro";
import { useCargar } from "@/lib/core/useCargar";
import AcreditadoDeFichada from "./AcreditadoDeFichada";

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
  /**
   * Lo que el motor guardó para el día en `calculos_diarios`. El modal lo
   * muestra, no lo deduce. Si la pantalla que lo abre no lo trae, no se dice nada.
   */
  tarde?: boolean;
  retiroAnticipado?: boolean;
  /** Hay fila en `calculos_diarios` para este día; false = todavía no se recalculó. */
  diaCalculado?: boolean;
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
  horasNormales, horasExtra50, horasExtra100, horasManual, tarde, retiroAnticipado, diaCalculado, onClose, onSaved,
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
  const [normalesInput, setNormalesInput] = useState(horasNormales.toFixed(1));
  const [extra50Input, setExtra50Input] = useState(horasExtra50.toFixed(1));
  const [extra100Input, setExtra100Input] = useState(horasExtra100.toFixed(1));
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // La corrección se guardó pero algún día no quedó marcado como corregido: la
  // sincronización con Lenox lo va a pisar. El modal no se cierra solo, porque
  // un aviso que desaparece junto con la ventana no lo lee nadie.
  const [diaSinProteger, setDiaSinProteger] = useState(false);

  // Los turnos activos, para mostrar lo que se acredita. null mientras cargan o
  // si no se pudieron leer: sin ellos no se muestra nada, porque mostrar la
  // marca como si fuera lo acreditado es justo el error que esto evita.
  const [turnos, setTurnos] = useState<TurnoLike[] | null>(null);
  useCargar(async (vigente) => {
    try {
      const res = await fetch("/api/rrhh/jornadas");
      if (!res.ok) return;
      const data: { id: string; hora_inicio: string; hora_fin: string; tolerancia_minutos: number; activo: boolean }[] = await res.json();
      if (!vigente()) return;
      setTurnos(
        data
          .filter((t) => t.activo)
          .map((t) => ({ id: t.id, horaInicio: t.hora_inicio, horaFin: t.hora_fin, toleranciaMinutos: t.tolerancia_minutos }))
      );
    } catch {
      // Sin turnos no se muestra lo acreditado; guardar no depende de esto.
    }
  }, []);

  // Se calcula sobre lo que hay en el formulario y no sobre lo guardado: al
  // tipear una salida 03:42 se ve al instante que se acredita como 04:00, y no
  // hace falta "arreglarla" a mano para que pague las 8 horas. La marca guardada
  // no se toca; esto es sólo un cálculo al lado.
  const acreditadoPorFila = useMemo(() => {
    if (!turnos) return null;
    const crudas = filas.flatMap((fila, idx) => {
      if (fila.eliminar) return [];
      const entrada = instanteDePared(fila.fechaEntrada, fila.horaEntrada);
      if (!entrada) return [];
      const salida = instanteDePared(fila.fechaSalida, fila.horaSalida);
      // Una salida anterior a la entrada es un tipeo a medias, no una marcación.
      return [{ id: String(idx), hora_entrada: entrada, hora_salida: salida && salida > entrada ? salida : null }];
    });
    return acreditarDia(crudas, fecha, turnos);
  }, [filas, turnos, fecha]);
  const hayAcreditado = !!acreditadoPorFila && acreditadoPorFila.size > 0;

  // En una fila sólo cuenta lo de las horas fijadas a mano: tardanza y retiro
  // son del día guardado y, mientras se tipea, quedarían desactualizados al
  // lado de lo que se está editando. Esas van aparte, abajo.
  const calculoParaFila: CalculoDelDia | undefined = horasManual
    ? {
        horas_normales: horasNormales,
        horas_extra_50: horasExtra50,
        horas_extra_100: horasExtra100,
        tarde: false,
        retiro_anticipado: false,
        horas_manual: true,
      }
    : undefined;

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
    let sinProteger = false;
    try {
      for (const fila of filas) {
        if (fila.id && fila.eliminar) {
          const resBorrado = await fetch(`/api/rrhh/fichadas/${fila.id}`, { method: "DELETE" });
          if (await traeDiaSinProteger(resBorrado)) sinProteger = true;
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
        if (await traeDiaSinProteger(res)) sinProteger = true;
      }

      const nuevoNormales = Number(normalesInput);
      const nuevoExtra50 = Number(extra50Input);
      const nuevoExtra100 = Number(extra100Input);
      const cambiaron =
        Math.abs(nuevoNormales - horasNormales) > 0.01 ||
        Math.abs(nuevoExtra50 - horasExtra50) > 0.01 ||
        Math.abs(nuevoExtra100 - horasExtra100) > 0.01;
      if (![nuevoNormales, nuevoExtra50, nuevoExtra100].some(Number.isNaN) && cambiaron) {
        const res = await fetch("/api/rrhh/asistencia/horas-manual", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            employeeId,
            fecha,
            horasNormales: nuevoNormales,
            horasExtra50: nuevoExtra50,
            horasExtra100: nuevoExtra100,
          }),
        });
        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.error ?? "No se pudo fijar las horas manuales");
        }
      }

      onSaved();
      if (sinProteger) {
        setDiaSinProteger(true);
        return;
      }
      onClose();
    } catch (err) {
      // Si alguna fila ya se había guardado antes del fallo, el aviso de
      // protección también vale: se muestra junto al error.
      if (sinProteger) setDiaSinProteger(true);
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
        body: JSON.stringify({ employeeId, fecha, horasNormales: null }),
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
        <h3 className="font-medium text-slate-800 mb-1">Corregir fichada</h3>
        <p className="text-sm text-slate-500 mb-4">
          {empleadoNombre} · {new Date(`${fecha}T00:00:00`).toLocaleDateString("es-AR", { timeZone: "UTC" })}
        </p>

        <div className="space-y-3 mb-4">
          {filas.map((fila, idx) => (
            <div key={idx} className={`border rounded-md p-3 ${fila.eliminar ? "opacity-40 border-red-200 bg-red-50" : "border-slate-200"}`}>
              <div className="grid grid-cols-2 gap-3 mb-2">
                <div>
                  <label className="block text-xs text-slate-500 mb-1">Fecha de ingreso</label>
                  <input type="date" disabled={fila.eliminar} value={fila.fechaEntrada}
                    onChange={(e) => actualizarFila(idx, { fechaEntrada: e.target.value })}
                    className="w-full border border-slate-300 rounded-md px-2 py-1.5 text-sm disabled:bg-slate-100" />
                </div>
                <div>
                  <label className="block text-xs text-slate-500 mb-1">Hora de ingreso</label>
                  <input type="time" disabled={fila.eliminar} value={fila.horaEntrada}
                    onChange={(e) => actualizarFila(idx, { horaEntrada: e.target.value })}
                    className="w-full border border-slate-300 rounded-md px-2 py-1.5 text-sm disabled:bg-slate-100" />
                </div>
                <div>
                  <label className="block text-xs text-slate-500 mb-1">Fecha de salida</label>
                  <input type="date" disabled={fila.eliminar} value={fila.fechaSalida}
                    onChange={(e) => actualizarFila(idx, { fechaSalida: e.target.value })}
                    className="w-full border border-slate-300 rounded-md px-2 py-1.5 text-sm disabled:bg-slate-100" />
                </div>
                <div>
                  <label className="block text-xs text-slate-500 mb-1">Hora de salida</label>
                  <input type="time" disabled={fila.eliminar} value={fila.horaSalida}
                    onChange={(e) => actualizarFila(idx, { horaSalida: e.target.value })}
                    className="w-full border border-slate-300 rounded-md px-2 py-1.5 text-sm disabled:bg-slate-100" />
                </div>
              </div>
              {!fila.eliminar && acreditadoPorFila?.get(String(idx)) && (
                <p className="text-xs mb-2">
                  <AcreditadoDeFichada acreditado={acreditadoPorFila.get(String(idx))!} calculo={calculoParaFila} prefijo="Se acredita: " />
                </p>
              )}
              <button type="button" onClick={() => quitarFila(idx)} className="text-xs text-red-600 hover:underline">
                {fila.id ? (fila.eliminar ? "Deshacer eliminación" : "Eliminar esta marcación") : "Quitar"}
              </button>
            </div>
          ))}
        </div>

        <button type="button" onClick={agregarFila} className={`text-sm text-blue-600 hover:underline ${hayAcreditado || diaCalculado !== undefined ? "mb-2" : "mb-5"}`}>
          + Agregar marcación
        </button>
        {hayAcreditado && (
          <p className="text-xs text-slate-400 mb-2">
            Dentro del margen del turno se acredita desde el horario pactado: no hace falta corregir una marca para que
            sume las horas del turno. La marca del reloj conviene dejarla como está.
          </p>
        )}
        {diaCalculado !== undefined && (
          <p className="text-xs text-slate-500 mb-5">
            Cálculo guardado de este día:{" "}
            {!diaCalculado ? (
              <span className="italic text-slate-400">todavía sin calcular</span>
            ) : horasManual || tarde || retiroAnticipado ? (
              <>
                {horasManual && <span className="mr-1">horas fijadas a mano (se liquidan esas, no lo que se acredita arriba)</span>}
                {tarde && <span className="mr-1 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">Tardanza</span>}
                {retiroAnticipado && <span className="rounded bg-orange-100 px-1.5 py-0.5 text-[10px] font-medium text-orange-700">Retiro anticipado</span>}
              </>
            ) : (
              "sin tardanza ni retiro anticipado"
            )}
          </p>
        )}

        <div className="border-t border-slate-200 pt-4 mb-2">
          <label className="block text-xs text-slate-500 mb-1">Horas trabajadas</label>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-[11px] text-slate-400 mb-1">Normales</label>
              <input type="number" step="0.1" min="0" max="24" value={normalesInput}
                onChange={(e) => setNormalesInput(e.target.value)}
                className="w-full border border-slate-300 rounded-md px-2 py-1.5 text-sm" />
            </div>
            <div>
              <label className="block text-[11px] text-slate-400 mb-1">Extra 50%</label>
              <input type="number" step="0.1" min="0" max="24" value={extra50Input}
                onChange={(e) => setExtra50Input(e.target.value)}
                className="w-full border border-slate-300 rounded-md px-2 py-1.5 text-sm" />
            </div>
            <div>
              <label className="block text-[11px] text-slate-400 mb-1">Extra 100%</label>
              <input type="number" step="0.1" min="0" max="24" value={extra100Input}
                onChange={(e) => setExtra100Input(e.target.value)}
                className="w-full border border-slate-300 rounded-md px-2 py-1.5 text-sm" />
            </div>
          </div>
          <p className="text-xs text-slate-400 mt-2">
            Total: {(Number(normalesInput || 0) + Number(extra50Input || 0) + Number(extra100Input || 0)).toFixed(1)}hs · Calculado
            automáticamente: {totalActual.toFixed(1)}hs
          </p>
          <p className="text-xs text-slate-400 mt-1">
            Si cambiás estos valores, quedan fijados manualmente y no se recalculan solos con las marcaciones de arriba.
          </p>
          {horasManual && (
            <button type="button" onClick={restablecerHoras} disabled={guardando} className="text-xs text-amber-700 hover:underline mt-1">
              Restablecer al cálculo automático
            </button>
          )}
        </div>

        {error && <p className="text-sm text-red-600 mb-3">{error}</p>}
        {diaSinProteger && (
          <p className="mb-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            {AVISO_DIA_SIN_PROTEGER}
          </p>
        )}

        <div className="flex justify-end gap-2 mt-4">
          {diaSinProteger && !error ? (
            <button onClick={onClose} type="button" className="btn-primary">
              Entendido
            </button>
          ) : (
            <>
              <button onClick={onClose} type="button" className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors">
                {diaSinProteger ? "Cerrar" : "Cancelar"}
              </button>
              <button onClick={guardar} disabled={guardando} type="button" className="btn-primary disabled:opacity-50">
                {guardando ? "Guardando..." : "Guardar cambios"}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
