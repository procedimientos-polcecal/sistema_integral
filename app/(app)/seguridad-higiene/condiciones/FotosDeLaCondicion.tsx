"use client";

import { useState } from "react";
import { useConfirm } from "@/components/ConfirmProvider";
import { useCargar } from "@/lib/core/useCargar";
import { problemaDeLaFoto } from "@/lib/seguridadHigiene/fotoDeCondicion";

/**
 * Las fotos de una condición: verlas, agregar y sacar.
 *
 * ── POR QUÉ AGREGAR Y SACAR NO SON UN EXTRA ────────────────────────────────
 *
 * Las 44 condiciones que vienen del Excel **entran sin foto**: las del Excel
 * son links a un disco que no viaja. Sin un botón acá, la ficha de cada una
 * dice «Esta condición no tiene fotos» y nadie puede cambiarlo nunca. Y sacar
 * es lo que arregla la foto equivocada y la repetida —que es lo que deja un
 * reintento del alta cuya respuesta se perdió en el camino—.
 *
 * Está en su propio archivo y no adentro de `FichaDeCondicion.tsx` porque esto
 * tiene estado propio (la lista, lo que se está subiendo, el link copiado) y
 * aquél ya tenía 628 líneas y tres etapas de formulario. Lo que comparten es un
 * id y un permiso.
 *
 * ── LO QUE SE COMPRUEBA ACÁ Y TAMBIÉN DEL OTRO LADO ────────────────────────
 *
 * Qué foto se acepta lo dice `problemaDeLaFoto`, la misma función que corre la
 * ruta: acá se usa para no hacer subir 14 MB por una red de planta y después
 * decir que no entraban. Quien decide de verdad es la ruta, y detrás de ella
 * las policies `syh_fotos_agregar` y `syh_fotos_sacar`.
 *
 * El bucket es privado, así que los links son firmados y duran una hora. Se
 * piden al abrir la ficha; quien la deje abierta más que eso recarga.
 */

export interface Foto {
  id: string;
  subida_el: string;
  link: string | null;
  descarga: string | null;
  error: string | null;
}

export default function FotosDeLaCondicion({
  condicionId,
  numero,
  puedeTocar,
}: {
  condicionId: string;
  numero: number;
  /** Si esta persona puede agregar y sacar fotos de esta condición. */
  puedeTocar: boolean;
}) {
  const confirm = useConfirm();
  const [fotos, setFotos] = useState<Foto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [copiada, setCopiada] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  // La `key` del campo de archivo: un `<input type="file">` no se vacía desde
  // el valor, así que para que deje de mostrar el nombre de la que ya subió hay
  // que volver a montarlo.
  const [generacion, setGeneracion] = useState(0);

  const volverALeer = useCargar(async (vigente) => {
    const r = await fetch(`/api/seguridad-higiene/condiciones/${condicionId}`).catch(() => null);
    const j = r ? await r.json().catch(() => null) : null;
    if (!vigente()) return;
    if (!r || !r.ok) {
      setError(j?.error ?? "No se pudieron traer las fotos");
      return;
    }
    setError(null);
    setFotos(j.data as Foto[]);
  }, [condicionId]);

  async function copiarLink(foto: Foto) {
    if (!foto.link) return;
    try {
      await navigator.clipboard.writeText(foto.link);
      setCopiada(foto.id);
      setTimeout(() => setCopiada((actual) => (actual === foto.id ? null : actual)), 2000);
    } catch {
      setError("No se pudo copiar el link. Abrí la foto y copialo desde la barra del navegador.");
    }
  }

  async function agregar(archivo: File | null) {
    setError(null);
    setAviso(null);
    setGeneracion((n) => n + 1);
    if (!archivo) return;

    const problema = problemaDeLaFoto(archivo);
    if (problema) {
      setError(problema);
      return;
    }

    setOcupado(true);
    try {
      const forma = new FormData();
      forma.append("file", archivo, archivo.name);
      forma.append("condicion", condicionId);
      const r = await fetch("/api/seguridad-higiene/fotos", { method: "POST", body: forma });
      const j = await r.json().catch(() => null);
      if (!r.ok) {
        // Sin traducir: lo que dijo la ruta es lo único que distingue «pesa de
        // más» de «la condición está cerrada».
        setError(j?.error ?? `No se pudo subir la foto (error ${r.status})`);
        return;
      }
      setAviso("Foto agregada.");
      // Se vuelve a leer en vez de agregarla a la lista a mano: así el link
      // firmado y el de descarga salen del mismo lugar que los demás.
      volverALeer();
    } catch {
      setError("No se pudo subir la foto: parece que no hay conexión.");
    } finally {
      setOcupado(false);
    }
  }

  async function sacar(foto: Foto) {
    const seguro = await confirm({
      title: "¿Sacar la foto?",
      message:
        "La foto se borra de la condición y del archivo, y no queda en ningún lado. " +
        "Si era la única que mostraba el problema, no se puede volver a sacar.",
      confirmText: "Sacar",
      danger: true,
    });
    if (!seguro) return;

    setError(null);
    setAviso(null);
    setOcupado(true);
    try {
      const r = await fetch(`/api/seguridad-higiene/fotos/${foto.id}`, { method: "DELETE" });
      const j = await r.json().catch(() => null);
      if (!r.ok) {
        setError(j?.error ?? `No se pudo sacar la foto (error ${r.status})`);
        return;
      }
      setAviso(j?.aviso ?? "Foto sacada.");
      volverALeer();
    } catch {
      setError("No se pudo sacar la foto: parece que no hay conexión.");
    } finally {
      setOcupado(false);
    }
  }

  return (
    <section className="space-y-2">
      <h3 className="text-sm font-semibold text-slate-900">Fotos</h3>

      {error && <p className="text-sm text-red-700">{error}</p>}
      {aviso && <p className="text-sm text-emerald-800">{aviso}</p>}
      {fotos === null && !error && <p className="text-sm text-slate-500">Cargando fotos…</p>}
      {fotos && fotos.length === 0 && (
        <p className="text-sm text-slate-500">Esta condición no tiene fotos.</p>
      )}

      {fotos && fotos.length > 0 && (
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {fotos.map((foto) => (
            <li key={foto.id} className="space-y-1.5 rounded-lg border border-slate-200 p-2">
              {foto.link ? (
                <a href={foto.link} target="_blank" rel="noreferrer">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={foto.link}
                    alt={`Foto de la condición ${numero}`}
                    loading="lazy"
                    className="h-48 w-full rounded object-cover"
                  />
                </a>
              ) : (
                <p className="flex h-48 items-center justify-center rounded bg-slate-100 px-2 text-center text-xs text-red-700">
                  No se pudo abrir esta foto{foto.error ? `: ${foto.error}` : ""}
                </p>
              )}
              <div className="flex flex-wrap gap-2">
                {foto.descarga && (
                  <a href={foto.descarga} className="btn-secondary text-xs">
                    Descargar
                  </a>
                )}
                {foto.link && (
                  <button type="button" onClick={() => copiarLink(foto)} className="btn-secondary text-xs">
                    {copiada === foto.id ? "Link copiado" : "Copiar link"}
                  </button>
                )}
                {puedeTocar && (
                  <button
                    type="button"
                    onClick={() => sacar(foto)}
                    disabled={ocupado}
                    className="btn-secondary text-xs text-red-700 disabled:opacity-50"
                  >
                    Sacar
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {fotos && fotos.length > 0 && (
        <p className="text-xs text-slate-500">
          El link dura una hora: pasado ese tiempo, abrí la condición de nuevo y copiá otro.
        </p>
      )}

      {puedeTocar && (
        <div className="space-y-1">
          {/* El ancho va en el envoltorio y no en el `input`: `.input` está
              declarado fuera de toda capa y su `width: 100%` le gana a
              cualquier `w-*` que se le ponga al lado. */}
          <div className="max-w-sm">
            <input
              key={generacion}
              type="file"
              accept="image/*"
              disabled={ocupado}
              onChange={(e) => agregar(e.target.files?.[0] ?? null)}
              className="input text-sm"
            />
          </div>
          <p className="text-xs text-slate-500">
            {ocupado ? "Subiendo…" : "Agregar una foto: JPG, PNG, WEBP o HEIC, hasta 10 MB."}
          </p>
        </div>
      )}
    </section>
  );
}
