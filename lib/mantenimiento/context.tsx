"use client";

import { createContext, useContext } from "react";
import type { NivelAcceso } from "@/lib/core/types";

const NivelMantenimientoContext = createContext<NivelAcceso | null>(null);

export function NivelMantenimientoProvider({
  nivel,
  children,
}: {
  nivel: NivelAcceso;
  children: React.ReactNode;
}) {
  return (
    <NivelMantenimientoContext.Provider value={nivel}>
      {children}
    </NivelMantenimientoContext.Provider>
  );
}

export function useNivelMantenimiento(): NivelAcceso {
  const nivel = useContext(NivelMantenimientoContext);
  if (!nivel) {
    throw new Error("useNivelMantenimiento debe usarse dentro de NivelMantenimientoProvider");
  }
  return nivel;
}

export function usePuedeEditarMantenimiento(): boolean {
  const nivel = useNivelMantenimiento();
  return nivel === "edicion" || nivel === "admin";
}
