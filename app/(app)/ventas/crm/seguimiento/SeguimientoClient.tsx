"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { clasificarProximoPaso, type EstadoDelPaso } from "@/lib/ventas/crm/seguimiento";
import { comoFecha, nombreDelTipo } from "@/lib/ventas/crm/formato";

/**
 * La lista de lo que hay que hacer, en tres bloques: vencido, hoy, lo que viene.
 *
 * ── POR QUÉ TRES BLOQUES Y NO UNA TABLA ORDENADA ────────────
 *
 * Porque «vencido» pide una decisión distinta de «esta semana»: lo primero hay
 * que resolverlo o reprogramarlo hoy, lo segundo sólo hay que tenerlo en vista.
 * Una sola lista ordenada por fecha los mezcla en el mismo scroll y lo urgente
 * se lee como «lo más viejo», que es como se convierte en nunca.
 *
 * ── CUMPLIR SACA LA FILA DE LA PANTALLA, PERO NO BORRA NADA ─
 *
 * El PATCH escribe `cumplido_el` y el texto del próximo paso queda guardado:
 * «qué había que hacer y cuándo se hizo» es lo que se quiere leer después. Acá
 * la fila desaparece porque esta pantalla es lo pendiente, no el historial —el
 * historial está en la ficha del cliente—.
 *
 * ── EL ESTADO SE ACTUALIZA EN MEMORIA Y NO SE VUELVE A PEDIR ─
 *
 * Marcar cumplido saca la fila de la lista local. Volver a pedir todo después
 * de cada clic haría que la pantalla parpadee y, con varias marcas seguidas,
 * que una respuesta vieja repinte filas ya sacadas. Si el PATCH falla, la fila
 * vuelve y se muestra el error: **nunca se saca algo que no se guardó**.
 */

interface Pendiente {
  id: string;
  cliente_id: string;
  oportunidad_id: string | null;
  tipo: string;
  fecha: string;
  resumen: string;
  proximo_paso: string | null;
  proximo_paso_el: string | null;
  cumplido_el: string | null;
  hecha_por: string | null;
}

interface Props {
  pendientesIniciales: Pendiente[];
  clientes: { id: string; razon_social: string }[];
  usuarios: { id: string; nombre: string }[];
  yo: string;
  hoy: string;
  puedeEditar: boolean;
}

const BLOQUES: { estado: EstadoDelPaso; titulo: string; color: string; vacio: string }[] = [
  {
    estado: "vencido",
    titulo: "Vencido",
    color: "#B91C1C",
    vacio: "Nada vencido. Es la única lista que conviene tener vacía.",
  },
  { estado: "hoy", titulo: "Para hoy", color: "#B45309", vacio: "Nada para hoy." },
  { estado: "proximo", titulo: "Lo que viene", color: "#0284C7", vacio: "Nada agendado todavía." },
];

export default function SeguimientoClient({
  pendientesIniciales,
  clientes,
  usuarios,
  yo,
  hoy,
  puedeEditar,
}: Props) {
  const [pendientes, setPendientes] = useState<Pendiente[]>(pendientesIniciales);
  const [soloMios, setSoloMios] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState<string | null>(null);

  const nombreDelCliente = useMemo(
    () => new Map(clientes.map((c) => [c.id, c.razon_social])),
    [clientes]
  );
  const nombreDelUsuario = useMemo(
    () => new Map(usuarios.map((u) => [u.id, u.nombre])),
    [usuarios]
  );

  const visibles = useMemo(
    () => (soloMios ? pendientes.filter((p) => p.hecha_por === yo) : pendientes),
    [pendientes, soloMios, yo]
  );

  const porBloque = useMemo(() => {
    const mapa = new Map<EstadoDelPaso, Pendiente[]>([
      ["vencido", []],
      ["hoy", []],
      ["proximo", []],
    ]);
    for (const p of visibles) {
      const estado = clasificarProximoPaso(p.proximo_paso_el, p.cumplido_el, hoy);
      if (estado && mapa.has(estado)) mapa.get(estado)!.push(p);
    }
    return mapa;
  }, [visibles, hoy]);

  async function cumplir(p: Pendiente) {
    setError(null);
    setGuardando(p.id);
    // Optimista: la fila sale ya. Si el PATCH falla vuelve a su lugar, porque
    // una fila que desaparece sin haberse guardado es trabajo que se pierde.
    setPendientes((previos) => previos.filter((x) => x.id !== p.id));

    try {
      const r = await fetch(`/api/ventas/actividades/${p.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cumplido_el: hoy }),
      });
      if (!r.ok) {
        const cuerpo = await r.json().catch(() => ({}));
        throw new Error(cuerpo.error ?? `El servidor contestó ${r.status}`);
      }
    } catch (e) {
      setPendientes((previos) =>
        [...previos, p].sort((a, b) =>
          (a.proximo_paso_el ?? "").localeCompare(b.proximo_paso_el ?? "")
        )
      );
      setError(`No se pudo marcar como cumplido: ${(e as Error).message}`);
    } finally {
      setGuardando(null);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Seguimiento</h1>
          <p className="text-sm text-slate-500">
            Lo que quedó anotado como próximo paso y todavía no se hizo.
          </p>
        </div>
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={soloMios}
            onChange={(e) => setSoloMios(e.target.checked)}
            className="h-4 w-4"
          />
          Sólo lo mío
        </label>
      </div>

      {error && (
        <div className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-800">
          {error}
        </div>
      )}

      {BLOQUES.map((bloque) => {
        const filas = porBloque.get(bloque.estado) ?? [];
        return (
          <section key={bloque.estado} className="space-y-2">
            <div className="flex items-center gap-2">
              <span
                className="h-2.5 w-2.5 shrink-0 rounded-full"
                style={{ background: bloque.color }}
              />
              <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-600">
                {bloque.titulo}
              </h2>
              <span className="text-sm text-slate-400">{filas.length}</span>
            </div>

            {filas.length === 0 ? (
              <p className="text-sm text-slate-400">{bloque.vacio}</p>
            ) : (
              <ul className="space-y-2">
                {filas.map((p) => (
                  <li key={p.id} className="card p-3">
                    {/* `grid-cols-1 sm:grid-cols-[1fr_auto]`: en el teléfono el
                        botón va debajo del texto, no apretado al costado. */}
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_auto] sm:items-start">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                          <Link
                            href={`/ventas/crm/clientes?cliente=${p.cliente_id}`}
                            className="truncate font-semibold text-slate-900 hover:underline"
                          >
                            {nombreDelCliente.get(p.cliente_id) ?? "Cliente que ya no está"}
                          </Link>
                          <span
                            className="text-xs font-semibold"
                            style={{ color: bloque.color }}
                          >
                            {comoFecha(p.proximo_paso_el)}
                          </span>
                        </div>
                        <p className="mt-0.5 text-sm text-slate-800">{p.proximo_paso}</p>
                        <p className="mt-1 text-xs text-slate-500">
                          {nombreDelTipo(p.tipo)} del {comoFecha(p.fecha)}
                          {p.hecha_por ? ` · ${nombreDelUsuario.get(p.hecha_por) ?? ""}` : ""}
                          {" · "}
                          <span className="italic">{p.resumen}</span>
                        </p>
                      </div>

                      {puedeEditar && (
                        <button
                          type="button"
                          onClick={() => void cumplir(p)}
                          disabled={guardando === p.id}
                          className="btn-secondary shrink-0 text-sm"
                        >
                          {guardando === p.id ? "Guardando…" : "Cumplido"}
                        </button>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        );
      })}
    </div>
  );
}
