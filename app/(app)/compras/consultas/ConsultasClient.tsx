"use client";

import { useState } from "react";
import Link from "next/link";
import { useCargar } from "@/lib/core/useCargar";
import { haceCuanto } from "@/lib/core/haceCuanto";
import { MAXIMO_DE_NOTA } from "@/lib/mantenimiento/notas";
import {
  cambiarRespuesta, queDecirDeLaRespuesta, urlDeLaOrden,
  type CajasDeRespuesta, type ConsultaAbierta,
} from "@/lib/compras/consultas";

/**
 * La bandeja donde Compras contesta lo que Mantenimiento preguntó por un repuesto.
 *
 * Es la mitad de arriba de la decisión del diseño: **quien compra no entra a
 * Mantenimiento.** La respuesta se escribe acá y cae en el historial de la OT, que
 * es donde la va a buscar el que abra esa orden dentro de dos semanas.
 *
 * Tres cosas que no se deducen de mirarla:
 *
 *  - **La más vieja va arriba.** Lo decide `bandejaDeConsultas`, y es la razón por
 *    la que esta pantalla existe: la que lleva un mes esperando es la que no hay
 *    que perder de vista. Ordenada al revés quedaría al final.
 *  - **Cada consulta tiene su propia caja.** Una sola caja compartida tira en
 *    silencio lo que se escribió en la otra, y eso ya pasó en el modal de repuestos
 *    de la OT: la mutación que lo reintroduce dejaba toda la suite en verde. Las
 *    transiciones están en `cambiarRespuesta`, con sus tests.
 *  - **Lo que pasó con el aviso se dice.** La respuesta queda guardada pase lo que
 *    pase, pero fuera de 7:00–21:00 el push no sale y **no se reintenta nunca**;
 *    quien contesta tiene que poder enterarse de que del otro lado no sonó nada.
 */

export default function ConsultasClient({ puedeAbrirLaOrden }: { puedeAbrirLaOrden: boolean }) {
  const [consultas, setConsultas] = useState<ConsultaAbierta[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState("");
  /** Lo que se está escribiendo, **una caja por consulta** (la clave es su id). */
  const [cajas, setCajas] = useState<CajasDeRespuesta>({});
  /** La consulta cuya respuesta está viajando. Una a la vez. */
  const [enviando, setEnviando] = useState<string | null>(null);
  /** Lo que se le dice a quien acaba de contestar: si el aviso llegó, y si la planilla. */
  const [seEnvio, setSeEnvio] = useState<
    { llego: boolean; texto: string; planilla: string | null } | null
  >(null);

  const recargar = useCargar(async (vigente) => {
    setCargando(true);
    const res = await fetch("/api/compras/consultas");
    const cuerpo = await res.json().catch(() => ({}));
    if (!vigente()) return;

    setCargando(false);
    if (!res.ok) {
      setError(cuerpo.error ?? "No se pudieron traer las consultas.");
      return;
    }
    setError("");
    setConsultas(cuerpo.data ?? []);
  }, []);

  function cambiar(consultaId: string, cambios: { texto?: string; error?: string }) {
    setCajas((actuales) => cambiarRespuesta(actuales, consultaId, cambios));
  }

  async function contestar(consulta: ConsultaAbierta) {
    const escrito = (cajas[consulta.id]?.texto ?? "").trim();
    if (!escrito) return;

    setEnviando(consulta.id);
    cambiar(consulta.id, { error: "" });

    // El `finally` es lo que devuelve los botones: sin él, un `fetch` que rechaza
    // —sin conexión— deja «Enviando…» para siempre y a la persona sin reintentar.
    try {
      const res = await fetch("/api/compras/consultas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pregunta_id: consulta.id, texto: escrito }),
      });
      const cuerpo = await res.json().catch(() => ({}));

      if (!res.ok) {
        // La caja queda con lo escrito. Un 409 es que la bandeja estaba vieja —ya la
        // contestaron, o la orden se cerró—: se vuelve a leer para que se vea.
        cambiar(consulta.id, { error: cuerpo.error ?? "No se pudo enviar la respuesta." });
        if (res.status === 409) recargar();
        return;
      }

      cambiar(consulta.id, { texto: "", error: "" });
      setSeEnvio({ ...queDecirDeLaRespuesta(cuerpo.aviso), planilla: cuerpo.planilla_error ?? null });
      recargar();
    } catch {
      cambiar(consulta.id, {
        error:
          "No se pudo enviar: no hay conexión con el servidor. Revisá la conexión y " +
          "probá de nuevo; lo que escribiste sigue acá.",
      });
    } finally {
      setEnviando(null);
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold text-slate-900">Consultas de Mantenimiento</h1>
        <p className="text-sm text-slate-500">
          Lo que preguntaron por un repuesto de una orden de trabajo. Lo que contestes
          queda en el historial de esa orden y pasa a ser la razón por la que sigue
          abierta.
        </p>
      </div>

      {error && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
      )}

      {/* Verde sólo si salió el aviso **y** llegó a la planilla, igual que del otro
          lado (`RepuestosOTModal`). Un fallo de escritura nunca es un `console.warn`:
          se le dice a quien hizo la acción, y decírselo como letra chica adentro de
          un cartel que dice «salió todo bien» no cuenta como decírselo. */}
      {seEnvio && (
        <div
          className={`rounded-lg px-3 py-2 text-sm ${
            seEnvio.llego && !seEnvio.planilla
              ? "bg-green-50 text-green-800"
              : "bg-amber-50 text-amber-800"
          }`}
        >
          <p>{seEnvio.texto}</p>
          {seEnvio.planilla && (
            <p className="mt-1 text-xs">
              Quedó guardada en el sistema, pero no llegó a la planilla: {seEnvio.planilla}
            </p>
          )}
        </div>
      )}

      {cargando ? (
        <p className="py-8 text-center text-sm text-slate-400">Cargando…</p>
      ) : consultas.length === 0 ? (
        <p className="card px-4 py-8 text-center text-sm text-slate-400">
          No hay consultas esperando respuesta.
        </p>
      ) : (
        <ul className="space-y-3">
          {consultas.map((c) => {
            const caja = cajas[c.id] ?? { texto: "", error: "" };
            const ot = c.orden.ot_number === null ? "OT sin número" : `OT ${c.orden.ot_number}`;

            return (
              <li key={c.id} className="card space-y-2 px-4 py-3">
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                  {/* El enlace sólo para quien puede abrirla: el layout de
                      Mantenimiento rebota a quien no tenga el módulo. */}
                  {puedeAbrirLaOrden && c.orden.ot_number !== null ? (
                    <Link
                      href={urlDeLaOrden(c.orden.ot_number)}
                      className="text-sm font-bold text-[var(--primary)] hover:underline"
                    >
                      {ot}
                    </Link>
                  ) : (
                    <span className="text-sm font-bold text-slate-900">{ot}</span>
                  )}
                  <span className="text-sm text-slate-600">{c.orden.descripcion ?? ""}</span>
                </div>

                {/* De qué pieza se habla. Una OT puede estar esperando dos cosas
                    distintas de dos pedidos distintos. */}
                <p className="text-xs">
                  <span className="rounded bg-amber-100 px-1.5 py-0.5 font-semibold text-amber-800">
                    {c.repuesto
                      ? c.repuesto.codigo
                        ? `${c.repuesto.nombre} · ${c.repuesto.codigo}`
                        : c.repuesto.nombre
                      : "Sin repuesto"}
                  </span>
                </p>

                <p className="whitespace-pre-wrap text-sm text-slate-800">{c.texto}</p>

                <p className="text-xs text-slate-400">
                  Preguntó {c.autor ?? "—"} ·{" "}
                  <span title={new Date(c.creado_en).toLocaleString("es-AR")}>
                    {haceCuanto(c.creado_en)}
                  </span>
                </p>

                <div className="space-y-1.5 border-t border-slate-100 pt-2">
                  <textarea
                    value={caja.texto}
                    onChange={(e) => cambiar(c.id, { texto: e.target.value })}
                    maxLength={MAXIMO_DE_NOTA}
                    rows={2}
                    placeholder="Contestar: «el proveedor lo entrega el jueves»…"
                    className="input"
                  />
                  {caja.error && <p className="text-xs text-red-600">{caja.error}</p>}
                  <div className="flex flex-wrap items-center justify-end gap-2">
                    <span className="text-xs text-slate-400">
                      {caja.texto.length}/{MAXIMO_DE_NOTA}
                    </span>
                    <button
                      onClick={() => contestar(c)}
                      disabled={enviando !== null || !caja.texto.trim()}
                      className="btn-primary text-sm"
                    >
                      {enviando === c.id ? "Enviando…" : "Contestar"}
                    </button>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
