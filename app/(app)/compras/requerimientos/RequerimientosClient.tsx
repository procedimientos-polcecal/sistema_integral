"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { useConfirm } from "@/components/ConfirmProvider";
import UltimaSincronizacion from "@/components/UltimaSincronizacion";
import type { UltimaSync } from "@/lib/core/sincronizaciones";
import NuevoRequerimientoModal from "./NuevoRequerimientoModal";
import ModalAvanzar from "./ModalAvanzar";
import type { ResumenComparativa } from "./ModalAvanzar";
import AprobarSinComparativa from "../AprobarSinComparativa";
import {
  ubicacionesDelEquipo,
  ubicacionesDelSector,
  type UbicacionEnlazada,
} from "@/lib/compras/ubicaciones";
import MultiSelect from "../MultiSelect";
import {
  ESTADOS_APROBACION, ESTADOS_COMPRA, PRIORIDADES,
  APROBACION_LABELS, COMPRA_LABELS, PRIORIDAD_LABELS, etiquetaPrioridad,
  moneda, fecha, diasRestantes, etiquetaEmpresa,
  SIGUIENTE_ESTADO, ACCION_SIGUIENTE, ESTADOS_CON_DIALOGO,
} from "@/lib/compras/constants";
import { costosParaElPedido } from "@/lib/compras/comparativa";
import {
  enlaceAlRequerimiento, escribirFiltrosEnLaUrl, leerFiltrosDeLaUrl, leerPaginaDeLaUrl,
  type FiltrosCompras,
} from "@/lib/compras/filtrosUrl";
import type { RequerimientoConRelaciones } from "@/lib/compras/types";
import { useCargar } from "@/lib/core/useCargar";

const POR_PAGINA = 50;

type Opcion = { id: string; nombre: string };
type Persona = { id: string; nombre: string; apellido: string; alias: string | null };

/** Cómo se lo nombra: el alias de la planilla si lo tiene, si no el nombre. */
function nombreCorto(p: Persona): string {
  return p.alias ?? p.nombre;
}

export default function RequerimientosClient({
  areas, proveedores, empresas, ubicaciones, equipos, sectores, aprobadores,
  usuarioId, canEdit, filtrosIniciales, paginaInicial, sync,
}: {
  areas: Opcion[];
  proveedores: Opcion[];
  empresas: Opcion[];
  ubicaciones: UbicacionEnlazada[];
  /** Sólo los que tienen alguna ubicación enlazada. */
  equipos: { id: string; code: string; name: string; marca?: string | null; modelo?: string | null }[];
  sectores: { id: string; nombre: string; codigo: string | null }[];
  aprobadores: Persona[];
  usuarioId: string;
  canEdit: boolean;
  /** Lo que venía en la URL, ya validado por la página. */
  filtrosIniciales: FiltrosCompras;
  /** En qué página venía. Cero es la primera. */
  paginaInicial: number;
  /** Cuándo se trajo por última vez lo de la planilla. */
  sync: UltimaSync | null;
}) {
  const confirmar = useConfirm();
  const [filas, setFilas] = useState<RequerimientoConRelaciones[]>([]);
  const [total, setTotal] = useState(0);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [modalAbierto, setModalAbierto] = useState(false);

  // Las listas contra las que se validan los filtros que vienen de la URL. Son
  // las mismas que usó el servidor; acá hacen falta porque la pantalla vuelve a
  // leer la URL por su cuenta al montar (ver `arranque`).
  const catalogos = useMemo(
    () => ({
      areas: areas.map((a) => a.id),
      empresas: empresas.map((e) => e.id),
      proveedores: proveedores.map((p) => p.id),
      ubicaciones: ubicaciones.map((u) => u.id),
      equipos: equipos.map((e) => e.id),
      sectores: sectores.map((s) => s.id),
    }),
    [areas, empresas, proveedores, ubicaciones, equipos, sectores]
  );

  /**
   * Con qué filtros arranca la pantalla.
   *
   * En la primera carga es lo que validó el servidor. Pero al volver con el
   * botón de atrás desde un requerimiento, el árbol que restaura Next es el que
   * se renderizó al entrar —con la URL vieja, sin filtros—, así que
   * `filtrosIniciales` llegaría vacío aunque la barra de direcciones tenga los
   * filtros puestos. Por eso, cuando hay navegador, la fuente es la URL de
   * verdad y no la prop. En el servidor `window` no existe y no hay diferencia:
   * los dos leen el mismo query string, así que la hidratación coincide.
   */
  const [arranque] = useState<{ filtros: FiltrosCompras; pagina: number }>(() => {
    if (typeof window === "undefined") {
      return { filtros: filtrosIniciales, pagina: paginaInicial };
    }
    const params = new URLSearchParams(window.location.search);
    return { filtros: leerFiltrosDeLaUrl(params, catalogos), pagina: leerPaginaDeLaUrl(params) };
  });

  // La página también sale de la URL: volver a la tabla filtrada pero en la
  // primera es media solución cuando se estaba en la tercera.
  const [pagina, setPagina] = useState(arranque.pagina);

  // Los filtros arrancan con lo que trajo la URL: es como el tablero lleva a
  // cada etapa. Y la URL se reescribe con cada cambio, así que también es como
  // se vuelve a la tabla tal como estaba después de entrar a un RI.
  const [busqueda, setBusqueda] = useState(arranque.filtros.busqueda);
  const [busquedaAplicada, setBusquedaAplicada] = useState(arranque.filtros.busqueda);
  // Cada uno es una lista: dentro de un filtro los valores suman —«Cotizando o
  // Para comprar»— y entre filtros se recortan. Vacío es "no filtrar por esto".
  const [area, setArea] = useState(arranque.filtros.area);
  const [aprobacion, setAprobacion] = useState(arranque.filtros.aprobacion);
  const [compra, setCompra] = useState(arranque.filtros.compra);
  const [prioridad, setPrioridad] = useState(arranque.filtros.prioridad);
  const [empresa, setEmpresa] = useState(arranque.filtros.empresa);
  const [proveedor, setProveedor] = useState(arranque.filtros.proveedor);
  const [ubicacion, setUbicacion] = useState(arranque.filtros.ubicacion);
  const [equipo, setEquipo] = useState(arranque.filtros.equipo);
  const [sector, setSector] = useState(arranque.filtros.sector);

  // Con qué comparativa cuenta cada RI de la página. El diálogo lo usa para no
  // exigir el link cuando ya hay presupuestos, y para mostrar de antemano con
  // qué proveedor y qué costo va a quedar el pedido.
  // En teléfono el panel arranca cerrado; en escritorio la clase `md:grid` lo
  // muestra siempre y este estado no lo afecta.
  const [filtrosAbiertos, setFiltrosAbiertos] = useState(false);
  const [resumenes, setResumenes] = useState<Record<string, ResumenComparativa>>({});
  const [avanzando, setAvanzando] = useState<RequerimientoConRelaciones | null>(null);
  const [procesando, setProcesando] = useState<string | null>(null);
  const [errorAccion, setErrorAccion] = useState("");

  // La búsqueda espera un momento para no consultar en cada tecla.
  useEffect(() => {
    const t = setTimeout(() => setBusquedaAplicada(busqueda.trim()), 350);
    return () => clearTimeout(t);
  }, [busqueda]);

  // Cambiar un filtro vuelve a la primera pagina. Se ajusta durante el render
  // —lo que recomienda React— y no en un efecto: asi no hay un commit en el que
  // los filtros ya son los nuevos y la pagina sigue siendo la vieja, que era lo
  // que disparaba una consulta de mas por cada cambio de filtro.
  const filtrosAhora = JSON.stringify([
    busquedaAplicada, area, aprobacion, compra, prioridad, empresa, proveedor, ubicacion, equipo, sector,
  ]);
  const [filtrosPrevios, setFiltrosPrevios] = useState(filtrosAhora);
  if (filtrosAhora !== filtrosPrevios) {
    setFiltrosPrevios(filtrosAhora);
    setPagina(0);
  }

  /**
   * La URL va detrás de los filtros.
   *
   * Se reemplaza la entrada del historial en vez de agregar una: con `push`,
   * salir de la pantalla con el botón de atrás obligaría a deshacer antes cada
   * casilla tildada, una por una. Con `replace` hay una sola entrada, la de la
   * tabla como está ahora, y volver desde un RI la devuelve filtrada.
   *
   * Es `history` y no `router.replace`: el segundo vuelve a pedirle la página
   * al servidor —los seis catálogos, los permisos, la sincronización— para
   * cambiar un query string que la pantalla ya tiene resuelto en memoria.
   */
  const query = escribirFiltrosEnLaUrl({
    busqueda: busquedaAplicada,
    area, aprobacion, compra, prioridad, empresa, proveedor, ubicacion, equipo, sector,
  }, pagina);
  useEffect(() => {
    const destino = query
      ? `${window.location.pathname}?${query}`
      : window.location.pathname;
    if (destino === window.location.pathname + window.location.search) return;
    // El estado que va es el que ya estaba: ahí guarda Next su árbol de rutas,
    // y pisarlo con null le rompe la navegación hacia atrás.
    window.history.replaceState(window.history.state, "", destino);
  }, [query]);

  // Cada fila se lleva a la ficha con qué tabla volver. El botón de atrás del
  // navegador ya alcanza, pero el «← Volver a requerimientos» de la ficha es un
  // enlace hacia adelante y sin esto navegaba al listado sin filtrar.
  const ficha = (id: string) => enlaceAlRequerimiento(id, query);

  const cargar = useCallback(async () => {
    setCargando(true);
    setError(null);
    const supabase = createClient();

    let q = supabase
      .from("compras_requerimientos")
      .select(
        "*, compras_areas(nombre), empresas(nombre), proveedores(nombre), compras_ubicaciones(nombre)",
        { count: "exact" }
      );

    if (busquedaAplicada) {
      // Un número suelto se busca como N° de RI, que es como lo pide la gente.
      const comoNumero = Number(busquedaAplicada);
      if (Number.isInteger(comoNumero) && comoNumero > 0) {
        q = q.eq("nro_ri", comoNumero);
      } else {
        const p = `%${busquedaAplicada}%`;
        q = q.or(`descripcion.ilike.${p},codigo.ilike.${p},detalle_extra.ilike.${p}`);
      }
    }
    // Un `.in()` por filtro: los valores de un mismo desplegable suman, y los
    // de distintos desplegables se recortan entre sí, que es como se lee la
    // fila de filtros de izquierda a derecha.
    if (area.length) q = q.in("area_id", area);
    if (aprobacion.length) q = q.in("estado_aprobacion", aprobacion);
    if (compra.length) q = q.in("estado_compra", compra);
    if (prioridad.length) q = q.in("prioridad", prioridad);
    if (empresa.length) {
      // "AMBAS" no es una empresa sino la ausencia de una —las pagan las dos—,
      // así que no entra en el `.in()`: cuando está tildada junto con alguna
      // empresa hay que pedir las dos cosas con un `or`.
      const ids = empresa.filter((e) => e !== "AMBAS");
      const ambas = empresa.length !== ids.length;
      if (ambas && ids.length) {
        q = q.or(`empresa_id.is.null,empresa_id.in.(${ids.join(",")})`);
      } else if (ambas) {
        q = q.is("empresa_id", null);
      } else {
        q = q.in("empresa_id", ids);
      }
    }
    if (proveedor.length) q = q.in("proveedor_id", proveedor);
    if (ubicacion.length) q = q.in("ubicacion_id", ubicacion);
    // El equipo y el sector no están en el requerimiento: se resuelven contra
    // el catálogo. La lista es de una o dos ubicaciones por máquina, muy lejos
    // del `.in()` con mil ids que arma una URL que PostgREST rechaza.
    if (equipo.length) {
      q = q.in("ubicacion_id", equipo.flatMap((e) => ubicacionesDelEquipo(ubicaciones, e)));
    }
    if (sector.length) {
      q = q.in("ubicacion_id", sector.flatMap((s) => ubicacionesDelSector(ubicaciones, s)));
    }

    const desde = pagina * POR_PAGINA;
    const { data, error: err, count } = await q
      .order("nro_ri", { ascending: false })
      .range(desde, desde + POR_PAGINA - 1);

    if (err) {
      setError(err.message);
      setFilas([]);
      setCargando(false);
      return;
    }

    setFilas((data ?? []) as RequerimientoConRelaciones[]);
    setTotal(count ?? 0);
    setCargando(false);
    // Lo que se haya guardado de presupuestos deja de valer: esto corre al
    // cambiar de filtro o de página, y también después de cada acción. Guardar
    // de menos es preferible a mostrar una comparativa que ya cambió.
    setResumenes({});

  }, [busquedaAplicada, area, aprobacion, compra, prioridad, empresa, proveedor, ubicacion, equipo, sector, ubicaciones, pagina]);

  /**
   * Los presupuestos de un requerimiento, recién cuando se los va a mirar.
   *
   * Antes se traían junto con cada página de la tabla, y se pagaban de nuevo
   * con cada cambio de filtro, para algo que se usa al tocar un botón. Es un
   * viaje del navegador hasta Virginia: unos 330 ms que nadie estaba usando.
   *
   * Lo que ya se pidió no se vuelve a pedir: el diálogo se abre y se cierra
   * varias veces sobre el mismo pedido.
   */
  async function abrirDialogo(r: RequerimientoConRelaciones) {
    if (resumenes[r.id]) {
      setAvanzando(r);
      return;
    }

    setProcesando(r.id);
    const supabase = createClient();
    const { data: cotizaciones } = await supabase
      .from("compras_cotizaciones")
      .select("requerimiento_id, elegida, proveedor_id, precio_total, costo_envio, moneda, cotizacion")
      .eq("requerimiento_id", r.id);
    setProcesando(null);

    const nombrePorProveedor = new Map(proveedores.map((p) => [p.id, p.nombre]));
    const resumen: ResumenComparativa = { cuantos: 0, elegida: null };
    for (const c of (cotizaciones ?? []) as {
      elegida: boolean; proveedor_id: string;
      precio_total: number | null; costo_envio: number | null;
      // Sin esto el diálogo propondría el precio en dólares como si fueran
      // pesos, y el pedido quedaría con un costo mil veces más chico.
      moneda: string | null; cotizacion: number | null;
    }[]) {
      resumen.cuantos += 1;
      if (c.elegida) {
        resumen.elegida = {
          ...costosParaElPedido(c),
          proveedor_nombre: nombrePorProveedor.get(c.proveedor_id) ?? null,
        };
      }
    }
    setResumenes((previos) => ({ ...previos, [r.id]: resumen }));
    setAvanzando(r);
  }

  /**
   * Avanza el RI a la etapa siguiente.
   *
   * Recarga la tabla con su propia consulta y no con router.refresh(): las
   * filas las trae el cliente, así que refrescar el árbol de servidor no las
   * cambiaría.
   */
  async function avanzar(r: RequerimientoConRelaciones, extra?: Record<string, unknown>) {
    const destino = SIGUIENTE_ESTADO[r.estado_compra];
    if (!destino) return false;

    setProcesando(r.id);
    setErrorAccion("");
    const res = await fetch(`/api/compras/requerimientos/${r.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ estado_compra: destino, ...extra }),
    });
    setProcesando(null);

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setErrorAccion(body.error ?? "No se pudo actualizar el estado.");
      return false;
    }
    await cargar();
    return true;
  }

  useCargar(async () => { await cargar(); }, [cargar]);

  const paginas = Math.max(1, Math.ceil(total / POR_PAGINA));
  // Una `?pagina=40` escrita a mano —o guardada en un enlace de cuando la tabla
  // era más larga— muestra una tabla vacía, y una tabla vacía se lee como "no
  // hay nada". Cuando el total dice que esa página no existe, se cae a la
  // última que sí. Se ajusta durante el render, igual que el salto a la primera
  // página al cambiar un filtro, y con el total ya cargado: mientras se
  // consulta, `total` es el de la consulta anterior.
  if (!cargando && pagina >= paginas) setPagina(paginas - 1);
  // Los que están dentro del panel: la búsqueda queda afuera y se ve sola.
  // Cuenta desplegables con algo puesto y no valores: lo que dice el globito es
  // cuántas preguntas se están haciendo, no cuántas casillas hay tildadas.
  const filtrosPuestos = [area, aprobacion, compra, prioridad, empresa, proveedor, ubicacion, equipo, sector]
    .filter((f) => f.length > 0).length;

  const hayFiltros = !!busquedaAplicada || filtrosPuestos > 0;

  /**
   * Frenar un pedido sin cerrarlo, y devolverlo a donde estaba.
   *
   * La etapa de la que sale no se manda: la guarda el servidor, que ya sabe en
   * cuál está. Al volver se la pide de vuelta al requerimiento.
   */
  async function cambiarEspera(r: RequerimientoConRelaciones, aEspera: boolean) {
    const ok = await confirmar(
      aEspera
        ? {
            title: "Poner en espera",
            message:
              `El RI ${r.nro_ri} sale de la cola de trabajo sin cerrarse, y vuelve a ` +
              `«${COMPRA_LABELS[r.estado_compra].label}» cuando lo saques.`,
            confirmText: "Poner en espera",
          }
        : {
            title: "Sacar de la espera",
            message: `El RI ${r.nro_ri} vuelve a «${
              COMPRA_LABELS[r.etapa_previa ?? "SIN_INICIAR"].label
            }» y retoma el circuito donde estaba.`,
            confirmText: "Sacar de la espera",
          }
    );
    if (!ok) return;

    setProcesando(r.id);
    setErrorAccion("");
    const res = await fetch(`/api/compras/requerimientos/${r.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        estado_compra: aEspera ? "EN_ESPERA" : r.etapa_previa ?? "SIN_INICIAR",
      }),
    });
    setProcesando(null);

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setErrorAccion(body.error ?? "No se pudo cambiar el estado.");
      return;
    }
    await cargar();
  }

  // La tabla tiene una columna más cuando se puede gestionar la compra.
  const columnas = canEdit ? 13 : 12;

  const totalPantalla = useMemo(
    () => filas.reduce((acc, f) => acc + (f.costo_iva ?? 0) + (f.costo_envio ?? 0), 0),
    [filas]
  );

  // La máquina y el sector también: quedaban puestos después de "Limpiar
  // filtros", invisibles en el resumen y dejando la tabla recortada sin motivo.
  function limpiar() {
    setBusqueda(""); setArea([]); setAprobacion([]); setCompra([]);
    setPrioridad([]); setEmpresa([]); setProveedor([]); setUbicacion([]);
    setEquipo([]); setSector([]);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-baseline gap-x-3">
            <h1 className="text-xl font-bold text-slate-900">Requerimientos internos</h1>
            <UltimaSincronizacion
              cuando={sync?.created_at}
              ok={sync?.ok ?? true}
              error={sync?.error}
            />
          </div>
          <p className="text-sm text-slate-500">
            {cargando ? "Cargando…" : `${total.toLocaleString("es-AR")} requerimiento${total === 1 ? "" : "s"}`}
            {hayFiltros && !cargando ? " con los filtros aplicados" : ""}
          </p>
        </div>
        <button
          onClick={() => setModalAbierto(true)}
          className="rounded-lg bg-[var(--primary)] px-4 py-2 text-sm font-semibold text-white hover:bg-[var(--primary-dark)]"
        >
          + Nuevo requerimiento
        </button>
      </div>

      {/* Filtros */}
      <div className="rounded-xl border border-slate-200 bg-white p-3">
        {/* En un teléfono los ocho desplegables eran cinco filas antes de la
            primera tarjeta: media pantalla gastada en algo que casi nunca se
            toca. El buscador queda afuera porque es lo contrario: buscar un N°
            de RI es lo más común desde el celular. */}
        <div className="mb-2 flex items-center gap-2 md:hidden">
          <button
            onClick={() => setFiltrosAbiertos((v) => !v)}
            className="flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700"
            aria-expanded={filtrosAbiertos}
          >
            Filtros
            {filtrosPuestos > 0 && (
              <span className="rounded-full bg-[var(--primary)] px-1.5 text-[11px] font-semibold text-white">
                {filtrosPuestos}
              </span>
            )}
            <svg
              width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"
              style={{ transform: filtrosAbiertos ? "rotate(180deg)" : "none" }}
            >
              <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          {/* Cuántos hay puestos tiene que verse con el panel cerrado: si no,
              una lista filtrada se lee como una lista vacía. */}
          {filtrosPuestos > 0 && (
            <button onClick={limpiar} className="text-xs text-slate-500 underline">
              Limpiar
            </button>
          )}
        </div>

        <input
          className="mb-2 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm md:hidden"
          placeholder="Buscar texto o N° de RI…"
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
        />

        <div
          className={`${filtrosAbiertos ? "grid" : "hidden"} grid-cols-2 gap-2 md:grid md:grid-cols-4 lg:grid-cols-9`}
        >
          <input
            className="col-span-2 hidden rounded-lg border border-slate-300 px-3 py-2 text-sm md:block"
            placeholder="Buscar texto o N° de RI…"
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
          />
          {/* Los nueve aceptan varios valores: la pregunta que se le hace a
              esta tabla casi nunca es por un solo estado ni por una sola área.
              Los que tienen lista larga —proveedores, ubicaciones, máquinas—
              traen buscador solos; los cinco estados no lo necesitan. */}
          <MultiSelect valores={area} onCambio={setArea}
            vacio="Todas las áreas" plural="áreas"
            opciones={areas.map((a) => [a.id, a.nombre])} />
          <MultiSelect valores={aprobacion} onCambio={setAprobacion}
            vacio="Toda aprobación" plural="aprobaciones"
            opciones={ESTADOS_APROBACION.map((e) => [e, APROBACION_LABELS[e].label])} />
          <MultiSelect valores={compra} onCambio={setCompra}
            vacio="Toda compra" plural="estados"
            opciones={ESTADOS_COMPRA.map((e) => [e, COMPRA_LABELS[e].label])} />
          <MultiSelect valores={prioridad} onCambio={setPrioridad}
            vacio="Toda prioridad" plural="prioridades"
            opciones={PRIORIDADES.map((p) => [p, PRIORIDAD_LABELS[p].label])} />
          <MultiSelect valores={empresa} onCambio={setEmpresa}
            vacio="Cualquier empresa" plural="empresas"
            opciones={[...empresas.map((e) => [e.id, e.nombre] as [string, string]), ["AMBAS", "Ambas"]]} />
          <MultiSelect valores={proveedor} onCambio={setProveedor}
            vacio="Todo proveedor" plural="proveedores"
            opciones={proveedores.map((p) => [p.id, p.nombre])} />
          <MultiSelect valores={ubicacion} onCambio={setUbicacion}
            vacio="Cualquier ubicación" plural="ubicaciones"
            opciones={ubicaciones.map((u) => [u.id, u.nombre])} />
          <MultiSelect valores={sector} onCambio={setSector}
            vacio="Cualquier sector de planta" plural="sectores"
            opciones={sectores.map((s) => [s.id, s.codigo ? `${s.codigo} — ${s.nombre}` : s.nombre])} />
          <MultiSelect valores={equipo} onCambio={setEquipo}
            vacio="Cualquier máquina" plural="máquinas"
            opciones={equipos.map((e) => [
              e.id,
              [e.marca, e.modelo].filter(Boolean).length
                ? `${e.code} — ${e.name} · ${[e.marca, e.modelo].filter(Boolean).join(" ")}`
                : `${e.code} — ${e.name}`,
            ])} />
        </div>
        {hayFiltros && (
          <button onClick={limpiar} className="mt-2 hidden text-xs text-slate-500 hover:text-slate-800 md:block">
            Limpiar filtros
          </button>
        )}
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          No se pudieron cargar los requerimientos: {error}
        </div>
      )}

      {errorAccion && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {errorAccion}
        </div>
      )}

      {/* En un teléfono, tarjetas. Trece columnas no entran en 343 px, y con
          scroll horizontal hay que arrastrar cuatro pantallas para leer una
          fila. La tarjeta muestra lo que se necesita para decidir y esconde el
          resto, que está en la ficha a un toque. */}
      <div className="space-y-2 md:hidden">
        {cargando ? (
          <p className="py-10 text-center text-sm text-slate-400">Cargando…</p>
        ) : filas.length === 0 ? (
          <p className="rounded-xl border border-slate-200 bg-white py-10 text-center text-sm text-slate-400">
            {hayFiltros ? "Ningún requerimiento coincide con los filtros." : "Todavía no hay requerimientos cargados."}
          </p>
        ) : (
          filas.map((f) => (
            <TarjetaRequerimiento
              key={f.id}
              f={f}
              href={ficha(f.id)}
              canEdit={canEdit}
              aprobadores={aprobadores}
              usuarioId={usuarioId}
              procesando={procesando === f.id}
              onAvanzar={() =>
                ESTADOS_CON_DIALOGO.includes(f.estado_compra) ? abrirDialogo(f) : avanzar(f)
              }
              onEspera={(aEspera) => cambiarEspera(f, aEspera)}
            />
          ))
        )}
      </div>

      {/* Tabla */}
      <div className="hidden overflow-hidden rounded-xl border border-slate-200 bg-white md:block">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-3 py-2 text-left">N° RI</th>
                <th className="px-3 py-2 text-left">Fecha</th>
                <th className="px-3 py-2 text-left">Descripción</th>
                <th className="px-3 py-2 text-left">Área</th>
                <th className="px-3 py-2 text-left">Dónde</th>
                <th className="px-3 py-2 text-right">Cant.</th>
                <th className="px-3 py-2 text-left">Prioridad</th>
                <th className="px-3 py-2 text-left">Paga</th>
                <th className="px-3 py-2 text-left">Aprobación</th>
                <th className="px-3 py-2 text-left">Compra</th>
                <th className="px-3 py-2 text-left">Proveedor</th>
                <th className="px-3 py-2 text-right">Costo + IVA</th>
                {canEdit && <th className="px-3 py-2 text-left">Acción</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {cargando ? (
                <tr><td colSpan={columnas} className="px-3 py-10 text-center text-slate-400">Cargando…</td></tr>
              ) : filas.length === 0 ? (
                <tr><td colSpan={columnas} className="px-3 py-10 text-center text-slate-400">
                  {hayFiltros ? "Ningún requerimiento coincide con los filtros." : "Todavía no hay requerimientos cargados."}
                </td></tr>
              ) : (
                filas.map((f) => {
                  const dias = f.estado_compra === "RECIBIDO" ? null : diasRestantes(f.fecha_necesidad);
                  const vencido = dias !== null && dias < 0;
                  const donde = f.compras_ubicaciones?.nombre ?? f.ubicacion_raw;
                  return (
                    <tr key={f.id} className="hover:bg-slate-50">
                      <td className="px-3 py-2 font-mono">
                        <Link href={ficha(f.id)} className="font-semibold text-[var(--primary)] hover:underline">
                          {f.nro_ri}
                        </Link>
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-slate-600">{fecha(f.fecha)}</td>
                      <td className="max-w-xs px-3 py-2">
                        <Link href={ficha(f.id)} className="text-slate-900 hover:underline">
                          {f.descripcion}
                        </Link>
                        {f.codigo && <div className="font-mono text-xs text-slate-400">{f.codigo}</div>}
                        {vencido && (
                          <div className="text-xs font-semibold text-red-600">
                            Vencido hace {Math.abs(dias!)} día{Math.abs(dias!) === 1 ? "" : "s"}
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-2 text-slate-600">{f.compras_areas?.nombre ?? "—"}</td>
                      <td className="px-3 py-2 text-slate-600">{donde ?? "—"}</td>
                      <td className="px-3 py-2 text-right text-slate-600">{f.cantidad ?? "—"}</td>
                      <td className="px-3 py-2"><Chip {...etiquetaPrioridad(f.prioridad)} /></td>
                      <td className="px-3 py-2 text-slate-600">{etiquetaEmpresa(f.empresas?.nombre, f.paga_ambas)}</td>
                      <td className="px-3 py-2"><Chip {...APROBACION_LABELS[f.estado_aprobacion]} /></td>
                      <td className="px-3 py-2"><Chip {...COMPRA_LABELS[f.estado_compra]} /></td>
                      <td className="px-3 py-2 text-slate-600">{f.proveedores?.nombre ?? "—"}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-right font-mono text-slate-700">
                        {moneda(f.costo_iva)}
                      </td>
                      {canEdit && (
                        <td className="whitespace-nowrap px-3 py-2">
                          <Accion
                            r={f}
                            aprobadores={aprobadores}
                            usuarioId={usuarioId}
                            procesando={procesando === f.id}
                            onEspera={(aEspera) => cambiarEspera(f, aEspera)}
                            onAvanzar={() =>
                              ESTADOS_CON_DIALOGO.includes(f.estado_compra)
                                ? abrirDialogo(f)
                                : avanzar(f)
                            }
                          />
                        </td>
                      )}
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* La paginación es de las dos vistas, así que vive afuera de la tabla. */}
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white md:border-t-0 md:border-transparent">
        {!cargando && total > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-xs text-slate-500">
            <div>
              Mostrando {pagina * POR_PAGINA + 1}–{Math.min((pagina + 1) * POR_PAGINA, total)} de {total.toLocaleString("es-AR")}
              {totalPantalla > 0 && <> · en pantalla: <strong className="font-mono">{moneda(totalPantalla)}</strong></>}
            </div>
            <div className="flex items-center gap-2">
              <button
                disabled={pagina === 0}
                onClick={() => setPagina((p) => p - 1)}
                className="rounded-lg border border-slate-300 px-3 py-1.5 disabled:opacity-40"
              >
                ← Anterior
              </button>
              <span>Página {pagina + 1} de {paginas}</span>
              <button
                disabled={pagina + 1 >= paginas}
                onClick={() => setPagina((p) => p + 1)}
                className="rounded-lg border border-slate-300 px-3 py-1.5 disabled:opacity-40"
              >
                Siguiente →
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Aprobar la compra tiene su propio diálogo: no exige nada, avisa que va
          sin comparativa y ofrece cargar el proveedor y el costo. Antes este
          botón avanzaba a ciegas, sin avisar ni dejar cargar nada, mientras la
          bandeja ni siquiera lo ofrecía. */}
      {avanzando?.estado_compra === "PARA_COMPRAR" && (
        <div
          onClick={() => setAvanzando(null)}
          className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/50 p-4"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="mt-20 w-full max-w-lg rounded-xl bg-white shadow-xl"
          >
            <div className="border-b border-slate-200 px-6 py-4">
              <h2 className="text-lg font-bold text-slate-900">Aprobar la compra</h2>
              <p className="text-sm text-slate-500">
                RI {avanzando.nro_ri} · {avanzando.descripcion}
              </p>
            </div>
            <div className="px-6 py-5">
              <AprobarSinComparativa
                proveedores={proveedores}
                presupuestosSinMirar={resumenes[avanzando.id]?.cuantos ?? 0}
                aprobando={procesando === avanzando.id}
                onAprobar={async (datos) => {
                  const ok = await avanzar(avanzando, datos);
                  if (ok) setAvanzando(null);
                }}
                onCancelar={() => setAvanzando(null)}
              />
            </div>
          </div>
        </div>
      )}

      {avanzando && avanzando.estado_compra !== "PARA_COMPRAR" && (
        <ModalAvanzar
          requerimiento={avanzando}
          ficha={ficha(avanzando.id)}
          aprobadores={aprobadores}
          proveedores={proveedores}
          comparativa={resumenes[avanzando.id] ?? { cuantos: 0, elegida: null }}
          onClose={() => setAvanzando(null)}
          onConfirmar={(extra) => avanzar(avanzando, extra)}
        />
      )}

      {modalAbierto && (
        <NuevoRequerimientoModal
          areas={areas}
          empresas={empresas}
          ubicaciones={ubicaciones}
          onClose={() => setModalAbierto(false)}
          onSaved={() => { setModalAbierto(false); cargar(); }}
        />
      )}
    </div>
  );
}

/**
 * Un requerimiento en un teléfono.
 *
 * La tabla tiene trece columnas y en 343 px de ancho eso son cuatro pantallas
 * de arrastre para leer una sola fila. Acá quedan las que hacen falta para
 * decidir —qué es, de qué área, para cuándo, cuánto— y el resto está en la
 * ficha, a un toque.
 *
 * Se renderiza en paralelo a la tabla y cada una se muestra en su tamaño. Es
 * más marcado en el HTML, pero medir el ancho con JavaScript haría que el
 * servidor y el navegador dibujen cosas distintas en la primera pasada.
 */
function TarjetaRequerimiento({
  f, href, canEdit, aprobadores, usuarioId, procesando, onAvanzar, onEspera,
}: {
  f: RequerimientoConRelaciones;
  /** La ficha del RI, con el listado al que volver. */
  href: string;
  canEdit: boolean;
  aprobadores: Persona[];
  usuarioId: string;
  procesando: boolean;
  onAvanzar: () => void;
  onEspera: (aEspera: boolean) => void;
}) {
  const dias = f.estado_compra === "RECIBIDO" ? null : diasRestantes(f.fecha_necesidad);
  const vencido = dias !== null && dias < 0;
  const donde = f.compras_ubicaciones?.nombre ?? f.ubicacion_raw;

  return (
    <article
      className={`rounded-xl border bg-white p-3 ${
        vencido ? "border-l-4 border-l-red-500 border-slate-200" : "border-slate-200"
      }`}
    >
      <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
        <Link
          href={href}
          className="font-mono text-xs font-semibold text-[var(--primary)] hover:underline"
        >
          RI {f.nro_ri}
        </Link>
        <Chip {...etiquetaPrioridad(f.prioridad)} />
        <Chip {...COMPRA_LABELS[f.estado_compra]} />
        {/* El estado de aprobación sólo cuando dice algo: casi todo está
            aprobado, y repetirlo en cada tarjeta sería ruido. */}
        {f.estado_aprobacion !== "APROBADA" && (
          <Chip {...APROBACION_LABELS[f.estado_aprobacion]} />
        )}
      </div>

      <Link
        href={href}
        className="block text-sm leading-snug text-slate-900 hover:underline"
      >
        {f.descripcion}
      </Link>
      {f.codigo && <div className="font-mono text-xs text-slate-400">{f.codigo}</div>}

      <div className="mt-1.5 space-y-0.5 text-[11px] text-slate-500">
        <div>
          {f.compras_areas?.nombre ?? "Sin área"}
          {donde ? ` · ${donde}` : ""}
          {f.cantidad ? ` · ${f.cantidad} u.` : ""}
        </div>
        <div>{etiquetaEmpresa(f.empresas?.nombre, f.paga_ambas)}</div>
        {f.proveedores?.nombre && <div>{f.proveedores.nombre}</div>}
        {f.costo_iva !== null && (
          <div className="font-mono text-slate-700">{moneda(f.costo_iva)}</div>
        )}
        <div className={vencido ? "font-semibold text-red-600" : ""}>
          {f.fecha_necesidad
            ? vencido
              ? `Vencido hace ${Math.abs(dias!)} d`
              : `Se necesita el ${fecha(f.fecha_necesidad)}`
            : `Pedido el ${fecha(f.fecha)}`}
        </div>
      </div>

      {canEdit && (
        <div className="mt-2.5 border-t border-slate-100 pt-2.5">
          <Accion
            r={f}
            aprobadores={aprobadores}
            usuarioId={usuarioId}
            procesando={procesando}
            onAvanzar={onAvanzar}
            onEspera={onEspera}
          />
        </div>
      )}
    </article>
  );
}

/**
 * El paso siguiente de una fila, si lo hay.
 *
 * No toda fila tiene uno, y decir por qué importa tanto como ofrecer el botón:
 *
 *  - sin aprobación de gerencia el circuito de compra ni siquiera arrancó
 *  - en PEDIDO, RECIBIDO o DENEGADO no hay paso que dar desde acá
 *  - en PARA_COMPRAR el paso es de quien la tiene asignada y de nadie más: en
 *    la planilla el estado dice a quién le toca, y que apruebe otro dejaría los
 *    dos lados diciendo cosas distintas
 */
function Accion({
  r, aprobadores, usuarioId, procesando, onAvanzar, onEspera,
}: {
  r: RequerimientoConRelaciones;
  aprobadores: Persona[];
  usuarioId: string;
  procesando: boolean;
  onAvanzar: () => void;
  onEspera: (aEspera: boolean) => void;
}) {
  const siguiente = SIGUIENTE_ESTADO[r.estado_compra];
  const tenue = "text-xs text-slate-400";
  const chico = "text-[11px] text-slate-500 underline hover:text-slate-800 disabled:opacity-50";

  if (r.estado_aprobacion !== "APROBADA") {
    return <span className={tenue}>Sin aprobar</span>;
  }

  // Un pedido frenado no ofrece avanzar: primero hay que sacarlo de la espera,
  // y vuelve a la etapa donde estaba.
  if (r.estado_compra === "EN_ESPERA") {
    return (
      <button onClick={() => onEspera(false)} disabled={procesando} className={chico}>
        {procesando ? "Actualizando…" : "Sacar de la espera"}
      </button>
    );
  }

  if (!siguiente) return <span className={tenue}>—</span>;

  const espera = (
    <button onClick={() => onEspera(true)} disabled={procesando} className={chico}>
      Poner en espera
    </button>
  );

  if (r.estado_compra === "PARA_COMPRAR" && r.compra_asignada_a !== usuarioId) {
    const quien = aprobadores.find((a) => a.id === r.compra_asignada_a);
    return (
      <div className="space-y-1">
        <span className={`block ${tenue}`}>
          {quien ? `Espera a ${nombreCorto(quien)}` : "Sin asignar"}
        </span>
        {espera}
      </div>
    );
  }

  return (
    <div className="space-y-1">
      <button
        onClick={onAvanzar}
        disabled={procesando}
        className="block rounded-lg border border-slate-300 px-2 py-1 text-xs text-slate-700 hover:bg-slate-50 disabled:opacity-50"
      >
        {procesando ? "Actualizando…" : `${ACCION_SIGUIENTE[r.estado_compra] ?? "Avanzar"} →`}
      </button>
      {espera}
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
