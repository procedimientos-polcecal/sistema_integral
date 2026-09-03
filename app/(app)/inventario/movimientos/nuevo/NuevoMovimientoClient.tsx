"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { loQueFalta, sectorDelMovimiento } from "@/lib/inventario/movimiento";

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
/** Cada persona de la lista del pañol trae su destino habitual. */
type Solicitante = Opcion & { destinoId: string | null };
type Tipo = "entrada" | "salida" | "ajuste";

/**
 * Cargar una entrada, una salida o un ajuste.
 *
 * Pensado para el celular, parado en el pañol y con una mano: primero qué
 * artículo, después qué pasó con él. Antes de confirmar se muestra **en cuánto
 * va a quedar el stock**, que es la comprobación que hace cualquiera antes de
 * apretar.
 *
 * Lo que se carga acá se escribe en la planilla del almacén, que la lee gente
 * que no entra al sistema. Por eso el formulario exige artículo, cantidad y
 * quién lo pidió: una fila a medias allá no la arregla nadie. Ver
 * `lib/inventario/movimiento.ts`, que tiene la regla y la comparte con la ruta.
 *
 * Quién retira y a dónde va son la lista del pañol —la validación de las
 * columnas F y J— y no los catálogos del núcleo: así lo que la app escribe usa
 * las mismas palabras que escribe la gente. Ver `lib/inventario/catalogos.ts`.
 */
export default function NuevoMovimientoClient({
  articuloInicial, destinos, solicitantes, proveedores,
}: {
  articuloInicial: Articulo | null;
  destinos: Opcion[];
  solicitantes: Solicitante[];
  proveedores: Opcion[];
}) {
  const [articulo, setArticulo] = useState<Articulo | null>(articuloInicial);
  const [busqueda, setBusqueda] = useState("");
  const [opciones, setOpciones] = useState<Articulo[]>([]);

  const [tipo, setTipo] = useState<Tipo>("salida");
  const [cantidad, setCantidad] = useState("");
  const [solicitanteId, setSolicitanteId] = useState("");
  // Vacío no es "sin destino": es "el que diga quien retira". Sólo se guarda
  // acá lo que alguien eligió a mano, para que cambiar de persona siga
  // arrastrando su destino mientras nadie lo haya pisado.
  const [destinoElegido, setDestinoElegido] = useState("");
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

  const solicitante = solicitantes.find((s) => s.id === solicitanteId) ?? null;
  const destinoId = sectorDelMovimiento(destinoElegido, solicitante?.destinoId) ?? "";
  const destino = destinos.find((d) => d.id === destinoId) ?? null;

  const faltan = loQueFalta({ articuloId: articulo?.id, tipo, cantidad, solicitanteId });

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
    if (!articulo || faltan.length > 0) return;
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
        // Van los ids y no los nombres: el texto que termina en la planilla lo
        // resuelve la ruta contra la lista, así un cliente viejo o retocado no
        // puede escribir ahí una palabra que la validación no acepta.
        solicitante_id: solicitanteId || null,
        destino_id: destinoId || null,
        proveedor_id: proveedorId || null,
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
            <span className="text-xs font-medium text-slate-600">
              {tipo === "ajuste" ? "Quién lo contó" : "Quién lo pidió"}
              {tipo !== "ajuste" && <span className="text-red-500"> *</span>}
            </span>
            <select
              value={solicitanteId}
              onChange={(e) => setSolicitanteId(e.target.value)}
              required={tipo !== "ajuste"}
              className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm"
            >
              <option value="">—</option>
              {solicitantes.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
            </select>
            <span className="mt-1 block text-xs text-slate-400">
              Es la lista del pañol, la misma que la planilla.{" "}
              <Link href="/inventario/lista" className="underline hover:text-slate-600">
                Falta alguien
              </Link>
            </span>
          </label>

          {/* El destino no se pregunta dos veces: quien retira ya tiene el suyo
              en la lista. Elegir uno acá lo pisa, porque el material lo puede
              retirar el mecánico para una máquina de Filler 2 y eso sólo lo
              sabe quien está parado ahí. */}
          <label className="block">
            <span className="text-xs font-medium text-slate-600">Para qué sector</span>
            <select
              value={destinoElegido}
              onChange={(e) => setDestinoElegido(e.target.value)}
              className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm"
            >
              <option value="">
                {solicitante ? "Según quién lo pidió" : "Según quién lo pidió — elegilo arriba"}
              </option>
              {destinos.map((d) => <option key={d.id} value={d.id}>{d.nombre}</option>)}
            </select>
            {!destinoElegido && solicitante && (
              <span className="mt-1 block text-xs text-slate-500">
                {destino
                  ? <>Va a quedar en <strong>{destino.nombre}</strong>.</>
                  : <>{solicitante.nombre} no tiene un destino en la lista: va a quedar sin
                     sector salvo que elijas uno.</>}
              </span>
            )}
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

          {/* Qué falta, dicho antes de apretar y no después: el botón está
              apagado y esto explica por qué. */}
          {faltan.length > 0 && (
            <p className="text-xs text-slate-500">{faltan.join(" ")}</p>
          )}

          <div className="flex gap-2">
            <button
              type="submit"
              disabled={guardando || faltan.length > 0}
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
