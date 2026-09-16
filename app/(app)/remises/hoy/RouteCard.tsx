"use client";

import { useState } from "react";
import { useConfirm } from "@/components/ConfirmProvider";
import { gmapsLink, wazeLink, textoRuta, whatsappLink, emailLink, type HojaTexto } from "@/lib/remises/shareText";

const COLORS = ["#3b82f6", "#ef4444", "#10b981", "#f59e0b", "#8b5cf6", "#ec4899", "#06b6d4", "#84cc16"];

function empNombre(a: any) {
  return `${a.empleados.apellido}, ${a.empleados.nombre}`;
}

export default function RouteCard({
  hoja, index, hermanas, fecha, fabrica, empleadosDisponibles, onChange,
}: {
  hoja: any;
  index: number;
  hermanas: any[]; // el resto de las hojas del mismo tipo, para "mover a"
  fecha: string;
  fabrica: { nombre: string; lat: number; lng: number };
  empleadosDisponibles: any[]; // presentes, con coords, sin asiento en ninguna hoja de este tipo
  onChange: () => void;
}) {
  const confirmar = useConfirm();
  const color = COLORS[index % COLORS.length];
  const [horaSalida, setHoraSalida] = useState(hoja.hora_salida ?? "");
  const [addOpen, setAddOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [moveMenuFor, setMoveMenuFor] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const hojaTexto: HojaTexto = {
    tipo: hoja.tipo,
    vehiculoNombre: hoja.vehiculos?.nombre ?? "",
    choferNombre: hoja.choferes?.nombre ?? null,
    choferTelefono: hoja.choferes?.telefono ?? null,
    km: hoja.km,
    minutos: hoja.minutos,
    fabrica,
    paradas: hoja.asientos.map((a: any) => {
      const d = a.empleados.remises_empleados_datos;
      return { nombre: empNombre(a), direccion: d?.direccion ?? null, lat: Number(d?.lat ?? 0), lng: Number(d?.lng ?? 0) };
    }),
  };

  async function guardarHoraSalida() {
    await fetch(`/api/remises/hojas-ruta/${hoja.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ horaSalida }),
    });
  }

  async function reordenar(desde: number, hacia: number) {
    if (hacia < 0 || hacia >= hoja.asientos.length) return;
    const ids = hoja.asientos.map((a: any) => a.empleado_id);
    [ids[desde], ids[hacia]] = [ids[hacia], ids[desde]];
    setBusy(true);
    await fetch(`/api/remises/hojas-ruta/${hoja.id}/asientos`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ empleadoIds: ids }),
    });
    setBusy(false);
    onChange();
  }

  async function quitarEmpleado(empleadoId: string) {
    setBusy(true);
    await fetch(`/api/remises/hojas-ruta/${hoja.id}/asientos/${empleadoId}`, { method: "DELETE" });
    setBusy(false);
    onChange();
  }

  async function moverA(empleadoId: string, destinoHojaId: string) {
    setMoveMenuFor(null);
    setBusy(true);
    await fetch(`/api/remises/hojas-ruta/${hoja.id}/asientos/${empleadoId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ destinoHojaId }),
    });
    setBusy(false);
    onChange();
  }

  async function agregarEmpleado(empleadoId: string) {
    setBusy(true);
    await fetch(`/api/remises/hojas-ruta/${hoja.id}/asientos`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ empleadoId }),
    });
    setBusy(false);
    setAddOpen(false);
    onChange();
  }

  async function quitarRemis() {
    const ok = await confirmar({
      title: "Quitar remis",
      message: `¿Quitar "${hoja.vehiculos?.nombre}" de la ruta? Los empleados que llevaba quedan sin remis asignado.`,
      confirmText: "Quitar",
      danger: true,
    });
    if (!ok) return;
    await fetch(`/api/remises/hojas-ruta/${hoja.id}`, { method: "DELETE" });
    onChange();
  }

  const pax = hoja.asientos.length;

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 relative" style={{ opacity: busy ? 0.6 : 1 }}>
      <div className="flex items-center gap-2 flex-wrap mb-3">
        <span className="w-7 h-7 rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0" style={{ background: color }}>{index + 1}</span>
        <h3 className="font-medium text-gray-900">{hoja.vehiculos?.nombre}</h3>
        <div className="flex items-center gap-1.5 flex-wrap ml-auto">
          <span className="text-xs px-2 py-0.5 rounded-full bg-blue-50 text-blue-700">{hoja.km ?? "-"} km</span>
          <span className="text-xs px-2 py-0.5 rounded-full bg-amber-50 text-amber-700">~{hoja.minutos ?? "-"} min</span>
          <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-700">{pax}{hoja.vehiculos?.capacidad ? `/${hoja.vehiculos.capacidad}` : ""} pax</span>
          <label className="text-xs px-2 py-0.5 rounded-full bg-gray-50 border border-gray-200 flex items-center gap-1">
            Salida:
            <input type="time" value={horaSalida} onChange={(e) => setHoraSalida(e.target.value)} onBlur={guardarHoraSalida}
              className="bg-transparent outline-none w-16" />
          </label>
        </div>
      </div>

      <div className="space-y-1 mb-3">
        {hoja.asientos.map((a: any, si: number) => (
          <div key={a.empleado_id} className="flex items-start gap-2 py-1.5 border-b border-gray-50 last:border-0">
            <span className="w-6 h-6 rounded-full bg-gray-100 text-gray-600 text-xs font-bold flex items-center justify-center shrink-0 mt-0.5">{si + 1}</span>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium text-gray-800">{empNombre(a)}</div>
              <div className="text-xs text-gray-400 truncate">{a.empleados.remises_empleados_datos?.direccion ?? ""}</div>
              {moveMenuFor === a.empleado_id && (
                <div className="flex flex-wrap gap-1 mt-1">
                  {hermanas.map((h, hi) => (
                    <button key={h.id} onClick={() => moverA(a.empleado_id, h.id)}
                      className="text-[11px] text-white px-2 py-0.5 rounded-full" style={{ background: COLORS[hi % COLORS.length] }}>
                      → {h.vehiculos?.nombre}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <button disabled={si === 0} onClick={() => reordenar(si, si - 1)} className="text-gray-400 hover:text-gray-700 disabled:opacity-30 text-xs px-1">▲</button>
              <button disabled={si === hoja.asientos.length - 1} onClick={() => reordenar(si, si + 1)} className="text-gray-400 hover:text-gray-700 disabled:opacity-30 text-xs px-1">▼</button>
              {hermanas.length > 0 && (
                <button onClick={() => setMoveMenuFor(moveMenuFor === a.empleado_id ? null : a.empleado_id)} title="Mover a otro remis" className="text-gray-400 hover:text-gray-700 text-xs px-1">⇄</button>
              )}
              <button onClick={() => quitarEmpleado(a.empleado_id)} title="Quitar" className="text-red-400 hover:text-red-600 text-xs px-1">✕</button>
            </div>
          </div>
        ))}
        {hoja.asientos.length === 0 && <p className="text-xs text-gray-400 py-2">Sin pasajeros.</p>}
      </div>

      <div className="flex flex-wrap gap-2 text-xs">
        <a href={gmapsLink(hojaTexto)} target="_blank" rel="noreferrer" className="btn-primary !text-xs !py-1.5 !px-3">Google Maps</a>
        <a href={wazeLink(hojaTexto)} target="_blank" rel="noreferrer" className="border border-gray-300 rounded-md px-3 py-1.5 text-gray-700 hover:bg-gray-50">Waze</a>
        <button onClick={() => setShareOpen(true)} className="border border-gray-300 rounded-md px-3 py-1.5 text-gray-700 hover:bg-gray-50">Compartir</button>
        <a href={`/remises/hoja-ruta/${hoja.id}/imprimir`} target="_blank" rel="noreferrer" className="border border-gray-300 rounded-md px-3 py-1.5 text-gray-700 hover:bg-gray-50">Imprimir</a>
        <button onClick={() => { navigator.clipboard.writeText(textoRuta(hojaTexto, fecha)); }} className="border border-gray-300 rounded-md px-3 py-1.5 text-gray-700 hover:bg-gray-50">Copiar</button>
        {empleadosDisponibles.length > 0 && (
          <button onClick={() => setAddOpen((v) => !v)} className="border border-gray-300 rounded-md px-3 py-1.5 text-gray-700 hover:bg-gray-50">+ Persona</button>
        )}
        <button onClick={quitarRemis} className="text-red-600 px-3 py-1.5 hover:underline ml-auto">Quitar remis</button>
      </div>

      {addOpen && (
        <div className="mt-2 border border-gray-200 rounded-md p-2 max-h-40 overflow-y-auto space-y-1">
          {empleadosDisponibles.map((e) => (
            <button key={e.id} onClick={() => agregarEmpleado(e.id)}
              className="w-full text-left text-xs px-2 py-1 rounded hover:bg-gray-50 flex justify-between">
              <span>{e.apellido}, {e.nombre}</span>
              <span className="text-gray-400">+ agregar</span>
            </button>
          ))}
        </div>
      )}

      {shareOpen && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={() => setShareOpen(false)}>
          <div className="bg-white rounded-lg shadow-lg p-6 w-full max-w-md" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-medium text-gray-800 mb-3">Compartir ruta — {hoja.vehiculos?.nombre}</h3>
            <textarea readOnly value={textoRuta(hojaTexto, fecha)} rows={8}
              className="w-full border border-gray-300 rounded-md px-2 py-1.5 text-xs font-mono mb-3" />
            <div className="flex gap-2 flex-wrap">
              <a href={whatsappLink(textoRuta(hojaTexto, fecha), hoja.choferes?.telefono)} target="_blank" rel="noreferrer" className="btn-primary text-sm">WhatsApp</a>
              <a href={emailLink(`Ruta ${hoja.vehiculos?.nombre}`, textoRuta(hojaTexto, fecha))} className="border border-gray-300 rounded-md px-4 py-2 text-sm text-gray-700 hover:bg-gray-50">Email</a>
              <button onClick={() => { navigator.clipboard.writeText(textoRuta(hojaTexto, fecha)); setShareOpen(false); }}
                className="border border-gray-300 rounded-md px-4 py-2 text-sm text-gray-700 hover:bg-gray-50">Copiar</button>
              <button onClick={() => setShareOpen(false)} className="ml-auto text-sm text-gray-500 hover:underline">Cerrar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
