"use client";

import { useEffect, useState } from "react";
import { useCargar } from "@/lib/core/useCargar";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { textoDelReclamo } from "@/lib/compras/reclamo";
import NuevoRequerimientoModal from "@/app/(app)/compras/requerimientos/NuevoRequerimientoModal";
import ConversacionDelPedido from "./ConversacionDelPedido";
import {
  APROBACION_LABELS, COMPRA_LABELS, etiquetaPrioridad, fecha,
} from "@/lib/compras/constants";
import {
  DIAS_VERDE, DIAS_AMARILLO, rangoDeColor, colorDelPedido, diasEsperando,
  esReclamable, textoDeEspera, type ColorDelPedido,
} from "@/lib/compras/semaforo";
import type { RequerimientoConRelaciones } from "@/lib/compras/types";

type Opcion = { id: string; nombre: string };

const POR_PAGINA = 50;

/**
 * Los estados en los que el pedido todavía depende de Compras.
 *
 * Es el mismo conjunto que `esReclamable()` de `lib/compras/semaforo.ts`, acá
 * en la forma que PostgREST necesita para un `.in()`. El test
 * `semaforo.test.ts` ata los dos lados.
 */
const ESTADOS_QUE_ESPERAN = ["SIN_INICIAR", "EN_COMPARATIVA", "PARA_COMPRAR", "APROBADO"];

/**
 * Lo que una consulta de Supabase tiene que saber hacer para que los filtros
 * de abajo la puedan encadenar. Tipado estructural: evita importar
 * `PostgrestFilterBuilder`, que es un interno de la librería y cambia de firma
 * entre versiones.
 */
interface Filtrable {
  in(columna: string, valores: readonly (string | number)[]): Filtrable;
  eq(columna: string, valor: string | number): Filtrable;
  neq(columna: string, valor: string | number): Filtrable;
  or(filtro: string): Filtrable;
  gte(columna: string, valor: string): Filtrable;
  lte(columna: string, valor: string): Filtrable;
  order(columna: string, o: { ascending: boolean }): Filtrable;
  range(desde: number, hasta: number): PromiseLike<{ data: unknown; count: number | null; error: { message: string } | null }>;
  then: PromiseLike<{ count: number | null }>["then"];
}

/**
 * Los pedidos de mi área, y los de todos.
 *
 * Fuera del módulo Compras a propósito: cualquier usuario puede pedir un
 * material y seguir el pedido aunque no trabaje en Compras.
 *
 * **De mi área, no míos.** Acá los requerimientos se piden por área: los 950 de
 * Mantenimiento los miran todos los de Mantenimiento, los haya cargado quien
 * los haya cargado. Filtrar por quién lo cargó dejaba esto vacío para todo el
 * mundo —los 1.947 vinieron de la planilla y ninguno trae solicitante— y
 * además contestaba otra pregunta. De qué área es cada uno se carga en
 * Administración → Usuarios.
 *
 * **Y puede ver los de los demás.** No es un agregado suelto: es para lo que
 * sirve la pestaña "Requerimientos Internos" de la planilla, donde caen los RI
 * de todas las áreas. Sin eso, dos personas piden el mismo rodamiento la misma
 * semana y nadie se entera hasta que llegan dos. Buscar antes de pedir es la
 * mitad del valor de esta pantalla.
 *
 * Lo que **no** se muestra son los costos ni las comparativas: para saber si
 * algo ya se pidió alcanza con qué es, quién lo pidió y en qué anda. El detalle
 * comercial sigue dentro del módulo Compras, que es de quien es la decisión.
 *
 * La lista se arma en el cliente y no en el servidor: son 1.947 requerimientos
 * y mandarlos todos al navegador para mostrar cincuenta es lo que hace que una
 * pantalla tarde tres segundos en abrir.
 */
/** Por qué no se pudo abrir el pedido de un `?pedido=`: tres causas que se dicen distinto. */
/**
 * El pedido cuya conversación está abierta.
 *
 * Lleva el borrador porque el hilo se abre de dos maneras: desde «Mensajes»,
 * en blanco, y desde «Reclamar», con la pregunta redactada y los de Compras
 * marcados. Lo que cambia es con qué arranca el campo, no el hilo.
 */
export interface Conversacion {
  id: string;
  nroRi: number;
  descripcion: string;
  textoInicial?: string;
  mencionesIniciales?: string[];
}

export type ProblemaDelEnlace =
  | { tipo: "no-valido" }
  | { tipo: "no-existe" }
  | { tipo: "error"; detalle: string };

function textoDelProblema(p: ProblemaDelEnlace): string {
  switch (p.tipo) {
    case "no-valido":
      return "El enlace no es válido: el identificador del pedido está mal escrito. Podés buscarlo por su N° de RI acá abajo.";
    case "no-existe":
      return "El pedido al que llevaba ese enlace ya no existe. Podés buscarlo por su N° de RI acá abajo.";
    case "error":
      return `No se pudo abrir el pedido del enlace (${p.detalle}). Probá de nuevo en un rato, o buscalo por su N° de RI acá abajo.`;
  }
}

export default function MisPedidosClient({
  usuarioId, misAreas, areas, empresas, ubicaciones, gestoresDeCompras = [],
  conversacionInicial = null, problemaDelEnlace = null,
}: {
  /** El pedido cuya conversación hay que abrir al cargar: el del enlace de un correo. */
  conversacionInicial?: { id: string; nroRi: number; descripcion: string } | null;
  /** Vino un `?pedido=` y no se pudo abrir: se dice por qué, en vez de mostrar la lista como si nada. */
  problemaDelEnlace?: ProblemaDelEnlace | null;
  usuarioId: string;
  /** Los ids de las áreas de esta persona. Vacío = todavía no se le asignó. */
  misAreas: string[];
  /**
   * A quiénes menciona el reclamo: los que tienen `edicion` o `admin` en
   * Compras. Lo resuelve el servidor, que es el único que puede leer
   * `usuario_modulos` de otra persona. Vacío es aceptable: el hilo se abre sin
   * nadie marcado y se elige a mano.
   */
  gestoresDeCompras?: string[];
  areas: Opcion[];
  empresas: Opcion[];
  ubicaciones: Opcion[];
}) {
  const router = useRouter();
  const [modalAbierto, setModalAbierto] = useState(false);
  // El pedido cuya conversación está abierta. Guarda lo que el diálogo muestra
  // en el encabezado, y no sólo el id, para no buscarlo de nuevo en `pedidos`:
  // la lista se recarga al cambiar de página y el pedido puede ya no estar.
  const [conversacion, setConversacion] = useState<Conversacion | null>(conversacionInicial);
  // Si ya se está en Mis pedidos y llega otro `?pedido=` (la página se vuelve a
  // pedir al servidor sin remontar esto), el estado de arriba no se recalcula
  // solo. Se ajusta durante el render comparando contra el valor previo, y no
  // con un `key` en la página: un `key` que sale de la URL cambia cuando se
  // cierra el diálogo y se limpia `?pedido=`, y remontaría la pantalla
  // llevándose el filtro, la página y la búsqueda de quien ya estaba mirando.
  const [inicialPrevia, setInicialPrevia] = useState(conversacionInicial?.id ?? null);
  if ((conversacionInicial?.id ?? null) !== inicialPrevia) {
    setInicialPrevia(conversacionInicial?.id ?? null);
    if (conversacionInicial) setConversacion(conversacionInicial);
  }

  // Arranca en el área propia, que es a lo que se entra. Salvo que no tenga
  // ninguna asignada: ahí mostrar una lista vacía sería un callejón, así que
  // se abre en todos y el cartel explica qué falta.
  const [alcance, setAlcance] = useState<"mios" | "todos">(
    misAreas.length > 0 ? "mios" : "todos"
  );
  const [busqueda, setBusqueda] = useState("");
  const [busquedaAplicada, setBusquedaAplicada] = useState("");
  const [pagina, setPagina] = useState(0);
  /** El color por el que está filtrando la franja, o null si no hay filtro. */
  const [color, setColor] = useState<ColorDelPedido | null>(null);
  /** Cuántos pedidos esperan a Compras en cada color, del conjunto filtrado entero. */
  const [conteos, setConteos] = useState<Record<ColorDelPedido, number> | null>(null);
  /** Cuándo fue el último mensaje de cada pedido en pantalla, por id. */
  const [ultimoMensaje, setUltimoMensaje] = useState<Record<string, string>>({});

  const [pedidos, setPedidos] = useState<RequerimientoConRelaciones[]>([]);
  const [total, setTotal] = useState(0);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState("");

  // La búsqueda espera un momento para no consultar en cada tecla.
  useEffect(() => {
    const t = setTimeout(() => setBusquedaAplicada(busqueda.trim()), 350);
    return () => clearTimeout(t);
  }, [busqueda]);

  /*
   * "Cuando cambia el filtro, volvé a la primera página" se ajusta **durante el
   * render** comparando contra el valor previo, y no en un efecto. Además de
   * dejar conforme a la regla, saca un commit intermedio en el que la lista ya
   * era la del filtro nuevo y la página seguía siendo la vieja.
   */
  const filtro = `${alcance}|${busquedaAplicada}`;
  const [filtroPrevio, setFiltroPrevio] = useState(filtro);
  if (filtro !== filtroPrevio) {
    setFiltroPrevio(filtro);
    setPagina(0);
    // Y se suelta el color. Los conteos son del conjunto anterior: dejarlo
    // puesto deja la franja diciendo «15 en rojo» mientras la lista ya muestra
    // otra cosa, que es la forma más rápida de que nadie vuelva a creerle.
    setColor(null);
  }

  // El color sí resetea la página, pero no al revés.
  const [colorPrevio, setColorPrevio] = useState(color);
  if (color !== colorPrevio) {
    setColorPrevio(color);
    setPagina(0);
  }

  /*
   * Los dos filtros que comparten la lista y los conteos de la franja.
   *
   * Viven acá y no copiados en cada consulta: son cuatro consultas sobre el
   * mismo conjunto —una lista y tres conteos— y si el filtro se escribe cuatro
   * veces, tarde o temprano una se queda vieja y la franja empieza a contar
   * algo que la lista no muestra.
   *
   * El tipo es estructural a propósito: pide los métodos que se usan y nada
   * más, así que el constructor de consultas de Supabase lo cumple sin tener
   * que importar `PostgrestFilterBuilder`, que es un interno de la librería.
   */
  function conAlcanceYBusqueda(q: Filtrable): Filtrable {
    let r = q;
    // Un `.in()` de nueve áreas como mucho: no es el `.in()` de mil ids que
    // arma una URL que PostgREST rechaza.
    if (alcance === "mios") r = r.in("area_id", misAreas);

    if (busquedaAplicada) {
      // Un número suelto se busca como N° de RI, que es como lo pide la gente.
      const comoNumero = Number(busquedaAplicada);
      if (Number.isInteger(comoNumero) && comoNumero > 0) {
        r = r.eq("nro_ri", comoNumero);
      } else {
        const t = `%${busquedaAplicada.replace(/[%,()]/g, " ")}%`;
        r = r.or(`descripcion.ilike.${t},codigo.ilike.${t},solicitante_nombre.ilike.${t}`);
      }
    }
    return r;
  }

  /** El conjunto reclamable de un color: los cuatro estados que esperan a Compras. */
  function conColor(q: Filtrable, c: ColorDelPedido): Filtrable {
    const { desde, hasta } = rangoDeColor(c, new Date());
    let r = q.in("estado_compra", ESTADOS_QUE_ESPERAN).neq("estado_aprobacion", "DENEGADA");
    if (desde) r = r.gte("fecha", desde);
    if (hasta) r = r.lte("fecha", hasta);
    return r;
  }

  // `useCargar` y no un efecto que llama y listo: descarta la respuesta que
  // llega tarde. Ver `lib/core/useCargar.ts`.
  const cargar = useCargar(async (vigente) => {
    setCargando(true);
    setError("");
    const supabase = createClient();

    /*
     * El cast a `Filtrable` no pierde nada: la fila que vuelve ya se castea a
     * `RequerimientoConRelaciones` cuatro líneas más abajo, porque el embed
     * de tres tablas no lo infiere Supabase solo. Y es lo que permite que la
     * lista y los tres conteos compartan el mismo filtro en vez de escribirlo
     * cuatro veces.
     */
    let q = conAlcanceYBusqueda(
      supabase
        .from("compras_requerimientos")
        // `!empresa_id`: `compras_odoo_ordenes` abre un segundo camino hasta `empresas` (PGRST201).
        .select(
          "*, compras_areas(nombre), empresas!empresa_id(nombre), proveedores!proveedor_id(nombre)",
          { count: "exact" }
        ) as unknown as Filtrable
    );

    if (color) q = conColor(q, color);

    const desde = pagina * POR_PAGINA;
    /*
     * Con un color elegido la lista se ordena por antigüedad, del más dormido
     * al más nuevo; sin filtro sigue por N° de RI como siempre.
     *
     * No es cosmético. Medido el 12/11/2026 para Mantenimiento —1.125 pedidos,
     * 23 páginas— los 11 rojos caían en las páginas 5, 6, 7, 11, 12 y 15, y
     * **la página 1 no tenía un solo punto de color**: con el orden de siempre
     * el semáforo era invisible en la vista por defecto. Y el orden por defecto
     * no se toca porque esta pantalla también sirve para buscar si alguien ya
     * pidió lo mismo, y eso se navega por número.
     */
    const { data, count, error: err } = await (
      color
        ? q.order("fecha", { ascending: true })
        : q.order("nro_ri", { ascending: false })
    ).range(desde, desde + POR_PAGINA - 1);

    setCargando(false);
    if (err) { setError(err.message); setPedidos([]); return; }
    if (!vigente()) return;
    setPedidos((data ?? []) as RequerimientoConRelaciones[]);
    setTotal(count ?? 0);
  }, [alcance, busquedaAplicada, pagina, misAreas, color]);

  /*
   * Los tres conteos de la franja.
   *
   * Son del **conjunto filtrado entero** y no de la página: lo que el área
   * quiere saber es cuántos tiene, no cuántos entraron en esta pantalla. Van
   * con `head: true`, así que no traen ni una fila — tres consultas que
   * devuelven sólo el número.
   *
   * No dependen de `pagina` a propósito: pasar de página no cambia el conjunto
   * y volver a contarlo serían tres consultas por cada clic.
   */
  const contar = useCargar(async (vigente) => {
    const supabase = createClient();
    const colores: ColorDelPedido[] = ["verde", "amarillo", "rojo"];

    const cuentas = await Promise.all(
      colores.map(async (c) => {
        const { count } = await conColor(
          conAlcanceYBusqueda(
            supabase
              .from("compras_requerimientos")
              .select("id", { count: "exact", head: true }) as unknown as Filtrable
          ),
          c
        );
        return count ?? 0;
      })
    );

    if (!vigente()) return;
    setConteos({ verde: cuentas[0], amarillo: cuentas[1], rojo: cuentas[2] });
  }, [alcance, busquedaAplicada, misAreas]);


  /*
   * Cuándo se habló por última vez de cada pedido que está en pantalla.
   *
   * Sirve para no reclamar dos veces lo mismo: sin esto, las mismas filas
   * rojas se reclaman un día sí y otro también, y los quince que miran con
   * alcance «Todos» le mandan el mismo correo a las mismas cuatro personas —
   * que es, textualmente, cómo este sistema ya documentó que mueren sus
   * notificaciones.
   *
   * **Dice «último mensaje» y no «reclamado», a propósito.** El hilo guarda
   * cualquier conversación sobre el pedido, no sólo reclamos, y llamarlo
   * reclamo afirmaría algo que el dato no sabe. Para lo que tiene que servir
   * —ver que de esto ya se habló— alcanza igual.
   *
   * Un `.in()` de 50 ids como mucho, que es el tamaño de la página, y el
   * índice `mensajes_entidad_idx` lo cubre. Si falla, la lista se muestra sin
   * la etiqueta: esto es un agregado y no puede tumbar la pantalla.
   */
  useCargar(async (vigente) => {
    if (pedidos.length === 0) { setUltimoMensaje({}); return; }
    const supabase = createClient();
    const { data, error: err } = await supabase
      .from("mensajes")
      .select("entidad_id, creado_en")
      .eq("entidad_tipo", "requerimiento")
      .in("entidad_id", pedidos.map((p) => p.id))
      .order("creado_en", { ascending: false });

    if (!vigente() || err) return;
    const ultimo: Record<string, string> = {};
    for (const m of data ?? []) {
      // Vienen del más nuevo al más viejo: el primero de cada pedido gana.
      const id = m.entidad_id as string;
      if (!ultimo[id]) ultimo[id] = m.creado_en as string;
    }
    setUltimoMensaje(ultimo);
  }, [pedidos]);

  const paginas = Math.ceil(total / POR_PAGINA);
  /** De mi área. Es lo que se marca al mirar todos. */
  const esMio = (p: RequerimientoConRelaciones) =>
    p.area_id !== null && misAreas.includes(p.area_id);
  /** Y este lo cargué yo, que es otra cosa y también se dice. */
  const loCargueYo = (p: RequerimientoConRelaciones) => p.solicitante_id === usuarioId;

  const nombreDeMisAreas = areas
    .filter((a) => misAreas.includes(a.id))
    .map((a) => a.nombre)
    .join(" y ");

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900">
            {alcance === "mios" ? "Pedidos de mi área" : "Todos los pedidos"}
          </h1>
          <p className="text-sm text-slate-500">
            {alcance === "mios"
              ? `Lo que pidió ${nombreDeMisAreas || "tu área"} y en qué anda.`
              : "Todos los requerimientos, de todas las áreas. Buscá acá antes de pedir."}
          </p>
        </div>
        <button
          onClick={() => setModalAbierto(true)}
          className="rounded-lg bg-[var(--primary)] px-4 py-2 text-sm font-semibold text-white hover:bg-[var(--primary-dark)]"
        >
          + Pedir un material
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex overflow-hidden rounded-lg border border-slate-300">
          {(misAreas.length > 0 ? (["mios", "todos"] as const) : (["todos"] as const)).map((v) => (
            <button
              key={v}
              onClick={() => setAlcance(v)}
              className={`px-3 py-1.5 text-sm font-medium ${
                alcance === v ? "bg-slate-900 text-white" : "bg-white text-slate-600 hover:bg-slate-50"
              }`}
            >
              {v === "mios" ? "Mi área" : "Todos"}
            </button>
          ))}
        </div>

        {/* El buscador es la herramienta de "esto ya lo pidió alguien": busca
            por descripción, por código, por quién lo pidió, y un número suelto
            lo toma como N° de RI. */}
        <input
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
          placeholder="Buscar por descripción, código, N° de RI…"
          className="min-w-0 flex-1 rounded-lg border border-slate-300 px-3 py-1.5 text-sm sm:max-w-sm"
        />

        {!cargando && (
          <span className="text-xs text-slate-400">
            {total.toLocaleString("es-AR")} {total === 1 ? "pedido" : "pedidos"}
          </span>
        )}
      </div>

      {/*
        La franja del semáforo.

        Cuenta **sólo lo que espera a Compras**: lo ya pedido depende del
        proveedor y lo que está en espera lo frenó alguien a propósito, así que
        reclamar por eso es pedirle a Compras que justifique algo que no maneja.

        Van tres chips y no tres tarjetas: en los 343 px de un teléfono tres
        tarjetas no entran, y esto se mira desde la cantera.
      */}
      {conteos && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-slate-400">Esperando a Compras:</span>
          <ChipDelSemaforo
            color="verde" cantidad={conteos.verde} activo={color === "verde"}
            etiqueta={`hasta ${DIAS_VERDE} días`}
            onClick={() => setColor(color === "verde" ? null : "verde")}
          />
          <ChipDelSemaforo
            color="amarillo" cantidad={conteos.amarillo} activo={color === "amarillo"}
            etiqueta={`${DIAS_VERDE + 1} a ${DIAS_AMARILLO} días`}
            onClick={() => setColor(color === "amarillo" ? null : "amarillo")}
          />
          <ChipDelSemaforo
            color="rojo" cantidad={conteos.rojo} activo={color === "rojo"}
            etiqueta={`más de ${DIAS_AMARILLO} días`}
            onClick={() => setColor(color === "rojo" ? null : "rojo")}
          />
          {color && (
            <button
              onClick={() => setColor(null)}
              className="text-xs font-medium text-slate-500 underline hover:text-slate-900"
            >
              Ver todos
            </button>
          )}
        </div>
      )}

      {/*
        Sin área asignada no hay nada que reclamar, y conviene decirlo.
        Esa persona abre en «Todos» —la lista no está vacía, así que el cartel
        de abajo no aparece— ve el semáforo pintado y ni un botón «Reclamar»,
        sin una palabra sobre por qué. Son seis personas hoy.
      */}
      {misAreas.length === 0 && (
        <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
          No tenés un área asignada, así que podés mirar todos los pedidos pero no reclamar
          ninguno como propio. Se asigna en Administración → Usuarios.
        </div>
      )}

      {problemaDelEnlace && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          {textoDelProblema(problemaDelEnlace)}
        </div>
      )}

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      )}

      {cargando ? (
        <p className="py-12 text-center text-sm text-slate-400">Cargando…</p>
      ) : pedidos.length === 0 ? (
        <Vacio
          alcance={alcance}
          buscando={Boolean(busquedaAplicada)}
          sinArea={misAreas.length === 0}
          onVerTodos={() => setAlcance("todos")}
          onPedir={() => setModalAbierto(true)}
        />
      ) : (
        <>
        {/* En un teléfono, tarjetas. Ocho columnas no entran, y acá la pregunta
            es una sola —¿en qué anda este pedido?—, así que los dos estados van
            arriba y grandes en vez de perdidos en la sexta y séptima columna. */}
        <div className="space-y-2 md:hidden">
          {pedidos.map((p) => (
            <article key={p.id} className="rounded-xl border border-slate-200 bg-white p-3">
              <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
                <span className="font-mono text-xs font-semibold text-slate-500">RI {p.nro_ri}</span>
                {alcance === "todos" && esMio(p) && (
                  <span className="rounded-full bg-slate-900 px-2 py-0.5 text-[11px] font-semibold text-white">
                    Mi área
                  </span>
                )}
                {loCargueYo(p) && (
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600">
                    Lo pediste vos
                  </span>
                )}
                <Chip {...APROBACION_LABELS[p.estado_aprobacion]} />
                <Chip {...COMPRA_LABELS[p.estado_compra]} />
              </div>

              <p className="text-sm leading-snug text-slate-900">{p.descripcion}</p>

              {p.motivo_rechazo && (
                <p className="mt-1 text-xs text-red-600">Rechazado: {p.motivo_rechazo}</p>
              )}
              {p.estado_compra === "RECIBIDO" && p.fecha_recepcion && (
                <p className="mt-1 text-xs text-green-700">Recibido el {fecha(p.fecha_recepcion)}</p>
              )}

              <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-slate-500">
                <span>Pedido el {fecha(p.fecha)}</span>
                {p.cantidad && <span>· {p.cantidad} u.</span>}
                {p.compras_areas?.nombre && <span>· {p.compras_areas.nombre}</span>}
                <Solicitante pedido={p} mostrar={alcance === "todos"} />
                <Chip {...etiquetaPrioridad(p.prioridad)} />
                <PuntoDelSemaforo pedido={p} />
              </div>

              <div className="mt-1.5 flex flex-wrap items-center gap-3">
                <BotonDeMensajes pedido={p} onAbrir={setConversacion} />
                <BotonDeReclamo
                  pedido={p} esMio={esMio(p)} gestores={gestoresDeCompras}
                  onAbrir={setConversacion}
                />
                <UltimoMensaje cuando={ultimoMensaje[p.id]} />
              </div>
            </article>
          ))}
        </div>

        <div className="hidden overflow-hidden rounded-xl border border-slate-200 bg-white md:block">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-3 py-2 text-left">N° RI</th>
                  <th className="px-3 py-2 text-left">Fecha</th>
                  <th className="px-3 py-2 text-left">Qué se pidió</th>
                  <th className="px-3 py-2 text-right">Cant.</th>
                  <th className="px-3 py-2 text-left">Área</th>
                  {alcance === "todos" && <th className="px-3 py-2 text-left">Quién pidió</th>}
                  <th className="px-3 py-2 text-left">Prioridad</th>
                  <th className="px-3 py-2 text-left">Aprobación</th>
                  <th className="px-3 py-2 text-left">Compra</th>
                  <th className="px-3 py-2 text-left">Espera</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {pedidos.map((p) => (
                  <tr key={p.id} className={esMio(p) ? "bg-slate-50/70" : "hover:bg-slate-50"}>
                    <td className="whitespace-nowrap px-3 py-2 font-mono text-slate-500">
                      {p.nro_ri}
                      {alcance === "todos" && esMio(p) && (
                        <span className="ml-1.5 rounded-full bg-slate-900 px-1.5 py-0.5 text-[10px] font-semibold text-white">
                          Mi área
                        </span>
                      )}
                      {/* Que sea de mi área y que lo haya pedido yo son cosas
                          distintas, y las dos importan: la primera para saber
                          si me toca, la segunda para seguir lo mío. */}
                      {loCargueYo(p) && (
                        <span className="ml-1.5 rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-600">
                          Vos
                        </span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-slate-600">{fecha(p.fecha)}</td>
                    <td className="max-w-sm px-3 py-2 text-slate-900">
                      {p.descripcion}
                      {p.motivo_rechazo && (
                        <div className="text-xs text-red-600">Rechazado: {p.motivo_rechazo}</div>
                      )}
                      {p.estado_compra === "RECIBIDO" && p.fecha_recepcion && (
                        <div className="text-xs text-green-700">Recibido el {fecha(p.fecha_recepcion)}</div>
                      )}
                      <div className="mt-0.5 flex flex-wrap items-center gap-3">
                        <BotonDeMensajes pedido={p} onAbrir={setConversacion} />
                        <BotonDeReclamo
                          pedido={p} esMio={esMio(p)} gestores={gestoresDeCompras}
                          onAbrir={setConversacion}
                        />
                        <UltimoMensaje cuando={ultimoMensaje[p.id]} />
                      </div>
                    </td>
                    <td className="px-3 py-2 text-right text-slate-600">{p.cantidad ?? "—"}</td>
                    <td className="px-3 py-2 text-slate-600">{p.compras_areas?.nombre ?? "—"}</td>
                    {alcance === "todos" && (
                      <td className="px-3 py-2 text-slate-600">
                        {p.solicitante_nombre ?? <span className="text-slate-300">—</span>}
                      </td>
                    )}
                    <td className="px-3 py-2"><Chip {...etiquetaPrioridad(p.prioridad)} /></td>
                    <td className="px-3 py-2"><Chip {...APROBACION_LABELS[p.estado_aprobacion]} /></td>
                    <td className="px-3 py-2"><Chip {...COMPRA_LABELS[p.estado_compra]} /></td>
                    <td className="px-3 py-2 text-xs text-slate-500"><PuntoDelSemaforo pedido={p} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {paginas > 1 && (
          <div className="flex items-center justify-end gap-2 text-sm text-slate-600">
            <button
              onClick={() => setPagina((p) => Math.max(0, p - 1))}
              disabled={pagina === 0}
              className="rounded-lg border border-slate-300 px-3 py-1 disabled:opacity-40"
            >
              Anterior
            </button>
            <span className="py-1">{pagina + 1} de {paginas}</span>
            <button
              onClick={() => setPagina((p) => Math.min(paginas - 1, p + 1))}
              disabled={pagina >= paginas - 1}
              className="rounded-lg border border-slate-300 px-3 py-1 disabled:opacity-40"
            >
              Siguiente
            </button>
          </div>
        )}
        </>
      )}

      {conversacion && (
        <ConversacionDelPedido
          /*
           * Un hilo por pedido, **y el reclamo cuenta como otra apertura**.
           * El borrador se lee una sola vez al montar, así que con la clave
           * puesta sólo en el id, abrir «Mensajes» y después «Reclamar» del
           * mismo pedido reusaba el componente y el texto redactado no
           * aparecía nunca.
           */
          key={`${conversacion.id}|${conversacion.textoInicial ? "reclamo" : "libre"}`}
          id={conversacion.id}
          nroRi={conversacion.nroRi}
          descripcion={conversacion.descripcion}
          textoInicial={conversacion.textoInicial}
          mencionesIniciales={conversacion.mencionesIniciales}
          onCerrar={() => {
            setConversacion(null);
            // Sacar `?pedido=` de la barra: si no, recargar la página vuelve a
            // abrir una conversación que ya se cerró.
            if (window.location.search.includes("pedido=")) {
              window.history.replaceState(null, "", window.location.pathname);
            }
          }}
        />
      )}

      {modalAbierto && (
        <NuevoRequerimientoModal
          areas={areas}
          empresas={empresas}
          ubicaciones={ubicaciones}
          onClose={() => setModalAbierto(false)}
          onSaved={() => { setModalAbierto(false); cargar(); contar(); router.refresh(); }}
        />
      )}
    </div>
  );
}

/**
 * La puerta a la conversación de un pedido. Un botón de texto y no un `.btn-*`:
 * va en cada tarjeta y en cada renglón, y tiene que ser lo más chico de ahí.
 */
/** Los colores del semáforo, en un solo lugar para que el chip y el punto no discrepen. */
const COLORES: Record<ColorDelPedido, string> = {
  verde: "#16a34a",
  amarillo: "#f59e0b",
  rojo: "#dc2626",
};

/**
 * Un chip de la franja: el número, qué cuenta, y el filtro.
 *
 * El color va por `style` y no por una clase al lado: en este proyecto una
 * utilidad de Tailwind pierde contra una clase sin capa, y un color de estado
 * que se ve gris es exactamente el tipo de error que no rompe nada.
 */
function ChipDelSemaforo({
  color, cantidad, etiqueta, activo, onClick,
}: {
  color: ColorDelPedido;
  cantidad: number;
  etiqueta: string;
  activo: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={activo}
      className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition ${
        activo ? "border-slate-900 bg-slate-900 text-white" : "border-slate-300 bg-white text-slate-600 hover:bg-slate-50"
      }`}
    >
      <span
        className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
        style={{ backgroundColor: COLORES[color] }}
      />
      <strong>{cantidad}</strong>
      <span className={activo ? "text-slate-200" : "text-slate-500"}>{etiqueta}</span>
    </button>
  );
}

/**
 * El punto del semáforo de un pedido, con los días que lleva esperando.
 *
 * **Un pedido que no espera a Compras no lleva punto**, ni gris ni de ningún
 * color: ya está pedido, o lo frenó alguien, o se cerró. Se sigue listando
 * igual — el semáforo es una capa sobre la lista de siempre y no un filtro
 * que esconde cosas.
 */
function PuntoDelSemaforo({ pedido }: { pedido: RequerimientoConRelaciones }) {
  if (!esReclamable(pedido)) return null;
  const color = colorDelPedido(pedido.fecha, new Date());
  return (
    <span className="inline-flex items-center gap-1 whitespace-nowrap">
      <span
        className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
        style={{ backgroundColor: COLORES[color] }}
        aria-hidden="true"
      />
      <span>Esperando hace {textoDeEspera(diasEsperando(pedido.fecha, new Date()))}</span>
    </span>
  );
}

/**
 * Cuándo se habló por última vez de este pedido.
 *
 * Dice «último mensaje» y no «reclamado»: el hilo guarda cualquier
 * conversación, y el dato no sabe cuál de ellas fue un reclamo.
 */
function UltimoMensaje({ cuando }: { cuando?: string }) {
  if (!cuando) return null;
  return <span className="text-xs text-slate-400">Último mensaje el {fecha(cuando)}</span>;
}

function BotonDeMensajes({
  pedido, onAbrir,
}: {
  pedido: RequerimientoConRelaciones;
  onAbrir: (p: Conversacion) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onAbrir({ id: pedido.id, nroRi: pedido.nro_ri, descripcion: pedido.descripcion })}
      className="text-xs font-medium text-slate-600 underline hover:text-slate-900"
    >
      Mensajes
    </button>
  );
}

/**
 * Pedirle a Compras que explique por qué ese pedido está demorado.
 *
 * Abre **el mismo hilo** que «Mensajes», con la pregunta redactada y los de
 * Compras marcados. No hay estado «reclamado» nuevo: el hilo ya es el registro
 * de que se reclamó y de qué contestaron, y una columna aparte sería una
 * segunda fuente de verdad sobre lo mismo.
 *
 * **Sólo en amarillo y rojo, y sólo sobre pedidos del área propia.** Un pedido
 * de treinta días no es noticia, y reclamar por el pedido de otra área es
 * ruido para Compras que no ayuda a nadie.
 */
function BotonDeReclamo({
  pedido, esMio, gestores, onAbrir,
}: {
  pedido: RequerimientoConRelaciones;
  esMio: boolean;
  gestores: string[];
  onAbrir: (p: Conversacion) => void;
}) {
  if (!esMio || !esReclamable(pedido)) return null;
  const dias = diasEsperando(pedido.fecha, new Date());
  if (colorDelPedido(pedido.fecha, new Date()) === "verde") return null;

  return (
    <button
      type="button"
      onClick={() =>
        onAbrir({
          id: pedido.id,
          nroRi: pedido.nro_ri,
          descripcion: pedido.descripcion,
          textoInicial: textoDelReclamo({
            nro_ri: pedido.nro_ri,
            descripcion: pedido.descripcion,
            dias,
            estado: pedido.estado_compra,
          }),
          mencionesIniciales: gestores,
        })
      }
      className="text-xs font-semibold text-[var(--primary)] underline hover:opacity-80"
    >
      Reclamar
    </button>
  );
}

/**
 * Quién lo pidió, cuando se sabe.
 *
 * Los 1.947 requerimientos que vinieron de la planilla **no traen solicitante**:
 * la columna "SOLICITA" que el importador busca no existe con ese nombre en la
 * hoja, o está vacía. Por eso el filtro de arriba va por área y no por persona
 * —el área sí está en las 1.947—, y por eso acá se dice "sin solicitante" en
 * vez de dejar el lugar en blanco: un blanco se lee como "nadie lo pidió" y no
 * como "la planilla no lo dice".
 */
function Solicitante({
  pedido, mostrar,
}: {
  pedido: RequerimientoConRelaciones;
  mostrar: boolean;
}) {
  if (!mostrar) return null;
  return (
    <span>· {pedido.solicitante_nombre ?? "sin solicitante"}</span>
  );
}

function Vacio({
  alcance, buscando, sinArea, onVerTodos, onPedir,
}: {
  alcance: "mios" | "todos";
  buscando: boolean;
  /** Nadie le asignó un área todavía: sin eso no hay "mi área" que mostrar. */
  sinArea: boolean;
  onVerTodos: () => void;
  onPedir: () => void;
}) {
  if (buscando) {
    return (
      <div className="rounded-xl border border-dashed border-slate-300 px-6 py-14 text-center">
        <p className="text-sm text-slate-500">
          Nada coincide con lo que buscaste
          {alcance === "mios" && " entre los pedidos de tu área"}.
        </p>
        {alcance === "mios" && (
          <button onClick={onVerTodos} className="mt-2 text-sm text-slate-600 underline">
            Buscar entre todos los pedidos
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-dashed border-slate-300 px-6 py-14 text-center">
      <p className="text-sm text-slate-500">
        {alcance === "todos"
          ? "Todavía no hay requerimientos cargados."
          : sinArea
            ? "Todavía no tenés un área asignada."
            : "Tu área todavía no pidió nada."}
      </p>
      {alcance === "mios" && sinArea && (
        // Se dice qué falta y quién lo puede hacer. Un cartel que sólo dice
        // "no hay nada" manda a buscar el problema al lugar equivocado.
        <p className="mx-auto mt-2 max-w-md text-xs text-slate-400">
          Los pedidos se agrupan por área. Pedile a un administrador que te
          asigne la tuya en Administración → Usuarios y vas a ver acá todo lo
          que pidió tu área.
        </p>
      )}
      {alcance === "mios" && (
        <div className="mt-4 flex justify-center gap-2">
          <button
            onClick={onPedir}
            className="rounded-lg bg-[var(--primary)] px-4 py-2 text-sm font-semibold text-white hover:bg-[var(--primary-dark)]"
          >
            Pedir un material
          </button>
          <button
            onClick={onVerTodos}
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Ver todos los pedidos
          </button>
        </div>
      )}
    </div>
  );
}

function Chip({ label, color }: { label: string; color: string }) {
  return (
    <span className={`inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold ${color}`}>
      {label}
    </span>
  );
}
