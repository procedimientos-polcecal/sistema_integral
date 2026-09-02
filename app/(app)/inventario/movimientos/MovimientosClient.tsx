"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

interface Movimiento {
  id: string;
  codigo: string | null;
  tipo: string;
  cantidad: number;
  stock_resultante: number | null;
  fecha: string | null;
  solicitante: string | null;
  sector_raw: string | null;
  proveedor_raw: string | null;
  ri: number | null;
  origen: string;
  sheets_pendiente: string | null;
}

interface Pendiente {
  id: string;
  codigo: string | null;
  tipo: string;
  cantidad: number;
  fecha: string | null;
  sheets_pendiente: string | null;
  sheets_pendiente_en: string | null;
}

type Opcion = { id: string; nombre: string };

const POR_PAGINA = 50;

const COLOR: Record<string, string> = {
  entrada: "bg-green-50 text-green-700",
  salida: "bg-amber-50 text-amber-800",
  ajuste: "bg-slate-100 text-slate-600",
};

/**
 * El kardex: qué se movió, cuándo y para quién.
 *
 * `origen` es el filtro que importa: distingue lo que se cargó en el sistema de
 * lo que vino de la planilla. Sin eso no se puede saber por dónde entra el
 * trabajo ni si la app se está usando.
 */
export default function MovimientosClient({
  sectores, pendientes,
}: {
  sectores: Opcion[];
  pendientes: Pendiente[];
}) {
  const [tipo, setTipo] = useState("");
  const [origen, setOrigen] = useState("");
  const [sector, setSector] = useState("");
  const [desde, setDesde] = useState("");
  const [hasta, setHasta] = useState("");
  const [busqueda, setBusqueda] = useState("");

  const [filas, setFilas] = useState<Movimiento[]>([]);
  const [total, setTotal] = useState(0);
  const [pagina, setPagina] = useState(0);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => { setPagina(0); }, [tipo, origen, sector, desde, hasta, busqueda]);

  const cargar = useCallback(async () => {
    setCargando(true);
    setError("");
    const supabase = createClient();

    let q = supabase
      .from("inventario_movimientos")
      .select(
        "id, codigo, tipo, cantidad, stock_resultante, fecha, solicitante, sector_raw, proveedor_raw, ri, origen, sheets_pendiente",
        { count: "exact" }
      );

    if (tipo) q = q.eq("tipo", tipo);
    if (origen) q = q.eq("origen", origen);
    if (sector) q = q.eq("sector_id", sector);
    if (desde) q = q.gte("fecha", desde);
    // `hasta` incluye el día entero: sin esto, filtrar "hasta hoy" deja afuera
    // todo lo de hoy.
    if (hasta) q = q.lt("fecha", `${hasta}T23:59:59.999Z`);
    if (busqueda.trim()) q = q.ilike("codigo", `${busqueda.trim()}%`);

    const inicio = pagina * POR_PAGINA;
    const { data, error: err, count } = await q
      .order("fecha", { ascending: false, nullsFirst: false })
      .range(inicio, inicio + POR_PAGINA - 1);

    setCargando(false);
    if (err) { setError(err.message); setFilas([]); return; }
    setFilas((data ?? []) as Movimiento[]);
    setTotal(count ?? 0);
  }, [tipo, origen, sector, desde, hasta, busqueda, pagina]);

  useEffect(() => { cargar(); }, [cargar]);

  const paginas = Math.ceil(total / POR_PAGINA);

  return (
    <div className="mx-auto max-w-5xl space-y-4 md:p-6">
      <div>
        <h1 className="text-xl font-bold text-slate-900">Movimientos</h1>
        <p className="text-sm text-slate-500">
          El kardex del almacén: lo que se cargó acá y lo que vino de la planilla.
        </p>
      </div>

      {pendientes.length > 0 && (
        <section className="rounded-xl border border-amber-200 bg-amber-50 p-4">
          <h2 className="text-sm font-semibold text-amber-900">
            {pendientes.length} {pendientes.length === 1 ? "movimiento no llegó" : "movimientos no llegaron"} a la planilla
          </h2>
          <p className="mt-1 text-xs text-amber-800">
            El stock del almacén sale de las fórmulas de la planilla, así que la
            próxima sincronización va a revertirlos. Hay que anotarlos a mano
            allá, o resolver por qué no se pudo escribir.
          </p>
          <ul className="mt-3 space-y-1 text-sm">
            {pendientes.map((p) => (
              <li key={p.id} className="text-amber-900">
                <span className="font-mono">{p.codigo}</span> · {p.tipo} de {p.cantidad}
                {p.sheets_pendiente && (
                  <span className="text-xs text-amber-700"> — {p.sheets_pendiente}</span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-6">
        <input
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
          placeholder="Código…"
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
        />
        <Select value={tipo} onChange={setTipo} vacio="Cualquier tipo"
          opciones={[["entrada", "Entrada"], ["salida", "Salida"], ["ajuste", "Ajuste"]]} />
        <Select value={origen} onChange={setOrigen} vacio="Cualquier origen"
          opciones={[["app", "Cargado en el sistema"], ["planilla", "De la planilla"]]} />
        <Select value={sector} onChange={setSector} vacio="Cualquier sector"
          opciones={sectores.map((s) => [s.id, s.nombre])} />
        <input type="date" value={desde} onChange={(e) => setDesde(e.target.value)}
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm" />
        <input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)}
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm" />
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      )}

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-3 py-2 text-left">Fecha</th>
                <th className="px-3 py-2 text-left">Código</th>
                <th className="px-3 py-2 text-left">Tipo</th>
                <th className="px-3 py-2 text-right">Cantidad</th>
                <th className="px-3 py-2 text-right">Queda</th>
                <th className="px-3 py-2 text-left">Quién</th>
                <th className="px-3 py-2 text-left">Sector</th>
                <th className="px-3 py-2 text-left">RI</th>
                <th className="px-3 py-2 text-left">Origen</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {cargando ? (
                <tr><td colSpan={9} className="px-3 py-10 text-center text-slate-400">Cargando…</td></tr>
              ) : filas.length === 0 ? (
                <tr><td colSpan={9} className="px-3 py-10 text-center text-slate-400">
                  Ningún movimiento coincide.
                </td></tr>
              ) : (
                filas.map((m) => (
                  <tr key={m.id} className="hover:bg-slate-50">
                    <td className="whitespace-nowrap px-3 py-2 text-slate-500">
                      {m.fecha ? new Date(m.fecha).toLocaleDateString("es-AR") : "—"}
                    </td>
                    <td className="px-3 py-2 font-mono text-slate-700">{m.codigo ?? "—"}</td>
                    <td className="px-3 py-2">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-semibold capitalize ${COLOR[m.tipo] ?? ""}`}>
                        {m.tipo}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right text-slate-700">{m.cantidad}</td>
                    <td className="px-3 py-2 text-right text-slate-500">{m.stock_resultante ?? "—"}</td>
                    <td className="px-3 py-2 text-slate-600">{m.solicitante ?? "—"}</td>
                    <td className="px-3 py-2 text-slate-600">{m.sector_raw ?? "—"}</td>
                    <td className="px-3 py-2 text-slate-500">{m.ri ?? "—"}</td>
                    <td className="px-3 py-2 text-xs text-slate-400">
                      {m.origen === "app" ? "Sistema" : "Planilla"}
                      {m.sheets_pendiente && <span className="text-amber-700"> · sin escribir</span>}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {paginas > 1 && (
        <div className="flex items-center justify-between text-sm text-slate-600">
          <span>{total.toLocaleString("es-AR")} movimientos</span>
          <div className="flex gap-2">
            <button
              onClick={() => setPagina((p) => Math.max(0, p - 1))}
              disabled={pagina === 0}
              className="rounded-lg border border-slate-300 px-3 py-1 disabled:opacity-40"
            >
              Anterior
            </button>
            <span className="py-1">{pagina + 1} de {paginas}</span>
            <button
              onClick={() => setPagina((p) => Math.min(paginas - 1, p + 1))}
              disabled={pagina >= paginas - 1}
              className="rounded-lg border border-slate-300 px-3 py-1 disabled:opacity-40"
            >
              Siguiente
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function Select({
  value, onChange, vacio, opciones,
}: {
  value: string;
  onChange: (v: string) => void;
  vacio: string;
  opciones: [string, string][];
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
    >
      <option value="">{vacio}</option>
      {opciones.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
    </select>
  );
}
