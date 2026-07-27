"use client";

import { createContext, useContext } from "react";
import type { NivelAcceso } from "@/lib/core/types";

const NivelRrhhContext = createContext<NivelAcceso | null>(null);

export function NivelRrhhProvider({
  nivel,
  children,
}: {
  nivel: NivelAcceso;
  children: React.ReactNode;
}) {
  return <NivelRrhhContext.Provider value={nivel}>{children}</NivelRrhhContext.Provider>;
}

export function useNivelRrhh(): NivelAcceso {
  const nivel = useContext(NivelRrhhContext);
  if (!nivel) {
    throw new Error("useNivelRrhh debe usarse dentro de NivelRrhhProvider");
  }
  return nivel;
}

export function usePuedeEditarRrhh(): boolean {
  const nivel = useNivelRrhh();
  return nivel === "edicion" || nivel === "admin";
}

export function useEsAdminRrhh(): boolean {
  const nivel = useNivelRrhh();
  return nivel === "admin";
}
