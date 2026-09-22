"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

export interface ArticuloDelSelector {
  id: string;
  codigo: string;
  descripcion: string;
  grupo: string | null;
}

export interface MovimientoEnPantalla {
  id: string;
  articulo_id: string;
  codigo: string | null;
  fecha: string | null;
  entrada: number;
  salida: number;
  rotura: number;
  despacho: number;
  observacion: string | null;
  /** Por qué no llegó a la planilla. Null = está escrito. */
  sheets_pendiente: string | null;
}

const hoy = () => new Date().toISOString().slice(0, 10);

/**
 * El kardex de envases y el alta de un movimiento.
 *
 * Una fila lleva **cuatro números**, no un tipo y una cantidad: así está la
 * planilla, y hay filas con entrada y salida a la vez. La rotura y el despacho
 * se cargan y **no descuentan stock**, igual que allá.
 */
export default function MovimientosClient({
  articulos, movimientos, puedeOperar,
}: {
  articulos: ArticuloDelSelector[];
  movimientos: MovimientoEnPantalla[];
  puedeOperar: boolean;
}) {
  const router = useRouter();

  const [filtroArticulo, setFiltroArticulo] = useState("");
  const [desde, setDesde] = useState("");
  const [hasta, setHasta] = useState("");

  const [abierto, setAbierto] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");
  const [avisoPlanilla, setAvisoPlanilla] = useState("");

  const [form, setForm] = useState({
    articulo_id: "", entrada: "", salida: "", rotura: "", despacho: "",
    fecha: hoy(), observacion: "", proveedor: "",
  });

  const descripcionDe = useMemo(
    () => new Map(articulos.map((a) => [a.id, a.descripcion])),
    [articulos]
  );

  const visibles = useMemo(
    () =>
      movimientos.filter((m) => {
        if (filtroArticulo && m.articulo_id !== filtroArticulo) return false;
        const dia = m.fecha?.slice(0, 10);
        if (desde && (!dia || dia < desde)) return false;
        if (hasta && (!dia || dia > hasta)) return false;
        return true;
      }),
    [movimientos, filtroArticulo, desde, hasta]
  );

  const suma = Number(form.entrada || 0) + Number(form.salida || 0) +
               Number(form.rotura || 0) + Number(form.despacho || 0);
  const puedeGuardar = Boolean(form.articulo_id) && suma > 0 && !guardando;

  async function guardar() {
    setGuardando(true);
    setError("");
    setAvisoPlanilla("");

    const res = await fetch("/api/calidad/envases/movimientos", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    const body = await res.json().catch(() => ({}));
    setGuardando(false);

    if (!res.ok) { setError(body.error ?? "No se pudo guardar."); return; }

    // El movimiento se guardó pero no llegó a la planilla. No es un detalle: la
    // planilla manda, así que hasta que alguien lo cargue allá a mano el stock
    // no lo incluye. Se muestra lo que dijo Google **sin traducir**.
    if (body.planilla_error) {
      setAvisoPlanilla(
        `Se guardó, pero no se pudo escribir en la planilla: ${body.planilla_error}`
      );
    } else {
      setAbierto(false);
    }
    setForm({ ...form, entrada: "", salida: "", rotura: "", despacho: "", observacion: "" });
    router.refresh();
  }

  const campo = (k: keyof typeof form, etiqueta: string, tipo = "number") => (
    <label className="flex flex-col gap-1 text-sm">
      <span className="text-slate-600">{etiqueta}</span>
      <input
        type={tipo}
        min={tipo === "number" ? 0 : undefined}
        value={form[k]}
        onChange={(e) => setForm({ ...form, [k]: e.target.value })}
        className="rounded-lg border border-slate-300 px-3 py-2"
      />
    </label>
  );

  const selectorDeArticulo = (valor: string, alCambiar: (v: string) => void, primera: string) => (
    <select
      value={valor}
      onChange={(e) => alCambiar(e.target.value)}
      className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
    >
      <option value="">{primera}</option>
      {articulos.map((a) => (
        <option key={a.id} value={a.id}>{a.codigo} — {a.descripcion}</option>
      ))}
    </select>
  );

  return (
    <div className="mx-auto max-w-5xl space-y-4 md:p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Movimientos de envases</h1>
          <p className="text-sm text-slate-500">
            {visibles.length} de {movimientos.length}
          </p>
        </div>
        {puedeOperar && (
          <button
            onClick={() => setAbierto((v) => !v)}
            className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
          >
            {abierto ? "Cerrar" : "Cargar movimiento"}
          </button>
        )}
      </div>

      {abierto && (
        <div className="space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-4">
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-slate-600">Artículo</span>
            {selectorDeArticulo(
              form.articulo_id,
              (v) => setForm({ ...form, articulo_id: v }),
              "Elegí uno"
            )}
          </label>

          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {campo("entrada", "Entradas")}
            {campo("salida", "Salidas")}
            {campo("rotura", "Rotura")}
            {campo("despacho", "Despacho")}
          </div>
          <p className="text-xs text-slate-500">
            La rotura y el despacho se guardan y <strong>no descuentan stock</strong>, igual
            que en la planilla. El stock lo mueven las entradas y las salidas.
          </p>

          <div className="grid gap-3 md:grid-cols-2">
            {campo("fecha", "Fecha", "date")}
            {campo("proveedor", "Proveedor", "text")}
          </div>
          {campo("observacion", "Observación", "text")}

          <button
            onClick={guardar}
            disabled={!puedeGuardar}
            className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {guardando ? "Guardando…" : "Guardar"}
          </button>
          {suma <= 0 && (
            <p className="text-xs text-slate-500">Cargá al menos uno de los cuatro números.</p>
          )}
          {error && <p className="text-sm text-red-700">{error}</p>}
        </div>
      )}

      {avisoPlanilla && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          {avisoPlanilla}
        </div>
      )}

      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-slate-600">Artículo</span>
          {selectorDeArticulo(filtroArticulo, setFiltroArticulo, "Todos")}
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-slate-600">Desde</span>
          <input type="date" value={desde} onChange={(e) => setDesde(e.target.value)}
                 className="rounded-lg border border-slate-300 px-3 py-2" />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-slate-600">Hasta</span>
          <input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)}
                 className="rounded-lg border border-slate-300 px-3 py-2" />
        </label>
      </div>

      <div className="overflow-x-auto card">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-slate-600">
            <tr>
              <th className="px-3 py-2">Fecha</th>
              <th className="px-3 py-2">Artículo</th>
              <th className="px-3 py-2 text-right">Entra</th>
              <th className="px-3 py-2 text-right">Sale</th>
              <th className="px-3 py-2 text-right">Rotura</th>
              <th className="px-3 py-2 text-right">Despacho</th>
              <th className="px-3 py-2">Observación</th>
            </tr>
          </thead>
          <tbody>
            {visibles.map((m) => (
              <tr
                key={m.id}
                className={`border-t border-slate-100 ${m.sheets_pendiente ? "bg-amber-50" : ""}`}
              >
                <td className="whitespace-nowrap px-3 py-2 text-slate-500">{m.fecha ?? "—"}</td>
                <td className="px-3 py-2 text-slate-900">
                  {descripcionDe.get(m.articulo_id) ?? m.codigo}
                  {m.sheets_pendiente && (
                    <span className="block text-xs text-amber-800">
                      No llegó a la planilla: {m.sheets_pendiente}
                    </span>
                  )}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">{m.entrada || ""}</td>
                <td className="px-3 py-2 text-right tabular-nums">{m.salida || ""}</td>
                <td className="px-3 py-2 text-right tabular-nums">{m.rotura || ""}</td>
                <td className="px-3 py-2 text-right tabular-nums">{m.despacho || ""}</td>
                <td className="px-3 py-2 text-slate-500">{m.observacion}</td>
              </tr>
            ))}
            {visibles.length === 0 && (
              <tr>
                <td colSpan={7} className="px-3 py-6 text-center text-slate-500">
                  Ningún movimiento con esos filtros.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
