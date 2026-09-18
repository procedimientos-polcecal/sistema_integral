"use client";

import { Fragment, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  TAREAS_DE_SERVICE, TIERS_DE_SERVICE, descripcionDeTareas, type EstadoDeServicePorTier, type LecturaDeService,
} from "@/lib/tallerVial/service";
import type { EquipoTallerVial } from "@/lib/tallerVial/consultas";
import type { ServiceDB } from "@/lib/tallerVial/types";
import RepuestosDelTrabajo from "../RepuestosDelTrabajo";
import BuscadorDeArticulo, { type ArticuloOpcion } from "../BuscadorDeArticulo";

const num0 = new Intl.NumberFormat("es-AR", { maximumFractionDigits: 0 });

const ESTILO_LECTURA: Record<LecturaDeService, string> = {
  VENCIDO: "bg-red-50 text-red-700 border-red-200",
  PROXIMO: "bg-amber-50 text-amber-700 border-amber-200",
  AL_DIA: "bg-emerald-50 text-emerald-700 border-emerald-200",
};
const ETIQUETA_LECTURA: Record<LecturaDeService, string> = {
  VENCIDO: "Vencido",
  PROXIMO: "Próximo",
  AL_DIA: "Al día",
};

function BadgeLectura({ lectura }: { lectura: LecturaDeService | null }) {
  if (lectura === null) {
    return <span className="inline-flex rounded-full border border-slate-200 bg-white px-2 py-0.5 text-xs font-medium text-slate-400">Sin cargar</span>;
  }
  return (
    <span className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-semibold ${ESTILO_LECTURA[lectura]}`}>
      {ETIQUETA_LECTURA[lectura]}
    </span>
  );
}

interface EstadoDeEquipo {
  equipo: EquipoTallerVial;
  horometroActual: number | null;
  escalones: EstadoDeServicePorTier[];
}

interface RepuestoAUsar extends ArticuloOpcion {
  cantidad: number;
}

export default function ServicesClient({
  equipos, estadoPorEquipo, historial, puedeEditar,
}: {
  equipos: EquipoTallerVial[];
  estadoPorEquipo: EstadoDeEquipo[];
  historial: ServiceDB[];
  puedeEditar: boolean;
}) {
  const router = useRouter();
  // eslint-disable-next-line react-hooks/purity -- se resuelve una vez, no en cada render
  const hoy = new Date().toISOString().slice(0, 10);

  const [equipoId, setEquipoId] = useState(equipos[0]?.id ?? "");
  const [tier, setTier] = useState<number>(TIERS_DE_SERVICE[0]);
  const [fecha, setFecha] = useState(hoy);
  const [horometro, setHorometro] = useState("");
  const [observaciones, setObservaciones] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [filaAbierta, setFilaAbierta] = useState<string | null>(null);

  // La checklist de tareas de rutina: al tildar una, se puede elegir el
  // repuesto del pañol que le corresponde ahí mismo. `repuestoPorTarea` sólo
  // tiene entrada para las tareas tildadas.
  const [tareasMarcadas, setTareasMarcadas] = useState<Set<string>>(new Set());
  const [repuestoPorTarea, setRepuestoPorTarea] = useState<Record<string, { articulo: ArticuloOpcion | null; cantidad: string }>>({});

  function alternarTarea(codigo: string) {
    setTareasMarcadas((actual) => {
      const nuevo = new Set(actual);
      if (nuevo.has(codigo)) {
        nuevo.delete(codigo);
        setRepuestoPorTarea((r) => {
          const { [codigo]: _quitada, ...resto } = r;
          return resto;
        });
      } else {
        nuevo.add(codigo);
        setRepuestoPorTarea((r) => ({ ...r, [codigo]: { articulo: null, cantidad: "1" } }));
      }
      return nuevo;
    });
  }

  function elegirArticuloDeTarea(codigo: string, articulo: ArticuloOpcion | null) {
    setRepuestoPorTarea((r) => ({ ...r, [codigo]: { ...r[codigo], articulo } }));
  }

  function setCantidadDeTarea(codigo: string, cantidad: string) {
    setRepuestoPorTarea((r) => ({ ...r, [codigo]: { ...r[codigo], cantidad } }));
  }

  // Repuestos sueltos, para algo que no está en la checklist (se reservan
  // recién después de crear el service, porque la reserva necesita su id;
  // mismo motivo para los de la checklist).
  const [repuestosAUsar, setRepuestosAUsar] = useState<RepuestoAUsar[]>([]);
  const [articuloElegido, setArticuloElegido] = useState<ArticuloOpcion | null>(null);
  const [cantidadRepuesto, setCantidadRepuesto] = useState("");

  function agregarRepuestoAUsar() {
    if (!articuloElegido) return;
    const n = Number(cantidadRepuesto.replace(",", "."));
    if (!isFinite(n) || n <= 0) { setError("La cantidad del repuesto tiene que ser mayor a cero"); return; }
    setRepuestosAUsar((lista) => [...lista, { ...articuloElegido, cantidad: n }]);
    setArticuloElegido(null);
    setCantidadRepuesto("");
    setError(null);
  }

  function quitarRepuestoAUsar(id: string) {
    setRepuestosAUsar((lista) => lista.filter((r) => r.id !== id));
  }

  async function cargar() {
    const horometroNum = Number(horometro.replace(",", "."));
    if (!equipoId) { setError("Elegí un equipo"); return; }
    if (!isFinite(horometroNum) || horometroNum < 0) { setError("El horómetro tiene que ser un número"); return; }

    // Las tareas tildadas con repuesto elegido pero sin cantidad válida se
    // avisan antes de guardar nada — mejor frenar acá que reservar a medias.
    for (const codigo of tareasMarcadas) {
      const r = repuestoPorTarea[codigo];
      if (r?.articulo && !(Number(r.cantidad.replace(",", ".")) > 0)) {
        setError(`Ponele una cantidad válida al repuesto de "${TAREAS_DE_SERVICE.find((t) => t.codigo === codigo)?.etiqueta}"`);
        return;
      }
    }

    setGuardando(true);
    setError(null);
    setAviso(null);
    try {
      const observacionesFinal = [descripcionDeTareas([...tareasMarcadas]), observaciones.trim()].filter(Boolean).join(" — ");
      const res = await fetch("/api/taller-vial/services", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ equipo_id: equipoId, tier, fecha, horometro: horometroNum, observaciones: observacionesFinal || null }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "No se pudo guardar");

      const avisos: string[] = [];
      const todosLosRepuestos: { id: string; codigo: string; cantidad: number }[] = [
        ...repuestosAUsar.map((r) => ({ id: r.id, codigo: r.codigo, cantidad: r.cantidad })),
        ...Object.values(repuestoPorTarea)
          .filter((r): r is { articulo: ArticuloOpcion; cantidad: string } => r.articulo !== null)
          .map((r) => ({ id: r.articulo.id, codigo: r.articulo.codigo, cantidad: Number(r.cantidad.replace(",", ".")) })),
      ];
      for (const r of todosLosRepuestos) {
        const resRep = await fetch("/api/taller-vial/repuestos", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ service_id: json.data.id, articulo_id: r.id, cantidad: r.cantidad }),
        });
        const jsonRep = await resRep.json();
        if (!resRep.ok) avisos.push(`${r.codigo}: ${jsonRep.error ?? "no se pudo reservar"}`);
        else if (jsonRep.aviso) avisos.push(jsonRep.aviso.mensaje);
      }
      if (avisos.length > 0) setAviso(avisos.join(" · "));

      setHorometro("");
      setObservaciones("");
      setRepuestosAUsar([]);
      setTareasMarcadas(new Set());
      setRepuestoPorTarea({});
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo guardar");
    } finally {
      setGuardando(false);
    }
  }

  async function borrar(id: string) {
    if (!confirm("¿Borrar este service?")) return;
    const res = await fetch(`/api/taller-vial/services?id=${id}`, { method: "DELETE" });
    const json = await res.json();
    if (!res.ok) { setError(json.error ?? "No se pudo borrar"); return; }
    router.refresh();
  }

  return (
    <div className="mx-auto max-w-4xl">
      <Link href="/taller-vial" className="text-xs text-slate-500 underline">← Taller Vial</Link>
      <div className="mt-1 flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="page-header">Services por horómetro</h1>
        <p className="page-subheader">250 / 500 / 1000 / 2000 hs, en cascada: el de 1000 cubre al de 500 y al de 250.</p>
      </div>

      {puedeEditar && (
        <section className="card mt-4 p-4">
          <h2 className="section-title">Cargar un service</h2>
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-5">
            <select className="input sm:col-span-2" value={equipoId} onChange={(e) => setEquipoId(e.target.value)}>
              {equipos.map((eq) => (
                <option key={eq.id} value={eq.id}>{eq.code} - {eq.name}</option>
              ))}
            </select>
            <select className="input" value={tier} onChange={(e) => setTier(Number(e.target.value))}>
              {TIERS_DE_SERVICE.map((t) => (
                <option key={t} value={t}>{t} hs</option>
              ))}
            </select>
            <input type="date" className="input" value={fecha} onChange={(e) => setFecha(e.target.value)} />
            <input
              className="input" inputMode="decimal" placeholder="Horómetro"
              value={horometro} onChange={(e) => setHorometro(e.target.value)}
            />
          </div>
          {/* ── Checklist de tareas de rutina ── */}
          <div className="mt-3 rounded-lg border border-slate-200 p-3">
            <p className="section-title">Qué se le hizo (tildá lo que corresponda)</p>
            <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
              {TAREAS_DE_SERVICE.map((t) => {
                const marcada = tareasMarcadas.has(t.codigo);
                const r = repuestoPorTarea[t.codigo];
                return (
                  <div key={t.codigo} className={`rounded-lg border p-2 ${marcada ? "border-emerald-200 bg-emerald-50" : "border-slate-200"}`}>
                    <label className="flex items-center gap-2 text-sm text-slate-700">
                      <input type="checkbox" checked={marcada} onChange={() => alternarTarea(t.codigo)} />
                      {t.etiqueta}
                    </label>
                    {marcada && (
                      <div className="mt-2 flex gap-2">
                        <div className="flex-1">
                          {r?.articulo ? (
                            <div className="input flex items-center justify-between text-xs">
                              <span>{r.articulo.codigo} - {r.articulo.descripcion}</span>
                              <button className="text-slate-400 hover:text-slate-700" onClick={() => elegirArticuloDeTarea(t.codigo, null)}>✕</button>
                            </div>
                          ) : (
                            <BuscadorDeArticulo
                              placeholder="Repuesto usado…"
                              equipoId={equipoId}
                              onElegir={(a) => elegirArticuloDeTarea(t.codigo, a)}
                            />
                          )}
                        </div>
                        <div className="w-16 shrink-0">
                          <input
                            className="input" inputMode="decimal" placeholder="Cant."
                            value={r?.cantidad ?? ""} onChange={(e) => setCantidadDeTarea(t.codigo, e.target.value)}
                          />
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            <p className="mt-2 text-xs text-slate-400">
              Tildar arma la descripción sola; el repuesto es opcional por tarea — Inventario confirma la baja real después.
            </p>
          </div>

          <div className="mt-2">
            <input
              className="input w-full" placeholder="Observaciones adicionales (opcional)"
              value={observaciones} onChange={(e) => setObservaciones(e.target.value)}
            />
          </div>

          {/* ── Otros repuestos, fuera de la checklist ── */}
          <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
            <p className="section-title">Otros repuestos usados, fuera de la checklist (opcional)</p>
            {repuestosAUsar.length > 0 && (
              <ul className="mt-2 space-y-1">
                {repuestosAUsar.map((r) => (
                  <li key={r.id} className="flex items-center justify-between text-xs text-slate-700">
                    <span>{r.codigo} - {r.descripcion} × {r.cantidad}</span>
                    <button className="text-slate-400 underline hover:text-red-600" onClick={() => quitarRepuestoAUsar(r.id)}>Quitar</button>
                  </li>
                ))}
              </ul>
            )}
            <div className="mt-2 flex gap-2">
              <div className="flex-1">
                {articuloElegido ? (
                  <div className="input flex items-center justify-between">
                    <span>{articuloElegido.codigo} - {articuloElegido.descripcion}</span>
                    <button className="text-slate-400 hover:text-slate-700" onClick={() => setArticuloElegido(null)}>✕</button>
                  </div>
                ) : (
                  <BuscadorDeArticulo onElegir={setArticuloElegido} equipoId={equipoId} />
                )}
              </div>
              <div className="w-24 shrink-0">
                <input
                  className="input" inputMode="decimal" placeholder="Cant."
                  value={cantidadRepuesto} onChange={(e) => setCantidadRepuesto(e.target.value)}
                />
              </div>
              <button type="button" className="btn-secondary shrink-0" onClick={agregarRepuestoAUsar}>Agregar</button>
            </div>
            <p className="mt-1 text-xs text-slate-400">Esto reserva el repuesto — Inventario confirma la baja real después.</p>
          </div>

          <div className="mt-3 flex justify-end">
            <button className="btn-primary" disabled={guardando} onClick={cargar}>Cargar</button>
          </div>
          {aviso && <p className="mt-2 text-sm text-amber-700">{aviso}</p>}
          {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
        </section>
      )}

      <div className="mt-4 space-y-3">
        {estadoPorEquipo.map(({ equipo, horometroActual, escalones }) => (
          <div key={equipo.id} className="card p-4">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-slate-800">{equipo.code} - {equipo.name}</span>
              <span className="text-xs text-slate-500">
                Horómetro actual: {horometroActual !== null ? num0.format(horometroActual) : "sin lectura reciente"}
              </span>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
              {escalones.map((esc) => (
                <div key={esc.tier} className="rounded-lg border border-slate-200 p-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-slate-600">{esc.tier} hs</span>
                    <BadgeLectura lectura={esc.lectura} />
                  </div>
                  <div className="mt-1 text-xs text-slate-500">
                    {esc.proximoVencimiento !== null ? (
                      <>Próximo: {num0.format(esc.proximoVencimiento)}</>
                    ) : (
                      "Sin cargar todavía"
                    )}
                  </div>
                  {esc.horasFaltantes !== null && (
                    <div className={`text-xs ${esc.horasFaltantes <= 0 ? "text-red-600" : "text-slate-500"}`}>
                      {esc.horasFaltantes <= 0
                        ? `${num0.format(Math.abs(esc.horasFaltantes))} hs pasado`
                        : `Faltan ${num0.format(esc.horasFaltantes)} hs`}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      <section className="mt-6">
        <h2 className="section-title">Últimos services cargados</h2>
        <div className="card mt-2 overflow-x-auto">
          <table className="table-base">
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Equipo</th>
                <th className="text-right">Escalón</th>
                <th className="text-right">Horómetro</th>
                <th>Observaciones</th>
                <th>Repuestos</th>
              </tr>
            </thead>
            <tbody>
              {historial.length === 0 ? (
                <tr><td colSpan={6} className="py-8 text-center text-slate-400">Todavía no hay ningún service cargado.</td></tr>
              ) : (
                historial.map((s, i) => {
                  const equipo = equipos.find((e) => e.id === s.equipo_id);
                  const abierta = filaAbierta === s.id;
                  return (
                    <Fragment key={s.id}>
                      <tr style={{ backgroundColor: i % 2 === 1 ? "#F8FAFC" : undefined }}>
                        <td className="whitespace-nowrap">{s.fecha}</td>
                        <td className="text-slate-800">{equipo ? `${equipo.code} - ${equipo.name}` : "—"}</td>
                        <td className="text-right"><span className="badge badge-st">{s.tier} hs</span></td>
                        <td className="text-right font-mono tabular-nums">{num0.format(s.horometro)}</td>
                        <td className="text-slate-500">{s.observaciones ?? ""}</td>
                        <td className="whitespace-nowrap">
                          <button className="btn-ghost" onClick={() => setFilaAbierta(abierta ? null : s.id)}>
                            {abierta ? "Ocultar" : "Ver / agregar"}
                          </button>
                          {puedeEditar && (
                            <button className="btn-ghost text-red-600" onClick={() => borrar(s.id)}>Borrar</button>
                          )}
                        </td>
                      </tr>
                      {abierta && (
                        <tr>
                          <td colSpan={6} className="bg-slate-50 p-3">
                            <RepuestosDelTrabajo serviceId={s.id} equipoId={s.equipo_id} puedeEditar={puedeEditar} />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
