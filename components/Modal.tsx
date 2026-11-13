"use client";

import { useCallback, useEffect, useId, useRef } from "react";
import { useConfirm } from "@/components/ConfirmProvider";

export interface ModalProps {
  titulo: string;
  children: React.ReactNode;
  /** Sale conservando: la X, el fondo y Escape. */
  alSalir: () => void;
  /** Verdadero cuando hay algo a medio cargar: dispara la pregunta al salir. */
  tocado?: boolean;
  /** Un visor de sólo lectura: sale derecho y nunca pregunta. */
  soloLectura?: boolean;
  ancho?: "chico" | "medio" | "ancho";
}

// El ancho va en el panel, que no es `.card`: ninguna clase sin capa declara
// `max-width` y por eso la utilidad sí gana.
const ANCHOS = {
  chico: "max-w-sm",
  medio: "max-w-lg",
  ancho: "max-w-3xl",
} as const;

/**
 * El modal compartido. La regla que hace cumplir: **cancelar tira; todo lo
 * demás sale y guarda.** El fondo, la X y Escape significan «salir», y salir
 * nunca destruye nada; sólo el botón negativo del formulario descarta. Así un
 * toque distraído no puede costar lo cargado.
 *
 * Si `tocado`, salir pregunta antes. El cartel **no dice que se pierde nada**,
 * porque el borrador se conserva igual: lo que dice es que hay algo a medio
 * cargar y ofrece quedarse. Un cartel que miente enseña a apretar sin leer el
 * próximo, el que sí importaba.
 *
 * El modal no decide si el formulario está tocado: lo recibe. Sin `tocado` es
 * inerte y sale derecho.
 *
 * **No dibuja pie ni botones**, a diferencia de los modales viejos: cada
 * formulario dibuja su botón negativo y es el único que tira el borrador.
 */
export function Modal({
  titulo,
  children,
  alSalir,
  tocado = false,
  soloLectura = false,
  ancho = "medio",
}: ModalProps) {
  const confirm = useConfirm();
  const idTitulo = useId();
  // Escape repetido o un toque en el fondo mientras el cartel está abierto no
  // tienen que apilar una segunda pregunta.
  const preguntando = useRef(false);

  const salir = useCallback(async () => {
    if (!tocado || soloLectura) {
      alSalir();
      return;
    }
    if (preguntando.current) return;
    preguntando.current = true;
    try {
      const salgo = await confirm({
        title: "¿Salir del formulario?",
        message:
          "Hay algo a medio cargar. Queda guardado como borrador y lo vas a encontrar al volver.",
        confirmText: "Salir",
        cancelText: "Seguir cargando",
      });
      if (salgo) alSalir();
    } finally {
      preguntando.current = false;
    }
  }, [tocado, soloLectura, alSalir, confirm]);

  useEffect(() => {
    function alTeclear(e: KeyboardEvent) {
      if (e.key === "Escape") void salir();
    }
    document.addEventListener("keydown", alTeclear);
    return () => document.removeEventListener("keydown", alTeclear);
  }, [salir]);

  return (
    <div
      // `pointerdown` y no `click`: arrastrar para seleccionar texto de un
      // campo y soltar sobre el fondo genera un click ahí, y eso cerraba.
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) void salir();
      }}
      style={{
        position: "fixed", inset: 0, zIndex: 50,
        background: "rgba(0,0,0,.45)",
        display: "flex", alignItems: "center", justifyContent: "center", padding: 16,
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={idTitulo}
        className={`w-full ${ANCHOS[ancho]} max-h-full flex flex-col rounded-2xl bg-white shadow-xl`}
        style={{ animation: "fadeUp .2s ease both" }}
      >
        <div className="flex items-start justify-between gap-3 px-5 pt-5 pb-3 shrink-0">
          <h2 id={idTitulo} className="min-w-0 text-base font-bold text-slate-900">
            {titulo}
          </h2>
          <button
            type="button"
            onClick={() => void salir()}
            aria-label="Cerrar"
            className="shrink-0 -mt-1 -mr-1 w-8 h-8 rounded-lg flex items-center justify-center text-slate-500 hover:bg-slate-100 transition-colors"
          >
            <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        {/* El scroll es del cuerpo y no de la página: en 343 px un formulario
            largo se recorre sin que el título y la X se vayan. */}
        <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-5">{children}</div>
      </div>
    </div>
  );
}
