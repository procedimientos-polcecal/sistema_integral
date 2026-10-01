"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import UltimaSincronizacion from "@/components/UltimaSincronizacion";
import type { UltimaSync } from "@/lib/core/sincronizaciones";

/**
 * Trae de "Datos" (la planilla de balanza) a demanda, en vez de esperar al
 * cron de 20 minutos. A pedido del usuario: si edita la hoja a mano —borra
 * o agrega líneas— quiere verlo reflejado ya, no quince minutos después.
 *
 * Misma función que corre el cron (`sincronizarAcarreoDesdeSheets`), nomás
 * que la dispara una persona y no `CRON_SECRET` — alcanza con tener acceso
 * al módulo, igual que "Traer de la planilla" de Inventario: esto no
 * escribe nada propio, sólo copia lo que ya dice la planilla.
 */
export default function ActualizarAcarreo({ sync }: { sync: UltimaSync | null }) {
  const router = useRouter();
  const [actualizando, setActualizando] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const [fallo, setFallo] = useState(false);

  async function actualizar() {
    setActualizando(true);
    setAviso(null);
    setFallo(false);

    const res = await fetch("/api/cantera/acarreo/sync", { method: "POST" });
    const body = await res.json().catch(() => ({}));
    setActualizando(false);

    if (!res.ok) {
      setFallo(true);
      setAviso(body.error ?? "No se pudo actualizar.");
      router.refresh();
      return;
    }

    const etiquetasSinTipo = (body.etiquetasSinTipo ?? []) as string[];
    setAviso(
      `${body.pesadasLeidas} pesada(s) leídas de "Datos", ${body.pesadasInsertadas} entraron.` +
        (body.pesadasSinFletero > 0 ? ` ${body.pesadasSinFletero} sin fletero reconocido.` : "") +
        (etiquetasSinTipo.length > 0 ? ` Sin tipo reconocido: ${etiquetasSinTipo.join(", ")}.` : "")
    );
    router.refresh();
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
