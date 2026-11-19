"use client";

import { useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import Select from "@/components/Select";
import { Modal } from "@/components/Modal";
import {
  TOPE_DE_MUESTRAS,
  compararMuestras,
  etiquetasDeMuestras,
  type MuestraParaComparar,
} from "@/lib/calidad/ensayos/comparacion";

const esqueleto = () => <div className="h-full w-full animate-pulse rounded-lg bg-slate-100" />;
const CurvaDeRetenido = dynamic(
  () => import("./GraficosDeLaCurva").then((m) => m.CurvaDeRetenido),
  { ssr: false, loading: esqueleto }
);
const CurvaDeAcumulado = dynamic(
  () => import("./GraficosDeLaCurva").then((m) => m.CurvaDeAcumulado),
  { ssr: false, loading: esqueleto }
);
const CurvaDePasante = dynamic(
  () => import("./GraficosDeLaCurva").then((m) => m.CurvaDePasante),
  { ssr: false, loading: esqueleto }
);

export interface MuestraParaLaLista {
  id: string;
  fecha: string;
  observaciones: string | null;
}

/**
 * Un gráfico con su título, listo para sacarle la foto.
 *
 * **El fondo y el color del título van en `style`, no en clases.** El botón del
 * Excel rasteriza este nodo con `html2canvas`, y los fondos puestos con
 * utilidades de Tailwind a veces no llegan al rasterizado —está escrito en el
 * encabezado de `reporte/ReporteClient.tsx`—. Acá pesa más que allá: un PNG con
 * el fondo transparente, metido en una celda de Excel, se ve negro o
 * cuadriculado. El blanco también se le pasa a `html2canvas` como
 * `backgroundColor`, para que el lienzo no dependa sólo de este nodo.
 */
function PanelDelGrafico({
  titulo,
  nodo,
  alAmpliar,
  children,
}: {
  titulo: string;
  nodo: React.Ref<HTMLDivElement>;
  alAmpliar: () => void;
  children: React.ReactNode;
}) {
  return (
    <div ref={nodo} style={{ background: "#FFFFFF", padding: 4 }}>
      {/*
        El encabezado es flex, pero el título conserva su `style`: entra en la
        foto del Excel y las utilidades de Tailwind no siempre llegan al
        rasterizado (ver el comentario de arriba).
      */}
      <div className="flex items-start justify-between gap-2" style={{ margin: "0 0 8px" }}>
        <h2 style={{ color: "#334155", fontSize: 14, fontWeight: 600, margin: 0 }}>{titulo}</h2>
        {/*
          `data-html2canvas-ignore` saca el botón de la foto: es un control de
          la pantalla y no parte del gráfico, y en el informe sería un cuadrito
          gris en la esquina que nadie puede apretar.
        */}
        <button
          type="button"
          data-html2canvas-ignore
          onClick={alAmpliar}
          aria-label={`Ampliar ${titulo}`}
          title="Ampliar"
          className="shrink-0 rounded border border-slate-300 bg-white px-1.5 py-0.5 text-slate-500 hover:bg-slate-100 hover:text-slate-700"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
            <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>
      <div className="h-64">{children}</div>
    </div>
  );
}

/**
 * Los tres gráficos que se pueden ampliar, con su título y su componente.
 *
 * **Ampliar abre un modal con una segunda copia del gráfico; los tres paneles
 * de la grilla siguen montados.** No es casual: el botón del Excel rasteriza
 * esos paneles por sus `ref`, así que agrandar uno *en su lugar* —escondiendo
 * los otros dos— dejaría a `html2canvas` apuntando a nodos ocultos y el informe
 * saldría con la tabla bien y los cuadros vacíos, sin que nada avise. La guarda
 * del `svg.recharts-surface` tampoco lo atraparía: el nodo existe y su SVG
 * también, sólo que no se ve.
 */
const AMPLIABLES = {
  retenido: { titulo: "Retenido por tamiz", Componente: CurvaDeRetenido },
  acumulado: { titulo: "Acumulado", Componente: CurvaDeAcumulado },
  pasante: { titulo: "Pasante", Componente: CurvaDePasante },
} as const;

type Ampliable = keyof typeof AMPLIABLES;

/**
 * El riesgo asumido del acumulado, que se dice en los dos lugares donde se ve
 * ese gráfico: debajo de su panel y dentro de la vista ampliada.
 */
const NOTA_DEL_ACUMULADO =
  "El acumulado de una malla ya incluye lo que retuvieron las apagadas antes que ella: " +
  "apagar un tamiz no recalcula nada, sólo saca su punto de la curva.";

/** El fondo del lienzo de la foto; el mismo blanco que lleva cada panel en su `style`. */
const FONDO_DE_LA_FOTO = "#FFFFFF";

/** El nombre que la ruta le puso al archivo, si lo dice; si no, uno que sirve igual. */
function nombreDelArchivo(res: Response, porDefecto: string): string {
  const cabecera = res.headers.get("Content-Disposition") ?? "";
  const codificado = /filename\*=UTF-8''([^;]+)/i.exec(cabecera)?.[1];
  if (codificado) {
    try {
      return decodeURIComponent(codificado);
    } catch {
      /* cae al nombre por defecto */
    }
  }
  return porDefecto;
}

function Aviso({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded border border-slate-200 bg-white px-3 py-8 text-center text-sm text-slate-500">
      {children}
    </p>
  );
}

/** «no midió #325» · «no midió #6, #7 ni #20»: la enumeración negativa, con su «ni». */
function enumerarQueFaltan(mallas: number[]): string {
  const nombres = mallas.map((m) => `#${m}`);
  if (nombres.length <= 1) return nombres.join("");
  return `${nombres.slice(0, -1).join(", ")} ni ${nombres[nombres.length - 1]}`;
}

/**
 * Las curvas de las muestras elegidas, con sus tamices prendibles.
 *
 * Es un componente aparte **para que la `key` lo reinicie**: los tamices
 * apagados son del conjunto que se miraba, y arrastrarlos a otro escondería un
 * punto medido que nadie vio apagar.
 */
function LasCurvas({ muestras }: { muestras: MuestraParaComparar[] }) {
  const [apagadas, setApagadas] = useState<number[]>([]);
  const [ampliado, setAmpliado] = useState<Ampliable | null>(null);
  const [bajando, setBajando] = useState(false);
  const [falloLaDescarga, setFalloLaDescarga] = useState<string | null>(null);
  const panelRetenido = useRef<HTMLDivElement>(null);
  const panelAcumulado = useRef<HTMLDivElement>(null);
  const panelPasante = useRef<HTMLDivElement>(null);

  const comparacion = useMemo(() => compararMuestras(muestras, apagadas), [muestras, apagadas]);

  const problemas = comparacion.series.filter((s) => s.problema !== undefined);

  // Ninguna de las muestras elegidas tiene mallas: sin esto la pantalla
  // mostraría una fila de chips vacía y tres gráficos en blanco sin decir por
  // qué. Con una sola muestra, el problema de `granulometria()` es el texto que
  // lo explica.
  if (comparacion.mallas.length === 0) {
    return (
      <Aviso>
        {problemas.length > 0
          ? problemas.map((s) => s.problema).join(" ")
          : "Ninguna de las muestras elegidas tiene granulometría cargada."}
      </Aviso>
    );
  }

  const alternar = (malla: number) =>
    setApagadas((previas) =>
      previas.includes(malla) ? previas.filter((m) => m !== malla) : [...previas, malla]
    );

  /**
   * Baja el Excel: la tabla sale de la base y de acá viajan sólo los ids, los
   * tamices apagados y la foto de cada gráfico.
   *
   * Cada foto sale a `scale: 4`: en la hoja la imagen mide 640 px de ancho y el
   * informe se imprime, así que con `scale: 2` la densidad volvía a ser la de la
   * pantalla (~100 dpi, blando). El ancho en la hoja no se toca: el alto sale
   * del aspecto. El peso tiene que seguir bajo el megabyte por imagen que
   * acepta la ruta. Si la ruta contesta con un 400, **se muestra el mensaje que
   * mandó**: es el que dice qué pasó.
   */
  async function bajarElExcel() {
    const paneles = [
      { campo: "retenido", nodo: panelRetenido.current },
      { campo: "acumulado", nodo: panelAcumulado.current },
      { campo: "pasante", nodo: panelPasante.current },
    ];
    // Los `ref` apuntan al `div` de afuera, que existe siempre que hay puntos:
    // preguntar por ellos no dice nada. Lo que tarda son los chunks `dynamic` de
    // recharts, y mientras cargan adentro hay un esqueleto gris. Recharts emite
    // un `svg.recharts-surface` cuando dibujó, y eso es lo que se comprueba:
    // sin esto, un clic en esa ventana sube tres rectángulos grises —PNG
    // válidos— y el informe sale con la tabla bien y tres cuadros vacíos.
    if (paneles.some((p) => !p.nodo?.querySelector("svg.recharts-surface"))) {
      setFalloLaDescarga("Los gráficos todavía se están dibujando: probá de nuevo en un momento.");
      return;
    }

    setBajando(true);
    setFalloLaDescarga(null);
    try {
      const html2canvas = (await import("html2canvas")).default;
      const formulario = new FormData();
      formulario.append("muestras", JSON.stringify(muestras.map((m) => m.id)));
      formulario.append("apagadas", JSON.stringify(apagadas));
      for (const { campo, nodo } of paneles) {
        const lienzo = await html2canvas(nodo!, {
          scale: 4,
          backgroundColor: FONDO_DE_LA_FOTO,
          useCORS: true,
          logging: false,
        });
        const png = await new Promise<Blob | null>((resolver) => lienzo.toBlob(resolver, "image/png"));
        if (!png) throw new Error("No se pudo sacar la foto de uno de los gráficos.");
        formulario.append(campo, png, `${campo}.png`);
      }

      const res = await fetch("/api/calidad/ensayos/curva/export", { method: "POST", body: formulario });
      if (!res.ok) {
        const cuerpo = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(cuerpo?.error ?? `El servidor devolvió ${res.status}.`);
      }

      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement("a");
      a.href = url;
      a.download = nombreDelArchivo(res, "Curva granulométrica.xlsx");
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setFalloLaDescarga(`No se pudo bajar el Excel: ${e instanceof Error ? e.message : e}`);
    } finally {
      setBajando(false);
    }
  }

  return (
    <div className="space-y-3">
      {/*
        El problema que puede traer una muestra —lo retenido supera al peso— sí
        viene con mallas y con puntos: se avisa y se dibuja igual, porque verlo
        es la única forma de corregirlo.
      */}
      {problemas.length > 0 && (
        <div className="space-y-1 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          {problemas.map((s) => (
            <p key={s.id}>
              {muestras.length > 1 ? `${s.etiqueta}: ${s.problema}` : s.problema}
            </p>
          ))}
        </div>
      )}
      <div className="space-y-1">
        <p className="text-xs text-slate-500">
          Tamices de {muestras.length === 1 ? "esta muestra" : "las muestras elegidas"}. Apagá uno
          para sacarlo de las curvas, por ejemplo si se tamizó mal.
        </p>
        <div className="flex flex-wrap gap-1.5">
          {comparacion.mallas.map((malla) => {
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

      {comparacion.filas.length === 0 ? (
        <Aviso>Apagaste todos los tamices: prendé alguno para ver la curva.</Aviso>
      ) : (
        <>
          {/*
            El botón sólo existe cuando hay gráficos que fotografiar: sin
            granulometría o sin peso no hay mallas (y se avisó arriba), y con
            todos los tamices apagados no hay filas (y se avisó acá).
          */}
          <div className="flex flex-wrap items-center gap-3">
            <button type="button" onClick={bajarElExcel} disabled={bajando} className="btn-secondary">
              {bajando ? "Armando el Excel…" : "Bajar Excel"}
            </button>
            <p className="text-xs text-slate-500">
              La tabla y los tres gráficos, con los tamices que dejaste prendidos.
            </p>
          </div>
          {falloLaDescarga !== null && (
            <p role="alert" className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {falloLaDescarga}
            </p>
          )}
          <div className="grid grid-cols-1 items-start gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <PanelDelGrafico
              titulo={AMPLIABLES.retenido.titulo}
              nodo={panelRetenido}
              alAmpliar={() => setAmpliado("retenido")}
            >
              <CurvaDeRetenido filas={comparacion.filas} series={comparacion.series} />
            </PanelDelGrafico>
            <div className="space-y-2">
              <PanelDelGrafico
                titulo={AMPLIABLES.acumulado.titulo}
                nodo={panelAcumulado}
                alAmpliar={() => setAmpliado("acumulado")}
              >
                <CurvaDeAcumulado filas={comparacion.filas} series={comparacion.series} />
              </PanelDelGrafico>
              <p className="text-xs text-slate-500">{NOTA_DEL_ACUMULADO}</p>
            </div>
            <PanelDelGrafico
              titulo={AMPLIABLES.pasante.titulo}
              nodo={panelPasante}
              alAmpliar={() => setAmpliado("pasante")}
            >
              <CurvaDePasante filas={comparacion.filas} series={comparacion.series} />
            </PanelDelGrafico>
          </div>

          {ampliado !== null && (
            <Modal
              titulo={AMPLIABLES[ampliado].titulo}
              alSalir={() => setAmpliado(null)}
              soloLectura
              ancho="enorme"
            >
              {/*
                Alto por viewport y no fijo: el modal ya se topea en el alto de
                la pantalla, y en un teléfono un `h-96` dejaría el gráfico igual
                de chico que en la grilla, que es lo que se vino a arreglar.
              */}
              <div className="h-[60vh] min-h-72">
                {(() => {
                  const { Componente } = AMPLIABLES[ampliado];
                  return (
                    <Componente
                      filas={comparacion.filas}
                      series={comparacion.series}
                      etiquetasEnteras
                    />
                  );
                })()}
              </div>
              {ampliado === "acumulado" && (
                <p className="mt-3 text-xs text-slate-500">{NOTA_DEL_ACUMULADO}</p>
              )}
            </Modal>
          )}
          {/*
            Un hueco en una curva sólo se entiende si se nombra: una línea que
            se corta sin explicación se lee como un error del sistema.
          */}
          {(comparacion.disparejas.length > 0 || comparacion.sinGranulometria.length > 0) && (
            <div className="space-y-1 rounded border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
              {comparacion.sinGranulometria.length > 0 && (
                <p>
                  Sin granulometría cargada, así que no dibujan ninguna curva:{" "}
                  {comparacion.sinGranulometria.join("; ")}.
                </p>
              )}
              {comparacion.disparejas.length > 0 && (
                <p>
                  No todas midieron los mismos tamices, así que hay curvas que no llegan de punta
                  a punta:{" "}
                  {comparacion.disparejas.map((d, i) => (
                    <span key={d.etiqueta}>
                      {i > 0 && "; "}
                      {d.etiqueta} no midió {enumerarQueFaltan(d.faltan)}
                    </span>
                  ))}
                  .
                </p>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default function CurvaClient({
  productos,
  productoId,
  productoNombre,
  delSelector,
  muestras,
}: {
  productos: { id: string; nombre: string }[];
  /** "" si no hay producto elegido. */
  productoId: string;
  productoNombre: string;
  /** Las muestras del producto elegido, para el selector. */
  delSelector: MuestraParaLaLista[];
  /** Las muestras elegidas, que pueden ser de varios productos. */
  muestras: MuestraParaComparar[];
}) {
  const router = useRouter();

  /** Producto y muestras van en la URL para poder mandar el enlace. Los tamices no. */
  const ir = (producto: string, ids: string[]) => {
    const q = new URLSearchParams();
    if (producto) q.set("producto", producto);
    if (ids.length > 0) q.set("muestras", ids.join(","));
    const texto = q.toString();
    router.push(texto ? `/calidad/ensayos/curva?${texto}` : "/calidad/ensayos/curva");
  };

  const elegidas = muestras.map((m) => m.id);
  const producto = productos.find((p) => p.id === productoId);

  // Las etiquetas y los colores de las elegidas salen de la misma función que
  // los usa adentro, sin los tamices apagados —que no los cambian—, para que
  // el chip y la leyenda del gráfico no puedan decir cosas distintas.
  const series = useMemo(() => compararMuestras(muestras, []).series, [muestras]);

  /**
   * Lo que ofrece el desplegable: las muestras del producto que todavía no
   * están elegidas. La etiqueta no repite el producto, porque son todas suyas.
   *
   * **Las etiquetas se numeran contra la lista entera del producto y recién
   * después se sacan las elegidas.** Numerar sobre las que quedan hace que el
   * «(n de m)» cuente otra cosa: con tres muestras del mismo día, elegir una
   * dejaría a las otras dos diciendo «(1 de 2)» y «(2 de 2)», y la que ya está
   * elegida tiene su chip diciendo «(1 de 3)». Acá se elige una muestra por su
   * etiqueta, así que un número que no cierra hace comparar la que no era.
   */
  const porAgregar = useMemo(() => {
    const etiquetas = etiquetasDeMuestras(
      delSelector.map((m) => ({
        producto: productoNombre,
        fecha: m.fecha,
        observaciones: m.observaciones,
      })),
      false
    );
    return delSelector
      .map((m, i) => ({ id: m.id, etiqueta: etiquetas[i] }))
      .filter((m) => !elegidas.includes(m.id));
  }, [delSelector, elegidas, productoNombre]);

  const lleno = elegidas.length >= TOPE_DE_MUESTRAS;

  return (
    <div className="mx-auto max-w-6xl space-y-4 p-4 md:p-6">
      <div>
        <h1 className="text-xl font-bold text-slate-900">Curva granulométrica</h1>
        <p className="text-sm text-slate-500">
          Elegí una muestra para ver lo retenido, el acumulado y el pasante de cada tamiz, o varias
          para compararlas. Se pueden mezclar productos.
        </p>
      </div>

      <section className="space-y-3 rounded border border-slate-200 bg-white p-3">
        <div className="flex flex-wrap gap-2">
          <Select
            value={productoId}
            onChange={(e) => ir(e.target.value, elegidas)}
            className="max-w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
          >
            <option value="">Elegí un producto</option>
            {productos.map((p) => (
              <option key={p.id} value={p.id}>
                {p.nombre}
              </option>
            ))}
          </Select>

          {productoId !== "" && !lleno && porAgregar.length > 0 && (
            <Select
              value=""
              onChange={(e) => e.target.value && ir(productoId, [...elegidas, e.target.value])}
              className="max-w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
            >
              <option value="">
                {elegidas.length === 0 ? "Elegí una muestra" : "Agregar otra muestra"}
              </option>
              {porAgregar.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.etiqueta}
                </option>
              ))}
            </Select>
          )}

          {lleno && (
            <p className="self-center text-xs text-slate-500">
              Son {TOPE_DE_MUESTRAS} muestras como máximo: sacá una para poder agregar otra.
            </p>
          )}
        </div>

        {/*
          Los chips sobreviven al cambio de producto: así se arma un conjunto
          que cruza productos sin otra pantalla.
        */}
        {series.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {series.map((s) => (
              <span
                key={s.id}
                className="inline-flex items-center gap-1.5 rounded-full border border-slate-300 bg-white py-1 pl-2 pr-1 text-xs text-slate-700"
              >
                <span
                  aria-hidden
                  className="inline-block h-2.5 w-2.5 rounded-full"
                  style={{ background: s.color }}
                />
                {s.etiqueta}
                <button
                  type="button"
                  aria-label={`Sacar ${s.etiqueta}`}
                  onClick={() => ir(productoId, elegidas.filter((id) => id !== s.id))}
                  className="rounded-full px-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        )}

        {muestras.length > 0 ? (
          <LasCurvas key={elegidas.join(",")} muestras={muestras} />
        ) : productoId === "" ? (
          <Aviso>Elegí un producto para ver las muestras que tiene.</Aviso>
        ) : delSelector.length === 0 ? (
          <Aviso>{producto?.nombre} todavía no tiene muestras cargadas.</Aviso>
        ) : (
          <Aviso>
            {producto?.nombre} tiene {delSelector.length}{" "}
            {delSelector.length === 1 ? "muestra" : "muestras"}: elegí una para ver su curva, o
            varias para compararlas.
          </Aviso>
        )}
      </section>
    </div>
  );
}
