"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  describirDistribucion,
  repartirEnPartesIguales,
  revisarDistribucion,
  type DistribucionAnalitica,
  type LineaDeFactura,
} from "@/lib/facturacion/lineas";

/**
 * El detalle de una factura: qué productos trae y cómo se imputa cada uno.
 *
 * Tres cosas que están separadas a propósito, porque tienen dueños distintos:
 *
 * - **Lo que dice el papel** (descripción, cantidad, precio) se muestra y no se
 *   edita. Si está mal leído, la factura se vuelve a cargar; corregirlo acá
 *   dejaría un detalle que ya no es el comprobante.
 * - **El producto de Odoo** lo propone el sistema y lo corrige una persona. La
 *   corrección se aprende: la próxima factura con esa descripción ya sale bien,
 *   y también las órdenes de compra, que usan la misma tabla.
 * - **La cuenta y la distribución analítica** las pone una persona siempre. El
 *   comprobante no dice a qué equipo fue un repuesto, y adivinarlo sería poner
 *   el gasto en el lugar equivocado sin que nadie se entere.
 */

interface Catalogos {
  productos: { id: number; nombre: string }[];
  cuentas: { id: number; codigo: string; nombre: string }[];
  analiticas: { id: number; nombre: string; plan: string | null }[];
}

export default function LineasDeFactura({
  facturaId,
  puedeEditar,
  onCerrar,
}: {
  facturaId: string;
  puedeEditar: boolean;
  onCerrar: () => void;
}) {
  const [lineas, setLineas] = useState<LineaDeFactura[] | null>(null);
  const [catalogos, setCatalogos] = useState<Catalogos | null>(null);
  const [detalleLeido, setDetalleLeido] = useState<string | null>(null);
  const [motivo, setMotivo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const traer = useCallback(async () => {
    const r = await fetch(`/api/facturacion/facturas/${facturaId}/lineas`);
    const datos = await r.json().catch(() => ({}));
    if (!r.ok) {
      setError(datos.error ?? "No se pudo traer el detalle.");
      return;
    }
    setLineas(datos.lineas ?? []);
    setCatalogos(datos.catalogos ?? null);
    setDetalleLeido(datos.detalleLeido ?? null);
    setMotivo(datos.motivo ?? null);
  }, [facturaId]);

  useEffect(() => {
    void traer();
  }, [traer]);

  const nombresAnaliticos = useMemo(
    () => new Map((catalogos?.analiticas ?? []).map((a) => [a.id, a.nombre])),
    [catalogos]
  );

  const suma = (lineas ?? []).reduce((a, l) => a + Number(l.total ?? 0), 0);

  return (
    <div className="mt-2 rounded-lg border border-slate-200 bg-slate-50 p-3">
      <div className="mb-2 flex items-center justify-between">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          El detalle del comprobante
          {lineas && <span className="ml-2 font-normal text-slate-400">{lineas.length} líneas</span>}
        </h4>
        <button onClick={onCerrar} className="text-xs text-slate-400 underline">
          cerrar
        </button>
      </div>

      {/*
        * Que el detalle no cuadre no se esconde: es la razón por la que el
        * borrador de Odoo va a salir con una línea sola, y sin decirlo la
        * pregunta "¿por qué ésta sí y aquélla no?" no tiene respuesta.
        */}
      {detalleLeido === "no cuadra" && (
        <p className="mb-2 rounded bg-amber-50 px-2 py-1 text-xs text-amber-900">
          Las líneas que se leyeron no suman el neto del comprobante, así que el borrador de Odoo va
          a ir con una sola línea por el total.
        </p>
      )}
      {detalleLeido === "sin detalle" && (
        <p className="mb-2 text-xs text-slate-500">
          De este comprobante no se pudo leer el detalle: el borrador va con una línea por el total.
        </p>
      )}
      {motivo && <p className="mb-2 text-xs text-slate-500">{motivo}</p>}
      {error && <p className="mb-2 rounded bg-rose-50 px-2 py-1 text-xs text-rose-800">{error}</p>}

      {lineas === null ? (
        <p className="text-xs text-slate-400">Trayendo el detalle…</p>
      ) : lineas.length === 0 ? (
        <p className="text-xs text-slate-400">Esta factura no tiene detalle cargado.</p>
      ) : (
        <>
          <ul className="space-y-2">
            {lineas.map((linea) => (
              <Linea
                key={linea.id}
                linea={linea}
                catalogos={catalogos}
                nombresAnaliticos={nombresAnaliticos}
                puedeEditar={puedeEditar}
                onGuardada={(nueva) =>
                  setLineas((antes) =>
                    (antes ?? []).map((l) => (l.id === nueva.id ? nueva : l))
                  )
                }
              />
            ))}
          </ul>
          <p className="mt-2 text-right text-xs text-slate-500">
            Suman {suma.toLocaleString("es-AR", { minimumFractionDigits: 2 })}
          </p>
        </>
      )}
    </div>
  );
}

function Linea({
  linea,
  catalogos,
  nombresAnaliticos,
  puedeEditar,
  onGuardada,
}: {
  linea: LineaDeFactura;
  catalogos: Catalogos | null;
  nombresAnaliticos: Map<number, string>;
  puedeEditar: boolean;
  onGuardada: (linea: LineaDeFactura) => void;
}) {
  const [analitica, setAnalitica] = useState<DistribucionAnalitica>(linea.analitica ?? {});
  const [guardando, setGuardando] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);

  async function guardar(cambios: Record<string, unknown>) {
    setGuardando(true);
    setAviso(null);
    const r = await fetch(`/api/facturacion/facturas/${linea.factura_id}/lineas`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ linea_id: linea.id, ...cambios }),
    });
    const datos = await r.json().catch(() => ({}));
    setGuardando(false);
    if (!r.ok) {
      setAviso(datos.error ?? "No se pudo guardar.");
      return;
    }
    onGuardada(datos.linea);
  }

  function cambiarProducto(id: string) {
    const producto = catalogos?.productos.find((p) => String(p.id) === id);
    void guardar({
      odoo_product_id: producto?.id ?? null,
      odoo_product_nombre: producto?.nombre ?? null,
    });
  }

  function cambiarCuenta(id: string) {
    const cuenta = catalogos?.cuentas.find((c) => String(c.id) === id);
    void guardar({
      odoo_account_id: cuenta?.id ?? null,
      odoo_account_nombre: cuenta ? `${cuenta.codigo} ${cuenta.nombre}` : null,
    });
  }

  function agregarAnalitica(id: string) {
    if (!id) return;
    const ids = [...Object.keys(analitica).map(Number), Number(id)];
    setAnalitica(repartirEnPartesIguales([...new Set(ids)]));
  }

  function sacarAnalitica(id: string) {
    const ids = Object.keys(analitica).map(Number).filter((n) => n !== Number(id));
    setAnalitica(repartirEnPartesIguales(ids));
  }

  function guardarAnalitica() {
    const problema = revisarDistribucion(analitica);
    if (problema) {
      setAviso(problema);
      return;
    }
    void guardar({
      analitica,
      analitica_nombres: Object.fromEntries(
        Object.keys(analitica).map((id) => [id, nombresAnaliticos.get(Number(id)) ?? `#${id}`])
      ),
    });
  }

  const sinGuardar =
    JSON.stringify(analitica) !== JSON.stringify(linea.analitica ?? {});

  return (
    <li className="rounded-lg border border-slate-200 bg-white p-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-sm font-medium text-slate-800">{linea.descripcion}</span>
        <span className="text-xs text-slate-500">
          {linea.cantidad} × {Number(linea.precio_unitario ?? 0).toLocaleString("es-AR")} ={" "}
          <strong>{Number(linea.total ?? 0).toLocaleString("es-AR")}</strong>
        </span>
      </div>

      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        <label className="block">
          <span className="block text-[10px] uppercase tracking-wide text-slate-400">
            Producto
            {/* De dónde salió: lo propuso una regla, lo aprendió de una
                corrección anterior, o lo eligió una persona. */}
            {linea.producto_origen && (
              <span className="ml-1 normal-case text-slate-400">· {linea.producto_origen}</span>
            )}
          </span>
          <select
            value={linea.odoo_product_id ?? ""}
            disabled={!puedeEditar || guardando || !catalogos}
            onChange={(e) => cambiarProducto(e.target.value)}
            className="mt-0.5 w-full rounded border border-slate-300 px-2 py-1 text-xs disabled:bg-slate-50"
          >
            <option value="">— sin producto —</option>
            {catalogos?.productos.map((p) => (
              <option key={p.id} value={p.id}>
                {p.nombre}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="block text-[10px] uppercase tracking-wide text-slate-400">Cuenta</span>
          <select
            value={linea.odoo_account_id ?? ""}
            disabled={!puedeEditar || guardando || !catalogos}
            onChange={(e) => cambiarCuenta(e.target.value)}
            className="mt-0.5 w-full rounded border border-slate-300 px-2 py-1 text-xs disabled:bg-slate-50"
          >
            <option value="">— la que ponga Odoo —</option>
            {catalogos?.cuentas.map((c) => (
              <option key={c.id} value={c.id}>
                {c.codigo} {c.nombre}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="mt-2">
        <span className="block text-[10px] uppercase tracking-wide text-slate-400">
          Distribución analítica
        </span>

        {Object.keys(analitica).length > 0 && (
          <ul className="mt-1 flex flex-wrap gap-1">
            {Object.entries(analitica)
              .sort((a, b) => b[1] - a[1])
              .map(([id, pct]) => (
                <li
                  key={id}
                  className="flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-700"
                >
                  <span>{nombresAnaliticos.get(Number(id)) ?? `#${id}`}</span>
                  <input
                    type="number"
                    value={pct}
                    step="0.01"
                    disabled={!puedeEditar}
                    onChange={(e) =>
                      setAnalitica((antes) => ({ ...antes, [id]: Number(e.target.value) }))
                    }
                    className="w-16 rounded border border-slate-300 px-1 text-right"
                  />
                  <span>%</span>
                  {puedeEditar && (
                    <button
                      onClick={() => sacarAnalitica(id)}
                      className="text-slate-400 hover:text-rose-600"
                      aria-label="sacar"
                    >
                      ×
                    </button>
                  )}
                </li>
              ))}
          </ul>
        )}

        {puedeEditar && (
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <select
              value=""
              disabled={guardando || !catalogos}
              onChange={(e) => agregarAnalitica(e.target.value)}
              className="rounded border border-slate-300 px-2 py-1 text-xs disabled:bg-slate-50"
            >
              <option value="">+ agregar una cuenta analítica…</option>
              {/* Agrupadas por plan: son ~360 por empresa y sin el plano
                  —EQUIPOS MÓVILES, MANTENIMIENTO— no se encuentra ninguna. */}
              {Object.entries(
                (catalogos?.analiticas ?? []).reduce<Record<string, Catalogos["analiticas"]>>(
                  (grupos, a) => {
                    const plan = a.plan ?? "Sin plan";
                    (grupos[plan] ??= []).push(a);
                    return grupos;
                  },
                  {}
                )
              ).map(([plan, cuentas]) => (
                <optgroup key={plan} label={plan}>
                  {cuentas.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.nombre}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>

            {sinGuardar && (
              <button
                disabled={guardando}
                onClick={guardarAnalitica}
                className="rounded-lg bg-slate-900 px-2 py-1 text-xs text-white disabled:opacity-40"
              >
                Guardar la distribución
              </button>
            )}
          </div>
        )}

        {!Object.keys(analitica).length && linea.analitica_detalle && (
          <p className="text-xs text-slate-500">{linea.analitica_detalle}</p>
        )}
      </div>

      {aviso && <p className="mt-1 rounded bg-rose-50 px-2 py-1 text-xs text-rose-800">{aviso}</p>}
    </li>
  );
}

/** Re-exportado para que la fila del buzón muestre el resumen sin recalcularlo. */
export { describirDistribucion };
