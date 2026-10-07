"use client";

import { useMemo, useState } from "react";
import dynamic from "next/dynamic";
import Select from "@/components/Select";
import { limiteDe } from "@/lib/calidad/ensayos/limites";
import {
  mallasDelPeriodo,
  muestrasPorMes,
  resumenPorProducto,
  serieDe,
  type Estadistica,
  type MuestraResuelta,
} from "@/lib/calidad/ensayos/indicadores";
import type { Determinacion, Limite } from "@/lib/calidad/ensayos/types";

const esqueleto = () => <div className="h-full w-full animate-pulse rounded-lg bg-slate-100" />;
const SerieDeLaDeterminacion = dynamic(
  () => import("./GraficosEnsayos").then((m) => m.SerieDeLaDeterminacion),
  { ssr: false, loading: esqueleto }
);
const MuestrasPorMes = dynamic(() => import("./GraficosEnsayos").then((m) => m.MuestrasPorMes), {
  ssr: false,
  loading: esqueleto,
});

const NOMBRE: Record<Determinacion, string> = {
  humedad: "Humedad",
  peso_volumetrico: "Peso volumétrico",
  cal_util_vial: "Cal útil vial",
  retenido: "Retenido",
  acumulado: "Acumulado",
};

const UNIDAD: Record<Determinacion, string> = {
  humedad: "%",
  peso_volumetrico: "g/l",
  cal_util_vial: "%",
  retenido: "%",
  acumulado: "%",
};

const LLEVA_MALLA: Determinacion[] = ["retenido", "acumulado"];

const num = new Intl.NumberFormat("es-AR", { maximumFractionDigits: 2 });

/** Un promedio y su `n`. Sin el `n`, tres ensayos y doscientos se leen igual. */
function Estad({ e, unidad }: { e: Estadistica; unidad: string }) {
  if (e.n === 0) return <span className="text-slate-300">—</span>;
  return (
    <span>
      {num.format(e.promedio!)} <span className="text-xs text-slate-400">{unidad}</span>
      <span className="ml-1 text-xs text-slate-400">
        ({num.format(e.minimo!)}–{num.format(e.maximo!)}, n={e.n})
      </span>
    </span>
  );
}

export default function IndicadoresClient({
  muestras,
  productos,
  limites,
  dias,
}: {
  muestras: MuestraResuelta[];
  productos: { id: string; nombre: string }[];
  limites: Limite[];
  dias: number;
}) {
  const [productoId, setProductoId] = useState(productos[0]?.id ?? "");
  const [determinacion, setDeterminacion] = useState<Determinacion>("humedad");
  const [malla, setMalla] = useState<number | null>(null);

  const delProducto = useMemo(
    () => muestras.filter((m) => m.producto_id === productoId),
    [muestras, productoId]
  );

  const mallas = useMemo(() => mallasDelPeriodo(delProducto), [delProducto]);
  const mallaElegida = LLEVA_MALLA.includes(determinacion) ? malla ?? mallas.at(-1) ?? null : null;

  const serie = useMemo(
    () => serieDe(delProducto, { determinacion, malla: mallaElegida }),
    [delProducto, determinacion, mallaElegida]
  );

  const resumen = useMemo(() => resumenPorProducto(muestras, productos), [muestras, productos]);
  const porMes = useMemo(() => muestrasPorMes(muestras), [muestras]);

  const limite = limiteDe(
    limites.filter((l) => l.producto_id === productoId),
    determinacion,
    mallaElegida
  );

  const producto = productos.find((p) => p.id === productoId);
  const delProductoResumen = resumen.find((r) => r.producto_id === productoId);

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-4 md:p-6">
      <div>
        <h1 className="text-xl font-bold text-slate-900">Indicadores de ensayo</h1>
        <p className="text-sm text-slate-500">
          {muestras.length} muestras de los últimos {dias} días.{" "}
          {limites.length === 0 && (
            <span className="text-amber-700">
              Sin límites cargados: los gráficos no dibujan ninguna línea de corte.
            </span>
          )}
        </p>
      </div>

      {muestras.length === 0 ? (
        <p className="rounded border border-slate-200 bg-white px-3 py-8 text-center text-sm text-slate-500">
          Todavía no hay muestras cargadas. Los indicadores aparecen cuando haya.
        </p>
      ) : (
        <>
          <section className="space-y-3 rounded border border-slate-200 bg-white p-3">
            <div className="flex flex-wrap gap-2">
              <Select
                value={productoId}
                onChange={(e) => setProductoId(e.target.value)}
                className="rounded border border-slate-300 px-2 py-1.5 text-sm"
              >
                {productos.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.nombre}
                  </option>
                ))}
              </Select>

              <Select
                value={determinacion}
                onChange={(e) => setDeterminacion(e.target.value as Determinacion)}
                className="rounded border border-slate-300 px-2 py-1.5 text-sm"
              >
                {(Object.keys(NOMBRE) as Determinacion[]).map((d) => (
                  <option key={d} value={d}>
                    {NOMBRE[d]}
                  </option>
                ))}
              </Select>

              {LLEVA_MALLA.includes(determinacion) && (
                <Select
                  value={String(mallaElegida ?? "")}
                  onChange={(e) => setMalla(e.target.value ? Number(e.target.value) : null)}
                  className="rounded border border-slate-300 px-2 py-1.5 text-sm"
                >
                  {mallas.length === 0 ? (
                    <option value="">sin granulometrías</option>
                  ) : (
                    mallas.map((m) => (
                      <option key={m} value={m}>
                        #{m}
                      </option>
                    ))
                  )}
                </Select>
              )}
            </div>

            <h2 className="text-sm font-semibold text-slate-700">
              {NOMBRE[determinacion]}
              {mallaElegida !== null && ` #${mallaElegida}`} · {producto?.nombre}
              <span className="ml-2 font-normal text-slate-400">
                {serie.length} {serie.length === 1 ? "muestra" : "muestras"} con este dato
              </span>
            </h2>

            <div className="h-64">
              {serie.length === 0 ? (
                <p className="flex h-full items-center justify-center rounded bg-slate-50 text-sm text-slate-400">
                  Ninguna muestra de {producto?.nombre} tiene esta determinación en el período.
                </p>
              ) : (
                <SerieDeLaDeterminacion
                  datos={serie}
                  unidad={UNIDAD[determinacion]}
                  minimo={limite?.minimo ?? null}
                  maximo={limite?.maximo ?? null}
                />
              )}
            </div>

            {delProductoResumen && (
              <dl className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
                <div className="rounded bg-slate-50 px-2 py-1">
                  <dt className="text-xs text-slate-500">Muestras</dt>
                  <dd className="font-semibold text-slate-900">{delProductoResumen.muestras}</dd>
                </div>
                <div className="rounded bg-slate-50 px-2 py-1">
                  <dt className="text-xs text-slate-500">Fuera de límite</dt>
                  <dd
                    className={`font-semibold ${
                      delProductoResumen.fueraDeLimite > 0 ? "text-red-700" : "text-slate-900"
                    }`}
                  >
                    {delProductoResumen.fueraDeLimite}
                  </dd>
                </div>
                <div className="rounded bg-slate-50 px-2 py-1">
                  <dt className="text-xs text-slate-500">Humedad</dt>
                  <dd>
                    <Estad e={delProductoResumen.humedad} unidad="%" />
                  </dd>
                </div>
                <div className="rounded bg-slate-50 px-2 py-1">
                  <dt className="text-xs text-slate-500">Peso volumétrico</dt>
                  <dd>
                    <Estad e={delProductoResumen.pesoVolumetrico} unidad="g/l" />
                  </dd>
                </div>
              </dl>
            )}
          </section>

          <section className="space-y-2 rounded border border-slate-200 bg-white p-3">
            <h2 className="text-sm font-semibold text-slate-700">Muestras por mes</h2>
            <p className="text-xs text-slate-500">
              Sirve para ver si un producto dejó de ensayarse: un mes en cero no se nota mirando el
              listado.
            </p>
            <div className="h-56">
              <MuestrasPorMes datos={porMes} />
            </div>
          </section>

          <section className="space-y-2">
            <h2 className="text-sm font-semibold text-slate-700">Por producto</h2>
            <p className="text-xs text-slate-500">
              El promedio va con su rango y con <strong>n</strong>, que es sobre cuántas muestras se
              calculó. Sin eso, un promedio de tres ensayos y uno de doscientos se leen igual.
            </p>
            <div className="overflow-x-auto rounded border border-slate-200 bg-white">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-3 py-2">Producto</th>
                    <th className="px-3 py-2 text-right">Muestras</th>
                    <th className="px-3 py-2 text-right">Fuera</th>
                    <th className="px-3 py-2">Humedad</th>
                    <th className="px-3 py-2">Peso vol.</th>
                    <th className="px-3 py-2">Cal útil</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {resumen.map((r) => (
                    <tr key={r.producto_id} className="hover:bg-slate-50">
                      <td className="px-3 py-1.5 text-slate-900">{r.nombre}</td>
                      <td className="px-3 py-1.5 text-right">{r.muestras}</td>
                      <td
                        className={`px-3 py-1.5 text-right ${
                          r.fueraDeLimite > 0 ? "font-semibold text-red-700" : "text-slate-400"
                        }`}
                      >
                        {r.fueraDeLimite}
                      </td>
                      <td className="px-3 py-1.5">
                        <Estad e={r.humedad} unidad="%" />
                      </td>
                      <td className="px-3 py-1.5">
                        <Estad e={r.pesoVolumetrico} unidad="g/l" />
                      </td>
                      <td className="px-3 py-1.5">
                        <Estad e={r.calUtilVial} unidad="%" />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
