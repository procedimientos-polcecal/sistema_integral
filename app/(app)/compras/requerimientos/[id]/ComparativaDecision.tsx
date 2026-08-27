"use client";

import { monedaExacta, fecha } from "@/lib/compras/constants";
import { diferenciaPorcentual, detalleCotizacion } from "@/lib/compras/comparativa";
import type { Cotizacion } from "@/lib/compras/types";

/**
 * La comparativa en el momento de decidir.
 *
 * Acá el trabajo no es administrar filas sino elegir, y para eso hay que poder
 * comparar atributo por atributo: el unitario más bajo puede terminar siendo el
 * total más alto por el envío, y un IVA del 10,5% compensa un precio alto.
 *
 * Dos formas de lo mismo, según el ancho, porque se aprueba tanto desde la
 * computadora como desde el teléfono:
 *
 *   - pantalla grande: matriz, los atributos en filas y cada proveedor en una
 *     columna. Es la planilla dada vuelta, y es lo que hace que las diferencias
 *     salten recorriendo una línea con el ojo.
 *   - teléfono: una tarjeta por proveedor, apiladas. La matriz en 380px obliga a
 *     un scroll horizontal que arruina justamente la comparación.
 */
/**
 * Un total, siempre en pesos, con el precio original al lado si el proveedor
 * cotizó en dólares.
 *
 * Comparar es la única razón por la que existe esta pantalla, y para eso los
 * números tienen que estar en la misma moneda. El original se muestra igual
 * porque es lo que el proveedor dijo, y es lo que va a figurar en su factura.
 */
function Importe({ c, enPesos }: { c: Cotizacion; enPesos: number | null }) {
  if (c.moneda !== "USD") return <>{monedaExacta(c.precio_total)}</>;
  if (enPesos === null) {
    return (
      <span className="text-amber-700">
        USD {c.precio_total?.toLocaleString("es-AR") ?? "—"} · sin cotización
      </span>
    );
  }
  return (
    <>
      {monedaExacta(enPesos)}
      <span className="ml-1 text-xs font-normal text-slate-500">
        USD {c.precio_total?.toLocaleString("es-AR")}
      </span>
    </>
  );
}

export default function ComparativaDecision({
  cotizaciones, minimo, onElegir, eligiendo, enPesos,
}: {
  /** Ya ordenadas por total. */
  cotizaciones: Cotizacion[];
  /** El total más bajo, contra el que se mide la diferencia. */
  minimo: number | null;
  onElegir: (c: Cotizacion) => void;
  eligiendo: string | null;
  /** Los totales ya convertidos a pesos, por id de presupuesto. */
  enPesos: Record<string, number | null>;
}) {
  const hoy = new Date().toISOString().slice(0, 10);
  const vencido = (c: Cotizacion) => c.precio_hasta !== null && c.precio_hasta < hoy;

  const Boton = ({ c, ancho }: { c: Cotizacion; ancho?: boolean }) => (
    <button
      onClick={() => onElegir(c)}
      disabled={eligiendo !== null}
      className={`rounded-lg bg-[var(--primary)] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[var(--primary-dark)] disabled:opacity-50 ${ancho ? "w-full" : ""}`}
    >
      {eligiendo === c.id ? "Aprobando…" : "Aprobar con este"}
    </button>
  );

  const Diferencia = ({ c }: { c: Cotizacion }) => {
    const dif = diferenciaPorcentual(enPesos[c.id] ?? null, minimo);
    return dif ? (
      <span className="text-slate-500">{dif}</span>
    ) : (
      <span className="text-green-700">más barato</span>
    );
  };

  return (
    <>
      {/* Matriz — pantalla grande */}
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200">
              <th className="w-36 px-3 py-2"></th>
              {cotizaciones.map((c) => (
                <th key={c.id} className="px-3 py-2 text-left font-semibold text-slate-900">
                  {c.proveedores?.nombre ?? "—"}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            <Fila label="Marca" cs={cotizaciones} valor={(c) => c.marca ?? "—"} />
            <Fila label="Unitario" mono cs={cotizaciones} valor={(c) => monedaExacta(c.precio_unitario)} />
            <Fila label="Cantidad" mono cs={cotizaciones} valor={(c) => (c.cantidad === null ? "—" : String(c.cantidad))} />
            <Fila label="Descuento" mono cs={cotizaciones} valor={(c) => (c.descuento ? `${Math.round(c.descuento * 10000) / 100}%` : "—")} />
            <Fila label="IVA" mono cs={cotizaciones} valor={(c) => `${Math.round((c.iva ?? 0) * 10000) / 100}%`} />
            <Fila label="Envío" mono cs={cotizaciones} valor={(c) => monedaExacta(c.costo_envio)} />

            <tr className="bg-slate-50">
              <td className="px-3 py-2 font-semibold text-slate-700">Total</td>
              {cotizaciones.map((c) => (
                <td key={c.id} className="px-3 py-2 font-mono font-semibold text-slate-900">
                  <Importe c={c} enPesos={enPesos[c.id] ?? null} />
                </td>
              ))}
            </tr>
            <tr>
              <td className="px-3 py-2 text-slate-500">Diferencia</td>
              {cotizaciones.map((c) => (
                <td key={c.id} className="px-3 py-2 text-xs">
                  <Diferencia c={c} />
                </td>
              ))}
            </tr>

            <Fila label="Plazo de pago" cs={cotizaciones} valor={(c) => (c.plazo_pago_dias === null ? "—" : c.plazo_pago_dias === 0 ? "contado" : `${c.plazo_pago_dias} días`)} />
            <Fila label="Condiciones" cs={cotizaciones} valor={(c) => c.condiciones_pago ?? "—"} />
            <Fila label="Disponibilidad" cs={cotizaciones} valor={(c) => c.disponibilidad ?? "—"} />

            <tr>
              <td className="px-3 py-2 text-slate-500">Vale hasta</td>
              {cotizaciones.map((c) => (
                <td key={c.id} className={`px-3 py-2 ${vencido(c) ? "text-red-600" : "text-slate-600"}`}>
                  {fecha(c.precio_hasta)}
                  {vencido(c) && <span className="ml-1 text-xs">vencido</span>}
                </td>
              ))}
            </tr>

            <Fila label="Comentario" cs={cotizaciones} valor={(c) => c.comentario ?? "—"} />

            <tr>
              <td className="px-3 pt-3"></td>
              {cotizaciones.map((c) => (
                <td key={c.id} className="px-3 pt-3">
                  <Boton c={c} />
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>

      {/* Tarjetas — teléfono */}
      <div className="space-y-3 md:hidden">
        {cotizaciones.map((c) => (
          <div
            key={c.id}
            className={`rounded-xl border p-4 ${
              enPesos[c.id] !== null && enPesos[c.id] === minimo
                ? "border-[var(--primary)]"
                : "border-slate-200"
            }`}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="font-semibold text-slate-900">{c.proveedores?.nombre ?? "—"}</p>
                <p className="text-xs text-slate-500">{detalleCotizacion(c)}</p>
              </div>
              <div className="shrink-0 text-right">
                <p className="font-mono font-semibold text-slate-900">
                  <Importe c={c} enPesos={enPesos[c.id] ?? null} />
                </p>
                <p className="text-xs">
                  <Diferencia c={c} />
                </p>
              </div>
            </div>

            <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-slate-600">
              <Dato label="Pago" valor={c.plazo_pago_dias === null ? "—" : c.plazo_pago_dias === 0 ? "contado" : `${c.plazo_pago_dias} días`} />
              <Dato label="Disponibilidad" valor={c.disponibilidad ?? "—"} />
              <Dato
                label="Vale hasta"
                valor={`${fecha(c.precio_hasta)}${vencido(c) ? " · vencido" : ""}`}
                rojo={vencido(c)}
              />
              {c.condiciones_pago && <Dato label="Condiciones" valor={c.condiciones_pago} />}
            </dl>

            {c.comentario && <p className="mt-2 text-xs text-slate-500">{c.comentario}</p>}

            <div className="mt-3">
              <Boton c={c} ancho />
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

/** Una fila de la matriz: el atributo a la izquierda, un proveedor por columna. */
function Fila({
  label, cs, valor, mono,
}: {
  label: string;
  cs: Cotizacion[];
  valor: (c: Cotizacion) => string;
  mono?: boolean;
}) {
  return (
    <tr>
      <td className="px-3 py-2 text-slate-500">{label}</td>
      {cs.map((c) => (
        <td key={c.id} className={`px-3 py-2 text-slate-700 ${mono ? "font-mono" : ""}`}>
          {valor(c)}
        </td>
      ))}
    </tr>
  );
}

function Dato({ label, valor, rojo }: { label: string; valor: string; rojo?: boolean }) {
  return (
    <div>
      <dt className="text-slate-400">{label}</dt>
      <dd className={rojo ? "text-red-600" : ""}>{valor}</dd>
    </div>
  );
}
