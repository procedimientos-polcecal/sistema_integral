"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { CORTE_DE_LOS_TIPOS } from "@/lib/calidad/movimientos";
import type { FilaDelLibro } from "../StockClient";

const ETIQUETA_DE_ORIGEN: Record<string, string> = {
  odoo: "Odoo",
  recepcion: "Balanza",
  manual: "A mano",
  importacion: "Importado",
};

function t(n: number): string {
  return n.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function comoSeLee(iso: string): string {
  const [a, m, d] = iso.split("-");
  return `${d}/${m}/${a.slice(2)}`;
}

/**
 * El libro entero.
 *
 * **Acá viven los `sin_separar`, y en ningún otro lado.** Van con su etiqueta y
 * con las celdas de saldo en blanco: antes del 15/12/2025 el libro no
 * distinguía vegetal de residual, y un cero ahí se leería como "no había
 * carbón".
 */
export default function MovimientosClient({
  puedeEditar,
  libro,
  carbonilleros,
}: {
  puedeEditar: boolean;
  libro: FilaDelLibro[];
  carbonilleros: { id: string; nombre: string }[];
}) {
  const router = useRouter();
  const [mes, setMes] = useState("");
  const [tipo, setTipo] = useState("");
  const [carbon, setCarbon] = useState("");
  const [origen, setOrigen] = useState("");
  const [reintentando, setReintentando] = useState<string | null>(null);

  const visibles = useMemo(
    () =>
      libro.filter(
        (f) =>
          (!mes || f.fecha.startsWith(mes)) &&
          (!tipo || f.tipo === tipo) &&
          (!carbon || f.carbon === carbon) &&
          (!origen || f.origen === origen)
      ),
    [libro, mes, tipo, carbon, origen]
  );

  async function reintentar(id: string) {
    setReintentando(id);
    await fetch(`/api/calidad/movimientos/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ soloReintentar: true }),
    });
    setReintentando(null);
    router.refresh();
  }

  const hayHistoria = libro.some((f) => f.carbon === "sin_separar");

  return (
    <div className="mx-auto max-w-6xl space-y-4 md:p-6">
      <div>
        <h1 className="text-xl font-bold text-slate-900">Movimientos de carbonilla</h1>
        <p className="text-sm text-slate-500">
          {visibles.length} de {libro.length} movimientos.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        <input
          type="month"
          value={mes}
          onChange={(e) => setMes(e.target.value)}
          className="rounded border border-slate-300 px-2 py-1 text-sm"
        />
        <select
          value={tipo}
          onChange={(e) => setTipo(e.target.value)}
          className="rounded border border-slate-300 px-2 py-1 text-sm"
        >
          <option value="">Todo tipo</option>
          <option value="entrada">Entradas</option>
          <option value="consumo">Consumos</option>
          <option value="ajuste">Ajustes</option>
        </select>
        <select
          value={carbon}
          onChange={(e) => setCarbon(e.target.value)}
          className="rounded border border-slate-300 px-2 py-1 text-sm"
        >
          <option value="">Todo carbón</option>
          <option value="vegetal">Vegetal</option>
          <option value="residual">Residual</option>
          <option value="sin_separar">Sin separar (historia)</option>
        </select>
        <select
          value={origen}
          onChange={(e) => setOrigen(e.target.value)}
          className="rounded border border-slate-300 px-2 py-1 text-sm"
        >
          <option value="">Todo origen</option>
          <option value="odoo">Odoo</option>
          <option value="recepcion">Balanza</option>
          <option value="manual">A mano</option>
          <option value="importacion">Importado</option>
        </select>
        {(mes || tipo || carbon || origen) && (
          <button
            onClick={() => {
              setMes("");
              setTipo("");
              setCarbon("");
              setOrigen("");
            }}
            className="text-sm text-slate-600 underline"
          >
            Limpiar
          </button>
        )}
      </div>

      {hayHistoria && (
        <p className="rounded border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
          Los movimientos anteriores al {comoSeLee(CORTE_DE_LOS_TIPOS)} están marcados{" "}
          <strong>sin separar</strong>: hasta ese día el libro llevaba un solo saldo y no distinguía
          vegetal de residual. No suman a ninguno de los dos saldos de hoy, y por eso sus celdas van
          en blanco.
        </p>
      )}

      <div className="overflow-x-auto card">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-3 py-2">Fecha</th>
              <th className="px-3 py-2">Qué</th>
              <th className="px-3 py-2 text-right">Toneladas</th>
              <th className="px-3 py-2 text-right">Vegetal</th>
              <th className="px-3 py-2 text-right">Residual</th>
              <th className="px-3 py-2 text-right">Total</th>
              <th className="px-3 py-2">Origen</th>
              {puedeEditar && <th className="px-3 py-2" />}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {visibles.length === 0 && (
              <tr>
                <td colSpan={puedeEditar ? 8 : 7} className="px-3 py-6 text-center text-slate-400">
                  No hay movimientos con esos filtros.
                </td>
              </tr>
            )}
            {visibles.map((f) => {
              const sinSeparar = f.carbon === "sin_separar";
              return (
                <tr key={f.id} className={f.sheets_pendiente ? "bg-amber-50" : undefined}>
                  <td className="whitespace-nowrap px-3 py-1.5 text-slate-600">
                    {comoSeLee(f.fecha)}
                  </td>
                  <td className="px-3 py-1.5">
                    <span className="text-slate-900">
                      {f.tipo === "entrada"
                        ? carbonilleros.find((c) => c.id === f.carbonillero_id)?.nombre ?? "Entrada"
                        : f.tipo === "consumo"
                          ? `Consumo ${f.carbon}`
                          : `Ajuste ${f.carbon}`}
                    </span>
                    {sinSeparar && (
                      <span className="ml-1 rounded bg-slate-100 px-1 text-xs text-slate-500">
                        sin separar
                      </span>
                    )}
                    {f.motivo && <span className="ml-1 text-xs text-slate-500">— {f.motivo}</span>}
                    {f.orden && (
                      <span className="ml-1 font-mono text-xs text-slate-400">{f.orden}</span>
                    )}
                  </td>
                  <td
                    className={`px-3 py-1.5 text-right tabular-nums ${
                      f.toneladas < 0 ? "text-slate-500" : "font-semibold text-slate-900"
                    }`}
                  >
                    {t(f.toneladas)}
                  </td>
                  <td className="px-3 py-1.5 text-right tabular-nums text-slate-500">
                    {sinSeparar ? "" : t(f.saldoVegetal)}
                  </td>
                  <td className="px-3 py-1.5 text-right tabular-nums text-slate-500">
                    {sinSeparar ? "" : t(f.saldoResidual)}
                  </td>
                  <td className="px-3 py-1.5 text-right tabular-nums text-slate-600">
                    {sinSeparar ? "" : t(f.saldoTotal)}
                  </td>
                  <td className="whitespace-nowrap px-3 py-1.5 text-xs text-slate-400">
                    {ETIQUETA_DE_ORIGEN[f.origen] ?? f.origen}
                  </td>
                  {puedeEditar && (
                    <td className="px-3 py-1.5 text-right">
                      {f.sheets_pendiente && (
                        <button
                          onClick={() => reintentar(f.id)}
                          disabled={reintentando === f.id}
                          title={f.sheets_pendiente}
                          className="text-xs text-amber-700 underline disabled:opacity-50"
                        >
                          {reintentando === f.id ? "Escribiendo…" : "Reintentar planilla"}
                        </button>
                      )}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
