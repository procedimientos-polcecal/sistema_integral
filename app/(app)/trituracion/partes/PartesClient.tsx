"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { despejarParte } from "@/lib/trituracion/horas";
import { ESTADOS_PARTE, ETIQUETA_ESTADO, MATERIALES, ORIGENES_SIN_YACIMIENTO } from "@/lib/trituracion/vocabulario";
import type { EmpleadoLiviano, ParteDB, PlantaDB } from "@/lib/trituracion/consultas";
import { COLORES_TRITURACION } from "../GraficosTrituracion";

const num0 = new Intl.NumberFormat("es-AR", { maximumFractionDigits: 0 });
const num1 = new Intl.NumberFormat("es-AR", { maximumFractionDigits: 1 });
const pct = new Intl.NumberFormat("es-AR", { style: "percent", maximumFractionDigits: 0 });

function moverMes(mes: string, delta: number): string {
  const [anio, m] = mes.split("-").map(Number);
  const d = new Date(Date.UTC(anio, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

const NOMBRE_MES = new Intl.DateTimeFormat("es-AR", { month: "long", year: "numeric", timeZone: "UTC" });
function nombreDeMes(mes: string): string {
  const texto = NOMBRE_MES.format(new Date(`${mes}-01T00:00:00Z`));
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

const ORIGENES_SUGERIDOS = ["D1", "D6", "C1", "C3", ...ORIGENES_SIN_YACIMIENTO];
const COLOR_DE_MATERIAL: Record<string, string> = Object.fromEntries(
  MATERIALES.map((m, i) => [m, COLORES_TRITURACION[i % COLORES_TRITURACION.length]])
);

/** Verde/ámbar/rojo por umbral — para leer la disponibilidad de un vistazo, sin tener que comparar números. */
function colorDeDisponibilidad(d: number | null): string {
  if (d === null) return "#94A3B8";
  if (d >= 0.8) return "#1E7D34";
  if (d >= 0.6) return "#B45309";
  return "#DC2626";
}

function formVacio(fecha: string) {
  return {
    fecha,
    estado: "opero" as (typeof ESTADOS_PARTE)[number],
    motivoNoOperativo: "",
    material: "",
    origen: "",
    horaInicio: "",
    horaFin: "",
    operarioId: "",
    horasMantenimiento: "",
    horasFaltaPiedra: "",
    horasProduccion: "",
    horasOtro: "",
    motivoOtro: "",
    camionesLlegados: "",
    toneladasProcesadas: "",
    observaciones: "",
  };
}

type Form = ReturnType<typeof formVacio>;

function formDeParte(p: ParteDB): Form {
  return {
    fecha: p.fecha,
    estado: (p.estado as Form["estado"]) ?? "opero",
    motivoNoOperativo: p.motivo_no_operativo ?? "",
    material: p.material ?? "",
    origen: p.origen ?? "",
    horaInicio: p.hora_inicio ? p.hora_inicio.slice(0, 5) : "",
    horaFin: p.hora_fin ? p.hora_fin.slice(0, 5) : "",
    operarioId: p.operario_id ?? "",
    horasMantenimiento: p.horas_mantenimiento ? String(p.horas_mantenimiento) : "",
    horasFaltaPiedra: p.horas_falta_piedra ? String(p.horas_falta_piedra) : "",
    horasProduccion: p.horas_produccion ? String(p.horas_produccion) : "",
    horasOtro: p.horas_otro ? String(p.horas_otro) : "",
    motivoOtro: p.motivo_otro ?? "",
    camionesLlegados: p.camiones_llegados != null ? String(p.camiones_llegados) : "",
    toneladasProcesadas: p.toneladas_procesadas != null ? String(p.toneladas_procesadas) : "",
    observaciones: p.observaciones ?? "",
  };
}

function Campo({ etiqueta, children }: { etiqueta: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-slate-500">{etiqueta}</span>
      {children}
    </label>
  );
}

const DIAS_SEMANA = ["L", "M", "X", "J", "V", "S", "D"];

/** Grilla del mes: un botón por día, coloreado según si operó / no operó / no tiene parte cargado todavía. */
function CalendarioMes({
  mes, partes, fechaSeleccionada, onElegir,
}: {
  mes: string;
  partes: ParteDB[];
  fechaSeleccionada: string;
  onElegir: (fecha: string) => void;
}) {
  const [anio, mesNum] = mes.split("-").map(Number);
  const diasEnMes = new Date(Date.UTC(anio, mesNum, 0)).getUTCDate();
  const offset = (new Date(Date.UTC(anio, mesNum - 1, 1)).getUTCDay() + 6) % 7;
  const porFecha = new Map(partes.map((p) => [p.fecha, p]));
  // eslint-disable-next-line react-hooks/purity -- se resuelve una vez, no en cada render
  const hoy = new Date().toISOString().slice(0, 10);

  return (
    <div>
      <div className="grid grid-cols-7 gap-1 text-center text-[11px] font-medium text-slate-400">
        {DIAS_SEMANA.map((d) => <div key={d}>{d}</div>)}
      </div>
      <div className="mt-1 grid grid-cols-7 gap-1">
        {Array.from({ length: offset }, (_, i) => <div key={`o${i}`} />)}
        {Array.from({ length: diasEnMes }, (_, i) => i + 1).map((dia) => {
          const fecha = `${mes}-${String(dia).padStart(2, "0")}`;
          const parte = porFecha.get(fecha);
          const seleccionado = fecha === fechaSeleccionada;
          const esHoy = fecha === hoy;

          let clases = "border border-dashed border-slate-200 text-slate-400 hover:border-slate-300";
          if (parte?.estado === "opero") clases = "border border-emerald-200 bg-emerald-50 text-emerald-800 hover:bg-emerald-100";
          else if (parte?.estado === "no_opero") clases = "border border-slate-300 bg-slate-100 text-slate-500 hover:bg-slate-200";

          return (
            <button
              key={fecha}
              type="button"
              onClick={() => onElegir(fecha)}
              className={`relative aspect-square rounded-md text-xs font-medium transition-colors ${clases} ${seleccionado ? "ring-2 ring-offset-1" : ""}`}
              style={seleccionado ? { boxShadow: "0 0 0 2px #0891B2" } : undefined}
              title={parte ? `${ETIQUETA_ESTADO[parte.estado as keyof typeof ETIQUETA_ESTADO] ?? parte.estado}${parte.toneladas_procesadas ? ` · ${num0.format(parte.toneladas_procesadas)} t` : ""}` : "Sin parte cargado"}
            >
              {dia}
              {esHoy && <span className="absolute inset-x-0 bottom-0.5 mx-auto block h-1 w-1 rounded-full bg-[#0891B2]" />}
              {parte?.sheets_pendiente && <span className="absolute right-0.5 top-0.5 text-amber-600">⚠</span>}
            </button>
          );
        })}
      </div>
      <div className="mt-2 flex flex-wrap gap-3 text-[11px] text-slate-500">
        <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm border border-emerald-200 bg-emerald-50" /> Operó</span>
        <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm border border-slate-300 bg-slate-100" /> No operó</span>
        <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm border border-dashed border-slate-200" /> Sin cargar</span>
      </div>
    </div>
  );
}

export default function PartesClient({
  plantas, plantaId, mes, partes, empleados, puedeEditar,
}: {
  plantas: PlantaDB[];
  plantaId: string;
  mes: string;
  partes: ParteDB[];
  empleados: EmpleadoLiviano[];
  puedeEditar: boolean;
}) {
  const router = useRouter();
  const irA = (p: string, m: string) => router.push(`/trituracion/partes?planta=${p}&mes=${m}`);

  // eslint-disable-next-line react-hooks/purity -- se resuelve una vez, no en cada render
  const hoy = new Date().toISOString().slice(0, 10);
  const fechaInicial = hoy.startsWith(mes) ? hoy : `${mes}-01`;
  const parteInicial = partes.find((p) => p.fecha === fechaInicial);
  const [form, setForm] = useState<Form>(parteInicial ? formDeParte(parteInicial) : formVacio(fechaInicial));
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  function set<K extends keyof Form>(k: K, v: Form[K]) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  function elegirFecha(fecha: string) {
    setError(null);
    setAviso(null);
    const existente = partes.find((p) => p.fecha === fecha);
    setForm(existente ? formDeParte(existente) : formVacio(fecha));
  }

  const previewDespeje = useMemo(
    () =>
      despejarParte({
        horaInicio: form.horaInicio || null,
        horaFin: form.horaFin || null,
        horasMantenimiento: Number(form.horasMantenimiento) || 0,
        horasFaltaPiedra: Number(form.horasFaltaPiedra) || 0,
        horasProduccion: Number(form.horasProduccion) || 0,
        horasOtro: Number(form.horasOtro) || 0,
        toneladasProcesadas: form.toneladasProcesadas === "" ? null : Number(form.toneladasProcesadas),
        camionesLlegados: form.camionesLlegados === "" ? null : Number(form.camionesLlegados),
      }),
    [form]
  );

  async function guardar() {
    setGuardando(true);
    setError(null);
    setAviso(null);
    try {
      const res = await fetch("/api/trituracion/partes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          planta_id: plantaId,
          fecha: form.fecha,
          estado: form.estado,
          motivo_no_operativo: form.motivoNoOperativo || null,
          material: form.material || null,
          origen: form.origen || null,
          hora_inicio: form.horaInicio || null,
          hora_fin: form.horaFin || null,
          operario_id: form.operarioId || null,
          operario_raw: empleados.find((e) => e.id === form.operarioId)
            ? `${empleados.find((e) => e.id === form.operarioId)!.apellido}, ${empleados.find((e) => e.id === form.operarioId)!.nombre}`
            : null,
          horas_mantenimiento: form.horasMantenimiento === "" ? 0 : Number(form.horasMantenimiento),
          horas_falta_piedra: form.horasFaltaPiedra === "" ? 0 : Number(form.horasFaltaPiedra),
          horas_produccion: form.horasProduccion === "" ? 0 : Number(form.horasProduccion),
          horas_otro: form.horasOtro === "" ? 0 : Number(form.horasOtro),
          motivo_otro: form.motivoOtro || null,
          camiones_llegados: form.camionesLlegados === "" ? null : Number(form.camionesLlegados),
          toneladas_procesadas: form.toneladasProcesadas === "" ? null : Number(form.toneladasProcesadas),
          observaciones: form.observaciones || null,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "No se pudo guardar");
      if (json.aviso) setAviso(json.aviso.mensaje);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo guardar");
    } finally {
      setGuardando(false);
    }
  }

  const diasOperativos = partes.filter((p) => p.estado === "opero").length;
  const toneladasDelMes = partes.reduce((s, p) => s + (p.toneladas_procesadas ?? 0), 0);
  const pendientes = partes.filter((p) => p.sheets_pendiente).length;
  const disponibilidades = partes
    .map((p) =>
      despejarParte({
        horaInicio: p.hora_inicio,
        horaFin: p.hora_fin,
        horasMantenimiento: p.horas_mantenimiento,
        horasFaltaPiedra: p.horas_falta_piedra,
        horasProduccion: p.horas_produccion,
        horasOtro: p.horas_otro,
        toneladasProcesadas: p.toneladas_procesadas,
        camionesLlegados: p.camiones_llegados,
      }).disponibilidad
    )
    .filter((d): d is number => d !== null);
  const disponibilidadPromedio =
    disponibilidades.length > 0 ? disponibilidades.reduce((s, d) => s + d, 0) / disponibilidades.length : null;

  return (
    <div className="mx-auto max-w-5xl">
      <Link href="/trituracion" className="text-xs text-slate-500 underline">← Trituración</Link>
      <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="page-header">Partes de trituración</h1>
          <p className="page-subheader">Un registro por planta y día. Queda exportado a la planilla real al guardar.</p>
        </div>
        <select
          className="input w-auto"
          value={plantaId}
          onChange={(e) => irA(e.target.value, mes)}
        >
          {plantas.map((p) => (
            <option key={p.id} value={p.id}>{p.nombre}</option>
          ))}
        </select>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-5">
        {/* ── Calendario del mes ── */}
        <div className="card p-4 lg:col-span-2">
          <div className="flex items-center justify-between">
            <button className="btn-ghost px-2 py-1 text-sm" onClick={() => irA(plantaId, moverMes(mes, -1))} aria-label="Mes anterior">←</button>
            <span className="text-sm font-semibold text-slate-800">{nombreDeMes(mes)}</span>
            <button className="btn-ghost px-2 py-1 text-sm" onClick={() => irA(plantaId, moverMes(mes, 1))} aria-label="Mes siguiente">→</button>
          </div>
          <div className="mt-3">
            <CalendarioMes mes={mes} partes={partes} fechaSeleccionada={form.fecha} onElegir={elegirFecha} />
          </div>

          <div className="mt-4 grid grid-cols-3 gap-2 border-t border-slate-100 pt-3 text-center">
            <div>
              <div className="text-lg font-bold tabular-nums text-[#7E22CE]">{diasOperativos}</div>
              <div className="text-[11px] text-slate-500">días operativos</div>
            </div>
            <div>
              <div className="text-lg font-bold tabular-nums text-[#0891B2]">{num0.format(toneladasDelMes)}</div>
              <div className="text-[11px] text-slate-500">toneladas</div>
            </div>
            <div>
              <div className="text-lg font-bold tabular-nums" style={{ color: colorDeDisponibilidad(disponibilidadPromedio) }}>
                {disponibilidadPromedio !== null ? pct.format(disponibilidadPromedio) : "—"}
              </div>
              <div className="text-[11px] text-slate-500">disponibilidad</div>
            </div>
          </div>
          {pendientes > 0 && (
            <p className="mt-2 text-xs text-amber-700">⚠ {pendientes} sin exportar a la planilla</p>
          )}
        </div>

        {/* ── El formulario del día elegido ── */}
        {puedeEditar ? (
          <section className="card p-4 lg:col-span-3">
            <h2 className="section-title">
              {form.fecha === hoy ? "Hoy" : new Intl.DateTimeFormat("es-AR", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }).format(new Date(`${form.fecha}T00:00:00Z`))}
            </h2>

            <div className="mt-3 flex gap-2">
              {ESTADOS_PARTE.map((e) => (
                <button
                  key={e}
                  type="button"
                  onClick={() => set("estado", e)}
                  className={`rounded-full px-3 py-1 text-sm font-medium transition-colors ${
                    form.estado === e
                      ? e === "opero" ? "bg-emerald-600 text-white" : "bg-slate-600 text-white"
                      : "bg-slate-100 text-slate-500 hover:bg-slate-200"
                  }`}
                >
                  {ETIQUETA_ESTADO[e]}
                </button>
              ))}
            </div>

            {form.estado === "no_opero" ? (
              <div className="mt-3">
                <Campo etiqueta="Motivo">
                  <input
                    className="input" placeholder="Ej. lluvia, falta de piedra..."
                    value={form.motivoNoOperativo} onChange={(e) => set("motivoNoOperativo", e.target.value)}
                  />
                </Campo>
              </div>
            ) : (
              <>
                <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <Campo etiqueta="Hora inicio">
                    <input type="time" className="input" value={form.horaInicio} onChange={(e) => set("horaInicio", e.target.value)} />
                  </Campo>
                  <Campo etiqueta="Hora fin">
                    <input type="time" className="input" value={form.horaFin} onChange={(e) => set("horaFin", e.target.value)} />
                  </Campo>
                  <Campo etiqueta="Material">
                    <select className="input" value={form.material} onChange={(e) => set("material", e.target.value)}>
                      <option value="">Elegir...</option>
                      {MATERIALES.map((m) => <option key={m} value={m}>{m}</option>)}
                    </select>
                  </Campo>
                  <Campo etiqueta="Origen">
                    <input
                      className="input" list="origenes-trituracion" placeholder="D1, LOMA NEGRA..."
                      value={form.origen} onChange={(e) => set("origen", e.target.value)}
                    />
                    <datalist id="origenes-trituracion">
                      {ORIGENES_SUGERIDOS.map((o) => <option key={o} value={o} />)}
                    </datalist>
                  </Campo>
                </div>

                <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-3">
                  <Campo etiqueta="Operario">
                    <select className="input" value={form.operarioId} onChange={(e) => set("operarioId", e.target.value)}>
                      <option value="">Elegir...</option>
                      {empleados.map((e) => (
                        <option key={e.id} value={e.id}>{e.apellido}, {e.nombre}</option>
                      ))}
                    </select>
                  </Campo>
                  <Campo etiqueta="Camiones llegados">
                    <input className="input" inputMode="decimal" value={form.camionesLlegados} onChange={(e) => set("camionesLlegados", e.target.value)} />
                  </Campo>
                  <Campo etiqueta="Toneladas procesadas">
                    <input className="input" inputMode="decimal" value={form.toneladasProcesadas} onChange={(e) => set("toneladasProcesadas", e.target.value)} />
                  </Campo>
                </div>

                <p className="mt-3 text-xs font-medium text-slate-500">Horas paradas (h)</p>
                <div className="mt-1 grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <Campo etiqueta="Mantenimiento">
                    <input className="input" inputMode="decimal" value={form.horasMantenimiento} onChange={(e) => set("horasMantenimiento", e.target.value)} />
                  </Campo>
                  <Campo etiqueta="Falta de piedra">
                    <input className="input" inputMode="decimal" value={form.horasFaltaPiedra} onChange={(e) => set("horasFaltaPiedra", e.target.value)} />
                  </Campo>
                  <Campo etiqueta="Producción">
                    <input className="input" inputMode="decimal" value={form.horasProduccion} onChange={(e) => set("horasProduccion", e.target.value)} />
                  </Campo>
                  <Campo etiqueta="Otro">
                    <input className="input" inputMode="decimal" value={form.horasOtro} onChange={(e) => set("horasOtro", e.target.value)} />
                  </Campo>
                </div>
                {Number(form.horasOtro) > 0 && (
                  <div className="mt-2">
                    <Campo etiqueta="¿Qué fue el motivo de 'otro'?">
                      <input className="input" value={form.motivoOtro} onChange={(e) => set("motivoOtro", e.target.value)} />
                    </Campo>
                  </div>
                )}

                {previewDespeje.horasTeoricas !== null && (
                  <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 rounded-md bg-slate-50 px-3 py-2 text-xs text-slate-600">
                    <span>{num1.format(previewDespeje.horasTeoricas)} h teóricas</span>
                    <span>{num1.format(previewDespeje.horasRealesTrabajadas ?? 0)} h reales</span>
                    {previewDespeje.disponibilidad !== null && (
                      <span style={{ color: colorDeDisponibilidad(previewDespeje.disponibilidad) }} className="font-medium">
                        {pct.format(previewDespeje.disponibilidad)} disponibilidad
                      </span>
                    )}
                    {previewDespeje.productividadReal !== null && <span>{num1.format(previewDespeje.productividadReal)} t/h real</span>}
                  </div>
                )}
              </>
            )}

            <div className="mt-3">
              <Campo etiqueta="Observaciones">
                <textarea
                  className="input w-full" rows={2}
                  value={form.observaciones} onChange={(e) => set("observaciones", e.target.value)}
                />
              </Campo>
            </div>

            <div className="mt-3 flex items-center justify-between">
              <span className="text-xs text-slate-400">{form.fecha}</span>
              <button className="btn-primary" disabled={guardando} onClick={guardar}>
                {guardando ? "Guardando..." : "Guardar"}
              </button>
            </div>
            {aviso && <p className="mt-2 text-sm text-amber-700">{aviso}</p>}
            {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
          </section>
        ) : (
          <div className="card flex items-center justify-center p-4 text-sm text-slate-400 lg:col-span-3">
            Sin permiso de edición en este módulo.
          </div>
        )}
      </div>

      <section className="mt-6">
        <h2 className="section-title">Partes del mes</h2>
        <div className="card mt-2 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="table-base">
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Estado</th>
                <th>Material</th>
                <th>Origen</th>
                <th>Horario</th>
                <th>Operario</th>
                <th className="text-right">Hs. teóricas</th>
                <th className="text-right">Hs. paradas</th>
                <th className="text-right">Disp.</th>
                <th className="text-right">Camiones</th>
                <th className="text-right">Toneladas</th>
                <th className="text-right">t/h real</th>
              </tr>
            </thead>
            <tbody>
              {partes.length === 0 ? (
                <tr><td colSpan={12} className="py-8 text-center text-slate-400">Sin partes este mes.</td></tr>
              ) : (
                [...partes]
                  .sort((a, b) => (a.fecha < b.fecha ? 1 : -1))
                  .map((p, i) => {
                    const d = despejarParte({
                      horaInicio: p.hora_inicio,
                      horaFin: p.hora_fin,
                      horasMantenimiento: p.horas_mantenimiento,
                      horasFaltaPiedra: p.horas_falta_piedra,
                      horasProduccion: p.horas_produccion,
                      horasOtro: p.horas_otro,
                      toneladasProcesadas: p.toneladas_procesadas,
                      camionesLlegados: p.camiones_llegados,
                    });
                    const operario = empleados.find((e) => e.id === p.operario_id);
                    const esOpero = p.estado === "opero";
                    return (
                      <tr
                        key={p.id}
                        className={puedeEditar ? "cursor-pointer" : undefined}
                        style={{ backgroundColor: p.fecha === form.fecha ? "#ECFEFF" : i % 2 === 1 ? "#F8FAFC" : undefined }}
                        onClick={() => puedeEditar && elegirFecha(p.fecha)}
                      >
                        <td className="whitespace-nowrap">
                          {p.fecha}
                          {p.sheets_pendiente && <span className="ml-1.5 text-amber-600" title={`Sin exportar a la planilla: ${p.sheets_pendiente}`}>⚠</span>}
                        </td>
                        <td>
                          <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${esOpero ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>
                            {ETIQUETA_ESTADO[p.estado as keyof typeof ETIQUETA_ESTADO] ?? p.estado}
                          </span>
                        </td>
                        <td>
                          {p.material ? (
                            <span className="inline-flex items-center gap-1.5">
                              <span className="h-2 w-2 rounded-full" style={{ backgroundColor: COLOR_DE_MATERIAL[p.material] ?? "#94A3B8" }} />
                              {p.material}
                            </span>
                          ) : "—"}
                        </td>
                        <td>{p.origen ?? "—"}</td>
                        <td className="whitespace-nowrap">{p.hora_inicio && p.hora_fin ? `${p.hora_inicio.slice(0, 5)}–${p.hora_fin.slice(0, 5)}` : "—"}</td>
                        <td className={operario ? "text-slate-800" : p.operario_raw ? "text-amber-700" : "text-slate-400"}>
                          {operario ? `${operario.apellido}, ${operario.nombre}` : (p.operario_raw ?? "—")}
                        </td>
                        <td className="text-right font-mono tabular-nums">{d.horasTeoricas !== null ? num1.format(d.horasTeoricas) : "—"}</td>
                        <td className="text-right font-mono tabular-nums">{num1.format(d.horasParadasTotal)}</td>
                        <td className="text-right font-mono tabular-nums font-medium" style={{ color: colorDeDisponibilidad(d.disponibilidad) }}>
                          {d.disponibilidad !== null ? pct.format(d.disponibilidad) : "—"}
                        </td>
                        <td className="text-right font-mono tabular-nums">{p.camiones_llegados ?? "—"}</td>
                        <td className="text-right font-mono tabular-nums">{p.toneladas_procesadas !== null ? num0.format(p.toneladas_procesadas) : "—"}</td>
                        <td className="text-right font-mono tabular-nums">{d.productividadReal !== null ? num1.format(d.productividadReal) : "—"}</td>
                      </tr>
                    );
                  })
              )}
            </tbody>
          </table>
        </div>
        </div>
      </section>
    </div>
  );
}
