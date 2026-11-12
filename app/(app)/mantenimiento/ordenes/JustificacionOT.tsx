"use client";

import { useState } from "react";
import { useCargar } from "@/lib/core/useCargar";
import { MAXIMO_DE_NOTA } from "@/lib/mantenimiento/notas";
import { TEXTO_DE_YA_LLEGO } from "@/lib/mantenimiento/consultaDeRepuesto";
import HistorialDeLaOT, { type NotaDelHistorial } from "./HistorialDeLaOT";

/**
 * Por qué una orden todavía no se hizo, y lo que Mantenimiento le preguntó a
 * Compras al respecto.
 *
 * Es el otro lado de la observación que ya existía: aquélla se completa **al
 * realizar** el trabajo —qué se encontró— y ésta explica por qué sigue abierta.
 * Por eso el bloque sólo aparece en las que no están realizadas.
 *
 * Se muestran todas y no sólo la última. Una OT atrasada se vuelve a justificar
 * con el tiempo, y leer "falta el repuesto" de hace dos meses arriba de
 * "esperamos la parada de planta" de ayer dice algo que ninguna de las dos dice
 * sola: que se viene postergando.
 *
 * El "hace cuánto" va al lado de cada una por lo mismo. Una justificación de
 * ayer y una de hace tres meses se leen igual sin eso, y no valen lo mismo.
 *
 * Las entradas son de tres tipos y cada una lo dice: una justificación, una
 * pregunta a Compras por un repuesto, y su respuesta. **Una pregunta que sigue
 * esperando se ve** —«preguntado hace 3 días, sin respuesta»—, que es el estado
 * que todo esto existe para hacer visible, y trae el botón «Ya llegó»: la
 * respuesta de quien preguntó, cuando la pieza llegó por otro lado.
 *
 * Acá viven la lectura y las escrituras. La lista, con la regla de a qué entradas
 * se les ofrece «Ya llegó», está en `HistorialDeLaOT`, que se puede dibujar sola.
 */

export default function JustificacionOT({
  ordenId, estado, puedeEditar, onCambio, version,
}: {
  ordenId: string;
  /**
   * El estado de la orden. «Abierta» depende de él: una pregunta sobre una orden
   * realizada o suspendida ya no espera nada, y sin esto la pantalla seguiría
   * ofreciendo cerrar una pregunta que nadie espera.
   */
  estado: string | null;
  puedeEditar: boolean;
  /** Para que el listado refresque el cartel de "sin justificar". */
  onCambio?: () => void;
  /**
   * Cambia cuando algo de afuera escribió en el historial —el modal de repuestos
   * al preguntar—: vuelve a leerlo. Sin esto la pregunta quedaba guardada y no
   * se veía hasta recargar la pantalla.
   */
  version?: number;
}) {
  const [notas, setNotas] = useState<NotaDelHistorial[]>([]);
  const [cargando, setCargando] = useState(true);
  // Por qué no se pudo leer, y vacío cuando se pudo. Sin esto una lectura rota
  // se veía igual que una orden sin justificar —«nadie dejó dicho por qué»—, que
  // es lo que pasa justo cuando la tabla todavía no tiene las columnas nuevas.
  const [falloLaLectura, setFalloLaLectura] = useState("");

  // `cargando` arranca en true y sólo baja: no se vuelve a subir al recargar.
  // Un "Buscando…" parpadeando sobre una lista que ya está es ruido, y además
  // subirlo desde el efecto es lo que el lint marca.
  const recargar = useCargar(async (vigente) => {
    const res = await fetch(`/api/mantenimiento/ordenes/${ordenId}/notas`);
    const body = await res.json().catch(() => ({}));
    if (!vigente()) return;
    setNotas(res.ok ? body.data ?? [] : []);
    setFalloLaLectura(res.ok ? "" : body.error ?? "No se pudo leer el historial.");
    setCargando(false);
  }, [ordenId, version]);

  const [texto, setTexto] = useState("");
  const [guardando, setGuardando] = useState(false);
  /** La pregunta que se está cerrando con «Ya llegó»: una a la vez. */
  const [cerrando, setCerrando] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [aviso, setAviso] = useState("");

  /**
   * Escribe una entrada en el historial y vuelve a leerlo. Devuelve si se guardó.
   *
   * **No tira.** Si `fetch` rechaza —sin conexión, el servidor que corta— no hay
   * respuesta que leer, y eso se dice en vez de dejar que escape: quien llama apaga
   * su botón en un `finally`, pero la persona tiene que saber por qué no pasó nada.
   *
   * Un 409 es que la pantalla estaba vieja —alguien contestó, o siguió el hilo—:
   * se vuelve a leer para mostrar lo que pasó, y no sólo el cartel de error.
   */
  async function publicar(cuerpo: Record<string, unknown>, falloPorDefecto: string): Promise<boolean> {
    setError("");
    setAviso("");

    let res: Response;
    try {
      res = await fetch(`/api/mantenimiento/ordenes/${ordenId}/notas`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(cuerpo),
      });
    } catch {
      setError("No se pudo conectar con el servidor. Revisá la conexión y probá de nuevo.");
      return false;
    }
    const body = await res.json().catch(() => ({}));

    if (!res.ok) {
      setError(body.error ?? falloPorDefecto);
      if (res.status === 409) recargar();
      return false;
    }

    // Guardó en el sistema; si no llegó a la planilla hay que decirlo, con lo
    // que dijo Google y sin traducir. Que la nota esté acá y no allá es una
    // divergencia, y una divergencia que nadie ve es la que muerde.
    if (body.planilla_error) {
      setAviso(`Quedó guardada, pero no llegó a la planilla: ${body.planilla_error}`);
    }
    recargar();
    onCambio?.();
    return true;
  }

  async function agregar() {
    const limpio = texto.trim();
    if (!limpio) {
      setError("Escribí por qué no se hizo.");
      return;
    }
    setGuardando(true);
    // El `finally` es lo que devuelve el botón: sin él, un fallo que escapara dejaba
    // «Guardando…» para siempre y la persona sin poder reintentar.
    try {
      const guardada = await publicar({ texto: limpio }, "No se pudo guardar la justificación.");
      if (guardada) setTexto("");
    } finally {
      setGuardando(false);
    }
  }

  /**
   * «Ya llegó»: la respuesta de quien preguntó, que cierra su propia pregunta.
   *
   * Es una `RESPUESTA` como la que escribiría Compras —quién la escribió lo dice
   * `creado_por`—, y apunta a **esta** pregunta, que es la abierta: el servidor
   * rechaza una que ya no lo sea.
   */
  async function yaLlego(pregunta: NotaDelHistorial) {
    setCerrando(pregunta.id);
    try {
      await publicar(
        { texto: TEXTO_DE_YA_LLEGO, tipo: "RESPUESTA", responde_a: pregunta.id },
        "No se pudo cerrar la pregunta."
      );
    } finally {
      setCerrando(null);
    }
  }

  async function borrar(nota: NotaDelHistorial) {
    setError("");
    setAviso("");
    const res = await fetch(
      `/api/mantenimiento/ordenes/${ordenId}/notas?nota=${nota.id}`, { method: "DELETE" }
    );
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(body.error ?? "No se pudo borrar.");
      // Una a la que otra apunta no se borra (409): alguien la contestó mientras
      // esta pantalla estaba abierta. Se vuelve a leer para que se vea cuál.
      if (res.status === 409) recargar();
      return;
    }
    if (body.planilla_error) {
      setAviso(`Se borró, pero la planilla quedó como estaba: ${body.planilla_error}`);
    }
    recargar();
    onCambio?.();
  }

  return (
    <div className="space-y-2">
      <p className="text-xs font-medium text-slate-500">Por qué no se hizo</p>
      {/* El rótulo solo no alcanza desde que la orden tiene también un hilo de
          mensajes: esto es lo que llega a la planilla, y el hilo no. */}
      <p className="text-xs text-slate-400">
        Queda en la planilla de órdenes (la última, en la columna X). Para hablar con alguien,
        usá los mensajes de más abajo.
      </p>

      {cargando && <p className="text-xs text-slate-400">Buscando…</p>}

      {!cargando && falloLaLectura && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">
          No se pudo leer el historial de esta orden: {falloLaLectura}
        </p>
      )}

      {!cargando && !falloLaLectura && notas.length === 0 && (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">
          Sin justificar. Esta orden sigue abierta y nadie dejó dicho por qué.
        </p>
      )}

      <HistorialDeLaOT
        notas={notas}
        estado={estado}
        puedeEditar={puedeEditar}
        cerrando={cerrando}
        onYaLlego={yaLlego}
        onBorrar={borrar}
      />

      {puedeEditar && (
        <div className="flex items-start gap-2">
          <textarea
            value={texto}
            onChange={(e) => { setTexto(e.target.value); setError(""); }}
            maxLength={MAXIMO_DE_NOTA}
            rows={2}
            placeholder="Por qué todavía no se hizo…"
            className="flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-slate-400"
          />
          <button
            onClick={agregar}
            disabled={guardando}
            className="shrink-0 rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
          >
            {guardando ? "Guardando…" : "Agregar"}
          </button>
        </div>
      )}

      {error && <p className="text-sm text-red-600">{error}</p>}
      {aviso && <p className="text-sm text-amber-700">{aviso}</p>}
    </div>
  );
}
