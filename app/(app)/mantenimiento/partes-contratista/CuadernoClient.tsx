"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Select from "@/components/Select";
import { useConfirm } from "@/components/ConfirmProvider";
import { createClient } from "@/lib/supabase/client";
import { useCargar } from "@/lib/core/useCargar";
import {
  enOrdenes, pendientesDeOrdenes, propuestaDeGrupos, sePuedenJuntar, sePuedeSeparar, totalesDeRenglones,
  type RenglonDelCuaderno,
} from "@/lib/mantenimiento/cuadernoGrupos";
import type { DiaRepetido } from "@/lib/mantenimiento/cuadernoRepetidos";
import {
  costoParaElCampo, horasParaElCampo, leerNumeroDelCampo,
} from "@/lib/mantenimiento/cuadernoNumero";
import type { SectorDePlanta } from "@/lib/mantenimiento/sectores";
import type { EquipoBasico } from "./PartesContratistaClient";
import { esRutaDeExcel } from "@/lib/mantenimiento/cuadernoOrigen";
import { reducirFoto } from "./reducirFoto";

/**
 * La pantalla del cuaderno de un contratista que lo lleva (hoy PIPARO).
 *
 * **Chequear es comparar contra la hoja**, por eso la foto va fija al lado y no
 * detrás de un click. El modelo leyó la letra, el catálogo enganchó sector y
 * equipo, y acá una persona mira cada renglón contra el papel y lo corrige
 * antes de que salga una sola OT.
 *
 * Cuatro decisiones que no se deducen del código:
 *
 * - **No inventa sectores.** Un renglón sin sector va en rojo con el
 *   desplegable vacío hasta que alguien elija. El rojo es «no le reconocí el
 *   sector», no «está mal». Lo único que se marca distinto es el sector que el
 *   sistema **dedujo del equipo** (`sector_propuesto`): se ve como propuesta y
 *   pide confirmarse con un clic, porque es una deducción del catálogo y no
 *   algo que el papel diga.
 * - **No resalta la escritura sobre la foto.** Para eso el modelo tendría que
 *   devolver coordenadas, y sobre manuscrito son poco confiables: una caja que
 *   señala el renglón equivocado es peor que no tener caja, porque confirma lo
 *   que no pasó. Al pararse en un renglón la pantalla dice de qué página y de
 *   qué línea salió, y resalta el texto transcripto.
 * - **Primero se junta, después se confirma.** Un renglón con sector confirmado
 *   sale como su propia OT y deja de ser candidato a juntarse; las «Tranqueras
 *   D6» que se confirmen una por una antes de juntarlas dan tres OT donde se
 *   esperaba una. Es la regla del negocio y es contraintuitiva, así que la
 *   pantalla la dice y frena el click que la rompe.
 * - **La foto se achica en el navegador** antes de subirla (ver `reducirFoto`):
 *   Vercel rechaza los cuerpos de más de 4,5 MB antes de llegar a la ruta.
 * - **Un mes puede entrar por Excel en vez de por fotos**, y es una alternativa
 *   y no otro modo: los renglones quedan iguales y todo lo de abajo —juntar,
 *   separar, confirmar el sector, el freno de duplicados, generar— no se entera.
 *   Lo que cambia acá es sólo lo que no tiene sentido: **no hay hoja contra la
 *   cual comparar**, porque la transcripción la escribió la misma persona que
 *   carga, así que en vez de la foto va lo que salió del archivo. Y **los grupos
 *   ya vienen armados** desde las fórmulas del resumen. Que una carga sea de
 *   Excel no lo dice ninguna columna: lo dice la extensión de la ruta
 *   (`esRutaDeExcel`), y el porqué está en `cuadernoOrigen.ts`.
 *
 * Todo lo que escribe pasa por las rutas de `/api/mantenimiento/cuaderno`. Un
 * fallo se muestra **con lo que dijo quien falló**, sin traducir.
 */

// ── Tipos ───────────────────────────────────────────────────

export interface FotoDeCarga {
  id: string; orden: number; ruta: string; fallo: string | null;
}
export interface CargaResumen {
  id: string; proveedor_id: string; estado: string; created_at: string;
  mant_cuadernos_fotos: FotoDeCarga[] | null;
}

type Renglon = RenglonDelCuaderno;

interface CargaAbierta {
  id: string;
  fotos: FotoDeCarga[];
  renglones: Renglon[];
}

type Cuerpo<T> = T & { error?: string };

interface ItemDeCola {
  clave: string;
  nombre: string;
  orden: number;
  estado: "esperando" | "achicando" | "leyendo" | "leida" | "fallo";
  foto_id?: string;
  renglones?: number;
  /** Cuántos grupos trajo armados el resumen del Excel. */
  grupos?: number;
  /** Es la planilla y no una página: no tiene número ni se reintenta sola. */
  esPlanilla?: boolean;
  /** Lo que dijo quien falló, o lo que el modelo no pudo leer. */
  mensaje?: string;
  /** La página ya existe en la carga (tiene fila y archivo en el bucket). */
  enElBucket?: boolean;
}

/** Una orden de la vista previa que arma el servidor: la misma cuenta que la generación. */
interface OrdenDelPlan {
  clave: string;
  accion: "crear" | "sumar" | "denunciar";
  /** Va en esta corrida; el resto queda para apretar de nuevo. */
  entra: boolean;
  tarea: string;
  horas: number;
  costo: number | null;
  /** Lo que va a quedar en `REPUESTO UTILIZADO`: el mismo texto que se escribe. */
  repuesto: string | null;
  /** El N° de la OT a la que suma (`accion` «sumar»); null en las demás. */
  ot_existente: number | null;
}

interface ResumenGenerado { ot_number: number; tarea: string; sector: string; horas: number; costo: number | null }

/** Lo que devolvió la última generación, para dejarlo a la vista. */
interface ResultadoDeGenerar {
  creadas: ResumenGenerado[];
  actualizadas: ResumenGenerado[];
  problemas: string[];
  quedaron: number;
}

type IdDeFiltro = "todos" | "sin_sector" | "por_confirmar" | "con_costo" | "dudosos" | "juntados";

const NUEVA = "nueva";

// ── Lo chico ────────────────────────────────────────────────

/** "2026-09-17" → "17/9". */
function enDiaMes(fecha: string | null | undefined): string {
  const [, mes, dia] = String(fecha ?? "").split("-");
  return mes && dia ? `${Number(dia)}/${Number(mes)}` : "sin fecha";
}

function rangoDeFechas(fechas: (string | null)[]): string {
  const f = fechas.filter((x): x is string => !!x).sort();
  if (f.length === 0) return "sin fecha";
  return f[0] === f[f.length - 1] ? `el ${enDiaMes(f[0])}` : `del ${enDiaMes(f[0])} al ${enDiaMes(f[f.length - 1])}`;
}

const redondear = (n: number) => Math.round(n * 100) / 100;
const verHoras = (n: number) => String(redondear(n)).replace(".", ",");

/**
 * Lo que quedaría si se juntan estos renglones: «Tranqueras D6 · 16 h · del
 * 17/9 al 23/9». Es la vista previa de abajo y la del botón: tiene que ser lo
 * que después sale en la OT.
 *
 * **No hace la cuenta: la pide.** `totalesDeRenglones` es la misma función con
 * la que `enOrdenes` arma la orden que sale; una copia acá sería la única
 * cuenta paralela del cuaderno, y el día que difiriera la pantalla prometería
 * «16 h» y la OT saldría con otro número.
 */
function vistaPrevia(rs: readonly Renglon[]): string {
  const t = totalesDeRenglones(rs);
  return [
    t.tareas[0] + (t.tareas.length > 1 ? ` (+${t.tareas.length - 1} más)` : ""),
    `${verHoras(t.horas)} h`,
    rangoDeFechas([t.desde, t.hasta]),
    ...(t.costo !== null ? [`$${costoParaElCampo(t.costo)}`] : []),
  ].join(" · ");
}

/** Los mensajes de plataforma no son JSON: se dicen igual, con su código. */
async function leerJson<T>(res: Response): Promise<Cuerpo<T>> {
  const texto = await res.text();
  try {
    return JSON.parse(texto) as Cuerpo<T>;
  } catch {
    return { error: `Respuesta del servidor (HTTP ${res.status}): ${texto.slice(0, 300) || "vacía"}` } as Cuerpo<T>;
  }
}

const JSON_HEADERS = { "Content-Type": "application/json" };

const fechaDeCarga = (iso: string) =>
  new Intl.DateTimeFormat("es-AR", { timeZone: "America/Argentina/Buenos_Aires" }).format(new Date(iso));

/** Por defecto el mes que se está cerrando: hasta el 10 es el anterior. */
function mesPorDefecto(): string {
  const hoy = new Date();
  const d = new Date(hoy.getFullYear(), hoy.getMonth() - (hoy.getDate() <= 10 ? 1 : 0), 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/** El mes que más aparece en las fechas leídas, para no preguntar lo que ya se sabe. */
function mesDeLosRenglones(rs: readonly Renglon[]): string | null {
  const cuenta = new Map<string, number>();
  for (const r of rs) {
    const m = r.fecha?.slice(0, 7);
    if (m) cuenta.set(m, (cuenta.get(m) ?? 0) + 1);
  }
  let mejor: string | null = null;
  for (const [m, n] of cuenta) if (mejor === null || n > (cuenta.get(mejor) ?? 0)) mejor = m;
  return mejor;
}

const CLASE_CAMPO =
  "w-full rounded border border-slate-300 bg-white px-2 py-1.5 text-sm disabled:bg-slate-100 disabled:text-slate-500";

// ── La pantalla ─────────────────────────────────────────────

export default function CuadernoClient({
  proveedor, puedeEditar, sectores, equipos, cargas: cargasIniciales,
}: {
  proveedor: { id: string; nombre: string };
  puedeEditar: boolean;
  sectores: SectorDePlanta[];
  equipos: EquipoBasico[];
  /** `null` cuando la consulta falló: lo normal es que falte la migración. */
  cargas: CargaResumen[] | null;
}) {
  const confirm = useConfirm();

  const [cargas, setCargas] = useState<CargaResumen[]>(
    () => (cargasIniciales ?? [])
      .filter((c) => c.proveedor_id === proveedor.id)
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
  );
  const [cargaId, setCargaId] = useState<string>(() => {
    const primera = (cargasIniciales ?? [])
      .filter((c) => c.proveedor_id === proveedor.id)
      .sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
    return primera?.id ?? NUEVA;
  });
  const [carga, setCarga] = useState<CargaAbierta | null>(null);
  const [cargandoCarga, setCargandoCarga] = useState(false);
  const [errorDeCarga, setErrorDeCarga] = useState("");

  const [error, setError] = useState("");
  const [aviso, setAviso] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [resultado, setResultado] = useState<ResultadoDeGenerar | null>(null);

  const [filtro, setFiltro] = useState<IdDeFiltro>("todos");
  /** "" todos · "sin" los que no tienen sector · si no, el id del sector. */
  const [sectorFiltrado, setSectorFiltrado] = useState<string>("");
  const [seleccion, setSeleccion] = useState<ReadonlySet<string>>(new Set());
  const [renglonActivo, setRenglonActivo] = useState<string | null>(null);
  const [fotoElegida, setFotoElegida] = useState<string | null>(null);

  // La subida
  const [mesElegido, setMesElegido] = useState<string | null>(null);
  const [elegidas, setElegidas] = useState<File[]>([]);
  const [claveDelInput, setClaveDelInput] = useState(0);
  const [cola, setCola] = useState<ItemDeCola[]>([]);
  const [leyendo, setLeyendo] = useState(false);
  const achicadas = useRef(new Map<string, File>());
  /**
   * Las fotos tal como las eligió la persona, por clave. Reintentar una que
   * falló **al achicar** necesita el original: sin él el reintento mandaría una
   * subida sin archivo, que la ruta entiende como «releé lo que ya está en el
   * bucket», y esa foto nunca llegó a subirse.
   */
  const originalesElegidos = useRef(new Map<string, File>());
  const [repetidos, setRepetidos] = useState<{ cargaId: string; fotoIds: string[]; dias: DiaRepetido[] } | null>(null);

  // Las fotos firmadas
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [errorDeFoto, setErrorDeFoto] = useState("");
  const [ampliada, setAmpliada] = useState(false);

  // ── Cargar la carga abierta ───────────────────────────────
  const recargar = useCargar(async (vigente) => {
    if (cargaId === NUEVA) { setCarga(null); setErrorDeCarga(""); return; }
    setCargandoCarga(true);
    setErrorDeCarga("");
    let cuerpo: Cuerpo<{ data?: Record<string, unknown> }>;
    try {
      const res = await fetch(`/api/mantenimiento/cuaderno?id=${encodeURIComponent(cargaId)}`);
      cuerpo = await leerJson(res);
      if (!res.ok && !cuerpo.error) cuerpo.error = `HTTP ${res.status}`;
    } catch (e) {
      cuerpo = { error: e instanceof Error ? e.message : String(e) };
    }
    if (!vigente()) return;
    setCargandoCarga(false);
    if (cuerpo.error || !cuerpo.data) {
      setErrorDeCarga(cuerpo.error ?? "La carga no llegó.");
      return;
    }
    const d = cuerpo.data as {
      id: string; estado?: string; mant_cuadernos_fotos?: FotoDeCarga[]; renglones?: Renglon[];
    };
    // El estado de la lista se vuelve a leer con la carga: la generación lo
    // mueve, y la lista se trajo una sola vez al abrir la pantalla.
    const estado = d.estado;
    if (estado) setCargas((cs) => cs.map((c) => (c.id === d.id && c.estado !== estado ? { ...c, estado } : c)));
    setCarga({
      id: d.id,
      fotos: [...(d.mant_cuadernos_fotos ?? [])].sort((a, b) => a.orden - b.orden),
      // `cuaderno_id` se inyecta siempre, venga o no en la consulta: la
      // propuesta de juntar agrupa por él, y un `undefined` borraría el corte
      // entre cargas sin que nadie lo viera.
      renglones: (d.renglones ?? []).map((r) => ({ ...r, cuaderno_id: d.id })),
    });
  }, [cargaId]);

  const abierta = carga && carga.id === cargaId ? carga : null;
  const fotos = useMemo(() => abierta?.fotos ?? [], [abierta]);

  /**
   * La planilla de esta carga, si entró por Excel. **No hay columna que lo
   * diga**: lo dice la extensión de la ruta, y es a propósito (el porqué está en
   * `cuadernoOrigen.ts`). La ruta no deja mezclar fotos y planilla en una misma
   * carga, así que con que haya una alcanza.
   */
  const planilla = useMemo(() => fotos.find((f) => esRutaDeExcel(f.ruta)) ?? null, [fotos]);
  const deExcel = planilla !== null;
  const renglones = useMemo(() => abierta?.renglones ?? [], [abierta]);

  /** Cuántas órdenes saldrían de varios renglones juntados. */
  const gruposArmados = useMemo(
    () => new Set(renglones.filter((r) => r.grupo_id).map((r) => r.grupo_id)).size,
    [renglones]
  );

  function tocarRenglones(f: (rs: Renglon[]) => Renglon[]) {
    setCarga((c) => (c ? { ...c, renglones: f(c.renglones) } : c));
  }

  // ── Firmar las fotos ──────────────────────────────────────
  // El bucket es privado: el link se firma al pedirlo, con la sesión de quien
  // mira (la policy deja leer a quien ve Mantenimiento).
  const clavesDeFotos = fotos.map((f) => `${f.id}:${f.ruta}`).join("|");
  useCargar(async (vigente) => {
    if (fotos.length === 0) { setUrls({}); return; }
    const { data, error: e } = await createClient()
      .storage.from("cuaderno-contratista")
      .createSignedUrls(fotos.map((f) => f.ruta), 60 * 60 * 4);
    if (!vigente()) return;
    if (e || !data) {
      setErrorDeFoto(`No se pudieron mostrar las fotos: ${e?.message ?? "sin respuesta"}`);
      return;
    }
    setErrorDeFoto("");
    const mapa: Record<string, string> = {};
    data.forEach((d, i) => { if (d.signedUrl) mapa[fotos[i].id] = d.signedUrl; });
    setUrls(mapa);
  }, [clavesDeFotos]);

  // Escape cierra la foto ampliada.
  useEffect(() => {
    if (!ampliada) return;
    const alTeclear = (e: KeyboardEvent) => { if (e.key === "Escape") setAmpliada(false); };
    document.addEventListener("keydown", alTeclear);
    return () => document.removeEventListener("keydown", alTeclear);
  }, [ampliada]);

  // ── Catálogos para los desplegables ───────────────────────
  const nombreDeSector = useMemo(() => new Map(sectores.map((s) => [s.id, s.nombre])), [sectores]);
  const equipoPorId = useMemo(() => new Map(equipos.map((e) => [e.id, e])), [equipos]);

  // Las opciones se arman una vez: el desplegable lee sus `<option>` de los
  // hijos, y con 118 renglones por 269 equipos, rearmarlas en cada render es
  // trabajo que se nota.
  const opcionesDeSector = useMemo<ReactNode>(() => [
    <option key="" value="">— sin sector —</option>,
    ...sectores.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>),
  ], [sectores]);

  const etiquetaDeEquipo = (e: EquipoBasico) => (e.code ? `${e.code} · ${e.name}` : e.name);

  const opcionesDeEquipo = useMemo(() => {
    const vacia = <option key="" value="">— sin equipo —</option>;
    const todos: ReactNode = [vacia, ...equipos.map((e) => <option key={e.id} value={e.id}>{etiquetaDeEquipo(e)}</option>)];
    const porSector = new Map<string, EquipoBasico[]>();
    for (const e of equipos) {
      if (!e.sector_id) continue;
      const l = porSector.get(e.sector_id) ?? [];
      l.push(e);
      porSector.set(e.sector_id, l);
    }
    const delSector = new Map<string, ReactNode>();
    for (const [id, lista] of porSector) {
      delSector.set(id, [vacia, ...lista.map((e) => <option key={e.id} value={e.id}>{etiquetaDeEquipo(e)}</option>)]);
    }
    return { todos, delSector };
  }, [equipos]);

  // ── La propuesta de juntar, y los filtros ─────────────────
  const propuestas = useMemo(() => {
    const porId = new Map(renglones.map((r) => [r.id, r]));
    return [...propuestaDeGrupos(renglones)].map(([clave, ids]) => {
      const rs = ids.map((i) => porId.get(i)).filter((r): r is Renglon => !!r);
      return { clave, ids, texto: vistaPrevia(rs) };
    }).sort((a, b) => a.texto.localeCompare(b.texto));
  }, [renglones]);

  const enPropuesta = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of propuestas) for (const id of p.ids) m.set(id, p.ids.length);
    return m;
  }, [propuestas]);

  const filtros: { id: IdDeFiltro; etiqueta: string; pasa: (r: Renglon) => boolean }[] = [
    { id: "todos", etiqueta: "Todos", pasa: () => true },
    { id: "sin_sector", etiqueta: "Sin sector", pasa: (r) => !r.sector_id },
    { id: "por_confirmar", etiqueta: "Por confirmar", pasa: (r) => !!r.sector_id && r.sector_propuesto },
    { id: "con_costo", etiqueta: "Con costo", pasa: (r) => Number(r.costo) > 0 },
    { id: "dudosos", etiqueta: "Dudosos", pasa: (r) => !!r.dudoso },
    { id: "juntados", etiqueta: "Ya juntados", pasa: (r) => !!r.grupo_id },
  ];
  const filtroActual = filtros.find((f) => f.id === filtro) ?? filtros[0];
  /**
   * Los sectores que de verdad hay en esta carga, con cuántos renglones cada
   * uno. Son los de la carga y no los 60 y pico de la planta: filtrar sirve
   * para juntar lo que está acá, y una lista con 50 opciones vacías es ruido.
   */
  const sectoresDeLaCarga = useMemo(() => {
    const cuenta = new Map<string, number>();
    for (const r of renglones) if (r.sector_id) cuenta.set(r.sector_id, (cuenta.get(r.sector_id) ?? 0) + 1);
    return [...cuenta]
      .map(([id, n]) => ({ id, nombre: nombreDeSector.get(id) ?? "(sector que ya no está)", n }))
      .sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
  }, [renglones, nombreDeSector]);

  const sinSector = renglones.filter((r) => !r.sector_id).length;

  const pasaElSector = (r: Renglon) =>
    sectorFiltrado === "" ? true : sectorFiltrado === "sin" ? !r.sector_id : r.sector_id === sectorFiltrado;

  const visibles = renglones.filter(filtroActual.pasa).filter(pasaElSector);

  /** Los que se ven y todavía se pueden juntar: los que ya son OT no entran. */
  const elegiblesALaVista = visibles.filter((r) => !r.orden_trabajo_id);

  const fotoDe = useMemo(() => new Map(fotos.map((f) => [f.id, f])), [fotos]);
  const renglonesPorFoto = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of renglones) if (r.foto_id) m.set(r.foto_id, (m.get(r.foto_id) ?? 0) + 1);
    return m;
  }, [renglones]);

  const activo = renglones.find((r) => r.id === renglonActivo) ?? null;
  const fotoMostrada =
    (fotoElegida && fotoDe.get(fotoElegida)) ||
    (activo?.foto_id ? fotoDe.get(activo.foto_id) : null) ||
    fotos[0] || null;

  // ── La vista previa de lo que saldría ─────────────────────
  const salida = useMemo(
    () => ({ ordenes: enOrdenes(renglones), pendientes: pendientesDeOrdenes(renglones) }),
    [renglones]
  );

  // ── Escribir un renglón ───────────────────────────────────
  async function guardar(id: string, cambios: Record<string, unknown>): Promise<boolean> {
    setError("");
    try {
      const res = await fetch("/api/mantenimiento/cuaderno/renglones", {
        method: "PATCH", headers: JSON_HEADERS, body: JSON.stringify({ id, ...cambios }),
      });
      const cuerpo = await leerJson<{ data?: Renglon; catalogo_error?: string | null }>(res);
      if (!res.ok || !cuerpo.data) {
        setError(cuerpo.error ?? `No se pudo guardar el renglón (HTTP ${res.status}).`);
        return false;
      }
      const guardado = { ...cuerpo.data, cuaderno_id: cargaId };
      tocarRenglones((rs) => rs.map((r) => (r.id === id ? guardado : r)));
      if (cuerpo.catalogo_error) setAviso(cuerpo.catalogo_error);
      return true;
    } catch (e) {
      setError(`No se pudo guardar el renglón: ${e instanceof Error ? e.message : String(e)}`);
      return false;
    }
  }

  /**
   * Confirmar o elegir el sector de un renglón que la propuesta quería juntar.
   *
   * Es el click que rompe la regla «primero se junta, después se confirma»:
   * con el sector confirmado el renglón sale como su propia OT y deja de
   * proponerse. No se prohíbe —puede ser lo que se quiere—, pero se frena.
   */
  async function permitidoFijarSector(r: Renglon): Promise<boolean> {
    const hermanos = enPropuesta.get(r.id);
    if (!hermanos || r.grupo_id) return true;
    return confirm({
      title: "Primero juntar, después confirmar",
      message:
        `Este renglón está propuesto para juntarse con ${hermanos - 1} más («${r.tarea.trim()}»). ` +
        `Si le confirmás el sector ahora, sale como su propia orden de trabajo y deja de proponerse: ` +
        `confirmando uno por uno vas a tener ${hermanos} órdenes donde esperabas una. ` +
        `Lo habitual es juntarlos primero y recién después fijar el sector de cada uno.`,
      confirmText: "Confirmar igual",
      cancelText: "Volver",
    });
  }

  async function cambiarSector(r: Renglon, sectorId: string) {
    if (sectorId && !(await permitidoFijarSector(r))) return;
    await guardar(r.id, { sector_id: sectorId || null });
  }

  async function confirmarSector(r: Renglon) {
    if (!(await permitidoFijarSector(r))) return;
    await guardar(r.id, { confirmar_sector: true });
  }

  // ── Juntar y separar ──────────────────────────────────────
  const elegidos = useMemo(() => renglones.filter((r) => seleccion.has(r.id)), [renglones, seleccion]);

  /**
   * Los problemas de juntar lo elegido, **todos juntos**. Son los de
   * `sePuedenJuntar` más el que agrega la ruta —no se saca a nadie de un grupo
   * que ya tiene orden—, así que el botón no promete lo que el servidor niega.
   */
  const problemasDeJuntar = useMemo(() => {
    if (elegidos.length < 2) return [];
    const problemas = new Set(sePuedenJuntar(elegidos));
    const viejos = new Set(elegidos.map((r) => r.grupo_id).filter((g): g is string => !!g));
    for (const g of viejos) {
      if (sePuedeSeparar(renglones.filter((r) => r.grupo_id === g)).length > 0) {
        problemas.add("Uno de los renglones viene de un grupo que ya tiene una orden de trabajo y no se lo puede sacar de ahí.");
      }
    }
    return [...problemas];
  }, [elegidos, renglones]);

  const gruposElegidos = useMemo(
    () => [...new Set(elegidos.map((r) => r.grupo_id).filter((g): g is string => !!g))],
    [elegidos]
  );
  const problemasDeSeparar = useMemo(
    () => [...new Set(gruposElegidos.flatMap((g) => sePuedeSeparar(renglones.filter((r) => r.grupo_id === g))))],
    [gruposElegidos, renglones]
  );

  async function juntar(ids: string[]) {
    setError(""); setAviso(""); setOcupado(true);
    try {
      const res = await fetch("/api/mantenimiento/cuaderno/renglones", {
        method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ ids }),
      });
      const cuerpo = await leerJson<{ grupo_id?: string }>(res);
      if (!res.ok || !cuerpo.grupo_id) {
        setError(cuerpo.error ?? `No se pudo juntar (HTTP ${res.status}).`);
        // El 409 parcial deja grupos escritos a medias: se vuelve a leer.
        if (res.status === 409) recargar();
        return;
      }
      const grupo = cuerpo.grupo_id;
      const juntados = renglones.filter((r) => ids.includes(r.id));
      tocarRenglones((rs) => rs.map((r) => (ids.includes(r.id) ? { ...r, grupo_id: grupo } : r)));
      setSeleccion(new Set());
      setAviso(`Se juntaron ${ids.length} renglones en una sola OT: ${vistaPrevia(juntados)}.`);
    } catch (e) {
      setError(`No se pudo juntar: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setOcupado(false);
    }
  }

  async function separar() {
    setError(""); setAviso(""); setOcupado(true);
    const hechos: string[] = [];
    try {
      for (const g of gruposElegidos) {
        const res = await fetch("/api/mantenimiento/cuaderno/renglones", {
          method: "DELETE", headers: JSON_HEADERS, body: JSON.stringify({ grupo_id: g }),
        });
        const cuerpo = await leerJson<{ ok?: boolean }>(res);
        if (!res.ok) {
          setError(cuerpo.error ?? `No se pudo separar (HTTP ${res.status}).`);
          break;
        }
        hechos.push(g);
      }
    } catch (e) {
      setError(`No se pudo separar: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      if (hechos.length > 0) {
        tocarRenglones((rs) => rs.map((r) => (r.grupo_id && hechos.includes(r.grupo_id) ? { ...r, grupo_id: null } : r)));
        setSeleccion(new Set());
        setAviso(hechos.length === 1 ? "Se separó el grupo." : `Se separaron ${hechos.length} grupos.`);
      }
      setOcupado(false);
    }
  }

  function alternar(id: string, marcar: boolean) {
    setSeleccion((s) => {
      const n = new Set(s);
      if (marcar) n.add(id); else n.delete(id);
      return n;
    });
  }

  // ── Subir y leer las fotos ────────────────────────────────
  const mes = mesElegido ?? mesDeLosRenglones(renglones) ?? mesPorDefecto();
  const mesValido = /^\d{4}-(0[1-9]|1[0-2])$/.test(mes);
  const proximaPagina = fotos.reduce((m, f) => Math.max(m, f.orden), 0) + 1;

  /**
   * Lo que se eligió decide por qué puerta entra, y lo decide **la extensión**:
   * un solo `.xlsx` es la planilla, cualquier otra cosa son páginas. Se eligen
   * en el mismo campo a propósito —son dos formas de cargar el mismo mes, no dos
   * pantallas—, y por eso hay que decir que mezclarlas no va: la ruta las
   * rechazaría igual, pero con un error del servidor en vez de antes de subir
   * nada.
   */
  const esUnXlsx = (f: File) => /\.xlsx$/i.test(f.name);
  const elExcelElegido = elegidas.length === 1 && esUnXlsx(elegidas[0]) ? elegidas[0] : null;
  const hayMezcla = elegidas.length > 1 && elegidas.some(esUnXlsx);

  function elegirArchivos(lista: FileList | null) {
    // Por nombre, con los números en su valor: IMG_2 va antes que IMG_10. Es
    // el orden de las páginas, y lo que una línea hereda de la anterior cruza
    // el borde de la foto.
    const archivos = Array.from(lista ?? []).sort((a, b) =>
      a.name.localeCompare(b.name, "es", { numeric: true })
    );
    setElegidas(archivos);
  }

  function actualizarItem(clave: string, cambios: Partial<ItemDeCola>) {
    setCola((c) => c.map((i) => (i.clave === clave ? { ...i, ...cambios } : i)));
  }

  /**
   * La carga sobre la que se escribe: la que está abierta, o una nueva. Null si
   * no se pudo abrir, y entonces no hay dónde subir nada.
   */
  async function abrirLaCarga(): Promise<string | null> {
    if (cargaId !== NUEVA) return cargaId;
    const res = await fetch("/api/mantenimiento/cuaderno", {
      method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ proveedor_id: proveedor.id }),
    });
    const cuerpo = await leerJson<{ id?: string }>(res);
    if (!res.ok || !cuerpo.id) {
      setError(cuerpo.error ?? `No se pudo abrir la carga (HTTP ${res.status}).`);
      return null;
    }
    const nueva = cuerpo.id;
    setCargas((c) => [
      { id: nueva, proveedor_id: proveedor.id, estado: "EN_CHEQUEO", created_at: new Date().toISOString(), mant_cuadernos_fotos: [] },
      ...c,
    ]);
    setCargaId(nueva);
    return nueva;
  }

  /**
   * La planilla, de punta a punta. **Es un solo viaje y no una cola**: leer un
   * Excel es aritmética y no llama a ningún modelo, así que no hay nada que
   * pueda fallar a la mitad ni nada que reintentar por partes. Un archivo que no
   * se reconoce vuelve con un 400 y no deja nada escrito.
   */
  async function subirLaPlanilla(archivo: File) {
    setError(""); setAviso(""); setRepetidos(null); setLeyendo(true);
    const base = { clave: "planilla", nombre: archivo.name, orden: 1, esPlanilla: true } as const;
    setCola([{ ...base, estado: "leyendo" }]);
    try {
      const idDeCarga = await abrirLaCarga();
      if (!idDeCarga) { setCola([]); return; }
      setElegidas([]);
      setClaveDelInput((k) => k + 1);

      const datos = new FormData();
      datos.set("cuaderno_id", idDeCarga);
      datos.set("archivo", archivo);
      const res = await fetch("/api/mantenimiento/cuaderno/excel", { method: "POST", body: datos });
      const cuerpo = await leerJson<{
        foto_id?: string; renglones?: unknown[]; grupos?: number; problemas?: string[];
      }>(res);
      if (!res.ok) {
        setCola([{ ...base, estado: "fallo", mensaje: cuerpo.error ?? `HTTP ${res.status}` }]);
        return;
      }
      setCola([{
        ...base,
        estado: "leida",
        foto_id: cuerpo.foto_id,
        renglones: cuerpo.renglones?.length ?? 0,
        grupos: cuerpo.grupos,
        mensaje: (cuerpo.problemas ?? []).join(" ") || undefined,
      }]);
      recargar();
      // El mismo control que las fotos: un día que ya tenía renglones cargados.
      if (cuerpo.foto_id) await buscarRepetidos(idDeCarga, [cuerpo.foto_id]);
    } catch (e) {
      setCola([{ ...base, estado: "fallo", mensaje: e instanceof Error ? e.message : String(e) }]);
    } finally {
      setLeyendo(false);
    }
  }

  /** Una foto, de punta a punta. Devuelve el id de la foto si salió con renglones. */
  async function leerUna(idDeCarga: string, item: ItemDeCola): Promise<string | null> {
    let archivo = achicadas.current.get(item.clave) ?? null;
    const original = originalesElegidos.current.get(item.clave) ?? null;
    if (!archivo && original) {
      actualizarItem(item.clave, { estado: "achicando", mensaje: undefined });
      try {
        archivo = await reducirFoto(original, `pagina-${item.orden}.jpg`);
        achicadas.current.set(item.clave, archivo);
      } catch (e) {
        // Una foto que falla al achicar no crea fila, pero las siguientes ya
        // tienen su número: queda un hueco en las páginas, y la fecha y el
        // lugar que una línea hereda de la anterior cruzan ese borde.
        actualizarItem(item.clave, {
          estado: "fallo",
          mensaje:
            `${e instanceof Error ? e.message : String(e)} ` +
            `Volvé a subir esa página; las siguientes ya quedaron numeradas y la ${item.orden} queda vacía hasta entonces.`,
        });
        return null;
      }
    }

    // Sin archivo, la ruta relee el del bucket: sólo vale si esa foto ya está
    // ahí. Si no, no se manda una subida que va a fallar con un error de
    // servidor que tapa el motivo de verdad.
    if (!archivo && !item.foto_id && !item.enElBucket) {
      actualizarItem(item.clave, {
        estado: "fallo",
        mensaje: "Esta foto no llegó a subirse y ya no está en memoria: volvé a elegirla.",
      });
      return null;
    }

    actualizarItem(item.clave, { estado: "leyendo", mensaje: undefined });
    const datos = new FormData();
    datos.set("cuaderno_id", idDeCarga);
    datos.set("orden", String(item.orden));
    datos.set("mes", mes);
    // Sin archivo se relee el que ya está en el bucket.
    if (archivo) datos.set("archivo", archivo);

    try {
      const res = await fetch("/api/mantenimiento/cuaderno/fotos", { method: "POST", body: datos });
      const cuerpo = await leerJson<{ foto_id?: string; renglones?: unknown[]; problemas?: string[] }>(res);
      if (!res.ok) {
        actualizarItem(item.clave, { estado: "fallo", mensaje: cuerpo.error ?? `HTTP ${res.status}` });
        return null;
      }
      const leidos = cuerpo.renglones?.length ?? 0;
      const problemas = (cuerpo.problemas ?? []).join(" ");
      if (leidos === 0) {
        actualizarItem(item.clave, { estado: "fallo", foto_id: cuerpo.foto_id, renglones: 0, mensaje: problemas || "No se leyó ningún renglón." });
        return null;
      }
      actualizarItem(item.clave, { estado: "leida", foto_id: cuerpo.foto_id, renglones: leidos, mensaje: problemas || undefined });
      return cuerpo.foto_id ?? null;
    } catch (e) {
      actualizarItem(item.clave, { estado: "fallo", mensaje: e instanceof Error ? e.message : String(e) });
      return null;
    }
  }

  /** Los días que las fotos recién leídas comparten con renglones ya cargados. */
  async function buscarRepetidos(idDeCarga: string, fotoIds: string[]) {
    if (fotoIds.length === 0) return;
    try {
      const params = new URLSearchParams({ cuaderno_id: idDeCarga, foto_ids: fotoIds.join(",") });
      const res = await fetch(`/api/mantenimiento/cuaderno/repetidos?${params}`);
      const cuerpo = await leerJson<{ dias?: DiaRepetido[] }>(res);
      if (!res.ok) {
        setError(`No se pudo comprobar si algún día ya estaba cargado: ${cuerpo.error ?? `HTTP ${res.status}`}`);
        return;
      }
      setRepetidos({ cargaId: idDeCarga, fotoIds, dias: cuerpo.dias ?? [] });
    } catch (e) {
      setError(`No se pudo comprobar si algún día ya estaba cargado: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  async function leerLasElegidas() {
    if (hayMezcla) return;
    if (elExcelElegido) { await subirLaPlanilla(elExcelElegido); return; }
    // El `accept` del campo no es una defensa: un archivo se puede elegir igual.
    // La ruta lo rechazaría, pero recién después de subirlo.
    if (deExcel) {
      setError(
        "Esta carga entró por Excel y no se le pueden agregar fotos: son dos formas de cargar el " +
        "mismo mes, no se mezclan. Para fotos, abrí una carga nueva."
      );
      return;
    }

    setError(""); setAviso(""); setRepetidos(null); setLeyendo(true);
    try {
      const idDeCarga = await abrirLaCarga();
      if (!idDeCarga) return;

      const items: ItemDeCola[] = elegidas.map((f, i) => ({
        clave: `${idDeCarga}:${proximaPagina + i}`,
        nombre: f.name,
        orden: proximaPagina + i,
        estado: "esperando",
      }));
      setCola(items);
      items.forEach((it, i) => originalesElegidos.current.set(it.clave, elegidas[i]));
      setElegidas([]);
      setClaveDelInput((k) => k + 1);

      // De a una: si la cuarta falla, las otras nueve ya están leídas.
      const leidas: string[] = [];
      for (const item of items) {
        const id = await leerUna(idDeCarga, item);
        if (id) leidas.push(id);
        recargar();
      }
      await buscarRepetidos(idDeCarga, leidas);
    } finally {
      setLeyendo(false);
    }
  }

  async function reintentar(item: ItemDeCola) {
    if (cargaId === NUEVA) return;
    setError(""); setLeyendo(true);
    try {
      const id = await leerUna(cargaId, item);
      recargar();
      if (id) await buscarRepetidos(cargaId, [id]);
    } finally {
      setLeyendo(false);
    }
  }

  function reintentarFoto(f: FotoDeCarga) {
    const item: ItemDeCola = {
      clave: `${cargaId}:${f.orden}`, nombre: `Página ${f.orden}`, orden: f.orden, estado: "esperando", enElBucket: true,
    };
    setCola((c) => [...c.filter((i) => i.clave !== item.clave), item]);
    return reintentar(item);
  }

  // ── El aviso de «ese día ya estaba cargado» ───────────────
  async function reemplazar(dia: DiaRepetido) {
    if (!repetidos) return;
    setError(""); setAviso(""); setOcupado(true);
    try {
      const res = await fetch("/api/mantenimiento/cuaderno/repetidos", {
        method: "DELETE", headers: JSON_HEADERS,
        body: JSON.stringify({ cuaderno_id: repetidos.cargaId, foto_ids: repetidos.fotoIds, fechas: [dia.fecha] }),
      });
      const cuerpo = await leerJson<{ borrados?: number }>(res);
      if (!res.ok) {
        setError(cuerpo.error ?? `No se pudo reemplazar (HTTP ${res.status}).`);
        return;
      }
      setRepetidos((r) => (r ? { ...r, dias: r.dias.filter((d) => d.fecha !== dia.fecha) } : r));
      setAviso(`Se reemplazaron los ${cuerpo.borrados ?? dia.cantidad} renglones que ya había del ${enDiaMes(dia.fecha)}.`);
      recargar();
    } catch (e) {
      setError(`No se pudo reemplazar: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setOcupado(false);
    }
  }

  // ── Generar las órdenes ───────────────────────────────────

  async function pedirGenerar(simular: boolean, confirmarDuplicados = false) {
    const res = await fetch("/api/mantenimiento/cuaderno/generar", {
      method: "POST", headers: JSON_HEADERS,
      body: JSON.stringify({ cuaderno_id: cargaId, simular, confirmar_duplicados: confirmarDuplicados }),
    });
    const cuerpo = await leerJson<
      Partial<ResultadoDeGenerar> & { ordenes?: OrdenDelPlan[]; duplicados?: { aviso: string } | null }
    >(res);
    if (!res.ok && !cuerpo.error) cuerpo.error = `HTTP ${res.status}`;
    return cuerpo;
  }

  /**
   * Generar es **irreversible**: una OT escrita en la planilla se borra a mano,
   * fila por fila. Por eso nunca se genera sin haber pedido antes la vista
   * previa **al servidor** —la misma cuenta que va a correr— y haberla puesto
   * delante de una persona.
   *
   * Y si lo que calcula el servidor no coincide con lo que esta pantalla
   * muestra, no se genera: alguien más tocó la carga, y confirmar un número
   * que ya no es el que se ve es lo que esta pantalla existe para evitar.
   */
  async function generar() {
    if (cargaId === NUEVA) return;
    setError(""); setAviso(""); setResultado(null); setOcupado(true);
    try {
      const previa = await pedirGenerar(true);
      if (previa.error || !previa.ordenes) {
        setError(previa.error ?? "La vista previa no llegó.");
        return;
      }

      const delServidor = new Set(previa.ordenes.map((o) => `${o.clave}|${o.accion}`));
      const deLaPantalla = new Set(salida.ordenes.map((o) => `${o.clave}|${o.accion}`));
      const coincide =
        delServidor.size === deLaPantalla.size && [...delServidor].every((k) => deLaPantalla.has(k));
      if (!coincide) {
        setError(
          `Lo que calcula el servidor (${delServidor.size} órdenes) no coincide con lo que muestra esta pantalla ` +
          `(${deLaPantalla.size}): alguien más tocó la carga. No se generó nada; se la volvió a leer, mirala de nuevo.`
        );
        recargar();
        return;
      }

      const entran = previa.ordenes.filter((o) => o.entra);
      if (entran.length === 0) {
        setAviso(
          previa.ordenes.some((o) => o.accion === "denunciar")
            ? "Lo único que hay para generar son grupos con dos órdenes, que hay que mirar a mano."
            : "No hay nada para generar."
        );
        return;
      }

      const nuevas = entran.filter((o) => o.accion === "crear").length;
      const sumadas = entran.filter((o) => o.accion === "sumar").length;
      const horas = redondear(entran.reduce((s, o) => s + o.horas, 0));
      const costo = redondear(entran.reduce((s, o) => s + (o.costo ?? 0), 0));
      const quedan = previa.ordenes.filter((o) => o.accion !== "denunciar" && !o.entra).length;

      // **A qué órdenes se les suma, dicho.** Sumar no agrega: reescribe la
      // descripción, las horas y la fecha de cierre de una OT que ya existe, y
      // deja en `REPUESTO UTILIZADO` el texto que dice el servidor. Quien
      // confirma tiene que ver cuáles son y cómo queda ese texto.
      const aLasQueSuma = entran.filter((o) => o.accion === "sumar");
      const MAXIMO_LISTADAS = 8;
      const listadas = aLasQueSuma.slice(0, MAXIMO_LISTADAS).map(
        (o) =>
          `• OT ${o.ot_existente ?? "?"} «${o.tarea}»: ${verHoras(o.horas)} h, repuesto ` +
          `${o.repuesto ? `«${o.repuesto}»` : "vacío"}`
      );
      if (aLasQueSuma.length > MAXIMO_LISTADAS) listadas.push(`• y ${aLasQueSuma.length - MAXIMO_LISTADAS} más`);
      const lasQueSuman = aLasQueSuma.length > 0
        ? `\n\nSe reescribe la descripción, las horas, el repuesto y la fecha de cierre de ${
            aLasQueSuma.length === 1 ? "esta OT que ya existe" : "estas OT que ya existen"
          } (sus horas pasan a ser el total del grupo, no se acumulan):\n${listadas.join("\n")}\n\n`
        : " ";

      // El freno de los duplicados: la vista previa **informa**, y levantarlo es
      // una decisión que se toma mirando el aviso, en el mismo cartel.
      const duplicados = previa.duplicados?.aviso ?? null;

      const ok = await confirm({
        title: duplicados ? "Ese período ya tiene órdenes cargadas" : "Generar las órdenes de trabajo",
        message:
          (duplicados ? `${duplicados} ` : "") +
          `Se van a escribir en la planilla de producción: ${nuevas} órdenes nuevas` +
          `${sumadas > 0 ? ` y ${sumadas} que suman a una que ya existe` : ""}, con ${verHoras(horas)} h` +
          `${costo > 0 ? ` y $${costoParaElCampo(costo)}` : ""}.` +
          lasQueSuman +
          `Una orden escrita ahí no se deshace desde el sistema: se borra a mano, fila por fila. ` +
          `${quedan > 0 ? `Van ${entran.length} en esta corrida y quedan ${quedan} para apretar de nuevo. ` : ""}` +
          `Tarda: son varias llamadas a Google por orden, así que no cierres la pantalla.`,
        confirmText: duplicados ? `Generar ${entran.length} igual` : `Generar ${entran.length}`,
        cancelText: "Volver", danger: true,
      });
      if (!ok) return;

      const hecho = await pedirGenerar(false, Boolean(duplicados));
      if (hecho.error && !hecho.creadas) {
        setError(hecho.error);
        return;
      }
      setResultado({
        creadas: hecho.creadas ?? [],
        actualizadas: hecho.actualizadas ?? [],
        problemas: hecho.problemas ?? [],
        quedaron: hecho.quedaron ?? 0,
      });
    } catch (e) {
      // Un corte a mitad de una corrida no dice qué órdenes se escribieron: se
      // vuelve a leer la carga, que sí lo sabe (cada renglón lleva su orden).
      setError(
        `Se cortó la conexión mientras se generaba: ${e instanceof Error ? e.message : String(e)}. ` +
        `Puede que algunas órdenes sí se hayan escrito; mirá qué renglones quedaron marcados antes de volver a generar.`
      );
    } finally {
      recargar();
      setOcupado(false);
    }
  }

  // ── Borrar la carga ───────────────────────────────────────
  async function borrarLaCarga() {
    if (cargaId === NUEVA) return;
    const ok = await confirm({
      title: "Borrar la carga",
      message:
        `Se borran ${deExcel ? "la planilla" : `las ${fotos.length} fotos`} y los ${renglones.length} renglones de esta carga. ` +
        `No se puede borrar si alguno ya generó una orden de trabajo.`,
      confirmText: "Borrar", cancelText: "Volver", danger: true,
    });
    if (!ok) return;
    setError(""); setAviso(""); setOcupado(true);
    try {
      const res = await fetch(`/api/mantenimiento/cuaderno?id=${encodeURIComponent(cargaId)}`, { method: "DELETE" });
      const cuerpo = await leerJson<{ aviso?: string | null }>(res);
      if (!res.ok) {
        setError(cuerpo.error ?? `No se pudo borrar la carga (HTTP ${res.status}).`);
        return;
      }
      const quedan = cargas.filter((c) => c.id !== cargaId);
      setCargas(quedan);
      cambiarDeCarga(quedan[0]?.id ?? NUEVA);
      setAviso(cuerpo.aviso ?? "La carga se borró.");
    } catch (e) {
      setError(`No se pudo borrar la carga: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setOcupado(false);
    }
  }

  function cambiarDeCarga(id: string) {
    setCargaId(id);
    setResultado(null);
    setSeleccion(new Set());
    setRenglonActivo(null);
    setFotoElegida(null);
    setRepetidos(null);
    setCola([]);
    setFiltro("todos");
    setSectorFiltrado("");
    setMesElegido(null);
  }

  // ── Dibujo ────────────────────────────────────────────────
  if (cargasIniciales === null) {
    return (
      <div className="rounded-lg border border-amber-300 bg-amber-50 p-6">
        <h2 className="mb-2 text-lg font-semibold text-amber-900">Falta correr la migración</h2>
        <p className="text-sm text-amber-800">
          El cuaderno necesita las tablas <code>mant_cuadernos</code>, <code>mant_cuadernos_fotos</code> y{" "}
          <code>mant_cuadernos_renglones</code>, que todavía no existen. Están en{" "}
          <code>supabase/migrations/20261101224005_cuaderno_de_contratista.sql</code> y las corre una
          persona en el editor SQL de Supabase.
        </p>
      </div>
    );
  }

  const hayPropuestas = propuestas.length > 0;
  const hayPorConfirmar = renglones.some((r) => r.sector_id && r.sector_propuesto && !r.orden_trabajo_id);
  const fechasDeLaCarga = renglones.map((r) => r.fecha);
  const pendientesSinSalir = salida.pendientes.reduce((n, p) => n + p.renglon_ids.length, 0);

  return (
    <div className="space-y-4">
      {/* ── Qué carga ─────────────────────────────────────── */}
      <section className="flex flex-col gap-3 rounded-lg border border-slate-200 bg-white p-3 sm:flex-row sm:flex-wrap sm:items-end sm:p-4">
        <label className="block w-full sm:w-80">
          <span className="mb-1 block text-xs font-medium text-slate-500">Carga del cuaderno</span>
          <Select
            value={cargaId}
            onChange={(e) => cambiarDeCarga(e.target.value)}
            disabled={leyendo || ocupado}
            className={CLASE_CAMPO}
          >
            {cargas.map((c) => (
              <option key={c.id} value={c.id}>
                Carga del {fechaDeCarga(c.created_at)}
                {c.mant_cuadernos_fotos ? ` · ${c.mant_cuadernos_fotos.length} pág.` : ""}
                {c.estado === "GENERADA" ? " · generada" : c.estado === "EN_CHEQUEO" ? " · en chequeo" : ""}
              </option>
            ))}
            {puedeEditar && <option value={NUEVA}>Nueva carga…</option>}
          </Select>
        </label>
        {puedeEditar && cargaId !== NUEVA && (
          <button
            type="button"
            onClick={borrarLaCarga}
            disabled={leyendo || ocupado || !abierta}
            className="rounded border border-rose-300 px-3 py-1.5 text-sm text-rose-700 hover:bg-rose-50 disabled:opacity-40"
          >
            Borrar esta carga
          </button>
        )}
        {abierta && (
          <p className="text-sm text-slate-600 sm:ml-auto">
            <span className="font-medium">{proveedor.nombre}</span> · {rangoDeFechas(fechasDeLaCarga)} ·{" "}
            {renglones.length} renglones
          </p>
        )}
      </section>

      {error && (
        <p className="rounded border border-rose-300 bg-rose-50 px-3 py-2 text-sm text-rose-800">{error}</p>
      )}
      {aviso && (
        <p className="rounded border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{aviso}</p>
      )}
      {errorDeCarga && (
        <p className="rounded border border-rose-300 bg-rose-50 px-3 py-2 text-sm text-rose-800">
          No se pudo abrir la carga: {errorDeCarga}
        </p>
      )}

      {/* ── Subir fotos ───────────────────────────────────── */}
      {puedeEditar && (
        <section className="rounded-lg border border-slate-200 bg-white p-3 sm:p-4">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-slate-400">
            {cargaId === NUEVA
              ? "Nueva carga: las fotos del cuaderno, o la planilla"
              : deExcel
                ? "Reemplazar la planilla de esta carga"
                : "Subir más páginas a esta carga"}
          </h2>
          <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
            {/* El mes es para las fotos: el cuaderno escribe «21-09» sin año. La
                planilla trae la fecha entera en su columna, así que no se pregunta. */}
            {!deExcel && !elExcelElegido && (
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-slate-500">Mes del cuaderno</span>
                {/* El ancho va en el envoltorio y no en el campo. */}
                <div className="w-full sm:w-44">
                  <input
                    type="month" value={mes}
                    onChange={(e) => setMesElegido(e.target.value)}
                    disabled={leyendo}
                    className={CLASE_CAMPO}
                  />
                </div>
              </label>
            )}
            <label className="block sm:min-w-0 sm:flex-1">
              <span className="mb-1 block text-xs font-medium text-slate-500">
                {deExcel ? "La planilla (.xlsx)" : "Las fotos de las páginas, o la planilla (.xlsx)"}
              </span>
              <input
                key={claveDelInput}
                type="file" multiple={!deExcel} accept={deExcel ? ".xlsx" : "image/*,.heic,.heif,.xlsx"}
                onChange={(e) => elegirArchivos(e.target.files)}
                disabled={leyendo}
                className="block w-full text-sm text-slate-600 file:mr-3 file:rounded file:border file:border-slate-300 file:bg-white file:px-3 file:py-1.5 file:text-sm"
              />
            </label>
            <button
              type="button"
              onClick={leerLasElegidas}
              disabled={leyendo || elegidas.length === 0 || hayMezcla || (!elExcelElegido && !mesValido)}
              className="rounded bg-slate-800 px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
            >
              {leyendo
                ? "Leyendo…"
                : elExcelElegido
                  ? "Leer la planilla"
                  : `Leer ${elegidas.length || ""} ${elegidas.length === 1 ? "foto" : "fotos"}`}
            </button>
          </div>

          {hayMezcla && (
            <p className="mt-3 rounded border border-rose-300 bg-rose-50 px-3 py-2 text-sm text-rose-800">
              Elegiste fotos y una planilla a la vez. El Excel es una alternativa a las fotos y no se
              mezclan en la misma carga: elegí una cosa o la otra.
            </p>
          )}
          {elegidas.length > 0 && !hayMezcla && (
            <ol className="mt-3 space-y-0.5 text-xs text-slate-500">
              {elExcelElegido ? (
                <li>Planilla: {elExcelElegido.name}</li>
              ) : (
                elegidas.map((f, i) => (
                  <li key={`${f.name}-${i}`}>Página {proximaPagina + i}: {f.name}</li>
                ))
              )}
            </ol>
          )}
          <p className="mt-3 text-xs text-slate-500">
            {deExcel || elExcelElegido ? (
              <>
                Se leen cinco columnas, por el nombre del encabezado y no por su letra:{" "}
                <strong>Tarea</strong>, <strong>Fecha Desde</strong>, <strong>Fecha Hasta</strong>,{" "}
                <strong>Hs</strong> y <strong>Precio ($)</strong> — «Tarea» y «Hs» son las únicas
                obligatorias. Cada fila es una orden de trabajo. Si hay una fila de{" "}
                <strong>TOTALES</strong>, sus horas tienen que dar la suma de las filas: si no dan, los
                renglones entran igual y se te dice de cuánto es la diferencia. Volver a subirla
                reemplaza todo lo de esta carga.
              </>
            ) : (
              <>
                Las fotos se achican en este navegador antes de subirse y se leen de a una: si una falla,
                las demás quedan leídas y se reintenta sólo esa. Las páginas se numeran por el orden del
                nombre del archivo. Las fotos del iPhone en formato HEIC sólo se pueden abrir desde Safari.
                Si en vez de fotos tenés la planilla de Excel, elegila acá mismo.
              </>
            )}
          </p>

          {cola.length > 0 && (
            <ul className="mt-3 space-y-1 text-sm">
              {cola.map((i) => (
                <li key={i.clave} className="flex flex-wrap items-baseline gap-x-2">
                  <span className="font-medium text-slate-700">
                    {i.esPlanilla ? "Planilla" : `Página ${i.orden}`}
                  </span>
                  <span className="text-slate-400">{i.nombre}</span>
                  {i.estado === "esperando" && <span className="text-slate-400">esperando</span>}
                  {i.estado === "achicando" && <span className="text-slate-500">achicando la foto…</span>}
                  {i.estado === "leyendo" && (
                    <span className="text-slate-500">
                      {i.esPlanilla ? "leyendo la planilla…" : "leyendo la hoja (puede tardar un minuto)…"}
                    </span>
                  )}
                  {i.estado === "leida" && (
                    <span className="text-emerald-700">
                      leída: {i.renglones} renglones
                      {i.grupos ? `, ${i.grupos} ${i.grupos === 1 ? "grupo" : "grupos"} del resumen` : ""}
                    </span>
                  )}
                  {i.estado === "fallo" && (
                    <>
                      <span className="text-rose-700">falló</span>
                      {/* Una planilla no se reintenta sola: no se subió nada, se
                          vuelve a elegir el archivo y listo. */}
                      {!i.esPlanilla && (
                        <button
                          type="button" onClick={() => reintentar(i)} disabled={leyendo}
                          className="text-xs text-slate-600 underline disabled:opacity-40"
                        >
                          Reintentar
                        </button>
                      )}
                    </>
                  )}
                  {i.mensaje && (
                    <span className={`w-full text-xs ${i.estado === "fallo" ? "text-rose-700" : "text-amber-700"}`}>
                      {i.mensaje}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {/* ── Un día que ya estaba cargado ───────────────────── */}
      {repetidos && repetidos.dias.length > 0 && (
        <section className="rounded-lg border border-amber-300 bg-amber-50 p-3 sm:p-4">
          <h2 className="text-sm font-semibold text-amber-900">
            {repetidos.dias.length === 1
              ? "Un día de estas fotos ya tenía renglones cargados"
              : `${repetidos.dias.length} días de estas fotos ya tenían renglones cargados`}
          </h2>
          <p className="mt-1 text-xs text-amber-800">
            El cuaderno no trae número de hoja, así que un repetido sólo se nota por el día. Puede ser
            la misma hoja subida dos veces o un día escrito en dos hojas: elegí vos.
          </p>
          <ul className="mt-3 space-y-3">
            {repetidos.dias.map((d) => (
              <li key={d.fecha} className="rounded border border-amber-200 bg-white p-3 text-sm">
                <p className="text-slate-800">
                  <span className="font-medium">{enDiaMes(d.fecha)}</span> · ya había {d.cantidad}{" "}
                  {d.cantidad === 1 ? "renglón" : "renglones"}
                  {d.de_otras_cargas > 0 && ` (${d.de_otras_cargas} de otra carga)`}
                  <span className="text-slate-500">: {d.tareas.join(" · ")}{d.cantidad > d.tareas.length ? "…" : ""}</span>
                </p>
                {d.motivo && <p className="mt-1 text-xs text-rose-700">{d.motivo}</p>}
                <div className="mt-2 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => reemplazar(d)}
                    disabled={ocupado || !d.se_puede_reemplazar}
                    className="rounded bg-slate-800 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-40"
                  >
                    Reemplazar los de ese día
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setRepetidos((r) => (r ? { ...r, dias: r.dias.filter((x) => x.fecha !== d.fecha) } : r))
                    }
                    disabled={ocupado}
                    className="rounded border border-slate-300 px-3 py-1.5 text-xs text-slate-700 disabled:opacity-40"
                  >
                    Dejar los dos
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {cargandoCarga && !abierta && <p className="text-sm text-slate-500">Abriendo la carga…</p>}

      {cargaId === NUEVA && (
        <p className="rounded border border-slate-200 bg-white px-3 py-6 text-center text-sm text-slate-500">
          {puedeEditar
            ? "Elegí arriba las fotos del cuaderno —o la planilla de Excel, si la armaste vos— para empezar. Después vas a poder chequear cada renglón y completar los sectores."
            : "Todavía no hay cargas de este contratista."}
        </p>
      )}

      {abierta && (
        <>
          {/* ── Filtros ─────────────────────────────────── */}
          <div className="space-y-2">
            <div className="flex flex-wrap gap-2">
              {filtros.map((f) => {
                // La cuenta del chip ya mira el sector elegido: si no, diría
                // «Sin sector (35)» mientras abajo se ven tres.
                const n = renglones.filter(f.pasa).filter(pasaElSector).length;
                const marcado = f.id === filtro;
                return (
                  <button
                    key={f.id}
                    type="button"
                    onClick={() => setFiltro(f.id)}
                    className={`rounded-full border px-3 py-1 text-sm ${
                      marcado
                        ? "border-slate-800 bg-slate-800 text-white"
                        : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
                    }`}
                  >
                    {f.etiqueta} ({n})
                  </button>
                );
              })}
            </div>

            {/* Filtrar por sector es lo que hace manejable juntar: se ve de a un
                sector por vez y se eligen todos los que quedan a la vista. */}
            <div className="flex flex-wrap items-end gap-2">
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-slate-500">Sector</span>
                <div className="w-full sm:w-72">
                  <Select
                    value={sectorFiltrado}
                    onChange={(e) => setSectorFiltrado(e.target.value)}
                    aria-label="Filtrar por sector"
                    className={CLASE_CAMPO}
                  >
                    <option value="">Todos los sectores ({renglones.length})</option>
                    {sinSector > 0 && <option value="sin">— sin sector — ({sinSector})</option>}
                    {sectoresDeLaCarga.map((s) => (
                      <option key={s.id} value={s.id}>{s.nombre} ({s.n})</option>
                    ))}
                  </Select>
                </div>
              </label>

              {puedeEditar && elegiblesALaVista.length > 0 && (
                <button
                  type="button"
                  onClick={() => setSeleccion(new Set(elegiblesALaVista.map((r) => r.id)))}
                  className="rounded border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
                >
                  Elegir {elegiblesALaVista.length === 1 ? "el que se ve" : `los ${elegiblesALaVista.length} que se ven`}
                </button>
              )}

              {sectorFiltrado !== "" && (
                <button
                  type="button"
                  onClick={() => setSectorFiltrado("")}
                  className="px-2 py-2 text-sm text-slate-500 underline"
                >
                  Quitar el filtro de sector
                </button>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
            {/* ── La hoja (o la planilla), fija a la izquierda ── */}
            <aside className="min-w-0 lg:sticky lg:top-0 lg:col-span-2 lg:self-start">
              <div className="rounded-lg border border-slate-200 bg-white p-3">
                {/* Una carga de Excel no tiene hoja contra la cual comparar: la
                    transcripción la escribió quien carga. En vez de la foto va
                    de dónde salió cada renglón y qué trajo el archivo. */}
                {deExcel ? (
                  <>
                    <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                      Esta carga entró por Excel
                    </p>
                    <p className="mt-2 text-sm text-slate-700">
                      {renglones.length} {renglones.length === 1 ? "tarea" : "tareas"}
                      {gruposArmados > 0 && (
                        <> · {gruposArmados} {gruposArmados === 1 ? "juntada" : "juntadas"} a mano</>
                      )}
                    </p>
                    {errorDeFoto && <p className="mt-2 text-xs text-rose-700">{errorDeFoto}</p>}
                    {planilla && urls[planilla.id] && (
                      <a
                        href={urls[planilla.id]}
                        className="mt-2 inline-block text-sm text-sky-700 underline"
                        download
                      >
                        Bajar la planilla
                      </a>
                    )}
                    <p className="mt-3 text-xs text-slate-500">
                      No hay hoja que mirar al lado: la transcripción la escribiste vos. <strong>Cada
                      fila de la planilla es una orden de trabajo</strong>, así que lo que queda por
                      hacer es completar los sectores.
                    </p>
                    <p className="mt-2 text-xs text-slate-500">
                      Se leen cinco columnas, buscadas por el nombre del encabezado y no por su letra:
                      <strong> Tarea</strong>, <strong>Fecha Desde</strong>, <strong>Fecha Hasta</strong>,
                      <strong> Hs</strong> y <strong>Precio ($)</strong>. «Tarea» y «Hs» son las únicas
                      obligatorias. La fila de <strong>TOTALES</strong> no es una tarea: sus horas se
                      usan para comprobar que la suma de las filas dé.
                    </p>

                    {/* De qué fila de la planilla salió el renglón en el que estás parado. */}
                    {activo && (
                      <div className="mt-3 rounded border border-sky-300 bg-sky-50 p-2 text-sm">
                        <p className="text-xs font-semibold text-sky-800">
                          {activo.linea ? `Fila ${activo.linea} de la planilla` : "Sin fila"}
                        </p>
                        <p className="mt-1 text-slate-700">
                          Dice: <mark className="rounded bg-yellow-200 px-1">{activo.tarea}</mark>
                        </p>
                        {activo.dudoso && (
                          <p className="mt-1 text-xs text-amber-800">
                            Dudoso{activo.motivo_dudoso ? `: ${activo.motivo_dudoso}` : "."}
                          </p>
                        )}
                      </div>
                    )}
                  </>
                ) : fotos.length === 0 ? (
                  <p className="py-6 text-center text-sm text-slate-500">Esta carga no tiene fotos.</p>
                ) : (
                  <>
                    <div className="mb-2 flex flex-wrap gap-1.5">
                      {fotos.map((f) => {
                        const n = renglonesPorFoto.get(f.id) ?? 0;
                        const mostrada = fotoMostrada?.id === f.id;
                        return (
                          <button
                            key={f.id}
                            type="button"
                            onClick={() => setFotoElegida(f.id)}
                            title={f.fallo ?? undefined}
                            className={`rounded border px-2 py-0.5 text-xs ${
                              f.fallo
                                ? "border-rose-300 bg-rose-50 text-rose-700"
                                : mostrada
                                  ? "border-slate-800 bg-slate-800 text-white"
                                  : "border-slate-300 bg-white text-slate-700"
                            } ${f.fallo && mostrada ? "ring-2 ring-slate-800" : ""}`}
                          >
                            Pág. {f.orden}{f.fallo ? " · falló" : ` · ${n}`}
                          </button>
                        );
                      })}
                    </div>

                    {fotoMostrada?.fallo && (
                      <div className="mb-2 rounded border border-rose-300 bg-rose-50 p-2 text-xs text-rose-800">
                        <p>La página {fotoMostrada.orden} no se pudo leer: {fotoMostrada.fallo}</p>
                        {puedeEditar && (
                          <button
                            type="button"
                            onClick={() => reintentarFoto(fotoMostrada)}
                            disabled={leyendo || !mesValido}
                            className="mt-1 underline disabled:opacity-40"
                          >
                            Reintentar la lectura
                          </button>
                        )}
                      </div>
                    )}

                    {errorDeFoto && <p className="mb-2 text-xs text-rose-700">{errorDeFoto}</p>}

                    {fotoMostrada && urls[fotoMostrada.id] ? (
                      <button
                        type="button"
                        onClick={() => setAmpliada(true)}
                        className="block max-h-80 w-full cursor-zoom-in overflow-auto rounded border border-slate-200 lg:max-h-[60dvh]"
                        title="Ampliar la foto"
                      >
                        {/* Una foto firmada y con tamaño propio: next/image no aporta acá. */}
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={urls[fotoMostrada.id]}
                          alt={`Página ${fotoMostrada.orden} del cuaderno`}
                          className="w-full"
                        />
                      </button>
                    ) : (
                      <p className="py-6 text-center text-sm text-slate-400">
                        {errorDeFoto ? "" : "Cargando la foto…"}
                      </p>
                    )}
                    <p className="mt-1 text-xs text-slate-400">Tocá la foto para ampliarla.</p>

                    {/* De qué foto y qué línea salió el renglón en el que estás parado. */}
                    {activo && (
                      <div className="mt-3 rounded border border-sky-300 bg-sky-50 p-2 text-sm">
                        <p className="text-xs font-semibold text-sky-800">
                          {activo.foto_id && fotoDe.get(activo.foto_id)
                            ? `Página ${fotoDe.get(activo.foto_id)!.orden}`
                            : "Sin foto"}
                          {activo.linea ? ` · línea ${activo.linea}` : ""}
                          {activo.foto_id && fotoMostrada && activo.foto_id !== fotoMostrada.id && (
                            <span className="font-normal text-sky-700"> (estás mirando otra página)</span>
                          )}
                        </p>
                        <p className="mt-1 text-slate-700">
                          Leyó: <mark className="rounded bg-yellow-200 px-1">{activo.tarea}</mark>
                        </p>
                        {activo.lugar_raw && (
                          <p className="text-slate-700">
                            Lugar: <mark className="rounded bg-yellow-200 px-1">{activo.lugar_raw}</mark>
                          </p>
                        )}
                        {activo.dudoso && (
                          <p className="mt-1 text-xs text-amber-800">
                            Dudoso{activo.motivo_dudoso ? `: ${activo.motivo_dudoso}` : "."}
                          </p>
                        )}
                      </div>
                    )}
                  </>
                )}
              </div>
            </aside>

            {/* ── Los renglones ───────────────────────────── */}
            <div className="min-w-0 space-y-3 lg:col-span-3">
              {puedeEditar && (
                <div
                  className={`rounded border px-3 py-2 text-sm ${
                    hayPropuestas || hayPorConfirmar
                      ? "border-amber-300 bg-amber-50 text-amber-900"
                      : "border-slate-200 bg-white text-slate-600"
                  }`}
                >
                  <p>
                    <span className="font-semibold">Primero juntá, después confirmá.</span> Un renglón con el
                    sector confirmado sale como su propia OT y deja de proponerse para juntar: si confirmás
                    el sector de cada «Tranqueras D6» antes de juntarlas, te quedan tres OT donde esperabas
                    una.
                  </p>
                  {hayPropuestas && (
                    <div className="mt-2 border-t border-amber-200 pt-2">
                      <p className="mb-1 text-xs font-medium">
                        El sistema propone juntar ({propuestas.length}):
                      </p>
                      <ul className="max-h-48 space-y-1.5 overflow-y-auto">
                        {propuestas.map((p) => (
                          <li key={p.clave} className="flex flex-wrap items-center gap-x-3 gap-y-1">
                            <span className="min-w-0 flex-1 text-xs">
                              {p.texto} · {p.ids.length} renglones
                            </span>
                            <button
                              type="button"
                              onClick={() => setSeleccion(new Set(p.ids))}
                              className="text-xs text-amber-900 underline"
                            >
                              Elegir
                            </button>
                            <button
                              type="button"
                              onClick={() => juntar(p.ids)}
                              disabled={ocupado}
                              className="rounded bg-slate-800 px-2 py-1 text-xs font-medium text-white disabled:opacity-40"
                            >
                              Juntar
                            </button>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}

              {visibles.length === 0 ? (
                <p className="rounded border border-slate-200 bg-white px-3 py-6 text-center text-sm text-slate-500">
                  {renglones.length === 0
                    ? "Esta carga todavía no tiene renglones."
                    : "Ningún renglón cumple ese filtro."}
                </p>
              ) : (
                visibles.map((r) => {
                  const delSector = r.sector_id ? opcionesDeEquipo.delSector.get(r.sector_id) : undefined;
                  const equipo = r.equipo_id ? equipoPorId.get(r.equipo_id) ?? null : null;
                  return (
                    <FilaDelRenglon
                      key={r.id}
                      r={r}
                      activo={r.id === renglonActivo}
                      marcado={seleccion.has(r.id)}
                      puedeEditar={puedeEditar}
                      opcionesDeSector={opcionesDeSector}
                      opcionesDeEquipo={delSector ?? opcionesDeEquipo.todos}
                      equipo={equipo}
                      equipoAparte={delSector && equipo && equipo.sector_id !== r.sector_id ? equipo : null}
                      etiquetaDeEquipo={etiquetaDeEquipo}
                      nombreDelSector={r.sector_id ? nombreDeSector.get(r.sector_id) ?? "" : ""}
                      conRango={deExcel}
                      pagina={r.foto_id ? fotoDe.get(r.foto_id)?.orden ?? null : null}
                      hermanosEnPropuesta={enPropuesta.get(r.id) ?? 0}
                      integrantesDelGrupo={r.grupo_id ? renglones.filter((x) => x.grupo_id === r.grupo_id).length : 0}
                      onActivar={() => { setRenglonActivo(r.id); setFotoElegida(null); }}
                      onMarcar={(m) => alternar(r.id, m)}
                      onGuardar={(c) => guardar(r.id, c)}
                      onCambiarSector={(s) => cambiarSector(r, s)}
                      onConfirmarSector={() => confirmarSector(r)}
                      onError={setError}
                    />
                  );
                })
              )}

              {/* ── Juntar y separar, con la vista previa ──── */}
              {puedeEditar && seleccion.size > 0 && (
                <div className="sticky bottom-0 z-10 rounded-lg border border-slate-300 bg-white p-3 shadow-lg">
                  <p className="text-sm font-medium text-slate-800">
                    {elegidos.length} {elegidos.length === 1 ? "seleccionado" : "seleccionados"} ·{" "}
                    {verHoras(elegidos.reduce((s, r) => s + (Number(r.horas) || 0), 0))} h
                  </p>
                  {elegidos.length >= 2 && problemasDeJuntar.length === 0 && (
                    <p className="mt-1 text-sm text-slate-600">
                      Quedaría como una OT: <span className="font-medium">{vistaPrevia(elegidos)}</span>
                    </p>
                  )}
                  {elegidos.length === 1 && (
                    <p className="mt-1 text-xs text-slate-500">Elegí al menos dos renglones para juntarlos.</p>
                  )}
                  {problemasDeJuntar.length > 0 && (
                    <ul className="mt-1 list-disc space-y-0.5 pl-5 text-xs text-rose-700">
                      {problemasDeJuntar.map((p) => <li key={p}>{p}</li>)}
                    </ul>
                  )}
                  {gruposElegidos.length > 0 && problemasDeSeparar.length > 0 && (
                    <ul className="mt-1 list-disc space-y-0.5 pl-5 text-xs text-rose-700">
                      {problemasDeSeparar.map((p) => <li key={p}>{p}</li>)}
                    </ul>
                  )}
                  <div className="mt-2 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => juntar([...seleccion])}
                      disabled={ocupado || elegidos.length < 2 || problemasDeJuntar.length > 0}
                      className="rounded bg-slate-800 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40"
                    >
                      Juntar en una OT
                    </button>
                    <button
                      type="button"
                      onClick={separar}
                      disabled={ocupado || gruposElegidos.length === 0 || problemasDeSeparar.length > 0}
                      className="rounded border border-slate-300 px-3 py-1.5 text-sm text-slate-700 disabled:opacity-40"
                    >
                      Separar
                    </button>
                    <button
                      type="button"
                      onClick={() => setSeleccion(new Set())}
                      className="px-2 py-1.5 text-sm text-slate-500 underline"
                    >
                      Soltar la selección
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* ── Lo que saldría ──────────────────────────── */}
          <details className="rounded-lg border border-slate-200 bg-white p-3 sm:p-4">
            <summary className="cursor-pointer text-sm font-medium text-slate-700">
              Lo que saldría como órdenes de trabajo: {salida.ordenes.length}{" "}
              {salida.ordenes.length === 1 ? "OT" : "OT"}
              {pendientesSinSalir > 0 && ` · ${pendientesSinSalir} renglones todavía no salen`}
            </summary>
            <p className="mt-2 text-xs text-slate-500">
              Es la misma cuenta que hace la generación: antes de escribir, el servidor la vuelve a
              calcular y se te muestra para confirmar. Generar no se deshace desde acá.
            </p>
            {puedeEditar && (
              <div className="mt-3">
                <button
                  type="button"
                  onClick={generar}
                  disabled={ocupado || salida.ordenes.every((o) => o.accion === "denunciar")}
                  className="rounded bg-emerald-700 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40"
                >
                  {ocupado ? "Generando…" : "Generar las órdenes de trabajo"}
                </button>
                <p className="mt-1 text-xs text-slate-500">
                  Hasta 25 por vez; si hay más, se aprieta de nuevo y lo ya generado no se repite.
                </p>
              </div>
            )}
            {resultado && (
              <div className="mt-3 space-y-2 rounded border border-slate-200 p-3 text-sm">
                <p className="font-medium text-slate-800">
                  {resultado.creadas.length} creadas · {resultado.actualizadas.length} actualizadas
                  {resultado.quedaron > 0 && ` · quedan ${resultado.quedaron} para otra corrida`}
                </p>
                {resultado.creadas.length + resultado.actualizadas.length > 0 && (
                  <p className="text-xs text-slate-600">
                    OT:{" "}
                    {[...resultado.creadas, ...resultado.actualizadas]
                      .map((o) => o.ot_number).sort((a, b) => a - b).join(", ")}
                  </p>
                )}
                {resultado.problemas.length > 0 && (
                  <ul className="list-disc space-y-1 pl-5 text-xs text-rose-700">
                    {resultado.problemas.map((p, i) => <li key={i}>{p}</li>)}
                  </ul>
                )}
              </div>
            )}
            {salida.ordenes.length > 0 && (
              <ul className="mt-3 space-y-1 text-sm">
                {salida.ordenes.map((o) => (
                  <li key={o.clave} className="flex flex-wrap gap-x-2">
                    <span
                      className={
                        o.accion === "crear" ? "text-emerald-700" : o.accion === "sumar" ? "text-amber-700" : "text-rose-700"
                      }
                    >
                      {o.accion === "crear" ? "OT nueva" : o.accion === "sumar" ? "suma horas" : "revisar a mano"}
                    </span>
                    <span className="text-slate-700">
                      {o.tarea} · {verHoras(o.horas)} h
                      {o.costo !== null ? ` · $${costoParaElCampo(o.costo)}` : ""} ·{" "}
                      {rangoDeFechas([o.desde, o.hasta])}
                      {o.renglon_ids.length > 1 ? ` · ${o.renglon_ids.length} renglones` : ""}
                    </span>
                    <span className="text-slate-400">{nombreDeSector.get(o.sector_id ?? "") ?? ""}</span>
                  </li>
                ))}
              </ul>
            )}
            {salida.pendientes.length > 0 && (
              <div className="mt-4">
                <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">Todavía no salen</p>
                <ul className="mt-2 space-y-2 text-sm">
                  {salida.pendientes.map((p, i) => {
                    const nombres = p.renglon_ids
                      .map((id) => renglones.find((r) => r.id === id)?.tarea.trim())
                      .filter((t): t is string => !!t);
                    return (
                      <li key={`${p.motivo}-${p.grupo_id ?? i}-${p.renglon_ids[0]}`}>
                        <span className="text-slate-800">
                          {nombres.slice(0, 3).join(" · ")}
                          {nombres.length > 3 ? ` y ${nombres.length - 3} más` : ""}
                        </span>
                        <span className="block text-xs text-slate-500">{p.explicacion}</span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
          </details>
        </>
      )}

      {/* ── La foto ampliada ──────────────────────────────── */}
      {ampliada && fotoMostrada && urls[fotoMostrada.id] && (
        <Ampliada
          url={urls[fotoMostrada.id]}
          pagina={fotoMostrada.orden}
          alCerrar={() => setAmpliada(false)}
        />
      )}
    </div>
  );
}

// ── La foto ampliada ────────────────────────────────────────

const ACERCAMIENTOS = [1, 1.75, 2.5, 3.5];

function Ampliada({ url, pagina, alCerrar }: { url: string; pagina: number; alCerrar: () => void }) {
  const [nivel, setNivel] = useState(1);
  const zoom = ACERCAMIENTOS[nivel];
  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black/85">
      <div className="flex items-center gap-2 bg-black/60 px-3 py-2 text-sm text-white">
        <span className="mr-auto">Página {pagina}</span>
        <button
          type="button" onClick={() => setNivel((n) => Math.max(0, n - 1))} disabled={nivel === 0}
          className="rounded border border-white/40 px-3 py-1 disabled:opacity-30"
        >
          Alejar
        </button>
        <button
          type="button" onClick={() => setNivel((n) => Math.min(ACERCAMIENTOS.length - 1, n + 1))}
          disabled={nivel === ACERCAMIENTOS.length - 1}
          className="rounded border border-white/40 px-3 py-1 disabled:opacity-30"
        >
          Acercar
        </button>
        <button type="button" onClick={alCerrar} className="rounded bg-white px-3 py-1 text-slate-900">
          Cerrar
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-2">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={url}
          alt={`Página ${pagina} del cuaderno, ampliada`}
          className={zoom === 1 ? "mx-auto" : ""}
          style={{ width: `${zoom * 48}rem`, maxWidth: zoom === 1 ? "100%" : "none" }}
        />
      </div>
    </div>
  );
}

// ── Un renglón ──────────────────────────────────────────────

interface PropsDeFila {
  r: Renglon;
  activo: boolean;
  marcado: boolean;
  puedeEditar: boolean;
  opcionesDeSector: ReactNode;
  opcionesDeEquipo: ReactNode;
  equipo: EquipoBasico | null;
  /** El equipo del renglón cuando no está en la lista de su sector, para que no desaparezca del desplegable. */
  equipoAparte: EquipoBasico | null;
  etiquetaDeEquipo: (e: EquipoBasico) => string;
  nombreDelSector: string;
  /** La tarea puede durar varios días y se edita con dos fechas: lo traen las planillas, no las fotos. */
  conRango: boolean;
  pagina: number | null;
  /** Con cuántos más (contándolo) lo propone juntar el sistema. 0 si no. */
  hermanosEnPropuesta: number;
  integrantesDelGrupo: number;
  onActivar: () => void;
  onMarcar: (m: boolean) => void;
  onGuardar: (cambios: Record<string, unknown>) => Promise<boolean>;
  onCambiarSector: (sectorId: string) => Promise<void>;
  onConfirmarSector: () => Promise<void>;
  onError: (mensaje: string) => void;
}

type Borrador = { fecha?: string; fecha_hasta?: string; tarea?: string; horas?: string; costo?: string };

function FilaDelRenglon({
  r, activo, marcado, puedeEditar, opcionesDeSector, opcionesDeEquipo, equipo, equipoAparte, etiquetaDeEquipo,
  nombreDelSector, conRango, pagina, hermanosEnPropuesta, integrantesDelGrupo,
  onActivar, onMarcar, onGuardar, onCambiarSector, onConfirmarSector, onError,
}: PropsDeFila) {
  // Lo que se está tipeando, hasta que se sale del campo. Se muestra el borrador
  // si lo hay y, si no, lo que tiene el renglón: así un guardado que falla vuelve
  // solo al valor de antes, sin estado que sincronizar.
  const [borrador, setBorrador] = useState<Borrador>({});
  const convertido = !!r.orden_trabajo_id;
  const bloqueado = !puedeEditar || convertido;

  const sinSector = !r.sector_id;
  const propuesto = !!r.sector_id && r.sector_propuesto;
  const equipoDeOtroSector = !!(equipo?.sector_id && r.sector_id && equipo.sector_id !== r.sector_id);

  function soltar(campo: keyof Borrador) {
    setBorrador((b) => {
      const n = { ...b };
      delete n[campo];
      return n;
    });
  }

  async function cerrarCampo(campo: keyof Borrador) {
    const escrito = borrador[campo];
    if (escrito === undefined) return;
    try {
      if (campo === "fecha") {
        const nueva = escrito || null;
        if (nueva !== r.fecha) await onGuardar({ fecha: nueva });
      } else if (campo === "fecha_hasta") {
        // Vaciarlo quiere decir «duró un día», y es una decisión: va como null.
        const nueva = escrito || null;
        if (nueva !== (r.fecha_hasta ?? null)) await onGuardar({ fecha_hasta: nueva });
      } else if (campo === "tarea") {
        if (escrito.trim() !== r.tarea.trim()) await onGuardar({ tarea: escrito });
      } else {
        const leido = leerNumeroDelCampo(escrito, campo === "costo");
        if (leido.tipo === "invalido") { onError(leido.motivo); return; }
        const nuevo = leido.tipo === "vacio" ? null : leido.valor;
        const actual = r[campo] === null || r[campo] === undefined ? null : Number(r[campo]);
        if (nuevo !== actual) await onGuardar({ [campo]: nuevo });
      }
    } finally {
      soltar(campo);
    }
  }

  const escribir = (campo: keyof Borrador) => (e: { target: { value: string } }) =>
    setBorrador((b) => ({ ...b, [campo]: e.target.value }));

  return (
    <div
      onClick={onActivar}
      onFocus={onActivar}
      className={`rounded-lg border bg-white p-3 ${
        activo ? "border-sky-400 ring-2 ring-sky-300" : "border-slate-200"
      } ${convertido ? "opacity-70" : ""}`}
    >
      {/* Fecha y tarea */}
      <div className="flex flex-wrap items-start gap-2">
        <input
          type="checkbox"
          checked={marcado}
          onChange={(e) => onMarcar(e.target.checked)}
          disabled={!puedeEditar || convertido}
          aria-label="Elegir este renglón"
          className="mt-2 h-4 w-4 shrink-0"
        />
        <div className="w-36 shrink-0">
          <input
            type="date"
            value={borrador.fecha ?? r.fecha ?? ""}
            onChange={escribir("fecha")}
            onBlur={() => cerrarCampo("fecha")}
            disabled={bloqueado}
            aria-label={conRango ? "Fecha desde" : "Fecha"}
            title={conRango ? "Fecha desde" : undefined}
            className={CLASE_CAMPO}
          />
        </div>
        {/* El último día. Vacío quiere decir que la tarea fue de un día: no se
            muestra con las fotos, donde un renglón es siempre de un día. */}
        {conRango && (
          <div className="w-36 shrink-0">
            <input
              type="date"
              value={borrador.fecha_hasta ?? r.fecha_hasta ?? ""}
              onChange={escribir("fecha_hasta")}
              onBlur={() => cerrarCampo("fecha_hasta")}
              disabled={bloqueado}
              aria-label="Fecha hasta"
              title="Fecha hasta — vacío quiere decir que duró un día"
              placeholder="hasta"
              className={CLASE_CAMPO}
            />
          </div>
        )}
        <div className="min-w-0 flex-1 basis-48">
          <textarea
            rows={2}
            value={borrador.tarea ?? r.tarea}
            onChange={escribir("tarea")}
            onBlur={() => cerrarCampo("tarea")}
            disabled={bloqueado}
            aria-label="Tarea"
            className={`${CLASE_CAMPO} resize-y`}
          />
        </div>
      </div>

      {/* Sector y equipo */}
      <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
        <div>
          <span className="mb-0.5 block text-xs text-slate-500">Sector</span>
          <Select
            value={r.sector_id ?? ""}
            onChange={(e) => onCambiarSector(e.target.value)}
            disabled={bloqueado}
            aria-label="Sector"
            className={`${CLASE_CAMPO} ${
              sinSector ? "border-rose-400 bg-rose-50" : propuesto ? "border-amber-400 bg-amber-50" : ""
            }`}
          >
            {opcionesDeSector}
          </Select>
          {sinSector && (
            <p className="mt-0.5 text-xs text-rose-700">No se le reconoció el sector. Elegilo del desplegable.</p>
          )}
          {propuesto && (
            <p className="mt-0.5 text-xs text-amber-800">
              Propuesto desde el equipo: {nombreDelSector || "—"}. El papel no lo dice.
              {!bloqueado && (
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); void onConfirmarSector(); }}
                  className="ml-2 rounded border border-amber-400 bg-white px-2 py-0.5 font-medium text-amber-900"
                >
                  Confirmar
                </button>
              )}
            </p>
          )}
        </div>
        <div>
          <span className="mb-0.5 block text-xs text-slate-500">Equipo</span>
          <Select
            value={r.equipo_id ?? ""}
            onChange={(e) => { void onGuardar({ equipo_id: e.target.value || null }); }}
            disabled={bloqueado}
            aria-label="Equipo"
            className={CLASE_CAMPO}
          >
            {opcionesDeEquipo}
                        {equipoAparte && <option value={equipoAparte.id}>{etiquetaDeEquipo(equipoAparte)}</option>}
          </Select>
          {equipoDeOtroSector && (
            <p className="mt-0.5 text-xs text-amber-800">El equipo es de otro sector que el elegido.</p>
          )}
        </div>
      </div>

      {/* Horas, costo y de dónde salió */}
      <div className="mt-2 flex flex-wrap items-end gap-3">
        <label className="block">
          <span className="mb-0.5 block text-xs text-slate-500">Horas</span>
          {/* El ancho va en el envoltorio: el del campo se lo come su width: 100%. */}
          <div className="w-20">
            <input
              type="text" inputMode="decimal"
              value={borrador.horas ?? horasParaElCampo(r.horas)}
              onChange={escribir("horas")}
              onBlur={() => cerrarCampo("horas")}
              disabled={bloqueado}
              className={CLASE_CAMPO}
            />
          </div>
        </label>
        <label className="block">
          <span className="mb-0.5 block text-xs text-slate-500">Costo ($)</span>
          <div className="w-32">
            <input
              type="text" inputMode="decimal"
              value={borrador.costo ?? costoParaElCampo(r.costo)}
              onChange={escribir("costo")}
              onBlur={() => cerrarCampo("costo")}
              disabled={bloqueado}
              className={CLASE_CAMPO}
            />
          </div>
        </label>
        <p className="min-w-0 flex-1 basis-40 text-xs text-slate-500">
          {pagina !== null ? `Pág. ${pagina}` : "sin foto"}
          {r.linea ? ` · línea ${r.linea}` : ""}
          {r.lugar_raw ? ` · lugar: «${r.lugar_raw}»` : ""}
        </p>
      </div>

      {/* Etiquetas */}
      {(r.dudoso || r.heredado || r.grupo_id || convertido || hermanosEnPropuesta > 1) && (
        <div className="mt-2 flex flex-wrap gap-1.5 text-xs">
          {r.dudoso && (
            <span className="rounded bg-amber-100 px-2 py-0.5 text-amber-900">
              dudoso{r.motivo_dudoso ? `: ${r.motivo_dudoso}` : ""}
            </span>
          )}
          {r.heredado && (
            <span className="rounded bg-slate-100 px-2 py-0.5 text-slate-600">
              fecha o lugar heredados de la línea anterior
            </span>
          )}
          {r.grupo_id && (
            <span className="rounded bg-sky-100 px-2 py-0.5 text-sky-900">
              juntado con {Math.max(0, integrantesDelGrupo - 1)} más
            </span>
          )}
          {hermanosEnPropuesta > 1 && !r.grupo_id && (
            <span className="rounded bg-amber-100 px-2 py-0.5 text-amber-900">
              se propone juntarlo con {hermanosEnPropuesta - 1} más
            </span>
          )}
          {convertido && (
            <span className="rounded bg-emerald-100 px-2 py-0.5 text-emerald-900">ya es una orden de trabajo</span>
          )}
        </div>
      )}
    </div>
  );
}
