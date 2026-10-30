"use client";

import { useState } from "react";
import InfoTip from "@/components/InfoTip";
import { useConfirm } from "@/components/ConfirmProvider";
import { useCargar } from "@/lib/core/useCargar";
import { hoyEnArgentina } from "@/lib/core/fechas";

const ESTADOS = ["PENDIENTE", "TOMADO"] as const;

function firstOfMonth() {
  return `${hoyEnArgentina().slice(0, 7)}-01`;
}
function today() {
  return hoyEnArgentina();
}

export default function FrancosClient() {
  const confirmar = useConfirm();
  const [estado, setEstado] = useState("");
  const [desde, setDesde] = useState(firstOfMonth());
  const [hasta, setHasta] = useState(today());
  const [francos, setFrancos] = useState<any[] | null>(null);
  const [cargando, setCargando] = useState(false);
  // Qué franco se está marcando y con qué día. Null = ninguno abierto.
  const [marcando, setMarcando] = useState<{ id: string; dia: string } | null>(null);
  const [errorDeMarca, setErrorDeMarca] = useState<string | null>(null);

  function queryParams() {
    const params = new URLSearchParams();
    if (estado) params.set("estado", estado);
    if (desde) params.set("desde", desde);
    if (hasta) params.set("hasta", hasta);
    return params.toString();
  }

  const cargar = useCargar(async (vigente) => {
    setCargando(true);
    const data = await fetch(`/api/rrhh/francos?${queryParams()}`).then((r) => r.json());
    if (!vigente()) return;
    setFrancos(data);
    setCargando(false);
  }, [estado, desde, hasta]);

  /*
   * Marcar un franco pide el día que la persona descansa, y no lo resuelve
   * sola con `hoy`. Eso último es lo que hacía antes, y por eso los 56 francos
   * tomados hasta el 26/10/2026 caen en tres fechas: eran tres sesiones de
   * alguien poniéndose al día con el botón, no tres días de descanso.
   *
   * El franco se marca cuando se acuerda, así que el día ya se sabe y casi
   * siempre está adelante. La programación del taller cruza ese día para saber
   * quién no viene.
   */
  async function marcarTomado(id: string, dia: string) {
    setErrorDeMarca(null);
    const res = await fetch(`/api/rrhh/francos/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ estado: "TOMADO", fechaDescanso: dia }),
    });
    if (!res.ok) {
      const d = await res.json().catch(() => null);
      setErrorDeMarca(d?.error ?? "No se pudo marcar el franco");
      return;
    }
    setMarcando(null);
    cargar();
  }

  /** Para corregir una marca con el día equivocado: vuelve a pendiente y borra las dos fechas. */
  async function volverAPendiente(f: any) {
    const ok = await confirmar({
      title: "Volver el franco a pendiente",
      message: `El franco de ${f.empleados?.apellido}, ${f.empleados?.nombre} vuelve a quedar sin tomar, y se borra el día de descanso que tenía cargado. Sirve para corregir una marca con el día equivocado: después se vuelve a marcar con el día bueno.`,
      confirmText: "Volver a pendiente",
    });
    if (!ok) return;
    setErrorDeMarca(null);
    const res = await fetch(`/api/rrhh/francos/${f.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ estado: "PENDIENTE" }),
    });
    if (!res.ok) {
      const d = await res.json().catch(() => null);
      setErrorDeMarca(d?.error ?? "No se pudo volver el franco a pendiente");
      return;
    }
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
        <h1 className="text-xl font-bold text-slate-900 flex items-center gap-2">
          Francos compensatorios
          <InfoTip text="Días de descanso que genera el sistema cuando un empleado trabaja un domingo o feriado. Podés marcarlos como tomados; los que no, se pagan en la liquidación." />
        </h1>
        <a href={`/api/rrhh/francos/export?${queryParams()}`} className="text-sm text-blue-600 hover:underline">Exportar</a>
      </div>

      <div className="mb-4 flex gap-2 items-end flex-wrap">
        {["", ...ESTADOS].map((e) => (
          <button key={e} onClick={() => setEstado(e)} className={`px-3 py-1.5 rounded-md text-sm ${estado === e ? "bg-slate-900 text-white" : "bg-white text-slate-600"}`}>
            {e || "Todos"}
          </button>
        ))}
        <div className="ml-4">
          <label className="block text-xs text-slate-500 mb-1">Desde</label>
          <input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} className="border border-slate-300 rounded-md px-2 py-1.5 text-sm" />
        </div>
        <div>
          <label className="block text-xs text-slate-500 mb-1">Hasta</label>
          <input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} className="border border-slate-300 rounded-md px-2 py-1.5 text-sm" />
        </div>
        {(desde || hasta) && (
          <button onClick={() => { setDesde(""); setHasta(""); }} className="text-sm text-slate-500 hover:underline pb-1.5">
            Quitar filtro de fecha
          </button>
        )}
      </div>

      <div className="card p-5">
        {errorDeMarca && (
          <p className="mb-3 rounded-md bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
            {errorDeMarca}
          </p>
        )}
        {cargando || !francos ? (
          <p className="text-slate-500 text-sm">Cargando...</p>
        ) : (
          <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-slate-500 border-b">
                <th className="pb-2">Legajo</th>
                <th className="pb-2">Empleado</th>
                <th className="pb-2">Generado el</th>
                <th className="pb-2">Horas</th>
                <th className="pb-2">Estado</th>
                <th className="pb-2">Descansa el</th>
                <th className="pb-2"></th>
              </tr>
            </thead>
            <tbody>
              {francos.length === 0 && (
                <tr><td colSpan={7} className="py-3 text-center text-slate-400">No hay francos en el período elegido.</td></tr>
              )}
              {francos.map((f) => {
                // Capturado acá: adentro de los callbacks TypeScript ya no sabe
                // que `marcando` no es null.
                const enMarca = marcando && marcando.id === f.id ? marcando : null;
                return (
                <tr key={f.id} className="border-b last:border-0">
                  <td className="py-2">{f.empleados?.legajo}</td>
                  <td className="py-2">{f.empleados?.apellido}, {f.empleados?.nombre}</td>
                  <td className="py-2">{new Date(f.fecha_generado).toLocaleDateString("es-AR", { timeZone: "UTC" })}</td>
                  <td className="py-2">{f.horas}</td>
                  <td className="py-2">{f.estado}</td>
                  <td className="py-2">
                    {f.fecha_descanso ? (
                      new Date(f.fecha_descanso).toLocaleDateString("es-AR", { timeZone: "UTC" })
                    ) : f.estado === "TOMADO" ? (
                      /*
                       * Un franco marcado antes del 26/10/2026: su día real no
                       * se registró nunca y no se puede reconstruir. Se dice,
                       * en vez de mostrar la fecha del trámite como si fuera
                       * el descanso.
                       */
                      <span className="text-slate-400" title="Se marcó antes de que el sistema pidiera el día; el dato no quedó registrado.">
                        sin registrar
                      </span>
                    ) : (
                      <span className="text-slate-300">—</span>
                    )}
                  </td>
                  <td className="py-2 text-right whitespace-nowrap">
                    {f.estado === "PENDIENTE" && !enMarca && (
                      <button
                        onClick={() => { setErrorDeMarca(null); setMarcando({ id: f.id, dia: hoyEnArgentina() }); }}
                        className="text-slate-700 underline text-sm"
                      >
                        Marcar tomado
                      </button>
                    )}
                    {enMarca && (
                      <span className="inline-flex items-center gap-2">
                        <label className="text-xs text-slate-500">Descansa el</label>
                        <input
                          type="date"
                          autoFocus
                          value={enMarca.dia}
                          onChange={(e) => setMarcando({ id: f.id, dia: e.target.value })}
                          className="border border-slate-300 rounded-md px-2 py-1 text-sm"
                        />
                        <button onClick={() => marcarTomado(f.id, enMarca.dia)} className="text-slate-700 underline text-sm">Guardar</button>
                        <button onClick={() => { setMarcando(null); setErrorDeMarca(null); }} className="text-slate-400 underline text-sm">Cancelar</button>
                      </span>
                    )}
                    {f.estado === "TOMADO" && (
                      <button onClick={() => volverAPendiente(f)} className="text-slate-700 underline text-sm">Volver a pendiente</button>
                    )}
                    <button onClick={() => eliminar(f)} className="text-red-600 underline text-sm ml-3">Eliminar</button>
                  </td>
                </tr>
                );
              })}
            </tbody>
          </table>
          </div>
        )}
      </div>
    </div>
  );
}
