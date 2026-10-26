"use client";

import { useState } from "react";
import { useCargar } from "@/lib/core/useCargar";
import type { Insumo } from "@/lib/mantenimiento/stock";
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
 *
 * ── BUSCAR EN EL INVENTARIO ES OPCIONAL, Y ESO NO ES UN DESCUIDO ────────────
 *
 * Desde el 26/10/2026 el campo del repuesto puede autocompletar contra el
 * inventario, con la misma lógica que «Repuestos que hacen falta»: a partir de
 * tres letras, con 300 ms de espera, y eligiendo de la lista queda puesto
 * también el **código**, que es para lo que sirve buscar — con el código
 * después se sabe si hay stock sin adivinar por el nombre.
 *
 * **Lo enciende `NuevaOTModal` y no el formulario sin señal.** Allá no hay a
 * quién preguntarle: esa pantalla existe para cargar parado en la planta sin
 * conexión, y un buscador que a veces contesta y a veces no es peor que no
 * tenerlo, porque quien lo usa no sabe si "no aparece nada" quiere decir que no
 * está o que no se pudo buscar. Esa distinción es justamente la que el modal de
 * repuestos tuvo que aprender a hacer.
 */
export default function RepuestosDeLaOT({
  lineas,
  onCambiar,
  deshabilitado = false,
  buscarEnInventario = false,
}: {
  lineas: LineaDeRepuesto[];
  onCambiar: (lineas: LineaDeRepuesto[]) => void;
  deshabilitado?: boolean;
  /** Autocompletar contra el inventario. Ver el encabezado: va apagado. */
  buscarEnInventario?: boolean;
}) {
  const cambiar = (i: number, cambios: Partial<LineaDeRepuesto>) =>
    onCambiar(lineas.map((l, n) => (n === i ? { ...l, ...cambios } : l)));

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
        <Renglon
          key={i}
          linea={l}
          indice={i}
          deshabilitado={deshabilitado}
          buscar={buscarEnInventario}
          hayBoton={hayBoton}
          onCambiar={(cambios) => cambiar(i, cambios)}
          onSacar={() => onCambiar(lineas.filter((_, n) => n !== i))}
        />
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

/**
 * Un renglón, con su propia búsqueda.
 *
 * Es un componente y no JSX adentro del `.map()` **porque cada renglón tiene
 * que buscar por su cuenta**: su texto, sus sugerencias y su aviso. Un hook no
 * puede vivir adentro de un `map`, y un estado compartido por todos los
 * renglones haría que escribir en el segundo le abra la lista al primero.
 */
function Renglon({
  linea, indice, deshabilitado, buscar, hayBoton, onCambiar, onSacar,
}: {
  linea: LineaDeRepuesto;
  indice: number;
  deshabilitado: boolean;
  buscar: boolean;
  hayBoton: boolean;
  onCambiar: (cambios: Partial<LineaDeRepuesto>) => void;
  onSacar: () => void;
}) {
  const [sugerencias, setSugerencias] = useState<Insumo[]>([]);
  const [aviso, setAviso] = useState("");
  /* Mientras se elige de la lista no se vuelve a buscar: el click escribe el
     nombre de la sugerencia, y sin esto esa escritura abriría la lista otra
     vez encima de lo que se acaba de elegir. */
  const [elegido, setElegido] = useState(false);

  // La misma lógica que el modal de «Repuestos que hacen falta»: a partir de
  // tres letras —con dos, el inventario entero es una sugerencia— y con 300 ms
  // de espera para no pedir una vez por tecla.
  useCargar(async (vigente) => {
    if (!buscar || elegido || linea.nombre.trim().length < 3) {
      setSugerencias([]);
      return;
    }

    await new Promise((r) => setTimeout(r, 300));
    if (!vigente()) return;

    const res = await fetch(
      `/api/mantenimiento/inventario?q=${encodeURIComponent(linea.nombre.trim())}`
    );
    const body = await res.json().catch(() => ({}));
    if (!vigente()) return;

    // Que no se pueda buscar **se dice**. Callarlo deja a quien escribe sin
    // forma de distinguir "no hay ningún repuesto así" de "no se pudo
    // consultar", que es el bug que este mismo buscador ya tuvo del otro lado.
    if (!res.ok) { setAviso("No se pudo buscar en el inventario."); return; }

    setAviso(
      body.error ?? (body.cargado === false ? "El inventario todavía no se importó." : "")
    );
    setSugerencias(body.data ?? []);
  }, [buscar, elegido, linea.nombre]);

  /**
   * Escribir a mano **borra el código**.
   *
   * Si alguien elige "Rodamiento 6206" y después corrige el texto a "6207", el
   * código de la primera pieza quedaría pegado a la segunda. Es exactamente el
   * enlace equivocado que la regla de la casa evita: no se nota nunca, porque
   * el dato aparece en el lugar que no es.
   */
  const escribir = (nombre: string) => {
    setElegido(false);
    onCambiar(linea.codigo ? { nombre, codigo: "" } : { nombre });
  };

  return (
    <div className="flex flex-wrap gap-2 sm:flex-nowrap">
      <div className="relative w-full sm:min-w-0 sm:flex-1">
        <input
          value={linea.nombre}
          onChange={(e) => escribir(e.target.value)}
          disabled={deshabilitado}
          className="input"
          placeholder="Ej: rodamientos 22212"
          aria-label={`Repuesto ${indice + 1}`}
          autoComplete="off"
        />

        {/* El código, cuando salió de la búsqueda. Se muestra porque es la
            única señal de que este renglón quedó enlazado al pañol: sin verlo,
            dos renglones que dicen lo mismo son indistinguibles. */}
        {linea.codigo && (
          <p className="mt-1 font-mono text-xs text-slate-400">{linea.codigo}</p>
        )}
        {aviso && <p className="mt-1 text-xs text-amber-700">{aviso}</p>}

        {sugerencias.length > 0 && (
          <ul className="absolute z-10 mt-1 max-h-48 w-full overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-lg">
            {sugerencias.map((s, n) => (
              <li key={n}>
                <button
                  type="button"
                  onClick={() => {
                    setElegido(true);
                    setSugerencias([]);
                    onCambiar({ nombre: s.descripcion ?? "", codigo: s.codigo ?? "" });
                  }}
                  className="block w-full px-3 py-1.5 text-left text-sm hover:bg-slate-50"
                >
                  <span className="text-slate-800">{s.descripcion}</span>
                  {s.codigo && <span className="ml-1.5 font-mono text-xs text-slate-400">{s.codigo}</span>}
                  {s.stock !== null && <span className="ml-1.5 text-xs text-slate-400">· {s.stock}</span>}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="w-20 shrink-0">
        <input
          value={linea.cantidad}
          onChange={(e) => onCambiar({ cantidad: e.target.value })}
          disabled={deshabilitado}
          className="input"
          placeholder="Cant."
          aria-label={`Cantidad del repuesto ${indice + 1}`}
        />
      </div>

      {/* Con un solo renglón no se muestra: sacarlo dejaría la lista vacía
          y el formulario sin dónde escribir. */}
      {hayBoton && (
        <button
          type="button"
          onClick={onSacar}
          disabled={deshabilitado}
          className="w-7 shrink-0 text-slate-400 transition-colors hover:text-red-600"
          title="Sacar este repuesto"
        >
          ×
        </button>
      )}
    </div>
  );
}
