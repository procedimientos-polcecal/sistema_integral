"use client";

import { useEffect, useState } from "react";
import InfoTip from "@/components/InfoTip";
import { useConfirm } from "@/components/ConfirmProvider";

const TABS = ["turnos", "feriados", "configuracion"] as const;
type Tab = (typeof TABS)[number];
const TAB_LABEL: Record<Tab, string> = { turnos: "Turnos", feriados: "Feriados", configuracion: "Configuración" };

export default function AdministracionClient() {
  const [tab, setTab] = useState<Tab>("turnos");

  return (
    <div>
      <h1 className="text-xl font-bold text-gray-900 mb-4">Administración RRHH</h1>
      <div className="flex gap-2 mb-6">
        {TABS.map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-4 py-2 rounded-md text-sm ${tab === t ? "bg-gray-900 text-white" : "bg-white text-gray-600 hover:bg-gray-100"}`}>
            {TAB_LABEL[t]}
          </button>
        ))}
      </div>
      {tab === "turnos" && <Turnos />}
      {tab === "feriados" && <Feriados />}
      {tab === "configuracion" && <Configuracion />}
    </div>
  );
}

function Turnos() {
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
        )}
      </div>
    </div>
  );
}

function Feriados() {
  const confirmar = useConfirm();
  const [feriados, setFeriados] = useState<any[] | null>(null);
  const [nuevo, setNuevo] = useState({ fecha: "", nombre: "" });
  const [guardando, setGuardando] = useState(false);

  async function cargar() {
    const data = await fetch("/api/rrhh/feriados").then((r) => r.json());
    setFeriados(data);
  }
  useEffect(() => { cargar(); }, []);

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
  );
}

function Configuracion() {
  const [config, setConfig] = useState<any | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [guardado, setGuardado] = useState(false);

  useEffect(() => {
    fetch("/api/rrhh/configuracion").then((r) => r.json()).then(setConfig);
  }, []);

  async function guardar() {
    setGuardando(true);
    setGuardado(false);
    const res = await fetch("/api/rrhh/configuracion", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(config),
    });
    setGuardando(false);
    if (res.ok) { setConfig(await res.json()); setGuardado(true); }
  }

  if (!config) return <p className="text-gray-500 text-sm">Cargando...</p>;

  return (
    <div className="card p-5 max-w-3xl">
      <h2 className="font-medium text-gray-700 mb-3 flex items-center gap-1.5">
        Reglas de cálculo de horas
        <InfoTip text="Definen cómo se calculan las horas y su valor: cuántas horas son 'normales' por día, desde qué hora del sábado se paga extra, y los multiplicadores de las horas extra al 50% y 100%. Estos valores se usan en cada liquidación." />
      </h2>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-4">
        <div>
          <label className="block text-xs text-gray-500 mb-1">Horas normales por día</label>
          <input type="number" value={config.horasNormalesPorDia} onChange={(e) => setConfig({ ...config, horasNormalesPorDia: Number(e.target.value) })}
            className="w-full border border-gray-300 rounded-md px-2 py-1.5 text-sm" />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Corte sábado (hora)</label>
          <input type="time" value={config.horaCorteSabado} onChange={(e) => setConfig({ ...config, horaCorteSabado: e.target.value })}
            className="w-full border border-gray-300 rounded-md px-2 py-1.5 text-sm" />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Horas de franco compensatorio</label>
          <input type="number" value={config.horasFrancoCompensatorio} onChange={(e) => setConfig({ ...config, horasFrancoCompensatorio: Number(e.target.value) })}
            className="w-full border border-gray-300 rounded-md px-2 py-1.5 text-sm" />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Multiplicador extra 50% (ej. 1.5)</label>
          <input type="number" step="0.01" value={config.multiplicadorExtra50} onChange={(e) => setConfig({ ...config, multiplicadorExtra50: Number(e.target.value) })}
            className="w-full border border-gray-300 rounded-md px-2 py-1.5 text-sm" />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Multiplicador extra 100% (ej. 2.0)</label>
          <input type="number" step="0.01" value={config.multiplicadorExtra100} onChange={(e) => setConfig({ ...config, multiplicadorExtra100: Number(e.target.value) })}
            className="w-full border border-gray-300 rounded-md px-2 py-1.5 text-sm" />
        </div>
        <div className="flex items-end">
          <label className="flex items-center gap-2 text-sm text-gray-600">
            <input type="checkbox" checked={config.feriadoComoDomingo} onChange={(e) => setConfig({ ...config, feriadoComoDomingo: e.target.checked })} />
            Tratar feriados como domingo
          </label>
        </div>
      </div>

      <h3 className="text-sm font-medium text-gray-700 mb-2">Escala de vacaciones por antigüedad</h3>
      <div className="space-y-2 mb-4">
        {config.escalaVacaciones.map((tramo: any, i: number) => (
          <div key={i} className="flex gap-3 items-center">
            <span className="text-sm text-gray-500">Hasta</span>
            <input type="number" value={tramo.hastaAnios} onChange={(e) => {
              const escala = [...config.escalaVacaciones];
              escala[i] = { ...tramo, hastaAnios: Number(e.target.value) };
              setConfig({ ...config, escalaVacaciones: escala });
            }} className="w-20 border border-gray-300 rounded-md px-2 py-1 text-sm" />
            <span className="text-sm text-gray-500">años →</span>
            <input type="number" value={tramo.dias} onChange={(e) => {
              const escala = [...config.escalaVacaciones];
              escala[i] = { ...tramo, dias: Number(e.target.value) };
              setConfig({ ...config, escalaVacaciones: escala });
            }} className="w-20 border border-gray-300 rounded-md px-2 py-1 text-sm" />
            <span className="text-sm text-gray-500">días</span>
          </div>
        ))}
      </div>

      <button onClick={guardar} disabled={guardando} className="btn-primary disabled:opacity-50">
        {guardando ? "Guardando..." : "Guardar configuración"}
      </button>
      {guardado && <span className="ml-3 text-sm text-emerald-600">Guardado.</span>}
    </div>
  );
}
