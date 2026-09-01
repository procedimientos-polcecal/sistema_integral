"use client";

import { useEffect, useState } from "react";
import InfoTip from "@/components/InfoTip";
import { useConfirm } from "@/components/ConfirmProvider";
import { hoyEnArgentina, comoSeLee } from "@/lib/core/fechas";

const hoy = hoyEnArgentina;
const fmt = comoSeLee;

export default function HistorialClient({ turnos }: { turnos: any[] }) {
  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-gray-900">Historial</h1>
        <a href="/api/remises/export?scope=hist" className="text-sm text-blue-600 hover:underline">Exportar historial</a>
      </div>
      <PlantillasSection turnos={turnos} />
      <HistorialSection turnos={turnos} />
    </div>
  );
}

function PlantillasSection({ turnos }: { turnos: any[] }) {
  const confirmar = useConfirm();
  const [plantillas, setPlantillas] = useState<any[] | null>(null);
  const [aplicando, setAplicando] = useState<{ p: any; fecha: string } | null>(null);
  const [mensaje, setMensaje] = useState<string | null>(null);

  function cargar() {
    fetch("/api/remises/plantillas").then((r) => r.json()).then(setPlantillas);
  }
  useEffect(cargar, []);

  async function eliminar(p: any) {
    const ok = await confirmar({ title: "Eliminar plantilla", message: `¿Eliminar la plantilla "${p.nombre}"?`, confirmText: "Eliminar", danger: true });
    if (!ok) return;
    await fetch(`/api/remises/plantillas/${p.id}`, { method: "DELETE" });
    cargar();
  }

  async function aplicar() {
    if (!aplicando) return;
    const res = await fetch(`/api/remises/plantillas/${aplicando.p.id}/aplicar`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fecha: aplicando.fecha, turnoId: aplicando.p.turno_id }),
    });
    const data = await res.json();
    setAplicando(null);
    setMensaje(res.ok ? `Aplicada — ${data.hojasCreadas} remis generado(s)` : data.error ?? "No se pudo aplicar");
  }

  const empleadosUnicos = (p: any) => new Set((p.remises_plantillas_grupos ?? []).map((g: any) => g.empleado_id)).size;

  return (
    <section>
      <h2 className="font-medium text-gray-700 mb-3 flex items-center gap-1.5">
        Plantillas guardadas
        <InfoTip text="Configuraciones de vehículo + empleados guardadas para reaplicar en cualquier fecha futura. Al aplicar, se recalcula el orden y la ruta contra los datos actuales." />
      </h2>
      {mensaje && <p className="text-sm text-emerald-600 mb-2">{mensaje}</p>}
      <div className="card p-5">
        {!plantillas ? (
          <p className="text-sm text-gray-500">Cargando...</p>
        ) : plantillas.length === 0 ? (
          <p className="text-sm text-gray-500">Todavía no hay plantillas guardadas.</p>
        ) : (
          <div className="space-y-2">
            {plantillas.map((p) => (
              <div key={p.id} className="border border-gray-200 rounded-md px-3 py-2">
                <div className="flex items-center gap-3 flex-wrap">
                  <span className="font-medium text-sm text-gray-800">{p.nombre}</span>
                  <span className="text-xs text-gray-400">{p.tipo === "ida" ? "Ida" : "Vuelta"} · {p.remises_turnos?.nombre} · {empleadosUnicos(p)} empleados</span>
                  <div className="ml-auto flex gap-3">
                    <button onClick={() => setAplicando({ p, fecha: hoy() })} className="text-blue-600 underline text-xs">Aplicar</button>
                    <button onClick={() => eliminar(p)} className="text-red-600 underline text-xs">Eliminar</button>
                  </div>
                </div>
                {aplicando && aplicando.p.id === p.id && (
                  <div className="flex items-center gap-2 mt-2">
                    <input type="date" value={aplicando.fecha} onChange={(e) => setAplicando({ p, fecha: e.target.value })}
                      className="border border-gray-300 rounded-md px-2 py-1 text-sm" />
                    <button onClick={aplicar} className="btn-primary text-xs">Confirmar</button>
                    <button onClick={() => setAplicando(null)} className="text-xs text-gray-500 hover:underline">Cancelar</button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function HistorialSection({ turnos }: { turnos: any[] }) {
  const [grupos, setGrupos] = useState<any[] | null>(null);
  const [reutilizando, setReutilizando] = useState<{ g: any; fecha: string } | null>(null);
  const [guardandoPlantilla, setGuardandoPlantilla] = useState<{ g: any; nombre: string } | null>(null);
  const [mensaje, setMensaje] = useState<string | null>(null);

  function cargar() {
    fetch("/api/remises/historial").then((r) => r.json()).then(setGrupos);
  }
  useEffect(cargar, []);

  async function reutilizar() {
    if (!reutilizando) return;
    const hojaIds = reutilizando.g.hojas.map((h: any) => h.id);
    const res = await fetch("/api/remises/historial/reutilizar", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ hojaIds, fecha: reutilizando.fecha, turnoId: reutilizando.g.turnoId, tipo: reutilizando.g.tipo }),
    });
    const data = await res.json();
    setReutilizando(null);
    setMensaje(res.ok ? `Reutilizado — ${data.hojasCreadas} remis generado(s)` : data.error ?? "No se pudo reutilizar");
  }

  async function guardarPlantilla() {
    if (!guardandoPlantilla || !guardandoPlantilla.nombre.trim()) return;
    const hojaIds = guardandoPlantilla.g.hojas.map((h: any) => h.id);
    const res = await fetch("/api/remises/plantillas", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nombre: guardandoPlantilla.nombre, turnoId: guardandoPlantilla.g.turnoId, hojaIds }),
    });
    setGuardandoPlantilla(null);
    setMensaje(res.ok ? "Plantilla guardada" : "No se pudo guardar la plantilla");
  }

  return (
    <section>
      <h2 className="font-medium text-gray-700 mb-3 flex items-center gap-1.5">
        Historial de rutas
        <InfoTip text="Las últimas rutas generadas, agrupadas por fecha, turno y tipo. Podés reutilizar una configuración en una fecha nueva o guardarla como plantilla." />
      </h2>
      {mensaje && <p className="text-sm text-emerald-600 mb-2">{mensaje}</p>}
      <div className="space-y-3">
        {!grupos ? (
          <p className="text-sm text-gray-500">Cargando...</p>
        ) : grupos.length === 0 ? (
          <div className="card p-5 text-sm text-gray-500">Todavía no se generaron rutas.</div>
        ) : (
          grupos.map((g) => {
            const clave = `${g.fecha}__${g.turnoId}__${g.tipo}`;
            return (
              <div key={clave} className="card p-4">
                <div className="flex items-center gap-3 flex-wrap">
                  <span className="font-medium text-sm text-gray-800">{fmt(g.fecha)}</span>
                  <span className="text-xs text-gray-400">{g.tipo === "ida" ? "Ida" : "Vuelta"} · {g.turnoNombre}</span>
                  <span className="text-xs text-gray-400">{g.hojas.length} remis</span>
                  <div className="ml-auto flex gap-3">
                    <button onClick={() => setReutilizando({ g, fecha: hoy() })} className="text-blue-600 underline text-xs">Reutilizar</button>
                    <button onClick={() => setGuardandoPlantilla({ g, nombre: `${g.turnoNombre} ${g.tipo === "ida" ? "IDA" : "VUELTA"}` })} className="text-gray-700 underline text-xs">Guardar como plantilla</button>
                  </div>
                </div>
                <div className="mt-2 text-xs text-gray-500 space-y-0.5">
                  {g.hojas.map((h: any) => (
                    <div key={h.id}>{h.vehiculos?.nombre} — {(h.asientos ?? []).map((a: any) => `${a.empleados.apellido}, ${a.empleados.nombre}`).join("; ")}</div>
                  ))}
                </div>
                {reutilizando && reutilizando.g === g && (
                  <div className="flex items-center gap-2 mt-2">
                    <input type="date" value={reutilizando.fecha} onChange={(e) => setReutilizando({ g, fecha: e.target.value })}
                      className="border border-gray-300 rounded-md px-2 py-1 text-sm" />
                    <button onClick={reutilizar} className="btn-primary text-xs">Confirmar</button>
                    <button onClick={() => setReutilizando(null)} className="text-xs text-gray-500 hover:underline">Cancelar</button>
                  </div>
                )}
                {guardandoPlantilla && guardandoPlantilla.g === g && (
                  <div className="flex items-center gap-2 mt-2">
                    <input value={guardandoPlantilla.nombre} onChange={(e) => setGuardandoPlantilla({ g, nombre: e.target.value })}
                      className="border border-gray-300 rounded-md px-2 py-1 text-sm flex-1" />
                    <button onClick={guardarPlantilla} className="btn-primary text-xs">Guardar</button>
                    <button onClick={() => setGuardandoPlantilla(null)} className="text-xs text-gray-500 hover:underline">Cancelar</button>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </section>
  );
}
