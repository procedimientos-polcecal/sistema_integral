"use client";

import { useEffect, useState } from "react";
import { fechaHora } from "@/lib/compras/constants";
import { Modal } from "@/components/Modal";

interface Archivo {
  id: string;
  nombre: string;
  modificado: string;
  esPlanillaGoogle: boolean;
}

/** Lo que el servidor sugiere para este pedido, con su motivo. */
interface Sugerencia {
  driveId: string;
  nombre: string;
  porque: string;
  fuerte: boolean;
}

/**
 * Elegir de la carpeta de Drive la planilla de comparativa de este pedido.
 *
 * Al elegir, el sistema trae las filas que estén libres o ya sean de este RI.
 *
 * Hasta el 27/11/2026 esto decía que «no se puede adivinar: lo elige la
 * persona». Con 1.717 pedidos ya enlazados eso se midió, y resultó ser mitad
 * cierto: la primera sugerencia acierta el **76,4%** y la correcta está entre
 * las tres el **87,7%**. Así que arriba van las sugerencias y abajo la carpeta
 * entera, igual que antes — **la elección sigue siendo de la persona**, porque
 * una de cada cuatro veces la primera no es la buena y enlazar la planilla
 * equivocada importa a este pedido los presupuestos de otro.
 *
 * Las de la clase fuerte —el mismo artículo ya se enlazó antes, que acierta
 * 95,9%— se marcan distinto a propósito: sin eso pesan igual que las flojas y
 * la buena deja de servir para ahorrarse la revisión.
 */
export default function SelectorComparativa({
  requerimientoId, onListo, onCerrar,
}: {
  requerimientoId: string;
  onListo: (mensaje: string) => void;
  onCerrar: () => void;
}) {
  const [archivos, setArchivos] = useState<Archivo[]>([]);
  const [busqueda, setBusqueda] = useState("");
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState("");
  const [adjuntando, setAdjuntando] = useState<string | null>(null);
  const [sugerencias, setSugerencias] = useState<Sugerencia[]>([]);

  useEffect(() => {
    fetch(`/api/compras/comparativas?requerimiento=${requerimientoId}`)
      .then((r) => r.json())
      .then((body) => {
        if (body.error) setError(body.error);
        else if (body.aviso) setError(body.aviso);
        else {
          setArchivos(body.archivos ?? []);
          setSugerencias(body.sugerencias ?? []);
        }
      })
      .catch(() => setError("No se pudo leer la carpeta de comparativas."))
      .finally(() => setCargando(false));
  }, [requerimientoId]);

  async function adjuntar(archivo: Archivo) {
    setAdjuntando(archivo.id);
    setError("");

    const res = await fetch(`/api/compras/requerimientos/${requerimientoId}/comparativa`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ drive_id: archivo.id, nombre: archivo.nombre }),
    });
    const body = await res.json().catch(() => ({}));
    setAdjuntando(null);

    if (!res.ok) {
      setError(body.error ?? "No se pudo adjuntar la comparativa.");
      return;
    }

    const partes = [`Se trajeron ${body.traidas} presupuesto(s).`];
    if (body.ajenas > 0) {
      partes.push(`${body.ajenas} fila(s) son de otro RI y se dejaron como estaban.`);
    }
    if (body.sin_precio > 0) partes.push(`${body.sin_precio} fila(s) sin precio se ignoraron.`);
    if (body.sin_ri > 0) {
      partes.push(
        `${body.sin_ri} fila(s) de esa planilla no tienen número de RI, así que no se ` +
        "sabe de qué pedido son y quedaron afuera."
      );
    }
    if (body.proveedores_nuevos?.length) {
      partes.push(`Proveedores nuevos: ${body.proveedores_nuevos.join(", ")}.`);
    }
    if (body.rechazadas?.length) {
      partes.push(
        `No se pudieron cargar ${body.rechazadas.length} fila(s): ${body.rechazadas.join(" · ")}`
      );
    }
    onListo(partes.join(" "));
  }

  const visibles = archivos.filter((a) =>
    a.nombre.toLowerCase().includes(busqueda.toLowerCase())
  );

  return (
    // Es un selector sin nada que descartar —lo único que se escribe es el filtro
    // de la lista—, así que sale derecho y nunca pregunta. Antes el fondo no lo
    // cerraba; ahora la X, el fondo y Escape salen, y no se pierde nada.
    <Modal titulo="Elegir comparativa" alSalir={onCerrar} soloLectura ancho="ancho">
        <div className="space-y-3">
          <input
            autoFocus
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            placeholder="Buscar por nombre…"
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />

          {error && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
              {error}
            </div>
          )}

          {/* Las sugerencias, arriba y separadas de la carpeta.
              Se esconden apenas alguien escribe en el buscador: ahí ya está
              buscando otra cosa, y dejarlas arriba sería discutirle. */}
          {!cargando && !busqueda && sugerencias.length > 0 && (
            <div>
              <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400">
                Para este pedido
              </p>
              <ul className="divide-y divide-slate-100 card">
                {sugerencias.map((su) => {
                  const archivo = archivos.find((a) => a.id === su.driveId);
                  return (
                    <li key={su.driveId} className="flex items-center justify-between gap-3 px-3 py-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-slate-900">
                          {su.nombre}
                          {/* La marca de la señal certera. Va por `style` y no
                              con una utilidad de color: `.card` declara su
                              borde fuera de capa y las de al lado no ganan. */}
                          {su.fuerte && (
                            <span className="ml-1.5 text-xs font-normal text-green-700">
                              ✓ ya se usó para esto
                            </span>
                          )}
                        </p>
                        <p className="truncate text-xs text-slate-500">{su.porque}</p>
                      </div>
                      <button
                        onClick={() => archivo && adjuntar(archivo)}
                        disabled={!archivo?.esPlanillaGoogle || adjuntando !== null}
                        className="shrink-0 rounded-lg bg-[var(--primary)] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[var(--primary-dark)] disabled:opacity-40"
                      >
                        {adjuntando === su.driveId ? "Trayendo…" : "Usar esta"}
                      </button>
                    </li>
                  );
                })}
              </ul>
              <p className="mt-1.5 text-xs text-slate-400">
                Son sugerencias y pueden estar erradas: revisá el nombre antes de usarla.
              </p>
            </div>
          )}

          {cargando ? (
            <p className="py-6 text-center text-sm text-slate-400">Leyendo la carpeta…</p>
          ) : visibles.length === 0 ? (
            <p className="py-6 text-center text-sm text-slate-400">
              {archivos.length === 0 ? "No hay archivos en la carpeta." : "Ningún archivo coincide."}
            </p>
          ) : (
            <>
            {!busqueda && sugerencias.length > 0 && (
              <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400">
                Toda la carpeta
              </p>
            )}
            <ul className="max-h-80 divide-y divide-slate-100 overflow-y-auto card">
              {visibles.map((a) => (
                <li key={a.id} className="flex items-center justify-between gap-3 px-3 py-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm text-slate-900">{a.nombre}</p>
                    <p className="text-xs text-slate-400">
                      Modificada {fechaHora(a.modificado)}
                      {!a.esPlanillaGoogle && " · no es una planilla de Google"}
                    </p>
                  </div>
                  <button
                    onClick={() => adjuntar(a)}
                    disabled={!a.esPlanillaGoogle || adjuntando !== null}
                    className="shrink-0 rounded-lg bg-[var(--primary)] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[var(--primary-dark)] disabled:opacity-40"
                  >
                    {adjuntando === a.id ? "Trayendo…" : "Usar esta"}
                  </button>
                </li>
              ))}
            </ul>
            </>
          )}
        </div>
    </Modal>
  );
}
