"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { despejarParte } from "@/lib/trituracion/horas";
import { ESTADOS_PARTE, ETIQUETA_ESTADO, MATERIALES, ORIGENES_SIN_YACIMIENTO } from "@/lib/trituracion/vocabulario";
import type { EmpleadoLiviano, ParteDB, PlantaDB } from "@/lib/trituracion/consultas";

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
  const parteDeHoy = partes.find((p) => p.fecha === hoy);
  const [form, setForm] = useState<Form>(parteDeHoy ? formDeParte(parteDeHoy) : formVacio(hoy));
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

      {puedeEditar && (
        <section className="card mt-4 p-4">
          <h2 className="section-title">Cargar / corregir el parte del día</h2>
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-4">
            <input
              type="date" className="input"
              value={form.fecha}
              onChange={(e) => elegirFecha(e.target.value)}
            />
            <select className="input" value={form.estado} onChange={(e) => set("estado", e.target.value as Form["estado"])}>
              {ESTADOS_PARTE.map((e) => (
                <option key={e} value={e}>{ETIQUETA_ESTADO[e]}</option>
              ))}
            </select>
            {form.estado === "no_opero" ? (
              <input
                className="input sm:col-span-2" placeholder="Motivo (ej. lluvia)"
                value={form.motivoNoOperativo} onChange={(e) => set("motivoNoOperativo", e.target.value)}
              />
            ) : (
              <>
                <input type="time" className="input" value={form.horaInicio} onChange={(e) => set("horaInicio", e.target.value)} />
                <input type="time" className="input" value={form.horaFin} onChange={(e) => set("horaFin", e.target.value)} />
              </>
            )}
          </div>

          {form.estado === "opero" && (
            <>
              <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-4">
                <select className="input" value={form.material} onChange={(e) => set("material", e.target.value)}>
                  <option value="">Material...</option>
                  {MATERIALES.map((m) => <option key={m} value={m}>{m}</option>)}
                </select>
                <input
                  className="input" list="origenes-trituracion" placeholder="Origen (D1, LOMA NEGRA, ACOPIO...)"
                  value={form.origen} onChange={(e) => set("origen", e.target.value)}
                />
                <datalist id="origenes-trituracion">
                  {ORIGENES_SUGERIDOS.map((o) => <option key={o} value={o} />)}
                </datalist>
                <select className="input sm:col-span-2" value={form.operarioId} onChange={(e) => set("operarioId", e.target.value)}>
                  <option value="">Operario...</option>
                  {empleados.map((e) => (
                    <option key={e.id} value={e.id}>{e.apellido}, {e.nombre}</option>
                  ))}
                </select>
              </div>

              <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
                <input className="input" inputMode="decimal" placeholder="Camiones llegados" value={form.camionesLlegados} onChange={(e) => set("camionesLlegados", e.target.value)} />
                <input className="input" inputMode="decimal" placeholder="Toneladas procesadas" value={form.toneladasProcesadas} onChange={(e) => set("toneladasProcesadas", e.target.value)} />
              </div>

              <p className="mt-3 text-xs font-medium text-slate-500">Horas paradas (h)</p>
              <div className="mt-1 grid grid-cols-2 gap-2 sm:grid-cols-4">
                <input className="input" inputMode="decimal" placeholder="Mantenimiento" value={form.horasMantenimiento} onChange={(e) => set("horasMantenimiento", e.target.value)} />
                <input className="input" inputMode="decimal" placeholder="Falta de piedra" value={form.horasFaltaPiedra} onChange={(e) => set("horasFaltaPiedra", e.target.value)} />
                <input className="input" inputMode="decimal" placeholder="Producción" value={form.horasProduccion} onChange={(e) => set("horasProduccion", e.target.value)} />
                <input className="input" inputMode="decimal" placeholder="Otro" value={form.horasOtro} onChange={(e) => set("horasOtro", e.target.value)} />
              </div>
              {Number(form.horasOtro) > 0 && (
                <input
                  className="input mt-2" placeholder="¿Qué fue el motivo de 'otro'?"
                  value={form.motivoOtro} onChange={(e) => set("motivoOtro", e.target.value)}
                />
              )}

              {previewDespeje.horasTeoricas !== null && (
                <p className="mt-2 text-xs text-slate-500">
                  {num1.format(previewDespeje.horasTeoricas)} h teóricas · {num1.format(previewDespeje.horasRealesTrabajadas ?? 0)} h reales
                  {previewDespeje.disponibilidad !== null && <> · disponibilidad {pct.format(previewDespeje.disponibilidad)}</>}
                  {previewDespeje.productividadReal !== null && <> · {num1.format(previewDespeje.productividadReal)} t/h real</>}
                </p>
              )}
            </>
          )}

          <textarea
            className="input mt-2 w-full" rows={2} placeholder="Observaciones (opcional)"
            value={form.observaciones} onChange={(e) => set("observaciones", e.target.value)}
          />

          <div className="mt-3 flex justify-end">
            <button className="btn-primary" disabled={guardando} onClick={guardar}>Guardar</button>
          </div>
          {aviso && <p className="mt-2 text-sm text-amber-700">{aviso}</p>}
          {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
        </section>
      )}

      <div className="card mt-4 flex items-center justify-between p-3">
        <button className="btn-ghost" onClick={() => irA(plantaId, moverMes(mes, -1))}>← Mes anterior</button>
        <span className="font-semibold text-slate-800">{nombreDeMes(mes)}</span>
        <button className="btn-ghost" onClick={() => irA(plantaId, moverMes(mes, 1))}>Mes siguiente →</button>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <div className="card p-4">
          <div className="text-2xl font-bold tabular-nums text-slate-700">{diasOperativos}</div>
          <div className="mt-0.5 text-sm text-slate-500">Días operativos</div>
        </div>
        <div className="card p-4">
          <div className="text-2xl font-bold tabular-nums text-[#0891B2]">{num0.format(toneladasDelMes)} t</div>
          <div className="mt-0.5 text-sm text-slate-500">Toneladas del mes</div>
        </div>
        <div className="card p-4">
          <div className="text-2xl font-bold tabular-nums text-slate-700">
            {disponibilidadPromedio !== null ? pct.format(disponibilidadPromedio) : "—"}
          </div>
          <div className="mt-0.5 text-sm text-slate-500">Disponibilidad promedio</div>
        </div>
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
                    return (
                      <tr
                        key={p.id}
                        className={puedeEditar ? "cursor-pointer" : undefined}
                        style={{ backgroundColor: i % 2 === 1 ? "#F8FAFC" : undefined }}
                        onClick={() => puedeEditar && elegirFecha(p.fecha)}
                      >
                        <td className="whitespace-nowrap">{p.fecha}</td>
                        <td>{ETIQUETA_ESTADO[p.estado as keyof typeof ETIQUETA_ESTADO] ?? p.estado}</td>
                        <td>{p.material ?? "—"}</td>
                        <td>{p.origen ?? "—"}</td>
                        <td className="whitespace-nowrap">{p.hora_inicio && p.hora_fin ? `${p.hora_inicio.slice(0, 5)}–${p.hora_fin.slice(0, 5)}` : "—"}</td>
                        <td className={operario ? "text-slate-800" : "text-amber-700"}>
                          {operario ? `${operario.apellido}, ${operario.nombre}` : (p.operario_raw ?? "—")}
                        </td>
                        <td className="text-right font-mono tabular-nums">{d.horasTeoricas !== null ? num1.format(d.horasTeoricas) : "—"}</td>
                        <td className="text-right font-mono tabular-nums">{num1.format(d.horasParadasTotal)}</td>
                        <td className="text-right font-mono tabular-nums">{d.disponibilidad !== null ? pct.format(d.disponibilidad) : "—"}</td>
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
