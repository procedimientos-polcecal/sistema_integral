"use client";

import { useState } from "react";
import { fotosDelAviso } from "@/lib/mantenimiento/fotoDelAviso";

/**
 * Lo que un aviso de Mantenimiento trae adjunto: fotos y videos.
 *
 * Existe porque la pantalla de avisos **guardaba la foto y no la mostraba
 * nunca**: `avisos.reference_photos` se llenaba desde las dos puntas —el alta
 * del SdG y la columna "Imagen" de la planilla— y `AvisosClient` no tenía ni
 * un `<img>` ni un `href`, así que quien sacaba la foto parado frente a la
 * máquina era el único que la veía.
 *
 * Qué se puede dibujar y qué sólo se puede enlazar lo decide
 * `fotosDelAviso()`, con el porqué medido.
 *
 * ── POR QUÉ SE PRUEBA EN VEZ DE PREGUNTAR QUÉ ES ──────────────────────────
 *
 * El adjunto puede ser un video: medido el 23/11/2026, de 31 archivos hay 28
 * fotos y 2 videos. **Pero de este lado no se sabe cuál es cuál**: lo que hay
 * es un link de Drive sin extensión, y el tipo lo conoce únicamente el
 * servidor cuando lo va a buscar. Preguntárselo antes sería una consulta por
 * adjunto —treinta y pico en una pantalla, cada una con su viaje a Drive—
 * sólo para elegir una etiqueta.
 *
 * Así que se prueba lo más probable y se baja un escalón cuando falla:
 * **`<img>` → `<video>` → enlace**. Cada escalón lo decide el navegador con
 * el archivo en la mano, que sabe más que cualquier suposición nuestra, y no
 * cuesta descargas de más porque la ruta responde con `max-age=3600` y el
 * segundo intento sale del caché.
 *
 * El último escalón es la red que vale por todo lo demás: el HEIC que Chrome
 * no dibuja, el link firmado que venció, el archivo que ya no está en el
 * bucket, el PDF que la ruta no sirve y el día que dejen de compartir la
 * carpeta de Drive con la cuenta de servicio.
 */
export default function FotosDelAviso({
  fotos,
  avisoId,
  oa,
  className = "",
}: {
  fotos: string[] | null | undefined;
  /**
   * El id del aviso. Sin él, una foto de Drive sale como enlace en vez de
   * mostrarse: la ruta que la trae necesita saber de qué fila sacar el id.
   */
  avisoId?: string | null;
  /** El N° de OA, sólo para el texto alternativo. */
  oa?: string | null;
  className?: string;
}) {
  /** Hasta qué escalón bajó cada adjunto. Sin entrada, se intenta la imagen. */
  const [cayeron, setCayeron] = useState<Record<string, "video" | "enlace">>({});
  const bajar = (url: string, a: "video" | "enlace") =>
    setCayeron((c) => (c[url] === a ? c : { ...c, [url]: a }));

  const lista = fotosDelAviso(fotos, avisoId);
  if (lista.length === 0) return null;

  const deQuien = oa ? ` del aviso ${oa}` : " del aviso";

  return (
    <div className={`flex flex-wrap items-center gap-2 ${className}`}>
      {lista.map((foto) => {
        const escalon = foto.tipo === "imagen" ? cayeron[foto.url] : "enlace";

        if (foto.tipo === "imagen" && !escalon) {
          return (
            <a key={foto.url} href={foto.url} target="_blank" rel="noreferrer" title="Abrir la foto">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={foto.url}
                alt={`Foto${deQuien}`}
                loading="lazy"
                onError={() => bajar(foto.url, "video")}
                className="h-16 w-16 rounded-lg border border-slate-200 object-cover"
              />
            </a>
          );
        }

        if (foto.tipo === "imagen" && escalon === "video") {
          return (
            <a
              key={foto.url}
              href={foto.url}
              target="_blank"
              rel="noreferrer"
              title="Abrir el video"
              className="relative inline-block"
            >
              {/* El `#t=0.1` le pide al navegador que busque el primer
                  fotograma: sin eso el recuadro queda negro y no se entiende
                  qué es. El fragmento no viaja al servidor. */}
              <video
                src={`${foto.url}#t=0.1`}
                preload="metadata"
                muted
                playsInline
                aria-label={`Video${deQuien}`}
                onError={() => bajar(foto.url, "enlace")}
                className="h-16 w-16 rounded-lg border border-slate-200 object-cover"
              />
              <span
                aria-hidden
                className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-lg bg-slate-900/35 text-sm text-white"
              >
                ▶
              </span>
            </a>
          );
        }

        const porQue =
          foto.tipo === "enlace"
            ? foto.porQue
            : "No se pudo mostrar acá; se abre aparte.";

        // Si lo que falló fue la ruta que trae la de Drive, el enlace tiene
        // que ir al link original y no a la ruta que acaba de fallar.
        const adonde = (foto.tipo === "imagen" && foto.respaldo) || foto.url;

        return (
          <span key={foto.url} className="inline-flex items-center gap-1.5">
            <a
              href={adonde}
              target="_blank"
              rel="noreferrer"
              className="text-xs font-medium text-slate-700 underline"
            >
              Ver el adjunto
            </a>
            <span className="text-[11px] text-slate-400">{porQue}</span>
          </span>
        );
      })}
    </div>
  );
}
