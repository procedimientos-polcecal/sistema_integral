"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import Select from "@/components/Select";
import MultiSelect from "@/components/MultiSelect";
import { Modal } from "@/components/Modal";
import { laEleccionQueQueda } from "@/lib/calidad/ensayos/eleccionDeMuestras";
import {
  COMBINACIONES_DE_LA_COMPARACION,
  compararMuestras,
  etiquetasDeMuestras,
  type MuestraParaComparar,
  type SerieDeLaComparacion,
} from "@/lib/calidad/ensayos/comparacion";
import { nombreDelArchivoDeLaCurva } from "@/lib/calidad/ensayos/nombreDelArchivo";
import { LeyendaDeLaCurva } from "./LeyendaDeLaCurva";

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

// `disabled:pointer-events-none` y no sólo `disabled:opacity-50`: sin eso el
// botón cambia de fondo al pasarle el mouse mientras está deshabilitado, o sea
// señala «funciono» justo cuando no hace nada. Es lo mismo que `globals.css`
// arregló para los `.btn-*` el 04/11/2026.
const CLASE_DEL_BOTONCITO =
  "shrink-0 rounded border border-slate-300 bg-white px-1.5 py-0.5 text-slate-500 " +
  "hover:bg-slate-100 hover:text-slate-700 disabled:pointer-events-none disabled:opacity-50";

/**
 * Los controles de la esquina del panel.
 *
 * **Van con `data-html2canvas-ignore`**, que es el atributo que `html2canvas`
 * respeta al clonar el nodo: son controles de la pantalla y no parte del
 * gráfico, y dentro de la foto serían cuadritos grises que nadie puede
 * apretar.
 */
function BotonesDelPanel({
  titulo,
  alAmpliar,
  alBajar,
  bajando,
}: {
  titulo: string;
  alAmpliar?: () => void;
  alBajar: () => void;
  bajando: boolean;
}) {
  return (
    <div data-html2canvas-ignore className="flex shrink-0 items-center gap-1">
      <button
        type="button"
        onClick={alBajar}
        disabled={bajando}
        aria-label={`Bajar ${titulo} como imagen`}
        title="Bajar como imagen"
        className={CLASE_DEL_BOTONCITO}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
          <path d="M12 3v12m0 0l-4-4m4 4l4-4M4 17v2a2 2 0 002 2h12a2 2 0 002-2v-2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {alAmpliar && (
        <button
          type="button"
          onClick={alAmpliar}
          aria-label={`Ampliar ${titulo}`}
          title="Ampliar"
          className={CLASE_DEL_BOTONCITO}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
            <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      )}
    </div>
  );
}

/**
 * Un gráfico con su título y su leyenda, listo para sacarle la foto.
 *
 * **Es el nodo que `html2canvas` rasteriza**, tanto para el Excel como para el
 * botón de bajar la imagen, y por eso tiene que llevar adentro todo lo que
 * hace falta para leer el dibujo: el título —si no, un PNG pegado en un correo
 * no dice si es retenido, acumulado o pasante— y la leyenda.
 *
 * **El fondo y el color del título van en `style`, no en clases.** Los fondos
 * puestos con utilidades de Tailwind a veces no llegan al rasterizado —está
 * escrito en el encabezado de `reporte/ReporteClient.tsx`—. Acá pesa más que
 * allá: un PNG con el fondo transparente, metido en una celda de Excel, se ve
 * negro o cuadriculado. El blanco también se le pasa a `html2canvas` como
 * `backgroundColor`, para que el lienzo no dependa sólo de este nodo.
 *
 * **Lo usan la grilla y la vista ampliada**, que sólo se diferencian en el
 * alto, en si hay botón de ampliar y en si la leyenda va entera. Compartirlo
 * es lo que hace que la imagen grande no pueda salir distinta de la chica.
 */
function PanelDelGrafico({
  titulo,
  nodo,
  series,
  alto = "h-64",
  etiquetasEnteras = false,
  alAmpliar,
  alBajar,
  bajando,
  children,
}: {
  titulo: string;
  nodo: React.Ref<HTMLDivElement>;
  /** Para la leyenda, que va dentro del panel justamente para entrar en la foto. */
  series: SerieDeLaComparacion[];
  /** Las clases de alto del dibujo. La vista ampliada manda las suyas. */
  alto?: string;
  etiquetasEnteras?: boolean;
  /** Sin esto no se dibuja el botón: en la vista ampliada no hay nada que ampliar. */
  alAmpliar?: () => void;
  alBajar: () => void;
  bajando: boolean;
  children: React.ReactNode;
}) {
  return (
    <div ref={nodo} style={{ background: "#FFFFFF", padding: 4 }}>
      <div className="flex items-start justify-between gap-2" style={{ margin: "0 0 8px" }}>
        <h2 style={{ color: "#334155", fontSize: 14, fontWeight: 600, margin: 0 }}>{titulo}</h2>
        <BotonesDelPanel
          titulo={titulo}
          alAmpliar={alAmpliar}
          alBajar={alBajar}
          bajando={bajando}
        />
      </div>
      <div className={alto}>{children}</div>
      <LeyendaDeLaCurva series={series} etiquetasEnteras={etiquetasEnteras} />
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
  /**
   * Qué se está bajando, y no un `boolean`: los dos caminos comparten el
   * `html2canvas` y los dos tienen que deshabilitar todos los botones, pero el
   * botón grande no puede decir «Armando el Excel…» porque alguien apretó el
   * ícono de imagen de un panel —eso avisa de algo que no está pasando—.
   */
  const [bajando, setBajando] = useState<"excel" | "imagen" | null>(null);
  const [falloLaDescarga, setFalloLaDescarga] = useState<string | null>(null);
  const panelRetenido = useRef<HTMLDivElement>(null);
  const panelAcumulado = useRef<HTMLDivElement>(null);
  const panelPasante = useRef<HTMLDivElement>(null);
  /** El del modal: es una **segunda** copia del gráfico, ver `AMPLIABLES`. */
  const panelAmpliado = useRef<HTMLDivElement>(null);

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
   * La foto de un panel, en PNG.
   *
   * Es el camino que comparten el Excel y el botón de bajar la imagen: el
   * segundo es el primero **cortado un paso antes**, sin mandarla al servidor.
   * Si los dos sacaran la foto por su cuenta, la imagen que alguien pega en un
   * correo podría dejar de ser la misma que la del informe.
   *
   * **El `scale: 4` es medido y no un número redondo**: en la hoja del Excel la
   * imagen mide 640 px de ancho y el informe se imprime, así que con `scale: 2`
   * la densidad volvía a ser la de la pantalla (~100 dpi, blando). Y tiene que
   * seguir entrando en el megabyte por imagen que acepta la ruta.
   */
  async function fotoDe(nodo: HTMLDivElement): Promise<Blob> {
    const html2canvas = (await import("html2canvas")).default;
    const lienzo = await html2canvas(nodo, {
      scale: 4,
      backgroundColor: FONDO_DE_LA_FOTO,
      useCORS: true,
      logging: false,
      /**
       * Soltar el recorte de los ancestros, **en el clon y no en la pantalla**.
       *
       * `html2canvas` clona el documento entero en un iframe y respeta el
       * `overflow` de los ancestros al pintar. El cuerpo del `Modal` es
       * `overflow-y-auto` con `max-h-full`, así que un gráfico ampliado más
       * alto que la pantalla —que es lo que pasa en cuanto la leyenda ocupa
       * dos renglones— se fotografiaría **cortado por abajo, justo donde está
       * la leyenda**, y sin que nada avise.
       *
       * `onclone` recibe el nodo ya clonado (verificado contra el paquete
       * instalado: `onclone(documentClone, referenceElement)`), y corre antes
       * de que se midan sus límites, así que el recorte se suelta a tiempo.
       * Para los paneles de la grilla el bucle no hace nada: no tienen ningún
       * ancestro que recorte.
       */
      onclone: (_documento, clonado) => {
        for (let padre = clonado.parentElement; padre; padre = padre.parentElement) {
          padre.style.overflow = "visible";
          padre.style.maxHeight = "none";
        }
      },
    });
    const png = await new Promise<Blob | null>((resolver) => lienzo.toBlob(resolver, "image/png"));
    if (!png) throw new Error("No se pudo sacar la foto del gráfico.");
    return png;
  }

  /** El `<a download>` de siempre, con su `revokeObjectURL`. */
  function bajar(contenido: Blob, nombre: string) {
    const url = URL.createObjectURL(contenido);
    const a = document.createElement("a");
    a.href = url;
    a.download = nombre;
    a.click();
    URL.revokeObjectURL(url);
  }

  /**
   * Recharts emite un `svg.recharts-surface` recién cuando dibujó, y los `ref`
   * apuntan al `div` de afuera, que existe desde el principio: preguntar por el
   * `ref` no dice nada. Sin esto, un clic mientras cargan los chunks `dynamic`
   * —adentro hay un esqueleto gris— sube un rectángulo gris que es un PNG
   * perfectamente válido.
   */
  function todaviaSeDibuja(nodos: (HTMLDivElement | null)[]): boolean {
    return nodos.some((nodo) => !nodo?.querySelector("svg.recharts-surface"));
  }

  /** Un gráfico solo, como PNG, sin pasar por el Excel ni por el servidor. */
  async function bajarLaImagen(cual: Ampliable, nodo: HTMLDivElement | null) {
    if (todaviaSeDibuja([nodo])) {
      setFalloLaDescarga("El gráfico todavía se está dibujando: probá de nuevo en un momento.");
      return;
    }
    setBajando("imagen");
    setFalloLaDescarga(null);
    try {
      bajar(
        await fotoDe(nodo!),
        nombreDelArchivoDeLaCurva(muestras, {
          extension: "png",
          grafico: AMPLIABLES[cual].titulo,
        })
      );
    } catch (e) {
      setFalloLaDescarga(`No se pudo bajar la imagen: ${e instanceof Error ? e.message : e}`);
    } finally {
      setBajando(null);
    }
  }

  /**
   * Baja el Excel: la tabla sale de la base y de acá viajan sólo los ids, los
   * tamices apagados y la foto de cada gráfico.
   *
   * Si la ruta contesta con un 400, **se muestra el mensaje que mandó**: es el
   * que dice qué pasó.
   */
  async function bajarElExcel() {
    const paneles = [
      { campo: "retenido", nodo: panelRetenido.current },
      { campo: "acumulado", nodo: panelAcumulado.current },
      { campo: "pasante", nodo: panelPasante.current },
    ];
    // Sin la guarda, un clic mientras cargan los chunks de recharts sube tres
    // rectángulos grises —PNG válidos— y el informe sale con la tabla bien y
    // tres cuadros vacíos.
    if (todaviaSeDibuja(paneles.map((p) => p.nodo))) {
      setFalloLaDescarga("Los gráficos todavía se están dibujando: probá de nuevo en un momento.");
      return;
    }

    setBajando("excel");
    setFalloLaDescarga(null);
    try {
      const formulario = new FormData();
      formulario.append("muestras", JSON.stringify(muestras.map((m) => m.id)));
      formulario.append("apagadas", JSON.stringify(apagadas));
      for (const { campo, nodo } of paneles) {
        formulario.append(campo, await fotoDe(nodo!), `${campo}.png`);
      }

      const res = await fetch("/api/calidad/ensayos/curva/export", { method: "POST", body: formulario });
      if (!res.ok) {
        const cuerpo = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(cuerpo?.error ?? `El servidor devolvió ${res.status}.`);
      }

      bajar(await res.blob(), nombreDelArchivo(res, "Curva granulométrica.xlsx"));
    } catch (e) {
      setFalloLaDescarga(`No se pudo bajar el Excel: ${e instanceof Error ? e.message : e}`);
    } finally {
      setBajando(null);
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
            <button
              type="button"
              onClick={bajarElExcel}
              disabled={bajando !== null}
              className="btn-secondary"
            >
              {bajando === "excel" ? "Armando el Excel…" : "Bajar Excel"}
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
              series={comparacion.series}
              alAmpliar={() => setAmpliado("retenido")}
              alBajar={() => bajarLaImagen("retenido", panelRetenido.current)}
              bajando={bajando !== null}
            >
              <CurvaDeRetenido filas={comparacion.filas} series={comparacion.series} />
            </PanelDelGrafico>
            <div className="space-y-2">
              <PanelDelGrafico
                titulo={AMPLIABLES.acumulado.titulo}
                nodo={panelAcumulado}
                series={comparacion.series}
                alAmpliar={() => setAmpliado("acumulado")}
                alBajar={() => bajarLaImagen("acumulado", panelAcumulado.current)}
                bajando={bajando !== null}
              >
                <CurvaDeAcumulado filas={comparacion.filas} series={comparacion.series} />
              </PanelDelGrafico>
              <p className="text-xs text-slate-500">{NOTA_DEL_ACUMULADO}</p>
            </div>
            <PanelDelGrafico
              titulo={AMPLIABLES.pasante.titulo}
              nodo={panelPasante}
              series={comparacion.series}
              alAmpliar={() => setAmpliado("pasante")}
              alBajar={() => bajarLaImagen("pasante", panelPasante.current)}
              bajando={bajando !== null}
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
                El mismo `PanelDelGrafico` de la grilla, con otro alto: así la
                imagen que se baja desde acá lleva el título y la leyenda igual
                que la chica. El título se repite con el del `Modal`, y es a
                propósito: el encabezado del modal no entra en la foto.

                Alto por viewport y no fijo, porque el modal ya se topea en el
                alto de la pantalla y en un teléfono un `h-96` dejaría el
                gráfico igual de chico que en la grilla, que es lo que se vino
                a arreglar. Las etiquetas van enteras: hay 1152 px de ancho y
                es justo lo que se viene a leer.
              */}
              <PanelDelGrafico
                titulo={AMPLIABLES[ampliado].titulo}
                nodo={panelAmpliado}
                series={comparacion.series}
                alto="h-[60vh] min-h-72"
                etiquetasEnteras
                alBajar={() => bajarLaImagen(ampliado, panelAmpliado.current)}
                bajando={bajando !== null}
              >
                {(() => {
                  const { Componente } = AMPLIABLES[ampliado];
                  return <Componente filas={comparacion.filas} series={comparacion.series} />;
                })()}
              </PanelDelGrafico>
              {ampliado === "acumulado" && (
                <p className="mt-3 text-xs text-slate-500">{NOTA_DEL_ACUMULADO}</p>
              )}
            </Modal>
          )}
          {/*
            Un hueco en una curva sólo se entiende si se nombra: una línea que
            se corta sin explicación se lee como un error del sistema.
          */}
          {(comparacion.disparejas.length > 0 ||
            comparacion.sinGranulometria.length > 0 ||
            comparacion.seRepitenLosPares) && (
            <div className="space-y-1 rounded border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
              {/*
                El único aviso sobre la cantidad, y es un hecho y no una
                opinión: pasadas las 36 combinaciones de color y trazo, dos
                curvas quedan dibujadas idénticas. Que doce superpuestas se lean
                con esfuerzo lo ve quien mira.
              */}
              {comparacion.seRepitenLosPares && (
                <p>
                  Son más de {COMBINACIONES_DE_LA_COMPARACION} muestras, así que hay curvas que
                  comparten color y trazo: para distinguirlas hay que mirar el tooltip.
                </p>
              )}
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

/**
 * El selector de muestras del producto: se tildan las que se quieran y se
 * aplican de una.
 *
 * **Lo tildado vive acá y no en la URL, y por eso hay un botón.** `MultiSelect`
 * avisa en cada tilde, que es lo correcto en los listados —el filtro corre en
 * el cliente y es gratis—; acá cada aviso sería un `router.push`, o sea una
 * vuelta entera al servidor con sus dos consultas por tilde. Peor que lento:
 * `elegidas` baja del servidor, así que mientras una navegación está en vuelo
 * los tildes siguientes parten del conjunto viejo y se pisan entre ellos. Se
 * junta todo acá y se aplica una vez.
 *
 * **Muestra el producto entero, incluidas las que ya están elegidas**, que
 * llegan tildadas: ése es el estado y no una lista de «lo que falta». De paso
 * resuelve solo lo que antes había que cuidar a mano —que el «(n de m)» de la
 * etiqueta se numere contra la lista entera del producto—, porque ya no se
 * saca nada de la lista.
 */
function ElegirMuestras({
  productoId,
  productoNombre,
  delSelector,
  elegidas,
  ir,
}: {
  productoId: string;
  productoNombre: string;
  delSelector: MuestraParaLaLista[];
  /** Todo lo elegido, que puede incluir muestras de otros productos. */
  elegidas: string[];
  ir: (producto: string, ids: string[]) => void;
}) {
  const delProducto = useMemo(() => delSelector.map((m) => m.id), [delSelector]);
  const yaEstaban = useMemo(
    () => delProducto.filter((id) => elegidas.includes(id)),
    [delProducto, elegidas]
  );

  const [tildadas, setTildadas] = useState<string[]>(yaEstaban);
  const [yendo, empezarAIr] = useTransition();

  const opciones = useMemo(() => {
    const etiquetas = etiquetasDeMuestras(
      delSelector.map((m) => ({
        producto: productoNombre,
        fecha: m.fecha,
        observaciones: m.observaciones,
      })),
      false
    );
    return delSelector.map((m, i): [string, string] => [m.id, etiquetas[i]]);
  }, [delSelector, productoNombre]);

  const quedaria = laEleccionQueQueda(elegidas, delProducto, tildadas);
  const hayCambio =
    quedaria.length !== elegidas.length || quedaria.some((id, i) => id !== elegidas[i]);

  return (
    <div className="flex flex-wrap items-center gap-2">
      {/*
        Su botón es `w-full` —nació para una fila de filtros en grilla—, así
        que acá va dentro de algo que le dé el ancho.
      */}
      <div className="w-60 max-w-full">
        <MultiSelect
          valores={tildadas}
          onCambio={setTildadas}
          // «Elegí las muestras» y no «Elegí una muestra»: el resumen cerrado
          // dice cuántas de **este** producto están tildadas, y vacío puede
          // ser tanto «todavía no elegí nada» como «destildé las que había»,
          // que no es «agregar otra».
          vacio="Elegí las muestras"
          plural="muestras"
          opciones={opciones}
          limpiar="Destildar todas"
        />
      </div>
      <button
        type="button"
        // Sin `disabled:opacity-50` al lado: `globals.css` ya le pone el
        // apagado y el `:hover:not(:disabled)` a los cuatro `.btn-*`, y una
        // utilidad que repite lo que la clase sin capa ya declara no gana
        // nunca — sólo promete que sí.
        className="btn-secondary"
        disabled={!hayCambio || yendo}
        onClick={() => empezarAIr(() => ir(productoId, quedaria))}
      >
        {yendo ? "Buscando…" : "Comparar"}
      </button>
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

          {productoId !== "" && delSelector.length > 0 && (
            // La `key` lo vuelve a montar con lo elegido de cada navegación:
            // lo tildado es estado local, y sin esto quedaría diciendo lo de
            // antes del salto —o lo del producto anterior—.
            <ElegirMuestras
              key={`${productoId}:${elegidas.join(",")}`}
              productoId={productoId}
              productoNombre={productoNombre}
              delSelector={delSelector}
              elegidas={elegidas}
              ir={ir}
            />
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
                {/*
                  El mismo trazo que la curva y que la leyenda, y no un punto
                  de color: sin tope, dos muestras pueden compartir color y
                  distinguirse sólo por el trazo, y un punto las haría ver
                  iguales justo en el lugar donde se elige cuál sacar.
                */}
                <svg width="16" height="8" aria-hidden className="shrink-0">
                  <line
                    x1="0"
                    y1="4"
                    x2="16"
                    y2="4"
                    stroke={s.color}
                    strokeWidth="2"
                    strokeDasharray={s.trazo}
                  />
                </svg>
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
