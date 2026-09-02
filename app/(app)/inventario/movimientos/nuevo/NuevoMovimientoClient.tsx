"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";

interface Articulo {
  id: string;
  codigo: string;
  descripcion: string;
  ubicacion: string | null;
  stock_actual: number;
  stock_seguridad: number;
  faltante: number;
}
type Opcion = { id: string; nombre: string };
type Tipo = "entrada" | "salida" | "ajuste";

/**
 * Cargar una entrada, una salida o un ajuste.
 *
 * Pensado para el celular, parado en el pañol y con una mano: primero qué
 * artículo, después qué pasó con él. Antes de confirmar se muestra **en cuánto
 * va a quedar el stock**, que es la comprobación que hace cualquiera antes de
 * apretar.
 */
export default function NuevoMovimientoClient({
  articuloInicial, sectores, empleados, proveedores,
}: {
  articuloInicial: Articulo | null;
  sectores: Opcion[];
  empleados: Opcion[];
  proveedores: Opcion[];
}) {
  const [articulo, setArticulo] = useState<Articulo | null>(articuloInicial);
  const [busqueda, setBusqueda] = useState("");
  const [opciones, setOpciones] = useState<Articulo[]>([]);

  const [tipo, setTipo] = useState<Tipo>("salida");
  const [cantidad, setCantidad] = useState("");
  const [empleadoId, setEmpleadoId] = useState("");
  const [sectorId, setSectorId] = useState("");
  const [proveedorId, setProveedorId] = useState("");
  const [ri, setRi] = useState("");

  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");
  const [hecho, setHecho] = useState<{ stock: number; aviso: string | null } | null>(null);

  // El buscador, sólo mientras no haya artículo elegido.
  useEffect(() => {
    if (articulo) { setOpciones([]); return; }
    const termino = busqueda.trim();
    if (termino.length < 3) { setOpciones([]); return; }

    const t = setTimeout(async () => {
      const res = await fetch(`/api/inventario/articulos?q=${encodeURIComponent(termino)}`);
      const body = await res.json().catch(() => ({}));
      setOpciones(body.data ?? []);
    }, 300);
    return () => clearTimeout(t);
  }, [busqueda, articulo]);

  /**
   * En cuánto va a quedar. Un ajuste no suma ni resta: fija el número, que es
   * lo que lo distingue de una entrada o una salida.
   */
  const stockQueQueda = useMemo(() => {
    if (!articulo || cantidad === "") return null;
    const c = Number(cantidad);
    if (!Number.isFinite(c)) return null;
    if (tipo === "entrada") return articulo.stock_actual + c;
    if (tipo === "salida") return articulo.stock_actual - c;
    return c;
  }, [articulo, cantidad, tipo]);

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    if (!articulo) return;
    setGuardando(true);
    setError("");
    setHecho(null);

    const res = await fetch("/api/inventario/movimientos", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        articulo_id: articulo.id,
        tipo,
        cantidad: Number(cantidad),
        empleado_id: empleadoId || null,
        solicitante: empleados.find((x) => x.id === empleadoId)?.nombre ?? null,
        sector_id: sectorId || null,
        sector_nombre: sectores.find((x) => x.id === sectorId)?.nombre ?? null,
        proveedor_id: proveedorId || null,
        proveedor_nombre: proveedores.find((x) => x.id === proveedorId)?.nombre ?? null,
        ri: ri ? Number(ri) : null,
      }),
    });
    const body = await res.json().catch(() => ({}));
    setGuardando(false);

    if (!res.ok) { setError(body.error ?? "No se pudo registrar el movimiento."); return; }

    setHecho({ stock: body.stock_resultante, aviso: body.planilla_error ?? null });
    setArticulo({ ...articulo, stock_actual: body.stock_resultante });
    setCantidad("");
  }

  return (
    <div className="mx-auto max-w-lg space-y-4 md:p-6">
      <div>
        <h1 className="text-xl font-bold text-slate-900">Cargar movimiento</h1>
        <p className="text-sm text-slate-500">
          Se registra acá y se escribe en la planilla del almacén en el momento.
        </p>
      </div>

      {/* ── Qué artículo ─────────────────────────────────────── */}
      {!articulo ? (
        <div className="space-y-2">
          <input
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            inputMode="search"
            placeholder="Buscar por código o descripción…"
            className="w-full rounded-xl border border-slate-300 px-4 py-3 text-base"
            autoFocus
          />
          {busqueda.trim().length > 0 && busqueda.trim().length < 3 && (
            <p className="text-xs text-slate-400">Escribí al menos tres letras.</p>
          )}
          <ul className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200 bg-white">
            {opciones.map((a) => (
              <li key={a.id}>
                <button
                  onClick={() => setArticulo(a)}
                  className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-slate-50"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm text-slate-900">{a.descripcion}</span>
                    <span className="block font-mono text-xs text-slate-500">{a.codigo}</span>
                  </span>
                  <span className="shrink-0 text-sm font-semibold text-slate-700">{a.stock_actual}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate font-medium text-slate-900">{articulo.descripcion}</p>
              <p className="font-mono text-xs text-slate-500">{articulo.codigo}</p>
            </div>
            <div className="shrink-0 text-right">
              <p className="text-lg font-semibold text-slate-900">{articulo.stock_actual}</p>
              <p className="text-[11px] text-slate-400">en stock</p>
            </div>
          </div>
          <button
            onClick={() => { setArticulo(null); setBusqueda(""); setHecho(null); }}
            className="mt-2 text-xs text-slate-500 hover:text-slate-900"
          >
            Cambiar artículo
          </button>
        </div>
      )}

      {/* ── Qué pasó con él ──────────────────────────────────── */}
      {articulo && (
        <form onSubmit={guardar} className="space-y-4 rounded-xl border border-slate-200 bg-white p-4">
          <div className="grid grid-cols-3 gap-2">
            {(["entrada", "salida", "ajuste"] as Tipo[]).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTipo(t)}
                className={`rounded-lg border px-3 py-2 text-sm font-semibold capitalize ${
                  tipo === t
                    ? "border-[var(--primary)] bg-[var(--primary)] text-white"
                    : "border-slate-300 text-slate-600 hover:bg-slate-50"
                }`}
              >
                {t}
              </button>
            ))}
          </div>

          <label className="block">
            <span className="text-xs font-medium text-slate-600">
              {tipo === "ajuste" ? "Cuánto hay en realidad" : "Cantidad"}
            </span>
            <input
              type="number" min="0" step="any" inputMode="decimal" required
              value={cantidad}
              onChange={(e) => setCantidad(e.target.value)}
              className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-3 text-base"
            />
          </label>

          {stockQueQueda !== null && (
            <p className={`text-sm ${stockQueQueda < 0 ? "text-red-600" : "text-slate-600"}`}>
              Queda en <strong>{stockQueQueda}</strong>
              {stockQueQueda < 0 && " — el stock quedaría negativo"}
            </p>
          )}

          <label className="block">
            <span className="text-xs font-medium text-slate-600">Quién lo pidió</span>
            <select
              value={empleadoId}
              onChange={(e) => setEmpleadoId(e.target.value)}
              className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm"
            >
              <option value="">—</option>
              {empleados.map((e2) => <option key={e2.id} value={e2.id}>{e2.nombre}</option>)}
            </select>
          </label>

          <label className="block">
            <span className="text-xs font-medium text-slate-600">Para qué sector</span>
            <select
              value={sectorId}
              onChange={(e) => setSectorId(e.target.value)}
              className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm"
            >
              <option value="">—</option>
              {sectores.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
            </select>
          </label>

          {tipo === "entrada" && (
            <>
              <label className="block">
                <span className="text-xs font-medium text-slate-600">Proveedor</span>
                <select
                  value={proveedorId}
                  onChange={(e) => setProveedorId(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm"
                >
                  <option value="">—</option>
                  {proveedores.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
                </select>
              </label>
              <label className="block">
                <span className="text-xs font-medium text-slate-600">N° de requerimiento</span>
                <input
                  type="number" min="1" inputMode="numeric"
                  value={ri}
                  onChange={(e) => setRi(e.target.value)}
                  placeholder="El RI de Compras, si vino de uno"
                  className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm"
                />
              </label>
            </>
          )}

          {error && <p className="text-sm text-red-600">{error}</p>}

          {hecho && (
            <div className={`rounded-lg px-3 py-2 text-sm ${
              hecho.aviso ? "bg-amber-50 text-amber-800" : "bg-green-50 text-green-800"
            }`}>
              Registrado. El stock quedó en <strong>{hecho.stock}</strong>.
              {hecho.aviso && (
                <>
                  {" "}
                  <strong>No se pudo escribir en la planilla</strong> ({hecho.aviso}). Como
                  el stock sale de sus fórmulas, la próxima sincronización va a
                  revertirlo: anotalo a mano en la planilla o pedí que se
                  reintente.
                </>
              )}
            </div>
          )}

          <div className="flex gap-2">
            <button
              type="submit"
              disabled={guardando || cantidad === ""}
              className="flex-1 rounded-xl bg-[var(--primary)] px-4 py-3 text-base font-semibold text-white hover:bg-[var(--primary-dark)] disabled:opacity-50"
            >
              {guardando ? "Registrando…" : "Registrar"}
            </button>
            <Link
              href="/inventario"
              className="rounded-xl border border-slate-300 px-4 py-3 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Volver
            </Link>
          </div>
        </form>
      )}
    </div>
  );
}
