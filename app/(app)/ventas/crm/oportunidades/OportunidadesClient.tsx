"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import Select from "@/components/Select";
import { armarEmbudo, tasaDeConversion } from "@/lib/ventas/crm/embudo";
import { ETAPAS, etapaDe, sePuedePasarDe } from "@/lib/ventas/crm/etapas";
import { comoFecha, comoMonto, comoMontos, comoToneladas } from "@/lib/ventas/crm/formato";

/**
 * El embudo, columna por columna, y el movimiento de etapa.
 *
 * ── LAS SEIS COLUMNAS SIEMPRE, AUNQUE ESTÉN VACÍAS ──────────
 *
 * Es el punto de un embudo: una etapa que desaparece porque no tiene nada no se
 * nota, y lo que hay que ver es justamente dónde está el tapón. Un hueco en
 * «Cotizada» cuenta una historia; cinco columnas no cuentan ninguna.
 *
 * ── MOVER DE ETAPA ES EL ÚNICO BOTÓN ────────────────────────
 *
 * Todo lo demás de una oportunidad se corrige desde la ficha del cliente, que
 * es donde está su contexto. Acá sólo se la mueve, que es lo que se hace
 * mirando el embudo entero.
 *
 * **De una cerrada no se vuelve**, y el desplegable no ofrece la vuelta:
 * `sePuedePasarDe` decide qué opciones se dibujan, con la misma función que la
 * ruta usa para rechazar. Que la pantalla ofrezca algo que el servidor va a
 * rechazar es cómo se consigue que la gente deje de confiar en los botones.
 *
 * ── PERDER PIDE EL MOTIVO, Y SE PIDE ACÁ ────────────────────
 *
 * La ruta lo exige y contestaría 400; preguntarlo antes de mandar evita que
 * alguien mueva la tarjeta y reciba un error por algo que podía escribir en el
 * momento. Es el único dato del CRM que no se reconstruye mirando los números.
 */

interface Oportunidad {
  id: string;
  numero: number;
  cliente_id: string;
  titulo: string;
  producto_id: string | null;
  toneladas_estimadas: number | null;
  monto_estimado: number | null;
  moneda: string;
  etapa: string;
  vendedor_id: string | null;
  fecha_estimada_cierre: string | null;
  cerrada_el: string | null;
  motivo_perdida: string | null;
  notas: string | null;
}

interface Props {
  oportunidadesIniciales: Oportunidad[];
  clientes: { id: string; razon_social: string }[];
  usuarios: { id: string; nombre: string }[];
  hoy: string;
  puedeEditar: boolean;
}

export default function OportunidadesClient({
  oportunidadesIniciales,
  clientes,
  usuarios,
  hoy,
  puedeEditar,
}: Props) {
  const [oportunidades, setOportunidades] = useState(oportunidadesIniciales);
  const [vendedor, setVendedor] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [moviendo, setMoviendo] = useState<string | null>(null);

  const nombreDelCliente = useMemo(
    () => new Map(clientes.map((c) => [c.id, c.razon_social])),
    [clientes]
  );

  const visibles = useMemo(
    () => (vendedor ? oportunidades.filter((o) => o.vendedor_id === vendedor) : oportunidades),
    [oportunidades, vendedor]
  );

  const embudo = useMemo(() => armarEmbudo(visibles), [visibles]);
  const tasa = useMemo(() => tasaDeConversion(visibles), [visibles]);

  async function mover(o: Oportunidad, etapaNueva: string) {
    setError(null);

    let motivo: string | null = null;
    if (etapaNueva === "perdida") {
      motivo = window.prompt("¿Por qué se perdió? (precio, plazo, se fue a la competencia…)");
      // Cancelar el prompt no mueve nada: la ruta rechazaría igual, y preguntar
      // dos veces es peor que no hacer nada.
      if (!motivo?.trim()) return;
    }

    setMoviendo(o.id);
    try {
      const r = await fetch(`/api/ventas/oportunidades/${o.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ etapa: etapaNueva, ...(motivo ? { motivo_perdida: motivo } : {}) }),
      });
      const cuerpo = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(cuerpo.error ?? `El servidor contestó ${r.status}`);
      // Se reemplaza con lo que devolvió el servidor y no con lo que se mandó:
      // `cerrada_el` lo escribe la ruta, y adivinarlo acá dejaría la pantalla
      // diciendo una fecha distinta de la que quedó guardada.
      setOportunidades((previas) =>
        previas.map((x) => (x.id === o.id ? { ...x, ...cuerpo.oportunidad } : x))
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setMoviendo(null);
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Oportunidades</h1>
          <p className="text-sm text-slate-500">
            {embudo.abiertas.cantidad} en juego · {comoMontos(embudo.abiertas.monto)} ·{" "}
            {comoToneladas(embudo.abiertas.toneladas)}
            {tasa !== null ? ` · ${Math.round(tasa)} % de lo cerrado se ganó` : ""}
          </p>
        </div>
        <div className="w-full sm:w-64">
          <label htmlFor="vendedor" className="mb-1 block text-xs font-medium text-slate-600">
            Vendedor
          </label>
          <Select id="vendedor" value={vendedor} onChange={(e) => setVendedor(e.target.value)} className="input">
            <option value="">Todos</option>
            {usuarios.map((u) => (
              <option key={u.id} value={u.id}>
                {u.nombre}
              </option>
            ))}
          </Select>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-800">
          {error}
        </div>
      )}

      {/* Una columna por etapa. En el teléfono van apiladas: seis columnas en
          343 px serían 57 px cada una. */}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
        {embudo.columnas.map((columna) => {
          const dela = visibles.filter((o) => o.etapa === columna.etapa.clave);
          return (
            <section key={columna.etapa.clave} className="card overflow-hidden p-0">
              <div className="h-1" style={{ background: columna.etapa.color }} />
              <div className="p-3">
                <div className="mb-2">
                  <div className="flex items-baseline justify-between gap-2">
                    <h2 className="text-sm font-semibold" style={{ color: columna.etapa.color }}>
                      {columna.etapa.nombre}
                    </h2>
                    <span className="text-sm font-bold text-slate-900">{columna.cantidad}</span>
                  </div>
                  <p className="text-xs text-slate-500">
                    {comoMontos(columna.monto)} · {comoToneladas(columna.toneladas)}
                    {columna.sinMonto > 0 && (
                      <>
                        <br />
                        {columna.sinMonto} sin monto cargado
                      </>
                    )}
                  </p>
                </div>

                {dela.length === 0 ? (
                  <p className="text-xs text-slate-400">Vacía.</p>
                ) : (
                  <ul className="space-y-2">
                    {dela.map((o) => (
                      <li key={o.id} className="rounded-lg border border-slate-200 p-2">
                        <Link
                          href={`/ventas/crm/clientes?cliente=${o.cliente_id}`}
                          className="text-xs text-slate-500 hover:underline"
                        >
                          {nombreDelCliente.get(o.cliente_id) ?? "Cliente que ya no está"}
                        </Link>
                        <p className="text-sm font-medium text-slate-900">{o.titulo}</p>
                        <p className="text-xs text-slate-500">
                          {o.monto_estimado != null
                            ? comoMonto(o.monto_estimado, o.moneda === "USD" ? "USD" : "ARS")
                            : "sin monto"}
                          {o.toneladas_estimadas != null
                            ? ` · ${comoToneladas(o.toneladas_estimadas)}`
                            : ""}
                          {o.fecha_estimada_cierre && !o.cerrada_el && (
                            <>
                              {" · "}
                              <span
                                className={
                                  o.fecha_estimada_cierre < hoy ? "font-semibold text-red-700" : ""
                                }
                              >
                                {comoFecha(o.fecha_estimada_cierre)}
                              </span>
                            </>
                          )}
                          {o.cerrada_el ? ` · cerrada ${comoFecha(o.cerrada_el)}` : ""}
                        </p>
                        {o.motivo_perdida && (
                          <p className="text-xs italic text-slate-500">{o.motivo_perdida}</p>
                        )}

                        {puedeEditar && (
                          <div className="mt-1.5">
                            <Select
                              value={o.etapa}
                              onChange={(e) => void mover(o, e.target.value)}
                              disabled={moviendo === o.id || !etapaDe(o.etapa)?.abierta}
                              className="input text-xs"
                              aria-label={`Mover la oportunidad ${o.numero}`}
                            >
                              {/* Sólo las etapas a las que se puede ir desde
                                  ésta. Ofrecer una que el servidor va a
                                  rechazar es cómo se logra que la gente deje
                                  de confiar en los botones. */}
                              {ETAPAS.filter((e) => sePuedePasarDe(o.etapa, e.clave)).map((e) => (
                                <option key={e.clave} value={e.clave}>
                                  {e.nombre}
                                </option>
                              ))}
                            </Select>
                          </div>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
