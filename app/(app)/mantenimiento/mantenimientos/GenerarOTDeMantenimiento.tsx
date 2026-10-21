"use client";

import { useState } from "react";
import Select from "@/components/Select";
import { ESPECIALIDADES } from "@/lib/mantenimiento/ordenes";
import { QUIENES_DE_OT } from "@/lib/mantenimiento/filtrosOt";
import { hoyEnArgentina } from "@/lib/core/fechas";
import {
  cuerpoDeLaOT, loQueFaltaDelMantenimiento, loQueHayQuePreguntar, loQueNoSeArreglaAca,
  respuestasIniciales, especialidadDeTipo, etiquetaDeTipo, nombreDelAsignado,
  type MantenimientoParaLaOT, type RespuestasDelMantenimiento,
} from "@/lib/mantenimiento/otDesdeMantenimiento";

/**
 * Las tres cosas que la OT de un mantenimiento programado necesita confirmar.
 *
 * El mantenimiento ya dice el equipo, el sector, la tarea y para cuándo. Lo que
 * no dice —o dice en otro vocabulario— es de qué especialidad es el trabajo y
 * si lo hace nuestra gente. Los tres son obligatorios desde el 19/10/2026.
 *
 * **No tiene su propia lista de campos.** Qué preguntar lo contesta
 * `loQueHayQuePreguntar`, que corre la misma regla que el servidor: el día que
 * la regla exija uno más, este formulario lo pide solo. El porqué está en el
 * encabezado de `lib/mantenimiento/otDesdeMantenimiento.ts`.
 *
 * **Y por qué las tres se ven aunque vengan contestadas.** Antes esto era un
 * «¿Continuar?» y un POST a ciegas, que es como `quien` terminó llevando el
 * nombre de una persona durante meses sin que nadie lo viera. Un dato heredado
 * que no se muestra no se distingue de uno inventado.
 *
 * Los vocabularios se importan de `lib/` y no se escriben acá.
 */
export default function GenerarOTDeMantenimiento({ mantenimiento, onClose, onCreada }: {
  mantenimiento: MantenimientoParaLaOT;
  onClose: () => void;
  onCreada: (mensaje: string) => void;
}) {
  const [respuestas, setRespuestas] = useState<RespuestasDelMantenimiento>(
    () => respuestasIniciales(mantenimiento)
  );
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");

  const preguntas = loQueHayQuePreguntar(mantenimiento);
  const sinArreglo = loQueNoSeArreglaAca(mantenimiento);
  const falta = loQueFaltaDelMantenimiento(mantenimiento, respuestas);

  // El tipo de tarea no siempre dice de qué oficio es el trabajo. Cuando no se
  // reconoce con certeza queda sin enlazar y se avisa acá, que es la otra mitad
  // de la decisión: enlazar al que se le parece es peor que dejar en null.
  const tipoSinEspecialidad = !especialidadDeTipo(mantenimiento.maintenance_type);
  const fechaVencida =
    !!respuestas.fecha_ejecucion && respuestas.fecha_ejecucion < hoyEnArgentina();
  const asignado = nombreDelAsignado(mantenimiento);

  const cambiar = (c: Partial<RespuestasDelMantenimiento>) =>
    setRespuestas((p) => ({ ...p, ...c }));

  async function generar() {
    setGuardando(true); setError("");
    const res = await fetch("/api/mantenimiento/ordenes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // El cuerpo lo arma `lib/`, no esta pantalla: es lo que hace que lo que
      // se valida acá sea exactamente lo que se manda.
      body: JSON.stringify(cuerpoDeLaOT(mantenimiento, respuestas)),
    });
    const body = await res.json().catch(() => ({}));
    setGuardando(false);

    if (!res.ok) { setError(body.error ?? "No se pudo generar la OT."); return; }

    onCreada(
      [
        `Se generó la OT #${body.ot_number}.`,
        body.planilla_error && `Ojo: no se pudo escribir en la planilla de OT (${body.planilla_error}).`,
      ].filter(Boolean).join(" ")
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4">
      <div className="mt-8 w-full max-w-lg rounded-lg bg-white p-5 shadow-xl">
        <h2 className="text-lg font-semibold text-slate-900">
          Generar la orden de trabajo
        </h2>
        <p className="mt-1 text-sm text-slate-500">
          Del mantenimiento programado de {mantenimiento.equipos?.code ?? "—"}. Lo que el
          mantenimiento ya dice no se vuelve a preguntar.
        </p>

        {/* Lo heredado, a la vista: es lo que explica por qué el formulario
            tiene tres campos y no diez. */}
        <dl className="mt-4 space-y-1 rounded border border-slate-200 bg-slate-50 p-3 text-sm">
          <Heredado rotulo="Equipo" valor={mantenimiento.equipos
            ? `${mantenimiento.equipos.code ?? ""} — ${mantenimiento.equipos.name ?? ""}`.trim()
            : null} />
          <Heredado rotulo="Sector" valor={mantenimiento.equipos?.sectores?.nombre ?? null} />
          <Heredado rotulo="Tarea" valor={etiquetaDeTipo(mantenimiento.maintenance_type) || null} />
          <Heredado rotulo="Descripción" valor={mantenimiento.description} />
          <Heredado rotulo="Asignado a" valor={asignado || null} />
          <Heredado rotulo="Tipo" valor="Programado — sale de un preventivo con fecha" />
        </dl>

        {sinArreglo.length > 0 ? (
          <div className="mt-4 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            <p className="font-medium">
              A este mantenimiento le falta {sinArreglo.join(" y ")}, y eso no se arregla
              desde acá.
            </p>
            <p className="mt-1">
              Una OT sin sector no suma a las horas de nadie. Se corrige en el equipo;
              hacerlo acá dejaría la orden diciendo una cosa y la ficha del equipo otra.
            </p>
          </div>
        ) : (
          <div className="mt-4 space-y-3">
            {preguntas.includes("la especialidad") && (
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-slate-500">
                  Especialidad
                </span>
                <Select
                  value={respuestas.especialidad}
                  onChange={(e) => cambiar({ especialidad: e.target.value })}
                  className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
                >
                  <option value="">— elegir —</option>
                  {ESPECIALIDADES.map((e) => <option key={e} value={e}>{e}</option>)}
                </Select>
                {tipoSinEspecialidad && (
                  <span className="mt-1 block text-xs text-amber-700">
                    «{etiquetaDeTipo(mantenimiento.maintenance_type)}» no dice de qué oficio
                    es el trabajo, así que hay que elegirlo. Adivinarlo dejaría la orden en
                    el filtro equivocado, y eso no se nota nunca.
                  </span>
                )}
              </label>
            )}

            {preguntas.includes("quién lo realiza") && (
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-slate-500">
                  Quién lo realiza
                </span>
                <Select
                  value={respuestas.quien}
                  onChange={(e) => cambiar({ quien: e.target.value })}
                  className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
                >
                  {QUIENES_DE_OT.map((q) => <option key={q} value={q}>{q}</option>)}
                </Select>
                <span className="mt-1 block text-xs text-slate-400">
                  {asignado && respuestas.quien !== "CONTRATADO"
                    ? `${asignado} va como operario de la orden.`
                    : "Un preventivo lo hace personal propio salvo que se tercerice."}
                </span>
              </label>
            )}

            {preguntas.includes("la fecha de ejecución") && (
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-slate-500">
                  Fecha de ejecución
                </span>
                <input
                  type="date"
                  value={respuestas.fecha_ejecucion}
                  onChange={(e) => cambiar({ fecha_ejecucion: e.target.value })}
                  className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
                />
                <span className={`mt-1 block text-xs ${fechaVencida ? "text-amber-700" : "text-slate-400"}`}>
                  {fechaVencida
                    ? "Es la próxima fecha del mantenimiento y ya pasó: la orden va a nacer atrasada."
                    : "Es para cuándo se compromete. Sin ella la orden no se atrasa nunca."}
                </span>
              </label>
            )}

            {/* Los campos que la regla pida y este formulario todavía no
                dibuje. No debería aparecer nunca; si aparece, es que la regla
                creció y hay que agregarle el campo — mejor dicho que callado. */}
            {preguntas.some((p) => !CAMPOS_QUE_DIBUJA.includes(p)) && (
              <p className="rounded border border-rose-300 bg-rose-50 px-3 py-2 text-sm text-rose-800">
                Esta pantalla no sabe preguntar: {preguntas.filter((p) => !CAMPOS_QUE_DIBUJA.includes(p)).join(", ")}.
                La orden hay que cargarla desde Órdenes de trabajo.
              </p>
            )}
          </div>
        )}

        {error && (
          <p className="mt-3 rounded border border-rose-300 bg-rose-50 px-3 py-2 text-sm text-rose-800">
            {error}
          </p>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded px-3 py-2 text-sm text-slate-600 hover:bg-slate-100"
          >
            Cancelar
          </button>
          <button
            onClick={generar}
            disabled={guardando || falta.length > 0}
            title={falta.length > 0 ? `Falta ${falta.join(", ")}.` : undefined}
            className="rounded bg-slate-800 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40"
          >
            {guardando ? "Generando…" : "Generar la OT"}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Los que este formulario sabe dibujar, con el nombre que les da la regla. */
const CAMPOS_QUE_DIBUJA = [
  "la especialidad", "quién lo realiza", "la fecha de ejecución",
  // Éstos los nombra la regla pero los contesta el mantenimiento; si faltan, se
  // avisa arriba con `loQueNoSeArreglaAca` en vez de dibujar un campo.
  "el sector", "el equipo", "la descripción", "el tipo de trabajo",
];

function Heredado({ rotulo, valor }: { rotulo: string; valor: string | null }) {
  if (!valor) return null;
  return (
    <div className="flex gap-2">
      <dt className="shrink-0 text-slate-400">{rotulo}:</dt>
      <dd className="text-slate-700">{valor}</dd>
    </div>
  );
}
