"use client";

import { useCallback, useEffect, useState } from "react";
import type { BorradorDeOdoo } from "@/lib/odoo/borradorDeOdoo";

/**
 * El borrador de Odoo, para revisarlo y confirmarlo sin salir del sistema.
 *
 * Muestra el asiento **como está en Odoo ahora**, no como el SdG lo mandó: si
 * alguien lo tocó del otro lado, eso es justamente lo que hay que ver antes de
 * postear.
 *
 * Confirmar postea, y **un asiento posteado es inmutable** —Odoo le da la
 * numeración del diario y deja de ser editable—. Por eso es la única acción de
 * este módulo reservada a administradores, y por eso el botón pide una segunda
 * confirmación en vez de actuar de una.
 *
 * Quien no puede confirmar igual ve el borrador entero: revisar no es escribir,
 * y esconderlo lo dejaría sin poder chequear lo que cargó.
 */

const plata = (n: number) =>
  n.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function BorradorEnOdoo({
  facturaId,
  puedeConfirmar,
  onCerrar,
  onConfirmado,
}: {
  facturaId: string;
  puedeConfirmar: boolean;
  onCerrar: () => void;
  onConfirmado: () => void;
}) {
  const [borrador, setBorrador] = useState<BorradorDeOdoo | null>(null);
  const [diferencia, setDiferencia] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [seguro, setSeguro] = useState(false);
  const [posteando, setPosteando] = useState(false);

  const traer = useCallback(async () => {
    setError(null);
    const r = await fetch(`/api/facturacion/facturas/${facturaId}/odoo/borrador`);
    const datos = await r.json().catch(() => ({}));
    if (!r.ok) {
      setError(datos.error ?? "No se pudo traer el borrador de Odoo.");
      return;
    }
    setBorrador(datos.borrador);
    setDiferencia(datos.diferencia ?? 0);
  }, [facturaId]);

  useEffect(() => {
    void traer();
  }, [traer]);

  async function confirmar() {
    setPosteando(true);
    setError(null);
    const r = await fetch(`/api/facturacion/facturas/${facturaId}/odoo/borrador`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ confirmar: true }),
    });
    const datos = await r.json().catch(() => ({}));
    setPosteando(false);
    setSeguro(false);

    if (!r.ok) {
      setError(datos.error ?? "No se pudo confirmar.");
      return;
    }
    onConfirmado();
  }

  return (
    <div className="mt-2 rounded-lg border border-teal-200 bg-teal-50/40 p-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-teal-800">
          El borrador en Odoo
          {borrador && (
            <span className="ml-2 font-normal text-slate-500">
              {borrador.nombre ?? borrador.numero ?? `#${borrador.odooMoveId}`} · {borrador.empresa}
            </span>
          )}
        </h4>
        <div className="flex items-center gap-2">
          {borrador?.enlace && (
            <a
              href={borrador.enlace}
              target="_blank"
              rel="noopener"
              className="text-xs text-teal-700 underline"
            >
              abrirlo en Odoo
            </a>
          )}
          <button onClick={onCerrar} className="text-xs text-slate-400 underline">
            cerrar
          </button>
        </div>
      </div>

      {error && <p className="mb-2 rounded bg-rose-50 px-2 py-1 text-xs text-rose-800">{error}</p>}

      {!borrador ? (
        <p className="text-xs text-slate-400">Preguntándole a Odoo…</p>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-[10px] uppercase tracking-wide text-slate-400">
                  <th className="py-1 pr-2">Concepto</th>
                  <th className="py-1 pr-2">Cuenta</th>
                  <th className="py-1 pr-2">Analítica</th>
                  <th className="py-1 pr-2 text-right">Cant.</th>
                  <th className="py-1 pr-2 text-right">Precio</th>
                  <th className="py-1 text-right">Subtotal</th>
                </tr>
              </thead>
              <tbody>
                {borrador.lineas.map((l, i) => (
                  <tr key={i} className="border-t border-teal-100 align-top">
                    <td className="py-1 pr-2 text-slate-800">{l.descripcion}</td>
                    <td className="py-1 pr-2 text-slate-500">{l.cuenta ?? "—"}</td>
                    <td className="py-1 pr-2 text-slate-500">{l.analitica ?? "—"}</td>
                    <td className="py-1 pr-2 text-right text-slate-600">{l.cantidad}</td>
                    <td className="py-1 pr-2 text-right text-slate-600">{plata(l.precioUnitario)}</td>
                    <td className="py-1 text-right text-slate-800">{plata(l.subtotal)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-2 flex flex-wrap items-center justify-between gap-2 border-t border-teal-200 pt-2 text-xs">
            <span className="text-slate-500">
              {borrador.adjuntos.length === 0 ? (
                // Que falte el PDF importa: quien revisa en Odoo no tendría el
                // comprobante a mano.
                <span className="text-amber-800">sin archivos adjuntos</span>
              ) : (
                `${borrador.adjuntos.length} adjunto${borrador.adjuntos.length > 1 ? "s" : ""}: ${borrador.adjuntos
                  .map((a) => a.nombre)
                  .join(", ")}`
              )}
            </span>
            <span className="text-slate-700">
              Neto {plata(borrador.neto)} · IVA {plata(borrador.impuestos)} ·{" "}
              <strong>Total {plata(borrador.total)}</strong>
            </span>
          </div>

          {/*
            * La diferencia contra el comprobante se muestra siempre que exista,
            * porque es lo que decide si se puede postear. Unos centavos son el
            * redondeo de cada línea; más que eso es otra cosa.
            */}
          {Math.abs(diferencia) > 0.001 && (
            <p
              className={`mt-1 rounded px-2 py-1 text-xs ${
                Math.abs(diferencia) <= 0.01 * Math.max(1, borrador.lineas.length)
                  ? "bg-slate-100 text-slate-600"
                  : "bg-amber-50 text-amber-900"
              }`}
            >
              El asiento difiere del comprobante en {plata(diferencia)}.
            </p>
          )}

          {borrador.estado === "posted" ? (
            <p className="mt-2 rounded bg-emerald-50 px-2 py-1 text-xs text-emerald-800">
              Ya está contabilizada en Odoo como {borrador.nombre}.
            </p>
          ) : !puedeConfirmar ? (
            <p className="mt-2 text-xs text-slate-500">
              Confirmarla en Odoo la postea, y eso no se deshace: lo hace alguien con nivel de
              administrador en Facturación.
            </p>
          ) : (
            (
              <div className="mt-2 flex flex-wrap items-center gap-2">
                {!seguro ? (
                  <button
                    onClick={() => setSeguro(true)}
                    className="rounded-lg bg-teal-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-teal-800"
                  >
                    Confirmar en Odoo
                  </button>
                ) : (
                  <>
                    <span className="text-xs text-slate-700">
                      Se postea por <strong>{plata(borrador.total)}</strong> y no se puede deshacer
                      desde acá. ¿Va?
                    </span>
                    <button
                      disabled={posteando}
                      onClick={confirmar}
                      className="rounded-lg bg-teal-700 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-40"
                    >
                      {posteando ? "Posteando…" : "Sí, confirmar"}
                    </button>
                    <button
                      onClick={() => setSeguro(false)}
                      className="text-xs text-slate-500 underline"
                    >
                      no
                    </button>
                  </>
                )}
              </div>
            )
          )}
        </>
      )}
    </div>
  );
}
