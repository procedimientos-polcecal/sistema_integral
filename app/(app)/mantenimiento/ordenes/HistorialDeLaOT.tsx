import { haceCuanto } from "@/lib/core/haceCuanto";
import {
  preguntasAbiertas, preguntasSinResponder, type NotaDeLaOT, type TipoDeNota,
} from "@/lib/mantenimiento/consultaDeRepuesto";

/**
 * La lista del historial de una orden: una entrada por nota, con su tipo y lo que
 * le pasó a cada pregunta.
 *
 * Es sólo dibujo —no lee ni escribe nada— y salió de `JustificacionOT` por una razón:
 * lo que decide **a qué entradas se les ofrece «Ya llegó»** es la regla más fácil de
 * romper sin que nada avise, y para probarla hacía falta poder dibujar la lista con
 * unas notas en la mano. Recibe las **notas** y no los ids ya decididos, a propósito:
 * es ella la que elige con qué función las clasifica, y es esa elección la que cuida
 * `lib/mantenimiento/historialDeLaOT.test.ts`. Si recibiera la lista de las abiertas
 * ya armada, la rotura viviría en quien la arma y el test no la vería.
 *
 * LO QUE ESTÁ ABIERTO NO ES LO QUE NO TIENE RESPUESTA
 *
 * «Esperando» es **pertenecer a `preguntasAbiertas`**. Cambiarlo por «una PREGUNTA que
 * ninguna RESPUESTA apunta» pasa toda la suite de `lib/` y es un error: una pregunta
 * superada por un seguimiento tampoco tiene respuesta y ya no espera, y un «Ya llegó»
 * escrito sobre ella no cierra nada —el seguimiento sigue abierto—. Tampoco la tiene la
 * de una orden suspendida, ni la de un repuesto que sacaron de la lista.
 *
 * Esas dos últimas —la orden suspendida y el repuesto que sacaron de la lista— son
 * las que «quedaron sin responder»: se rotulan en vez de desaparecer, que es lo que
 * pide el diseño, y se derivan de las filas sin guardar nada
 * (`preguntasSinResponder`).
 *
 * **La superada por un seguimiento no lleva ese rótulo**, aunque tampoco tenga
 * respuesta: el hilo sigue vivo en la última, y es ésa la que queda sin responder si
 * termina así. Rotular también a la primera diría dos veces lo mismo sobre una sola
 * conversación. Lo decide `preguntasSinResponder` con `!estaSuperada` y hay un test
 * que lo fija; este comentario decía lo contrario hasta el 31/10/2026.
 */

export interface NotaDelHistorial extends NotaDeLaOT {
  autor: { nombre: string } | null;
}

/** Cómo se rotula cada tipo de entrada. */
const ROTULO: Record<TipoDeNota, { texto: string; color: string }> = {
  JUSTIFICACION: { texto: "Justificación", color: "bg-slate-100 text-slate-500" },
  PREGUNTA: { texto: "Pregunta a Compras", color: "bg-amber-100 text-amber-800" },
  RESPUESTA: { texto: "Respuesta", color: "bg-green-100 text-green-800" },
};

export default function HistorialDeLaOT({
  notas, estado, puedeEditar, cerrando, onYaLlego, onBorrar, ahora,
}: {
  notas: readonly NotaDelHistorial[];
  /**
   * El estado de la orden. «Abierta» depende de él: una pregunta sobre una orden
   * realizada o suspendida ya no espera nada, y sin esto la lista seguiría ofreciendo
   * cerrar una pregunta que nadie espera.
   */
  estado: string | null;
  puedeEditar: boolean;
  /** La pregunta que se está cerrando con «Ya llegó», si hay una: apaga los demás botones. */
  cerrando: string | null;
  onYaLlego: (pregunta: NotaDelHistorial) => void;
  onBorrar: (nota: NotaDelHistorial) => void;
  /** Sólo para los tests: cuándo es «ahora», para que «hace cuánto» no dependa del reloj. */
  ahora?: Date;
}) {
  if (notas.length === 0) return null;

  const esperando = new Set(preguntasAbiertas(notas, estado).map((p) => p.id));
  const sinResponder = new Set(preguntasSinResponder(notas, estado).map((p) => p.id));

  return (
    <ul className="space-y-1.5">
      {notas.map((n) => {
        // Un tipo que no conocemos se lee como lo que eran todas hasta ahora.
        const rotulo = ROTULO[n.tipo] ?? ROTULO.JUSTIFICACION;
        return (
          <li key={n.id} className="rounded-lg border border-slate-200 bg-white px-3 py-2">
            <p className="mb-1">
              <span
                className={`rounded px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${rotulo.color}`}
              >
                {rotulo.texto}
              </span>
            </p>
            <p className="text-sm text-slate-800 whitespace-pre-wrap">{n.texto}</p>

            {esperando.has(n.id) && (
              <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-amber-700">
                <span>Preguntado {haceCuanto(n.creado_en, ahora)}, sin respuesta</span>
                {puedeEditar && (
                  <button
                    onClick={() => onYaLlego(n)}
                    disabled={cerrando !== null}
                    className="rounded border border-amber-300 px-2 py-0.5 font-semibold text-amber-800 hover:bg-amber-50 disabled:opacity-50"
                  >
                    {cerrando === n.id ? "Cerrando…" : "Ya llegó"}
                  </button>
                )}
              </p>
            )}

            {sinResponder.has(n.id) && (
              <p className="mt-1 text-xs text-slate-500">
                Quedó sin responder:{" "}
                {n.repuesto_id === null
                  ? "se sacó el repuesto de la lista"
                  : "la orden ya no espera nada"}
                .
              </p>
            )}

            <p className="mt-0.5 flex items-center gap-2 text-xs text-slate-400">
              <span>
                {n.autor?.nombre ?? "—"} · <span title={new Date(n.creado_en).toLocaleString("es-AR")}>
                  {haceCuanto(n.creado_en, ahora)}
                </span>
              </span>
              {/* Sólo la propia, igual que la policy. El botón aparece para
                  todos los que pueden editar y el servidor es el que decide:
                  esconderlo según el usuario acá sería repetir la regla en un
                  segundo lugar, que es donde se desincronizan. */}
              {puedeEditar && (
                <button
                  onClick={() => onBorrar(n)}
                  className="text-slate-300 underline hover:text-red-600"
                >
                  Borrar
                </button>
              )}
            </p>
          </li>
        );
      })}
    </ul>
  );
}
