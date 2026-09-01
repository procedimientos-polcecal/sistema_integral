"use client";

import { useState } from "react";
import { useCargar } from "@/lib/core/useCargar";

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

  // La foto del trabajo hecho. Va a Drive y su link a la planilla, que es donde
  // la busca quien no entra al sistema.
  const [foto, setFoto] = useState<{ link: string; nombre: string } | null>(null);
  const [subiendo, setSubiendo] = useState(false);

  // Las listas de Configuración: se elige de ellas en vez de escribir. Es lo
  // que evita que "Candia" y "CANDIA" terminen siendo dos personas distintas.
  const [operarios, setOperarios] = useState<{ id: string; slot: number; nombre: string }[]>([]);
  const [contratistas, setContratistas] = useState<{ id: string; nombre: string }[]>([]);

  const traerListas = useCargar(async (vigente) => {
    const [o, c] = await Promise.all([
      fetch("/api/mantenimiento/operarios"),
      fetch("/api/mantenimiento/proveedores"),
    ]);
    const operariosBody = o.ok ? await o.json() : null;
    const contratistasBody = c.ok ? await c.json() : null;
    if (!vigente()) return;
    if (operariosBody) setOperarios(operariosBody.data ?? []);
    if (contratistasBody) setContratistas(contratistasBody.data ?? []);
  }, []);

  async function subirFoto(archivo: File) {
    setSubiendo(true);
    setError("");

    const fd = new FormData();
    fd.append("file", archivo);
    fd.append("ot", String(orden.ot_number ?? ""));

    const res = await fetch("/api/mantenimiento/fotos", { method: "POST", body: fd });
    const body = await res.json().catch(() => ({}));
    setSubiendo(false);

    if (!res.ok) { setError(body.error ?? "No se pudo subir la foto."); return; }
    setFoto({ link: body.link, nombre: archivo.name });
    // El link sólo se escribe en la planilla si se puede abrir desde afuera.
    if (body.aviso) setAviso(body.aviso);
  }

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
        foto_url: foto?.link ?? undefined,
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

        <Campo etiqueta="Foto del trabajo">
          {foto ? (
            <div className="flex items-center gap-2 text-sm">
              <a
                href={foto.link}
                target="_blank"
                rel="noopener noreferrer"
                className="min-w-0 flex-1 truncate text-blue-600 hover:underline"
              >
                {foto.nombre}
              </a>
              <button
                onClick={() => setFoto(null)}
                className="shrink-0 text-xs text-gray-400 hover:text-red-600"
                title="Sacar la foto"
              >×</button>
            </div>
          ) : (
            <input
              type="file"
              accept="image/*"
              capture="environment"
              disabled={subiendo}
              onChange={(e) => {
                const archivo = e.target.files?.[0];
                e.target.value = "";
                if (archivo) subirFoto(archivo);
              }}
              className="w-full text-sm text-gray-600 file:mr-2 file:rounded-lg file:border-0 file:bg-gray-100 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-gray-700"
            />
          )}
          {subiendo && <p className="text-xs text-gray-400">Subiendo…</p>}
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
