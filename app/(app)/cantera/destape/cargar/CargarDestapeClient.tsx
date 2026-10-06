"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  ETIQUETA_TIPO_CAMION, ETIQUETA_TIPO_RECURSO, TIPOS_DE_CAMION, TIPOS_DE_RECURSO,
  type TipoDeCamion, type TipoDeRecurso,
} from "@/lib/cantera/destape";
import type { DestapeDB, Fletero, Yacimiento } from "@/lib/cantera/types";
import type { EmpleadoLiviano } from "@/lib/cantera/consultas";

const INPUT_CLS = "mt-1 w-full rounded border border-slate-300 px-2 py-1 text-sm";
const num = new Intl.NumberFormat("es-AR", { maximumFractionDigits: 1 });

interface EquipoLiviano { id: string; code: string; name: string }

function formVacio() {
  // eslint-disable-next-line react-hooks/purity -- se resuelve una vez, no en cada render
  const hoy = new Date().toISOString().slice(0, 10);
  return {
    fecha: hoy,
    yacimientoCodigo: "",
    frente: "",
    tipoRecurso: "fletero_externo" as TipoDeRecurso,
    operarioId: "",
    equipoId: "",
    fleteroId: "",
    tipoCamion: "camion_grande" as TipoDeCamion,
    horas: "",
    viajes: "",
    observaciones: "",
  };
}

export default function CargarDestapeClient({
  yacimientos, fleteros, operarios, equipos, recientes,
}: {
  yacimientos: Yacimiento[];
  fleteros: Fletero[];
  operarios: EmpleadoLiviano[];
  equipos: EquipoLiviano[];
  recientes: DestapeDB[];
}) {
  const router = useRouter();
  const [form, setForm] = useState(formVacio());
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");
  const [aviso, setAviso] = useState("");

  function set<K extends keyof ReturnType<typeof formVacio>>(k: K, v: ReturnType<typeof formVacio>[K]) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  async function guardar() {
    setError("");
    setAviso("");
    const horas = Number(form.horas);
    if (!isFinite(horas) || horas <= 0) { setError("Las horas tienen que ser un número mayor a cero"); return; }

    let recurso_raw = "";
    let equipo_o_vehiculo_raw = "";
    let operario_id: string | null = null;
    let fletero_id: string | null = null;

    if (form.tipoRecurso === "operario_propio") {
      const operario = operarios.find((o) => o.id === form.operarioId);
      const equipo = equipos.find((e) => e.id === form.equipoId);
      if (!operario || !equipo) { setError("Elegí operario y equipo"); return; }
      operario_id = operario.id;
      recurso_raw = `${operario.nombre} ${operario.apellido}`;
      equipo_o_vehiculo_raw = `${equipo.code} - ${equipo.name}`;
    } else {
      const fletero = fleteros.find((f) => f.id === form.fleteroId);
      if (!fletero) { setError("Elegí el fletero"); return; }
      fletero_id = fletero.id;
      recurso_raw = fletero.nombre;
      equipo_o_vehiculo_raw = ETIQUETA_TIPO_CAMION[form.tipoCamion];
    }

    setGuardando(true);
    try {
      const res = await fetch("/api/cantera/destape", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fecha: form.fecha,
          yacimiento_codigo: form.yacimientoCodigo || null,
          frente: form.frente || null,
          tipo_recurso: form.tipoRecurso,
          operario_id,
          fletero_id,
          recurso_raw,
          equipo_id: form.tipoRecurso === "operario_propio" ? form.equipoId : null,
          equipo_o_vehiculo_raw,
          tipo_camion: form.tipoRecurso === "fletero_externo" ? form.tipoCamion : null,
          horas,
          viajes: form.tipoRecurso === "fletero_externo" && form.viajes !== "" ? Number(form.viajes) : null,
          observaciones: form.observaciones || null,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "No se pudo guardar");
      setForm({ ...formVacio(), fecha: form.fecha, yacimientoCodigo: form.yacimientoCodigo, tipoRecurso: form.tipoRecurso });
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo guardar");
    } finally {
      setGuardando(false);
    }
  }

  async function borrar(id: string) {
    if (!window.confirm("¿Borrar este registro?")) return;
    const res = await fetch(`/api/cantera/destape?id=${id}`, { method: "DELETE" });
    if (!res.ok) { setError((await res.json()).error ?? "No se pudo borrar"); return; }
    router.refresh();
  }

  return (
    <div className="mx-auto max-w-2xl">
      <Link href="/cantera/destape" className="text-xs text-slate-500 underline">← Destape</Link>
      <h1 className="mt-1 text-xl font-semibold">Cargar destape</h1>
      <p className="mt-1 text-sm text-slate-500">Un recurso (máquina propia u operario, o fletero con camión) por día.</p>

      {error && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      {aviso && <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-700">{aviso}</p>}

      <div className="mt-4 card p-4">
        <div className="grid grid-cols-2 gap-3">
          <label className="text-xs text-slate-600">
            Fecha
            <input type="date" className={INPUT_CLS} value={form.fecha} onChange={(e) => set("fecha", e.target.value)} />
          </label>
          <label className="text-xs text-slate-600">
            Yacimiento
            <select className={INPUT_CLS} value={form.yacimientoCodigo} onChange={(e) => set("yacimientoCodigo", e.target.value)}>
              <option value="">Sin especificar</option>
              {yacimientos.map((y) => <option key={y.id} value={y.codigo}>{y.codigo} — {y.nombre}</option>)}
            </select>
          </label>
        </div>
        <label className="mt-2 block text-xs text-slate-600">
          Frente / sector (opcional)
          <input className={INPUT_CLS} value={form.frente} onChange={(e) => set("frente", e.target.value)} />
        </label>

        <div className="mt-3 flex gap-2">
          {TIPOS_DE_RECURSO.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => set("tipoRecurso", t)}
              className={`rounded-full px-3 py-1 text-sm font-medium transition-colors ${
                form.tipoRecurso === t ? "bg-slate-800 text-white" : "bg-slate-100 text-slate-500 hover:bg-slate-200"
              }`}
            >
              {ETIQUETA_TIPO_RECURSO[t]}
            </button>
          ))}
        </div>

        {form.tipoRecurso === "operario_propio" ? (
          <div className="mt-3 grid grid-cols-2 gap-3">
            <label className="text-xs text-slate-600">
              Operario
              <select className={INPUT_CLS} value={form.operarioId} onChange={(e) => set("operarioId", e.target.value)}>
                <option value="">Elegir...</option>
                {operarios.map((o) => <option key={o.id} value={o.id}>{o.apellido}, {o.nombre}</option>)}
              </select>
            </label>
            <label className="text-xs text-slate-600">
              Equipo
              <select className={INPUT_CLS} value={form.equipoId} onChange={(e) => set("equipoId", e.target.value)}>
                <option value="">Elegir...</option>
                {equipos.map((eq) => <option key={eq.id} value={eq.id}>{eq.code} - {eq.name}</option>)}
              </select>
            </label>
          </div>
        ) : (
          <div className="mt-3 grid grid-cols-3 gap-3">
            <label className="text-xs text-slate-600">
              Fletero
              <select className={INPUT_CLS} value={form.fleteroId} onChange={(e) => set("fleteroId", e.target.value)}>
                <option value="">Elegir...</option>
                {fleteros.map((f) => <option key={f.id} value={f.id}>{f.nombre}</option>)}
              </select>
            </label>
            <label className="text-xs text-slate-600">
              Tipo de camión
              <select className={INPUT_CLS} value={form.tipoCamion} onChange={(e) => set("tipoCamion", e.target.value as TipoDeCamion)}>
                {TIPOS_DE_CAMION.map((t) => <option key={t} value={t}>{ETIQUETA_TIPO_CAMION[t]}</option>)}
              </select>
            </label>
            <label className="text-xs text-slate-600">
              Viajes (opcional)
              <input className={INPUT_CLS} inputMode="numeric" value={form.viajes} onChange={(e) => set("viajes", e.target.value)} />
            </label>
          </div>
        )}

        <div className="mt-3 grid grid-cols-2 gap-3">
          <label className="text-xs text-slate-600">
            Horas
            <input className={INPUT_CLS} inputMode="decimal" value={form.horas} onChange={(e) => set("horas", e.target.value)} />
          </label>
          <label className="text-xs text-slate-600">
            Observaciones (opcional)
            <input className={INPUT_CLS} value={form.observaciones} onChange={(e) => set("observaciones", e.target.value)} />
          </label>
        </div>

        <button disabled={guardando} onClick={guardar} className="mt-4 rounded-lg bg-slate-800 px-3 py-2 text-sm text-white disabled:opacity-50">
          {guardando ? "Guardando…" : "Cargar"}
        </button>
      </div>

      <h2 className="mt-6 text-sm font-semibold text-slate-700">Últimos 7 días</h2>
      {recientes.length === 0 ? (
        <p className="mt-1 text-sm text-slate-400">Sin registros recientes.</p>
      ) : (
        <ul className="mt-2 space-y-1">
          {[...recientes].sort((a, b) => b.fecha.localeCompare(a.fecha)).map((r) => (
            <li key={r.id} className="flex items-center justify-between rounded-lg border border-slate-100 px-3 py-2 text-sm">
              <span>
                <span className="font-medium">{r.fecha}</span> — {r.yacimiento_codigo ?? "sin yacimiento"} — {r.recurso_raw} ({r.equipo_o_vehiculo_raw}) — {num.format(r.horas)} h
              </span>
              <button onClick={() => borrar(r.id)} className="text-xs text-red-600 hover:underline">Borrar</button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
