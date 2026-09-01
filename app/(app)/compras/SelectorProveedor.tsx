"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { proveedoresQueCoinciden } from "@/lib/core/proveedores";

type Opcion = { id: string; nombre: string };

/**
 * Elegir un proveedor escribiendo su nombre.
 *
 * Eran 163 y ahora son 273: un desplegable con esa lista obliga a recorrerla
 * con la rueda del mouse buscando un nombre que ya se sabe. Acá se escriben
 * tres letras y aparece.
 *
 * La búsqueda usa la misma normalización que el resto del módulo —sin acentos
 * ni mayúsculas—, así que "olavarria" encuentra "Bolsas Olavarría". Y busca en
 * cualquier parte del nombre, no sólo al principio: quien busca "ciuffo" no se
 * acuerda de que está cargado como "Papelera Ciuffo".
 */
export default function SelectorProveedor({
  proveedores, valor, onCambio, autoFocus, placeholder = "Escribí para buscar…",
  clase = "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm",
}: {
  proveedores: Opcion[];
  /** El id elegido, o "" si no hay ninguno. */
  valor: string;
  onCambio: (id: string) => void;
  autoFocus?: boolean;
  placeholder?: string;
  /**
   * Cómo se ve el campo. Se pasa cuando tiene que parecerse a lo que lo rodea:
   * en la fila de filtros convive con ocho desplegables y desentonaría.
   */
  clase?: string;
}) {
  const elegido = useMemo(
    () => proveedores.find((p) => p.id === valor) ?? null,
    [proveedores, valor]
  );

  const [texto, setTexto] = useState("");
  const [abierto, setAbierto] = useState(false);
  const [resaltado, setResaltado] = useState(0);
  const caja = useRef<HTMLDivElement>(null);

  // Con el selector cerrado, el input muestra a quién se eligió. Mientras se
  // busca, muestra lo que se está escribiendo.
  const mostrado = abierto ? texto : elegido?.nombre ?? "";

  // Ocho entran en pantalla sin tapar el resto del formulario. Si el que se
  // busca no está entre esas ocho, escribir una letra más es más rápido que
  // scrollear una lista.
  const coincidencias = useMemo(
    () => proveedoresQueCoinciden(proveedores, texto, 8),
    [proveedores, texto]
  );

  // Ajuste durante el render y no en un efecto: es lo que recomienda la doc de
  // React para "cuando cambia esta entrada, volve este estado al principio".
  // Con un efecto habia un commit intermedio en el que la lista ya era la nueva
  // y el resaltado seguia en la fila de la busqueda anterior.
  const [textoPrevio, setTextoPrevio] = useState(texto);
  if (texto !== textoPrevio) {
    setTextoPrevio(texto);
    setResaltado(0);
  }

  // Tocar fuera cierra sin elegir.
  useEffect(() => {
    if (!abierto) return;
    const alTocar = (e: MouseEvent) => {
      if (caja.current && !caja.current.contains(e.target as Node)) {
        setAbierto(false);
        setTexto("");
      }
    };
    document.addEventListener("mousedown", alTocar);
    return () => document.removeEventListener("mousedown", alTocar);
  }, [abierto]);

  function elegir(p: Opcion) {
    onCambio(p.id);
    setTexto("");
    setAbierto(false);
  }

  function alTeclear(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setAbierto(true);
      setResaltado((i) => Math.min(i + 1, coincidencias.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setResaltado((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      // Sólo si hay algo que elegir: si no, el Enter es del formulario.
      if (abierto && coincidencias[resaltado]) {
        e.preventDefault();
        elegir(coincidencias[resaltado]);
      }
    } else if (e.key === "Escape") {
      setAbierto(false);
      setTexto("");
    }
  }

  return (
    <div ref={caja} className="relative">
      <input
        type="text"
        role="combobox"
        aria-expanded={abierto}
        aria-autocomplete="list"
        autoFocus={autoFocus}
        className={`${clase} pr-7`}
        placeholder={placeholder}
        value={mostrado}
        onChange={(e) => { setTexto(e.target.value); setAbierto(true); }}
        onFocus={() => { setTexto(""); setAbierto(true); }}
        onKeyDown={alTeclear}
      />

      {elegido && !abierto ? (
        <button
          type="button"
          onClick={() => onCambio("")}
          aria-label="Quitar el proveedor elegido"
          className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700"
        >
          ×
        </button>
      ) : (
        // Sin esto se lee como un campo de texto y nadie descubre que hay una
        // lista atrás. Es el mismo gesto visual que el de un desplegable.
        <svg
          aria-hidden
          width="14" height="14" viewBox="0 0 24 24"
          fill="none" stroke="currentColor" strokeWidth="2"
          className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-slate-400"
        >
          <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}

      {abierto && (
        <ul
          role="listbox"
          className="absolute z-20 mt-1 max-h-64 w-full overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-lg"
        >
          {coincidencias.length === 0 ? (
            <li className="px-3 py-2 text-sm text-slate-400">
              Ningún proveedor con ese nombre.
            </li>
          ) : (
            coincidencias.map((p, i) => (
              <li key={p.id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={i === resaltado}
                  onClick={() => elegir(p)}
                  onMouseEnter={() => setResaltado(i)}
                  className={`w-full px-3 py-2 text-left text-sm ${
                    i === resaltado ? "bg-slate-100 text-slate-900" : "text-slate-700"
                  }`}
                >
                  {p.nombre}
                </button>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
