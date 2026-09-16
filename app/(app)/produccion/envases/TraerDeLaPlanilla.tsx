"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import UltimaSincronizacion from "@/components/UltimaSincronizacion";
import type { UltimaSync } from "@/lib/core/sincronizaciones";

/**
 * El botón de traer de la planilla, con la fecha al lado y no solo.
 *
 * Un botón de actualizar sin decir de cuándo es lo que hay obliga a apretarlo
 * por las dudas.
 *
 * **Lo que devuelve se muestra entero, incluido lo que no reconoció.** Un
 * resumen que sólo dice "listo" esconde justo lo que hay que arreglar: los
 * artículos sin grupo, los que tienen el grupo en disputa y los proveedores que
 * no engancharon con el catálogo del núcleo.
 */
export default function TraerDeLaPlanilla({ sync }: { sync: UltimaSync | null }) {
  const router = useRouter();
  const [sincronizando, setSincronizando] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const [fallo, setFallo] = useState(false);

  async function sincronizar() {
    setSincronizando(true);
    setAviso(null);
    setFallo(false);

    const res = await fetch("/api/produccion/envases/sync", { method: "POST" });
    const body = await res.json().catch(() => ({}));
    setSincronizando(false);

    if (!res.ok) {
      setFallo(true);
      setAviso(body.error ?? "No se pudo sincronizar.");
      return;
    }

    const partes = [
      `${body.articulos} artículos`,
      `${body.movimientos} movimientos`,
      `${body.proveedores} proveedores`,
    ];
    if (body.movimientos_sin_articulo > 0) {
      partes.push(
        `${body.movimientos_sin_articulo} movimientos de un código que no está en el listado`
      );
    }
    const enDisputa = (body.articulos_con_grupo_en_disputa ?? []) as string[];
    if (enDisputa.length) partes.push(`grupo en disputa: ${enDisputa.join("; ")}`);
    const sinEnlazar = (body.proveedores_sin_enlazar ?? []) as string[];
    if (sinEnlazar.length) partes.push(`proveedores sin enganchar: ${sinEnlazar.join(", ")}`);
    // Con lo que dijo Google, sin traducir.
    if (body.proveedores_error) partes.push(`PROVEEDORES: ${body.proveedores_error}`);
    if (body.referencias_error) partes.push(`REFERENCIAS: ${body.referencias_error}`);

    setAviso(partes.join(" · "));
    router.refresh();
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-3">
        <UltimaSincronizacion cuando={sync?.created_at} ok={sync?.ok ?? true} error={sync?.error} />
        <button
          onClick={sincronizar}
          disabled={sincronizando}
          className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
        >
          {sincronizando ? "Trayendo…" : "Traer de la planilla"}
        </button>
      </div>
      {aviso && (
        <div
          className={`rounded-lg border px-4 py-3 text-sm ${
            fallo
              ? "border-red-200 bg-red-50 text-red-700"
              : "border-slate-200 bg-slate-50 text-slate-700"
          }`}
        >
          {aviso}
        </div>
      )}
    </div>
  );
}
