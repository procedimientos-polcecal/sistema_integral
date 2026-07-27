"use client";

import { createContext, useContext } from "react";
import type { NivelAcceso } from "@/lib/core/types";

const NivelRemisesContext = createContext<NivelAcceso | null>(null);

export function NivelRemisesProvider({
  nivel,
  children,
}: {
  nivel: NivelAcceso;
  children: React.ReactNode;
}) {
  return <NivelRemisesContext.Provider value={nivel}>{children}</NivelRemisesContext.Provider>;
}

export function useNivelRemises(): NivelAcceso {
  const nivel = useContext(NivelRemisesContext);
  if (!nivel) {
    throw new Error("useNivelRemises debe usarse dentro de NivelRemisesProvider");
  }
  return nivel;
}

export function usePuedeEditarRemises(): boolean {
  const nivel = useNivelRemises();
  return nivel === "edicion" || nivel === "admin";
}

export function useEsAdminRemises(): boolean {
  const nivel = useNivelRemises();
  return nivel === "admin";
}
