"use client";

import { useState, useCallback, useEffect, useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { ESPECIALIDADES } from "@/lib/mantenimiento/ordenes";
import MultiSelect from "@/components/MultiSelect";
import type { UbicacionEnlazada } from "@/lib/compras/ubicaciones";
import {
  leerFiltrosDeLaUrl, escribirFiltrosEnLaUrl, consultaDeLaRuta, hayAlgunFiltro,
  FILTROS_VACIOS, TIPOS_DE_OT, QUIENES_DE_OT, PRIORIDADES_DE_OT, CAMPOS_DE_FECHA,
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
import OrdenarTrabajo from "./OrdenarTrabajo";
import { useConfirm } from "@/components/ConfirmProvider";
import InfoTip from "@/components/InfoTip";
import { useCargar } from "@/lib/core/useCargar";

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
   * Al volver con el botón de atrás desde una orden, el árbol que restaura Next
   * es el que se renderizó al entrar —con la URL vieja—, así que `params`
   * llegaría sin filtros aunque la barra de direcciones los tenga. Por eso,
   * cuando hay navegador, la fuente es la URL de verdad. Es la misma nota que
   * dejó el listado de requerimientos.
   */
  const laUrlDeVerdad = () =>
    new URLSearchParams(
      typeof window === "undefined" ? params.toString() : window.location.search
    );
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
  const [sinProveedor, setSinProveedor] = useState<string[]>([]);
  const [verRepuestos, setVerRepuestos] = useState<any | null>(null);

  const filtros: FiltrosOt = useMemo(() => ({
    busqueda: busquedaAplicada, campoFecha, desde, hasta,
    estado, especialidad, tipo, quien, prioridad, proveedor, sector, equipo,
  }), [busquedaAplicada, campoFecha, desde, hasta,
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

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch(`/api/mantenimiento/ordenes?${consultaDeLaRuta(filtros, page)}`);
    const json = await res.json();
    setOrders(json.data ?? []);
    setCount(json.count ?? 0);
    setLoading(false);
  }, [page, filtros]);

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
  async function cambiarParada(id: string, valor: boolean) {
    await fetch("/api/mantenimiento/ordenes", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, requiere_parada_sector: valor }),
    });
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
    await fetch("/api/mantenimiento/ordenes", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, estado }),
    });
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
          <h1 className="text-xl font-bold text-gray-900 flex items-center gap-2">
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
              className="rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50">
              {sincronizando ? "Trayendo…" : "Traer de la planilla"}
            </button>
          )}
          {canEdit && (
            <button onClick={() => setShowNew(true)}
              className="flex items-center gap-2 rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700 transition-colors">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              Nueva OT
            </button>
          )}
          <div className="flex rounded-lg border border-gray-200 overflow-hidden">
            <button onClick={() => setView("list")}
              className={`px-3 py-2 text-xs font-medium transition-colors ${view === "list" ? "bg-gray-900 text-white" : "bg-white text-gray-500 hover:bg-gray-50"}`}>
              Lista
            </button>
            <button onClick={() => setView("kanban")}
              className={`px-3 py-2 text-xs font-medium transition-colors ${view === "kanban" ? "bg-gray-900 text-white" : "bg-white text-gray-500 hover:bg-gray-50"}`}>
              Kanban
            </button>
            <button onClick={() => setView("orden")}
              title="En qué orden hacer lo que está pendiente"
              className={`px-3 py-2 text-xs font-medium transition-colors ${view === "orden" ? "bg-gray-900 text-white" : "bg-white text-gray-500 hover:bg-gray-50"}`}>
              Qué hacer primero
            </button>
          </div>
        </div>
      </div>

      {avisoSync && (
        <div className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-700">
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
              className="w-full sm:w-60 sm:ml-auto rounded-lg border border-gray-200 px-3 py-1.5 text-sm outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-100" />

            {/* En teléfono el resto arranca cerrado: siete desplegables más
                empujarían la tabla fuera de la pantalla. */}
            <button
              onClick={() => setFiltrosAbiertos((v) => !v)}
              className="sm:hidden rounded-lg border border-gray-200 px-3 py-1.5 text-sm text-gray-600"
            >
              {filtrosAbiertos ? "Menos filtros" : "Más filtros"}
            </button>
          </div>

          <div className={`${filtrosAbiertos ? "grid" : "hidden"} sm:flex grid-cols-2 gap-2 sm:flex-wrap`}>
            <MultiSelect valores={especialidad} onCambio={setEspecialidad}
              vacio="Toda especialidad" plural="especialidades"
              opciones={ESPECIALIDADES.map((e) => [e, e])} />
            <MultiSelect valores={tipo} onCambio={setTipo}
              vacio="Programado y correctivo" plural="tipos"
              opciones={TIPOS_DE_OT.map((t) => [t, t === "PROGRAMADO" ? "Programado" : "Correctivo"])} />
            <MultiSelect valores={quien} onCambio={setQuien}
              vacio="Interno y contratado" plural="formas"
              opciones={QUIENES_DE_OT.map((q) => [q, q === "INTERNO" ? "Interno" : "Contratado"])} />
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
                className="rounded-lg px-3 py-1.5 text-sm text-gray-500 underline hover:text-gray-900"
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
            <select
              value={campoFecha}
              onChange={(e) => setCampoFecha(e.target.value)}
              className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm outline-none focus:border-blue-400"
            >
              {CAMPOS_DE_FECHA.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
            </select>
            <span className="text-sm text-gray-400">del</span>
            <input
              type="date" value={desde} max={hasta || undefined}
              onChange={(e) => setDesde(e.target.value)}
              className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm outline-none focus:border-blue-400"
            />
            <span className="text-sm text-gray-400">al</span>
            <input
              type="date" value={hasta} min={desde || undefined}
              onChange={(e) => setHasta(e.target.value)}
              className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm outline-none focus:border-blue-400"
            />
            {(desde || hasta) && (
              <button
                onClick={() => { setDesde(""); setHasta(""); }}
                className="text-sm text-gray-500 underline hover:text-gray-900"
              >
                Sin fechas
              </button>
            )}
          </div>
        </div>
      )}

      {view === "kanban" ? (
        kanbanLoading ? (
          <div className="text-center py-12 text-gray-400 text-sm">Cargando...</div>
        ) : (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 items-start">
            {kanbanGroups.map((col) => (
              <div key={col.value}>
                <div className="flex items-center gap-2 mb-3">
                  <span className="w-2 h-2 rounded-full" style={{ background: col.dot }} />
                  <span className="text-xs font-bold text-gray-700 uppercase tracking-wide">{col.label}</span>
                  <span className="ml-auto text-xs font-mono text-gray-400">{col.count}</span>
                </div>
                <div className="space-y-2">
                  {col.count === 0 && (
                    <div className="rounded-xl border border-dashed border-gray-200 py-8 text-center text-xs text-gray-400">
                      Sin órdenes
                    </div>
                  )}
                  {col.items.map((o) => (
                    <KanbanCard key={o.id} order={o} canEdit={canEdit} onChangeEstado={changeEstado} />
                  ))}
                  {col.count > col.items.length && (
                    <div className="text-center text-xs text-gray-400 py-1">
                      +{col.count - col.items.length} más — usá la vista Lista para ver todas
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )
      ) : loading ? (
        <div className="text-center py-12 text-gray-400 text-sm">Cargando...</div>
      ) : (
        <>
          <p className="text-xs text-gray-400">{count} órdenes</p>
          {orders.length === 0 ? (
            /* Decía "con esos filtros" incluso sin ninguno puesto, que es la
               forma más rápida de convencer a alguien de que la tabla está
               vacía cuando lo que pasa es que él la filtró — o al revés. Con
               1.819 órdenes cargadas, la diferencia entre "no coincide" y "no
               hay" importa, y el botón de sacarlos es lo que hace que no haya
               que buscar cuál era. */
            <div className="rounded-xl border border-dashed border-gray-200 py-16 text-center">
              <p className="text-gray-400 text-sm">
                {hayFiltros
                  ? "Ninguna orden coincide con los filtros."
                  : canEdit
                    ? "Todavía no hay órdenes cargadas. Creá la primera con \"Nueva OT\"."
                    : "Todavía no hay órdenes cargadas."}
              </p>
              {hayFiltros && (
                <button onClick={limpiarFiltros} className="mt-2 text-sm text-gray-500 underline hover:text-gray-900">
                  Sacar los filtros
                </button>
              )}
            </div>
          ) : (
            <div className="rounded-xl border border-gray-200 bg-white divide-y divide-gray-100 overflow-hidden">
              {orders.map((o) => {
                const meta   = estadoMeta(o.estado);
                const isOpen = expanded === o.id;
                return (
                  <div key={o.id}>
                    <button onClick={() => setExpanded(isOpen ? null : o.id)}
                      className="w-full px-4 py-3 flex items-center gap-3 text-left hover:bg-gray-50 transition-colors">
                      <span className="text-xs font-mono font-bold text-gray-400 w-12 shrink-0">#{o.ot_number}</span>
                      <span className="w-2 h-2 rounded-full shrink-0" style={{ background: meta.dot }} />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-900 truncate">{o.descripcion ?? "—"}</p>
                        <p className="text-xs text-gray-400 truncate">{o.sector_raw}{o.equipo_raw ? ` · ${o.equipo_raw}` : ""}</p>
                      </div>
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
                      <span className="text-xs text-gray-400 shrink-0 hidden md:block">
                        {o.fecha ? new Date(o.fecha).toLocaleDateString("es-AR") : "—"}
                      </span>
                      <svg className={`w-4 h-4 text-gray-300 shrink-0 transition-transform ${isOpen ? "rotate-180" : ""}`}
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
                        onCambiarParada={cambiarParada}
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
                className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50 disabled:opacity-40">← Anterior</button>
              <span className="text-sm text-gray-500">{page} / {totalPages}</span>
              <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}
                className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50 disabled:opacity-40">Siguiente →</button>
            </div>
          )}
        </>
      )}

      {showNew && (
        <NuevaOTModal
          sectores={sectores}
          equipos={equipos}
          onClose={() => setShowNew(false)}
          onCreated={() => { setShowNew(false); load(); }}
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

function OTDetail({ order: o, canEdit, onChangeEstado, onCambiarParada, onVerRepuestos }: {
  onVerRepuestos?: () => void;
  order: any;
  canEdit: boolean;
  onChangeEstado: (id: string, estado: string) => void;
  onCambiarParada: (id: string, valor: boolean) => void;
}) {
  const ESTADO_OPTIONS = ["POR_HACER", "EN_PROCESO", "REALIZADO", "ATRASADO"];
  return (
    <div className="px-4 pb-4 pt-2 bg-gray-50 border-t border-gray-100 space-y-3">
      <div className="grid grid-cols-2 md:grid-cols-3 gap-x-6 gap-y-2">
        <D label="Especialidad"    value={o.especialidad} />
        <D label="Tipo"            value={o.tipo} />
        <D label="Quién realiza"   value={o.quien} />
        <D label="Contratista"     value={o.contratista} />
        <D label="Horas"           value={o.horas != null ? `${o.horas}h` : null} />
        <D label="Prioridad"       value={o.prioridad} />
        <D label="Operarios"       value={[o.operario_1, o.operario_2, o.operario_3].filter(Boolean).join(", ") || null} />
        <D label="Repuesto"        value={o.repuesto} />
        <D label="Fecha ejecución" value={o.fecha_ejecucion ? new Date(o.fecha_ejecucion).toLocaleDateString("es-AR") : null} />
        <D label="Fecha cierre"    value={o.fecha_cierre   ? new Date(o.fecha_cierre).toLocaleDateString("es-AR")   : null} />
        {o.app_created && <D label="Origen" value="Creada desde la app" />}
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
          <p className="text-xs text-gray-500 font-medium mb-0.5">Descripción</p>
          <p className="text-sm text-gray-800">{o.descripcion}</p>
        </div>
      )}
      <div>
        <button
          onClick={onVerRepuestos}
          className="rounded-lg border border-gray-300 px-2.5 py-1 text-xs font-semibold text-gray-700 hover:bg-gray-50"
        >
          Repuestos que hacen falta
        </button>
      </div>

      {canEdit && (
        <div className="flex items-center gap-2 pt-1 flex-wrap">
          <span className="text-xs text-gray-500 font-medium">Cambiar estado:</span>
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
    <div className="rounded-xl border border-gray-200 bg-white p-3 shadow-sm space-y-2 relative">
      <div className="flex items-start justify-between gap-1">
        <span className="text-xs font-mono text-gray-400">#{o.ot_number}</span>
        {canEdit && nextOptions.length > 0 && (
          <div className="relative">
            <button onClick={() => setMenu(m => !m)}
              className="p-1 rounded hover:bg-gray-100 text-gray-400">
              <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
                <path d="M6 10a2 2 0 11-4 0 2 2 0 014 0zM12 10a2 2 0 11-4 0 2 2 0 014 0zM16 12a2 2 0 100-4 2 2 0 000 4z" />
              </svg>
            </button>
            {menu && (
              <div className="absolute right-0 top-6 z-10 bg-white rounded-xl border border-gray-200 shadow-lg py-1 min-w-[130px]">
                {nextOptions.map(e => {
                  const m = estadoMeta(e);
                  return (
                    <button key={e} onClick={() => { onChangeEstado(o.id, e); setMenu(false); }}
                      className="w-full text-left px-3 py-1.5 text-xs font-medium hover:bg-gray-50 flex items-center gap-2"
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
      <p className="text-xs font-medium text-gray-800 leading-snug line-clamp-3">{o.descripcion ?? "—"}</p>
      <p className="text-xs text-gray-400 truncate">{o.equipo_raw ?? o.sector_raw ?? "—"}</p>
      {o.fecha && <p className="text-xs text-gray-300">{new Date(o.fecha).toLocaleDateString("es-AR")}</p>}
    </div>
  );
}

function D({ label, value }: { label: string; value?: string | null }) {
  if (!value) return null;
  return (
    <div>
      <p className="text-xs text-gray-400">{label}</p>
      <p className="text-sm text-gray-700">{value}</p>
    </div>
  );
}
