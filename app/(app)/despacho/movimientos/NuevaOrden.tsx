"use client";

import { useState } from "react";
import type { RemitoDeOdoo } from "@/lib/despacho/types";

/**
 * Dar de alta una orden de carga, con el camión en la puerta.
 *
 * EL ORDEN DE LOS CAMPOS ES EL DEL PAPEL: primero el Nº del talonario, porque
 * es lo que el encargado tiene en la mano.
 *
 * Después elige el remito de la lista que trajo Odoo, y con eso vienen cliente,
 * producto, toneladas y empresa sin tipear nada. Los remitos que ya tienen orden
 * se muestran tachados en vez de sacarse de la lista: que un remito no aparezca
 * puede ser porque ya se cargó o porque Odoo no lo devolvió, y son dos problemas
 * distintos.
 *
 * **La lista es una ventana de días, no el día**, y trae ~84 remitos: 131 de
 * 1.383 tienen `scheduled_date` de un día distinto al de su creación, así que
 * filtrar por hoy le escondería al encargado uno de cada diez. Con esa cantidad
 * hace falta el buscador, y **filtra en memoria**: Odoo tarda y el camión está
 * esperando.
 *
 * **El camino "sin remito" es explícito y no un accidente.** Polysan deja
 * remitos en `draft` y `confirmed` —39 en 90 días— y el camión llega igual.
 * Cuando se toma ese camino, cliente y producto se escriben a mano, la orden
 * queda marcada como sin enlace y se ve en la cola. Lo que no se hace nunca es
 * ofrecer el remito "que se le parece": un enlace equivocado no se nota.
 */

type RemitoElegible = RemitoDeOdoo & { yaTieneOrden: boolean };

const ESTADO_LEGIBLE: Record<string, string> = {
  draft: "borrador",
  waiting: "en espera",
  confirmed: "sin validar",
  assigned: "listo",
  done: "validado",
};

export default function NuevaOrden({
  fecha,
  remitos,
  trayendo,
  error,
  empresas,
  onRefrescar,
  onCerrar,
  onCreada,
}: {
  fecha: string;
  remitos: RemitoElegible[] | null;
  trayendo: boolean;
  error: string;
  empresas: { id: string; nombre: string }[];
  onRefrescar: () => void;
  onCerrar: () => void;
  onCreada: (avisoDePlanilla: string) => void;
}) {
  const [numero, setNumero] = useState("");
  const [buscar, setBuscar] = useState("");
  const [pickingId, setPickingId] = useState<number | null>(null);
  const [sinRemito, setSinRemito] = useState(false);
  const [cliente, setCliente] = useState("");
  const [producto, setProducto] = useState("");
  const [empresaId, setEmpresaId] = useState("");
  const [marcarEntrada, setMarcarEntrada] = useState(true);
  const [guardando, setGuardando] = useState(false);
  const [errorAlta, setErrorAlta] = useState("");

  const elegido = remitos?.find((r) => r.picking_id === pickingId) ?? null;

  // El encargado tiene el remito en la mano, así que busca por su número; el
  // cliente y el material están para cuando el papel se lee mal.
  const q = buscar.trim().toLowerCase();
  const visibles = (remitos ?? []).filter(
    (r) =>
      q === "" ||
      r.nombre.toLowerCase().includes(q) ||
      r.cliente.toLowerCase().includes(q) ||
      (r.producto ?? "").toLowerCase().includes(q) ||
      (r.pedido ?? "").toLowerCase().includes(q)
  );

  async function guardar() {
    setErrorAlta("");

    if (!numero.trim()) {
      setErrorAlta("Falta el Nº de la orden (el del talonario).");
      return;
    }
    if (!sinRemito && !elegido) {
      setErrorAlta("Elegí el remito, o marcá que esta orden va sin remito.");
      return;
    }
    if (sinRemito && !empresaId) {
      setErrorAlta("Sin remito hay que decir de qué empresa es la orden.");
      return;
    }

    setGuardando(true);
    const res = await fetch("/api/despacho/ordenes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        numero: numero.trim(),
        fecha,
        marcar_entrada: marcarEntrada,
        ...(elegido && !sinRemito
          ? {
              odoo_picking_id: elegido.picking_id,
              odoo_picking_name: elegido.nombre,
              odoo_sale_name: elegido.pedido,
              odoo_product_id: elegido.odoo_product_id,
              odoo_company_id: elegido.odoo_company_id,
              cliente_raw: elegido.cliente,
              producto_raw: elegido.producto,
              cantidad: elegido.cantidad,
              unidad: elegido.unidad,
            }
          : {
              empresa_id: empresaId,
              cliente_raw: cliente.trim(),
              producto_raw: producto.trim(),
            }),
      }),
    });

    const json = await res.json().catch(() => ({}));
    setGuardando(false);

    if (!res.ok) {
      setErrorAlta(json.error ?? "No se pudo cargar la orden.");
      return;
    }
    onCreada(json.planilla_error ?? "");
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <h2 className="font-semibold text-slate-900">Nueva orden de carga</h2>
        <button onClick={onCerrar} className="text-sm text-slate-500 hover:text-slate-700">
          Cancelar
        </button>
      </div>

      {errorAlta && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {errorAlta}
        </div>
      )}

      <div>
        <label className="block text-sm font-medium text-slate-700">
          Nº de la orden (talonario)
        </label>
        <input
          autoFocus
          value={numero}
          onChange={(e) => setNumero(e.target.value)}
          placeholder="13801"
          inputMode="numeric"
          className="mt-1 w-40 rounded-lg border border-slate-300 px-3 py-2 text-lg font-medium"
        />
        <p className="mt-1 text-xs text-slate-400">
          El número preimpreso, arriba a la derecha del papel.
        </p>
      </div>

      <div className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <label className="block text-sm font-medium text-slate-700">
            Remito de Odoo
            {remitos !== null && (
              <span className="ml-2 font-normal text-slate-400">
                {remitos.length} de los últimos días
              </span>
            )}
          </label>
          <button
            onClick={onRefrescar}
            disabled={trayendo}
            className="rounded-lg border border-slate-300 px-3 py-1 text-xs text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            {trayendo ? "Trayendo de Odoo…" : "Refrescar"}
          </button>
        </div>

        {error && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
            {error}
          </div>
        )}

        {trayendo && remitos === null && (
          <p className="text-sm text-slate-400">Odoo tarda unos segundos…</p>
        )}

        {remitos !== null && remitos.length === 0 && !trayendo && (
          <p className="text-sm text-slate-400">
            Odoo no devolvió remitos de salida para estos días.
          </p>
        )}

        {remitos !== null && remitos.length > 0 && (
          <input
            value={buscar}
            onChange={(e) => setBuscar(e.target.value)}
            placeholder="Buscar por Nº de remito, cliente o material"
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
        )}

        {remitos !== null && remitos.length > 0 && (
          <div className="max-h-64 divide-y divide-slate-100 overflow-y-auto rounded-lg border border-slate-200">
            {visibles.length === 0 && (
              <p className="px-3 py-4 text-sm text-slate-400">
                Ninguno de los {remitos.length} remitos coincide con “{buscar}”.
              </p>
            )}
            {visibles.map((r) => (
              <label
                key={r.picking_id}
                className={`flex cursor-pointer items-start gap-3 px-3 py-2 text-sm hover:bg-slate-50 ${
                  r.yaTieneOrden ? "opacity-50" : ""
                } ${sinRemito ? "pointer-events-none opacity-40" : ""}`}
              >
                <input
                  type="radio"
                  name="remito"
                  className="mt-1"
                  checked={pickingId === r.picking_id}
                  disabled={r.yaTieneOrden || sinRemito}
                  onChange={() => setPickingId(r.picking_id)}
                />
                <span className="min-w-0">
                  <span className="font-medium text-slate-900">{r.nombre}</span>
                  <span className="ml-2 text-xs text-slate-400">
                    {ESTADO_LEGIBLE[r.estado] ?? r.estado}
                    {r.pedido && ` · ${r.pedido}`}
                    {r.yaTieneOrden && " · ya tiene orden"}
                  </span>
                  <span className="block truncate text-slate-600">{r.cliente}</span>
                  <span className="block truncate text-xs text-slate-500">
                    {r.producto ?? "sin producto"}
                    {r.cantidad !== null && ` · ${r.cantidad} ${r.unidad ?? ""}`}
                  </span>
                </span>
              </label>
            ))}
          </div>
        )}

        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={sinRemito}
            onChange={(e) => setSinRemito(e.target.checked)}
          />
          Esta orden va <strong>sin remito</strong> (todavía no está en Odoo)
        </label>
      </div>

      {sinRemito && (
        <div className="grid gap-3 rounded-lg border border-amber-200 bg-amber-50 p-3 sm:grid-cols-3">
          <div className="sm:col-span-3 text-xs text-amber-800">
            Queda registrada sin enlace al remito, y se ve así en la cola. Cuando
            el remito exista, se puede enlazar corrigiendo la orden.
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700">Empresa</label>
            <select
              value={empresaId}
              onChange={(e) => setEmpresaId(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            >
              <option value="">Elegir…</option>
              {empresas.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.nombre}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700">Cliente</label>
            <input
              value={cliente}
              onChange={(e) => setCliente(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700">Material</label>
            <input
              value={producto}
              onChange={(e) => setProducto(e.target.value)}
              placeholder="Cal a granel"
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            />
          </div>
        </div>
      )}

      <label className="flex items-center gap-2 text-sm text-slate-700">
        <input
          type="checkbox"
          checked={marcarEntrada}
          onChange={(e) => setMarcarEntrada(e.target.checked)}
        />
        Marcar la entrada al predio ahora
      </label>

      <button
        onClick={guardar}
        disabled={guardando}
        className="rounded-lg bg-[var(--primary)] px-4 py-2 text-sm font-semibold text-white hover:bg-[var(--primary-dark)] disabled:opacity-50"
      >
        {guardando ? "Guardando…" : "Cargar la orden"}
      </button>
    </div>
  );
}
