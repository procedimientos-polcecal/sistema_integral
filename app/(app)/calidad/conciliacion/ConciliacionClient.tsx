"use client";

import Link from "next/link";

/**
 * Las tres listas del control contra Odoo.
 *
 * **La primera va arriba y en rojo, y no es decoración.** Un camión sin orden
 * de compra es carbonilla que entró y que no se le puede facturar a nadie; las
 * otras dos son diferencias para mirar. Ordenarlas por gravedad es la pantalla
 * entera: las tres juntas y en gris se leen como una sola lista larga que nadie
 * termina.
 *
 * Spec: docs/superpowers/specs/2026-10-13-calidad-la-planilla-manda-design.md
 */

export interface CamionSinOrden {
  id: string;
  fecha: string;
  quien: string;
  toneladas: number;
}

export interface OrdenSinCamion {
  ordenNombre: string;
  fecha: string;
  quien: string;
  cantidad: number;
}

export interface Distinta {
  camionId: string;
  fecha: string;
  ordenNombre: string;
  enElLibro: number;
  enOdoo: number;
}

interface Props {
  leidas?: number;
  sinOrden?: CamionSinOrden[];
  sinCamion?: OrdenSinCamion[];
  cantidadDistinta?: Distinta[];
  /** Lo que dijo Odoo, sin traducir. Si está, no se muestra ninguna lista. */
  error?: string;
}

/** Con coma, que es como se lee acá. */
function t(n: number): string {
  return n.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function comoSeLee(iso: string): string {
  const [a, m, d] = iso.split("-");
  return `${d}/${m}/${a.slice(2)}`;
}

export default function ConciliacionClient({
  leidas = 0,
  sinOrden = [],
  sinCamion = [],
  cantidadDistinta = [],
  error,
}: Props) {
  const total = sinOrden.length + sinCamion.length + cantidadDistinta.length;

  return (
    <div className="mx-auto max-w-5xl space-y-4 md:p-6">
      <div>
        <h1 className="text-xl font-bold text-slate-900">Conciliación con Odoo</h1>
        <p className="text-sm text-slate-500">
          Los camiones del libro contra las órdenes de compra de los últimos 30 días. El libro sale
          de{" "}
          <Link href="/calidad/carbonilla" className="underline">
            la planilla
          </Link>
          ; Odoo acá no mueve el stock, sólo controla.
        </p>
      </div>

      {error ? (
        // Tres listas vacías se verían igual que "está todo bien". No es lo
        // mismo no tener desvíos que no haber podido mirar.
        <section className="rounded-lg border border-red-300 bg-red-50 p-4">
          <h2 className="text-sm font-bold text-red-900">No se pudo consultar Odoo</h2>
          <p className="mt-1 text-sm text-red-800">
            Esta pantalla no sabe si hay desvíos o no. Lo que contestó Odoo, sin traducir:
          </p>
          <p className="mt-2 rounded border border-red-200 bg-white px-3 py-2 font-mono text-xs text-red-900">
            {error}
          </p>
        </section>
      ) : (
        <>
          <p className="text-sm text-slate-500">
            {leidas} {leidas === 1 ? "línea leída" : "líneas leídas"} de Odoo ·{" "}
            {total === 0 ? (
              <span className="font-semibold text-emerald-700">sin desvíos</span>
            ) : (
              <span className="font-semibold text-slate-700">
                {total} {total === 1 ? "desvío" : "desvíos"}
              </span>
            )}
          </p>

          {/* 1. Lo que cuesta plata, arriba */}
          <section className="rounded-lg border border-red-300 bg-red-50 p-4">
            <h2 className="text-sm font-bold text-red-900">
              {sinOrden.length === 0
                ? "Ningún camión sin orden de compra"
                : `${sinOrden.length} ${
                    sinOrden.length === 1
                      ? "camión sin orden de compra"
                      : "camiones sin orden de compra"
                  }`}
            </h2>
            <p className="mt-0.5 text-xs text-red-800">
              Entraron al stock y no tienen orden en Odoo. <strong>No se les puede facturar.</strong>
            </p>
            {sinOrden.length > 0 && (
              <div className="mt-2 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-left text-xs uppercase tracking-wide text-red-700">
                    <tr>
                      <th className="py-1 pr-3">Fecha</th>
                      <th className="py-1 pr-3">Carbonillero</th>
                      <th className="py-1 text-right">Toneladas</th>
                    </tr>
                  </thead>
                  <tbody className="text-red-900">
                    {sinOrden.map((c) => (
                      <tr key={c.id} className="border-t border-red-200">
                        <td className="py-1.5 pr-3 whitespace-nowrap">{comoSeLee(c.fecha)}</td>
                        <td className="py-1.5 pr-3">{c.quien}</td>
                        <td className="py-1.5 text-right tabular-nums">{t(c.toneladas)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {/* 2. Al revés: Odoo tiene la orden y el libro no tiene el camión */}
          <section className="card p-4">
            <h2 className="text-sm font-bold text-slate-900">
              {sinCamion.length === 0
                ? "Ninguna orden sin camión en el libro"
                : `${sinCamion.length} ${
                    sinCamion.length === 1
                      ? "orden de Odoo sin camión en el libro"
                      : "órdenes de Odoo sin camión en el libro"
                  }`}
            </h2>
            <p className="mt-0.5 text-xs text-slate-500">
              La orden está cargada pero el camión no figura en la planilla.
            </p>
            {sinCamion.length > 0 && (
              <div className="mt-2 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-left text-xs uppercase tracking-wide text-slate-500">
                    <tr>
                      <th className="py-1 pr-3">Fecha</th>
                      <th className="py-1 pr-3">Orden</th>
                      <th className="py-1 pr-3">Proveedor</th>
                      <th className="py-1 text-right">Toneladas</th>
                    </tr>
                  </thead>
                  <tbody className="text-slate-700">
                    {sinCamion.map((o) => (
                      <tr key={o.ordenNombre} className="border-t border-slate-200">
                        <td className="py-1.5 pr-3 whitespace-nowrap">{comoSeLee(o.fecha)}</td>
                        <td className="py-1.5 pr-3 font-mono text-xs">{o.ordenNombre}</td>
                        <td className="py-1.5 pr-3">{o.quien}</td>
                        <td className="py-1.5 text-right tabular-nums">{t(o.cantidad)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {/* 3. Las dos están, y no dicen lo mismo */}
          <section className="card p-4">
            <h2 className="text-sm font-bold text-slate-900">
              {cantidadDistinta.length === 0
                ? "Ninguna cantidad distinta"
                : `${cantidadDistinta.length} ${
                    cantidadDistinta.length === 1
                      ? "camión con otra cantidad en Odoo"
                      : "camiones con otra cantidad en Odoo"
                  }`}
            </h2>
            <p className="mt-0.5 text-xs text-slate-500">
              El camión y su orden están los dos; lo que no coincide es el peso.
            </p>
            {cantidadDistinta.length > 0 && (
              <div className="mt-2 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-left text-xs uppercase tracking-wide text-slate-500">
                    <tr>
                      <th className="py-1 pr-3">Fecha</th>
                      <th className="py-1 pr-3">Orden</th>
                      <th className="py-1 pr-3 text-right">En la planilla</th>
                      <th className="py-1 pr-3 text-right">En Odoo</th>
                      <th className="py-1 text-right">Diferencia</th>
                    </tr>
                  </thead>
                  <tbody className="text-slate-700">
                    {cantidadDistinta.map((d) => (
                      <tr key={d.camionId} className="border-t border-slate-200">
                        <td className="py-1.5 pr-3 whitespace-nowrap">{comoSeLee(d.fecha)}</td>
                        <td className="py-1.5 pr-3 font-mono text-xs">{d.ordenNombre}</td>
                        <td className="py-1.5 pr-3 text-right tabular-nums">{t(d.enElLibro)}</td>
                        <td className="py-1.5 pr-3 text-right tabular-nums">{t(d.enOdoo)}</td>
                        <td className="py-1.5 text-right font-semibold tabular-nums">
                          {d.enElLibro > d.enOdoo ? "+" : ""}
                          {t(d.enElLibro - d.enOdoo)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
