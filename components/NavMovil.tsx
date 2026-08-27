"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { usePathname } from "next/navigation";

/**
 * El menú lateral en un teléfono.
 *
 * El sidebar mide 240 px fijos y no tenía ningún breakpoint: en un iPhone de
 * 375 px le dejaba al contenido 87 px —menos de un cuarto de la pantalla— y el
 * resto era menú. Acá abajo de `md` pasa a ser un cajón que se abre encima del
 * contenido y se cierra al elegir algo.
 *
 * El estado vive en un contexto porque lo tocan dos componentes que no se
 * conocen: el botón, que va en el encabezado, y el panel, que es otro árbol.
 * El encabezado sigue siendo de servidor; sólo el botón es de cliente.
 */
const NavMovilContext = createContext<{
  abierto: boolean;
  abrir: () => void;
  cerrar: () => void;
}>({ abierto: false, abrir: () => {}, cerrar: () => {} });

export const useNavMovil = () => useContext(NavMovilContext);

export function NavMovilProvider({ children }: { children: React.ReactNode }) {
  const [abierto, setAbierto] = useState(false);
  const pathname = usePathname();

  // Al navegar se cierra solo. En un teléfono el cajón tapa el contenido, así
  // que dejarlo abierto después de elegir una página esconde justo lo que la
  // persona fue a buscar.
  useEffect(() => {
    setAbierto(false);
  }, [pathname]);

  // Con el cajón abierto, el fondo no se mueve: si no, al arrastrar sobre el
  // menú se scrollea la página de atrás y se pierde el lugar.
  useEffect(() => {
    if (!abierto) return;
    const previo = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previo; };
  }, [abierto]);

  // Escape cierra, como cualquier capa que tapa el contenido.
  useEffect(() => {
    if (!abierto) return;
    const alTeclear = (e: KeyboardEvent) => { if (e.key === "Escape") setAbierto(false); };
    window.addEventListener("keydown", alTeclear);
    return () => window.removeEventListener("keydown", alTeclear);
  }, [abierto]);

  return (
    <NavMovilContext.Provider
      value={{ abierto, abrir: () => setAbierto(true), cerrar: () => setAbierto(false) }}
    >
      {children}
    </NavMovilContext.Provider>
  );
}

/**
 * Abre el menú. Sólo existe abajo de `md`: de ahí para arriba el panel está
 * siempre a la vista y un botón para mostrarlo no significaría nada.
 */
export function BotonMenu() {
  const { abrir } = useNavMovil();

  return (
    <button
      type="button"
      onClick={abrir}
      aria-label="Abrir el menú"
      // 44x44 es el mínimo que se puede tocar con el pulgar sin errarle.
      className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg transition hover:bg-white/10 md:hidden"
      style={{ color: "var(--sidebar-text)" }}
    >
      <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
        <path d="M4 6h16M4 12h16M4 18h16" strokeLinecap="round" />
      </svg>
    </button>
  );
}
