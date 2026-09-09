"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import UltimaSincronizacion from "@/components/UltimaSincronizacion";
import type { UltimaSync } from "@/lib/core/sincronizaciones";

/**
 * El botón de traer de la planilla, en todas las pantallas del módulo.
 *
 * Estaba sólo en Stock, y ahí no sirve de nada cuando el número viejo se ve en
 * otra pantalla: quien mira el kardex o la lista tiene que volver atrás,
 * apretar, y volver. Va en las cinco.
 *
 * Con la fecha al lado y no solo. Un botón de actualizar sin decir de cuándo es
 * lo que hay obliga a apretarlo por las dudas, que es exactamente lo que esta
 * sincronización no conviene que pase: lee dos pestañas y escribe unas 6.900
 * filas.
 *
 * Lo que devuelve se muestra entero, incluido lo que no reconoció. Un resumen
 * que sólo dice "listo" esconde los 900 nombres que quedaron sin enganchar.
 */
export default function TraerDeLaPlanilla({
  sync, onListo,
}: {
  sync: UltimaSync | null;
  /**
   * Qué refrescar además de la página. Las pantallas que arman su lista en el
   * cliente —el stock, el kardex— no se enteran de un `router.refresh()`.
   */
  onListo?: () => void;
}) {
  const router = useRouter();
  const [sincronizando, setSincronizando] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const [fallo, setFallo] = useState(false);

  async function sincronizar() {
    setSincronizando(true);
    setAviso(null);
    setFallo(false);

    const res = await fetch("/api/inventario/sync", { method: "POST" });
    const body = await res.json().catch(() => ({}));
    setSincronizando(false);

    if (!res.ok) {
      setFallo(true);
      setAviso(body.error ?? "No se pudo sincronizar.");
      return;
    }

    const sinReconocer = Object.entries(body.sin_reconocer ?? {})
      .map(([catalogo, nombres]) => `${(nombres as string[]).length} ${catalogo}`)
      .join(", ");

    const sinDestino = (body.equipos_sin_destino ?? []) as string[];
    const enDosSectores = (body.equipos_en_dos_sectores ?? []) as string[];

    // El error de la pestaña de equipos no es un aviso más: la lista quedó como
    // estaba y el kardex entró igual, así que se marca como fallo aunque el resto
    // de la sincronización haya salido bien.
    if (body.equipos_error) setFallo(true);

    setAviso(
      `${body.articulos} artículos y ${body.movimientos} movimientos.` +
      (body.movimientos_sin_articulo > 0
        ? ` ${body.movimientos_sin_articulo} movimientos son de un código que no está en el listado.`
        : "") +
      (body.solicitantes_enganchados > 0
        ? ` ${body.solicitantes_enganchados} nombres de la lista se engancharon al padrón.`
        : "") +
      (sinReconocer ? ` Sin reconocer contra el sistema: ${sinReconocer}.` : "") +
      // Sin el conteo adelante: los nombres van al lado, así que el número no
      // agrega nada y obliga a concordar en singular y en plural — "1 sectores".
      // Es además cómo escribe "Sin reconocer contra el sistema".
      (sinDestino.length > 0
        ? ` Sectores de la pestaña de equipos que no están en la lista del pañol, así que sus equipos no entraron: ${sinDestino.join(", ")}.`
        : "") +
      (enDosSectores.length > 0
        ? ` La pestaña pone estos equipos en más de un sector, así que no se tocaron —hay que corregirla—: ${enDosSectores.join(", ")}.`
        : "") +
      (body.equipos_error
        ? ` La pestaña de equipos no se pudo leer, la lista de sectores/equipos quedó como estaba: ${body.equipos_error}`
        : "")
    );

    // La fecha de "actualizado hace…" vive en el servidor, así que la página se
    // vuelve a pedir aunque la pantalla arme su lista sola.
    router.refresh();
    onListo?.();
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-end gap-2">
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
