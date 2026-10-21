"use client";

import { useState } from "react";
import Select from "@/components/Select";
import { ESPECIALIDADES } from "@/lib/mantenimiento/ordenes";
import { QUIENES_DE_OT } from "@/lib/mantenimiento/filtrosOt";
import { hoyEnArgentina } from "@/lib/core/fechas";
import {
  cuerpoDeLaOT, loQueFaltaDelAviso, loQueHayQuePreguntar, loQueNoSeArreglaAca,
  type AvisoParaLaOT, type RespuestasDelAviso,
} from "@/lib/mantenimiento/otDesdeAviso";

/**
 * Las tres cosas que un aviso no puede contestar.
 *
 * El aviso ya dice el equipo, el sector, qué pasa y con qué urgencia. Lo que
 * no dice es de qué especialidad es el trabajo, quién lo va a hacer y para
 * cuándo — y los tres son obligatorios desde el 19/10/2026, porque de ellos
 * viven el MTBF, el atraso y las horas por sector.
 *
 * **No tiene su propia lista de campos.** Qué preguntar lo contesta
 * `loQueHayQuePreguntar`, que corre la misma regla que el servidor: el día que
 * la regla exija uno más, este formulario lo pide solo. Ver el encabezado de
 * `lib/mantenimiento/otDesdeAviso.ts`, que es donde está el porqué.
 *
 * Los vocabularios se importan de `lib/` y no se escriben acá. `NuevaOTModal`
 * tiene los suyos propios y no son los mismos —ofrece INSTRUMENTACIÓN y OTRO,
 * que no están en `ESPECIALIDADES`, y MIXTO, que no está en `QUIENES_DE_OT`—;
 * eso es una divergencia que ya existía y que hay que cerrar de aquel lado, no
 * copiarla para acá.
 */
export default function GenerarOTModal({ aviso, onClose, onCreada }: {
  aviso: AvisoParaLaOT;
  onClose: () => void;
  onCreada: (mensaje: string) => void;
}) {
  const [respuestas, setRespuestas] = useState<RespuestasDelAviso>({
    especialidad: "",
    // El trabajo lo hace nuestra gente salvo que se diga otra cosa: 759 de las
    // 999 órdenes con `quien` cargado son INTERNO. Viene puesto y se cambia.
    quien: "INTERNO",
    // Hoy, visible y editable. Dejarla vacía obliga a abrir el calendario en
    // cada aviso; ponerla sin que se vea la dejaría venciendo mañana sin que
    // nadie la haya elegido. Se ve, así que no es un dato inventado.
    fecha_ejecucion: hoyEnArgentina(),
  });
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");

  const preguntas = loQueHayQuePreguntar(aviso);
  const sinArreglo = loQueNoSeArreglaAca(aviso);
  const falta = loQueFaltaDelAviso(aviso, respuestas);

  const cambiar = (c: Partial<RespuestasDelAviso>) =>
    setRespuestas((p) => ({ ...p, ...c }));

  async function generar() {
    setGuardando(true); setError("");
    const res = await fetch("/api/mantenimiento/ordenes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // El cuerpo lo arma `lib/`, no esta pantalla: es lo que hace que lo que
      // se valida acá sea exactamente lo que se manda.
      body: JSON.stringify(cuerpoDeLaOT(aviso, respuestas)),
    });
    const body = await res.json().catch(() => ({}));
    setGuardando(false);

    if (!res.ok) { setError(body.error ?? "No se pudo generar la OT."); return; }

    onCreada(
      [
        `Se generó la OT #${body.ot_number} y el aviso ${aviso.oa_number} quedó marcado.`,
        body.planilla_error && `Ojo: no se pudo escribir en la planilla de OT (${body.planilla_error}).`,
        body.aviso_error && `Ojo: no se pudo marcar el aviso en su planilla (${body.aviso_error}).`,
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
          Del aviso {aviso.oa_number}. Lo que el aviso ya dice no se vuelve a preguntar.
        </p>

        {/* Lo heredado, a la vista: es lo que explica por qué el formulario
            tiene tres campos y no diez. */}
        <dl className="mt-4 space-y-1 rounded border border-slate-200 bg-slate-50 p-3 text-sm">
          <Heredado rotulo="Equipo" valor={aviso.equipo_raw} />
          <Heredado rotulo="Sector" valor={aviso.sector_raw} />
          <Heredado rotulo="Descripción" valor={aviso.descripcion} />
          <Heredado rotulo="Urgencia" valor={aviso.urgencia} />
          <Heredado rotulo="Tipo" valor="Correctivo — alguien reportó una falla" />
        </dl>

        {sinArreglo.length > 0 ? (
          <div className="mt-4 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            <p className="font-medium">
              A este aviso le falta {sinArreglo.join(" y ")}, y eso no se arregla desde acá.
            </p>
            <p className="mt-1">
              Una OT sin equipo no se puede contar contra ninguna máquina. El enlace se
              corrige en el aviso o en su planilla; engancharlo acá dejaría al aviso
              diciendo una cosa y a la orden otra.
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
                <span className="mt-1 block text-xs text-slate-400">
                  Es para cuándo se compromete. Sin ella la orden no se atrasa nunca.
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
  // Éstos los nombra la regla pero los contesta el aviso; si faltan, se avisa
  // arriba con `loQueNoSeArreglaAca` en vez de dibujar un campo.
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
