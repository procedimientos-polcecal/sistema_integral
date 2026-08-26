"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * Registrar el trabajo de una orden.
 *
 * Es el momento en que la OT deja de ser un pedido y pasa a ser algo que se
 * hizo: quién lo hizo, cuánto tardó, qué encontró. Queda de los dos lados —en
 * el sistema como ejecución y en la planilla, que sigue siendo la base—.
 */

const RESULTADOS = [
  { valor: "completado", label: "Completado" },
  { valor: "parcial", label: "Parcial" },
  { valor: "cancelado", label: "Cancelado" },
] as const;

/** A qué estado de la OT lleva cada resultado. */
const ESTADO_SEGUN: Record<string, string> = {
  completado: "REALIZADO",
  parcial: "EN_PROCESO",
  cancelado: "SUSPENDIDA",
};

const hoy = () => {
  const d = new Date();
  const mes = String(d.getMonth() + 1).padStart(2, "0");
  const dia = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mes}-${dia}`;
};

export default function RegistrarOTModal({
  orden, onCerrar, onRegistrada,
}: {
  orden: {
    id: string;
    ot_number: number | null;
    equipo_raw: string | null;
    descripcion: string | null;
    horas: number | null;
    contratista: string | null;
    operario_1: string | null;
    operario_2: string | null;
    operario_3: string | null;
  };
  onCerrar: () => void;
  onRegistrada: () => void;
}) {
  const [resultado, setResultado] = useState<string>("completado");
  const [cuando, setCuando] = useState(hoy());
  const [horas, setHoras] = useState(orden.horas != null ? String(orden.horas) : "");
  const [contratista, setContratista] = useState(orden.contratista ?? "");
  const [operario1, setOperario1] = useState(orden.operario_1 ?? "");
  const [operario2, setOperario2] = useState(orden.operario_2 ?? "");
  const [operario3, setOperario3] = useState(orden.operario_3 ?? "");
  const [observaciones, setObservaciones] = useState("");

  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");
  const [aviso, setAviso] = useState("");

  // Las listas de Configuración: se elige de ellas en vez de escribir. Es lo
  // que evita que "Candia" y "CANDIA" terminen siendo dos personas distintas.
  const [operarios, setOperarios] = useState<{ id: string; slot: number; nombre: string }[]>([]);
  const [contratistas, setContratistas] = useState<{ id: string; nombre: string }[]>([]);

  const traerListas = useCallback(async () => {
    const [o, c] = await Promise.all([
      fetch("/api/mantenimiento/operarios"),
      fetch("/api/mantenimiento/proveedores"),
    ]);
    if (o.ok) setOperarios((await o.json()).data ?? []);
    if (c.ok) setContratistas((await c.json()).data ?? []);
  }, []);

  useEffect(() => { traerListas(); }, [traerListas]);

  async function guardar() {
    if (!observaciones.trim() && resultado !== "completado") {
      setError("Contá qué pasó: un trabajo parcial o cancelado sin explicación no sirve después.");
      return;
    }
    setGuardando(true);
    setError("");

    // Primero la ejecución: es el registro de lo que se hizo y no depende de
    // que la planilla esté disponible.
    const ejecucion = await fetch("/api/mantenimiento/ejecuciones", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        work_order_id: orden.id,
        execution_status: resultado,
        executed_at: cuando,
        duration_hours: horas ? Number(horas) : null,
        observations: observaciones.trim() || null,
      }),
    });
    if (!ejecucion.ok) {
      const body = await ejecucion.json().catch(() => ({}));
      setGuardando(false);
      setError(body.error ?? "No se pudo registrar el trabajo.");
      return;
    }

    // Después la OT, que además escribe en la planilla.
    const res = await fetch("/api/mantenimiento/ordenes", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: orden.id,
        estado: ESTADO_SEGUN[resultado],
        fecha_cierre: cuando,
        horas: horas ? Number(horas) : null,
        contratista: contratista.trim() || null,
        operario_1: operario1.trim() || null,
        operario_2: operario2.trim() || null,
        operario_3: operario3.trim() || null,
        observaciones: observaciones.trim() || null,
      }),
    });
    const body = await res.json().catch(() => ({}));
    setGuardando(false);

    if (!res.ok) {
      setError(`El trabajo quedó registrado, pero no se pudo cerrar la OT: ${body.error ?? ""}`);
      return;
    }
    if (body.planilla_error) {
      // Quedó todo bien en la app: lo único que falta es la planilla, y hay
      // que decirlo con todas las letras para que alguien la complete a mano.
      setAviso(`Se registró todo, pero no se pudo escribir en la planilla: ${body.planilla_error}`);
      return;
    }
    onRegistrada();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 md:items-center" onClick={onCerrar}>
      <div
        className="max-h-[90vh] w-full max-w-lg space-y-4 overflow-y-auto rounded-2xl bg-white p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div>
          <h2 className="text-base font-bold text-gray-900">Registrar el trabajo</h2>
          <p className="mt-0.5 text-xs text-gray-400">
            OT #{orden.ot_number ?? "—"} · {orden.equipo_raw ?? orden.descripcion ?? ""}
          </p>
        </div>

        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">{error}</div>
        )}
        {aviso && (
          <div className="space-y-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            <p>{aviso}</p>
            <button onClick={onRegistrada} className="font-semibold underline">Entendido</button>
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <Campo etiqueta="Cómo salió">
            <select
              value={resultado}
              onChange={(e) => setResultado(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            >
              {RESULTADOS.map((r) => <option key={r.valor} value={r.valor}>{r.label}</option>)}
            </select>
          </Campo>

          <Campo etiqueta="Cuándo">
            <input
              type="date"
              value={cuando}
              onChange={(e) => setCuando(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            />
          </Campo>

          <Campo etiqueta="Horas">
            <input
              type="number"
              min="0"
              step="0.5"
              value={horas}
              onChange={(e) => setHoras(e.target.value)}
              placeholder="—"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            />
          </Campo>

          <Campo etiqueta="Contratista">
            <select
              value={contratista}
              onChange={(e) => setContratista(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            >
              <option value="">Lo hizo personal propio</option>
              {/* Si la OT ya traía uno que no está en la lista, se suma para
                  no perderlo al guardar. */}
              {[...new Set([
                ...contratistas.map((c) => c.nombre),
                ...(contratista ? [contratista] : []),
              ])].sort().map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </Campo>
        </div>

        <Campo etiqueta="Quiénes lo hicieron">
          <div className="grid grid-cols-3 gap-2">
            {[
              [operario1, setOperario1],
              [operario2, setOperario2],
              [operario3, setOperario3],
            ].map(([valor, set], i) => {
              // Cada columna de la orden tiene su propia lista de gente.
              const suyos = operarios.filter((o) => o.slot === i + 1).map((o) => o.nombre);
              const elegido = valor as string;
              return (
                <select
                  key={i}
                  value={elegido}
                  onChange={(e) => (set as (v: string) => void)(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                >
                  <option value="">Operario {i + 1}</option>
                  {[...new Set([...suyos, ...(elegido ? [elegido] : [])])].sort().map((n) => (
                    <option key={n} value={n}>{n}</option>
                  ))}
                </select>
              );
            })}
          </div>
        </Campo>

        <Campo etiqueta="Qué se hizo y qué se encontró">
          <textarea
            value={observaciones}
            onChange={(e) => setObservaciones(e.target.value)}
            rows={3}
            placeholder="Se cambió el rodamiento del lado motor; el acople está gastado y va a haber que cambiarlo."
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
          />
        </Campo>

        <div className="flex gap-2 pt-1">
          <button
            onClick={guardar}
            disabled={guardando}
            className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
          >
            {guardando ? "Guardando…" : "Registrar"}
          </button>
          <button
            onClick={onCerrar}
            className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            Cancelar
          </button>
        </div>
      </div>
    </div>
  );
}

function Campo({ etiqueta, children }: { etiqueta: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="block text-xs font-medium text-gray-600">{etiqueta}</span>
      {children}
    </label>
  );
}
