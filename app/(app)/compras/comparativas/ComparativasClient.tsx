"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import Select from "@/components/Select";
import { fecha, monedaExacta } from "@/lib/compras/constants";
import { recortarParaPantalla } from "@/lib/compras/texto";
import {
  agruparPorArticulo,
  buscarEnComparativas,
  type CotizacionHistorica,
  type GrupoDeArticulo,
} from "@/lib/compras/buscadorDeComparativas";

/**
 * Cuántos artículos se dibujan de una vez.
 *
 * Sin corte son 840 tarjetas con su tabla adentro en el primer render, y la
 * pantalla tarda en aparecer justo cuando todavía no se buscó nada. Veinte
 * entran en dos pantallazos y el que busca algo puntual nunca llega al final.
 */
const POR_PAGINA = 20;

export default function ComparativasClient({
  cotizaciones,
  proveedores,
}: {
  cotizaciones: CotizacionHistorica[];
  proveedores: { id: string; nombre: string }[];
}) {
  const [texto, setTexto] = useState("");
  const [proveedorId, setProveedorId] = useState("");
  /*
   * «Sólo los repetidos» es la vista del historial de verdad, y mira los
   * **pedidos** y no las cotizaciones. No es lo mismo: de los 840 artículos
   * cotizados hay 139 con dos o más cotizaciones pero sólo 119 con dos o más
   * pedidos. Los 20 de diferencia son artículos que se pidieron una sola vez
   * y recibieron varios presupuestos — una comparativa entre proveedores, que
   * es útil, pero no es un precio anterior contra el cual comparar éste.
   */
  const [soloRepetidos, setSoloRepetidos] = useState(false);
  const [pagina, setPagina] = useState(0);

  const grupos = useMemo(() => {
    const encontradas = buscarEnComparativas(cotizaciones, { texto, proveedorId });
    const todos = agruparPorArticulo(encontradas);
    return soloRepetidos ? todos.filter((g) => g.pedidos > 1) : todos;
  }, [cotizaciones, texto, proveedorId, soloRepetidos]);

  const cuantasCotizaciones = grupos.reduce((suma, g) => suma + g.veces, 0);
  const desde = Math.min(pagina, Math.max(0, Math.ceil(grupos.length / POR_PAGINA) - 1)) * POR_PAGINA;
  const visibles = grupos.slice(desde, desde + POR_PAGINA);

  function cambiarFiltro(cambio: () => void) {
    cambio();
    setPagina(0);
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-slate-800">Comparativas</h1>
        <p className="mt-1 text-sm text-slate-500">
          Todo lo que se cotizó en las comparativas ya bajadas, buscable por producto o por
          proveedor. Agrupado por artículo: es donde está el historial, porque el mismo
          repuesto se vuelve a pedir.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        {/* El ancho va en el div y no en el input: `.input` y los anchos
            sueltos no conviven, pero acá además el campo no usa esa clase, así
            que se declara derecho sobre el elemento. */}
        <input
          className="w-full max-w-sm rounded-lg border border-slate-300 px-3 py-2 text-sm"
          placeholder="Producto, marca o N° de RI…"
          value={texto}
          onChange={(e) => cambiarFiltro(() => setTexto(e.target.value))}
          aria-label="Buscar"
        />
        <Select
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
          value={proveedorId}
          onChange={(e) => cambiarFiltro(() => setProveedorId(e.target.value))}
          aria-label="Proveedor"
        >
          <option value="">Todos los proveedores</option>
          {proveedores.map((p) => (
            <option key={p.id} value={p.id}>
              {p.nombre}
            </option>
          ))}
        </Select>
        <label className="flex items-center gap-2 rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-600">
          <input
            type="checkbox"
            checked={soloRepetidos}
            onChange={(e) => cambiarFiltro(() => setSoloRepetidos(e.target.checked))}
          />
          Sólo los pedidos más de una vez
        </label>
      </div>

      <p className="text-sm text-slate-500">
        {grupos.length.toLocaleString("es-AR")} artículo{grupos.length === 1 ? "" : "s"} ·{" "}
        {cuantasCotizaciones.toLocaleString("es-AR")} cotizacion
        {cuantasCotizaciones === 1 ? "" : "es"}
      </p>

      {grupos.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-10 text-center text-sm text-slate-500">
          No hay ninguna cotización que responda a eso.
          {soloRepetidos && (
            <>
              {" "}
              Puede ser por el filtro de repetidos: la mayoría de los artículos se pidió una
              sola vez.
            </>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {visibles.map((g) => (
            <Articulo key={g.clave} grupo={g} />
          ))}
        </div>
      )}

      {grupos.length > POR_PAGINA && (
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-slate-500">
          <span>
            Mostrando {desde + 1}–{Math.min(desde + POR_PAGINA, grupos.length)} de{" "}
            {grupos.length.toLocaleString("es-AR")}
          </span>
          <div className="flex gap-2">
            <button
              className="btn-secondary"
              disabled={desde === 0}
              onClick={() => setPagina((p) => Math.max(0, p - 1))}
            >
              Anteriores
            </button>
            <button
              className="btn-secondary"
              disabled={desde + POR_PAGINA >= grupos.length}
              onClick={() => setPagina((p) => p + 1)}
            >
              Siguientes
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function Articulo({ grupo }: { grupo: GrupoDeArticulo }) {
  return (
    <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
      <header className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-b border-slate-100 px-4 py-3">
        <h2 className="font-semibold text-slate-800">{grupo.descripcion}</h2>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
          <span>
            {grupo.veces} cotizacion{grupo.veces === 1 ? "" : "es"}
          </span>
          <span>
            {grupo.proveedores} proveedor{grupo.proveedores === 1 ? "" : "es"}
          </span>
          {/* Cuántos pedidos, que es lo que separa una comparativa de un
              historial: nueve cotizaciones de un solo RI son dos proveedores
              compitiendo por una compra, y no un precio que se pueda mirar
              como «lo que salió la vez pasada». */}
          <span>
            {grupo.pedidos} pedido{grupo.pedidos === 1 ? "" : "s"}
          </span>
          {grupo.rango ? (
            <span className="font-mono text-slate-600">
              {grupo.rango.minimo === grupo.rango.maximo
                ? precio(grupo.rango.minimo, grupo.rango.moneda)
                : `${precio(grupo.rango.minimo, grupo.rango.moneda)} – ${precio(grupo.rango.maximo, grupo.rango.moneda)}`}{" "}
              <span className="font-sans text-slate-400">por unidad</span>
            </span>
          ) : (
            /* Sin rango la causa importa: o no hay un solo precio cargado, o
               el artículo se cotizó en dos monedas y compararlas sería
               inventar una conversión. */
            <span className="text-slate-400">
              {grupo.cotizaciones.some((c) => c.precioUnitario !== null)
                ? "cotizado en dos monedas"
                : "sin precio unitario"}
            </span>
          )}
        </div>
      </header>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-3 py-2 text-left">Fecha</th>
              <th className="px-3 py-2 text-left">Pedido</th>
              <th className="px-3 py-2 text-left">Proveedor</th>
              <th className="px-3 py-2 text-right">Unitario</th>
              <th className="px-3 py-2 text-right">Cantidad</th>
              <th className="px-3 py-2 text-right">Total</th>
              <th className="px-3 py-2 text-left">Pago</th>
              <th className="px-3 py-2 text-left">Entrega</th>
              <th className="px-3 py-2 text-left">Planilla</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {grupo.cotizaciones.map((c) => (
              <tr key={c.id}>
                <td className="whitespace-nowrap px-3 py-2 text-slate-600">
                  {c.fecha ? fecha(c.fecha) : "—"}
                </td>
                <td className="whitespace-nowrap px-3 py-2">
                  <Link
                    href={`/compras/requerimientos/${c.requerimientoId}`}
                    className="text-[var(--primary)] hover:underline"
                  >
                    RI {c.nroRi ?? "—"}
                  </Link>
                </td>
                <td className="px-3 py-2">
                  <div className="text-slate-700">{c.proveedor}</div>
                  {c.marca && (
                    /* La marca de la planilla a veces trae la especificación
                       entera —200 caracteres describiendo un sinfín—, y sin
                       recortar eso estira la fila hasta tapar la tabla. El
                       texto completo queda en el `title`. */
                    <div className="text-xs text-slate-400" title={c.marca}>
                      {recortarParaPantalla(c.marca, 60)}
                    </div>
                  )}
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-right font-mono">
                  {precio(c.precioUnitario, c.moneda)}
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-right text-slate-600">
                  {c.cantidad === null ? "—" : c.cantidad.toLocaleString("es-AR")}
                  {c.unidadMedida && (
                    <span className="ml-1 text-xs text-slate-400">{c.unidadMedida}</span>
                  )}
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-right font-mono text-slate-600">
                  {precio(c.precioTotal, c.moneda)}
                </td>
                <td className="px-3 py-2 text-slate-600">{c.condicionesPago ?? "—"}</td>
                <td className="px-3 py-2 text-slate-600">{c.disponibilidad ?? "—"}</td>
                <td className="px-3 py-2">
                  {c.planillaId ? (
                    <a
                      href={`https://docs.google.com/spreadsheets/d/${c.planillaId}/edit`}
                      target="_blank"
                      rel="noreferrer"
                      className="text-[var(--primary)] hover:underline"
                    >
                      {c.planillaNombre ?? "abrir"}
                    </a>
                  ) : (
                    <span className="text-slate-400">cargada en el sistema</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/**
 * Un importe con su moneda.
 *
 * `monedaExacta()` escribe pesos siempre, así que la única cotización en
 * dólares que hay entre las 1.078 saldría diciendo «$». Acá el dato ya trae su
 * moneda y no se convierte nada: se muestra tal cual se cotizó.
 */
function precio(valor: number | null, moneda: string): string {
  if (valor === null) return "—";
  if (moneda === "ARS") return monedaExacta(valor);
  return `${moneda} ${valor.toLocaleString("es-AR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}
