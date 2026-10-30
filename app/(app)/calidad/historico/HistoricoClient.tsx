"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { comoSeLee } from "@/lib/core/fechas";
import type { FilaDeLaBusqueda } from "@/lib/calidad/historico/aplanar";
import Planilla from "./Planilla";

/** Las cinco hojas tabulares, que son las que se pueden ver como planilla. */
const TABULARES = ["Filler 1", "Cal", "Filler 2", "Despacho a Kartonsec", "Despacho a Emapi"];

/**
 * Cómo se escribe un valor, con su escala.
 *
 * **Esto es lo que impide contestarle a un cliente con un número cien veces
 * mal.** Un `0,125` de 2025 y un `12,5` de 2026 son la misma medición escrita en
 * dos planillas distintas; mostrarlos pelados en la misma lista es la trampa que
 * todo este módulo existe para evitar.
 */
function comoSeEscribe(f: FilaDeLaBusqueda): string {
  if (f.escala === "fraccion") return `${f.valor} (fracción = ${(f.valor * 100).toFixed(2)}%)`;
  if (f.escala === "porcentaje") return `${f.valor}%`;
  return f.unidad ? `${f.valor} ${f.unidad}` : String(f.valor);
}

export default function HistoricoClient({
  filas, texto, desde, hasta, error,
}: {
  filas: FilaDeLaBusqueda[];
  texto: string;
  desde: string;
  hasta: string;
  /** Lo que dijo la base, sin traducir. Null si anduvo. */
  error: string | null;
}) {
  const router = useRouter();
  const [q, setQ] = useState(texto);
  const [d, setD] = useState(desde);
  const [h, setH] = useState(hasta);
  const [comoPlanilla, setComoPlanilla] = useState(false);

  const buscar = () => {
    const p = new URLSearchParams();
    if (q.trim()) p.set("q", q.trim());
    p.set("desde", d);
    p.set("hasta", h);
    router.push(`/calidad/historico?${p}`);
  };

  // La vista de planilla sólo tiene sentido con las hojas de columnas fijas.
  const hayTabulares = useMemo(
    () => filas.some((f) => f.fuente === "historico" && TABULARES.includes(f.origen)),
    [filas]
  );

  return (
    <div className="mx-auto max-w-5xl space-y-4 md:p-6">
      <div>
        <h1 className="text-xl font-bold text-slate-900">Histórico de determinaciones</h1>
        <p className="text-sm text-slate-500">
          Los tres años del laboratorio, junto con lo que se carga hoy en Ensayos.
        </p>
      </div>

      {error && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Todavía no se puede consultar el histórico: {error}
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && buscar()}
          placeholder="Un cliente, un producto, una determinación…"
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm sm:col-span-2"
        />
        <input type="date" value={d} onChange={(e) => setD(e.target.value)}
               className="rounded-lg border border-slate-300 px-3 py-2 text-sm" />
        <input type="date" value={h} onChange={(e) => setH(e.target.value)}
               className="rounded-lg border border-slate-300 px-3 py-2 text-sm" />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button onClick={buscar}
                className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800">
          Buscar
        </button>
        <span className="text-sm text-slate-500">{filas.length} valores</span>
        {hayTabulares && (
          <label className="ml-auto flex items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" checked={comoPlanilla}
                   onChange={(e) => setComoPlanilla(e.target.checked)} />
            Verlo como planilla
          </label>
        )}
      </div>

      {comoPlanilla ? (
        <Planilla filas={filas.filter((f) => f.fuente === "historico" && TABULARES.includes(f.origen))} />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-200">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-slate-600">
              <tr>
                <th className="px-3 py-2">Fecha</th>
                <th className="px-3 py-2">Origen</th>
                <th className="px-3 py-2">Determinación</th>
                <th className="px-3 py-2 text-right">Valor</th>
                <th className="px-3 py-2">&nbsp;</th>
              </tr>
            </thead>
            <tbody>
              {filas.map((f, i) => (
                <tr key={`${f.fuente}-${f.fecha}-${f.origen}-${f.determinacion}-${i}`}
                    className={`border-t border-slate-100 ${f.revisar ? "bg-amber-50" : ""}`}>
                  <td className="whitespace-nowrap px-3 py-2 text-slate-500">{comoSeLee(f.fecha)}</td>
                  <td className="px-3 py-2 text-slate-900">{f.origen}</td>
                  <td className="px-3 py-2 text-slate-500">{f.determinacion}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{comoSeEscribe(f)}</td>
                  <td className="px-3 py-2">
                    <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600">
                      {f.fuente === "historico" ? "histórico" : "Ensayos"}
                    </span>
                    {f.revisar && (
                      <span className="block text-xs text-amber-800">{f.revisar}</span>
                    )}
                  </td>
                </tr>
              ))}
              {filas.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-3 py-6 text-center text-slate-500">
                    No hay determinaciones con esos filtros.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Fija y no un tooltip: es lo que hay que saber antes de usar un número
          viejo para contestarle a alguien. */}
      <div className="space-y-2 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
        <p>
          El <strong>2 de junio de 2026 Calidad cambió de planilla</strong>, y con ella la
          forma de anotar: antes los retenidos y acumulados se escribían como fracción
          (0,19) y desde entonces como porcentaje (19). Por eso cada valor dice en qué
          escala está. <strong>Ningún número fue convertido</strong>: son los que escribió
          el laboratorio.
        </p>
        <p>
          Lo marcado en ámbar es una fila cuyo acumulado no cierra contra sus retenidos.
          Entra como está — corregirla sería interpretar — y conviene mirarla antes de
          usarla.
        </p>
      </div>
    </div>
  );
}
