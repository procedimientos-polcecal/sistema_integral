"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Select from "@/components/Select";
import { norm } from "@/lib/core/texto";
import {
  comoSeLee, diaDeLaSemana, hoyEnArgentina, mesRelativo, rangoDelMes, semanaDe,
} from "@/lib/core/fechas";
import { ESPECIALIDADES } from "@/lib/mantenimiento/ordenes";
import { TIPOS_DE_OT, QUIENES_DE_OT } from "@/lib/mantenimiento/filtrosOt";
import { oficioDeLaEspecialidad } from "@/lib/mantenimiento/genteDelDia";
import {
  SIN_ESPECIALIDAD, SIN_FILTROS, pasaElFiltro, type Filtros,
} from "@/lib/mantenimiento/filtrosDelCalendario";
import type { DiaDelCalendario } from "@/lib/mantenimiento/calendarioDeOT";
import { porQueNoSePuedeMover, porQueNoSePuedeMoverA } from "@/lib/mantenimiento/moverLaOT";
import { porQueNoSePuedeAsignar } from "@/lib/mantenimiento/asignarOperario";
import { armarUrlDeImpresion, type Periodo } from "@/lib/mantenimiento/urlDeImpresion";
import type { Oficio } from "@/lib/mantenimiento/programacion";
import {
  colorDeEspecialidad, textoSobreLaEspecialidad, LEYENDA_DE_ESPECIALIDADES,
  COLOR_ATRASADA, estiloDeLaFicha,
} from "./coloresDeEspecialidad";

/**
 * El mes de órdenes de trabajo: qué tiene cada día y cuánta gente del taller
 * hay, para decidir dónde ubicar una orden sin apilar tareas del mismo tipo el
 * mismo día.
 *
 * **Lo usan dos pantallas y hacen cosas distintas**, que es lo que gobierna el
 * `modo`:
 *
 * - `elegir` — el alta de una OT, adentro de `CalendarioDeFecha`: se toca un
 *   día y esa fecha va al campo. No escribe nada.
 * - `programar` — la pestaña «Mes» de Programación: se abre un día, se elige
 *   una orden y se la corre a otro día. Eso **sí escribe**, y por el camino de
 *   `postergar`: justificación obligatoria, planilla primero y auditoría.
 *
 * Lo que cuenta de la pantalla, por si se la va a tocar:
 *
 * - **El mes llega entero y los filtros sólo cambian lo que se pinta.** Se pide
 *   de lunes a domingo de las semanas que toca el mes, así que los días de
 *   relleno del principio y del final también traen sus órdenes.
 * - **Tres fichas por día y de la cuarta en adelante «+N más».** No es gusto: en
 *   el teléfono el ancho útil es de 343 px y cada día mide unos 46; con cinco
 *   fichas la grilla se desarma.
 * - **El mes de noviembre sale casi de un solo color** (veinte de las 21 abiertas
 *   son MECÁNICO), así que el color no alcanza para distinguir un día de otro.
 *   Cada día lleva su cuenta en número y el fondo se oscurece con ella.
 * - **Vacío no es lo mismo que «no pude preguntar».** Mientras carga y cuando el
 *   pedido falla no se dibuja la grilla: una grilla sin fichas se leería como un
 *   mes sin trabajo, que es justo lo contrario de no saber.
 * - **«Padrón sin cargar» no es cero.** Cero es «el padrón está y ese día no
 *   viene nadie de ese oficio»; lo otro es que nadie dio de alta al taller. Se
 *   escriben distinto a propósito.
 * - **Las fichas de arrastre van huecas.** Un día que es parte de la ventana de
 *   una orden pero no su inicio se ve distinto al día en que arranca.
 * - **Mientras se mueve una orden, un día que no la puede recibir no se apaga y
 *   ya: dice por qué.** Un día en gris sin explicación es la forma más rápida
 *   de que alguien concluya que la pantalla está rota.
 */

export type OrdenDelDia = DiaDelCalendario["ordenes"][number];

const MAX_FICHAS = 3;

const MESES = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];
const DIAS_DE_LA_SEMANA = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
const ENCABEZADOS = ["Lu", "Ma", "Mi", "Ju", "Vi", "Sá", "Do"];

/** Cómo se nombra cada oficio en pantalla. Lo comparte el panel de asignar. */
export const OFICIOS: Record<Oficio, { uno: string; varios: string }> = {
  mecanico: { uno: "mecánico", varios: "mecánicos" },
  electricista: { uno: "electricista", varios: "electricistas" },
  lubricador: { uno: "lubricador", varios: "lubricadores" },
};
const ORDEN_DE_OFICIOS: Oficio[] = ["mecanico", "electricista", "lubricador"];

/**
 * Qué hace la pantalla con el día que se toca. Es una unión y no dos props
 * sueltas a propósito: «elegir una fecha» y «mover una orden» no pueden estar
 * las dos prendidas, y con props opcionales nada lo impediría.
 */
export type ModoDelCalendario =
  | {
      tipo: "elegir";
      /** La fecha que ya tiene el campo ("YYYY-MM-DD") o vacío. */
      valor: string;
      onElegir: (dia: string) => void;
    }
  | {
      tipo: "programar";
      /**
       * Si quien mira puede mover una orden, o sea si tiene nivel de edición en
       * Mantenimiento. En `false` el calendario se ve entero —qué tiene cada
       * día y cuánta gente hay es información, no una acción— y lo único que no
       * aparece es el botón de mover.
       *
       * **No es una comodidad: es la misma regla que el botón «Postergar» del
       * listado**, que va detrás de `canEdit`. `/mantenimiento/planificacion` la
       * ve cualquiera con el módulo —seis usuarios la tienen en `lectura`—, así
       * que sin esto el botón sale para todos y el servidor contesta 403
       * después de haber hecho escribir la justificación. Un botón que rebota es
       * peor que uno que no está.
       */
      puedeMover: boolean;
      /** La orden que se está moviendo, o `null` si no hay ninguna en curso. */
      moviendo: OrdenDelDia | null;
      onEmpezarAMover: (orden: OrdenDelDia) => void;
      onCancelarElMovimiento: () => void;
      onElegirElDestino: (dia: string) => void;
      /**
       * Abrir el panel de asignar operarios a esa orden, en ese día. `null`
       * cuando quien mira no puede: es un permiso más alto que `puedeMover`
       * —ahí salen los nombres del taller— y por eso es una función aparte y no
       * otro `boolean`.
       */
      onAsignar: ((orden: OrdenDelDia, dia: string) => void) | null;
    };

/** Los inicios primero: son los que se ven en las tres fichas y los que importan al elegir. */
function ordenadas(ordenes: OrdenDelDia[]): OrdenDelDia[] {
  return [...ordenes].sort(
    (a, b) => Number(a.arrastre) - Number(b.arrastre) || a.ot_number - b.ot_number
  );
}

/** Cuántas órdenes cae en cada sector ese día, de más a menos. */
/** Los nombres que esa orden ya tiene puestos, en el orden de las posiciones. */
function quienesEstan(o: OrdenDelDia): string[] {
  return [o.operario_1, o.operario_2, o.operario_3]
    .map((n) => n?.trim())
    .filter((n): n is string => Boolean(n));
}

function cuentaPorSector(ordenes: OrdenDelDia[]): { sector: string; cantidad: number }[] {
  const cuenta = new Map<string, { sector: string; cantidad: number }>();
  for (const o of ordenes) {
    const clave = norm(o.sector_raw);
    const previo = cuenta.get(clave);
    if (previo) previo.cantidad++;
    else cuenta.set(clave, { sector: o.sector_raw?.trim() || "Sin sector", cantidad: 1 });
  }
  return [...cuenta.values()].sort(
    (a, b) => b.cantidad - a.cantidad || a.sector.localeCompare(b.sector, "es")
  );
}

/** El fondo del día: se oscurece con la cantidad, porque el color de las fichas no alcanza para contar. */
/**
 * Lo que la grilla le cuenta al padre de lo que está mirando. Lleva los filtros
 * y los días —y no sólo el rango— porque los indicadores y las hojas impresas
 * se calculan de eso, sin volver a pedirle nada al servidor.
 */
export interface EstadoDelCalendario {
  /** "YYYY-MM". */
  mes: string;
  /** El primer y el último día que la grilla pidió: lunes a domingo de las semanas del mes. */
  desde: string;
  hasta: string;
  filtros: Filtros;
  /** Vacío mientras carga o si el pedido falló. */
  dias: DiaDelCalendario[];
  /**
   * Llevar la grilla al mes de hoy. Va acá y no es una prop de control porque
   * **el mes es estado de este componente**: un `mes` que entre desde afuera
   * serían dos dueños de lo mismo, y las flechas dejarían de andar en cuanto el
   * padre no las escuchara. Así el padre puede ofrecer «Ir a hoy» —la barra de
   * indicadores lo necesita cuando el mes que se mira no contiene hoy— sin
   * saber nada de cómo se guarda el mes.
   *
   * Su identidad es estable, como la del resto del objeto.
   */
  irAlMesDeHoy: () => void;
}

/** Identidad estable para «todavía no hay días»: ver el efecto que llama a `onEstado`. */
const SIN_DIAS: DiaDelCalendario[] = [];

/**
 * El enlace que abre una hoja para imprimir, en una pestaña nueva.
 *
 * Es un `<a>` y no un `onClick` con `window.open` para que el clic del medio y
 * «abrir en otra pestaña» anden, y porque un enlace lo lee el lector de
 * pantalla como lo que es.
 *
 * Lleva `no-print` porque la hoja no se pide desde la hoja. Hoy desde esta
 * pantalla nadie imprime, así que no cambia nada; el día que alguien apriete
 * Ctrl+P acá, sí.
 */
function EnlaceDeImpresion({ href, children, className = "" }: {
  href: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={`no-print ${className}`}
    >
      {children}
    </a>
  );
}

function fondoDelDia(n: number): string {
  if (n === 0) return "#ffffff";
  if (n === 1) return "#f1f5f9";
  if (n === 2) return "#e2e8f0";
  if (n === 3) return "#cbd5e1";
  if (n <= 5) return "#b6c2d3";
  return "#9fb0c6";
}

export default function CalendarioDeOT({
  modo, recarga = 0, franjaDeLaSemana, onEstado,
}: {
  modo: ModoDelCalendario;
  /**
   * Se le suma uno desde afuera para volver a pedir el mes. Lo usa la pestaña
   * de Programación después de mover una orden: la grilla tiene que mostrarla
   * en el día nuevo, y el componente no se desmonta.
   */
  recarga?: number;
  /**
   * Qué dibujar arriba de cada semana, por lunes. Opcional y sin default: las
   * tres pantallas que montan este calendario reparten permisos distintos y
   * sólo «Asignación RR.HH» tiene los nombres del taller. Por eso esto es una
   * prop de render y no un `boolean`: quien los tiene los dibuja, y acá no
   * entra ni la ruta que los trae ni el permiso que los guarda.
   */
  franjaDeLaSemana?: (lunes: string) => React.ReactNode;
  /**
   * Qué está mirando la grilla: el mes, el rango que pidió, los filtros puestos
   * y los días que llegaron. Todo eso es estado de acá —el mes se cambia con
   * las flechas y los filtros son tres desplegables de esta barra—, así que el
   * padre no tiene otra forma de saberlo.
   *
   * Lo usan dos cosas de `MesDeOrdenes`: traer el taller para las mismas
   * semanas, y dibujar los indicadores de arriba **con el filtro puesto**, sin
   * pedirle nada más al servidor.
   *
   * **Tiene que ser estable entre renders**, o sea un `useCallback` y no una
   * arrow escrita en el JSX: va en las dependencias de un efecto que llama al
   * padre, así que una identidad nueva por render es un bucle infinito. Y lo
   * que el padre guarde tiene que conservar su identidad cuando nada cambió
   * (`MesDeOrdenes` compara antes de setear), por lo mismo. La de al lado,
   * `franjaDeLaSemana`, **sí** puede ir inline: no está en ninguna dependencia.
   */
  onEstado?: (e: EstadoDelCalendario) => void;
}) {
  const hoy = hoyEnArgentina();
  const valor = modo.tipo === "elegir" ? modo.valor : "";
  const moviendo = modo.tipo === "programar" ? modo.moviendo : null;

  const [mes, setMes] = useState(() => (/^\d{4}-\d{2}-\d{2}$/.test(valor) ? valor : hoy).slice(0, 7));
  /*
   * Los dos llevan el número del pedido que los escribió, y es lo que decide
   * cuál manda cuando los dos hablan del mismo mes: el más nuevo.
   *
   * Sin eso, una recarga que falla sobre un mes YA DIBUJADO era invisible —la
   * foto vieja tapaba el error— y la pantalla se contradecía sola: el cartel
   * verde decía «la OT quedó para el 25/11» y la grilla la seguía pintando el
   * día de antes, sin un solo aviso. Lo que sigue naturalmente ahí es volver a
   * moverla, y postergar **suma días sobre la fecha que ya cambió**: la orden
   * termina en un día que nadie eligió, con otra escritura a la planilla y otra
   * justificación. El camino sólo existe desde que hay `recarga`; con el cambio
   * de mes el error se veía, porque ahí la foto era de otro mes.
   */
  const [datos, setDatos] = useState<{ mes: string; dias: DiaDelCalendario[]; pedido: number } | null>(null);
  const [fallo, setFallo] = useState<{ mes: string; mensaje: string; pedido: number } | null>(null);
  const pedidos = useRef(0);
  const [intento, setIntento] = useState(0);
  const [filtros, setFiltros] = useState<Filtros>(SIN_FILTROS);
  const [diaAbierto, setDiaAbierto] = useState<string | null>(null);
  // Por qué el día que se acaba de tocar no puede recibir la orden en curso.
  const [diaRechazado, setDiaRechazado] = useState<{ dia: string; motivo: string } | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // Lo que se pide: de lunes a domingo de las semanas que toca el mes, así los
  // días de relleno de la grilla también traen sus órdenes (cabe en 62 días).
  const { desde, hasta } = useMemo(() => {
    const { primerDia, ultimoDia } = rangoDelMes(mes);
    return { desde: semanaDe(primerDia)[0], hasta: semanaDe(ultimoDia)[6] };
  }, [mes]);

  useEffect(() => {
    let cancelado = false;
    const pedido = ++pedidos.current;
    (async () => {
      try {
        const res = await fetch(`/api/mantenimiento/calendario?desde=${desde}&hasta=${hasta}`);
        const cuerpo = await res.json().catch(() => ({}));
        if (cancelado) return;
        if (!res.ok || !Array.isArray(cuerpo.dias)) {
          setFallo({ mes, pedido, mensaje: cuerpo.error ?? `El servidor contestó ${res.status}.` });
          return;
        }
        setDatos({ mes, pedido, dias: cuerpo.dias });
      } catch (e) {
        if (!cancelado) {
          setFallo({ mes, pedido, mensaje: e instanceof Error ? e.message : String(e) });
        }
      }
    })();
    return () => { cancelado = true; };
  }, [desde, hasta, mes, intento, recarga]);

  // En el teléfono el panel queda debajo de la grilla: al abrirlo hay que verlo.
  useEffect(() => {
    if (diaAbierto) panelRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [diaAbierto]);

  // De este mes, y el más nuevo de los dos manda. `dias` y `error` pueden estar
  // los dos puestos a la vez, y es justamente el caso que antes no se veía: la
  // grilla de antes sigue a la vista —sirve— con el cartel encima diciendo que
  // no se pudo volver a leer.
  const laFoto = datos?.mes === mes ? datos : null;
  const elFallo = fallo?.mes === mes ? fallo : null;
  const cargando = !laFoto && !elFallo;
  const error = elFallo && elFallo.pedido > (laFoto?.pedido ?? -1) ? elFallo.mensaje : null;
  const dias = laFoto?.dias ?? null;

  /*
   * Lo que la grilla está mirando, para el padre. Va acá abajo y no arriba
   * porque necesita `dias`, que sale de la foto.
   *
   * `SIN_DIAS` es una constante de módulo y no un `[]` escrito acá: un arreglo
   * nuevo por render entraría en las dependencias con identidad distinta cada
   * vez, que es el bucle infinito contra el que advierte la prop.
   */
  /*
   * `hoyEnArgentina()` adentro y no el `hoy` de arriba, para que la dependencia
   * quede vacía y la identidad **no cambie nunca**.
   *
   * No es prolijidad: la app vive instalada en los teléfonos y puede quedar
   * abierta días. Con `[hoy]`, al cruzar la medianoche esto se rearma, pero el
   * padre conserva el objeto viejo —compara los otros campos, que no se
   * movieron—, así que «Ir a hoy» queda apuntando al mes de ayer. Se nota sólo
   * cruzando un fin de mes, que es cuando importa.
   */
  const irAlMesDeHoy = useCallback(() => {
    setMes(hoyEnArgentina().slice(0, 7));
    setDiaAbierto(null);
    setDiaRechazado(null);
  }, []);

  useEffect(() => {
    onEstado?.({ mes, desde, hasta, filtros, dias: dias ?? SIN_DIAS, irAlMesDeHoy });
  }, [onEstado, mes, desde, hasta, filtros, dias, irAlMesDeHoy]);

  const porDia = useMemo(() => {
    const m = new Map<string, DiaDelCalendario>();
    for (const d of dias ?? []) m.set(d.dia, d);
    return m;
  }, [dias]);

  const hayFiltro = Boolean(filtros.especialidad || filtros.tipo || filtros.quien);
  // Órdenes distintas que tocan el mes **y pasan el filtro**: es el mismo número
  // que se pinta, no el total del mes. Una de varios días cuenta una vez.
  const totalDelMes = useMemo(() => {
    const vistas = new Set<number>();
    for (const d of dias ?? []) {
      if (!d.dia.startsWith(mes)) continue;
      for (const o of d.ordenes) if (pasaElFiltro(o, filtros)) vistas.add(o.ot_number);
    }
    return vistas.size;
  }, [dias, mes, filtros]);

  function irAlMes(delta: number) {
    setMes((m) => mesRelativo(m, delta));
    setDiaAbierto(null);
    setDiaRechazado(null);
    // Un fallo es de un mes: si se vuelve a ese mes, el efecto lo pide de nuevo
    // y mientras tanto tiene que decir «Cargando…» y no el error de la vez pasada.
    setFallo(null);
  }

  function tocarElDia(dia: string) {
    if (!moviendo) {
      setDiaAbierto(dia);
      return;
    }
    const motivo = porQueNoSePuedeMoverA(moviendo, dia);
    if (motivo) {
      setDiaRechazado({ dia, motivo });
      return;
    }
    setDiaRechazado(null);
    if (modo.tipo === "programar") modo.onElegirElDestino(dia);
  }

  /**
   * Empezar a mover **cierra el panel del día**: el gesto que sigue es tocar un
   * día de la grilla, y con el panel abierto en un teléfono la grilla queda
   * fuera de la pantalla. Va acá y no en un efecto sobre `moviendo` porque un
   * `setState` adentro de un efecto encadena renders — es la regla que el lint
   * de este repo sí atrapa.
   */
  function empezarAMover(orden: OrdenDelDia) {
    setDiaAbierto(null);
    setDiaRechazado(null);
    if (modo.tipo === "programar") modo.onEmpezarAMover(orden);
  }

  const semanas = useMemo(() => {
    const filas: string[][] = [];
    for (let i = 0; i < 6; i++) {
      const lunes = semanaDe(desde, i)[0];
      if (lunes > hasta) break;
      filas.push(semanaDe(lunes));
    }
    return filas;
  }, [desde, hasta]);

  const [anio, nroMes] = mes.split("-").map(Number);

  /*
   * ── LOS ENLACES DE IMPRIMIR ───────────────────────────────────────────────
   *
   * Los arma este componente y no el padre, aunque la hoja sea de otra página:
   * el mes, los tres filtros y el día abierto son estado de acá, y subirlos
   * tocaría las tres pantallas que montan el calendario.
   *
   * **Sólo en modo `programar`.** El otro modo es el campo de fecha del alta de
   * una OT: ahí el calendario es un selector adentro de un formulario, y un
   * botón que abre otra pestaña en el medio de una carga no es una ayuda.
   *
   * `taller` es un pedido y no un permiso: dice que esta pantalla está
   * mostrando la rotación —o sea que recibió `franjaDeLaSemana`— y la hoja lo
   * vuelve a autorizar del lado del servidor.
   */
  const seImprime = modo.tipo === "programar";
  const pideElTaller = Boolean(franjaDeLaSemana);
  const urlDeLaHoja = (periodo: Periodo, d: string, h: string) =>
    armarUrlDeImpresion({ periodo, desde: d, hasta: h, filtros, taller: pideElTaller });

  return (
    <div className="space-y-2">
      {/* La barra de «estoy moviendo una orden». Arriba de todo y pegajosa:
          se puede cambiar de mes mientras se mueve, y en un teléfono la grilla
          de diciembre deja el aviso fuera de pantalla. */}
      {moviendo && modo.tipo === "programar" && (
        <div
          className="sticky top-0 z-10 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2"
          role="status"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-amber-900">
              Moviendo la <span className="font-bold">OT {moviendo.ot_number}</span>
              {moviendo.fecha_ejecucion && (
                <span className="text-amber-800"> — hoy está para el {comoSeLee(moviendo.fecha_ejecucion)}</span>
              )}
              . Tocá el día al que la querés correr.
            </p>
            <button type="button" onClick={modo.onCancelarElMovimiento} className="btn-secondary shrink-0">
              Cancelar
            </button>
          </div>
          {diaRechazado && (
            <p className="mt-1 text-xs font-medium text-amber-900">
              El {comoSeLee(diaRechazado.dia)} no: {diaRechazado.motivo}
            </p>
          )}
        </div>
      )}

      {/* Los filtros cambian lo que se pinta, no lo que se pidió. */}
      <div className="flex flex-wrap gap-2">
        <div className="flex-1 basis-28">
          <Select
            value={filtros.especialidad}
            onChange={(e) => setFiltros((f) => ({ ...f, especialidad: e.target.value }))}
            className="input"
            aria-label="Filtrar por especialidad"
          >
            <option value="">Toda especialidad</option>
            {ESPECIALIDADES.map((v) => <option key={v} value={v}>{v}</option>)}
            <option value={SIN_ESPECIALIDAD}>Sin especialidad</option>
          </Select>
        </div>
        <div className="flex-1 basis-28">
          <Select
            value={filtros.tipo}
            onChange={(e) => setFiltros((f) => ({ ...f, tipo: e.target.value }))}
            className="input"
            aria-label="Filtrar por tipo"
          >
            <option value="">Todo tipo</option>
            {TIPOS_DE_OT.map((v) => <option key={v} value={v}>{v}</option>)}
          </Select>
        </div>
        <div className="flex-1 basis-28">
          <Select
            value={filtros.quien}
            onChange={(e) => setFiltros((f) => ({ ...f, quien: e.target.value }))}
            className="input"
            aria-label="Filtrar por quién realiza"
          >
            <option value="">Quien sea</option>
            {QUIENES_DE_OT.map((v) => <option key={v} value={v}>{v}</option>)}
          </Select>
        </div>
      </div>

      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => irAlMes(-1)}
          aria-label="Mes anterior"
          className="rounded-lg border border-slate-200 px-3 py-1 text-sm text-slate-600 hover:bg-slate-50"
        >
          ‹
        </button>
        <div className="text-center">
          <div className="text-sm font-semibold text-slate-800 capitalize">
            {MESES[nroMes - 1]} {anio}
          </div>
          {dias && (
            <div className="text-[11px] text-slate-500">
              {totalDelMes === 0
                ? hayFiltro ? "Ninguna orden este mes con ese filtro" : "Ninguna orden este mes"
                : `${totalDelMes} ${totalDelMes === 1 ? "orden" : "órdenes"} en el mes${hayFiltro ? ", con ese filtro" : ""}`}
            </div>
          )}
          {seImprime && (
            <EnlaceDeImpresion
              href={urlDeLaHoja("mes", desde, hasta)}
              className="mt-1 inline-block text-[11px] text-slate-500 underline-offset-2 hover:text-slate-800 hover:underline"
            >
              Imprimir el mes
            </EnlaceDeImpresion>
          )}
        </div>
        <button
          type="button"
          onClick={() => irAlMes(1)}
          aria-label="Mes siguiente"
          className="rounded-lg border border-slate-200 px-3 py-1 text-sm text-slate-600 hover:bg-slate-50"
        >
          ›
        </button>
      </div>

      <div className="flex flex-col md:flex-row gap-3">
        <div className="min-w-0 md:flex-1">
          {cargando && (
            <p className="rounded-lg bg-slate-50 px-3 py-10 text-center text-sm text-slate-500" role="status">
              Cargando el mes…
            </p>
          )}

          {error && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-4 space-y-2" role="alert">
              {/* Dos textos porque son dos cosas distintas: no haber podido
                  leer el mes, y haber leído uno viejo. El segundo es el que
                  importa — con la grilla a la vista, un «no se pudo consultar»
                  a secas deja que esa foto de antes de mover la orden pase por
                  buena. */}
              <p className="text-sm font-medium text-red-800">
                {dias
                  ? "No se pudo volver a leer el mes. Lo que se ve abajo es de antes: puede que ya no sea lo que hay."
                  : "No se pudo consultar el calendario. Esto no quiere decir que el mes esté vacío."}
              </p>
              <p className="text-xs text-red-700 break-words">{error}</p>
              <button
                type="button"
                onClick={() => { setFallo(null); setIntento((n) => n + 1); }}
                className="btn-secondary"
              >
                Reintentar
              </button>
            </div>
          )}

          {dias && (
            <>
              <div className="grid grid-cols-7 gap-px pb-px text-center text-[10px] font-semibold uppercase text-slate-400">
                {ENCABEZADOS.map((h) => <div key={h}>{h}</div>)}
              </div>
              {/* Una grilla por semana, no una sola de 42 celdas: la franja del
                  taller va *entre* las filas, y eso no se puede hacer con una
                  grilla única sin que el elemento intercalado ocupe celdas.
                  Sin la prop las filas quedan pegadas por `space-y-px`, pero
                  **no es idéntico a antes y no se afirma que lo sea**: antes
                  había una caja con un borde y dos esquinas redondeadas, y
                  ahora hay una por semana. Eso toca a las dos pantallas que no
                  reciben franja —el alta de una OT y la pestaña Mes de
                  `/planificacion`—, y no se pudo mirar en un navegador porque
                  todo está detrás del login. */}
              <div className="space-y-px">
                {semanas.map((semana) => (
                  <div key={semana[0]} className={seImprime ? "pb-2" : undefined}>
                    {franjaDeLaSemana?.(semana[0])}
                    <div className="grid grid-cols-7 gap-px rounded-lg overflow-hidden bg-slate-200 border border-slate-200">
                      {semana.map((dia) => (
                        <CeldaDelDia
                          key={dia}
                          dia={dia}
                          delMes={dia.startsWith(mes)}
                          info={porDia.get(dia)}
                          filtros={filtros}
                          esHoy={dia === hoy}
                          esElValor={dia === valor}
                          abierto={dia === diaAbierto}
                          noPuedeRecibir={moviendo ? porQueNoSePuedeMoverA(moviendo, dia) : null}
                          onTocar={() => tocarElDia(dia)}
                        />
                      ))}
                    </div>
                    {/* Debajo de la grilla y no arriba: la franja del taller
                        lleva `rounded-t-lg` para pegarse a la grilla, y
                        cualquier cosa en el medio parte esa unión. Queda a 2px
                        de la grilla que nombra y a 8px de la semana siguiente,
                        que es lo que dice de cuál de las dos habla. */}
                    {seImprime && (
                      <div className="mt-0.5 flex justify-end">
                        <EnlaceDeImpresion
                          href={urlDeLaHoja("semana", semana[0], semana[6])}
                          className="px-1 text-[11px] text-slate-400 underline-offset-2 hover:text-slate-800 hover:underline"
                        >
                          Imprimir esta semana
                        </EnlaceDeImpresion>
                      </div>
                    )}
                  </div>
                ))}
              </div>

              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pt-2 text-[11px] text-slate-500">
                {LEYENDA_DE_ESPECIALIDADES.map((l) => (
                  <span key={l.nombre} className="inline-flex items-center gap-1">
                    <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: l.color }} />
                    {l.nombre}
                  </span>
                ))}
                <span className="inline-flex items-center gap-1">
                  <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: COLOR_ATRASADA }} />
                  Atrasada
                </span>
                <span className="inline-flex items-center gap-1">
                  <span
                    className="inline-block h-2.5 w-4 rounded-sm"
                    style={{ border: "1.5px dashed #6b7280" }}
                  />
                  continúa de un día anterior
                </span>
              </div>
              <p className="text-[11px] text-slate-400 pt-1">
                El número de arriba a la derecha de cada día es cuántas órdenes tiene; cuanto más oscuro, más cargado.
              </p>
            </>
          )}
        </div>

        {diaAbierto && dias && (
          <div ref={panelRef} className="md:w-80 md:shrink-0">
            <PanelDelDia
              dia={porDia.get(diaAbierto) ?? null}
              diaIso={diaAbierto}
              filtros={filtros}
              urlDeImpresion={seImprime ? urlDeLaHoja("dia", diaAbierto, diaAbierto) : null}
              elegirElDia={modo.tipo === "elegir" ? modo.onElegir : null}
              onMover={modo.tipo === "programar" && modo.puedeMover ? empezarAMover : null}
              onAsignar={modo.tipo === "programar" ? modo.onAsignar : null}
              onCerrar={() => setDiaAbierto(null)}
            />
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Un día de la grilla ────────────────────────────────────────────────────

function CeldaDelDia({
  dia, delMes, info, filtros, esHoy, esElValor, abierto, noPuedeRecibir, onTocar,
}: {
  dia: string;
  delMes: boolean;
  info: DiaDelCalendario | undefined;
  filtros: Filtros;
  esHoy: boolean;
  esElValor: boolean;
  abierto: boolean;
  /** Mientras se mueve una orden: por qué este día no la puede recibir. */
  noPuedeRecibir: string | null;
  onTocar: () => void;
}) {
  const visibles = ordenadas((info?.ordenes ?? []).filter((o) => pasaElFiltro(o, filtros)));
  const fichas = visibles.slice(0, MAX_FICHAS);
  const resto = visibles.length - fichas.length;
  // Sobre `visibles` y no sobre `fichas`: la cuenta tiene que incluir las que
  // quedaron en el «+N más», que son invisibles para los dos —el que mira y el
  // que escucha— pero siguen estando en ese día.
  const atrasadasDelDia = visibles.filter((o) => o.atrasada).length;
  const numero = Number(dia.slice(8, 10));

  // Un solo botón por día: las fichas y el «+N más» son texto adentro, así que
  // un click en cualquiera abre el panel y no hay botones anidados.
  //
  // **El día que no puede recibir la orden sigue siendo un botón y no un
  // `disabled`**: tocarlo es lo que dice por qué, y un botón apagado no se
  // puede tocar. Lleva `aria-disabled` para que el lector de pantalla lo diga
  // igual.
  return (
    <button
      type="button"
      onClick={onTocar}
      // Las atrasadas se nombran **acá** y no en cada ficha. El nombre
      // accesible de un botón lo fija su `aria-label` y anula lo que haya
      // adentro, así que una etiqueta puesta en el `<span>` de una ficha no se
      // anuncia nunca —y encima iría sobre un `<span>` sin `role`, que tampoco
      // las expone—. Sin esto, el que usa lector de pantalla oye «5 órdenes» y
      // no se entera de que hay rojo, que es lo único que este color dice.
      aria-label={`${comoSeLee(dia)}: ${visibles.length} ${visibles.length === 1 ? "orden" : "órdenes"}${
        atrasadasDelDia > 0 ? `, ${atrasadasDelDia} ${atrasadasDelDia === 1 ? "atrasada" : "atrasadas"}` : ""
      }`}
      aria-pressed={abierto}
      aria-disabled={noPuedeRecibir ? true : undefined}
      title={noPuedeRecibir ?? undefined}
      className="flex min-h-[4.5rem] min-w-0 flex-col gap-0.5 p-0.5 text-left"
      style={{
        background: fondoDelDia(visibles.length),
        opacity: noPuedeRecibir ? 0.45 : 1,
        outline: abierto ? "2px solid #0f172a" : esElValor ? "2px solid #16a34a" : "none",
        outlineOffset: "-2px",
      }}
    >
      <span className="flex items-center justify-between gap-0.5 px-0.5">
        <span
          className="text-[11px] leading-4"
          style={{
            fontWeight: esHoy ? 800 : 500,
            // Los días de relleno de otro mes se distinguen por el número en
            // cursiva y más tenue, no con `opacity`: bajarle la opacidad a la
            // celda entera le quitaba contraste al número de OT de las fichas.
            color: esHoy ? "#0f172a" : delMes ? "#475569" : "#64748b",
            fontStyle: delMes ? "normal" : "italic",
            textDecoration: esHoy ? "underline" : "none",
          }}
        >
          {numero}
        </span>
        {visibles.length > 0 && (
          <span
            className="rounded-full px-1 text-[10px] font-bold leading-4"
            style={{ background: "#0f172a", color: "#ffffff" }}
          >
            {visibles.length}
          </span>
        )}
      </span>
      {fichas.map((o) => (
        <span
          key={o.ot_number}
          className="block truncate rounded px-0.5 text-center text-[10px] font-semibold leading-4"
          // El `title` se queda: es el globo del mouse y sí se ve. El
          // `aria-label` que estaba acá se fue al botón del día, que es el
          // único texto que un lector de pantalla llega a decir; dejarlo
          // puesto prometía algo que no pasaba, y una etiqueta que no puede
          // ganar se saca — la misma regla que las utilidades de Tailwind
          // contra las clases sin capa.
          title={o.atrasada ? "Atrasada" : undefined}
          // Las cuatro ramas de (atrasada, arrastre) viven en
          // `coloresDeEspecialidad.ts`, con su porqué medido. Acá eran un
          // ternario anidado que ningún test podía mirar, porque este
          // componente trae sus datos en un `useEffect` y renderizarlo sin
          // navegador no dibuja ni una ficha.
          style={estiloDeLaFicha(o)}
        >
          {o.ot_number}
        </span>
      ))}
      {resto > 0 && (
        <span className="block text-center text-[10px] font-semibold leading-4 text-slate-700">
          +{resto} más
        </span>
      )}
    </button>
  );
}

// ─── El panel del día ───────────────────────────────────────────────────────

function PanelDelDia({
  dia, diaIso, filtros, elegirElDia, onMover, onAsignar, onCerrar, urlDeImpresion,
}: {
  dia: DiaDelCalendario | null;
  diaIso: string;
  filtros: Filtros;
  /** La hoja de ese día, o `null` si desde esta pantalla no se imprime. */
  urlDeImpresion: string | null;
  /** El pie que manda la fecha al campo, en el modo `elegir`. */
  elegirElDia: ((dia: string) => void) | null;
  /** Empezar a mover una orden, en el modo `programar`. */
  onMover: ((orden: OrdenDelDia) => void) | null;
  /** Abrir el panel de asignar operarios, sólo para quien ve el taller. */
  onAsignar: ((orden: OrdenDelDia, dia: string) => void) | null;
  onCerrar: () => void;
}) {
  const todas = dia?.ordenes ?? [];
  const ordenes = ordenadas(todas.filter((o) => pasaElFiltro(o, filtros)));
  const ocultas = todas.length - ordenes.length;
  const sectores = cuentaPorSector(ordenes);
  const hayChoque = sectores.some((s) => s.cantidad >= 2);
  const gente = dia?.gente ?? { sabemos: false as const };

  // Qué oficios del taller mira el panel: los de las órdenes que se ven. Un día
  // sin ninguna muestra los tres, que es lo que sirve para decidir dónde ubicar.
  const oficiosDeLasOrdenes = new Set<Oficio>();
  const sinGente = new Set<string>();
  for (const o of ordenes) {
    const oficio = oficioDeLaEspecialidad(o.especialidad);
    if (oficio) oficiosDeLasOrdenes.add(oficio);
    else sinGente.add(o.especialidad?.trim() || "Sin especialidad");
  }
  const oficiosAMostrar = ORDEN_DE_OFICIOS.filter((o) =>
    ordenes.length === 0 ? true : oficiosDeLasOrdenes.has(o)
  );

  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-sm font-bold text-slate-900 capitalize">
            {DIAS_DE_LA_SEMANA[diaDeLaSemana(diaIso)]} {comoSeLee(diaIso)}
          </div>
          <div className="text-xs text-slate-600">
            {ordenes.length === 0
              ? "Sin órdenes ese día"
              : `${ordenes.length} ${ordenes.length === 1 ? "orden" : "órdenes"}`}
          </div>
          {urlDeImpresion && (
            <EnlaceDeImpresion
              href={urlDeImpresion}
              className="mt-1 inline-block text-[11px] text-slate-500 underline-offset-2 hover:text-slate-800 hover:underline"
            >
              Imprimir este día
            </EnlaceDeImpresion>
          )}
        </div>
        <button
          type="button"
          onClick={onCerrar}
          aria-label="Cerrar el día"
          className="p-1 rounded-lg text-slate-400 hover:bg-slate-200 transition-colors"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {ocultas > 0 && (
        <p className="text-xs rounded-lg px-2 py-1" style={{ background: "#fef3c7", color: "#92400e" }}>
          El filtro oculta {ocultas} {ocultas === 1 ? "orden" : "órdenes"} de este día.
        </p>
      )}

      {sectores.length > 0 && (
        <div className="space-y-1">
          <div className="text-[11px] font-semibold uppercase text-slate-500">Por sector</div>
          <ul className="space-y-1">
            {sectores.map((s) => (
              <li
                key={s.sector}
                className="flex items-center justify-between gap-2 rounded-lg px-2 py-1 text-xs"
                style={
                  s.cantidad >= 2
                    ? { background: "#fee2e2", color: "#991b1b", fontWeight: 600 }
                    : { background: "#ffffff", color: "#334155" }
                }
              >
                <span className="min-w-0 break-words">{s.sector}</span>
                <span className="shrink-0">{s.cantidad}</span>
              </li>
            ))}
          </ul>
          {hayChoque && (
            <p className="text-[11px]" style={{ color: "#991b1b" }}>
              Hay sectores con más de una orden ese día.
            </p>
          )}
        </div>
      )}

      {ordenes.length > 0 && (
        <ul className="space-y-2">
          {ordenes.map((o) => {
            const color = colorDeEspecialidad(o.especialidad);
            const noSeMueve = onMover ? porQueNoSePuedeMover(o) : null;
            const noSeAsigna = onAsignar ? porQueNoSePuedeAsignar(o) : null;
            return (
              <li key={o.ot_number} className="rounded-lg bg-white p-2 space-y-1 border border-slate-200">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span
                    className="rounded px-1.5 text-xs font-bold leading-5"
                    style={{ background: color, color: textoSobreLaEspecialidad(o.especialidad) }}
                  >
                    OT {o.ot_number}
                  </span>
                  {o.atrasada && (
                    <span
                      className="rounded px-1.5 text-[11px] font-semibold leading-5"
                      style={{ background: "#fee2e2", color: "#991b1b" }}
                    >
                      {o.diasDeAtraso == null
                        ? "Atrasada"
                        : `Atrasada ${o.diasDeAtraso} ${o.diasDeAtraso === 1 ? "día" : "días"}`}
                    </span>
                  )}
                  {o.arrastre && (
                    <span className="text-[11px] text-slate-500">continúa de un día anterior</span>
                  )}
                </div>
                <p className="text-xs text-slate-800 break-words">
                  {o.descripcion?.trim() || <span className="text-slate-400">Sin descripción</span>}
                </p>
                <p className="text-[11px] text-slate-500 break-words">
                  {[o.equipo_raw?.trim(), o.sector_raw?.trim()].filter(Boolean).join(" · ") || "Sin equipo ni sector"}
                </p>
                <div className="flex flex-wrap gap-1">
                  {[o.especialidad, o.tipo, o.quien].filter((t) => t?.trim()).map((t, i) => (
                    <span
                      key={i}
                      className="rounded px-1.5 text-[10px] font-medium leading-4"
                      style={{ background: "#e2e8f0", color: "#334155" }}
                    >
                      {t}
                    </span>
                  ))}
                </div>

                {/* Mover, sólo en la pestaña de Programación. La que no se puede
                    mover **dice por qué** en vez de no mostrar nada: la mayoría
                    de las órdenes entró por el formulario, y sin el motivo la
                    pantalla parece rota justo en el caso más común. */}
                {onMover && (
                  noSeMueve ? (
                    <p className="text-[11px] text-slate-500 break-words pt-0.5">{noSeMueve}</p>
                  ) : (
                    <button
                      type="button"
                      onClick={() => onMover(o)}
                      className="btn-secondary w-full justify-center"
                    >
                      Mover a otro día
                    </button>
                  )
                )}

                {/* Asignar, sólo para quien ve el taller con nombre. Como
                    arriba: la cerrada **dice por qué** en vez de quedarse sin
                    botón, porque ahí sus tres columnas ya dicen quién lo hizo. */}
                {onAsignar && (
                  noSeAsigna ? (
                    <p className="text-[11px] text-slate-500 break-words pt-0.5">{noSeAsigna}</p>
                  ) : (
                    <button
                      type="button"
                      onClick={() => onAsignar(o, diaIso)}
                      className="btn-secondary w-full justify-center"
                    >
                      {quienesEstan(o).length === 0
                        ? "Asignar operarios"
                        : `Operarios: ${quienesEstan(o).join(", ")}`}
                    </button>
                  )
                )}
              </li>
            );
          })}
        </ul>
      )}

      <div className="space-y-1">
        <div className="text-[11px] font-semibold uppercase text-slate-500">Gente del taller</div>
        {!gente.sabemos ? (
          <p className="rounded-lg px-2 py-1 text-xs" style={{ background: "#fef3c7", color: "#92400e" }}>
            Padrón sin cargar: no se sabe cuánta gente del taller hay ese día.
          </p>
        ) : (
          <ul className="space-y-1">
            {oficiosAMostrar.map((oficio) => {
              const n = gente.porOficio[oficio];
              return (
                <li
                  key={oficio}
                  className="flex items-center justify-between gap-2 rounded-lg px-2 py-1 text-xs"
                  style={
                    n === 0
                      ? { background: "#fee2e2", color: "#991b1b", fontWeight: 600 }
                      : { background: "#ffffff", color: "#334155" }
                  }
                >
                  <span className="capitalize">{OFICIOS[oficio].varios}</span>
                  <span>{n === 0 ? "nadie ese día" : n}</span>
                </li>
              );
            })}
          </ul>
        )}
        {[...sinGente].map((esp) => (
          <p key={esp} className="rounded-lg bg-white px-2 py-1 text-xs text-slate-600">
            {esp}: no lleva gente del taller
          </p>
        ))}
      </div>

      {elegirElDia && (
        <button
          type="button"
          onClick={() => elegirElDia(diaIso)}
          className="btn-primary w-full justify-center"
        >
          Elegir el {comoSeLee(diaIso)}
        </button>
      )}
    </div>
  );
}
