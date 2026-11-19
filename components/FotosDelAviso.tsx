"use client";

import { useState } from "react";
import { fotosDelAviso } from "@/lib/mantenimiento/fotoDelAviso";

/**
 * Las fotos de un aviso de Mantenimiento.
 *
 * Existe porque la pantalla de avisos **guardaba la foto y no la mostraba
 * nunca**: `avisos.reference_photos` se llenaba desde las dos puntas —el alta
 * del SdG y la columna "Imagen" de la planilla— y `AvisosClient` no tenía ni
 * un `<img>` ni un `href`, así que quien sacaba la foto parado frente a la
 * máquina era el único que la veía.
 *
 * Qué se puede dibujar y qué sólo se puede enlazar lo decide
 * `fotosDelAviso()`, con el porqué medido. Acá queda la otra mitad: **si el
 * navegador no puede con la imagen, se cae al enlace.** Es una red y no un
 * adorno — cubre el HEIC que Chrome no dibuja, el link firmado que venció y el
 * archivo que ya no está en el bucket—, y es lo que permite que la función de
 * arriba sea generosa sin arriesgar un cuadro roto.
 */
export default function FotosDelAviso({
  fotos,
  oa,
  className = "",
}: {
  fotos: string[] | null | undefined;
  /** El N° de OA, sólo para el texto alternativo de la imagen. */
  oa?: string | null;
  className?: string;
}) {
  /** Las que el navegador no pudo dibujar: pasan a mostrarse como enlace. */
  const [fallaron, setFallaron] = useState<string[]>([]);

  const lista = fotosDelAviso(fotos);
  if (lista.length === 0) return null;

  return (
    <div className={`flex flex-wrap items-center gap-2 ${className}`}>
      {lista.map((foto) => {
        const rota = fallaron.includes(foto.url);

        if (foto.tipo === "imagen" && !rota) {
          return (
            <a key={foto.url} href={foto.url} target="_blank" rel="noreferrer" title="Abrir la foto">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={foto.url}
                alt={oa ? `Foto del aviso ${oa}` : "Foto del aviso"}
                loading="lazy"
                onError={() => setFallaron((f) => (f.includes(foto.url) ? f : [...f, foto.url]))}
                className="h-16 w-16 rounded-lg border border-slate-200 object-cover"
              />
            </a>
          );
        }

        const porQue = rota
          ? "No se pudo mostrar la foto acá; se abre aparte."
          : foto.tipo === "enlace"
            ? foto.porQue
            : "";

        return (
          <span key={foto.url} className="inline-flex items-center gap-1.5">
            <a
              href={foto.url}
              target="_blank"
              rel="noreferrer"
              className="text-xs font-medium text-slate-700 underline"
            >
              Ver la foto
            </a>
            <span className="text-[11px] text-slate-400">{porQue}</span>
          </span>
        );
      })}
    </div>
  );
}
