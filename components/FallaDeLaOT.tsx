"use client";

import Select from "@/components/Select";
import { MODOS_DE_FALLA, CAUSAS_DE_FALLA, opcionesConLaActual } from "@/lib/mantenimiento/fallas";

/**
 * La falla que tuvo el equipo, al cerrar una OT.
 *
 * POR QUÉ ES UN COMPONENTE Y NO ESTÁ ESCRITO TRES VECES
 *
 * Lo cargan las tres pantallas por las que una orden queda realizada —el modal
 * de registrar el trabajo, la OT nueva que nace cerrada y el formulario sin
 * señal—, y el 19/10/2026 ya se pagó lo contrario: los repuestos por renglones
 * se agregaron al modal y el formulario sin señal quedó con el campo viejo, así
 * que **la misma OT se cargaba distinto según de dónde**. Un `<input>` suelto
 * duplicado se nota; dos listas de ocho que se desincronizan, no.
 *
 * LOS TRES CAMPOS SON OPCIONALES
 *
 * No toda OT tiene una falla que contar —un preventivo donde no hubo nada, un
 * trabajo de mejora—, y el campo vacío es una respuesta. Lo que no hay es
 * "Otro": si la falla no entra en ninguna de las dos listas, se deja el
 * desplegable vacío y se escribe el detalle, que igual cuenta en el ranking
 * como «Sin clasificar».
 *
 * LA CLAVE QUE YA NO ESTA EN LA LISTA SE MUESTRA IGUAL
 *
 * `opcionesConLaActual` agrega al desplegable el valor que la orden ya tiene
 * cuando el vocabulario dejo de tenerlo. Sin eso el campo se ve vacio con el
 * valor viejo todavia en el estado, y al guardar sale un 400 por algo que en
 * pantalla parecia no tener nada.
 *
 * EL ANCHO VA EN EL ENVOLTORIO
 *
 * `.input` de globals.css declara `width: 100%` **fuera de toda capa** y le
 * gana a cualquier `w-*` de Tailwind, que vive en `@layer utilities`. Acá no
 * hace falta ningún ancho fijo —las dos columnas se reparten la fila— pero si
 * alguna vez hace falta uno, va en un `div` que envuelva al campo y no como
 * clase al lado de `input`. Está contado en CLAUDE.md.
 */
export interface LaFalla {
  /** Las tres claves son las de la base: el cuerpo viaja sin traducir nada. */
  falla_modo: string;
  falla_causa: string;
  falla_detalle: string;
}

export const FALLA_VACIA: LaFalla = { falla_modo: "", falla_causa: "", falla_detalle: "" };

export default function FallaDeLaOT({
  falla,
  onCambiar,
  deshabilitado = false,
}: {
  falla: LaFalla;
  onCambiar: (falla: LaFalla) => void;
  deshabilitado?: boolean;
}) {
  const cambiar = (campo: keyof LaFalla, valor: string) =>
    onCambiar({ ...falla, [campo]: valor });

  return (
    <div className="space-y-2 rounded-xl border border-slate-200 bg-slate-50/60 p-3">
      <p className="text-xs font-semibold text-slate-600">
        La falla, si la hubo
        <span className="ml-1 font-normal text-slate-400">· opcional</span>
      </p>

      {/* Apilados en el teléfono: dos desplegables con estas etiquetas no
          entran en los 295 px útiles de un 375. */}
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <label className="block space-y-1">
          <span className="block text-xs font-medium text-slate-500">Qué le pasó</span>
          <Select
            value={falla.falla_modo}
            onChange={(e) => cambiar("falla_modo", e.target.value)}
            disabled={deshabilitado}
            className="input"
          >
            <option value="">—</option>
            {opcionesConLaActual(MODOS_DE_FALLA, falla.falla_modo).map((m) => (
              <option key={m.clave} value={m.clave}>{m.etiqueta}</option>
            ))}
          </Select>
        </label>

        <label className="block space-y-1">
          <span className="block text-xs font-medium text-slate-500">Por qué</span>
          <Select
            value={falla.falla_causa}
            onChange={(e) => cambiar("falla_causa", e.target.value)}
            disabled={deshabilitado}
            className="input"
          >
            <option value="">—</option>
            {opcionesConLaActual(CAUSAS_DE_FALLA, falla.falla_causa).map((c) => (
              <option key={c.clave} value={c.clave}>{c.etiqueta}</option>
            ))}
          </Select>
        </label>
      </div>

      <label className="block space-y-1">
        <span className="block text-xs font-medium text-slate-500">Detalle</span>
        <input
          value={falla.falla_detalle}
          onChange={(e) => cambiar("falla_detalle", e.target.value)}
          disabled={deshabilitado}
          className="input"
          placeholder="Ej: eje del lado motor"
        />
      </label>
    </div>
  );
}
