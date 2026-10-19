"use client";

import { useState } from "react";
import Select from "@/components/Select";
import { URGENCIAS } from "@/lib/mantenimiento/avisos";
import { borradorDesdeElCuerpo } from "@/lib/mantenimiento/borradorDeCarga";
import type { EquipoDelCatalogo, SectorDelCatalogo } from "./catalogos";
import { CartelDelResultado, loQueDijo, type Resultado } from "./envio";

/**
 * Cargar un aviso desde la pantalla que anda sin señal.
 *
 * TIENE LOS MISMOS CAMPOS QUE `NuevoAvisoModal` Y CONVIVE CON ÉL, que es una
 * decisión del plan y no un descuido: el modal vive dentro de la pantalla de
 * avisos, que trae sus datos del servidor y los usa para más cosas que cargar,
 * así que no se puede dibujar sin conexión. El riesgo —dos formularios para lo
 * mismo se van separando— queda anotado en el spec, y la salida, si molesta, es
 * que el modal pase a usar este componente y no al revés.
 *
 * Las dos diferencias con el modal son las que impone no tener servidor: los
 * desplegables salen de lo que quedó guardado en el teléfono, y quién manda la
 * carga —a la ruta o a la cola— lo decide `CargarClient`, que es el único que
 * sabe si hay señal.
 */

/** Con qué arranca el formulario, y a qué vuelve después de cargar. */
const VACIO = {
  equipo_raw: "",
  sector_raw: "",
  sector_id: "",
  descripcion: "",
  urgencia: URGENCIAS[1] as string,
  quien_aviso: "",
  observaciones: "",
};
/**
 * Cómo viaja un equipo en `equipo_raw`. Está en una función porque se usa para
 * armarlo y para reconocerlo al editar: dos formas distintas de escribirlo
 * harían que editar una carga perdiera el equipo sin decir nada.
 */
function comoSeEscribe(equipo: EquipoDelCatalogo): string {
  return `${equipo.code ?? ""} ${equipo.name}`.trim();
}

export default function FormularioAvisoOffline({
  equipos,
  sectores,
  deshabilitado,
  borrador,
  onMandar,
}: {
  equipos: EquipoDelCatalogo[];
  sectores: SectorDelCatalogo[];
  /** Sin dónde guardar o sin saber de quién sería la carga, no se acepta nada. */
  deshabilitado: boolean;
  /**
   * El cuerpo de una carga parada que se está editando. `CargarClient` remonta
   * este componente con `key` cuando cambia, así que esto se lee una sola vez.
   */
  borrador?: Record<string, unknown> | null;
  onMandar: (cuerpo: Record<string, unknown>) => Promise<Resultado>;
}) {
  const [mandando, setMandando] = useState(false);
  const [error, setError] = useState("");
  const [resultado, setResultado] = useState<Resultado | null>(null);

  const [campos, setCampos] = useState(() => borradorDesdeElCuerpo(VACIO, borrador));

  // Cuál equipo está elegido, que el cuerpo del aviso no lleva: la ruta espera
  // `equipo_raw` en texto. Se guarda aparte para que el desplegable sea
  // controlado y **se vacíe junto con el resto** después de cargar; sin esto
  // seguiría mostrando el equipo anterior sobre un formulario en blanco.
  //
  // Y por eso al editar una carga parada hay que **volver a buscarlo**: el
  // cuerpo guardado tiene el texto y no el id. Se compara contra el mismo texto
  // que arma `elegirEquipo`, así que si no aparece es porque ese equipo ya no
  // está en el catálogo — ahí el desplegable queda vacío y el `equipo_raw`
  // guardado viaja igual, que es lo que la ruta mira.
  const [equipoElegido, setEquipoElegido] = useState(
    () => equipos.find((e) => comoSeEscribe(e) === String(borrador?.equipo_raw ?? ""))?.id ?? "",
  );

  const set = (clave: string, valor: string) =>
    setCampos((c) => ({ ...c, [clave]: valor }));

  /** Al elegir el equipo se completa el sector: la máquina sabe dónde está. */
  function elegirEquipo(id: string) {
    setEquipoElegido(id);
    const equipo = equipos.find((e) => e.id === id);
    if (!equipo) {
      set("equipo_raw", "");
      return;
    }
    setCampos((c) => ({
      ...c,
      equipo_raw: comoSeEscribe(equipo),
      sector_id: equipo.sector_id ?? c.sector_id,
      sector_raw: sectores.find((s) => s.id === equipo.sector_id)?.nombre ?? c.sector_raw,
    }));
  }

  async function cargar() {
    if (!campos.descripcion.trim()) {
      setError("Contá qué pasa.");
      return;
    }
    setMandando(true);
    setError("");
    setResultado(null);

    try {
      const salida = await onMandar({ ...campos, sector_id: campos.sector_id || null });
      setResultado(salida);
      // El formulario se vacía salvo cuando la carga se rechazó: ahí lo escrito
      // es lo único que hay, y borrarlo obligaría a tipear todo de nuevo para
      // corregir una coma.
      if (salida.estado !== "rechazada") {
        setCampos(VACIO);
        setEquipoElegido("");
      }
    } catch (e) {
      // Nada de acá debería tirar, pero si tira —`crypto.randomUUID` en un
      // contexto inseguro, por ejemplo— el aviso no puede quedarse en la
      // consola: la persona tiene que saber que no se cargó.
      setError(`No se pudo cargar el aviso: ${loQueDijo(e)}`);
    } finally {
      setMandando(false);
    }
  }

  return (
    <div className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4">
      <p className="text-xs text-slate-500">
        El número se lo pone el sistema, siguiendo el último de la planilla.
      </p>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}
      <CartelDelResultado tipo="aviso" resultado={resultado} />

      <label className="block space-y-1">
        <span className="block text-xs font-medium text-slate-600">Qué pasa</span>
        <textarea
          value={campos.descripcion}
          onChange={(e) => set("descripcion", e.target.value)}
          rows={3}
          disabled={deshabilitado}
          placeholder="Pierde aceite por el retén del reductor"
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
        />
      </label>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="block space-y-1">
          <span className="block text-xs font-medium text-slate-600">Equipo</span>
          <Select
            value={equipoElegido}
            onChange={(e) => elegirEquipo(e.target.value)}
            disabled={deshabilitado}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          >
            <option value="">Sin equipo</option>
            {equipos.map((e) => (
              <option key={e.id} value={e.id}>
                {e.code ? `${e.code} — ` : ""}
                {e.name}
              </option>
            ))}
          </Select>
        </label>

        <label className="block space-y-1">
          <span className="block text-xs font-medium text-slate-600">Sector</span>
          <Select
            value={campos.sector_id}
            onChange={(e) => {
              set("sector_id", e.target.value);
              set("sector_raw", sectores.find((s) => s.id === e.target.value)?.nombre ?? "");
            }}
            disabled={deshabilitado}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          >
            <option value="">Sin sector</option>
            {sectores.map((s) => (
              <option key={s.id} value={s.id}>
                {s.codigo ? `${s.codigo} — ` : ""}
                {s.nombre}
              </option>
            ))}
          </Select>
        </label>

        <label className="block space-y-1">
          <span className="block text-xs font-medium text-slate-600">Urgencia</span>
          <Select
            value={campos.urgencia}
            onChange={(e) => set("urgencia", e.target.value)}
            disabled={deshabilitado}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          >
            {URGENCIAS.map((u) => (
              <option key={u} value={u}>
                {u}
              </option>
            ))}
          </Select>
        </label>

        <label className="block space-y-1">
          <span className="block text-xs font-medium text-slate-600">Quién avisa</span>
          <input
            value={campos.quien_aviso}
            onChange={(e) => set("quien_aviso", e.target.value)}
            disabled={deshabilitado}
            placeholder="Tu nombre"
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
        </label>
      </div>

      <label className="block space-y-1">
        <span className="block text-xs font-medium text-slate-600">Observaciones</span>
        <input
          value={campos.observaciones}
          onChange={(e) => set("observaciones", e.target.value)}
          disabled={deshabilitado}
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
        />
      </label>

      <button
        onClick={cargar}
        disabled={deshabilitado || mandando}
        className="w-full rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
      >
        {mandando ? "Cargando…" : "Cargar el aviso"}
      </button>
    </div>
  );
}
