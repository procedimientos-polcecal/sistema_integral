"use client";

import { createContext, useContext } from "react";
import type { NivelAcceso } from "@/lib/core/types";

const NivelComprasContext = createContext<NivelAcceso | null>(null);

export function NivelComprasProvider({
  nivel,
  children,
}: {
  nivel: NivelAcceso;
  children: React.ReactNode;
}) {
  return <NivelComprasContext.Provider value={nivel}>{children}</NivelComprasContext.Provider>;
}

export function useNivelCompras(): NivelAcceso {
  const nivel = useContext(NivelComprasContext);
  if (!nivel) {
    throw new Error("useNivelCompras debe usarse dentro de NivelComprasProvider");
  }
  return nivel;
}

export function usePuedeEditarCompras(): boolean {
  const nivel = useNivelCompras();
  return nivel === "edicion" || nivel === "admin";
}

/** Aprobar es más restrictivo que comprar: sólo nivel admin del módulo. */
export function usePuedeAprobarCompras(): boolean {
  return useNivelCompras() === "admin";
}
