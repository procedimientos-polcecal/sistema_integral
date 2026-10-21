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
 *
 * EL ANCHO VA EN EL ENVOLTORIO Y NO EN EL `input`, Y ESTO MORDIÓ
 *
 * `.input` de `app/globals.css` declara `width: 100%` **fuera de toda capa**, y
 * las utilidades de Tailwind v4 viven en `@layer utilities`. Entre una regla
 * sin capa y una con capa gana la que no tiene capa, pase lo que pase con la
 * especificidad. O sea que `className="input w-20"` **no mide 20**: mide el
 * 100% de la fila, y con `shrink-0` encima no cede.
 *
 * Eso es exactamente lo que pasaba acá hasta el 21/10/2026, medido sobre la
 * hoja renderizada: en el modal de 672 px, el campo de cantidad medía **624 px**
 * —la fila entera— y el del repuesto quedaba en **26 px empujado afuera de la
 * tarjeta**. No se veía ningún nombre de repuesto. Nada falla, nada avisa: es
 * la misma clase de trampa que un `grid-cols-3` sin breakpoint.
 *
 * Por eso cada campo va adentro de un `div` que lleva el ancho, y el `input`
 * se queda con su `width: 100%` llenándolo. **Un `.input` con una clase de
 * ancho al lado no sirve en este repo**; si aparece otro, es este mismo error.
 *
 * EN EL TELÉFONO SE APILAN
 *
 * Lado a lado en 295 px útiles —375 menos los paddings del modal— el repuesto
 * se queda con 124 px y "rodamiento 22217 EK" no entra. Así que de `sm` para
 * arriba van lado a lado, y abajo de eso el repuesto toma la fila entera y la
 * cantidad cae debajo, con sus 80 px. Los rótulos de columna se esconden ahí:
 * apilados mentirían sobre qué columna es cuál, y los placeholders ya lo dicen.
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

  /* El × aparece recién con dos renglones, así que la columna del botón existe
     o no existe, y los rótulos tienen que correrse con ella. */
  const hayBoton = lineas.length > 1;

  return (
    <div className="space-y-2">
      {/* Los rótulos de columna, una sola vez y no por renglón. El placeholder
          se va cuando se escribe, y entonces nada dice cuál campo es cuál. */}
      <div className="hidden gap-2 sm:flex">
        <div className="min-w-0 flex-1 text-xs font-medium text-slate-500">Repuesto</div>
        <div className="w-20 shrink-0 text-xs font-medium text-slate-500">Cantidad</div>
        {hayBoton && <div className="w-7 shrink-0" aria-hidden="true" />}
      </div>

      {lineas.map((l, i) => (
        <div key={i} className="flex flex-wrap gap-2 sm:flex-nowrap">
          <div className="w-full sm:min-w-0 sm:flex-1">
            <input
              value={l.nombre}
              onChange={(e) => cambiar(i, "nombre", e.target.value)}
              disabled={deshabilitado}
              className="input"
              placeholder="Ej: rodamientos 22212"
              aria-label={`Repuesto ${i + 1}`}
            />
          </div>
          <div className="w-20 shrink-0">
            <input
              value={l.cantidad}
              onChange={(e) => cambiar(i, "cantidad", e.target.value)}
              disabled={deshabilitado}
              className="input"
              placeholder="Cant."
              aria-label={`Cantidad del repuesto ${i + 1}`}
            />
          </div>
          {/* Con un solo renglón no se muestra: sacarlo dejaría la lista vacía
              y el formulario sin dónde escribir. */}
          {hayBoton && (
            <button
              type="button"
              onClick={() => onCambiar(lineas.filter((_, n) => n !== i))}
              disabled={deshabilitado}
              className="w-7 shrink-0 text-slate-400 transition-colors hover:text-red-600"
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
