"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  DIAS, ESTADOS_PRODUCCION, ESTADO_LABELS, TURNOS,
  lunesDe, diasDeLaSemana, normalizarSemana, normalizarTextos,
  type EstadoProduccion,
} from "@/lib/mantenimiento/produccion";

/**
 * La grilla de producción: sectores por los siete días de una semana.
 *
 * Se carga para saber dónde hay lugar. Un día libre en todos los sectores de
 * una empresa es una ventana para reparar sin frenar el despacho, y por eso al
 * lado de cada sector se muestra lo que tiene pendiente de mantenimiento.
 */

interface Sector {
  id: string;
  nombre: string;
  empresa: string | null;
}

interface PendienteOT {
  id: string;
  ot_number: number | null;
  descripcion: string | null;
  equipo_raw: string | null;
  prioridad: string | null;
  estado: string | null;
  sector_id: string;
  requiere_parada_sector?: boolean | null;
}

interface PendienteOS {
  id: string;
  os_number: number | null;
  descripcion: string | null;
  estado: string | null;
  sector_id: string;
}

/** El plan de un sector para una semana. */
interface Plan {
  days: EstadoProduccion[];
  turnos: string[];
  motivos: string[];
  responsable: string;
  note: string;
}

const planVacio = (): Plan => ({
  days: Array(7).fill("LIBRE") as EstadoProduccion[],
  turnos: Array(7).fill(""),
  motivos: Array(7).fill(""),
  responsable: "",
  note: "",
});

/** "25/08", para el encabezado de cada día. */
function diaCorto(iso: string): string {
  const [, m, d] = iso.split("-");
  return `${d}/${m}`;
}

export default function ProduccionClient({
  sectores, puedeEditar, pendientesOT, pendientesOS,
}: {
  sectores: Sector[];
  puedeEditar: boolean;
  pendientesOT: PendienteOT[];
  pendientesOS: PendienteOS[];
}) {
  // Arranca en la semana que viene: es la que se planifica, no la que ya empezó.
  const [semana, setSemana] = useState<string>(() => {
    const hoy = new Date();
    hoy.setDate(hoy.getDate() + 7);
    return lunesDe(hoy);
  });
  const [planes, setPlanes] = useState<Record<string, Plan>>({});
  const [cargando, setCargando] = useState(true);
  const [guardando, setGuardando] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [editando, setEditando] = useState<{ sectorId: string; dia: number } | null>(null);
  const [verPendientes, setVerPendientes] = useState<Sector | null>(null);
  const [turnoFiltrado, setTurnoFiltrado] = useState("");

  const fechas = useMemo(() => diasDeLaSemana(semana), [semana]);

  /** Lo pendiente de cada sector, para cruzarlo con los días libres. */
  const otPorSector = useMemo(() => agrupar(pendientesOT), [pendientesOT]);
  const osPorSector = useMemo(() => agrupar(pendientesOS), [pendientesOS]);
  const pendientes = (sectorId: string) =>
    (otPorSector[sectorId]?.length ?? 0) + (osPorSector[sectorId]?.length ?? 0);

  /** Sectores con una OT pendiente que obliga a pararlos. */
  const aParar = useMemo(() => {
    const s = new Set<string>();
    for (const o of pendientesOT) if (o.requiere_parada_sector) s.add(o.sector_id);
    return s;
  }, [pendientesOT]);

  const cargar = useCallback(async () => {
    setCargando(true);
    setError("");

    const res = await fetch(`/api/mantenimiento/produccion?semana=${semana}`);
    const body = await res.json().catch(() => ({}));
    setCargando(false);

    if (!res.ok) {
      setError(body.error ?? "No se pudo traer la semana.");
      return;
    }

    const mapa: Record<string, Plan> = {};
    for (const fila of body.data ?? []) {
      mapa[fila.sector_id] = {
        days: normalizarSemana(fila.days, ESTADOS_PRODUCCION, "LIBRE"),
        turnos: normalizarTextos(fila.turnos),
        motivos: normalizarTextos(fila.motivos),
        responsable: fila.responsable ?? "",
        note: fila.note ?? "",
      };
    }
    setPlanes(mapa);
  }, [semana]);

  useEffect(() => { cargar(); }, [cargar]);

  const planDe = useCallback(
    (sectorId: string): Plan => planes[sectorId] ?? planVacio(),
    [planes]
  );

  /** Guarda el plan entero del sector: es como está guardado en la base. */
  async function guardar(sectorId: string, plan: Plan) {
    if (!puedeEditar) return;
    setGuardando(sectorId);
    setError("");

    const res = await fetch("/api/mantenimiento/produccion", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ week_start: semana, sector_id: sectorId, ...plan }),
    });
    setGuardando(null);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? "No se pudo guardar.");
    }
  }

  /** Cambia el plan en pantalla; `persistir` en false es para escribir en un input. */
  function cambiar(sectorId: string, parche: Partial<Plan>, persistir = true) {
    const plan = { ...planDe(sectorId), ...parche };
    setPlanes((p) => ({ ...p, [sectorId]: plan }));
    if (persistir) guardar(sectorId, plan);
  }

  function guardarDia(estado: EstadoProduccion, turnos: string, motivo: string) {
    if (!editando) return;
    const { sectorId, dia } = editando;
    const plan = planDe(sectorId);

    const days = [...plan.days]; days[dia] = estado;
    const turnosArr = [...plan.turnos]; turnosArr[dia] = turnos;
    const motivos = [...plan.motivos]; motivos[dia] = motivo;

    cambiar(sectorId, { days, turnos: turnosArr, motivos });
    setEditando(null);
  }

  function moverSemana(semanas: number) {
    const [a, m, d] = semana.split("-").map(Number);
    setSemana(lunesDe(new Date(a, m - 1, d + semanas * 7)));
  }

  // Los sectores se agrupan por empresa: la ventana de reparación se decide
  // por planta, no por sector suelto.
  const porEmpresa = useMemo(() => {
    const grupos: Record<string, Sector[]> = {};
    for (const s of sectores) (grupos[s.empresa ?? "Sin empresa"] ??= []).push(s);
    return grupos;
  }, [sectores]);

  /** Los días en que ningún sector de la empresa produce. */
  const libresDeEmpresa = (deLaEmpresa: Sector[]): boolean[] =>
    Array.from({ length: 7 }, (_, i) =>
      deLaEmpresa.every((s) => planDe(s.id).days[i] === "LIBRE")
    );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Producción semanal</h1>
          <p className="text-sm text-slate-500">
            {puedeEditar
              ? "Tocá una celda para cargar el día. Los días libres son los candidatos para reparar."
              : "Sólo lectura."}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => moverSemana(-1)}
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50"
            aria-label="Semana anterior"
          >‹</button>
          <span className="whitespace-nowrap text-sm font-semibold text-slate-700">
            Semana del {diaCorto(semana)}
          </span>
          <button
            onClick={() => moverSemana(1)}
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50"
            aria-label="Semana siguiente"
          >›</button>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      )}

      <div className="flex flex-wrap items-center gap-3 text-xs">
        {ESTADOS_PRODUCCION.map((k) => (
          <span key={k} className="inline-flex items-center gap-1.5">
            <span
              className="h-3 w-3 rounded"
              style={{ background: ESTADO_LABELS[k].bg, border: `1px solid ${ESTADO_LABELS[k].color}44` }}
            />
            <span className="text-slate-600">{ESTADO_LABELS[k].label}</span>
          </span>
        ))}

        <div className="ml-auto flex items-center gap-1">
          <span className="text-slate-400">Turno:</span>
          {[{ v: "", l: "Todos" }, ...TURNOS.map((t) => ({ v: t.valor as string, l: t.label }))].map((o) => (
            <button
              key={o.v || "todos"}
              onClick={() => setTurnoFiltrado(o.v)}
              className={`rounded-md px-2 py-1 text-xs font-semibold ${
                turnoFiltrado === o.v ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-500 hover:text-slate-700"
              }`}
            >{o.l}</button>
          ))}
        </div>
      </div>

      {cargando ? (
        <p className="py-12 text-center text-sm text-slate-400">Trayendo la semana…</p>
      ) : sectores.length === 0 ? (
        <p className="rounded-xl border border-slate-200 bg-white px-5 py-8 text-center text-sm text-slate-400">
          No hay sectores cargados.
        </p>
      ) : (
        <div className="space-y-5">
          {Object.entries(porEmpresa).map(([empresa, deLaEmpresa]) => {
            const libres = libresDeEmpresa(deLaEmpresa);

            // Con un turno filtrado se muestran sólo los sectores que trabajan
            // ese turno algún día de la semana.
            const visibles = turnoFiltrado
              ? deLaEmpresa.filter((s) => planDe(s.id).turnos.some((t) => t.includes(turnoFiltrado)))
              : deLaEmpresa;
            if (visibles.length === 0) return null;

            const pendientesEmpresa = deLaEmpresa.reduce((a, s) => a + pendientes(s.id), 0);

            return (
              <div key={empresa} className="overflow-hidden rounded-xl border border-slate-200 bg-white">
                <div className="border-b border-slate-100 bg-slate-50 px-4 py-2.5">
                  <h2 className="text-sm font-bold text-slate-800">{empresa}</h2>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-xs text-slate-400">
                        <th className="min-w-36 px-3 py-2 text-left font-medium">Sector</th>
                        {DIAS.map((d, i) => (
                          <th
                            key={d}
                            className={`px-1 py-2 text-center font-medium ${libres[i] ? "text-emerald-600" : ""}`}
                          >
                            <div>{d}</div>
                            <div className="text-[10px] text-slate-300">{diaCorto(fechas[i])}</div>
                          </th>
                        ))}
                        <th className="min-w-28 px-3 py-2 text-left font-medium">Responsable</th>
                        <th className="min-w-32 px-3 py-2 text-left font-medium">Nota</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {visibles.map((s) => {
                        const plan = planDe(s.id);
                        return (
                          <tr key={s.id}>
                            <td className="px-3 py-2 font-medium text-slate-800">
                              <div className="flex flex-wrap items-center gap-2">
                                <span>{s.nombre}</span>
                                {aParar.has(s.id) && (
                                  <span
                                    className="inline-flex items-center rounded-full border border-red-200 bg-red-50 px-1.5 py-0.5 text-[10px] font-bold text-red-600"
                                    title="Hay una OT pendiente que requiere parar este sector"
                                  >Parar</span>
                                )}
                                {pendientes(s.id) > 0 && (
                                  <button
                                    onClick={() => setVerPendientes(s)}
                                    className="inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700 hover:bg-amber-100"
                                    title="Mantenimiento pendiente en este sector"
                                  >{pendientes(s.id)} pendiente{pendientes(s.id) === 1 ? "" : "s"}</button>
                                )}
                              </div>
                            </td>

                            {plan.days.map((estado, i) => {
                              const m = ESTADO_LABELS[estado];
                              const turno = plan.turnos[i];
                              const motivo = plan.motivos[i];
                              // Atenuado: ese día no trabaja el turno filtrado.
                              const atenuado = Boolean(turnoFiltrado) && !turno.includes(turnoFiltrado);
                              return (
                                <td key={i} className="px-1 py-1.5 text-center align-top">
                                  <button
                                    onClick={() => puedeEditar && setEditando({ sectorId: s.id, dia: i })}
                                    disabled={!puedeEditar}
                                    className="w-full min-w-11 rounded-md py-1 disabled:cursor-default"
                                    style={{
                                      background: m.bg,
                                      color: m.color,
                                      border: `1px solid ${m.color}33`,
                                      opacity: atenuado ? 0.3 : 1,
                                    }}
                                    title={[m.label, turno && `Turnos: ${turno}`, motivo && `Motivo: ${motivo}`]
                                      .filter(Boolean).join(" · ")}
                                  >
                                    <div className="text-[10px] font-semibold leading-tight">
                                      {estado === "LIBRE" ? "—" : m.label}
                                    </div>
                                    {turno && (
                                      <div className="text-[9px] leading-tight opacity-80">{turno.split("").join("·")}</div>
                                    )}
                                    {motivo && <div className="text-[9px] leading-none">•</div>}
                                  </button>
                                </td>
                              );
                            })}

                            <td className="px-2 py-1.5">
                              <input
                                value={plan.responsable}
                                onChange={(e) => cambiar(s.id, { responsable: e.target.value }, false)}
                                onBlur={(e) => puedeEditar && guardar(s.id, { ...planDe(s.id), responsable: e.target.value })}
                                disabled={!puedeEditar}
                                placeholder="—"
                                className="w-full rounded-md border border-slate-200 px-2 py-1 text-xs outline-none focus:border-slate-400 disabled:border-transparent disabled:bg-transparent"
                              />
                            </td>
                            <td className="px-2 py-1.5">
                              <input
                                value={plan.note}
                                onChange={(e) => cambiar(s.id, { note: e.target.value }, false)}
                                onBlur={(e) => puedeEditar && guardar(s.id, { ...planDe(s.id), note: e.target.value })}
                                disabled={!puedeEditar}
                                placeholder="—"
                                className="w-full rounded-md border border-slate-200 px-2 py-1 text-xs outline-none focus:border-slate-400 disabled:border-transparent disabled:bg-transparent"
                              />
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {libres.some(Boolean) && (
                  <div className="space-y-0.5 border-t border-slate-100 bg-emerald-50/60 px-4 py-2.5 text-xs text-emerald-800">
                    <div>
                      <span className="font-semibold">Ningún sector produce: </span>
                      {DIAS.filter((_, i) => libres[i]).join(", ")}
                    </div>
                    {pendientesEmpresa > 0 && (
                      <div className="text-amber-700">
                        Hay {pendientesEmpresa} pendiente{pendientesEmpresa === 1 ? "" : "s"} de mantenimiento
                        para aprovechar la ventana.
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {guardando && <p className="text-right text-xs text-slate-400">Guardando…</p>}

      {verPendientes && (
        <PendientesDelSector
          sector={verPendientes.nombre}
          ot={otPorSector[verPendientes.id] ?? []}
          os={osPorSector[verPendientes.id] ?? []}
          onCerrar={() => setVerPendientes(null)}
        />
      )}

      {editando && (() => {
        const plan = planDe(editando.sectorId);
        const sector = sectores.find((s) => s.id === editando.sectorId);
        return (
          <EditorDeDia
            sector={sector?.nombre ?? ""}
            dia={`${DIAS[editando.dia]} ${diaCorto(fechas[editando.dia])}`}
            estado={plan.days[editando.dia]}
            turnos={plan.turnos[editando.dia]}
            motivo={plan.motivos[editando.dia]}
            onGuardar={guardarDia}
            onCerrar={() => setEditando(null)}
          />
        );
      })()}
    </div>
  );
}

/** Agrupa por sector lo que viene de la base. */
function agrupar<T extends { sector_id: string }>(items: T[]): Record<string, T[]> {
  const m: Record<string, T[]> = {};
  for (const i of items) (m[i.sector_id] ??= []).push(i);
  return m;
}

function PendientesDelSector({
  sector, ot, os, onCerrar,
}: {
  sector: string;
  ot: PendienteOT[];
  os: PendienteOS[];
  onCerrar: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 md:items-center" onClick={onCerrar}>
      <div
        className="max-h-[85vh] w-full max-w-md space-y-4 overflow-y-auto rounded-2xl bg-white p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-base font-bold text-slate-900">Pendiente en {sector}</h2>
            <p className="mt-0.5 text-xs text-slate-400">Para aprovechar la ventana de parada.</p>
          </div>
          <button onClick={onCerrar} className="text-xl leading-none text-slate-400 hover:text-slate-600">×</button>
        </div>

        <div>
          <p className="mb-1 text-xs font-semibold text-slate-500">Órdenes de trabajo ({ot.length})</p>
          {ot.length === 0 ? (
            <p className="text-xs text-slate-400">Sin OT pendientes.</p>
          ) : (
            <div className="space-y-1">
              {ot.map((o) => (
                <a
                  key={o.id}
                  href="/mantenimiento/ordenes"
                  className="block rounded-lg border border-slate-100 px-2.5 py-1.5 text-xs hover:bg-slate-50"
                >
                  <span className="font-mono text-slate-400">#{o.ot_number ?? "—"}</span>{" "}
                  <span className="text-slate-800">{o.descripcion ?? o.equipo_raw ?? "—"}</span>
                  {o.requiere_parada_sector && <span className="ml-1 font-semibold text-red-600">· parar</span>}
                </a>
              ))}
            </div>
          )}
        </div>

        <div>
          <p className="mb-1 text-xs font-semibold text-slate-500">Órdenes de servicio ({os.length})</p>
          {os.length === 0 ? (
            <p className="text-xs text-slate-400">Sin OS activas.</p>
          ) : (
            <div className="space-y-1">
              {os.map((o) => (
                <div key={o.id} className="rounded-lg border border-slate-100 px-2.5 py-1.5 text-xs">
                  <span className="font-mono text-slate-400">#{o.os_number ?? "—"}</span>{" "}
                  <span className="text-slate-800">{o.descripcion ?? "—"}</span>
                  {o.estado && <span className="ml-1 text-slate-400">· {o.estado}</span>}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function EditorDeDia({
  sector, dia, estado, turnos, motivo, onGuardar, onCerrar,
}: {
  sector: string;
  dia: string;
  estado: EstadoProduccion;
  turnos: string;
  motivo: string;
  onGuardar: (estado: EstadoProduccion, turnos: string, motivo: string) => void;
  onCerrar: () => void;
}) {
  const [est, setEst] = useState<EstadoProduccion>(estado);
  const [tur, setTur] = useState(turnos);
  const [mot, setMot] = useState(motivo);

  // Los turnos se guardan como una cadena — "MT" —, siempre en el orden
  // mañana/tarde/noche para que se lean igual en todas las celdas.
  const alternarTurno = (t: string) =>
    setTur((prev) =>
      TURNOS.map((x) => x.valor as string)
        .filter((x) => (x === t ? !prev.includes(x) : prev.includes(x)))
        .join("")
    );

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 md:items-center" onClick={onCerrar}>
      <div className="w-full max-w-sm space-y-4 rounded-2xl bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div>
          <h2 className="text-base font-bold text-slate-900">{sector}</h2>
          <p className="mt-0.5 text-xs text-slate-400">{dia}</p>
        </div>

        <div className="space-y-1">
          <label className="block text-xs font-medium text-slate-600">Estado</label>
          <div className="grid grid-cols-3 gap-2">
            {ESTADOS_PRODUCCION.map((k) => {
              const m = ESTADO_LABELS[k];
              const elegido = est === k;
              return (
                <button
                  key={k}
                  onClick={() => setEst(k)}
                  className="rounded-xl border-2 px-2 py-2 text-xs font-semibold"
                  style={{
                    borderColor: elegido ? m.color : "#E2E8F0",
                    background: elegido ? m.bg : "#fff",
                    color: elegido ? m.color : "#64748B",
                  }}
                >{m.label}</button>
              );
            })}
          </div>
        </div>

        <div className="space-y-1">
          <label className="block text-xs font-medium text-slate-600">Turnos</label>
          <div className="flex gap-2">
            {TURNOS.map((t) => {
              const elegido = tur.includes(t.valor);
              return (
                <button
                  key={t.valor}
                  onClick={() => alternarTurno(t.valor)}
                  className={`flex-1 rounded-xl border-2 px-2 py-2 text-xs font-semibold ${
                    elegido
                      ? "border-slate-900 bg-slate-900 text-white"
                      : "border-slate-200 bg-white text-slate-500"
                  }`}
                >{t.label}</button>
              );
            })}
          </div>
        </div>

        <div className="space-y-1">
          <label className="block text-xs font-medium text-slate-600">
            Motivo de la parada {est === "EN_PRODUCCION" && <span className="text-slate-400">(opcional)</span>}
          </label>
          <input
            value={mot}
            onChange={(e) => setMot(e.target.value)}
            placeholder={est === "EN_PRODUCCION" ? "Sin parada" : "Mantenimiento, falta de insumo, feriado…"}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-400"
          />
        </div>

        <div className="flex gap-2 pt-1">
          <button
            onClick={() => onGuardar(est, tur, mot)}
            className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800"
          >Guardar</button>
          <button
            onClick={onCerrar}
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >Cancelar</button>
        </div>
      </div>
    </div>
  );
}
