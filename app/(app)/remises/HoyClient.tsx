"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import InfoTip from "@/components/InfoTip";
import RouteCard from "./RouteCard";

const RoutesMap = dynamic(() => import("@/components/remises/RoutesMap"), { ssr: false });

function hoy(): string {
  return new Date().toISOString().slice(0, 10);
}

export default function HoyClient({ nombreUsuario, turnos }: { nombreUsuario: string; turnos: any[] }) {
  const [fecha, setFecha] = useState(hoy());
  const [turnoId, setTurnoId] = useState(turnos[0]?.id ?? "");
  const [tab, setTab] = useState<"asistencia" | "ida" | "vuelta">("asistencia");

  const [config, setConfig] = useState<any | null>(null);
  const [vehiculos, setVehiculos] = useState<any[] | null>(null);
  const [empleados, setEmpleados] = useState<any[] | null>(null);
  const [presentIds, setPresentIds] = useState<string[] | null>(null);
  const [hojasIda, setHojasIda] = useState<any[] | null>(null);
  const [hojasVuelta, setHojasVuelta] = useState<any[] | null>(null);
  const [generando, setGenerando] = useState<"ida" | "vuelta" | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/remises/configuracion").then((r) => r.json()).then(setConfig);
    fetch("/api/remises/empleados").then((r) => r.json()).then(setEmpleados);
    fetch("/api/remises/vehiculos").then((r) => r.json()).then((vs) => setVehiculos(vs.filter((v: any) => v.activo)));
  }, []);

  const cargarAsistencia = useCallback(() => {
    if (!fecha || !turnoId) return;
    fetch(`/api/remises/asistencia?fecha=${fecha}&turnoId=${turnoId}`).then((r) => r.json()).then(setPresentIds);
  }, [fecha, turnoId]);

  const cargarHojas = useCallback(
    (tipo: "ida" | "vuelta") => {
      if (!fecha || !turnoId) return;
      fetch(`/api/remises/hojas-ruta?fecha=${fecha}&turnoId=${turnoId}&tipo=${tipo}`)
        .then((r) => r.json())
        .then(tipo === "ida" ? setHojasIda : setHojasVuelta);
    },
    [fecha, turnoId]
  );

  useEffect(() => { setPresentIds(null); cargarAsistencia(); }, [cargarAsistencia]);
  useEffect(() => { setHojasIda(null); setHojasVuelta(null); }, [fecha, turnoId]);
  useEffect(() => { if (tab === "ida") cargarHojas("ida"); }, [tab, cargarHojas]);
  useEffect(() => { if (tab === "vuelta") cargarHojas("vuelta"); }, [tab, cargarHojas]);

  const empleadosActivos = empleados ?? [];
  const presentSet = useMemo(() => new Set(presentIds ?? []), [presentIds]);

  async function toggleAsistencia(empleadoId: string) {
    const res = await fetch("/api/remises/asistencia", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ empleadoId, fecha, turnoId }),
    });
    const { presente } = await res.json();
    setPresentIds((ids) => {
      const set = new Set(ids ?? []);
      if (presente) set.add(empleadoId); else set.delete(empleadoId);
      return [...set];
    });
  }

  async function marcarSegunTurnoDefault() {
    await fetch("/api/remises/asistencia/seed-default", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fecha, turnoId }),
    });
    cargarAsistencia();
  }

  async function generar(tipo: "ida" | "vuelta") {
    setGenerando(tipo);
    setAviso(null);
    const res = await fetch("/api/remises/generar", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fecha, turnoId, tipo }),
    });
    setGenerando(null);
    const data = await res.json();
    if (!res.ok) { setAviso(data.error ?? "No se pudo generar"); return; }
    if (data.empleadosSinCoordenadas > 0) setAviso(`${data.empleadosSinCoordenadas} empleado(s) sin coordenadas fueron ignorados.`);
    else if (data.capacidadInsuficiente) setAviso("La capacidad total de los vehículos es menor a la cantidad de empleados presentes. Se repartieron igual.");
    setTab(tipo);
    cargarHojas(tipo);
  }

  const hojasTab = tab === "ida" ? hojasIda : tab === "vuelta" ? hojasVuelta : null;

  const empleadosPresentesConCoords = useMemo(
    () => (empleados ?? []).filter((e) => presentSet.has(e.id) && e.remises_empleados_datos?.lat != null),
    [empleados, presentSet]
  );
  const empleadosDisponiblesPorHoja = useCallback(
    (hojaId: string) => {
      const asignadosEnOtras = new Set(
        (hojasTab ?? []).flatMap((h) => (h.id === hojaId ? [] : h.asientos.map((a: any) => a.empleado_id)))
      );
      const enEstaHoja = new Set((hojasTab ?? []).find((h) => h.id === hojaId)?.asientos.map((a: any) => a.empleado_id) ?? []);
      return empleadosPresentesConCoords.filter((e) => !asignadosEnOtras.has(e.id) && !enEstaHoja.has(e.id));
    },
    [hojasTab, empleadosPresentesConCoords]
  );

  const fabrica = config ? { nombre: config.fabricaNombre, lat: config.fabricaLat, lng: config.fabricaLng } : { nombre: "Fábrica", lat: null, lng: null };

  return (
    <div>
      <h1 className="text-xl font-bold text-gray-900 mb-1">Hola, {nombreUsuario}</h1>
      <p className="text-gray-500 mb-6">Remises — asistencia y rutas del día</p>

      <div className="flex gap-4 mb-6 card p-4 flex-wrap items-end">
        <div>
          <label className="block text-xs text-gray-500 mb-1">Fecha</label>
          <input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} className="border border-gray-300 rounded-md px-2 py-1.5 text-sm" />
        </div>
        {turnos.length > 1 && (
          <div className="flex gap-1.5">
            {turnos.map((t) => (
              <button key={t.id} onClick={() => setTurnoId(t.id)}
                className="px-3 py-1.5 rounded-md text-sm border"
                style={turnoId === t.id ? { background: t.color, borderColor: t.color, color: "#fff" } : { color: t.color, borderColor: `${t.color}44` }}>
                {t.nombre}
              </button>
            ))}
          </div>
        )}
        <div className="ml-auto flex items-center gap-3">
          <a href={`/api/remises/export?scope=day&fecha=${fecha}`} className="text-sm text-blue-600 hover:underline">Exportar</a>
          <button onClick={() => generar("ida")} disabled={generando !== null} className="btn-primary disabled:opacity-50">
            {generando === "ida" ? "Generando..." : "Generar Ida"}
          </button>
          <button onClick={() => generar("vuelta")} disabled={generando !== null} className="btn-primary disabled:opacity-50">
            {generando === "vuelta" ? "Generando..." : "Generar Vuelta"}
          </button>
        </div>
      </div>

      {aviso && <p className="text-sm text-amber-600 mb-4">{aviso}</p>}

      <div className="flex gap-2 mb-4">
        {(["asistencia", "ida", "vuelta"] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-4 py-2 rounded-md text-sm ${tab === t ? "bg-gray-900 text-white" : "bg-white text-gray-600 hover:bg-gray-100"}`}>
            {t === "asistencia" ? "Asistencia" : t === "ida" ? "Rutas Ida" : "Rutas Vuelta"}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div>
          {tab === "asistencia" && (
            <div className="card p-5">
              <div className="flex items-center justify-between mb-3">
                <h2 className="font-medium text-gray-700 flex items-center gap-1.5">
                  Asistencia
                  <InfoTip text="Marcá qué empleados vienen hoy en este turno. Solo los presentes con coordenadas geocodificadas entran en la generación de rutas." />
                </h2>
                <button onClick={marcarSegunTurnoDefault} className="text-xs text-blue-600 hover:underline">Marcar según turno default</button>
              </div>
              {!empleados || !presentIds ? (
                <p className="text-sm text-gray-500">Cargando...</p>
              ) : empleadosActivos.length === 0 ? (
                <p className="text-sm text-gray-500">Todavía no hay empleados con datos de Remises cargados.</p>
              ) : (
                <>
                  <p className="text-xs text-gray-400 mb-2">{presentSet.size} / {empleadosActivos.length} presentes</p>
                  <div className="space-y-1 max-h-[560px] overflow-y-auto">
                    {empleadosActivos.map((e) => {
                      const on = presentSet.has(e.id);
                      const tieneCoords = e.remises_empleados_datos?.lat != null;
                      return (
                        <button key={e.id} onClick={() => toggleAsistencia(e.id)}
                          className={`w-full flex items-center gap-3 px-3 py-2 rounded-md text-left ${on ? "bg-emerald-50" : "hover:bg-gray-50"}`}>
                          <span className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${on ? "bg-emerald-500 text-white" : "bg-gray-200 text-gray-600"}`}>
                            {on ? "✓" : e.nombre[0]}
                          </span>
                          <div className="flex-1 min-w-0">
                            <div className="text-sm font-medium text-gray-800">{e.apellido}, {e.nombre}</div>
                            <div className="text-xs text-gray-400 truncate">{e.remises_empleados_datos?.direccion || e.domicilio || "Sin dirección"}</div>
                          </div>
                          {!tieneCoords && <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 shrink-0">Sin coords</span>}
                        </button>
                      );
                    })}
                  </div>
                </>
              )}
            </div>
          )}

          {(tab === "ida" || tab === "vuelta") && (
            <div className="space-y-4">
              {!hojasTab ? (
                <p className="text-sm text-gray-500">Cargando...</p>
              ) : hojasTab.length === 0 ? (
                <div className="card p-5 text-center text-sm text-gray-400">Sin rutas. Generalas desde el botón de arriba.</div>
              ) : (
                hojasTab.map((h, i) => (
                  <RouteCard key={h.id} hoja={h} index={i} hermanas={hojasTab.filter((x) => x.id !== h.id)}
                    fecha={fecha} fabrica={fabrica as any}
                    empleadosDisponibles={empleadosDisponiblesPorHoja(h.id)}
                    onChange={() => cargarHojas(tab)} />
                ))
              )}
              {hojasTab && vehiculos && (
                <AgregarRemisCard tab={tab} fecha={fecha} turnoId={turnoId} vehiculos={vehiculos} hojasTab={hojasTab}
                  empleadosPresentesConCoords={empleadosPresentesConCoords} onChange={() => cargarHojas(tab)} />
              )}
            </div>
          )}
        </div>

        <div className="h-[600px] lg:sticky lg:top-4">
          <RoutesMap hojas={hojasTab ?? []} fabrica={fabrica} />
        </div>
      </div>
    </div>
  );
}

function AgregarRemisCard({
  tab, fecha, turnoId, vehiculos, hojasTab, empleadosPresentesConCoords, onChange,
}: {
  tab: "ida" | "vuelta";
  fecha: string;
  turnoId: string;
  vehiculos: any[];
  hojasTab: any[];
  empleadosPresentesConCoords: any[];
  onChange: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [vehiculoId, setVehiculoId] = useState("");
  const [seleccionados, setSeleccionados] = useState<Set<string>>(new Set());
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const asignados = new Set(hojasTab.flatMap((h) => h.asientos.map((a: any) => a.empleado_id)));
  const disponibles = empleadosPresentesConCoords.filter((e) => !asignados.has(e.id));
  const vehiculosUsados = new Set(hojasTab.map((h) => h.vehiculo_id));
  const vehiculosDisponibles = vehiculos.filter((v) => !vehiculosUsados.has(v.id));
  const opcionesVehiculo = vehiculosDisponibles.length > 0 ? vehiculosDisponibles : vehiculos;

  function abrir() {
    setVehiculoId(opcionesVehiculo[0]?.id ?? "");
    setSeleccionados(new Set(disponibles.map((e) => e.id)));
    setError(null);
    setOpen(true);
  }

  function toggle(id: string) {
    setSeleccionados((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  async function confirmar() {
    if (!vehiculoId || seleccionados.size === 0) { setError("Elegí un vehículo y al menos un empleado"); return; }
    setGuardando(true);
    setError(null);
    const res = await fetch("/api/remises/hojas-ruta", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fecha, turnoId, tipo: tab, vehiculoId, empleadoIds: [...seleccionados] }),
    });
    setGuardando(false);
    if (res.ok) { setOpen(false); onChange(); }
    else { const data = await res.json(); setError(data.error ?? "No se pudo agregar el remis"); }
  }

  if (!open) {
    return (
      <button onClick={abrir} className="w-full border border-dashed border-gray-300 rounded-xl py-3 text-sm text-gray-500 hover:bg-gray-50">
        + Agregar remis
      </button>
    );
  }

  return (
    <div className="card p-5">
      <h3 className="font-medium text-gray-800 mb-3">Agregar remis</h3>
      <div className="mb-3">
        <label className="block text-xs text-gray-500 mb-1">Vehículo</label>
        <select value={vehiculoId} onChange={(e) => setVehiculoId(e.target.value)} className="w-full border border-gray-300 rounded-md px-2 py-1.5 text-sm">
          {opcionesVehiculo.map((v) => <option key={v.id} value={v.id}>{v.nombre}{v.capacidad ? ` (${v.capacidad} pax)` : ""}</option>)}
        </select>
      </div>
      <div className="mb-3">
        <label className="block text-xs text-gray-500 mb-1">Empleados</label>
        {disponibles.length === 0 ? (
          <p className="text-xs text-gray-400">No hay empleados disponibles (todos ya tienen remis o no tienen coordenadas).</p>
        ) : (
          <div className="max-h-48 overflow-y-auto space-y-1 border border-gray-200 rounded-md p-2">
            {disponibles.map((e) => (
              <label key={e.id} className="flex items-center gap-2 text-sm cursor-pointer">
                <input type="checkbox" checked={seleccionados.has(e.id)} onChange={() => toggle(e.id)} />
                {e.apellido}, {e.nombre}
              </label>
            ))}
          </div>
        )}
      </div>
      {error && <p className="text-xs text-red-600 mb-2">{error}</p>}
      <div className="flex gap-2">
        <button onClick={confirmar} disabled={guardando} className="btn-primary disabled:opacity-50">
          {guardando ? "Agregando..." : "Agregar"}
        </button>
        <button onClick={() => setOpen(false)} className="border border-gray-300 px-4 py-2 rounded-md text-sm text-gray-700 hover:bg-gray-50">Cancelar</button>
      </div>
    </div>
  );
}
