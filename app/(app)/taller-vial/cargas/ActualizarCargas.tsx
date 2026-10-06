"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import UltimaSincronizacion from "@/components/UltimaSincronizacion";
import type { UltimaSync } from "@/lib/core/sincronizaciones";

/**
 * Trae de la planilla ("DATOS" y "HISTORIAL ESTADOS") a demanda, en vez de
 * esperar al cron de 20 minutos — igual que `ActualizarAcarreo` en Cantera.
 * Las cargas hechas en el SdG no se tocan: sólo se recargan las que vinieron
 * de la planilla (ver `sincronizarCargasDesdeSheets`).
 */
export default function ActualizarCargas({ sync }: { sync: UltimaSync | null }) {
  const router = useRouter();
  const [actualizando, setActualizando] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const [fallo, setFallo] = useState(false);

  async function actualizar() {
    setActualizando(true);
    setAviso(null);
    setFallo(false);

    try {
      const res = await fetch("/api/taller-vial/sync", { method: "POST" });
      const body = await res.json().catch(() => ({}));

      if (!res.ok) {
        setFallo(true);
        setAviso(body.error ?? "No se pudo actualizar.");
      } else {
        const { cargas } = body;
        setAviso(
          `${cargas.filasLeidas} fila(s) leídas de "DATOS", ${cargas.filasInsertadas} entraron.` +
            (cargas.sinEquipoReconocido > 0 ? ` ${cargas.sinEquipoReconocido} sin equipo reconocido.` : "")
        );
      }
    } catch {
      setFallo(true);
      setAviso("No se pudo actualizar.");
    } finally {
      setActualizando(false);
      router.refresh();
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <UltimaSincronizacion cuando={sync?.created_at} ok={sync?.ok ?? true} error={sync?.error} />
      <button onClick={actualizar} disabled={actualizando} className="btn-secondary">
        {actualizando ? "Actualizando…" : "Actualizar"}
      </button>
      {aviso && (
        <span className={`w-full text-xs ${fallo ? "font-medium text-red-600" : "text-slate-500"}`}>{aviso}</span>
      )}
    </div>
  );
}
