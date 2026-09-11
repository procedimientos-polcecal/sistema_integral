"use client";

import { useState } from "react";
import { cruce } from "@/lib/cantera/costos";

/**
 * El cruce de una etapa (o de un bochón) contra una factura de Odoo.
 *
 * Un solo componente para las tres conciliaciones del módulo (perforación,
 * voladura, bochón): cambia el `endpoint` y, para voladuras, la `etapa` que
 * va en el cuerpo del PATCH — el resto es igual. Sólo se monta si
 * `puedeFacturar`, así que no repite ese chequeo acá.
 *
 * "El SdG propone, Odoo confirma": esto nunca crea ni postea nada en
 * Odoo — vincula un registro de cantera a una factura que ya existe y
 * compara importes.
 */

interface FacturaOdoo {
  id: number;
  name: string;
  ref: string | null;
  fecha: string | null;
  empresa: string;
  importeNeto: number;
  importeTotal: number;
  proveedor: string;
}

export interface VinculoOdoo {
  moveId: number | null;
  moveName: string | null;
  empresa: string | null;
  ref: string | null;
  importe: number | null;
  conforme: boolean | null;
  conformeObs: string | null;
}

// El importe de Odoo (`amount_untaxed`) y el monto calculado de cantera son
// los dos en pesos: los contratistas facturan en ARS, y `montoPerforacion` /
// `montoVoladura` / `montoBochon` ya vienen multiplicados por el TC.
const ars = new Intl.NumberFormat("es-AR", { maximumFractionDigits: 0 });

const ETIQUETA_LECTURA: Record<string, string> = {
  coincide: "Coincide",
  revisar: "Revisar",
  sin_factura: "Sin factura vinculada",
  sin_monto: "Sin monto calculado",
};

function ChipLectura({ lectura }: { lectura: string }) {
  const clases: Record<string, string> = {
    coincide: "bg-emerald-50 text-emerald-700",
    revisar: "bg-amber-50 text-amber-700",
    sin_factura: "bg-slate-100 text-slate-500",
    sin_monto: "bg-slate-100 text-slate-500",
  };
  return (
    <span className={`rounded px-2 py-0.5 text-xs ${clases[lectura] ?? clases.sin_factura}`}>
      {ETIQUETA_LECTURA[lectura] ?? lectura}
    </span>
  );
}

export default function ConciliacionOdoo({
  titulo,
  endpoint,
  etapa,
  montoCalculado,
  vinculado,
  onCambio,
}: {
  titulo: string;
  endpoint: string;
  etapa?: "perf" | "vol";
  montoCalculado: number | null;
  vinculado: VinculoOdoo;
  onCambio: () => void;
}) {
  const [buscando, setBuscando] = useState(false);
  const [candidatas, setCandidatas] = useState<FacturaOdoo[] | null>(null);
  const [elegida, setElegida] = useState("");
  const [error, setError] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [ref, setRef] = useState(vinculado.ref ?? "");
  const [conformeObs, setConformeObs] = useState(vinculado.conformeObs ?? "");

  const c = cruce(montoCalculado, vinculado.importe);

  async function patch(cuerpo: Record<string, unknown>) {
    setGuardando(true);
    setError("");
    const res = await fetch(endpoint, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(etapa ? { etapa, ...cuerpo } : cuerpo),
    });
    setGuardando(false);
    if (!res.ok) {
      setError((await res.json()).error ?? "No se pudo guardar.");
      return false;
    }
    onCambio();
    return true;
  }

  async function buscarFacturas() {
    setBuscando(true);
    setError("");
    setCandidatas(null);
    const res = await fetch(endpoint);
    setBuscando(false);
    if (!res.ok) {
      setError((await res.json()).error ?? "No se pudieron traer las facturas de Odoo.");
      return;
    }
    const { candidatas: lista, sinEnlace } = await res.json();
    setCandidatas(lista);
    if (sinEnlace?.length) {
      setError(
        `${sinEnlace.map((s: { nombre: string }) => s.nombre).join(", ")} ${
          sinEnlace.length === 1 ? "está" : "están"
        } en la lista de contratistas pero sin enlace a Odoo (proveedores_odoo) — no aparece en el picker.`
      );
    }
  }

  async function vincular() {
    if (!elegida) return;
    const ok = await patch({ odoo_move_id: Number(elegida) });
    if (ok) { setCandidatas(null); setElegida(""); }
  }

  async function desvincular() {
    await patch({ odoo_move_id: null });
  }

  return (
    <div className="mt-3 rounded border border-slate-200 bg-slate-50 p-3">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold text-slate-600">Conciliación · {titulo}</h3>
        {vinculado.moveId != null && <ChipLectura lectura={c.lectura} />}
      </div>

      {error && <p className="mt-2 text-xs text-red-700">{error}</p>}

      {vinculado.moveId != null ? (
        <div className="mt-2 space-y-1 text-xs text-slate-700">
          <p>
            <span className="font-mono">{vinculado.moveName}</span>
            {vinculado.empresa && ` · ${vinculado.empresa}`}
            {vinculado.importe != null && ` · $ ${ars.format(vinculado.importe)} neto`}
          </p>
          {montoCalculado != null && vinculado.importe != null && (
            <p className="text-slate-500">
              Calculado $ {ars.format(montoCalculado)} vs. factura $ {ars.format(vinculado.importe)}
              {c.diferencia != null && ` — diferencia $ ${ars.format(c.diferencia)} (${(c.porcentaje! * 100).toFixed(1)}%)`}
            </p>
          )}
          <button onClick={desvincular} disabled={guardando} className="text-red-600 underline disabled:opacity-50">
            Desvincular
          </button>
        </div>
      ) : (
        <div className="mt-2">
          {candidatas === null ? (
            <button onClick={buscarFacturas} disabled={buscando} className="text-xs text-slate-600 underline disabled:opacity-50">
              {buscando ? "Buscando en Odoo…" : "Buscar factura en Odoo"}
            </button>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <select
                className="rounded border border-slate-300 px-2 py-1 text-xs"
                value={elegida}
                onChange={(e) => setElegida(e.target.value)}
              >
                <option value="">— elegir factura —</option>
                {candidatas.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.proveedor} · {f.name} · $ {ars.format(f.importeNeto)}
                    {f.fecha ? ` · ${f.fecha}` : ""}
                  </option>
                ))}
              </select>
              <button onClick={vincular} disabled={!elegida || guardando} className="text-xs text-slate-800 underline disabled:opacity-50">
                Vincular
              </button>
              <button onClick={() => setCandidatas(null)} className="text-xs text-slate-400 underline">
                cancelar
              </button>
              {candidatas.length === 0 && <span className="text-xs text-slate-500">Sin facturas disponibles.</span>}
            </div>
          )}
        </div>
      )}

      <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
        <label className="text-xs text-slate-600">
          Nro. de factura del proveedor
          <input
            className="mt-1 w-full rounded border border-slate-300 px-2 py-1 text-xs"
            value={ref}
            onChange={(e) => setRef(e.target.value)}
            onBlur={() => ref !== (vinculado.ref ?? "") && patch({ ref })}
            placeholder="casi siempre vacío en Odoo"
          />
        </label>
        <label className="flex items-center gap-2 text-xs text-slate-600">
          <input
            type="checkbox"
            checked={vinculado.conforme === true}
            onChange={(e) => patch({ conforme: e.target.checked })}
            disabled={guardando}
          />
          Conforme
        </label>
      </div>
      <label className="mt-2 block text-xs text-slate-600">
        Observación de la conciliación
        <textarea
          className="mt-1 w-full rounded border border-slate-300 px-2 py-1 text-xs"
          rows={2}
          value={conformeObs}
          onChange={(e) => setConformeObs(e.target.value)}
          onBlur={() => conformeObs !== (vinculado.conformeObs ?? "") && patch({ conforme_obs: conformeObs })}
        />
      </label>
    </div>
  );
}
