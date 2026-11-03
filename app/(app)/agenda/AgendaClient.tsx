"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useConfirm } from "@/components/ConfirmProvider";
import {
  DIAS_DE_HISTORIAL, leerRespuestaDeEscritura, separarProximosYPasados, type EventoVista,
} from "@/lib/agenda/vista";
import EventoModal, { type UsuarioInvitable } from "./EventoModal";
import TarjetaDeEvento from "./TarjetaDeEvento";

/**
 * La Agenda: los eventos que la persona creó y aquellos a los que la invitaron,
 * los próximos primero y el pasado detrás.
 *
 * ── DESPUÉS DE ESCRIBIR, SE RECARGA DEL SERVIDOR ────────────────────────────
 *
 * Ninguna acción usa la fila que devuelven las rutas: llaman a
 * `router.refresh()` y la página vuelve a leer. Es la única lectura que trae
 * `divergencia_vista` bien resuelta, y las respuestas de escritura no tienen
 * todas la misma forma (ver `EventoVista`). De ellas se lee sólo si salió bien
 * y qué avisó Google, con `leerRespuestaDeEscritura`. También se recarga cuando
 * salió **mal**: una ruta puede fallar a la mitad —guardó el cambio y no los
 * invitados— y la pantalla no tiene que quedar mostrando lo de antes.
 *
 * ── UN AVISO DE GOOGLE NO SE CIERRA SOLO ────────────────────────────────────
 *
 * Un fallo de escritura a Google no es un error de la pantalla: el evento quedó
 * guardado. Pero tampoco es nada, y es la regla de este repo que no se traga:
 * queda arriba, con lo que Google dijo, hasta que alguien lo cierre.
 */
export default function AgendaClient({
  eventos, miId, ahoraIso, usuarios, numerosDeOT, historial,
}: {
  eventos: EventoVista[];
  miId: string;
  /** El «ahora» del servidor, para que próximos y pasados no cambien entre el render del servidor y el del navegador. */
  ahoraIso: string;
  usuarios: UsuarioInvitable[];
  /** `ot_id` → número de la orden, de las que quien mira puede leer. */
  numerosDeOT: Record<string, number>;
  historial: boolean;
}) {
  const router = useRouter();
  const confirm = useConfirm();

  const [modal, setModal] = useState<{ evento: EventoVista | null } | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [avisos, setAvisos] = useState<string[]>([]);

  const { proximos, pasados } = separarProximosYPasados(eventos, Date.parse(ahoraIso));
  const nombrePorCorreo = Object.fromEntries(usuarios.filter((u) => u.nombre).map((u) => [u.email, u.nombre]));

  /** Una acción sobre un evento: la ruta, lo que dijo, y recargar. */
  async function accion(id: string, que: string, pedido: () => Promise<Response>) {
    setOcupado(id);
    setError("");
    try {
      const res = await pedido();
      const cuerpo = await res.json().catch(() => null);
      const r = leerRespuestaDeEscritura(res.status, cuerpo);
      if (!r.ok) setError(r.error ?? `No se pudo ${que}.`);
      else if (r.advertencia) setAvisos((a) => [...a, r.advertencia as string]);
      router.refresh();
    } catch (e) {
      setError(`No se pudo ${que}: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setOcupado(null);
    }
  }

  const post = (url: string, cuerpo?: unknown) => () =>
    fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(cuerpo ?? {}),
    });

  async function borrar(e: EventoVista) {
    const ok = await confirm({
      title: "¿Borrar el evento?",
      message:
        `«${e.titulo}» se borra del SdG y del calendario de Google.` +
        (e.invitados.length > 0 ? " A los invitados les llega la cancelación por correo." : "") +
        "\nNo se puede deshacer.",
      confirmText: "Borrar",
      danger: true,
    });
    if (ok) await accion(e.id, "borrar el evento", () => fetch(`/api/agenda/eventos/${e.id}`, { method: "DELETE" }));
  }

  async function destrabar(e: EventoVista, como: "reescribir" | "aceptar") {
    const ok = await confirm({
      title: como === "reescribir" ? "¿Volver a poner lo del sistema?" : "¿Aceptar lo de Google?",
      message:
        como === "reescribir"
          ? (e.divergencia === "borrado"
              ? `«${e.titulo}» se vuelve a crear en Google con lo que dice el SdG.`
              : `Google pasa a decir lo que dice el SdG para «${e.titulo}».`) +
            "\nEl sistema vuelve a mover este evento solo."
          : `El SdG pasa a mostrar para «${e.titulo}» el horario que hoy tiene Google.` +
            "\nEl sistema vuelve a mover este evento solo.",
      confirmText: como === "reescribir" ? "Volver a poner lo del sistema" : "Aceptar lo de Google",
    });
    if (ok) await accion(e.id, "destrabar el evento", post(`/api/agenda/eventos/${e.id}/destrabar`, { como }));
  }

  function tarjeta(e: EventoVista, pasado: boolean) {
    return (
      <TarjetaDeEvento
        key={e.id}
        evento={e}
        miId={miId}
        numeroDeOT={e.otId ? (numerosDeOT[e.otId] ?? null) : null}
        nombrePorCorreo={nombrePorCorreo}
        pasado={pasado}
        ocupado={ocupado === e.id}
        onEditar={() => setModal({ evento: e })}
        onBorrar={() => void borrar(e)}
        onVisto={() => void accion(e.id, "dar por vista la alerta", post(`/api/agenda/eventos/${e.id}/visto`))}
        onDestrabar={(como) => void destrabar(e, como)}
      />
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Agenda</h1>
          <p className="text-sm text-slate-500">
            Tus eventos y aquellos a los que te invitaron. Se reflejan en Google Calendar.
          </p>
        </div>
        <button type="button" className="btn-primary" onClick={() => setModal({ evento: null })}>
          Nuevo evento
        </button>
      </div>

      {error && (
        <div className="flex items-start justify-between gap-3 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-800" role="alert">
          <span className="break-words">{error}</span>
          <button type="button" className="shrink-0 font-medium underline" onClick={() => setError("")}>Cerrar</button>
        </div>
      )}

      {avisos.map((a, i) => (
        <div
          key={i}
          className="flex items-start justify-between gap-3 rounded-lg border px-4 py-3 text-sm text-slate-800"
          style={{ background: "#FFFBEB", borderColor: "#FCD34D" }}
          role="alert"
        >
          <span className="break-words">{a}</span>
          <button
            type="button"
            className="shrink-0 font-medium underline"
            onClick={() => setAvisos((v) => v.filter((_, j) => j !== i))}
          >
            Entendido
          </button>
        </div>
      ))}

      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Próximos</h2>
        {proximos.length === 0 ? (
          <p className="text-sm text-slate-500">No tenés eventos por venir.</p>
        ) : (
          <div className="space-y-3">{proximos.map((e) => tarjeta(e, false))}</div>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Anteriores</h2>
        {pasados.length === 0 ? (
          <p className="text-sm text-slate-500">
            {historial ? "No hay eventos anteriores." : `No hay eventos de los últimos ${DIAS_DE_HISTORIAL} días.`}
          </p>
        ) : (
          <div className="space-y-3">{pasados.map((e) => tarjeta(e, true))}</div>
        )}

        {/* La pantalla no pide todo el pasado: una agenda crece sin techo. Lo
            divergido viene siempre, sea de cuando sea. */}
        <p className="text-sm text-slate-500">
          {historial ? (
            <>
              Mostrando todo el historial.{" "}
              <Link href="/agenda" className="font-medium text-blue-700 underline">Volver a los últimos {DIAS_DE_HISTORIAL} días</Link>
            </>
          ) : (
            <>
              Se muestran los últimos {DIAS_DE_HISTORIAL} días y los eventos con alguna alerta de Google.{" "}
              <Link href="/agenda?historial=1" className="font-medium text-blue-700 underline">Ver todo el historial</Link>
            </>
          )}
        </p>
      </section>

      {modal && (
        <EventoModal
          // Con `key`: abrir otro evento es un formulario nuevo y no el anterior con otros valores.
          key={modal.evento?.id ?? "nuevo"}
          evento={modal.evento}
          usuarios={usuarios}
          onCerrar={() => setModal(null)}
          onFallo={() => router.refresh()}
          onGuardado={(advertencia) => {
            setModal(null);
            if (advertencia) setAvisos((a) => [...a, advertencia]);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}
