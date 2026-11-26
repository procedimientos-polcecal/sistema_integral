"use client";

import { useState } from "react";
import { useCargar } from "@/lib/core/useCargar";
import { useBorrador } from "@/lib/core/useBorrador";
import { claveDelBorrador } from "@/lib/core/borradorDeFormulario";
import Select from "@/components/Select";
import { Modal, PieDeModal } from "@/components/Modal";
import { comoSeLee } from "@/lib/core/fechas";
import { avisoDelPendiente } from "@/lib/mantenimiento/reintentoDePendientes";

interface CicloDelModal {
  repeticiones: number;
  desde: string | null;
  tareaMadre: string | null;
  tareaHija: string | null;
  componente: string | null;
}

interface Operario {
  id: string;
  slot: number;
  nombre: string;
}

/**
 * «Fue un cambio»: esta OT de rotación no se hizo porque se cambió la pieza.
 *
 * Lo aprieta **el que acomoda las órdenes**, no el que estuvo en la máquina
 * —se preguntó—, y de ahí salen las dos decisiones del formulario:
 *
 *   · **La fecha se pregunta y arranca vacía, nunca en hoy.** Es el mismo
 *     criterio que `RegistrarOTModal` desde el 16/11/2026, y acá importa más:
 *     si el cambio fue el lunes y esto se acomoda el jueves, el ciclo arranca
 *     tres días tarde y **todas** las rotaciones siguientes quedan corridas.
 *   · **El resto no se exige.** Quien acomoda puede no tenerlo, y una orden con
 *     huecos es mucho mejor que una con un dato inventado. Que valga la pena
 *     preguntarlo está medido: de los 74 cambios de martillos cerrados en los
 *     cuatro equipos, 62 tienen horas y 61 tienen operario 1.
 *
 * No hay campo de contratista —74 de 74 de esos cambios son INTERNO y cero
 * tienen contratista— ni de observaciones, que viven sólo en la celda W de la
 * planilla y en una orden recién creada no se pueden escribir: su fila llega
 * por `IMPORTRANGE` minutos después y la cola no las rehace. Las dos cosas se
 * agregan después, reabriendo la orden con «Registrar el trabajo».
 */
export default function FueUnCambioModal({
  orden, onCerrar, onRegistrado,
}: {
  orden: {
    id: string;
    ot_number: number | null;
    ciclo_id: string;
    ciclo_vuelta: number;
    equipo_raw: string | null;
    descripcion: string | null;
  };
  onCerrar: () => void;
  onRegistrado: () => void;
}) {
  const { valores, cambiar, tocado, tirar } = useBorrador(
    claveDelBorrador("mantenimiento-fue-un-cambio", { tipo: "ot", id: orden.id }),
    { cuando: "", horas: "", operario_1: "", operario_2: "", operario_3: "" },
  );
  const { cuando, horas } = valores;

  const [ciclo, setCiclo] = useState<CicloDelModal | null>(null);
  const [operarios, setOperarios] = useState<Operario[]>([]);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");
  const [aviso, setAviso] = useState("");

  useCargar(async (vigente) => {
    const [c, o] = await Promise.all([
      fetch(`/api/mantenimiento/ciclos/${orden.ciclo_id}`),
      fetch("/api/mantenimiento/operarios"),
    ]);
    const cicloBody = c.ok ? await c.json() : null;
    const operariosBody = o.ok ? await o.json() : null;
    if (!vigente()) return;
    if (cicloBody?.data) setCiclo(cicloBody.data);
    else setError("No se pudo leer el ciclo de esta orden.");
    if (operariosBody) setOperarios(operariosBody.data ?? []);
  }, [orden.ciclo_id]);

  const cambio = (ciclo?.tareaMadre ?? "el cambio").toLowerCase();
  const pieza = (ciclo?.componente ?? "las piezas").toLowerCase();

  async function registrar() {
    setGuardando(true);
    setError("");

    const res = await fetch(`/api/mantenimiento/ordenes/${orden.id}/fue-un-cambio`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fecha: cuando,
        horas: horas.trim(),
        operario_1: valores.operario_1.trim() || null,
        operario_2: valores.operario_2.trim() || null,
        operario_3: valores.operario_3.trim() || null,
      }),
    });
    const body = await res.json().catch(() => ({}));
    setGuardando(false);

    if (!res.ok) {
      setError(body.error ?? "No se pudo registrar el cambio.");
      return;
    }

    // Recién con el POST en verde no hay nada que recordar. Va antes del aviso
    // a propósito, igual que en `CancelarOTModal`: con el borrador tirado
    // `tocado` queda en false y el cartel no se cruza con «¿salir del
    // formulario?» cuando alguien cierra por el fondo.
    tirar();

    // Lo de la base ya está hecho; lo que puede faltar es lo de afuera. Se
    // nombran los dos porque son dos cosas distintas de ir a mirar.
    const dePlanilla = avisoDelPendiente(body.planilla_error, Boolean(body.planilla_error));
    const partes = [
      `Quedó la OT ${body.data?.ot_number} con el cambio y la ` +
      `OT ${orden.ot_number ?? "—"} cancelada.`,
      dePlanilla,
      body.calendario_error
        ? "El evento de la rotación no se pudo borrar del calendario: " +
          `${body.calendario_error}. Está anotado y se reintenta solo.`
        : null,
    ].filter(Boolean);

    if (partes.length > 1) {
      setAviso(partes.join(" "));
      return;
    }
    onRegistrado();
  }

  const terminado = Boolean(aviso);

  return (
    <Modal
      titulo={ciclo ? `Fue ${cambio}, no una rotación` : "Fue un cambio, no una rotación"}
      alSalir={terminado ? onRegistrado : onCerrar}
      tocado={tocado}
    >
      <div className="space-y-4">
        <p className="-mt-2 text-xs text-slate-400">
          OT #{orden.ot_number ?? "—"} · {orden.equipo_raw ?? orden.descripcion ?? ""}
        </p>

        <p className="text-sm text-slate-600">
          Se va a crear una orden nueva con {cambio} que sí se hizo, ya cerrada,
          y esta orden queda <strong>cancelada</strong> con el motivo escrito.
          El ciclo vuelve a contar desde la fecha que pongas acá.
        </p>

        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">{error}</div>
        )}
        {aviso && (
          <div className="space-y-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            <p>{aviso}</p>
            <button onClick={onRegistrado} className="font-semibold underline">Entendido</button>
          </div>
        )}

        {!terminado && (
          <>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className="block space-y-1">
                <span className="block text-xs font-medium text-slate-600">
                  Cuándo se cambiaron {pieza} *
                </span>
                <input
                  type="date"
                  value={cuando}
                  onChange={(e) => { cambiar({ cuando: e.target.value }); setError(""); }}
                  disabled={guardando}
                  className="input"
                />
                {ciclo?.desde && (
                  <span className="block text-xs text-slate-400">
                    El último cambio registrado es del {comoSeLee(ciclo.desde)}.
                  </span>
                )}
              </label>

              <label className="block space-y-1">
                <span className="block text-xs font-medium text-slate-600">Horas</span>
                {/* El ancho va en el envoltorio: `.input` declara `width: 100%`
                    fuera de toda capa y le gana a cualquier `w-*` al lado. */}
                <div className="w-24">
                  <input
                    type="number" min="0" step="0.5" value={horas}
                    onChange={(e) => cambiar({ horas: e.target.value })}
                    disabled={guardando} placeholder="—" className="input"
                  />
                </div>
              </label>
            </div>

            <label className="block space-y-1">
              <span className="block text-xs font-medium text-slate-600">Quiénes lo hicieron</span>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                {([1, 2, 3] as const).map((n) => {
                  const campo = `operario_${n}` as "operario_1" | "operario_2" | "operario_3";
                  // Cada columna de la orden tiene su propia lista de gente.
                  const suyos = operarios.filter((o) => o.slot === n).map((o) => o.nombre);
                  const elegido = valores[campo];
                  return (
                    <Select
                      key={campo}
                      value={elegido}
                      onChange={(e) =>
                        cambiar(
                          n === 1 ? { operario_1: e.target.value }
                          : n === 2 ? { operario_2: e.target.value }
                          : { operario_3: e.target.value }
                        )
                      }
                      className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                    >
                      <option value="">Operario {n}</option>
                      {[...new Set([...suyos, ...(elegido ? [elegido] : [])])].sort().map((x) => (
                        <option key={x} value={x}>{x}</option>
                      ))}
                    </Select>
                  );
                })}
              </div>
            </label>

            <PieDeModal className="flex gap-2">
              <button
                onClick={registrar}
                disabled={guardando || !cuando || !ciclo}
                className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
              >
                {guardando ? "Registrando…" : "Registrar el cambio"}
              </button>
              {/* El único que tira. Se llama «Descartar» y no «Cancelar» por lo
                  mismo que en `CancelarOTModal`: acá esa palabra está tomada. */}
              <button
                onClick={() => { tirar(); onCerrar(); }}
                disabled={guardando}
                className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Descartar
              </button>
            </PieDeModal>
          </>
        )}
      </div>
    </Modal>
  );
}
