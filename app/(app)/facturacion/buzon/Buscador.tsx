"use client";

import { useEffect, useMemo, useRef, useState } from "react";

/**
 * Un campo donde se escribe para buscar, en vez de un desplegable.
 *
 * Existe porque los tres catálogos de una línea de factura son largos: 378
 * productos, 242 cuentas contables y 358 cuentas analíticas por empresa. En un
 * `<select>` eso son cientos de opciones que hay que recorrer con la rueda, y
 * quien carga sabe lo que busca —"repuestos", "EM6", "conductor"— pero no en qué
 * posición de la lista está.
 *
 * La búsqueda es por **partes sueltas**: escribir `cat 950` encuentra
 * `EM6 - CATERPILLAR 950 G`, y `rep` encuentra `5.2.1.01.220 Repuestos`. Cada
 * palabra tiene que aparecer en algún lado, no todas juntas ni en orden: nadie
 * recuerda el nombre exacto de una cuenta analítica.
 */

export interface Opcion {
  id: number;
  /** Lo que se muestra y sobre lo que se busca. */
  texto: string;
  /** Para agrupar visualmente: el plan analítico, por ejemplo. */
  grupo?: string | null;
}

/** Cuántas se muestran. Más que esto no se lee: se escribe una letra más. */
const MAXIMO = 40;

function coincide(opcion: Opcion, partes: string[]): boolean {
  const texto = `${opcion.texto} ${opcion.grupo ?? ""}`.toLowerCase();
  return partes.every((p) => texto.includes(p));
}

export default function Buscador({
  etiqueta,
  opciones,
  valor,
  textoDelValor,
  deshabilitado,
  vacio = "— sin elegir —",
  onElegir,
}: {
  etiqueta: React.ReactNode;
  opciones: Opcion[];
  valor: number | null;
  /** Lo que se muestra cuando hay valor pero el catálogo no lo tiene. */
  textoDelValor?: string | null;
  deshabilitado?: boolean;
  vacio?: string;
  onElegir: (opcion: Opcion | null) => void;
}) {
  const [abierto, setAbierto] = useState(false);
  const [busqueda, setBusqueda] = useState("");
  const caja = useRef<HTMLDivElement>(null);

  const elegida = useMemo(
    () => opciones.find((o) => o.id === valor) ?? null,
    [opciones, valor]
  );

  /*
   * Cerrar al hacer clic afuera. Sin esto, abrir el buscador de una línea y
   * después el de otra deja los dos abiertos y la pantalla se vuelve ilegible.
   */
  useEffect(() => {
    if (!abierto) return;
    const alClic = (e: MouseEvent) => {
      if (caja.current && !caja.current.contains(e.target as Node)) setAbierto(false);
    };
    document.addEventListener("mousedown", alClic);
    return () => document.removeEventListener("mousedown", alClic);
  }, [abierto]);

  const partes = busqueda.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const encontradas = partes.length
    ? opciones.filter((o) => coincide(o, partes))
    : opciones;
  const aMostrar = encontradas.slice(0, MAXIMO);

  const loQueSeVe = elegida?.texto ?? textoDelValor ?? null;

  return (
    <div className="relative" ref={caja}>
      <span className="block text-[10px] uppercase tracking-wide text-slate-400">{etiqueta}</span>

      <button
        type="button"
        disabled={deshabilitado}
        onClick={() => {
          setBusqueda("");
          setAbierto((a) => !a);
        }}
        className={`mt-0.5 w-full truncate rounded border border-slate-300 px-2 py-1 text-left text-xs disabled:bg-slate-50 ${
          loQueSeVe ? "text-slate-800" : "text-slate-400"
        }`}
      >
        {loQueSeVe ?? vacio}
      </button>

      {abierto && (
        <div className="absolute z-20 mt-1 w-full min-w-[16rem] rounded-lg border border-slate-300 bg-white shadow-lg">
          <input
            autoFocus
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            placeholder="Escribí para buscar…"
            className="w-full rounded-t-lg border-b border-slate-200 px-2 py-1.5 text-xs outline-none"
          />

          <ul className="max-h-56 overflow-y-auto py-1">
            {valor !== null && (
              <li>
                <button
                  type="button"
                  onClick={() => {
                    onElegir(null);
                    setAbierto(false);
                  }}
                  className="w-full px-2 py-1 text-left text-xs text-slate-400 hover:bg-slate-50"
                >
                  {vacio}
                </button>
              </li>
            )}

            {aMostrar.map((o, i) => (
              <li key={o.id}>
                {/* El grupo se escribe una sola vez, cuando cambia: con 358
                    analíticas repetir "EQUIPOS MÓVILES" en cada fila es ruido. */}
                {o.grupo && o.grupo !== aMostrar[i - 1]?.grupo && (
                  <div className="px-2 pt-1 text-[10px] uppercase tracking-wide text-slate-400">
                    {o.grupo}
                  </div>
                )}
                <button
                  type="button"
                  onClick={() => {
                    onElegir(o);
                    setAbierto(false);
                  }}
                  className={`w-full px-2 py-1 text-left text-xs hover:bg-slate-100 ${
                    o.id === valor ? "bg-slate-100 font-medium" : "text-slate-700"
                  }`}
                >
                  {o.texto}
                </button>
              </li>
            ))}

            {encontradas.length === 0 && (
              <li className="px-2 py-2 text-xs text-slate-400">No hay ninguna que coincida.</li>
            )}
            {encontradas.length > MAXIMO && (
              <li className="px-2 py-1 text-[10px] text-slate-400">
                y {encontradas.length - MAXIMO} más: escribí una letra más para achicar la lista.
              </li>
            )}
          </ul>
        </div>
      )}
    </div>
  );
}
