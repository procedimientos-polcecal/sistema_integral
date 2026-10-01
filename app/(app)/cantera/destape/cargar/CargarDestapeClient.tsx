"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  ETIQUETA_TIPO_CAMION, ETIQUETA_TIPO_RECURSO, TIPOS_DE_CAMION, TIPOS_DE_RECURSO,
  type AcarreoDeDestape, type TipoDeCamion, type TipoDeRecurso,
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
    id: null as string | null,
    fecha: hoy,
    yacimientoCodigo: "",
    frente: "",
    tipoRecurso: "fletero_externo" as TipoDeRecurso,
    operarioId: "",
    equipoId: "",
    /** Carga de "horas_destape" de Acarreo elegida — reemplaza al fletero manual, ver lib/cantera/destape.ts. */
    acarreoId: "",
    /** Sólo para editar un registro viejo (de antes del 01/10/2026) sin `acarreo_id`, con fletero tipeado a mano. */
    fleteroId: "",
    horas: "",
    tipoCamion: "camion_grande" as TipoDeCamion,
    viajes: "",
    observaciones: "",
  };
}

export default function CargarDestapeClient({
  yacimientos, fleteros, operarios, equipos, recientes, pendientesAcarreo,
}: {
  yacimientos: Yacimiento[];
  fleteros: Fletero[];
  operarios: EmpleadoLiviano[];
  equipos: EquipoLiviano[];
  recientes: DestapeDB[];
  /** Horas de Acarreo ("horas_destape") sin yacimiento asignado todavía — el pool del que se elige en vez de cargar el fletero a mano. */
  pendientesAcarreo: AcarreoDeDestape[];
}) {
  const router = useRouter();
  const [form, setForm] = useState(formVacio());
  // true mientras se edita un registro de fletero_externo que ya existía sin
  // `acarreo_id` (de antes del 01/10/2026) — ese caso sigue pidiendo el
  // fletero y las horas a mano, porque no hay de qué carga de Acarreo tirar.
  const [editandoLegacySinAcarreo, setEditandoLegacySinAcarreo] = useState(false);
  // La opción del selector para la carga de Acarreo que YA tiene asignada el
  // registro que se está editando — sin esto, al editar desaparecería de la
  // lista (el server la excluye de "pendientes" por estar usada por este
  // mismo registro) y el selector quedaría en blanco.
  const [opcionExtraAcarreo, setOpcionExtraAcarreo] = useState<AcarreoDeDestape | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");
  const [aviso, setAviso] = useState("");

  function set<K extends keyof ReturnType<typeof formVacio>>(k: K, v: ReturnType<typeof formVacio>[K]) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  const fleteroPorId = new Map(fleteros.map((f) => [f.id, f.nombre]));
  const opcionesAcarreo = opcionExtraAcarreo && !pendientesAcarreo.some((a) => a.acarreoId === opcionExtraAcarreo.acarreoId)
    ? [opcionExtraAcarreo, ...pendientesAcarreo]
    : pendientesAcarreo;

  function cancelarEdicion() {
    setForm(formVacio());
    setEditandoLegacySinAcarreo(false);
    setOpcionExtraAcarreo(null);
    setError("");
  }

  function iniciarEdicion(r: DestapeDB) {
    setError("");
    setAviso("");
    if (r.tipo_recurso === "operario_propio") {
      setForm({
        ...formVacio(),
        id: r.id,
        fecha: r.fecha,
        yacimientoCodigo: r.yacimiento_codigo ?? "",
        frente: r.frente ?? "",
        tipoRecurso: "operario_propio",
        operarioId: r.operario_id ?? "",
        equipoId: r.equipo_id ?? "",
        horas: String(r.horas),
        observaciones: r.observaciones ?? "",
      });
      setEditandoLegacySinAcarreo(false);
    } else {
      setForm({
        ...formVacio(),
        id: r.id,
        fecha: r.fecha,
        yacimientoCodigo: r.yacimiento_codigo ?? "",
        frente: r.frente ?? "",
        tipoRecurso: "fletero_externo",
        acarreoId: r.acarreo_id ?? "",
        fleteroId: r.fletero_id ?? "",
        horas: String(r.horas),
        tipoCamion: (r.tipo_camion as TipoDeCamion) ?? "camion_grande",
        viajes: r.viajes !== null ? String(r.viajes) : "",
        observaciones: r.observaciones ?? "",
      });
      setEditandoLegacySinAcarreo(r.acarreo_id === null);
      setOpcionExtraAcarreo(
        r.acarreo_id !== null && r.fletero_id !== null
          ? { acarreoId: r.acarreo_id, fleteroId: r.fletero_id, fecha: r.fecha, horas: r.horas }
          : null
      );
    }
  }

  async function guardar() {
    setError("");
    setAviso("");

    let cuerpo: Record<string, unknown> = {
      fecha: form.fecha,
      yacimiento_codigo: form.yacimientoCodigo || null,
      frente: form.frente || null,
      tipo_recurso: form.tipoRecurso,
      observaciones: form.observaciones || null,
    };

    if (form.tipoRecurso === "operario_propio") {
      const operario = operarios.find((o) => o.id === form.operarioId);
      const equipo = equipos.find((e) => e.id === form.equipoId);
      if (!operario || !equipo) { setError("Elegí operario y equipo"); return; }
      const horas = Number(form.horas);
      if (!isFinite(horas) || horas <= 0) { setError("Las horas tienen que ser un número mayor a cero"); return; }
      cuerpo = {
        ...cuerpo,
        operario_id: operario.id,
        recurso_raw: `${operario.nombre} ${operario.apellido}`,
        equipo_id: equipo.id,
        equipo_o_vehiculo_raw: `${equipo.code} - ${equipo.name}`,
        horas,
      };
    } else if (editandoLegacySinAcarreo) {
      const fletero = fleteros.find((f) => f.id === form.fleteroId);
      if (!fletero) { setError("Elegí el fletero"); return; }
      const horas = Number(form.horas);
      if (!isFinite(horas) || horas <= 0) { setError("Las horas tienen que ser un número mayor a cero"); return; }
      cuerpo = {
        ...cuerpo,
        fletero_id: fletero.id,
        recurso_raw: fletero.nombre,
        equipo_o_vehiculo_raw: ETIQUETA_TIPO_CAMION[form.tipoCamion],
        tipo_camion: form.tipoCamion,
        horas,
        viajes: form.viajes !== "" ? Number(form.viajes) : null,
      };
    } else {
      if (!form.acarreoId) { setError("Elegí de qué carga de Acarreo vienen las horas"); return; }
      cuerpo = {
        ...cuerpo,
        acarreo_id: form.acarreoId,
        tipo_camion: form.tipoCamion,
        viajes: form.viajes !== "" ? Number(form.viajes) : null,
      };
    }

    setGuardando(true);
    try {
      const res = await fetch("/api/cantera/destape", {
        method: form.id ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form.id ? { ...cuerpo, id: form.id } : cuerpo),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "No se pudo guardar");
      cancelarEdicion();
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
    if (form.id === id) cancelarEdicion();
    router.refresh();
  }

  const editando = form.id !== null;

  return (
    <div className="mx-auto max-w-2xl">
      <Link href="/cantera/destape" className="text-xs text-slate-500 underline">← Destape</Link>
      <h1 className="mt-1 text-xl font-semibold">{editando ? "Editar destape" : "Cargar destape"}</h1>
      <p className="mt-1 text-sm text-slate-500">Un recurso (máquina propia u operario, o fletero con camión) por día.</p>

      {error && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      {aviso && <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-700">{aviso}</p>}

      <div className="mt-4 card p-4">
        {(() => {
          const pideFecha = form.tipoRecurso === "operario_propio" || editandoLegacySinAcarreo;
          return (
            <div className={pideFecha ? "grid grid-cols-2 gap-3" : ""}>
              {pideFecha && (
                <label className="text-xs text-slate-600">
                  Fecha
                  <input type="date" className={INPUT_CLS} value={form.fecha} onChange={(e) => set("fecha", e.target.value)} />
                </label>
              )}
              <label className="text-xs text-slate-600">
                Yacimiento
                <select className={INPUT_CLS} value={form.yacimientoCodigo} onChange={(e) => set("yacimientoCodigo", e.target.value)}>
                  <option value="">Sin especificar</option>
                  {yacimientos.map((y) => <option key={y.id} value={y.codigo}>{y.codigo} — {y.nombre}</option>)}
                </select>
              </label>
            </div>
          );
        })()}
        <label className="mt-2 block text-xs text-slate-600">
          Frente / sector (opcional)
          <input className={INPUT_CLS} value={form.frente} onChange={(e) => set("frente", e.target.value)} />
        </label>

        {!editando && (
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
        )}

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
        ) : editandoLegacySinAcarreo ? (
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
        ) : (
          <div className="mt-3">
            <label className="block text-xs text-slate-600">
              Horas de Acarreo sin clasificar
              <select className={INPUT_CLS} value={form.acarreoId} onChange={(e) => set("acarreoId", e.target.value)}>
                <option value="">Elegir...</option>
                {opcionesAcarreo.map((a) => (
                  <option key={a.acarreoId} value={a.acarreoId}>
                    {a.fecha} — {fleteroPorId.get(a.fleteroId) ?? "(fletero desconocido)"} — {num.format(a.horas)} h
                  </option>
                ))}
              </select>
            </label>
            {pendientesAcarreo.length === 0 && (
              <p className="mt-1 text-xs text-slate-400">
                No hay horas de destape sin clasificar cargadas en Acarreo. Se cargan ahí (fletero + fecha + horas) y acá sólo se eligen.
              </p>
            )}
            <div className="mt-3 grid grid-cols-2 gap-3">
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
          </div>
        )}

        {(form.tipoRecurso === "operario_propio" || editandoLegacySinAcarreo) && (
          <label className="mt-3 block text-xs text-slate-600">
            Horas
            <input className={INPUT_CLS} inputMode="decimal" value={form.horas} onChange={(e) => set("horas", e.target.value)} />
          </label>
        )}
        <label className="mt-3 block text-xs text-slate-600">
          Observaciones (opcional)
          <input className={INPUT_CLS} value={form.observaciones} onChange={(e) => set("observaciones", e.target.value)} />
        </label>

        <div className="mt-4 flex gap-2">
          <button disabled={guardando} onClick={guardar} className="rounded-lg bg-slate-800 px-3 py-2 text-sm text-white disabled:opacity-50">
            {guardando ? "Guardando…" : editando ? "Guardar cambios" : "Cargar"}
          </button>
          {editando && (
            <button onClick={cancelarEdicion} className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-600 hover:bg-slate-50">
              Cancelar
            </button>
          )}
        </div>
      </div>

      <h2 className="mt-6 text-sm font-semibold text-slate-700">Últimos 7 días</h2>
      {recientes.length === 0 ? (
        <p className="mt-1 text-sm text-slate-400">Sin registros recientes.</p>
      ) : (
        <ul className="mt-2 space-y-1">
          {[...recientes].sort((a, b) => b.fecha.localeCompare(a.fecha)).map((r) => (
            <li key={r.id} className={`flex items-center justify-between rounded-lg border px-3 py-2 text-sm ${form.id === r.id ? "border-slate-400 bg-slate-50" : "border-slate-100"}`}>
              <span>
                <span className="font-medium">{r.fecha}</span> — {r.yacimiento_codigo ?? "sin yacimiento"} — {r.recurso_raw} ({r.equipo_o_vehiculo_raw}) — {num.format(r.horas)} h
              </span>
              <span className="flex shrink-0 gap-2">
                <button onClick={() => iniciarEdicion(r)} className="text-xs text-slate-600 hover:underline">Editar</button>
                <button onClick={() => borrar(r.id)} className="text-xs text-red-600 hover:underline">Borrar</button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
