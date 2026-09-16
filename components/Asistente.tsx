"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";

/**
 * El asistente, como panel lateral sobre cualquier pantalla.
 *
 * Se abre con Ctrl+K (Cmd+K en Mac) o desde el botón del Header. Le manda al
 * backend en qué ruta está parado quien pregunta: con eso, "¿cuántos hay
 * pendientes?" desde Compras se entiende sin aclararlo.
 *
 * No hay pantalla completa a propósito. Es lo que se quiere a la larga, pero se
 * gana el lugar cuando las respuestas ya sean buenas.
 */
export function Asistente({ habilitado }: { habilitado: boolean }) {
  const [abierto, setAbierto] = useState(false);
  const [texto, setTexto] = useState("");
  const pathname = usePathname();

  const { messages, sendMessage, status, error } = useChat({
    transport: new DefaultChatTransport({ api: "/api/asistente" }),
  });

  useEffect(() => {
    if (!habilitado) return;
    function atajo(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setAbierto((a) => !a);
      }
      if (e.key === "Escape") setAbierto(false);
    }
    window.addEventListener("keydown", atajo);
    return () => window.removeEventListener("keydown", atajo);
  }, [habilitado]);

  if (!habilitado) return null;

  function enviar(e: React.FormEvent) {
    e.preventDefault();
    if (!texto.trim()) return;
    sendMessage({ text: texto }, { body: { pantalla: pathname } });
    setTexto("");
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setAbierto(true)}
        title="Preguntarle al sistema (Ctrl+K)"
        className="flex h-8 w-8 items-center justify-center rounded-lg transition hover:bg-white/10"
        style={{ color: "var(--sidebar-text)", background: "none", border: "none", cursor: "pointer" }}
      >
        <IconChispa />
      </button>

      {abierto && (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/20" onClick={() => setAbierto(false)}>
          <aside
            className="flex h-full w-full max-w-[520px] flex-col bg-white shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <header className="flex items-center justify-between border-b px-4 py-3">
              <div>
                <h2 className="text-sm font-semibold">Preguntarle al sistema</h2>
                <p className="text-xs text-gray-500">Sólo ve lo que vos podés ver.</p>
              </div>
              <button type="button" onClick={() => setAbierto(false)} className="text-sm text-gray-400 hover:text-gray-600">
                Cerrar
              </button>
            </header>

            <div className="flex-1 space-y-4 overflow-y-auto p-4">
              {messages.length === 0 && (
                <p className="text-sm text-gray-500">
                  Preguntale por los datos del sistema o por cómo se usa. Por ejemplo:{" "}
                  <em>¿cuántos requerimientos están pendientes de aprobación?</em>
                </p>
              )}
              {messages.map((m) => (
                <Mensaje key={m.id} mensaje={m} />
              ))}
              {status === "submitted" && <p className="text-sm text-gray-400">Pensando…</p>}
              {error && (
                // Sin traducir: un diagnóstico que no se distingue de otro no es
                // un diagnóstico. Misma regla que los errores de Google.
                <p className="rounded border border-red-200 bg-red-50 p-2 text-sm text-red-700">
                  {error.message}
                </p>
              )}
            </div>

            <form onSubmit={enviar} className="flex gap-2 border-t p-3">
              <input
                value={texto}
                onChange={(e) => setTexto(e.target.value)}
                placeholder="¿Qué querés saber?"
                className="input flex-1"
                autoFocus
              />
              <button type="submit" className="btn-primary" disabled={status !== "ready"}>
                Preguntar
              </button>
            </form>
          </aside>
        </div>
      )}
    </>
  );
}

/**
 * Un mensaje, con el SQL a la vista.
 *
 * Mostrar la consulta no es decoración: es lo único que convierte un número
 * equivocado en un número *detectablemente* equivocado. Con SQL generado, de vez
 * en cuando va a dar algo que parece bien y está mal.
 */
function Mensaje({ mensaje }: { mensaje: { role: string; parts?: unknown[] } }) {
  const esDeLaPersona = mensaje.role === "user";
  const partes = (mensaje.parts ?? []) as Array<Record<string, unknown>>;

  return (
    <div className={esDeLaPersona ? "text-right" : ""}>
      {partes.map((p, i) => {
        if (p.type === "text") {
          return (
            <p
              key={i}
              className={
                esDeLaPersona
                  ? "inline-block rounded-lg bg-slate-100 px-3 py-2 text-sm"
                  : "whitespace-pre-wrap text-sm text-gray-800"
              }
            >
              {String(p.text)}
            </p>
          );
        }

        if (p.type === "tool-consultar" && p.input) {
          const entrada = p.input as { sql?: string };
          const salida = p.output as { cuantas?: number; error?: string } | undefined;
          return (
            <details key={i} className="mt-2 rounded border border-slate-200 bg-slate-50 p-2 text-left">
              <summary className="cursor-pointer text-xs text-gray-500">
                {salida?.error ? "La consulta falló" : `Consulta · ${salida?.cuantas ?? "…"} filas`}
              </summary>
              <pre className="mt-2 overflow-x-auto text-xs text-gray-700">{entrada.sql}</pre>
              {salida?.error && <p className="mt-1 text-xs text-red-600">{salida.error}</p>}
            </details>
          );
        }

        if (p.type === "tool-armar_carga") {
          const salida = p.output as { url?: string; error?: string } | undefined;
          if (!salida?.url) return null;
          return (
            <Link key={i} href={salida.url} className="btn-primary mt-2 inline-block text-sm">
              Abrir el formulario con los datos puestos
            </Link>
          );
        }

        return null;
      })}
    </div>
  );
}

function IconChispa() {
  return (
    <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
      <path d="M12 3l1.8 4.9L18.7 9.7l-4.9 1.8L12 16.4l-1.8-4.9L5.3 9.7l4.9-1.8L12 3z" strokeLinejoin="round" />
      <path d="M18 15l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8L18 15z" strokeLinejoin="round" />
    </svg>
  );
}
