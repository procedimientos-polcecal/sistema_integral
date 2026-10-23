"use client";

import { useMemo, useState } from "react";
import Select from "@/components/Select";
import { ESPECIALIDADES } from "@/lib/mantenimiento/ordenes";
import { QUIENES_DE_OT, TIPOS_DE_OT } from "@/lib/mantenimiento/filtrosOt";
import { avisoDelPendiente } from "@/lib/mantenimiento/reintentoDePendientes";
import { hoyEnArgentina } from "@/lib/core/fechas";
import { AYUDA_GUT, ESCALAS_GUT } from "@/lib/mantenimiento/gut";
import InfoTip from "@/components/InfoTip";
import type { SectorDePlanta } from "@/lib/mantenimiento/sectores";
import {
  cuerpoDeLaOT, loQuePropone, loQueFaltaDelAviso, loQueHayQuePreguntar,
  loQueElAvisoNoTrae,
  type AvisoParaLaOT, type RespuestasDelAviso,
} from "@/lib/mantenimiento/otDesdeAviso";

export interface EquipoDelAviso {
  id: string; name: string; code: string | null; sector_id: string | null;
}

/**
 * La orden de trabajo que sale de un aviso.
 *
 * **El aviso propone y una persona escribe la orden.** Todo lo que la OT va a
 * decir viene llenado con lo que el aviso sabe y se puede cambiar antes de
 * crearla; lo único que no se toca es a qué aviso pertenece.
 *
 * El porqué, que no se deduce del formulario: un aviso lo escribe quien ve la
 * falla, con las palabras que tiene a mano —«TRANSMISION HORNO 4 SALTA LA
 * CADENA»—, y la OT la lee después quien la va a hacer y quien va a contar las
 * horas contra esa máquina. Que el texto del aviso fuera además, sin tocar, el
 * de la orden obligaba a elegir entre dejar la orden mal escrita o no usar el
 * botón. **El aviso no se modifica**: sigue diciendo lo que dijo quien lo
 * cargó, que es lo que lo hace una prueba de qué se reportó y cuándo.
 *
 * Qué es obligatorio **no está escrito acá**: lo contesta `loQueFaltaDelAviso`,
 * que corre la misma regla que el servidor. Ver el encabezado de
 * `lib/mantenimiento/otDesdeAviso.ts`.
 *
 * Los vocabularios se importan de `lib/` y no se escriben acá. `NuevaOTModal` y
 * `FormularioOTOffline` tenían los suyos propios y no eran los mismos —ofrecían
 * INSTRUMENTACIÓN y OTRO, que no estaban en `ESPECIALIDADES`; PREDICTIVO y
 * MEJORA, que no estaban en `TIPOS_DE_OT`; y MIXTO, que no estaba en
 * `QUIENES_DE_OT`—. Se cerró el 21/10/2026, de aquel lado y no copiando la
 * divergencia para acá: los cinco valores se sumaron al vocabulario y las dos
 * pantallas lo importan. Hoy **ningún formulario de OT tiene lista propia**
 * salvo la de estados, que es un subconjunto a propósito.
 */
export default function GenerarOTModal({
  aviso, sectores, equipos, onClose, onCreada,
}: {
  aviso: AvisoParaLaOT;
  sectores: SectorDePlanta[];
  equipos: EquipoDelAviso[];
  onClose: () => void;
  onCreada: (mensaje: string) => void;
}) {
  const [form, setForm] = useState<RespuestasDelAviso>(() =>
    loQuePropone(aviso, {
      // El trabajo lo hace nuestra gente salvo que se diga otra cosa: 759 de
      // las 999 órdenes con `quien` cargado son INTERNO.
      quien: "INTERNO",
      // Hoy, visible y editable. Vacía obliga a abrir el calendario en cada
      // aviso; puesta sin que se vea la dejaría venciendo mañana sin que nadie
      // la haya elegido.
      fecha_ejecucion: hoyEnArgentina(),
    })
  );
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");

  const preguntas = loQueHayQuePreguntar(aviso);
  const noTrae = loQueElAvisoNoTrae(aviso);
  const falta = loQueFaltaDelAviso(aviso, form);

  const cambiar = (c: Partial<RespuestasDelAviso>) => setForm((p) => ({ ...p, ...c }));

  const delSector = useMemo(
    () => equipos.filter((e) => e.sector_id === form.sector_id),
    [equipos, form.sector_id]
  );

  /** Elegir un sector cambia el sector y **vacía el equipo**: el de antes es de
   *  otro lado, y dejarlo puesto es cómo las horas terminan en el centro de
   *  costo que no es. */
  function elegirSector(id: string) {
    const s = sectores.find((x) => x.id === id);
    cambiar({
      sector_id: id,
      sector_raw: s?.nombre ?? "",
      equipment_id: "", equipo_raw: "", equipo_code: "",
    });
  }

  function elegirEquipo(id: string) {
    const e = equipos.find((x) => x.id === id);
    cambiar({
      equipment_id: id,
      equipo_raw: e ? (e.code ? `${e.code} – ${e.name}` : e.name) : "",
      equipo_code: e?.code ?? "",
    });
  }

  async function generar() {
    setGuardando(true); setError("");
    const res = await fetch("/api/mantenimiento/ordenes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // El cuerpo lo arma `lib/`, no esta pantalla: es lo que hace que lo que
      // se valida acá sea exactamente lo que se manda.
      body: JSON.stringify(cuerpoDeLaOT(aviso, form)),
    });
    const body = await res.json().catch(() => ({}));
    setGuardando(false);

    if (!res.ok) { setError(body.error ?? "No se pudo generar la OT."); return; }

    onCreada(
      [
        `Se generó la OT #${body.ot_number} y el aviso ${aviso.oa_number} quedó marcado.`,
        avisoDelPendiente(body.planilla_error, body.planilla_reintentando),
        body.aviso_error && `Ojo: no se pudo marcar el aviso en su planilla (${body.aviso_error}).`,
      ].filter(Boolean).join(" ")
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4">
      <div className="my-8 w-full max-w-2xl rounded-lg bg-white p-5 shadow-xl">
        <h2 className="text-lg font-semibold text-slate-900">Generar la orden de trabajo</h2>
        <p className="mt-1 text-sm text-slate-500">
          Del aviso {aviso.oa_number}. Viene con lo que el aviso dice; todo se puede
          corregir antes de crearla, y el aviso no se toca.
        </p>

        {noTrae.length > 0 && (
          <p className="mt-3 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            El aviso llegó sin {noTrae.join(" y ")}: lo de abajo no viene de nadie, lo
            estás eligiendo vos.
          </p>
        )}

        <div className="mt-4 space-y-3">
          <Campo etiqueta="Descripción del trabajo">
            <textarea
              value={form.descripcion}
              onChange={(e) => cambiar({ descripcion: e.target.value })}
              rows={2}
              className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
            />
          </Campo>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Campo etiqueta="Sector">
              <Select
                value={form.sector_id}
                onChange={(e) => elegirSector(e.target.value)}
                className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
              >
                <option value="">— elegir —</option>
                {sectores.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
              </Select>
            </Campo>
            <Campo etiqueta="Equipo">
              <Select
                value={form.equipment_id}
                onChange={(e) => elegirEquipo(e.target.value)}
                className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
              >
                <option value="">— elegir —</option>
                {delSector.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.code ? `${e.code} – ${e.name}` : e.name}
                  </option>
                ))}
              </Select>
            </Campo>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Campo etiqueta="Especialidad">
              <Select
                value={form.especialidad}
                onChange={(e) => cambiar({ especialidad: e.target.value })}
                className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
              >
                <option value="">— elegir —</option>
                {ESPECIALIDADES.map((e) => <option key={e} value={e}>{e}</option>)}
              </Select>
            </Campo>
            <Campo etiqueta="Tipo de trabajo">
              <Select
                value={form.tipo}
                onChange={(e) => cambiar({ tipo: e.target.value })}
                className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
              >
                {TIPOS_DE_OT.map((t) => <option key={t} value={t}>{t}</option>)}
              </Select>
            </Campo>
            <Campo etiqueta="Quién lo realiza">
              <Select
                value={form.quien}
                onChange={(e) => cambiar({ quien: e.target.value })}
                className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
              >
                {QUIENES_DE_OT.map((q) => <option key={q} value={q}>{q}</option>)}
              </Select>
            </Campo>
            <Campo etiqueta="Prioridad">
              {/* Sin emoji: acá se elige la palabra y la ruta la traduce una
                  sola vez con `prioridadParaLaPlanilla`, antes de sus dos usos.
                  Poner el emoji acá sería la segunda traducción. */}
              <Select
                value={form.prioridad}
                onChange={(e) => cambiar({ prioridad: e.target.value })}
                className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
              >
                {["ALTA", "MEDIA", "BAJA"].map((p) => <option key={p} value={p}>{p}</option>)}
              </Select>
            </Campo>
          </div>

          {/* Puntaje GUT: opcional, sin valor por defecto y **sin sembrar desde
              la urgencia del aviso** —ver `loQuePropone`—. Esa urgencia la puso
              quien reportó la falla; esto lo contesta quien reparte el
              trabajo. Las tres van juntas o la orden queda sin puntaje. */}
          <div className="space-y-1">
            <p className="text-xs font-medium text-slate-500">
              Puntaje GUT <span className="font-normal text-slate-400">— opcional, las tres juntas</span>
            </p>
            <p className="text-xs text-slate-400">
              La prioridad de arriba es la de la planilla; lo que ordena el trabajo en el sistema es el GUT.
            </p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              {([
                ["gut_gravedad", "Gravedad", ESCALAS_GUT.gravedad],
                ["gut_urgencia", "Urgencia", ESCALAS_GUT.urgencia],
                ["gut_tendencia", "Tendencia", ESCALAS_GUT.tendencia],
              ] as const).map(([campo, etiqueta, escala]) => (
                <Campo key={campo} etiqueta={etiqueta} ayuda={AYUDA_GUT[campo]}>
                  <Select
                    value={form[campo]}
                    onChange={(e) => cambiar({ [campo]: e.target.value })}
                    className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
                  >
                    <option value="">—</option>
                    {escala.map((palabra, i) => (
                      <option key={i + 1} value={String(i + 1)}>{i + 1} · {palabra}</option>
                    ))}
                  </Select>
                </Campo>
              ))}
            </div>
          </div>

          <Campo etiqueta="Fecha de ejecución">
            <input
              type="date"
              value={form.fecha_ejecucion}
              onChange={(e) => cambiar({ fecha_ejecucion: e.target.value })}
              className="w-full rounded border border-slate-300 px-3 py-2 text-sm sm:w-56"
            />
            <span className="mt-1 block text-xs text-slate-400">
              Para cuándo se compromete. Sin ella la orden no se atrasa nunca.
            </span>
          </Campo>

          {/* Un campo que la regla pida y este formulario no dibuje. No
              debería aparecer nunca; si aparece, la regla creció y hay que
              agregarlo — mejor dicho que callado. */}
          {preguntas.some((p) => !CAMPOS_QUE_DIBUJA.includes(p)) && (
            <p className="rounded border border-rose-300 bg-rose-50 px-3 py-2 text-sm text-rose-800">
              Esta pantalla no sabe preguntar:{" "}
              {preguntas.filter((p) => !CAMPOS_QUE_DIBUJA.includes(p)).join(", ")}. La orden
              hay que cargarla desde Órdenes de trabajo.
            </p>
          )}
        </div>

        {error && (
          <p className="mt-3 rounded border border-rose-300 bg-rose-50 px-3 py-2 text-sm text-rose-800">
            {error}
          </p>
        )}

        <div className="mt-5 flex items-center justify-end gap-2">
          {falta.length > 0 && (
            <span className="mr-auto text-xs text-slate-400">Falta {falta.join(", ")}.</span>
          )}
          <button onClick={onClose} className="rounded px-3 py-2 text-sm text-slate-600 hover:bg-slate-100">
            Cancelar
          </button>
          <button
            onClick={generar}
            disabled={guardando || falta.length > 0}
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
  "el sector", "el equipo", "la descripción", "la especialidad",
  "el tipo de trabajo", "quién lo realiza", "la fecha de ejecución",
];

function Campo({ etiqueta, ayuda, children }: {
  etiqueta: string; ayuda?: string; children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-slate-500">
        {etiqueta}
        {/* El `(i)` es un `<button>` adentro de un `<label>`: `InfoTip` corta
            la propagación del clic, así que abrirlo no activa el desplegable. */}
        {ayuda && <> <InfoTip text={ayuda} /></>}
      </span>
      {children}
    </label>
  );
}
