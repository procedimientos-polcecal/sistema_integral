"use client";

import { useState } from "react";
import Link from "next/link";
import { haceCuanto } from "@/lib/core/haceCuanto";
import { useCargar } from "@/lib/core/useCargar";
import {
  agruparPorRegistro,
  comoSeLlega,
  type MencionDeLaBandeja,
  type RegistroConMenciones,
} from "@/lib/mensajes/bandeja";

/**
 * Lo que me escribieron y todavía no leí, un renglón por registro.
 *
 * ## Cómo deja de estar sin leer
 *
 * Por dos caminos, y los dos son un `PATCH /api/mensajes/mios` y ninguno es un
 * efecto de mirar esta pantalla —un GET que escribe se dispara con cualquier
 * precarga y marcaría como visto lo que nadie vio—:
 *
 * - **Abriendo la conversación.** `HiloDeMensajes` marca las propias **al
 *   abrirse**, y no al mostrarse: el hilo arranca plegado en una barra, y
 *   plegado nadie vio los mensajes —marcarlos ahí le diría al autor «ya lo vio»
 *   sin que sea cierto—. Llegan abiertos los dos enlaces que van derecho a la
 *   conversación, el del requerimiento y el de la condición insegura; en todo
 *   lo demás hay que desplegar la barra.
 * - **Con el botón «Marcar como leído».** Desde que el hilo arranca plegado,
 *   **éste es el camino principal y no el de respaldo**: alcanza con que el
 *   enlace no llegue hasta la conversación —el de una orden de trabajo lleva a
 *   la lista filtrada, y la conversación está adentro de la orden— o con que
 *   quien lee no despliegue la barra. Quien ya leyó el mensaje en el correo
 *   cierra la mención desde acá y no tiene que abrir nada.
 *
 * Marcar es por hilo —lo que acepta el `PATCH`— y por eso las tarjetas son por
 * registro y no por mensaje.
 *
 * ## Lo que esta pantalla no muestra, y lo dice
 *
 * Una mención de un registro que ya no se puede abrir no sale: la ruta la
 * saltea, para no mostrar el texto de un mensaje a quien perdió el acceso.
 * Como desde acá no se puede distinguir «no tengo nada» de «tengo algo que ya
 * no puedo ver», el pie lo aclara y no promete más de lo que sabe.
 */
export default function MisMencionesClient() {
  const [menciones, setMenciones] = useState<MencionDeLaBandeja[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState("");
  // Las tarjetas que se están marcando, por clave `tipo:id`: se deshabilita sólo ese botón.
  const [marcando, setMarcando] = useState<Set<string>>(new Set());
  const [errorAlMarcar, setErrorAlMarcar] = useState("");

  const recargar = useCargar(async (vigente) => {
    setCargando(true);
    let res: Response;
    try {
      res = await fetch("/api/mensajes/mios");
    } catch {
      if (!vigente()) return;
      setError("No se pudieron leer tus menciones: no hay conexión con el servidor.");
      setCargando(false);
      return;
    }
    const cuerpo = (await res.json().catch(() => ({}))) as {
      error?: string;
      data?: MencionDeLaBandeja[];
    };
    if (!vigente()) return;
    setCargando(false);
    if (!res.ok) {
      setError(cuerpo.error ?? "No se pudieron leer tus menciones.");
      return;
    }
    setError("");
    setMenciones(cuerpo.data ?? []);
  }, []);

  const registros = agruparPorRegistro(menciones);

  async function marcarComoLeido(r: RegistroConMenciones) {
    const clave = `${r.tipo}:${r.id}`;
    setErrorAlMarcar("");
    setMarcando((a) => new Set(a).add(clave));
    try {
      const res = await fetch("/api/mensajes/mios", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tipo: r.tipo, id: r.id }),
      });
      if (!res.ok) {
        const cuerpo = (await res.json().catch(() => ({}))) as { error?: string };
        setErrorAlMarcar(cuerpo.error ?? "No se pudo marcar como leído.");
        return;
      }
      // Sale de la lista sólo cuando el servidor dijo que sí.
      setMenciones((actuales) =>
        actuales.filter((m) => !(m.tipo === r.tipo && m.id === r.id))
      );
    } catch {
      setErrorAlMarcar("No se pudo marcar como leído: no hay conexión con el servidor.");
    } finally {
      setMarcando((a) => {
        const nuevo = new Set(a);
        nuevo.delete(clave);
        return nuevo;
      });
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Mis menciones</h1>
          <p className="text-sm text-slate-500">
            Lo que te escribieron en una orden de trabajo, un requerimiento de compra o una
            condición insegura y todavía no leíste.
          </p>
        </div>
        <button
          type="button"
          onClick={recargar}
          disabled={cargando}
          className="btn-secondary"
        >
          Volver a leer
        </button>
      </div>

      {error && (
        <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {errorAlMarcar && (
        <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {errorAlMarcar}
        </div>
      )}

      {cargando && registros.length === 0 ? (
        <p className="py-12 text-center text-sm text-slate-400">Cargando…</p>
      ) : registros.length === 0 ? (
        !error && (
          <p className="rounded-xl border border-slate-200 bg-white px-4 py-8 text-center text-sm text-slate-500">
            No tenés menciones sin leer.
          </p>
        )
      ) : (
        <ul className="space-y-3">
          {registros.map((r) => {
            const clave = `${r.tipo}:${r.id}`;
            const llegar = comoSeLlega(r.tipo, r.titulo);
            return (
              <li key={clave} className="rounded-xl border border-slate-200 bg-white p-4">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                  <p className="text-sm font-semibold text-slate-900">
                    {r.titulo.charAt(0).toUpperCase() + r.titulo.slice(1)}
                  </p>
                  <p className="text-xs text-slate-400">
                    {r.mensajes.length === 1 ? "1 mensaje" : `${r.mensajes.length} mensajes`}
                  </p>
                </div>

                <ul className="mt-2 space-y-1.5">
                  {r.mensajes.map((m) => (
                    <li key={m.mensaje_id} className="rounded-lg bg-slate-50 px-3 py-2">
                      <p className="text-sm text-slate-800 whitespace-pre-wrap break-words">{m.texto}</p>
                      <p className="mt-0.5 text-xs text-slate-400">
                        {m.autor ?? "—"} ·{" "}
                        <span title={new Date(m.creado_en).toLocaleString("es-AR")}>
                          {haceCuanto(m.creado_en)}
                        </span>
                      </p>
                    </li>
                  ))}
                </ul>

                {!r.existe && (
                  <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">
                    Este registro ya no está, así que no hay a dónde ir. Lo que se escribió queda
                    acá hasta que lo marques como leído.
                  </p>
                )}

                {r.existe && llegar.nota && (
                  <p className="mt-2 text-xs text-slate-500">{llegar.nota}</p>
                )}

                <div className="mt-3 flex flex-wrap items-center gap-2">
                  {r.existe && (
                    <Link href={r.ruta} className="btn-primary">
                      {llegar.boton}
                    </Link>
                  )}
                  <button
                    type="button"
                    onClick={() => marcarComoLeido(r)}
                    disabled={marcando.has(clave)}
                    className="btn-secondary"
                  >
                    {marcando.has(clave) ? "Marcando…" : "Marcar como leído"}
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <p className="text-xs text-slate-400">
        Una mención se marca sola cuando abrís la conversación del registro, o con el botón. Sólo
        aparecen las de registros que todavía podés abrir: si perdiste el acceso a uno, su mención
        no se muestra acá.
      </p>
    </div>
  );
}
