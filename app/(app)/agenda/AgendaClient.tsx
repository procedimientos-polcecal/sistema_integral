"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useConfirm } from "@/components/ConfirmProvider";
import { entradasDeLaBanda } from "@/lib/agenda/banda";
import { diasDelRango, hrefDeLaAgenda, type VistaDeAgenda } from "@/lib/agenda/rango";
import {
  DIAS_DE_HISTORIAL, consecuenciaDeDestrabar, diaYHoraDe, leerRespuestaDeEscritura, separarProximosYPasados,
  type EventoVista,
} from "@/lib/agenda/vista";
import BandaDeAlertas from "./BandaDeAlertas";
import BarraDeLaAgenda from "./BarraDeLaAgenda";
import type { Props as PropsDelCuerpo } from "./CuerpoDeEvento";
import DetalleDeEvento from "./DetalleDeEvento";
import EventoModal, { type UsuarioInvitable } from "./EventoModal";
import Grilla from "./Grilla";
import TarjetaDeEvento from "./TarjetaDeEvento";

/**
 * La Agenda: los eventos que la persona creó y aquellos a los que la invitaron,
 * en una grilla de calendario —la semana, o un día— o en la lista de siempre,
 * los próximos primero y el pasado detrás.
 *
 * ── LA SEMANA, EN UN TELÉFONO, DIBUJA UN SOLO DÍA ───────────────────────────
 *
 * Siete columnas de 43 px no se pueden leer, así que en un ancho de teléfono la
 * vista `semana` dibuja el día de `?dia=`. Se resuelve con CSS y **no con
 * `matchMedia`**: el servidor no conoce el ancho, y si lo adivina el navegador
 * lo corrige después con un salto en la hidratación. Se dibujan las dos grillas
 * y una se esconde (`hidden sm:block` / `sm:hidden`) —el mismo recurso que usa
 * la barra para sus flechas—, y el HTML del servidor ya es el correcto para los
 * dos anchos. Cuesta una grilla de más en el DOM, y al cruzar el breakpoint con
 * la pantalla abierta la que aparece arranca con su scroll en cero.
 *
 * ── EL DETALLE SE GUARDA POR ID Y NO POR EVENTO ─────────────────────────────
 *
 * Después de una acción la página se recarga y llegan eventos nuevos: el detalle
 * se busca en la lista cada vez, así que muestra lo recargado, y si el evento ya
 * no está —se borró— se cierra solo. Se cierra también cuando termina una acción
 * hecha desde él, salvo que se haya cancelado la confirmación: los errores y los
 * avisos de Google viven en la pantalla de atrás, y un modal encima los taparía.
 * Mientras la acción está en curso no se puede cerrar (ver `DetalleDeEvento`).
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
  eventos, miId, ahoraIso, usuarios, numerosDeOT, historial, lecturaFallo, vista, dia,
}: {
  eventos: EventoVista[];
  /** Qué se está mirando, de la URL. */
  vista: VistaDeAgenda;
  /** El día que se mira (`YYYY-MM-DD`), de la URL. */
  dia: string;
  /** La lectura de eventos falló: la lista vacía no quiere decir «no hay». */
  lecturaFallo: boolean;
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

  const [modal, setModal] = useState<{
    evento: EventoVista | null;
    /** Un hueco de la grilla: día y hora en punto. */
    arranque?: { dia: string; desde: string };
  } | null>(null);
  const [detalleId, setDetalleId] = useState<string | null>(null);
  // Hay una confirmación abierta. La de `ConfirmProvider` no atiende Escape, y el
  // detalle que queda debajo sí: sin esto, esa tecla lo cerraba por detrás.
  const [confirmando, setConfirmando] = useState(false);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [avisos, setAvisos] = useState<string[]>([]);

  const ahoraMs = Date.parse(ahoraIso);
  const { proximos, pasados } = separarProximosYPasados(eventos, ahoraMs);
  const nombrePorCorreo = Object.fromEntries(usuarios.filter((u) => u.nombre).map((u) => [u.email, u.nombre]));

  // «Hoy» y la hora de la línea de «ahora» salen del instante del servidor, el
  // mismo que decide qué evento es pasado: la grilla no lee el reloj del navegador.
  const { dia: hoy, hora } = diaYHoraDe(ahoraIso);
  const ahoraMin = Number(hora.slice(0, 2)) * 60 + Number(hora.slice(3, 5));

  // Con la identidad estable: las memos de la grilla dependen de estos arreglos,
  // y uno nuevo en cada render reacomodaría todos los eventos cada vez.
  const diasDeLaSemana = useMemo(() => diasDelRango("semana", dia), [dia]);
  const unDia = useMemo(() => [dia], [dia]);
  const entradas = useMemo(() => entradasDeLaBanda(eventos), [eventos]);

  const hrefDe = (v: VistaDeAgenda, d: string) => hrefDeLaAgenda(v, d, historial);
  const detalle = detalleId === null ? undefined : eventos.find((e) => e.id === detalleId);

  async function confirmar(opciones: Parameters<typeof confirm>[0]): Promise<boolean> {
    setConfirmando(true);
    try {
      return await confirm(opciones);
    } finally {
      setConfirmando(false);
    }
  }

  /** Una acción sobre un evento: la ruta, lo que dijo, y recargar. */
  async function accion(id: string, que: string, pedido: () => Promise<Response>): Promise<void> {
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

  /** Devuelve si se hizo algo: `false` es que la persona se arrepintió en la confirmación. */
  async function borrar(e: EventoVista): Promise<boolean> {
    const ok = await confirmar({
      title: "¿Borrar el evento?",
      message:
        `«${e.titulo}» se borra del SdG y del calendario de Google.` +
        (e.invitados.length > 0 ? " A los invitados les llega la cancelación por correo." : "") +
        "\nNo se puede deshacer.",
      confirmText: "Borrar",
      danger: true,
    });
    if (!ok) return false;
    await accion(e.id, "borrar el evento", () => fetch(`/api/agenda/eventos/${e.id}`, { method: "DELETE" }));
    return true;
  }

  async function destrabar(e: EventoVista, como: "reescribir" | "aceptar"): Promise<boolean> {
    const consecuencia = consecuenciaDeDestrabar(e);
    const ok = await confirmar({
      title: como === "reescribir" ? "¿Volver a poner lo del sistema?" : "¿Aceptar lo de Google?",
      message:
        como === "reescribir"
          ? (e.divergencia === "borrado"
              ? `«${e.titulo}» se vuelve a crear en Google con lo que dice el SdG.`
              : `Google pasa a decir lo que dice el SdG para «${e.titulo}».`) +
            (consecuencia ? `\n${consecuencia}` : "")
          : `El SdG pasa a mostrar para «${e.titulo}» el horario que hoy tiene Google.` +
            (consecuencia ? `\n${consecuencia}` : ""),
      confirmText: como === "reescribir" ? "Volver a poner lo del sistema" : "Aceptar lo de Google",
    });
    if (!ok) return false;
    await accion(e.id, "destrabar el evento", post(`/api/agenda/eventos/${e.id}/destrabar`, { como }));
    return true;
  }

  /**
   * Lo que dice y puede hacer un evento: **la tarjeta y el detalle reciben lo
   * mismo**, los mismos manejadores. Desde el detalle, además, se cierra al
   * terminar una acción y al pasar al editor (ver el encabezado).
   */
  function propsDelCuerpo(e: EventoVista, pasado: boolean): PropsDelCuerpo {
    const alTerminar = (hecho: boolean) => { if (hecho) setDetalleId(null); };
    return {
      evento: e,
      miId,
      numeroDeOT: e.otId ? (numerosDeOT[e.otId] ?? null) : null,
      nombrePorCorreo,
      pasado,
      ocupado: ocupado === e.id,
      // El editor se abre en lugar del detalle y no encima: dos modales apilados
      // se pelean el Escape y el fondo.
      onEditar: () => { setDetalleId(null); setModal({ evento: e }); },
      onBorrar: () => void borrar(e).then(alTerminar),
      onVisto: () =>
        void accion(e.id, "dar por vista la alerta", post(`/api/agenda/eventos/${e.id}/visto`)).then(() => alTerminar(true)),
      onDestrabar: (como) => void destrabar(e, como).then(alTerminar),
    };
  }

  function tarjeta(e: EventoVista, pasado: boolean) {
    return <TarjetaDeEvento key={e.id} {...propsDelCuerpo(e, pasado)} />;
  }

  const sobreLaGrilla = {
    eventos,
    hoy,
    ahoraMin,
    onEvento: (e: EventoVista) => setDetalleId(e.id),
    onHueco: (d: string, desde: string) => setModal({ evento: null, arranque: { dia: d, desde } }),
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-slate-900">Agenda</h1>
        <p className="text-sm text-slate-500">
          Tus eventos y aquellos a los que te invitaron. Se reflejan en Google Calendar.
        </p>
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

      <BarraDeLaAgenda vista={vista} dia={dia} hoy={hoy} hrefDe={hrefDe} onNuevo={() => setModal({ evento: null })} />

      <BandaDeAlertas entradas={entradas} onEntrada={setDetalleId} />

      {vista === "semana" && (
        <>
          <div className="hidden sm:block"><Grilla dias={diasDeLaSemana} {...sobreLaGrilla} /></div>
          <div className="sm:hidden"><Grilla dias={unDia} {...sobreLaGrilla} /></div>
        </>
      )}
      {vista === "dia" && <Grilla dias={unDia} {...sobreLaGrilla} />}

      {vista === "lista" && (
        <>
          <section className="space-y-3">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Próximos</h2>
            {/* Con la lectura fallida no se dicen los estados vacíos: «falló» y «no
                hay» son dos cosas distintas, y juntas la persona cree la que le conviene. */}
            {proximos.length === 0 ? (
              !lecturaFallo && <p className="text-sm text-slate-500">No tenés eventos por venir.</p>
            ) : (
              <div className="space-y-3">{proximos.map((e) => tarjeta(e, false))}</div>
            )}
          </section>

          <section className="space-y-3">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Anteriores</h2>
            {pasados.length === 0 ? (
              !lecturaFallo && (
                <p className="text-sm text-slate-500">
                  {historial ? "No hay eventos anteriores." : `No hay eventos de los últimos ${DIAS_DE_HISTORIAL} días.`}
                </p>
              )
            ) : (
              <div className="space-y-3">{pasados.map((e) => tarjeta(e, true))}</div>
            )}

            {/* La pantalla no pide todo el pasado: una agenda crece sin techo. Lo
                divergido viene siempre, sea de cuando sea. */}
            <p className="text-sm text-slate-500">
              {historial ? (
                <>
                  Mostrando todo el historial.{" "}
                  <Link href={hrefDeLaAgenda("lista", dia, false)} className="font-medium text-blue-700 underline">
                    Volver a los últimos {DIAS_DE_HISTORIAL} días
                  </Link>
                </>
              ) : (
                <>
                  Se muestran los últimos {DIAS_DE_HISTORIAL} días y los eventos con alguna alerta de Google.{" "}
                  <Link href={hrefDeLaAgenda("lista", dia, true)} className="font-medium text-blue-700 underline">
                    Ver todo el historial
                  </Link>
                </>
              )}
            </p>
          </section>
        </>
      )}

      {detalle && (
        <DetalleDeEvento {...propsDelCuerpo(detalle, Date.parse(detalle.fin) < ahoraMs)} onCerrar={() => { if (!confirmando) setDetalleId(null); }} />
      )}

      {modal && (
        <EventoModal
          // Con `key`: abrir otro evento es un formulario nuevo y no el anterior con otros valores.
          key={modal.evento?.id ?? `nuevo|${modal.arranque?.dia ?? ""}|${modal.arranque?.desde ?? ""}`}
          evento={modal.evento}
          arranque={modal.arranque}
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
