"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import Select from "@/components/Select";
import { comoSeLee } from "@/lib/core/fechas";
import { comoSeLeeElTurnoDelRobot, minutosComoSeLee } from "@/lib/produccion/molinos/formato";
import { minutosDeParada } from "@/lib/produccion/molinos/cola";
import type { OtParaEnlazar, ParadaExplicada } from "@/lib/produccion/molinos/consultas";
import { InsigniaDeEstado } from "../Piezas";
import type { MolinoDeLaCola } from "./page";

/** Cuántas paradas ya explicadas se listan abajo: las más recientes. */
const EXPLICADAS_VISIBLES = 30;

/** Lo que dice la pantalla donde iría la lista de OT cuando quien mira no tiene Mantenimiento. */
const SIN_ACCESO_A_MANTENIMIENTO = "No tenés acceso a Mantenimiento";

function etiquetaDeOt(o: OtParaEnlazar): string {
  const fecha = o.fecha ? ` · ${comoSeLee(o.fecha)}` : "";
  const equipo = o.equipo ? ` · ${o.equipo}` : "";
  const que = o.descripcion ? ` — ${o.descripcion.replace(/\s+/g, " ").slice(0, 70)}` : "";
  return `OT ${o.numero}${fecha}${equipo}${que}`;
}

async function enviar(
  metodo: "POST" | "PATCH" | "DELETE",
  cuerpo: Record<string, unknown>,
): Promise<string | null> {
  try {
    const res = await fetch("/api/produccion/molinos/paradas", {
      method: metodo,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(cuerpo),
    });
    if (res.ok) return null;
    const body = await res.json().catch(() => ({}));
    return body.error ?? `No se pudo guardar (${res.status}).`;
  } catch {
    return "No se pudo conectar. Revisá la señal y probá de nuevo.";
  }
}

/**
 * El desplegable de OT, o el aviso de que no hay con qué llenarlo.
 *
 * `ots` en `null` quiere decir "no tenés acceso a Mantenimiento" y **no** "no
 * hay OT": las dos cosas se ven igual en una lista vacía, y una lista vacía se
 * lee como lo segundo. Se dice con todas las letras.
 */
function CampoDeOt({
  ots,
  valor,
  onCambio,
}: {
  ots: OtParaEnlazar[] | null;
  valor: string;
  onCambio: (v: string) => void;
}) {
  if (ots === null) {
    return (
      <div className="rounded border border-dashed border-slate-300 bg-slate-50 px-3 py-2 text-sm text-slate-500">
        {SIN_ACCESO_A_MANTENIMIENTO}: no podés enlazar una orden de trabajo.
      </div>
    );
  }
  return (
    <Select className="input" value={valor} onChange={(e) => onCambio(e.target.value)} aria-label="Orden de trabajo">
      <option value="">Sin orden de trabajo</option>
      {ots.map((o) => (
        <option key={o.id} value={o.id}>
          {etiquetaDeOt(o)}
        </option>
      ))}
    </Select>
  );
}

function fechaCorta(fecha: string): string {
  const dia = new Date(`${fecha}T00:00:00`).toLocaleDateString("es-AR", { weekday: "short" });
  return `${dia.charAt(0).toUpperCase()}${dia.slice(1)} ${comoSeLee(fecha)}`;
}

function FilaSinExplicar({
  molino,
  turno,
  ots,
  puedeEditar,
}: {
  molino: MolinoDeLaCola;
  turno: MolinoDeLaCola["cola"]["sinExplicar"][number];
  ots: OtParaEnlazar[] | null;
  puedeEditar: boolean;
}) {
  const router = useRouter();
  const [motivo, setMotivo] = useState("");
  const [ot, setOt] = useState("");
  const [trabajando, setTrabajando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function guardar(diaEntero: boolean) {
    setTrabajando(true);
    setError(null);
    const falla = await enviar("POST", {
      molino_id: molino.id,
      fecha: turno.fecha,
      turno: diaEntero ? null : turno.turno,
      motivo,
      // Ausente y vacío no son lo mismo: sin acceso a Mantenimiento no se manda el campo.
      ...(ots !== null ? { orden_trabajo_id: ot === "" ? null : ot } : {}),
    });
    setTrabajando(false);
    if (falla) return setError(falla);
    router.refresh();
  }

  const sinMotivo = motivo.trim() === "";
  return (
    <li className="space-y-3 p-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="font-semibold text-slate-900">{fechaCorta(turno.fecha)}</span>
        <span className="text-sm text-slate-700">Turno {comoSeLeeElTurnoDelRobot(turno.turno)}</span>
        <span className="text-sm font-medium text-amber-800">
          Parada de {minutosComoSeLee(minutosDeParada(turno))}
        </span>
        <span className="text-xs text-slate-500">
          marchó {minutosComoSeLee(turno.minutosMarcha)} de {minutosComoSeLee(turno.minutosTeoricos)}
        </span>
        {turno.estado !== "normal" && <InsigniaDeEstado estado={turno.estado} />}
      </div>
      {puedeEditar && (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="block text-sm">
              <span className="mb-1 block text-xs font-semibold text-slate-600">Motivo</span>
              <input
                className="input"
                value={motivo}
                maxLength={500}
                placeholder="Por qué no marchó"
                onChange={(e) => setMotivo(e.target.value)}
              />
            </label>
            <div className="block text-sm">
              <span className="mb-1 block text-xs font-semibold text-slate-600">Orden de trabajo (opcional)</span>
              <CampoDeOt ots={ots} valor={ot} onCambio={setOt} />
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className="btn-primary" disabled={trabajando || sinMotivo} onClick={() => guardar(false)}>
              Guardar el motivo
            </button>
            <button
              type="button"
              className="btn-secondary"
              disabled={trabajando || sinMotivo}
              title="Usa este mismo motivo para los cuatro turnos del día"
              onClick={() => guardar(true)}
            >
              Planta parada todo el día
            </button>
            {sinMotivo && <span className="text-xs text-slate-500">Escribí el motivo para poder guardar.</span>}
          </div>
          {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
        </>
      )}
    </li>
  );
}

function ParadaYaExplicada({
  p,
  ots,
  puedeEditar,
}: {
  p: ParadaExplicada;
  ots: OtParaEnlazar[] | null;
  puedeEditar: boolean;
}) {
  const router = useRouter();
  const [editando, setEditando] = useState(false);
  const [motivo, setMotivo] = useState(p.motivo);
  const [ot, setOt] = useState(p.ordenTrabajoId ?? "");
  const [trabajando, setTrabajando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function guardar() {
    setTrabajando(true);
    setError(null);
    const falla = await enviar("PATCH", {
      id: p.id,
      motivo,
      ...(ots !== null ? { orden_trabajo_id: ot === "" ? null : ot } : {}),
    });
    setTrabajando(false);
    if (falla) return setError(falla);
    setEditando(false);
    router.refresh();
  }

  async function quitar() {
    const que = p.turno === null ? "la planta parada de todo el día" : "este motivo";
    if (!window.confirm(`¿Quitar ${que}? Los turnos vuelven a la cola de sin explicar.`)) return;
    setTrabajando(true);
    setError(null);
    const falla = await enviar("DELETE", { id: p.id });
    setTrabajando(false);
    if (falla) return setError(falla);
    router.refresh();
  }

  return (
    <li className="space-y-2 p-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="font-semibold text-slate-900">{fechaCorta(p.fecha)}</span>
        {p.turno === null ? (
          <span className="rounded-full border border-slate-300 bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-700">
            Planta parada · día entero
          </span>
        ) : (
          <span className="text-sm text-slate-700">Turno {comoSeLeeElTurnoDelRobot(p.turno)}</span>
        )}
        {/* El número se ve aunque quien mira no tenga Mantenimiento: lo resolvió el servidor. */}
        {p.ordenTrabajoId && (
          <span className="rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5 text-xs font-semibold text-sky-800">
            {p.otNumero !== null ? `OT ${p.otNumero}` : "OT enlazada"}
          </span>
        )}
      </div>

      {!editando && <p className="text-sm text-slate-800">{p.motivo}</p>}

      {editando && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="block text-sm">
            <span className="mb-1 block text-xs font-semibold text-slate-600">Motivo</span>
            <input className="input" value={motivo} maxLength={500} onChange={(e) => setMotivo(e.target.value)} />
          </label>
          <div className="block text-sm">
            <span className="mb-1 block text-xs font-semibold text-slate-600">Orden de trabajo</span>
            <CampoDeOt ots={ots} valor={ot} onCambio={setOt} />
          </div>
        </div>
      )}

      {puedeEditar && (
        <div className="flex flex-wrap items-center gap-2">
          {!editando ? (
            <>
              <button type="button" className="text-xs font-medium text-[var(--primary)] hover:underline" onClick={() => setEditando(true)}>
                Editar
              </button>
              <button type="button" className="text-xs font-medium text-red-700 hover:underline" disabled={trabajando} onClick={quitar}>
                Quitar
              </button>
            </>
          ) : (
            <>
              <button type="button" className="btn-primary" disabled={trabajando || motivo.trim() === ""} onClick={guardar}>
                Guardar
              </button>
              <button
                type="button"
                className="btn-secondary"
                disabled={trabajando}
                onClick={() => {
                  setEditando(false);
                  setMotivo(p.motivo);
                  setOt(p.ordenTrabajoId ?? "");
                  setError(null);
                }}
              >
                Cancelar
              </button>
            </>
          )}
        </div>
      )}
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
    </li>
  );
}

/**
 * La cola de turnos sin explicar de cada molino.
 *
 * Una parada se explica con un motivo escrito y, si la hay, con la OT de
 * Mantenimiento que la causó. **La OT la elige una persona de una lista**: no
 * se sugiere ni se completa por texto, porque enlazar a la que se le parece es
 * peor que dejarla vacía.
 */
export default function ColaClient({
  molinos,
  ots,
  puedeEditar,
}: {
  molinos: MolinoDeLaCola[];
  ots: OtParaEnlazar[] | null;
  puedeEditar: boolean;
}) {
  const total = molinos.reduce((n, m) => n + m.cola.sinExplicar.length, 0);

  return (
    <div className="mx-auto max-w-4xl space-y-6 md:p-6">
      <div>
        <h1 className="text-xl font-bold text-slate-900">Paradas sin explicar</h1>
        <p className="text-sm text-slate-500">
          Los turnos en que un molino marchó menos de lo que podía y nadie dijo por qué. El PC Robot informa{" "}
          <em>cuánto</em> paró; el motivo lo pone una persona.{" "}
          <Link href="/produccion/molinos" className="underline">Volver a los molinos</Link>
        </p>
      </div>

      {ots === null && (
        <div role="note" className="card border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          <strong>{SIN_ACCESO_A_MANTENIMIENTO}.</strong> Podés cargar el motivo de una parada, pero no enlazarla a una
          orden de trabajo: esas órdenes no se ven con tu usuario. Si una parada ya tiene su orden, se ve el número.
        </div>
      )}
      {!puedeEditar && (
        <div role="note" className="card border-slate-300 bg-slate-50 p-3 text-sm text-slate-700">
          Tu usuario ve esta lista pero no puede cargar motivos: hace falta nivel de edición en Producción.
        </div>
      )}
      {molinos.length === 0 && (
        <div className="card p-6 text-center text-sm text-slate-500">No hay ningún molino activo en el catálogo.</div>
      )}
      {molinos.length > 0 && total === 0 && (
        <div className="card p-4 text-sm text-slate-700">No hay turnos pendientes de explicar.</div>
      )}

      {molinos.map((m) => {
        const explicadas = m.cola.explicadas.slice(0, EXPLICADAS_VISIBLES);
        return (
          <section key={m.id} className="space-y-3">
            <h2 className="section-title">
              {m.nombre}
              <span className="ml-2 text-sm font-normal text-slate-500">{m.cola.sinExplicar.length} sin explicar</span>
            </h2>
            <p className="text-xs text-slate-500">
              Se pide motivo desde {minutosComoSeLee(m.umbralMinutos)} de parada, y sólo de {comoSeLee(m.desde)} en
              adelante: antes de esa fecha no se pide nada.
            </p>

            {m.cola.sinExplicar.length > 0 && (
              <ul className="card divide-y divide-slate-100">
                {m.cola.sinExplicar.map((t) => (
                  <FilaSinExplicar key={`${t.fecha}|${t.turno}`} molino={m} turno={t} ots={ots} puedeEditar={puedeEditar} />
                ))}
              </ul>
            )}

            {explicadas.length > 0 && (
              <details className="card" open={m.cola.sinExplicar.length === 0}>
                <summary className="cursor-pointer p-3 text-sm font-semibold text-slate-700">
                  Ya explicadas ({m.cola.explicadas.length})
                </summary>
                <ul className="divide-y divide-slate-100 border-t border-slate-100">
                  {explicadas.map((p) => (
                    <ParadaYaExplicada key={p.id} p={p} ots={ots} puedeEditar={puedeEditar} />
                  ))}
                </ul>
              </details>
            )}
          </section>
        );
      })}
    </div>
  );
}
