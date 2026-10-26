"use client";

import { useState, useCallback, useEffect, useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { ESPECIALIDADES } from "@/lib/mantenimiento/ordenes";
import MultiSelect from "@/components/MultiSelect";
import type { UbicacionEnlazada } from "@/lib/compras/ubicaciones";
import {
  leerFiltrosDeLaUrl, escribirFiltrosEnLaUrl, consultaDeLaRuta, hayAlgunFiltro,
  FILTROS_VACIOS, TIPOS_DE_OT, QUIENES_DE_OT, PRIORIDADES_DE_OT, CAMPOS_DE_FECHA,
  ETIQUETA_DE_TIPO, ETIQUETA_DE_QUIEN, ORDENES_DEL_LISTADO,
  type FiltrosOt,
} from "@/lib/mantenimiento/filtrosOt";
import { leerPaginaDeLaUrl } from "@/lib/core/filtrosUrl";
import UltimaSincronizacion from "@/components/UltimaSincronizacion";
import type { UltimaSync } from "@/lib/core/sincronizaciones";
import NuevaOTModal from "./NuevaOTModal";
import IniciarOTModal from "./IniciarOTModal";
import RegistrarOTModal from "./RegistrarOTModal";
import ProveedoresDesconocidos from "../ProveedoresDesconocidos";
import RepuestosOTModal from "./RepuestosOTModal";
import JustificacionOT from "./JustificacionOT";
import { pideJustificacion } from "@/lib/mantenimiento/notas";
import { prioridadEfectiva } from "@/lib/mantenimiento/prioridad";
import OrdenarTrabajo from "./OrdenarTrabajo";
import PuntajeGut from "./PuntajeGut";
import PuntuarGutModal from "./PuntuarGutModal";
import { ESCALAS_GUT, puntajeGut } from "@/lib/mantenimiento/gut";
import { useConfirm } from "@/components/ConfirmProvider";
import InfoTip from "@/components/InfoTip";
import { useCargar } from "@/lib/core/useCargar";
import Select from "@/components/Select";

const ESTADOS = [
  { value: "",           label: "Todos",      color: "#64748B", bg: "#F8FAFC", dot: "#94A3B8" },
  { value: "ATRASADO",   label: "Atrasado",   color: "#DC2626", bg: "#FEF2F2", dot: "#EF4444" },
  { value: "EN_PROCESO", label: "En proceso", color: "#1D4ED8", bg: "#EFF6FF", dot: "#3B82F6" },
  { value: "POR_HACER",  label: "Por hacer",  color: "#B45309", bg: "#FFFBEB", dot: "#F59E0B" },
  { value: "REALIZADO",  label: "Realizado",  color: "#16A34A", bg: "#F0FDF4", dot: "#22C55E" },
];

export function estadoMeta(v: string) {
  return ESTADOS.find((e) => e.value === v) ?? { label: v, color: "#64748B", bg: "#F8FAFC", dot: "#94A3B8" };
}

/**
 * Una de las fechas de la orden como la lee una persona: 12/10/2026.
 *
 * El `T00:00:00` no es decoración. `fecha`, `fecha_ejecucion` y `fecha_cierre`
 * son columnas `date`, así que llegan como "2026-10-12", y `new Date()` sobre
 * una fecha pelada la interpreta como **medianoche UTC**: en Argentina —UTC-3—
 * eso cae a las 21:00 del día anterior, y la pantalla mostraba **un día menos
 * que la planilla** en las tres. Con la hora pegada se parsea en hora local y
 * el día es el que dice la celda, lo mire quien lo mire y desde donde lo mire.
 *
 * Es la misma trampa que ya explica `fechaCorta` en `lib/compras/comparativa.ts`
 * y que el resto de Mantenimiento esquiva con este mismo `+ "T00:00:00"` —el
 * dashboard, ejecuciones, mantenimientos—. Acá faltaba.
 */
function fechaDeLaOT(valor: string | null | undefined): string | null {
  return valor ? new Date(valor + "T00:00:00").toLocaleDateString("es-AR") : null;
}

export default function OrdenesClient({
  canEdit, sectores, equipos, contratistas, areas, empresas, ubicaciones, sync
}: {
  canEdit: boolean;
  sectores: any[];
  equipos: any[];
  /** Los proveedores marcados como contratistas: es por quién se filtra. */
  contratistas: { id: string; nombre: string }[];
  /** Los catálogos de Compras, para poder pedir un repuesto desde la orden. */
  areas: { id: string; nombre: string }[];
  empresas: { id: string; nombre: string }[];
  ubicaciones: UbicacionEnlazada[];
  /** Cuándo se trajo por última vez lo de la planilla. */
  sync: UltimaSync | null;
}) {
  const confirm = useConfirm();
  const [orders, setOrders]     = useState<any[]>([]);
  const [count, setCount]       = useState(0);
  const [loading, setLoading]   = useState(true);
  // Los filtros vienen en la URL: así el tablero manda directo a "las
  // atrasadas" en vez de dejar a alguien filtrando a mano, y así se puede pasar
  // por chat una vista concreta.
  const params = useSearchParams();

  const catalogos = useMemo(() => ({
    sectores: sectores.map((x: any) => x.id),
    equipos: equipos.map((x: any) => x.id),
    proveedores: contratistas.map((x) => x.id),
  }), [sectores, equipos, contratistas]);

  /**
   * Con qué filtros arranca la pantalla.
   *
   * Sale de `useSearchParams` y no de `window.location.search`: al llegar desde
   * un enlace —el tablero mandando a "las atrasadas"— Next escribe la barra de
   * direcciones en un `useInsertionEffect`, después de que esta pantalla se
   * renderizó, así que ahí `window` todavía tiene la URL de donde se venía y los
   * filtros arrancaban vacíos. `useSearchParams` lee el `canonicalUrl` del
   * router, que ya es el nuevo, y al volver con el botón de atrás es el
   * restaurado: sirve para los dos. Es la misma nota que dejó el listado de
   * requerimientos.
   */
  const laUrlDeVerdad = () => new URLSearchParams(params.toString());
  const [arranque] = useState<FiltrosOt>(() =>
    leerFiltrosDeLaUrl(laUrlDeVerdad(), catalogos)
  );

  const [search, setSearch]     = useState(arranque.busqueda);
  const [busquedaAplicada, setBusquedaAplicada] = useState(arranque.busqueda);
  const [campoFecha, setCampoFecha] = useState(arranque.campoFecha);
  const [desde, setDesde] = useState(arranque.desde);
  const [hasta, setHasta] = useState(arranque.hasta);
  // Cada uno es una lista: dentro de un filtro los valores suman —«atrasado o
  // en proceso»— y entre filtros se recortan. Vacío es "no filtrar por esto".
  const [estado, setEstado] = useState(arranque.estado);
  const [especialidad, setEspecialidad] = useState(arranque.especialidad);
  const [tipo, setTipo] = useState(arranque.tipo);
  const [quien, setQuien] = useState(arranque.quien);
  const [prioridad, setPrioridad] = useState(arranque.prioridad);
  const [proveedor, setProveedor] = useState(arranque.proveedor);
  const [sector, setSector] = useState(arranque.sector);
  const [equipo, setEquipo] = useState(arranque.equipo);
  // No es un filtro —no saca filas— pero viaja igual que ellos: va a la URL y
  // a la consulta, porque el orden lo resuelve la base. Por eso queda afuera de
  // `hayAlgunFiltro` y de «Limpiar»: no es algo que esconda órdenes.
  const [orden, setOrden] = useState(arranque.orden);
  const [filtrosAbiertos, setFiltrosAbiertos] = useState(false);
  const [sincronizando, setSincronizando] = useState(false);
  const [avisoSync, setAvisoSync] = useState<string | null>(null);
  // La página también sale de la URL, por lo mismo que los filtros: volver a la
  // tabla filtrada pero en la primera es media solución cuando se estaba en la
  // tercera. Se cuenta desde uno acá y en la URL, así que no hay conversión.
  const [page, setPage]         = useState(() => leerPaginaDeLaUrl(laUrlDeVerdad()));
  const [expanded, setExpanded] = useState<string | null>(null);
  const [showNew, setShowNew]   = useState(false);
  const [view, setView]         = useState<"list" | "kanban" | "orden">("list");

  const [kanbanData, setKanbanData] = useState<Record<string, { items: any[]; count: number }>>({});
  const [kanbanLoading, setKanbanLoading] = useState(false);
  const [iniciando, setIniciando] = useState<any | null>(null);
  const [registrando, setRegistrando] = useState<any | null>(null);
  const [puntuando, setPuntuando] = useState<any | null>(null);
  const [sinProveedor, setSinProveedor] = useState<string[]>([]);
  const [verRepuestos, setVerRepuestos] = useState<any | null>(null);

  /**
   * Todo lo que está pendiente, con sus notas de GUT, para la línea que
   * sugiere puntuar. Es una consulta aparte de la del listado a propósito: el
   * listado está paginado y filtrado, y "cuántas pendientes no tienen GUT" es
   * una pregunta sobre todas, no sobre la página que se está mirando.
   *
   * Si falla queda en null y la línea simplemente no aparece: una sugerencia
   * no vale un cartel de error.
   *
   * Sólo se pide si la línea se va a ver: la ve quien puede puntuar (`canEdit`)
   * y sólo en el listado. Sin ese filtro cada visita —de quien sólo mira, o en
   * el tablero o en "qué hacer primero"— traía hasta 300 filas con todas las
   * columnas para una línea que nunca se pinta.
   */
  const [pendientes, setPendientes] = useState<any[] | null>(null);
  const recargarPendientes = useCargar(async (vigente) => {
    if (!canEdit || view !== "list") return;
    try {
      const res = await fetch("/api/mantenimiento/ordenes?pendientes=1");
      if (!res.ok) return;
      const body = await res.json();
      if (!vigente()) return;
      setPendientes(body.data ?? []);
    } catch {
      // Sin la línea. El listado anda igual.
    }
  }, [canEdit, view]);

  /**
   * Cuáles de las que se están viendo ya tienen una justificación.
   *
   * Va en un pedido aparte del listado para que la pantalla **no dependa** de
   * que la tabla de notas exista: si falla, el `catch` deja el conjunto vacío,
   * los carteles no aparecen y las órdenes se siguen viendo igual. Un listado
   * roto por un cartel sería un mal negocio.
   */
  const [justificadas, setJustificadas] = useState<Set<string>>(new Set());

  const filtros: FiltrosOt = useMemo(() => ({
    busqueda: busquedaAplicada, campoFecha, orden, desde, hasta,
    estado, especialidad, tipo, quien, prioridad, proveedor, sector, equipo,
  }), [busquedaAplicada, campoFecha, orden, desde, hasta,
       estado, especialidad, tipo, quien, prioridad, proveedor, sector, equipo]);

  const hayFiltros = hayAlgunFiltro(filtros);

  function limpiarFiltros() {
    setSearch("");
    // `campoFecha` también vuelve a lo de siempre: dejarlo en "fecha de cierre"
    // después de limpiar es un filtro invisible esperando a la próxima fecha.
    setCampoFecha(""); setDesde(""); setHasta("");
    setEstado([]); setEspecialidad([]); setTipo([]); setQuien([]);
    setPrioridad([]); setProveedor([]); setSector([]); setEquipo([]);
  }

  // La búsqueda espera un momento para no consultar en cada tecla.
  useEffect(() => {
    const t = setTimeout(() => setBusquedaAplicada(search.trim()), 350);
    return () => clearTimeout(t);
  }, [search]);

  // Cambiar un filtro vuelve a la primera página. Se ajusta durante el render
  // y no en un efecto: así no hay un commit en el que los filtros ya son los
  // nuevos y la página sigue siendo la vieja, que dispara una consulta de más.
  const filtrosAhora = escribirFiltrosEnLaUrl(filtros);
  const [filtrosPrevios, setFiltrosPrevios] = useState(filtrosAhora);
  if (filtrosAhora !== filtrosPrevios) {
    setFiltrosPrevios(filtrosAhora);
    setPage(1);
  }

  // Lo que va a la barra de direcciones lleva además la página. `filtrosAhora`
  // se queda sin ella a propósito: es lo que detecta el cambio de filtro que
  // vuelve a la primera, y con la página adentro se resetearía sola en cuanto
  // alguien pasa de página.
  const query = escribirFiltrosEnLaUrl(filtros, page);

  /**
   * La URL va detrás de los filtros y de la página.
   *
   * Con `replace` y no `push`: salir de la pantalla con el botón de atrás no
   * tiene por qué obligar a deshacer antes cada casilla tildada, una por una.
   * Y con `history` y no `router.replace`, que le pediría la página entera al
   * servidor —los sectores, los equipos, los contratistas, la sincronización—
   * para cambiar un query string que la pantalla ya tiene resuelto en memoria.
   */
  useEffect(() => {
    const destino = query
      ? `${window.location.pathname}?${query}`
      : window.location.pathname;
    if (destino === window.location.pathname + window.location.search) return;
    // El estado que va es el que ya estaba: ahí guarda Next su árbol de rutas.
    window.history.replaceState(window.history.state, "", destino);
  }, [query]);

  /**
   * Cuáles de estas órdenes ya tienen quien explique por qué siguen abiertas.
   *
   * Sólo se pregunta por las abiertas: una realizada no debe ninguna, y
   * mandarlas igual sería la mitad de los ids de la página para nada.
   *
   * Nunca tira: si la tabla no está —la migración no corrió— o el pedido
   * falla, se queda sin carteles y el listado anda igual.
   */
  const cargarJustificadas = useCallback(async (ordenes: any[]) => {
    const abiertas = ordenes.filter((o) => pideJustificacion(o.estado)).map((o) => o.id);
    if (abiertas.length === 0) {
      setJustificadas(new Set());
      return;
    }
    try {
      const res = await fetch(
        `/api/mantenimiento/ordenes/justificadas?ordenes=${abiertas.join(",")}`
      );
      const body = await res.json().catch(() => ({}));
      setJustificadas(new Set<string>(res.ok ? body.data ?? [] : []));
    } catch {
      setJustificadas(new Set());
    }
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch(`/api/mantenimiento/ordenes?${consultaDeLaRuta(filtros, page)}`);
    const json = await res.json();
    const data = json.data ?? [];
    setOrders(data);
    setCount(json.count ?? 0);
    setLoading(false);
    void cargarJustificadas(data);
  }, [page, filtros, cargarJustificadas]);

  async function sincronizar() {
    setSincronizando(true);
    setAvisoSync(null);
    const res = await fetch("/api/mantenimiento/ordenes/sync", { method: "POST" });
    const body = await res.json().catch(() => ({}));
    setSincronizando(false);
    setAvisoSync(
      res.ok
        ? `Se leyeron ${body.leidas} filas y se guardaron ${body.guardadas} órdenes.` +
          (body.sin_equipo > 0 ? ` ${body.sin_equipo} sin equipo enlazado.` : "") +
          // Dos filas con el mismo N° de OT: se guardó la de más abajo, que es
          // la más reciente. Hay que arreglarlo en la planilla, que es donde
          // está el problema: acá sólo se puede elegir una.
          (body.numeros_repetidos?.length
            ? ` Ojo: la planilla tiene dos filas con el N° ${body.numeros_repetidos.join(", ")}` +
              ` — se guardó la de más abajo. Corregilo en la planilla.`
            : "")
        : (body.error ?? "No se pudo sincronizar.")
    );
    setSinProveedor(res.ok ? body.sin_proveedor ?? [] : []);
    if (res.ok) load();
  }

  const KANBAN_ESTADOS = ["ATRASADO", "EN_PROCESO", "POR_HACER", "REALIZADO"];
  const loadKanban = useCargar(async (vigente) => {
    if (view !== "kanban") return;
    setKanbanLoading(true);
    const results = await Promise.all(
      KANBAN_ESTADOS.map((e) =>
        fetch(`/api/mantenimiento/ordenes?estado=${e}&page=1`).then((r) => r.json())
      )
    );
    if (!vigente()) return;
    const data: Record<string, { items: any[]; count: number }> = {};
    KANBAN_ESTADOS.forEach((e, i) => {
      data[e] = { items: results[i].data ?? [], count: results[i].count ?? 0 };
    });
    setKanbanData(data);
    setKanbanLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);

  // El modo "qué hacer primero" trae lo suyo: son las pendientes sin paginar.
  useCargar(async () => {
    if (view === "list") load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, load]);

  /**
   * Marcar o desmarcar que el trabajo obliga a parar el sector.
   *
   * Sin confirmación: es una marca que se pone y se saca, y el que la pone
   * suele estar frente a la OT decidiéndolo. Pedir confirmación para cada
   * tilde molesta más de lo que protege.
   */
  /**
   * Lo que la ruta contesta, mostrado.
   *
   * Las dos acciones de abajo hacían `await fetch(...)` y no miraban nada: ni
   * `res.ok`, ni el `planilla_error`. Un 403 se veía igual que un cambio que
   * salió bien, y lo que no llegó a la planilla no se enteraba nadie — que es
   * como la OT 2796 quedó registrada sólo en el sistema el 16/10/2026.
   */
  async function contar(res: Response, queSeHizo: string) {
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      setAvisoSync(`No se pudo ${queSeHizo}: ${body.error ?? "error desconocido"}`);
      return false;
    }
    if (body.planilla_error) {
      setAvisoSync(`Se guardó en el sistema, pero no en la planilla: ${body.planilla_error}`);
    }
    return true;
  }

  async function cambiarParada(id: string, valor: boolean) {
    const res = await fetch("/api/mantenimiento/ordenes", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, requiere_parada_sector: valor }),
    });
    await contar(res, "cambiar la marca de parar el sector");
    load();
  }

  /**
   * Cambiar el estado de una OT.
   *
   * Pasarla a "en proceso" abre el modal de inicio en vez de confirmar y ya:
   * empezar el trabajo casi siempre cambia el estado del equipo, y si no se
   * pregunta ahí queda una máquina figurando operativa mientras está
   * desarmada.
   */
  async function changeEstado(id: string, estado: string) {
    const buscar = () =>
      orders.find((o: any) => o.id === id)
      ?? Object.values(kanbanData).flatMap((c: any) => c.items).find((o: any) => o.id === id);

    if (estado === "EN_PROCESO") {
      const orden = buscar();
      if (orden) { setIniciando(orden); return; }
    }

    // Dar por realizada una OT sin decir qué se hizo pierde justamente lo que
    // sirve después: el modal lo pregunta y de paso lo escribe en la planilla.
    if (estado === "REALIZADO") {
      const orden = buscar();
      if (orden) { setRegistrando(orden); return; }
    }

    const meta = estadoMeta(estado);
    const ok = await confirm({
      title: "Cambiar estado de la OT",
      message: `La orden pasará al estado "${meta.label}". ¿Confirmás?`,
      confirmText: "Cambiar estado",
    });
    if (!ok) return;
    const res = await fetch("/api/mantenimiento/ordenes", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, estado }),
    });
    await contar(res, `pasar la OT a «${meta.label}»`);
    if (view === "kanban") loadKanban();
    else load();
  }

  const totalPages = Math.ceil(count / 50);
  // Una `?pagina=40` escrita a mano —o guardada en un enlace de cuando la tabla
  // era más larga— muestra una tabla vacía, y una tabla vacía se lee como "no
  // hay nada". Cuando el total dice que esa página no existe, se cae a la
  // última que sí, y sin resultados la última es la primera: si no, quedaría
  // parada en la 5 sin botones con los que salir de ahí. Se ajusta durante el
  // render, igual que el salto a la primera al cambiar un filtro, y con el
  // total ya cargado: mientras se consulta, `count` es el de la anterior.
  const ultimaPagina = Math.max(1, totalPages);
  if (!loading && page > ultimaPagina) setPage(ultimaPagina);

  const kanbanGroups = ESTADOS.slice(1).map(e => ({
    ...e,
    items: kanbanData[e.value]?.items ?? [],
    count: kanbanData[e.value]?.count ?? 0,
  }));

  return (
    <div className="md:p-6 max-w-7xl mx-auto space-y-5">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-slate-900 flex items-center gap-2">
            Órdenes de Trabajo
            <InfoTip text="Listado de todas las órdenes de trabajo (OT). Podés verlas como lista o como tablero Kanban por estado, filtrarlas, crear nuevas y cambiar su estado (Por hacer, En proceso, Atrasado, Realizado)." />
          </h1>
          <UltimaSincronizacion
            cuando={sync?.created_at}
            ok={sync?.ok ?? true}
            error={sync?.error}
          />
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {canEdit && (
            <button onClick={sincronizar} disabled={sincronizando}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50">
              {sincronizando ? "Trayendo…" : "Traer de la planilla"}
            </button>
          )}
          {canEdit && (
            <button onClick={() => setShowNew(true)}
              className="flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 transition-colors">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              Nueva OT
            </button>
          )}
          <div className="flex rounded-lg border border-slate-200 overflow-hidden">
            <button onClick={() => setView("list")}
              className={`px-3 py-2 text-xs font-medium transition-colors ${view === "list" ? "bg-slate-900 text-white" : "bg-white text-slate-500 hover:bg-slate-50"}`}>
              Lista
            </button>
            <button onClick={() => setView("kanban")}
              className={`px-3 py-2 text-xs font-medium transition-colors ${view === "kanban" ? "bg-slate-900 text-white" : "bg-white text-slate-500 hover:bg-slate-50"}`}>
              Kanban
            </button>
            <button onClick={() => setView("orden")}
              title="En qué orden hacer lo que está pendiente"
              className={`px-3 py-2 text-xs font-medium transition-colors ${view === "orden" ? "bg-slate-900 text-white" : "bg-white text-slate-500 hover:bg-slate-50"}`}>
              Qué hacer primero
            </button>
          </div>
        </div>
      </div>

      {avisoSync && (
        <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
          {avisoSync}
        </div>
      )}

      <ProveedoresDesconocidos
        nombres={sinProveedor}
        puedeEditar={canEdit}
        onSumados={() => { setSinProveedor([]); sincronizar(); }}
      />

      {view === "orden" && <OrdenarTrabajo puedeEditar={canEdit} />}

      {view === "list" && (
        <div className="space-y-2">
          {canEdit && (
            <SugerenciaGut pendientes={pendientes} onPuntuar={setPuntuando} />
          )}

          {/* Los estados siguen siendo botones y no un desplegable: son cuatro,
              tienen color, y es el filtro que se usa siempre. Lo que cambia es
              que ahora se pueden tildar varios — "qué hay abierto" son tres
              estados, y de a uno eran tres pasadas para contar 36 órdenes sobre
              1.819. "Todos" no es un estado sino la forma de sacarlos. */}
          <div className="flex gap-2 flex-wrap items-center">
            {ESTADOS.map((e) => {
              const puesto = e.value === "" ? estado.length === 0 : estado.includes(e.value);
              return (
                <button
                  key={e.value}
                  onClick={() =>
                    setEstado(
                      e.value === ""
                        ? []
                        : estado.includes(e.value)
                          ? estado.filter((v) => v !== e.value)
                          : [...estado, e.value]
                    )
                  }
                  className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold border transition-all"
                  style={{
                    color:       puesto ? e.color : "#64748B",
                    background:  puesto ? e.bg    : "#fff",
                    borderColor: puesto ? e.color : "#E2E8F0",
                  }}>
                  <span className="w-1.5 h-1.5 rounded-full" style={{ background: puesto ? e.dot : "#CBD5E1" }} />
                  {e.label}
                </button>
              );
            })}

            <input value={search} onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar equipo, sector, descripción..."
              className="w-full sm:w-60 sm:ml-auto rounded-lg border border-slate-200 px-3 py-1.5 text-sm outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-100" />

            {/* En teléfono el resto arranca cerrado: siete desplegables más
                empujarían la tabla fuera de la pantalla. */}
            <button
              onClick={() => setFiltrosAbiertos((v) => !v)}
              className="sm:hidden rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-600"
            >
              {filtrosAbiertos ? "Menos filtros" : "Más filtros"}
            </button>
          </div>

          <div className={`${filtrosAbiertos ? "grid" : "hidden"} sm:flex grid-cols-2 gap-2 sm:flex-wrap`}>
            <MultiSelect valores={especialidad} onCambio={setEspecialidad}
              vacio="Toda especialidad" plural="especialidades"
              opciones={ESPECIALIDADES.map((e) => [e, e])} />
            {/* Las etiquetas salen de `lib/` y no de un ternario acá: el que
                había mandaba todo lo que no fuera PROGRAMADO a «Correctivo», y
                el día que la lista pasó de dos a cuatro valores el desplegable
                mostró «Correctivo» tres veces. Ver `ETIQUETA_DE_TIPO`. Y el
                texto de «sin filtrar» ya no enumera los valores, por lo mismo:
                «Programado y correctivo» dejó de ser cierto sin avisar. */}
            <MultiSelect valores={tipo} onCambio={setTipo}
              vacio="Todo tipo" plural="tipos"
              opciones={TIPOS_DE_OT.map((t) => [t, ETIQUETA_DE_TIPO[t]])} />
            <MultiSelect valores={quien} onCambio={setQuien}
              vacio="Toda forma" plural="formas"
              opciones={QUIENES_DE_OT.map((q) => [q, ETIQUETA_DE_QUIEN[q]])} />
            <MultiSelect valores={prioridad} onCambio={setPrioridad}
              vacio="Toda prioridad" plural="prioridades"
              opciones={PRIORIDADES_DE_OT.map((x) => [x, x])} />
            <MultiSelect valores={proveedor} onCambio={setProveedor}
              vacio="Todo contratista" plural="contratistas"
              opciones={contratistas.map((c) => [c.id, c.nombre])} />
            <MultiSelect valores={sector} onCambio={setSector}
              vacio="Todo sector" plural="sectores"
              opciones={sectores.map((x: any) => [x.id, x.nombre])} />
            <MultiSelect valores={equipo} onCambio={setEquipo}
              vacio="Todo equipo" plural="equipos"
              opciones={equipos.map((x: any) => [x.id, x.code ? `${x.code} · ${x.name}` : x.name])} />

            {hayFiltros && (
              <button
                onClick={limpiarFiltros}
                className="rounded-lg px-3 py-1.5 text-sm text-slate-500 underline hover:text-slate-900"
              >
                Limpiar
              </button>
            )}
          </div>

          {/* El rango va en su propia fila: son tres controles que se leen
              juntos como una frase —"fecha de ejecución, del 1 al 31"— y
              mezclados entre los desplegables se pierden.

              Cuál de las tres fechas se pregunta primero, porque cambia la
              respuesta: "las de agosto" da 180 por emisión y 195 por ejecución.
              El `max` y el `min` cruzados son lo que evita el rango al revés,
              que devuelve cero y no dice por qué. */}
          <div className={`${filtrosAbiertos ? "flex" : "hidden"} sm:flex flex-wrap items-center gap-2`}>
            <Select
              value={campoFecha}
              onChange={(e) => setCampoFecha(e.target.value)}
              className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm outline-none focus:border-blue-400"
            >
              {CAMPOS_DE_FECHA.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
            </Select>
            <span className="text-sm text-slate-400">del</span>
            <input
              type="date" value={desde} max={hasta || undefined}
              onChange={(e) => setDesde(e.target.value)}
              className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm outline-none focus:border-blue-400"
            />
            <span className="text-sm text-slate-400">al</span>
            <input
              type="date" value={hasta} min={desde || undefined}
              onChange={(e) => setHasta(e.target.value)}
              className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm outline-none focus:border-blue-400"
            />
            {(desde || hasta) && (
              <button
                onClick={() => { setDesde(""); setHasta(""); }}
                className="text-sm text-slate-500 underline hover:text-slate-900"
              >
                Sin fechas
              </button>
            )}

            {/* El orden va en esta fila y no entre los desplegables de arriba
                porque no es un filtro: no saca ninguna orden de la lista, las
                acomoda. Por eso tampoco cuenta para «Limpiar» ni para el cartel
                de "hay filtros puestos". */}
            <span className="ml-auto text-sm text-slate-400">ordenar por</span>
            <Select
              value={orden}
              onChange={(e) => setOrden(e.target.value)}
              className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm outline-none focus:border-blue-400"
            >
              {ORDENES_DEL_LISTADO.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
            </Select>
          </div>
        </div>
      )}

      {view === "kanban" ? (
        kanbanLoading ? (
          <div className="text-center py-12 text-slate-400 text-sm">Cargando...</div>
        ) : (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 items-start">
            {kanbanGroups.map((col) => (
              <div key={col.value}>
                <div className="flex items-center gap-2 mb-3">
                  <span className="w-2 h-2 rounded-full" style={{ background: col.dot }} />
                  <span className="text-xs font-bold text-slate-700 uppercase tracking-wide">{col.label}</span>
                  <span className="ml-auto text-xs font-mono text-slate-400">{col.count}</span>
                </div>
                <div className="space-y-2">
                  {col.count === 0 && (
                    <div className="rounded-xl border border-dashed border-slate-200 py-8 text-center text-xs text-slate-400">
                      Sin órdenes
                    </div>
                  )}
                  {col.items.map((o) => (
                    <KanbanCard key={o.id} order={o} canEdit={canEdit} onChangeEstado={changeEstado} />
                  ))}
                  {col.count > col.items.length && (
                    <div className="text-center text-xs text-slate-400 py-1">
                      +{col.count - col.items.length} más — usá la vista Lista para ver todas
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )
      ) : loading ? (
        <div className="text-center py-12 text-slate-400 text-sm">Cargando...</div>
      ) : (
        <>
          <p className="text-xs text-slate-400">{count} órdenes</p>
          {orders.length === 0 ? (
            /* Decía "con esos filtros" incluso sin ninguno puesto, que es la
               forma más rápida de convencer a alguien de que la tabla está
               vacía cuando lo que pasa es que él la filtró — o al revés. Con
               1.819 órdenes cargadas, la diferencia entre "no coincide" y "no
               hay" importa, y el botón de sacarlos es lo que hace que no haya
               que buscar cuál era. */
            <div className="rounded-xl border border-dashed border-slate-200 py-16 text-center">
              <p className="text-slate-400 text-sm">
                {hayFiltros
                  ? "Ninguna orden coincide con los filtros."
                  : canEdit
                    ? "Todavía no hay órdenes cargadas. Creá la primera con \"Nueva OT\"."
                    : "Todavía no hay órdenes cargadas."}
              </p>
              {hayFiltros && (
                <button onClick={limpiarFiltros} className="mt-2 text-sm text-slate-500 underline hover:text-slate-900">
                  Sacar los filtros
                </button>
              )}
            </div>
          ) : (
            <div className="card divide-y divide-slate-300 overflow-hidden">
              {orders.map((o) => {
                const meta   = estadoMeta(o.estado);
                const isOpen = expanded === o.id;
                return (
                  <div key={o.id}>
                    <button onClick={() => setExpanded(isOpen ? null : o.id)}
                      className="w-full px-4 py-3 flex items-center gap-3 text-left hover:bg-slate-50 transition-colors">
                      <span className="text-xs font-mono font-bold text-slate-400 w-12 shrink-0">#{o.ot_number}</span>
                      <span className="w-2 h-2 rounded-full shrink-0" style={{ background: meta.dot }} />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-slate-900 truncate">{o.descripcion ?? "—"}</p>
                        <p className="text-xs text-slate-900 truncate">{o.sector_raw}{o.equipo_raw ? ` · ${o.equipo_raw}` : ""}</p>
                      </div>
                      {/* El recuadro abre el modal de puntuar. Va dentro del
                          botón que despliega la fila, así que no puede ser otro
                          botón: es un atajo para el mouse, y con el teclado se
                          llega por el mismo botón del detalle. */}
                      {canEdit ? (
                        <span
                          onClick={(e) => { e.stopPropagation(); setPuntuando(o); }}
                          className="shrink-0 cursor-pointer rounded-md hover:ring-2 hover:ring-violet-200"
                        >
                          <PuntajeGut
                            orden={o}
                            pista={puntajeGut(o) === null ? "clic para puntuar con GUT" : "clic para cambiar el puntaje GUT"}
                          />
                        </span>
                      ) : (
                        <PuntajeGut orden={o} />
                      )}
                      <span className="shrink-0 text-xs font-semibold px-2 py-0.5 rounded-full border hidden sm:inline-flex items-center gap-1"
                        style={{ color: meta.color, background: meta.bg, borderColor: meta.color + "33" }}>
                        {meta.label}
                      </span>
                      {/* Mientras el trabajo no esté hecho, que pare el sector es
                          lo más importante de esta fila: bloquea produccion. */}
                      {o.requiere_parada_sector && o.estado !== "REALIZADO" && (
                        <span
                          title="Requiere parar el sector"
                          className="shrink-0 rounded-full border border-red-200 bg-red-50 px-1.5 py-0.5 text-[10px] font-bold text-red-600"
                        >
                          Parar sector
                        </span>
                      )}
                      {/* Se marca la que NO tiene, que es la que hay que ir a
                          buscar. La que sí tiene no lleva cartel: para leerla
                          se abre la orden, y un cartel en las cuarenta no
                          distinguiría ninguna. */}
                      {pideJustificacion(o.estado) && !justificadas.has(o.id) && (
                        <span
                          title="Sigue abierta y nadie dejó dicho por qué"
                          className="shrink-0 rounded-full border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[10px] font-bold text-amber-700"
                        >
                          Sin justificar
                        </span>
                      )}
                      {/* Las dos fechas que se miran de un vistazo: cuándo se
                          emitió la orden y cuándo se hace. La de ejecución es
                          la que más se busca —es la que contesta "¿cuándo
                          toca?"— y estaba sólo adentro del detalle, así que
                          averiguarla era abrir las órdenes de a una.
                          Van rotuladas porque dos fechas peladas, una debajo
                          de la otra, no se distinguen; el rótulo va más claro
                          para que lo que se lea sigan siendo los números, y
                          alineadas a la derecha para que los días queden en
                          columna aunque los rótulos midan distinto. */}
                      <span
                        title="Fecha de la orden y fecha de ejecución"
                        className="shrink-0 hidden md:block text-right leading-tight tabular-nums"
                      >
                        <span className="block text-xs text-slate-400 whitespace-nowrap">
                          <span className="text-slate-300">Orden</span> {fechaDeLaOT(o.fecha) ?? "—"}
                        </span>
                        <span className="block text-xs text-slate-400 whitespace-nowrap">
                          <span className="text-slate-300">Ejec.</span> {fechaDeLaOT(o.fecha_ejecucion) ?? "—"}
                        </span>
                      </span>
                      <svg className={`w-4 h-4 text-slate-300 shrink-0 transition-transform ${isOpen ? "rotate-180" : ""}`}
                        fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                      </svg>
                    </button>
                    {isOpen && (
                      <OTDetail
                        order={o}
                        canEdit={canEdit}
                        onChangeEstado={changeEstado}
                        onVerRepuestos={() => setVerRepuestos(o)}
                        onPuntuar={() => setPuntuando(o)}
                        onCambiarParada={cambiarParada}
                        onJustificacion={() => cargarJustificadas(orders)}
                      />
                    )}
                  </div>
                );
              })}
            </div>
          )}
          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-2">
              <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
                className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-40">← Anterior</button>
              <span className="text-sm text-slate-500">{page} / {totalPages}</span>
              <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}
                className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-40">Siguiente →</button>
            </div>
          )}
        </>
      )}

      {showNew && (
        <NuevaOTModal
          sectores={sectores}
          equipos={equipos}
          onClose={() => setShowNew(false)}
          onCreated={(aviso) => {
            setShowNew(false);
            // Se reusa el cartel de la sincronización: es el lugar de esta
            // pantalla donde ya se mira lo que salió a medias.
            if (aviso) setAvisoSync(aviso);
            load();
          }}
        />
      )}

      {registrando && (
        <RegistrarOTModal
          orden={registrando}
          onCerrar={() => setRegistrando(null)}
          onRegistrada={() => {
            setRegistrando(null);
            if (view === "kanban") loadKanban();
            else load();
          }}
        />
      )}

      {verRepuestos && (
        <RepuestosOTModal
          orden={verRepuestos}
          puedeEditar={canEdit}
          areas={areas}
          empresas={empresas}
          ubicaciones={ubicaciones}
          onCerrar={() => setVerRepuestos(null)}
        />
      )}

      {puntuando && (
        <PuntuarGutModal
          orden={puntuando}
          onCerrar={() => setPuntuando(null)}
          onGuardada={() => {
            setPuntuando(null);
            load();
            recargarPendientes();
          }}
        />
      )}

      {iniciando && (
        <IniciarOTModal
          orden={iniciando}
          equipoId={iniciando.equipment_id ?? null}
          estadoActual={
            equipos.find((e: any) => e.id === iniciando.equipment_id)?.status ?? null
          }
          onCerrar={() => setIniciando(null)}
          onIniciada={() => {
            setIniciando(null);
            if (view === "kanban") loadKanban();
            else load();
          }}
        />
      )}
    </div>
  );
}

/**
 * Una línea, no un aviso: dice cuántas de las pendientes no tienen GUT y deja
 * ver cuáles son para puntuarlas desde ahí.
 *
 * Vive sólo en esta pantalla a propósito. Un aviso de `lib/home/avisos.ts` va
 * a la campana y al resumen de las 8:30, y un contador de órdenes sin puntuar
 * casi no se mueve: diría lo mismo todos los días hasta que alguien lo
 * descartara para siempre. Acá la ve quien ya está mirando las órdenes, y
 * desaparece sola cuando no queda ninguna.
 */
function SugerenciaGut({ pendientes, onPuntuar }: {
  pendientes: any[] | null;
  onPuntuar: (orden: any) => void;
}) {
  const [abierta, setAbierta] = useState(false);
  if (pendientes === null) return null;

  const sinGut = pendientes.filter((o) => puntajeGut(o) === null);
  if (sinGut.length === 0) return null;

  return (
    <div className="text-xs text-slate-500">
      <p className="flex flex-wrap items-center gap-x-2">
        <span>
          {pendientes.length === 1
            ? "La única pendiente no tiene GUT"
            : `${sinGut.length} de las ${pendientes.length} pendientes ${sinGut.length === 1 ? "no tiene" : "no tienen"} GUT`}
        </span>
        <button
          onClick={() => setAbierta((v) => !v)}
          className="font-semibold text-slate-600 underline hover:text-slate-900"
        >
          {abierta ? "Ocultar" : "Puntuarlas"}
        </button>
      </p>

      {abierta && (
        <ul className="mt-2 max-h-64 divide-y divide-slate-100 overflow-y-auto card">
          {sinGut.map((o) => (
            <li key={o.id} className="flex items-center gap-3 px-3 py-2">
              <p className="min-w-0 flex-1 truncate text-sm text-slate-800">
                <span className="font-mono text-xs text-slate-400">#{o.ot_number}</span>{" "}
                {o.descripcion ?? o.equipo_raw ?? "—"}
              </p>
              <button
                onClick={() => onPuntuar(o)}
                className="shrink-0 rounded-lg border border-slate-300 px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50"
              >
                Puntuar
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function OTDetail({
  order: o, canEdit, onChangeEstado, onCambiarParada, onVerRepuestos, onPuntuar, onJustificacion,
}: {
  onVerRepuestos?: () => void;
  onPuntuar?: () => void;
  order: any;
  canEdit: boolean;
  onChangeEstado: (id: string, estado: string) => void;
  onCambiarParada: (id: string, valor: boolean) => void;
  /** Se agregó o se borró una justificación: el cartel de la fila cambió. */
  onJustificacion?: () => void;
}) {
  const ESTADO_OPTIONS = ["POR_HACER", "EN_PROCESO", "REALIZADO", "ATRASADO"];
  return (
    <div className="px-4 pb-4 pt-2 bg-slate-50 border-t border-slate-100 space-y-3">
      <div className="grid grid-cols-2 md:grid-cols-3 gap-x-6 gap-y-2">
        <D label="Especialidad"    value={o.especialidad} />
        <D label="Tipo"            value={o.tipo} />
        <D label="Quién realiza"   value={o.quien} />
        <D label="Contratista"     value={o.contratista} />
        <D label="Horas"           value={o.horas != null ? `${o.horas}h` : null} />
        <D label="Prioridad"       value={prioridadEfectiva(o)} />
        <D label="Operarios"       value={[o.operario_1, o.operario_2, o.operario_3].filter(Boolean).join(", ") || null} />
        <D label="Repuesto"        value={o.repuesto} />
        <D label="Fecha ejecución" value={fechaDeLaOT(o.fecha_ejecucion)} />
        <D label="Fecha cierre"    value={fechaDeLaOT(o.fecha_cierre)} />
        {o.app_created && <D label="Origen" value="Creada desde la app" />}
      </div>

      {/* En una pantalla táctil no hay "pasar por encima": acá las tres notas
          van escritas, con las palabras de la escala. */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <span className="flex items-center gap-2">
          <span className="text-xs text-slate-400">GUT</span>
          <PuntajeGut orden={o} />
        </span>
        {(["gravedad", "urgencia", "tendencia"] as const).map((campo) => {
          const nota: number | null = o[`gut_${campo}`] ?? null;
          if (nota == null) return null;
          return (
            <span key={campo} className="text-xs text-slate-500">
              <span className="capitalize">{campo}</span> {nota}
              {" · "}{ESCALAS_GUT[campo][nota - 1]}
            </span>
          );
        })}
        {canEdit && (
          <button
            onClick={onPuntuar}
            className="rounded-lg border border-slate-300 px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50"
          >
            {puntajeGut(o) !== null ? "Corregir puntaje" : "Puntuar"}
          </button>
        )}
      </div>

      {canEdit && (
        <label
          className="flex w-fit cursor-pointer items-center gap-2 rounded-lg border px-3 py-1.5"
          style={{
            borderColor: o.requiere_parada_sector ? "#FECACA" : "#E2E8F0",
            background: o.requiere_parada_sector ? "#FEF2F2" : "#fff",
          }}
        >
          <input
            type="checkbox"
            checked={Boolean(o.requiere_parada_sector)}
            onChange={(e) => onCambiarParada(o.id, e.target.checked)}
          />
          <span
            className="text-sm font-medium"
            style={{ color: o.requiere_parada_sector ? "#DC2626" : "#374151" }}
          >
            Este trabajo requiere parar el sector
          </span>
        </label>
      )}
      {o.descripcion && (
        <div>
          <p className="text-xs text-slate-500 font-medium mb-0.5">Descripción</p>
          <p className="text-sm text-slate-800">{o.descripcion}</p>
        </div>
      )}
      <div>
        <button
          onClick={onVerRepuestos}
          className="rounded-lg border border-slate-300 px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50"
        >
          Repuestos que hacen falta
        </button>
      </div>

      {/* Sólo en las que siguen abiertas: una realizada ya no debe ninguna
          explicación, y lo que se encontró al hacerla va en la observación de
          la ejecución, que es otra cosa. */}
      {pideJustificacion(o.estado) && (
        <JustificacionOT ordenId={o.id} puedeEditar={canEdit} onCambio={onJustificacion} />
      )}

      {canEdit && (
        <div className="flex items-center gap-2 pt-1 flex-wrap">
          <span className="text-xs text-slate-500 font-medium">Cambiar estado:</span>
          {ESTADO_OPTIONS.map((e) => {
            const m = estadoMeta(e);
            return (
              <button key={e} onClick={() => onChangeEstado(o.id, e)}
                disabled={o.estado === e}
                className="text-xs font-semibold px-2.5 py-1 rounded-full border transition-all disabled:opacity-40"
                style={{ color: m.color, background: m.bg, borderColor: m.color + "44" }}>
                {m.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function KanbanCard({ order: o, canEdit, onChangeEstado }: {
  order: any; canEdit: boolean; onChangeEstado: (id: string, estado: string) => void;
}) {
  const [menu, setMenu] = useState(false);
  const NEXT: Record<string, string[]> = {
    POR_HACER:  ["EN_PROCESO", "ATRASADO"],
    EN_PROCESO: ["REALIZADO", "ATRASADO"],
    ATRASADO:   ["EN_PROCESO", "REALIZADO"],
    REALIZADO:  ["EN_PROCESO"],
  };
  const nextOptions = NEXT[o.estado] ?? [];

  return (
    <div className="card p-3 space-y-2 relative">
      <div className="flex items-start justify-between gap-1">
        <span className="text-xs font-mono text-slate-400">#{o.ot_number}</span>
        {canEdit && nextOptions.length > 0 && (
          <div className="relative">
            <button onClick={() => setMenu(m => !m)}
              className="p-1 rounded hover:bg-slate-100 text-slate-400">
              <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
                <path d="M6 10a2 2 0 11-4 0 2 2 0 014 0zM12 10a2 2 0 11-4 0 2 2 0 014 0zM16 12a2 2 0 100-4 2 2 0 000 4z" />
              </svg>
            </button>
            {menu && (
              <div className="absolute right-0 top-6 z-10 bg-white rounded-xl border border-slate-200 shadow-lg py-1 min-w-[130px]">
                {nextOptions.map(e => {
                  const m = estadoMeta(e);
                  return (
                    <button key={e} onClick={() => { onChangeEstado(o.id, e); setMenu(false); }}
                      className="w-full text-left px-3 py-1.5 text-xs font-medium hover:bg-slate-50 flex items-center gap-2"
                      style={{ color: m.color }}>
                      <span className="w-1.5 h-1.5 rounded-full" style={{ background: m.dot }} />
                      {m.label}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
      <p className="text-xs font-medium text-slate-800 leading-snug line-clamp-3">{o.descripcion ?? "—"}</p>
      <p className="text-xs text-slate-400 truncate">{o.equipo_raw ?? o.sector_raw ?? "—"}</p>
      {/* Cada columna son las 50 de más puntaje GUT y no las 50 más nuevas:
          sin el recuadro, el orden de las tarjetas no tendría explicación. */}
      <div className="flex items-center justify-between gap-2">
        {o.fecha ? <p className="text-xs text-slate-300">{fechaDeLaOT(o.fecha)}</p> : <span />}
        <PuntajeGut orden={o} />
      </div>
    </div>
  );
}

function D({ label, value }: { label: string; value?: string | null }) {
  if (!value) return null;
  return (
    <div>
      <p className="text-xs text-slate-400">{label}</p>
      <p className="text-sm text-slate-700">{value}</p>
    </div>
  );
}
