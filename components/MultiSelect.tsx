"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { norm } from "@/lib/compras/texto";

/** Cada opción: el valor que viaja al filtro y cómo se lee en pantalla. */
export type OpcionMulti = [valor: string, etiqueta: string];

/** Desde cuántas opciones un desplegable deja de recorrerse con la vista. */
const CON_BUSCADOR_DESDE = 10;

/** Lo que mide la ventanita: 16rem. Hace falta saberlo para ver si entra. */
const ANCHO_PANEL = 256;

/**
 * Un filtro que acepta varios valores a la vez.
 *
 * Los desplegables del listado dejaban elegir un solo valor, y eso obligaba a
 * mirar en dos pasadas lo que es una sola pregunta: «qué hay en Cotizando y en
 * Para comprar» o «qué se le compró a estos tres proveedores». Acá se tildan
 * los que hagan falta y el filtro los suma con un «o».
 *
 * Se ve como el desplegable que reemplaza —conviven ocho en la misma fila y
 * desentonaría— pero con el resumen adentro: cerrado tiene que decir qué está
 * puesto, porque una lista filtrada que se lee como vacía es el peor final para
 * un filtro.
 */
export default function MultiSelect({
  valores, onCambio, vacio, plural, opciones, buscador,
}: {
  /** Los valores tildados. Vacío es "no filtrar por esto". */
  valores: string[];
  onCambio: (valores: string[]) => void;
  /** Cómo se lee sin nada tildado: "Todas las áreas". */
  vacio: string;
  /** El sustantivo del resumen cuando hay varios: "áreas" → "3 áreas". */
  plural: string;
  opciones: OpcionMulti[];
  /**
   * Si hay campo para buscar. Por defecto, cuando la lista es larga: los 273
   * proveedores no se recorren con la rueda del mouse, y las cinco prioridades
   * no necesitan que se escriba nada.
   */
  buscador?: boolean;
}) {
  const [abierto, setAbierto] = useState(false);
  const [texto, setTexto] = useState("");
  const [haciaLaIzquierda, setHaciaLaIzquierda] = useState(false);
  const caja = useRef<HTMLDivElement>(null);

  const conBuscador = buscador ?? opciones.length >= CON_BUSCADOR_DESDE;

  const tildados = useMemo(() => new Set(valores), [valores]);

  // La misma normalización que el resto del módulo: sin acentos ni mayúsculas,
  // así que "olavarria" encuentra "Bolsas Olavarría".
  const coincidencias = useMemo(() => {
    const q = norm(texto);
    if (!q) return opciones;
    // Lo que ya está tildado no se esconde al escribir: si no, destildarlo
    // exige borrar la búsqueda primero, y no se ve cuántos quedan puestos.
    return opciones.filter(([v, label]) => tildados.has(v) || norm(label).includes(q));
  }, [opciones, texto, tildados]);

  // Tocar fuera cierra. Los cambios ya se aplicaron —cada tilde filtra al
  // instante—, así que cerrar no confirma nada: no hace falta un botón.
  useEffect(() => {
    if (!abierto) return;
    const alTocar = (e: MouseEvent) => {
      if (caja.current && !caja.current.contains(e.target as Node)) cerrar();
    };
    document.addEventListener("mousedown", alTocar);
    return () => document.removeEventListener("mousedown", alTocar);
  }, [abierto]);

  function cerrar() {
    setAbierto(false);
    setTexto("");
  }

  /**
   * En un teléfono la fila de filtros tiene dos columnas, y la ventanita de los
   * de la derecha se salía de la pantalla: quedaba la mitad de cada nombre y no
   * había forma de traerla. Se mide al abrir y se ancla del otro lado.
   */
  function abrir() {
    const r = caja.current?.getBoundingClientRect();
    if (r) setHaciaLaIzquierda(r.left + ANCHO_PANEL > window.innerWidth - 8);
    setAbierto(true);
  }

  function alternar(valor: string) {
    onCambio(
      tildados.has(valor) ? valores.filter((v) => v !== valor) : [...valores, valor]
    );
  }

  // Con uno solo se dice cuál, que es lo que se quiere saber; con varios, la
  // cuenta. Poner los tres nombres no entra en el ancho de un desplegable y se
  // corta justo donde importa.
  const resumen =
    valores.length === 0
      ? vacio
      : valores.length === 1
        ? opciones.find(([v]) => v === valores[0])?.[1] ?? vacio
        : `${valores.length} ${plural}`;

  return (
    <div ref={caja} className="relative">
      <button
        type="button"
        aria-expanded={abierto}
        aria-haspopup="true"
        onClick={() => (abierto ? cerrar() : abrir())}
        className={`flex w-full items-center gap-1 rounded-lg border px-2 py-2 text-left text-sm ${
          valores.length > 0
            ? "border-[var(--primary)] bg-[var(--primary)]/5 text-slate-900"
            : "border-slate-300 text-slate-700"
        }`}
      >
        <span className="flex-1 truncate">{resumen}</span>
        <svg
          aria-hidden
          width="14" height="14" viewBox="0 0 24 24"
          fill="none" stroke="currentColor" strokeWidth="2"
          className="shrink-0 text-slate-400"
          style={{ transform: abierto ? "rotate(180deg)" : "none" }}
        >
          <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {abierto && (
        // Más ancho que el botón: en un teléfono la fila de filtros tiene dos
        // columnas de 160 px y ahí no se lee "AMB-EM — Autoelevador XCMG".
        <div
          onKeyDown={(e) => { if (e.key === "Escape") cerrar(); }}
          className={`absolute z-30 mt-1 w-64 max-w-[calc(100vw-2rem)] rounded-lg border border-slate-200 bg-white shadow-lg ${
            haciaLaIzquierda ? "right-0" : "left-0"
          }`}
        >
          {conBuscador && (
            <div className="border-b border-slate-100 p-2">
              <input
                autoFocus
                className="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
                placeholder="Buscar…"
                value={texto}
                onChange={(e) => setTexto(e.target.value)}
              />
            </div>
          )}

          <div role="group" className="max-h-64 overflow-y-auto py-1">
            {coincidencias.length === 0 ? (
              <p className="px-3 py-2 text-sm text-slate-400">Nada con ese nombre.</p>
            ) : (
              coincidencias.map(([valor, etiqueta]) => (
                <label
                  key={valor}
                  className="flex cursor-pointer items-start gap-2 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
                >
                  <input
                    type="checkbox"
                    className="mt-0.5 shrink-0 accent-[var(--primary)]"
                    checked={tildados.has(valor)}
                    onChange={() => alternar(valor)}
                  />
                  <span>{etiqueta}</span>
                </label>
              ))
            )}
          </div>

          {valores.length > 0 && (
            <div className="border-t border-slate-100 p-2">
              <button
                type="button"
                onClick={() => onCambio([])}
                className="text-xs text-slate-500 underline hover:text-slate-800"
              >
                Quitar este filtro
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
