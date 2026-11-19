"use client";

import { useState } from "react";
import Select from "@/components/Select";
import { Modal, PieDeModal } from "@/components/Modal";
import { comoSeLee } from "@/lib/core/fechas";
import { oficioDeLaEspecialidad } from "@/lib/mantenimiento/genteDelDia";
import type { Turno } from "@/lib/mantenimiento/programacion";
import {
  comoSeDice,
  type OperarioDelCatalogo,
} from "@/lib/mantenimiento/operarioDelCatalogo";
import {
  elAvisoDeLaPlanilla,
  elCuerpoDeLaAsignacion,
  porQueNoEntra,
  porQueNoHayAQuienElegir,
  porQueNoSePuedeAsignar,
  type OrdenQueSeAsigna,
} from "@/lib/mantenimiento/asignarOperario";
import { OFICIOS, type OrdenDelDia } from "./CalendarioDeOT";

/**
 * Poner y sacar operarios de una OT, desde el mes.
 *
 * ── LAS TRES POSICIONES SON DE LA PLANILLA, NO UNA INVENCIÓN ───────────────
 *
 * Las columnas P, Q y R del master tienen cada una su propia lista de nombres
 * —la tabla `operarios`, con su `slot`—, y eso no es una preferencia del
 * formulario: medido el 19/11/2026 sobre las últimas 1.000 OT, **1.223
 * menciones de 1.223 están en la columna que el catálogo les asigna**. Por eso
 * acá hay tres posiciones y no una lista de tres huecos iguales, y por eso se
 * escribe el nombre del catálogo tal cual, sin tocarle una letra: el
 * desplegable del cierre tiene que ofrecer después lo mismo que esto asignó.
 *
 * ── LO QUE NO ENTRA SE OFRECE DESHABILITADO, CON EL MOTIVO ─────────────────
 *
 * Esconder al que no entra deja la pantalla contestando «no está» a una
 * pregunta que era «por qué no puedo». Es la misma regla que ya cumple «Mover
 * a otro día» en el panel del día.
 *
 * ── EL ORDEN LO DA EL OFICIO QUE PIDE LA ORDEN, CUANDO SE SABE ─────────────
 *
 * `oficioDeLaEspecialidad` traduce MECANICO → mecánico, ELECTRICO →
 * electricista y LUBRICACION → lubricador. Con las otras tres —CIVIL,
 * INSTRUMENTACIÓN y OTRO— devuelve `null` y entonces **no se sugiere a nadie**:
 * el orden queda el del catálogo. Inventarles un oficio sería enlazar al que se
 * le parece, que es lo que todo este repo evita.
 *
 * ── Y EL MOTIVO DE UNA FALTA NO ENTRA ACÁ ──────────────────────────────────
 *
 * Se dice «falta» o «de franco» y nunca el `tipo` de la ausencia, que es dato
 * médico y disciplinario. La ruta ni siquiera lo manda — ver el encabezado de
 * `app/api/mantenimiento/taller-del-mes/route.ts`.
 *
 * No lleva `useBorrador` y va `soloLectura`: son tres desplegables que escriben
 * en el acto, así que no hay nada a medio cargar que se pueda perder.
 */
export default function AsignarOperariosModal({
  orden, dia, catalogo, noVienenEseDia, turnos, falloDelTaller, cargandoElTaller,
  onCerrar, onAsignada,
}: {
  orden: OrdenDelDia;
  /** El día que se está mirando, que es contra el que se calculan turno y falta. */
  dia: string;
  catalogo: OperarioDelCatalogo[];
  /** Los empleados que ese día no vienen. */
  noVienenEseDia: string[];
  /** `empleadoId|dia` → el turno real de ese día (la pisada encima del ciclo). */
  turnos: Record<string, Turno>;
  /**
   * Por qué no se pudo traer el taller, si falló. Sin esto el modal se abría
   * con tres desplegables vacíos y ningún cartel, que es indistinguible de un
   * catálogo de operarios vacío.
   */
  falloDelTaller: string | null;
  /** Si el taller todavía no contestó. */
  cargandoElTaller: boolean;
  onCerrar: () => void;
  onAsignada: () => void;
}) {
  const [guardando, setGuardando] = useState<number | null>(null);
  const [error, setError] = useState("");
  /*
   * **Una lista y no un string.** El aviso de que la planilla no se dejó
   * escribir es la única defensa que el diseño aceptó para el vaciado, y
   * mientras fue uno solo la acción siguiente lo borraba: se sacaba a alguien,
   * Google rechazaba la celda, salía el cartel, se ponía a otro, y el cartel
   * desaparecía con la columna todavía diciendo el nombre viejo. Un cartel que
   * se borra solo no es la defensa que se prometió.
   */
  const [avisosDePlanilla, setAvisosDePlanilla] = useState<string[]>([]);

  /*
   * Lo que se ve es el estado local, no la grilla: la grilla se vuelve a pedir
   * recién al cerrar. Sin esto, poner un nombre no se vería hasta cerrar el
   * modal, y lo que sigue naturalmente ahí es volver a ponerlo.
   */
  const [puestos, setPuestos] = useState<OrdenQueSeAsigna>({
    estado: orden.estado,
    operario_1: orden.operario_1,
    operario_2: orden.operario_2,
    operario_3: orden.operario_3,
  });
  const [huboCambios, setHuboCambios] = useState(false);

  const cerrada = porQueNoSePuedeAsignar(puestos);
  const elOficio = oficioDeLaEspecialidad(orden.especialidad);

  /** Lo que se sabe de esa persona ese día: su turno, o que no viene. */
  function comoEsta(operario: OperarioDelCatalogo): { texto: string; alerta: boolean } {
    if (operario.porQueNoSeSabe) {
      return { texto: comoSeDice(operario.porQueNoSeSabe), alerta: true };
    }
    const id = operario.empleadoId!;
    if (noVienenEseDia.includes(id)) return { texto: "ese día no viene", alerta: true };
    const turno = turnos[`${id}|${dia}`];
    return turno
      ? { texto: `turno ${turno}`, alerta: false }
      : { texto: "sin turno del ciclo ese día", alerta: false };
  }

  /**
   * Los nombres de una posición, con el oficio que pide la orden adelante.
   *
   * El orden dentro de cada mitad es el del catálogo: lo que esto hace es
   * sugerir, no reordenar por una regla que nadie pidió.
   */
  function losDeLaPosicion(slot: number): OperarioDelCatalogo[] {
    const suyos = catalogo.filter((o) => o.slot === slot);
    if (!elOficio) return suyos;
    return [
      ...suyos.filter((o) => o.oficio === elOficio),
      ...suyos.filter((o) => o.oficio !== elOficio),
    ];
  }

  async function escribir(slot: number, nombre: string | null) {
    const queSacaba = puestos[`operario_${slot}` as keyof OrdenQueSeAsigna] as string | null;
    setGuardando(slot);
    setError("");

    try {
      const res = await fetch("/api/mantenimiento/ordenes", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(elCuerpoDeLaAsignacion(orden.id, slot, nombre)),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error ?? `El servidor contestó ${res.status}.`);
        return;
      }

      setPuestos((p) => ({ ...p, [`operario_${slot}`]: nombre }));
      setHuboCambios(true);

      // Lo que se dice lo decide `elAvisoDeLaPlanilla`, que está en `lib/` con
      // sus tests: acá sólo se acumula, para que no lo borre la acción siguiente.
      const aviso = elAvisoDeLaPlanilla(nombre, body.planilla_error ?? null, queSacaba);
      if (aviso) setAvisosDePlanilla((previos) => [...previos, aviso]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setGuardando(null);
    }
  }

  function cerrar() {
    if (huboCambios) onAsignada();
    else onCerrar();
  }

  return (
    // `soloLectura`: no hay nada escrito que perder, así que el fondo, la X y
    // Escape salen sin preguntar.
    <Modal titulo={`Asignar la OT #${orden.ot_number}`} alSalir={cerrar} soloLectura>
      <div className="space-y-4">
        <p className="-mt-2 text-xs text-slate-500 break-words">
          {comoSeLee(dia)} · {orden.descripcion?.trim() || "Sin descripción"}
        </p>

        {cerrada ? (
          <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">
            {cerrada}
          </p>
        ) : (
          <>
            <p className="rounded-lg bg-slate-100 px-2 py-1 text-[11px] text-slate-600">
              {elOficio
                ? `Esta orden es ${orden.especialidad}: primero van los ${OFICIOS[elOficio].varios}.`
                : "Esta especialidad no tiene un oficio del taller, así que no se sugiere a nadie."}
              {" "}El turno y la falta son del {comoSeLee(dia)}.
            </p>

            {[1, 2, 3].map((slot) => {
              const puesto = puestos[`operario_${slot}` as keyof OrdenQueSeAsigna] as string | null;
              const deLaPosicion = losDeLaPosicion(slot);
              const sinNadie = porQueNoHayAQuienElegir(
                deLaPosicion.length, falloDelTaller, cargandoElTaller
              );
              return (
                <div key={slot}>
                  <label className="mb-1 block text-xs font-medium text-slate-600">
                    Operario {slot}
                  </label>

                  {puesto ? (
                    <div className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white px-2 py-1.5">
                      <span className="min-w-0 break-words text-sm text-slate-800">{puesto}</span>
                      <button
                        type="button"
                        onClick={() => escribir(slot, null)}
                        disabled={guardando !== null}
                        className="btn-secondary shrink-0"
                      >
                        {guardando === slot ? "Sacando…" : "Sacar"}
                      </button>
                    </div>
                  ) : sinNadie ? (
                    <p className="rounded-lg border border-amber-200 bg-amber-50 px-2 py-1.5 text-xs text-amber-900 break-words">
                      {sinNadie}
                    </p>
                  ) : (
                    <Select
                      value=""
                      disabled={guardando !== null}
                      onChange={(e) => { if (e.target.value) escribir(slot, e.target.value); }}
                      className="input"
                    >
                      <option value="">
                        {guardando === slot ? "Guardando…" : "Elegir a alguien…"}
                      </option>
                      {deLaPosicion.map((o) => {
                        const noEntra = porQueNoEntra(puestos, o);
                        const estado = comoEsta(o);
                        return (
                          <option key={o.nombre} value={o.nombre} disabled={noEntra !== null}>
                            {o.nombre} — {noEntra ?? estado.texto}
                          </option>
                        );
                      })}
                    </Select>
                  )}
                </div>
              );
            })}
          </>
        )}

        {avisosDePlanilla.length > 0 && (
          <div className="space-y-1">
            {avisosDePlanilla.map((a, i) => (
              <div
                key={i}
                className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 break-words"
              >
                {a}
              </div>
            ))}
          </div>
        )}

        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 break-words">
            {error}
          </div>
        )}

        <PieDeModal className="flex justify-end">
          <button onClick={cerrar} className="btn-secondary">
            Listo
          </button>
        </PieDeModal>
      </div>
    </Modal>
  );
}
