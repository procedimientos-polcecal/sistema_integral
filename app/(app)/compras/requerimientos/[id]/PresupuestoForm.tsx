"use client";

import { useState } from "react";
import { moneda } from "@/lib/compras/constants";
import { totalCotizacion, PLAZOS_PAGO, DISPONIBILIDADES } from "@/lib/compras/comparativa";

/**
 * Cargar un presupuesto, con los campos de la planilla.
 *
 * Los porcentajes se escriben como los diría una persona —10, no 0.1— y se
 * convierten a fracción al guardar, que es como los guarda la planilla.
 *
 * El total se muestra mientras se escribe con la misma fórmula que calcula la
 * base, para que no haya sorpresa entre lo que se ve y lo que queda guardado.
 */
export default function PresupuestoForm({
  requerimientoId, proveedores, cantidadSugerida, onListo, onCancelar,
}: {
  requerimientoId: string;
  proveedores: { id: string; nombre: string }[];
  cantidadSugerida: number | null;
  onListo: (aviso: string | null) => void;
  onCancelar: () => void;
}) {
  const [proveedorId, setProveedorId] = useState("");
  const [marca, setMarca] = useState("");
  const [unidad, setUnidad] = useState("");
  const [unitario, setUnitario] = useState("");
  const [cantidad, setCantidad] = useState(cantidadSugerida ? String(cantidadSugerida) : "");
  const [envio, setEnvio] = useState("");
  const [descuento, setDescuento] = useState("0");
  const [iva, setIva] = useState("21");
  const [precioHasta, setPrecioHasta] = useState("");
  const [plazo, setPlazo] = useState("");
  const [condiciones, setCondiciones] = useState("");
  const [disponibilidad, setDisponibilidad] = useState("");
  const [comentario, setComentario] = useState("");

  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");

  const num = (v: string) => (v.trim() === "" ? null : Number(v.replace(",", ".")));

  const total = totalCotizacion({
    precio_unitario: num(unitario),
    cantidad: num(cantidad),
    descuento: (num(descuento) ?? 0) / 100,
    iva: (num(iva) ?? 0) / 100,
    costo_envio: num(envio),
  });

  async function guardar() {
    setGuardando(true);
    setError("");

    const res = await fetch(`/api/compras/requerimientos/${requerimientoId}/cotizaciones`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        proveedor_id: proveedorId,
        marca: marca.trim() || null,
        unidad_medida: unidad.trim() || null,
        precio_unitario: num(unitario),
        cantidad: num(cantidad),
        costo_envio: num(envio),
        descuento: (num(descuento) ?? 0) / 100,
        iva: (num(iva) ?? 0) / 100,
        precio_hasta: precioHasta || null,
        plazo_pago_dias: num(plazo),
        condiciones_pago: condiciones.trim() || null,
        disponibilidad: disponibilidad || null,
        comentario: comentario.trim() || null,
      }),
    });

    const body = await res.json().catch(() => ({}));
    setGuardando(false);
    if (!res.ok) {
      setError(body.error ?? "No se pudo guardar el presupuesto.");
      return;
    }
    onListo(body.aviso_drive ?? null);
  }

  return (
    <div className="space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-4">
      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-3">
        <Campo label="Proveedor" ancho="sm:col-span-2">
          <select
            value={proveedorId}
            onChange={(e) => setProveedorId(e.target.value)}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          >
            <option value="">Elegir…</option>
            {proveedores.map((p) => (
              <option key={p.id} value={p.id}>{p.nombre}</option>
            ))}
          </select>
        </Campo>
        <Campo label="Marca"><Texto valor={marca} set={setMarca} /></Campo>

        <Campo label="Precio unitario"><Texto valor={unitario} set={setUnitario} /></Campo>
        <Campo label="Cantidad"><Texto valor={cantidad} set={setCantidad} /></Campo>
        <Campo label="Unidad de medida"><Texto valor={unidad} set={setUnidad} /></Campo>

        <Campo label="Envío"><Texto valor={envio} set={setEnvio} /></Campo>
        <Campo label="Descuento %"><Texto valor={descuento} set={setDescuento} /></Campo>
        <Campo label="IVA %"><Texto valor={iva} set={setIva} /></Campo>

        <Campo label="Precio válido hasta">
          <input
            type="date"
            value={precioHasta}
            onChange={(e) => setPrecioHasta(e.target.value)}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
        </Campo>
        <Campo label="Plazo de pago (días)">
          <select
            value={plazo}
            onChange={(e) => setPlazo(e.target.value)}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          >
            <option value="">—</option>
            {PLAZOS_PAGO.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </Campo>
        <Campo label="Disponibilidad">
          <select
            value={disponibilidad}
            onChange={(e) => setDisponibilidad(e.target.value)}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          >
            <option value="">—</option>
            {DISPONIBILIDADES.map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
        </Campo>

        <Campo label="Condiciones de pago" ancho="sm:col-span-3">
          <Texto valor={condiciones} set={setCondiciones} />
        </Campo>
        <Campo label="Comentario" ancho="sm:col-span-3">
          <Texto valor={comentario} set={setComentario} />
        </Campo>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 pt-3">
        <p className="text-sm text-slate-600">
          Total con IVA y envío: <strong className="font-mono">{moneda(total)}</strong>
        </p>
        <div className="flex gap-2">
          <button
            onClick={onCancelar}
            className="rounded-lg px-3 py-2 text-sm text-slate-500 hover:text-slate-900"
          >
            Cancelar
          </button>
          <button
            onClick={guardar}
            disabled={guardando || !proveedorId || unitario.trim() === ""}
            className="rounded-lg bg-[var(--primary)] px-4 py-2 text-sm font-semibold text-white hover:bg-[var(--primary-dark)] disabled:opacity-50"
          >
            {guardando ? "Guardando…" : "Guardar presupuesto"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Campo({ label, ancho = "", children }: {
  label: string; ancho?: string; children: React.ReactNode;
}) {
  return (
    <label className={`block ${ancho}`}>
      <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
        {label}
      </span>
      {children}
    </label>
  );
}

function Texto({ valor, set }: { valor: string; set: (v: string) => void }) {
  return (
    <input
      value={valor}
      onChange={(e) => set(e.target.value)}
      className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
    />
  );
}
