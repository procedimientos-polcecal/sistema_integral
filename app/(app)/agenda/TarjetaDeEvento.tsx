"use client";

import Link from "next/link";
import {
  avisoDelPendiente, horarioDelEvento, mientrasEstaDivergido, permisosDelEvento, type EventoVista,
} from "@/lib/agenda/vista";

/**
 * Un evento de la Agenda, con lo que hace falta saber de él y los botones que
 * le tocan a quien mira.
 *
 * Qué botones salen no se decide acá sino en `permisosDelEvento`, que tiene
 * tests; esto sólo los dibuja. Las rutas vuelven a exigirlo igual.
 *
 * Los colores de estado van por `style` y no por utilidades: `.card` y los
 * `.btn-*` están declarados fuera de toda capa y una utilidad de Tailwind puesta
 * al lado de su `border`, su `color` o su `font-size` pierde sin avisar.
 */
export interface Props {
  evento: EventoVista;
  miId: string;
  /** Número de la OT de la que viene, si se pudo leer (quien no ve Mantenimiento no la lee). */
  numeroDeOT: number | null;
  /** Nombre por correo, para escribir «Ana Paz» y no sólo el mail cuando se lo conoce. */
  nombrePorCorreo: Record<string, string>;
  pasado: boolean;
  ocupado: boolean;
  onEditar: () => void;
  onBorrar: () => void;
  onVisto: () => void;
  onDestrabar: (como: "reescribir" | "aceptar") => void;
}

const AMBAR = { background: "#FFFBEB", borderColor: "#FCD34D" } as const;
const GRIS = { background: "#F8FAFC", borderColor: "#CBD5E1" } as const;

export default function TarjetaDeEvento({
  evento: e, miId, numeroDeOT, nombrePorCorreo, pasado, ocupado,
  onEditar, onBorrar, onVisto, onDestrabar,
}: Props) {
  const p = permisosDelEvento(e, miId);
  const esMio = e.duenoId === miId;
  const dueno = e.duenoNombre ?? e.casilla;
  const deUnaOT = e.otId !== null;

  return (
    <div className="card overflow-hidden">
      {e.divergencia && (
        <PanelDeDivergencia
          evento={e} dueno={dueno} esMio={esMio} p={p}
          ocupado={ocupado} onVisto={onVisto} onDestrabar={onDestrabar}
        />
      )}

      {/* La atenuación de un evento pasado va acá y no en la tarjeta: el panel de
          divergencia de arriba es la alerta, y no se baja. */}
      <div className="space-y-3 p-4" style={pasado ? { opacity: 0.8 } : undefined}>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <h3 className="break-words text-base font-semibold text-slate-900">{e.titulo}</h3>
            <p className="text-sm text-slate-600">{horarioDelEvento(e.inicio, e.fin)}</p>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {deUnaOT && (
              <span className="rounded-full px-2 py-0.5 text-xs font-medium" style={{ background: "#E0F2FE", color: "#075985" }}>
                Orden de trabajo{e.turno ? ` · turno ${e.turno}` : ""}
              </span>
            )}
            {!esMio && (
              <span className="rounded-full px-2 py-0.5 text-xs font-medium" style={{ background: "#F1F5F9", color: "#475569" }}>
                Te invitaron
              </span>
            )}
          </div>
        </div>

        {e.lugar && <p className="text-sm text-slate-700"><span className="text-slate-500">Lugar:</span> {e.lugar}</p>}
        {e.descripcion && <p className="whitespace-pre-line break-words text-sm text-slate-700">{e.descripcion}</p>}

        {e.invitados.length > 0 && (
          <p className="break-words text-sm text-slate-700">
            <span className="text-slate-500">Invitados:</span>{" "}
            {e.invitados.map((c, i) => (
              <span key={c}>
                {i > 0 && ", "}
                {nombrePorCorreo[c] ? <>{nombrePorCorreo[c]} <span className="text-slate-400">({c})</span></> : c}
              </span>
            ))}
          </p>
        )}

        {!esMio && <p className="text-sm text-slate-500">Lo creó {dueno}.</p>}

        {e.googlePendiente && (
          <p className="rounded-lg border px-3 py-2 text-sm text-slate-800" style={AMBAR}>
            <strong>No llegó a Google.</strong> {avisoDelPendiente(e)}
          </p>
        )}

        {e.aviso && (
          <p className="rounded-lg border px-3 py-2 text-sm text-slate-800" style={AMBAR}>{e.aviso}</p>
        )}

        {deUnaOT && <CajaDeLaOT numero={numeroDeOT} />}

        {p.puedeEditarYBorrar && (
          <div className="flex flex-wrap gap-2 pt-1">
            <button type="button" className="btn-secondary" disabled={ocupado} onClick={onEditar}>Editar</button>
            <button type="button" className="btn-danger" disabled={ocupado} onClick={onBorrar}>Borrar</button>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * De qué orden viene el evento, y por qué no se toca desde acá.
 *
 * El motivo está en pantalla y no sólo en el código porque es lo que la persona
 * se va a preguntar al no ver «Editar»: no es un permiso que le falte, es que el
 * evento es de la orden.
 */
function CajaDeLaOT({ numero }: { numero: number | null }) {
  return (
    <div className="rounded-lg border px-3 py-2 text-sm text-slate-700" style={GRIS}>
      <p>
        Este evento viene de {numero === null ? "una orden de trabajo" : <>la orden de trabajo <strong>#{numero}</strong></>}.
        {numero !== null && (
          <>{" "}<Link href={`/mantenimiento/ordenes?q=${numero}`} className="font-medium text-blue-700 underline">Ver la orden</Link></>
        )}
      </p>
      <p className="mt-1 text-slate-600">
        No se edita ni se borra desde la Agenda: su horario sale de la fecha de ejecución de la orden, y la
        sincronización con la planilla lo vuelve a escribir cuando esa fecha cambia. Un cambio hecho acá
        desaparecería sin aviso. Se cambia desde la orden.
      </p>
      {numero === null && (
        <p className="mt-1 text-slate-500">No se pudo leer el número de la orden: puede que no tengas acceso a Mantenimiento.</p>
      )}
    </div>
  );
}

/**
 * Un evento que alguien movió o borró desde Google. Dice **dos cosas distintas
 * y no hay que mezclarlas**:
 *
 * - «Ya lo vi» apaga la campana **para quien lo aprieta** y nada más. El evento
 *   sigue divergido.
 * - «Destrabar» es del dueño, y es lo que vuelve a atar el evento al SdG.
 *   **Hasta que elija, el sistema deja de mover ese evento solo** —si es de una
 *   OT— **o de escribirlo en Google, si es propio** (`mientrasEstaDivergido`). Sin
 *   esa frase en pantalla, alguien ve que su orden cambió de fecha y el evento no
 *   se movió, y no entiende por qué.
 */
function PanelDeDivergencia({
  evento: e, dueno, esMio, p, ocupado, onVisto, onDestrabar,
}: {
  evento: EventoVista;
  dueno: string;
  esMio: boolean;
  p: ReturnType<typeof permisosDelEvento>;
  ocupado: boolean;
  onVisto: () => void;
  onDestrabar: (como: "reescribir" | "aceptar") => void;
}) {
  const borrado = e.divergencia === "borrado";
  const deUnaOT = e.otId !== null;
  const mientras = mientrasEstaDivergido(e, esMio ? "elijas" : `${dueno} elija`);

  return (
    <div className="space-y-2 border-b px-4 py-3 text-sm text-slate-800" style={AMBAR} role="alert">
      <p className="font-semibold">
        {borrado ? "Alguien borró este evento desde Google Calendar." : "Alguien cambió este evento de horario desde Google Calendar."}
      </p>
      <p>
        {borrado
          ? "En Google ya no existe: los invitados dejaron de verlo en su calendario. Lo que se ve acá es lo que el SdG tiene guardado."
          : "Lo que se ve acá es lo que el SdG tiene guardado; en Google está en otro horario."}
      </p>
      <p>
        <strong>{mientras.negrita}</strong>
        {mientras.resto && ` ${mientras.resto}`}
      </p>

      {p.puedeDestrabar ? (
        <div className="space-y-2 pt-1">
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn-primary" disabled={ocupado} onClick={() => onDestrabar("reescribir")}>
              Volver a poner lo del sistema
            </button>
            {p.puedeAceptar && (
              <button type="button" className="btn-secondary" disabled={ocupado} onClick={() => onDestrabar("aceptar")}>
                Aceptar lo de Google
              </button>
            )}
          </div>
          <p className="text-slate-600">
            <strong>Volver a poner lo del sistema:</strong>{" "}
            {borrado ? "se vuelve a crear en Google con lo que dice el SdG." : "Google pasa a decir lo que dice el SdG."}
            {p.puedeAceptar && <>{" "}<strong>Aceptar lo de Google:</strong> el SdG pasa a mostrar el horario que tiene Google.</>}
          </p>
          {!p.puedeAceptar && (
            <p className="text-slate-600">
              «Aceptar lo de Google» no está disponible:{" "}
              {/* `borrado` se pregunta primero y no es un detalle: el motivo ahí es que
                  Google no tiene horario porque el evento no está, también en una OT. Con
                  `deUnaOT` adelante, un evento de OT borrado explicaba un motivo falso. */}
              {borrado
                ? deUnaOT
                  ? "Google no tiene un horario para aceptar porque el evento no está. Para volver a ponerlo, «Volver a poner lo del sistema»."
                  : "Google no tiene un horario para aceptar porque el evento no está. Para volver a ponerlo, «Volver a poner lo del sistema»; si ya no lo querés, borralo."
                : "para una orden de trabajo la verdad es la orden, y aceptar un horario de Google lo cambiaría acá para que la próxima sincronización lo vuelva a pisar."}
            </p>
          )}
        </div>
      ) : (
        <p className="text-slate-600">Lo puede destrabar quien lo creó ({dueno}).</p>
      )}

      <div className="flex flex-wrap items-center gap-2 border-t pt-2" style={{ borderColor: "#FDE68A" }}>
        {p.puedeDarPorVisto ? (
          <>
            <button type="button" className="btn-secondary" disabled={ocupado} onClick={onVisto}>Ya lo vi</button>
            <span className="text-slate-600">Apaga la campana para vos. No cambia el evento ni lo destraba.</span>
          </>
        ) : (
          <span className="text-slate-600">Ya lo viste: la campana está apagada para vos. El evento sigue divergido.</span>
        )}
      </div>
    </div>
  );
}
