"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { ProductoDeOdoo } from "@/lib/calidad/types";

/**
 * La lista blanca de productos de Odoo.
 *
 * **El id va al lado del nombre en todas las filas, y no es adorno**: en esta
 * base conviven `CARBONILLA` (6909) y `CARBONILLA ` (4419) —con un espacio al
 * final—, los dos buenos, con 947 líneas entre ambos. Elegir el que no es no
 * rompe nada y ensucia el stock para siempre.
 *
 * `cuenta = false` no es lo mismo que no estar: es *"ya lo miré, es flete, no me
 * lo muestres más en la bandeja"*.
 */
export default function ProductosClient({
  productos,
  sinResolver,
}: {
  productos: ProductoDeOdoo[];
  sinResolver: { odoo_product_id: number; odoo_product_nombre: string }[];
}) {
  const router = useRouter();
  const [guardando, setGuardando] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function resolver(p: { odoo_product_id: number; odoo_product_nombre: string }, cuenta: boolean) {
    setGuardando(p.odoo_product_id);
    setError(null);
    const res = await fetch("/api/calidad/productos", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...p, cuenta }),
    });
    const body = await res.json().catch(() => ({}));
    setGuardando(null);
    if (!res.ok) {
      setError(body.error ?? "No se pudo guardar.");
      return;
    }
    router.refresh();
  }

  const cuentan = productos.filter((p) => p.cuenta);
  const noCuentan = productos.filter((p) => !p.cuenta);

  return (
    <div className="mx-auto max-w-4xl space-y-4 md:p-6">
      <div>
        <h1 className="text-xl font-bold text-slate-900">Productos de Odoo</h1>
        <p className="text-sm text-slate-500">
          Qué cuenta como carbonilla. {cuentan.length} cuentan · {noCuentan.length} no.
        </p>
      </div>

      {error && (
        <p className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}

      {sinResolver.length > 0 && (
        <section className="rounded-lg border border-amber-300 bg-amber-50 p-4">
          <h2 className="text-sm font-bold text-amber-900">Sin resolver</h2>
          <p className="mt-0.5 text-xs text-amber-800">
            Aparecieron en una orden de un carbonillero y no están en la lista, así que no entraron
            al stock.
          </p>
          <ul className="mt-2 space-y-2">
            {sinResolver.map((p) => (
              <li key={p.odoo_product_id} className="flex flex-wrap items-center gap-2 text-sm">
                <span className="text-amber-900">
                  {JSON.stringify(p.odoo_product_nombre)}{" "}
                  <span className="font-mono text-xs">({p.odoo_product_id})</span>
                </span>
                <button
                  onClick={() => resolver(p, true)}
                  disabled={guardando === p.odoo_product_id}
                  className="rounded bg-slate-900 px-2 py-1 text-xs text-white disabled:opacity-50"
                >
                  Cuenta como carbonilla
                </button>
                <button
                  onClick={() => resolver(p, false)}
                  disabled={guardando === p.odoo_product_id}
                  className="rounded border border-slate-300 px-2 py-1 text-xs text-slate-700 disabled:opacity-50"
                >
                  No cuenta
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <Lista titulo="Cuentan como carbonilla" productos={cuentan} alOtroLado={resolver} cuenta={false} guardando={guardando} />
      <Lista titulo="No cuentan" productos={noCuentan} alOtroLado={resolver} cuenta guardando={guardando} />

      <p className="text-xs text-slate-500">
        El nombre se muestra entre comillas a propósito: <code>{'"CARBONILLA "'}</code> y{" "}
        <code>{'"CARBONILLA"'}</code> son dos productos distintos, y la diferencia es un espacio al
        final.
      </p>
    </div>
  );
}

function Lista({
  titulo,
  productos,
  alOtroLado,
  cuenta,
  guardando,
}: {
  titulo: string;
  productos: ProductoDeOdoo[];
  alOtroLado: (
    p: { odoo_product_id: number; odoo_product_nombre: string },
    cuenta: boolean
  ) => Promise<void>;
  cuenta: boolean;
  guardando: number | null;
}) {
  if (productos.length === 0) return null;

  return (
    <section>
      <h2 className="text-sm font-bold text-slate-900">{titulo}</h2>
      <div className="mt-2 overflow-x-auto rounded-lg border border-slate-200">
        <table className="w-full text-sm">
          <tbody className="divide-y divide-slate-100">
            {productos.map((p) => (
              <tr key={p.odoo_product_id}>
                <td className="px-3 py-1.5 font-mono text-xs text-slate-500">
                  {p.odoo_product_id}
                </td>
                <td className="px-3 py-1.5 text-slate-900">
                  {JSON.stringify(p.odoo_product_nombre)}
                </td>
                <td className="px-3 py-1.5 text-right">
                  <button
                    onClick={() =>
                      alOtroLado(
                        {
                          odoo_product_id: p.odoo_product_id,
                          odoo_product_nombre: p.odoo_product_nombre,
                        },
                        cuenta
                      )
                    }
                    disabled={guardando === p.odoo_product_id}
                    className="text-xs text-slate-600 underline disabled:opacity-50"
                  >
                    {cuenta ? "Pasarlo a que cuenta" : "Pasarlo a que no cuenta"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
