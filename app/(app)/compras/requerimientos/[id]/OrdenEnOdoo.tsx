"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * La orden de compra de este requerimiento en Odoo.
 *
 * Vive en su propio archivo y no dentro de `RequerimientoDetalle`, que ya tiene
 * 550 líneas. Es una sección con su propio estado —crear, ensayar, mostrar el
 * pendiente— y no comparte nada con el resto de la ficha.
 *
 * Por qué existe: si la orden está en Odoo, contabilidad genera la factura
 * **desde** la orden, con ítems, precios e impuestos ya puestos, en vez de
 * tipearla de cero. Eso es lo que hace lenta la carga de facturas hoy.
 *
 * La orden se crea **en borrador**. El SdG propone, Odoo confirma: nadie postea
 * un asiento desde acá.
 */

export interface OrdenDeOdoo {
  empresa: string;
  odooOrderId: number;
  odooNombre: string | null;
  porcentaje: number;
}

export default function OrdenEnOdoo({
  requerimientoId,
  ordenes,
  pendiente,
  puedeEditar,
}: {
  requerimientoId: string;
  ordenes: OrdenDeOdoo[];
  /** Por qué no se pudo crear la última vez. Null si no hay nada pendiente. */
  pendiente: string | null;
  puedeEditar: boolean;
}) {
  const router = useRouter();
  const [trabajando, setTrabajando] = useState(false);
  const [motivos, setMotivos] = useState<string[]>([]);
  const [ensayo, setEnsayo] = useState<unknown>(null);

  const yaEstan = ordenes.length > 0;

  async function crear() {
    setTrabajando(true);
    setMotivos([]);
    setEnsayo(null);

    const res = await fetch(`/api/compras/requerimientos/${requerimientoId}/odoo`, {
      method: "POST",
    });
    const body = await res.json().catch(() => ({}));
    setTrabajando(false);

    if (!res.ok) {
      // Los motivos vienen de la ruta y ya están escritos para leerse: dicen qué
      // hacer —"hay que dar de alta el proveedor en POLYSAN"— y no "error 422".
      setMotivos(body.motivos ?? [body.error ?? "No se pudo crear la orden en Odoo."]);
      // Igual se refresca: el pendiente quedó guardado en el requerimiento.
      router.refresh();
      return;
    }

    router.refresh();
  }

  async function ensayar() {
    setTrabajando(true);
    setMotivos([]);
    const res = await fetch(`/api/compras/requerimientos/${requerimientoId}/odoo`);
    setEnsayo(await res.json().catch(() => ({ error: "No se pudo leer el ensayo." })));
    setTrabajando(false);
  }

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5">
      <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
        Orden de compra en Odoo
      </h2>

      {yaEstan ? (
        <ul className="space-y-2">
          {ordenes.map((o) => (
            <li key={o.odooOrderId} className="flex items-baseline justify-between gap-2 text-sm">
              <span className="font-mono font-semibold text-slate-900">
                {o.odooNombre ?? `#${o.odooOrderId}`}
              </span>
              <span className="text-xs text-slate-500">
                {o.empresa}
                {o.porcentaje !== 100 && ` · ${o.porcentaje}%`}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-slate-500">
          Todavía no está en Odoo. Crearla deja que contabilidad genere la factura desde la
          orden en vez de cargarla de cero.
        </p>
      )}

      {pendiente && (
        <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          <strong className="block">Quedó pendiente:</strong>
          {pendiente}
        </div>
      )}

      {motivos.length > 0 && (
        <div className="mt-3 space-y-1 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          {motivos.map((m) => (
            <p key={m}>{m}</p>
          ))}
        </div>
      )}

      {puedeEditar && (
        <div className="mt-4 flex flex-wrap gap-2">
          <button
            onClick={crear}
            disabled={trabajando}
            className="rounded-lg bg-[var(--primary)] px-4 py-2 text-sm font-semibold text-white hover:bg-[var(--primary-dark)] disabled:opacity-50"
          >
            {trabajando ? "Trabajando…" : yaEstan ? "Reintentar lo que falte" : "Crear la orden en Odoo"}
          </button>

          {/*
            El ensayo muestra exactamente lo que se le mandaría a Odoo, sin
            mandarlo. Está a la vista y no escondido en un menú: esto escribe en
            la contabilidad del grupo, y mirar antes es más barato que corregir
            una orden mal creada.
          */}
          <button
            onClick={ensayar}
            disabled={trabajando}
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            Ver qué se mandaría
          </button>
        </div>
      )}

      {ensayo !== null && (
        <pre className="mt-3 max-h-72 overflow-auto rounded-lg bg-slate-900 p-3 text-[11px] leading-relaxed text-slate-100">
          {JSON.stringify(ensayo, null, 2)}
        </pre>
      )}
    </section>
  );
}
