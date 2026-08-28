"use client";

import Link from "next/link";
import type { GastoDelEquipo } from "@/lib/compras/gastoPorEquipo";

/** Un requerimiento, con lo justo para listarlo. */
export interface RequerimientoDelEquipo {
  id: string;
  nro_ri: number;
  descripcion: string;
  costo_iva: number | string | null;
  fecha_pedido: string | null;
  fecha: string | null;
}

export interface ComprasDelEquipoProps {
  equipoId: string;
  gasto: GastoDelEquipo;
  ultimos: RequerimientoDelEquipo[];
  /** Cuántas ubicaciones del catálogo apuntan a esta máquina. */
  ubicaciones: string[];
  /** El sector de la máquina, si tiene compras propias a las que mandar. */
  sectorConCompras: { id: string; nombre: string; codigo: string | null } | null;
}

const pesos = (n: number) =>
  n.toLocaleString("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 });

export default function ComprasDelEquipo({
  equipoId, gasto, ultimos, ubicaciones, sectorConCompras,
}: ComprasDelEquipoProps) {
  const sinEnlace = ubicaciones.length === 0;

  return (
    <section>
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-sm font-semibold text-gray-700">Compras para este equipo</h2>
        {!sinEnlace && (
          <Link
            href={`/compras/requerimientos?equipo=${equipoId}`}
            className="text-xs text-blue-500 hover:underline"
          >
            Ver todas →
          </Link>
        )}
      </div>

      <div className="rounded-xl border border-gray-200 bg-white">
        {sinEnlace ? (
          /**
           * No es lo mismo "no se le compró nada" que "nadie dijo qué ubicación
           * es esta máquina". Decir cuál de las dos es lo que evita que alguien
           * concluya que una máquina no gasta.
           */
          <p className="px-4 py-4 text-sm text-gray-500">
            Ninguna ubicación de Compras apunta a esta máquina, así que no hay
            gasto que mostrar. Se enlaza desde{" "}
            <Link href="/compras/ubicaciones" className="text-blue-500 hover:underline">
              Compras → Ubicaciones
            </Link>
            .
            {sectorConCompras && (
              <>
                {" "}Su sector sí tiene compras:{" "}
                <Link
                  href={`/compras/requerimientos?sector=${sectorConCompras.id}`}
                  className="text-blue-500 hover:underline"
                >
                  ver lo de {sectorConCompras.nombre}
                </Link>
                .
              </>
            )}
          </p>
        ) : gasto.anios.length === 0 && gasto.sinCosto === 0 ? (
          <p className="px-4 py-4 text-sm text-gray-500">
            Todavía no se cargó ningún requerimiento para esta máquina.
          </p>
        ) : (
          <>
            <div className="divide-y divide-gray-100">
              {gasto.anios.map((a) => (
                <div key={a.anio} className="px-4 py-2.5 flex items-baseline justify-between text-sm">
                  <span className="font-mono text-gray-500">{a.anio}</span>
                  <div className="text-right">
                    <span className="font-semibold text-gray-900">{pesos(a.total)}</span>
                    <span className="ml-2 text-xs text-gray-400">
                      {a.conCosto} {a.conCosto === 1 ? "pedido" : "pedidos"}
                      {a.sinCosto > 0 && ` · ${a.sinCosto} sin costo`}
                    </span>
                  </div>
                </div>
              ))}
            </div>

            <div className="border-t border-gray-200 px-4 py-2.5 flex items-baseline justify-between text-sm">
              <span className="text-gray-500">Acumulado</span>
              <span className="font-bold text-gray-900">{pesos(gasto.total)}</span>
            </div>

            <p className="px-4 pb-3 text-xs text-gray-400">
              Son pesos de cada momento, sin ajustar: sumar años distintos da un
              número que sirve para ordenar, no para comparar.
              {gasto.sinCosto > 0 &&
                ` ${gasto.sinCosto} ${gasto.sinCosto === 1 ? "requerimiento no tiene" : "requerimientos no tienen"} costo cargado y no suman.`}
            </p>

            {ultimos.length > 0 && (
              <div className="border-t border-gray-100 divide-y divide-gray-100">
                {ultimos.map((r) => (
                  <div key={r.id} className="px-4 py-2.5 flex items-start gap-3 text-sm">
                    <span className="text-xs font-mono text-gray-400 w-12 shrink-0 pt-0.5">
                      #{r.nro_ri}
                    </span>
                    <p className="flex-1 min-w-0 text-gray-800 leading-snug">{r.descripcion}</p>
                    <div className="text-right shrink-0">
                      <p className="text-gray-700">
                        {r.costo_iva === null || r.costo_iva === ""
                          ? "—"
                          : pesos(Number(r.costo_iva))}
                      </p>
                      {(r.fecha_pedido ?? r.fecha) && (
                        <p className="text-xs text-gray-400">
                          {new Date(r.fecha_pedido ?? (r.fecha as string)).toLocaleDateString("es-AR")}
                        </p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      {/**
       * El gasto de un sector no se reparte entre sus máquinas: atribuirle al
       * molino una fracción de lo que se compró para Filler 2 sería inventar un
       * número. Se dice dónde está ese gasto en vez de simularlo.
       */}
      {!sinEnlace && sectorConCompras && (
        <p className="mt-2 text-xs text-gray-400">
          Lo que se compró para {sectorConCompras.nombre} sin nombrar una máquina
          no se reparte entre sus equipos.{" "}
          <Link
            href={`/compras/requerimientos?sector=${sectorConCompras.id}`}
            className="text-blue-500 hover:underline"
          >
            Verlo aparte
          </Link>
          .
        </p>
      )}
    </section>
  );
}
