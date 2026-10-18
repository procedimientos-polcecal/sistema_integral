"use client";

import { useEffect, useRef, useState } from "react";
import { ubicarGlobo, type Globo } from "./ubicarGlobo";

/**
 * Ícono de información (i) con un texto explicativo.
 * Funciona con hover (desktop) y con clic (móvil).
 *
 * EL GLOBO VA EN `fixed`, Y ESO NO ES CAPRICHO
 *
 * Estaba en `absolute` dentro del `<span>` del ícono, que es lo natural y
 * andaba bien en todas las pantallas donde lo probamos. **Pero cualquier
 * ancestro con `overflow` lo recorta**, y en este sistema las tablas viven
 * adentro de un `overflow-x-auto` — es la regla de responsive del repo. El
 * 18/10/2026 la tabla del MTBF estrenó un `(i)` por columna y el globo de las
 * últimas dos salió cortado al medio de una palabra.
 *
 * Lo peligroso es que **no se nota al escribirlo**: el que agrega un `InfoTip`
 * en una columna nueva no tiene forma de saber que el contenedor de la tabla se
 * lo va a comer, no hay error, y `revisar-responsive.mjs` no lo ve porque mide
 * clases de Tailwind y esto es posicionamiento en tiempo de ejecución.
 *
 * Con `fixed` el globo se cuelga del viewport y ningún `overflow` lo alcanza.
 * El precio es que hay que calcular dónde ponerlo, que es lo que hace `ubicar()`:
 * lo pega al ícono por la izquierda, y si así se saldría por el borde derecho lo
 * alinea por la derecha del ícono. Después lo mete a la fuerza adentro del
 * viewport, que es lo que salva al `(i)` de la última columna en un teléfono.
 *
 * Y como el globo ya no viaja con la página, se cierra solo al scrollear o al
 * cambiar el tamaño de la ventana: si no, quedaría flotando lejos de su ícono.
 */

export default function InfoTip({ text, className = "" }: { text: string; className?: string }) {
  const boton = useRef<HTMLButtonElement>(null);
  const [caja, setCaja] = useState<Globo | null>(null);

  const abrir = () => {
    if (boton.current) setCaja(ubicarGlobo(boton.current.getBoundingClientRect(), window.innerWidth));
  };
  const cerrar = () => setCaja(null);

  // El globo está anclado al viewport, así que si la página o la tabla se
  // mueven debajo deja de estar al lado de su ícono. Más vale cerrarlo.
  useEffect(() => {
    if (!caja) return;
    const alMoverse = () => setCaja(null);
    // `true` para enterarse también del scroll de la tabla, que no burbujea.
    window.addEventListener("scroll", alMoverse, true);
    window.addEventListener("resize", alMoverse);
    return () => {
      window.removeEventListener("scroll", alMoverse, true);
      window.removeEventListener("resize", alMoverse);
    };
  }, [caja]);

  return (
    <span
      className={`relative inline-flex align-middle ${className}`}
      onMouseEnter={abrir}
      onMouseLeave={cerrar}
    >
      <button
        ref={boton}
        type="button"
        aria-label="Más información"
        onClick={(e) => {
          e.stopPropagation();
          e.preventDefault();
          if (caja) cerrar();
          else abrir();
        }}
        className="inline-flex items-center justify-center rounded-full transition-colors"
        style={{
          width: 16, height: 16, fontSize: 11, lineHeight: 1,
          fontStyle: "italic", fontFamily: "Georgia, serif", fontWeight: 700,
          color: "#64748B", background: "#F1F5F9", border: "1px solid #CBD5E1",
          cursor: "help",
        }}
      >
        i
      </button>

      {caja && (
        <>
          <span
            onClick={(e) => { e.stopPropagation(); cerrar(); }}
            style={{ position: "fixed", inset: 0, zIndex: 49 }}
          />
          <span
            role="tooltip"
            style={{
              position: "fixed", top: caja.top, left: caja.left, zIndex: 50,
              width: "max-content", maxWidth: caja.ancho,
              background: "#0F172A", color: "#F1F5F9",
              fontSize: 12, lineHeight: 1.45, fontStyle: "normal", fontWeight: 400,
              padding: "8px 10px", borderRadius: 8,
              boxShadow: "0 8px 24px rgba(0,0,0,.18)",
              whiteSpace: "normal",
            }}
          >
            {text}
          </span>
        </>
      )}
    </span>
  );
}
