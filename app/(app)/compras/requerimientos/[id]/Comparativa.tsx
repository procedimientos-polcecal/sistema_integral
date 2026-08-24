"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { urlDePlanilla } from "@/lib/compras/vincular";
import type { Cotizacion, RequerimientoConRelaciones } from "@/lib/compras/types";
import SelectorComparativa from "./SelectorComparativa";
import PresupuestoForm from "./PresupuestoForm";
import ComparativaTabla from "./ComparativaTabla";
import ComparativaDecision from "./ComparativaDecision";

/**
 * La comparativa de un requerimiento.
 *
 * Compras adjunta la planilla de Drive, carga los presupuestos y designa a
 * quién le toca. La persona asignada aprueba la compra eligiendo uno: elegir es
 * el acto de aprobar, no un paso previo.
 *
 * Los mismos datos se muestran de dos maneras, porque son dos trabajos
 * distintos y el circuito ya los distingue:
 *
 *   - mientras Compras arma la comparativa, una fila por proveedor: compacta y
 *     con la acción de borrar a mano (ComparativaTabla).
 *   - cuando le toca decidir a la persona asignada, la comparación atributo por
 *     atributo (ComparativaDecision).
 *
 * Al aprobarse la compra la comparativa se congela: es el respaldo de por qué se
 * eligió ese precio.
 */
export default function Comparativa({
  requerimiento: r, cotizaciones, proveedores, puedeEditar, esAsignado,
}: {
  requerimiento: RequerimientoConRelaciones;
  cotizaciones: Cotizacion[];
  proveedores: { id: string; nombre: string }[];
  puedeEditar: boolean;
  esAsignado: boolean;
}) {
  const router = useRouter();
  const [selector, setSelector] = useState(false);
  const [cargando, setCargando] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [eligiendo, setEligiendo] = useState<string | null>(null);
  const [trayendo, setTrayendo] = useState(false);

  const congelada = ["APROBADO", "PEDIDO", "RECIBIDO"].includes(r.estado_compra);
  const puedeCargar = puedeEditar && !congelada && r.estado_aprobacion === "APROBADA";
  const puedeElegir = esAsignado && r.estado_compra === "PARA_COMPRAR";

  // Ordenadas por total. Es información, no una decisión: el plazo, la
  // disponibilidad y la marca también pesan.
  const ordenadas = [...cotizaciones].sort(
    (a, b) => (a.precio_total ?? Infinity) - (b.precio_total ?? Infinity)
  );
  const totales = ordenadas
    .map((c) => c.precio_total)
    .filter((t): t is number => t !== null);
  const minimo = totales.length > 0 ? Math.min(...totales) : null;

  function refrescar(mensaje: string | null) {
    setAviso(mensaje);
    setSelector(false);
    setCargando(false);
    router.refresh();
  }

  /**
   * Relee la planilla adjunta.
   *
   * Se borran los presupuestos que habían venido de Drive —sobre esos manda la
   * planilla— y quedan intactos los que se cargaron acá. Lo resuelve la misma
   * ruta que adjuntar: es idempotente a propósito.
   */
  async function volverATraer() {
    if (!r.comparativa_drive_id) return;
    setTrayendo(true);
    setError("");

    const res = await fetch(`/api/compras/requerimientos/${r.id}/comparativa`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ drive_id: r.comparativa_drive_id, nombre: r.comparativa_nombre }),
    });
    const body = await res.json().catch(() => ({}));
    setTrayendo(false);

    if (!res.ok) {
      setError(body.error ?? "No se pudo releer la planilla.");
      return;
    }
    refrescar(`Se releyó la planilla: ${body.traidas} presupuesto(s).`);
  }

  async function elegir(cotizacion: Cotizacion) {
    setEligiendo(cotizacion.id);
    setError("");
    const res = await fetch(`/api/compras/cotizaciones/${cotizacion.id}/elegir`, { method: "POST" });
    const body = await res.json().catch(() => ({}));
    setEligiendo(null);
    if (!res.ok) {
      setError(body.error ?? "No se pudo aprobar la compra.");
      return;
    }
    refrescar(body.aviso_drive ?? null);
  }

  async function borrar(cotizacion: Cotizacion) {
    if (!confirm(`¿Borrar el presupuesto de ${cotizacion.proveedores?.nombre ?? "ese proveedor"}?`)) {
      return;
    }
    const res = await fetch(`/api/compras/cotizaciones/${cotizacion.id}`, { method: "DELETE" });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(body.error ?? "No se pudo borrar.");
      return;
    }
    refrescar(body.aviso_drive ?? null);
  }

  return (
    <section className="rounded-xl border border-slate-200 bg-white">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-5 py-4">
        <div>
          <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Comparativa de proveedores
          </h2>
          {r.comparativa_nombre && (
            <p className="mt-0.5 text-sm text-slate-600">
              Planilla:{" "}
              {/* El link sale del id, no de comparativa_url: esa columna guarda
                  el texto visible de la celda de la planilla, que dice "LINK". */}
              {r.comparativa_drive_id ? (
                <a
                  href={urlDePlanilla(r.comparativa_drive_id)}
                  target="_blank"
                  rel="noreferrer"
                  className="underline"
                >
                  {r.comparativa_nombre}
                </a>
              ) : (
                r.comparativa_nombre
              )}
            </p>
          )}
        </div>

        {puedeCargar && (
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => setSelector(true)}
              className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
            >
              {r.comparativa_drive_id ? "Cambiar planilla" : "Elegir comparativa de Drive"}
            </button>
            {r.comparativa_drive_id && (
              <button
                onClick={volverATraer}
                disabled={trayendo}
                className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                {trayendo ? "Trayendo…" : "Volver a traer"}
              </button>
            )}
            {!cargando && (
              <button
                onClick={() => setCargando(true)}
                className="rounded-lg bg-[var(--primary)] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[var(--primary-dark)]"
              >
                Cargar presupuesto
              </button>
            )}
          </div>
        )}
      </div>

      <div className="space-y-3 p-5">
        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </div>
        )}
        {aviso && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
            {aviso}
          </div>
        )}

        {puedeElegir && ordenadas.length > 0 && (
          <p className="text-sm text-slate-600">
            Esta compra espera tu decisión. Elegir un presupuesto aprueba la compra.
          </p>
        )}

        {cargando && (
          <PresupuestoForm
            requerimientoId={r.id}
            proveedores={proveedores}
            cantidadSugerida={r.cantidad}
            onListo={(a) => refrescar(a)}
            onCancelar={() => setCargando(false)}
          />
        )}

        {ordenadas.length === 0 ? (
          <p className="text-sm text-slate-400">Todavía no hay presupuestos cargados.</p>
        ) : puedeElegir ? (
          <ComparativaDecision
            cotizaciones={ordenadas}
            minimo={minimo}
            onElegir={elegir}
            eligiendo={eligiendo}
          />
        ) : (
          <ComparativaTabla
            cotizaciones={ordenadas}
            minimo={minimo}
            puedeBorrar={puedeCargar}
            onBorrar={borrar}
          />
        )}

        {congelada && cotizaciones.length > 0 && (
          <p className="text-xs text-slate-400">
            La comparativa quedó congelada al aprobarse la compra.
          </p>
        )}
      </div>

      {selector && (
        <SelectorComparativa
          requerimientoId={r.id}
          onListo={(mensaje) => refrescar(mensaje)}
          onCerrar={() => setSelector(false)}
        />
      )}
    </section>
  );
}
