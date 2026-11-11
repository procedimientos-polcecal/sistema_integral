"use client";

import { useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import Select from "@/components/Select";
import { comoSeLee } from "@/lib/core/fechas";
import { curvaDeLaMuestra } from "@/lib/calidad/ensayos/curva";

const esqueleto = () => <div className="h-full w-full animate-pulse rounded-lg bg-slate-100" />;
const CurvaDeRetenido = dynamic(
  () => import("./GraficosDeLaCurva").then((m) => m.CurvaDeRetenido),
  { ssr: false, loading: esqueleto }
);
const CurvaDeAcumulado = dynamic(
  () => import("./GraficosDeLaCurva").then((m) => m.CurvaDeAcumulado),
  { ssr: false, loading: esqueleto }
);

export interface MuestraParaLaLista {
  id: string;
  fecha: string;
  observaciones: string | null;
}

/** Lo que hace falta de la muestra elegida para dibujar su curva. */
export interface EnsayoDeLaCurva {
  id: string;
  pesoMuestraG: number | null;
  retenidos: { malla: number; retenido_g: number }[];
}

/**
 * La etiqueta de cada muestra en el desplegable, en el orden en que llegan.
 *
 * Dos muestras del mismo día son un caso real, y **la observación no alcanza
 * para distinguirlas**: medido contra la base, hay 91 muestras y sólo 13 tienen
 * observaciones, y en 2 de los 6 grupos de (producto, fecha) con más de una
 * muestra el texto salía idéntico. Por eso los empates se numeran —«(1 de 2)»,
 * «(2 de 2)»—, en el orden que ya trae la consulta (fecha y, a igual fecha, hora
 * de carga), que es determinista. No se muestra la hora de carga: es cuándo se
 * tipeó la muestra y no cuándo se midió, y ponerla invita a leerla como lo
 * segundo.
 */
function etiquetasDe(muestras: MuestraParaLaLista[]): string[] {
  const base = muestras.map((m) => {
    const obs = m.observaciones?.trim();
    if (!obs) return comoSeLee(m.fecha);
    return `${comoSeLee(m.fecha)} · ${obs.length > 40 ? `${obs.slice(0, 40)}…` : obs}`;
  });
  const total = new Map<string, number>();
  for (const e of base) total.set(e, (total.get(e) ?? 0) + 1);

  const visto = new Map<string, number>();
  return base.map((e) => {
    const n = total.get(e) ?? 1;
    if (n === 1) return e;
    const orden = (visto.get(e) ?? 0) + 1;
    visto.set(e, orden);
    return `${e} (${orden} de ${n})`;
  });
}

function Aviso({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded border border-slate-200 bg-white px-3 py-8 text-center text-sm text-slate-500">
      {children}
    </p>
  );
}

/**
 * La curva de una muestra, con sus tamices prendibles.
 *
 * Es un componente aparte **para que `key={muestra.id}` lo reinicie**: los
 * tamices apagados son de la muestra que se miraba, y arrastrarlos a otra
 * escondería un punto medido que nadie vio apagar.
 */
function LaCurva({ ensayo }: { ensayo: EnsayoDeLaCurva }) {
  const [apagadas, setApagadas] = useState<number[]>([]);

  const curva = useMemo(
    () =>
      curvaDeLaMuestra(
        { pesoMuestraG: ensayo.pesoMuestraG, retenidos: ensayo.retenidos },
        apagadas
      ),
    [ensayo, apagadas]
  );

  // Con retenidos pero sin peso tamizado, `curvaDeLaMuestra` devuelve el
  // problema y **ninguna malla**: sin esto la pantalla mostraría una fila de
  // chips vacía y dos gráficos en blanco sin decir por qué.
  if (curva.problema !== undefined && curva.mallas.length === 0) {
    return <Aviso>{curva.problema}</Aviso>;
  }

  const alternar = (malla: number) =>
    setApagadas((previas) =>
      previas.includes(malla) ? previas.filter((m) => m !== malla) : [...previas, malla]
    );

  return (
    <div className="space-y-3">
      {/*
        El otro problema que puede traer `curvaDeLaMuestra` —lo retenido supera
        al peso— sí viene con mallas y con puntos: se avisa y se dibuja igual,
        porque verlo es la única forma de corregirlo.
      */}
      {curva.problema !== undefined && (
        <p className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          {curva.problema}
        </p>
      )}
      <div className="space-y-1">
        <p className="text-xs text-slate-500">
          Tamices de esta muestra. Apagá uno para sacarlo de las curvas, por ejemplo si se
          tamizó mal.
        </p>
        <div className="flex flex-wrap gap-1.5">
          {curva.mallas.map((malla) => {
            const prendida = !apagadas.includes(malla);
            return (
              <button
                key={malla}
                type="button"
                aria-pressed={prendida}
                onClick={() => alternar(malla)}
                className={`rounded-full border px-3 py-1 text-xs font-medium ${
                  prendida
                    ? "border-green-700 bg-green-50 text-green-800"
                    : "border-slate-300 bg-white text-slate-400 line-through"
                }`}
              >
                #{malla}
              </button>
            );
          })}
        </div>
      </div>

      {curva.puntos.length === 0 ? (
        <Aviso>Apagaste todos los tamices: prendé alguno para ver la curva.</Aviso>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <h2 className="text-sm font-semibold text-slate-700">Retenido por tamiz</h2>
            <div className="h-64">
              <CurvaDeRetenido puntos={curva.puntos} />
            </div>
          </div>
          <div className="space-y-2">
            <h2 className="text-sm font-semibold text-slate-700">Acumulado</h2>
            <div className="h-64">
              <CurvaDeAcumulado puntos={curva.puntos} />
            </div>
            <p className="text-xs text-slate-500">
              El acumulado de una malla ya incluye lo que retuvieron las apagadas antes que
              ella: apagar un tamiz no recalcula nada, sólo saca su punto de la curva.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

export default function CurvaClient({
  productos,
  productoId,
  muestras,
  ensayo,
}: {
  productos: { id: string; nombre: string }[];
  /** "" si no hay producto elegido. */
  productoId: string;
  muestras: MuestraParaLaLista[];
  ensayo: EnsayoDeLaCurva | null;
}) {
  const router = useRouter();

  /** Producto y muestra van en la URL para poder mandar el enlace. Los tamices no. */
  const ir = (producto: string, muestra: string) => {
    const q = new URLSearchParams();
    if (producto) q.set("producto", producto);
    if (muestra) q.set("muestra", muestra);
    const texto = q.toString();
    router.push(texto ? `/calidad/ensayos/curva?${texto}` : "/calidad/ensayos/curva");
  };

  const producto = productos.find((p) => p.id === productoId);
  const etiquetas = useMemo(() => etiquetasDe(muestras), [muestras]);

  return (
    <div className="mx-auto max-w-6xl space-y-4 p-4 md:p-6">
      <div>
        <h1 className="text-xl font-bold text-slate-900">Curva granulométrica</h1>
        <p className="text-sm text-slate-500">
          Elegí un producto y una de sus muestras para ver lo retenido y el acumulado de cada tamiz.
        </p>
      </div>

      <section className="space-y-3 rounded border border-slate-200 bg-white p-3">
        <div className="flex flex-wrap gap-2">
          <Select
            value={productoId}
            onChange={(e) => ir(e.target.value, "")}
            className="max-w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
          >
            <option value="">Elegí un producto</option>
            {productos.map((p) => (
              <option key={p.id} value={p.id}>
                {p.nombre}
              </option>
            ))}
          </Select>

          {productoId !== "" && muestras.length > 0 && (
            <Select
              value={ensayo?.id ?? ""}
              onChange={(e) => ir(productoId, e.target.value)}
              className="max-w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
            >
              <option value="">Elegí una muestra</option>
              {muestras.map((m, i) => (
                <option key={m.id} value={m.id}>
                  {etiquetas[i]}
                </option>
              ))}
            </Select>
          )}
        </div>

        {productoId === "" ? (
          <Aviso>Elegí un producto para ver las muestras que tiene.</Aviso>
        ) : muestras.length === 0 ? (
          <Aviso>{producto?.nombre} todavía no tiene muestras cargadas.</Aviso>
        ) : ensayo === null ? (
          <Aviso>
            {producto?.nombre} tiene {muestras.length}{" "}
            {muestras.length === 1 ? "muestra" : "muestras"}: elegí una para ver su curva.
          </Aviso>
        ) : ensayo.retenidos.length === 0 ? (
          <Aviso>Esta muestra no tiene granulometría cargada, así que no hay curva que dibujar.</Aviso>
        ) : (
          <LaCurva key={ensayo.id} ensayo={ensayo} />
        )}
      </section>
    </div>
  );
}
