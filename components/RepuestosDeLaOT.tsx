"use client";

import type { LineaDeRepuesto } from "@/lib/mantenimiento/repuestosDeLaOT";

/**
 * Los repuestos de una OT, renglón por renglón.
 *
 * POR QUÉ ES UN COMPONENTE Y NO ESTÁ ESCRITO DOS VECES
 *
 * Las dos pantallas que crean una OT —`NuevaOTModal` y el formulario de carga
 * sin señal— duplican sus campos **a propósito**: el modal vive dentro de la
 * pantalla de órdenes, que trae sus datos del servidor, y no se puede dibujar
 * sin conexión. Eso está bien para un `<input>` suelto.
 *
 * Esto no es un input suelto: son dos campos, un botón que agrega, uno que
 * saca, y la regla de cuándo se puede sacar. El 19/10/2026 se cambió en el
 * modal y el formulario sin señal quedó con el campo viejo de texto libre —o
 * sea que la misma OT se cargaba de dos formas distintas según de dónde—. La
 * duplicación de campos sueltos se nota; la de una lista con comportamiento,
 * no.
 */
export default function RepuestosDeLaOT({
  lineas,
  onCambiar,
  deshabilitado = false,
}: {
  lineas: LineaDeRepuesto[];
  onCambiar: (lineas: LineaDeRepuesto[]) => void;
  deshabilitado?: boolean;
}) {
  const cambiar = (i: number, campo: "cantidad" | "nombre", valor: string) =>
    onCambiar(lineas.map((l, n) => (n === i ? { ...l, [campo]: valor } : l)));

  return (
    <div className="space-y-2">
      {lineas.map((l, i) => (
        /*
         * `flex` y no una grilla de tres columnas: en los 343 px útiles de un
         * teléfono, tres columnas iguales dan 114 px cada una y ahí no entra
         * el nombre de un repuesto. Así la cantidad se queda en sus 80 px y el
         * nombre se lleva el resto.
         */
        <div key={i} className="flex gap-2">
          <input
            value={l.cantidad}
            onChange={(e) => cambiar(i, "cantidad", e.target.value)}
            disabled={deshabilitado}
            className="input w-20 shrink-0"
            placeholder="Cant."
            aria-label={`Cantidad del repuesto ${i + 1}`}
          />
          <input
            value={l.nombre}
            onChange={(e) => cambiar(i, "nombre", e.target.value)}
            disabled={deshabilitado}
            className="input min-w-0 flex-1"
            placeholder="Ej: rodamientos 22212"
            aria-label={`Repuesto ${i + 1}`}
          />
          {/* Con un solo renglón no se muestra: sacarlo dejaría la lista vacía
              y el formulario sin dónde escribir. */}
          {lineas.length > 1 && (
            <button
              type="button"
              onClick={() => onCambiar(lineas.filter((_, n) => n !== i))}
              disabled={deshabilitado}
              className="shrink-0 px-2 text-slate-400 transition-colors hover:text-red-600"
              title="Sacar este repuesto"
            >
              ×
            </button>
          )}
        </div>
      ))}
      <button
        type="button"
        onClick={() => onCambiar([...lineas, { cantidad: "", nombre: "" }])}
        disabled={deshabilitado}
        className="text-sm font-medium text-blue-600 hover:text-blue-700 disabled:text-slate-400"
      >
        + Agregar otro repuesto
      </button>
    </div>
  );
}
