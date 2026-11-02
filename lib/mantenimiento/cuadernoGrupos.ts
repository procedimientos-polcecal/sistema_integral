import { normalizarLugar } from "./partesDeContratista";

/**
 * Cuántas órdenes de trabajo salen de los renglones del cuaderno de Piparo, y
 * qué se puede juntar o separar a mano.
 *
 * Es pura: recibe los renglones tal como los lee la pantalla y no habla con la
 * base. La ruta de renglones y la de generación usan **las mismas funciones**,
 * así que lo que la vista previa promete es lo que la generación hace.
 *
 * La regla del negocio, que es lo que todo esto implementa:
 *
 * - **Renglón con sector confirmado → su propia OT.** No se funde con nada.
 * - **Renglón sin sector → se propone acumular** los que son la misma tarea
 *   (`propuestaDeGrupos`): «Tranqueras D6» del 17, el 21 y el 23 salen como una
 *   sola orden, con las horas sumadas y el rango de fechas.
 * - **La propuesta la corrige una persona**: selecciona renglones y los junta
 *   (`sePuedenJuntar`) o los separa. Lo que se juntó queda con un `grupo_id`
 *   compartido y **sólo eso es un grupo**: la propuesta no agrupa por sí sola.
 *   El sistema propone, quien tiene el papel decide.
 */

/** El renglón tal como lo comparten la pantalla y la generación. */
export type RenglonDelCuaderno = {
  id: string;
  /** De qué carga es. La propuesta de acumular no cruza cargas. */
  cuaderno_id: string;
  foto_id?: string | null;
  linea?: number | null;
  fecha: string | null;
  tarea: string;
  /** Lo que escribió PIPARO. Es el papel: nunca se edita, sólo se lee. */
  lugar_raw: string | null;
  sector_id: string | null;
  /** El sector lo dedujo el sistema y nadie lo confirmó. */
  sector_propuesto: boolean;
  equipo_id: string | null;
  horas: number | null;
  costo: number | null;
  dudoso?: boolean;
  motivo_dudoso?: string | null;
  heredado?: boolean;
  grupo_id: string | null;
  orden_trabajo_id: string | null;
};

/** Qué hay que hacer con un grupo que sale como OT. */
export type AccionDeGrupo =
  /** No tiene orden todavía: hay que crearla. */
  | "crear"
  /** Ya tiene una: se la reescribe con el total del grupo, no se crea otra. */
  | "sumar"
  /** Tiene dos o más órdenes distintas: se informa y no se toca ninguna. */
  | "denunciar";

export type GrupoDeCuaderno = {
  /** El `grupo_id` si una persona lo juntó; `solo:<id>` si es un renglón suelto. */
  clave: string;
  grupo_id: string | null;
  /**
   * El sector de la OT. **Null sólo cuando `accion` es `denunciar`**: ahí lo
   * único que importa es decir que hay dos órdenes, y el sector no es lo que
   * falla.
   */
  sector_id: string | null;
  /**
   * El equipo, **sólo si todos los renglones apuntan al mismo**. Un renglón sin
   * equipo y otro con uno dejan la OT sin equipo: quedarse con el único que
   * hay le daría al MTBF de esa máquina las horas de las otras tareas.
   */
  equipo_id: string | null;
  /** La tarea del primer renglón (por fecha), para el título. */
  tarea: string;
  /** Todas las tareas distintas del grupo, en el orden del papel. */
  tareas: string[];
  /** La suma de las horas del grupo entero —convertidos incluidos—. */
  horas: number;
  /** La suma de los precios, o null si ningún renglón trae uno. */
  costo: number | null;
  desde: string | null;
  hasta: string | null;
  renglon_ids: string[];
  /** Los que todavía no tienen orden: son los que hay que marcar al generar. */
  renglon_ids_sin_ot: string[];
  /** Las OT que ya tienen los renglones del grupo. Más de una es un problema. */
  ot_existentes: string[];
  accion: AccionDeGrupo;
  detalle: {
    id: string;
    fecha: string | null;
    tarea: string;
    lugar_raw: string | null;
    horas: number | null;
    costo: number | null;
  }[];
};

export type MotivoPendiente =
  | "sin_sector"
  | "sector_sin_confirmar"
  | "sectores_distintos"
  | "sin_horas"
  | "sin_fecha";

/** Lo que **no** sale como OT todavía, y por qué. */
export type PendienteDeCuaderno = {
  motivo: MotivoPendiente;
  explicacion: string;
  grupo_id: string | null;
  renglon_ids: string[];
};

// ── Lo chico ────────────────────────────────────────────────

function numero(x: number | null | undefined): number {
  const n = Number(x);
  return Number.isFinite(n) ? n : 0;
}

/** Sin esto, 0,1 + 0,2 dan 0,30000000000000004 y la OT lo escribe así. */
function redondear(h: number): number {
  return Math.round(h * 100) / 100;
}

const nombre = (r: RenglonDelCuaderno) => `«${r.tarea.trim()}»`;

/**
 * La tarea en su forma canónica, para decidir cuándo dos renglones son «la
 * misma tarea»: minúsculas, sin acentos, sin puntuación y con los espacios
 * colapsados. La eñe se conserva (lo hace `normalizarLugar`).
 *
 * Es la misma normalización del catálogo de lugares y no una parecida: en el
 * código tiene que haber una sola.
 */
export function claveDeTarea(tarea: string): string {
  return normalizarLugar(tarea).replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();
}

/**
 * «Sin sector» para la regla de acumular: el que no tiene ninguno **o** el que
 * tiene uno que el sistema dedujo y nadie confirmó. Una propuesta no es una
 * respuesta: «Tranqueras D6» recibe Cantera del equipo D6, pero el papel no
 * dice Cantera, y sigue siendo una tarea general que se repite de un día a otro.
 */
function sinSectorConfirmado(r: RenglonDelCuaderno): boolean {
  return !r.sector_id || r.sector_propuesto;
}

const distintos = <T>(xs: T[]): T[] => [...new Set(xs)];

// ── Juntar y separar ────────────────────────────────────────

/**
 * Los problemas de juntar estos renglones en una sola OT. Vacío si se puede.
 *
 * Informa todos juntos y en castellano, no de a uno.
 *
 * Un sector propuesto cuenta como sector: juntar uno de Cantera (propuesto) con
 * uno de Molienda es mezclar dos centros de costo, y quien carga tiene que
 * elegir antes cuál de los dos es. Lo que **no** se pide es que tengan sector:
 * juntar renglones sin sector es justamente el caso de uso.
 */
export function sePuedenJuntar(renglones: readonly RenglonDelCuaderno[]): string[] {
  const problemas: string[] = [];

  if (renglones.length < 2) {
    problemas.push("Para juntar hay que elegir al menos dos renglones.");
  }

  for (const r of renglones) {
    if (r.orden_trabajo_id) {
      problemas.push(
        `El renglón ${nombre(r)} ya se convirtió en una orden de trabajo y no se junta con nada.`
      );
    }
  }

  const sectores = distintos(renglones.map((r) => r.sector_id).filter((s): s is string => !!s));
  if (sectores.length > 1) {
    problemas.push(
      `No se pueden juntar: una orden de trabajo tiene un solo sector y estos renglones son de ${sectores.length} sectores distintos. ` +
      `Primero hay que dejarlos en el mismo.`
    );
  }

  return problemas;
}

/**
 * Los problemas de separar un grupo. Vacío si se puede.
 *
 * Un grupo con una orden ya creada no se separa: la OT quedaría con las horas
 * del grupo entero y los renglones que se suelten podrían generar una segunda
 * orden por las mismas horas. La OT no se deshace desde acá.
 *
 * También vale al **sacar** un renglón de su grupo para juntarlo con otros.
 */
export function sePuedeSeparar(renglonesDelGrupo: readonly RenglonDelCuaderno[]): string[] {
  if (renglonesDelGrupo.some((r) => r.orden_trabajo_id)) {
    return [
      "Ese grupo ya tiene una orden de trabajo, así que no se puede separar: " +
      "la orden quedaría con las horas del grupo entero. Si está mal, hay que corregir la OT.",
    ];
  }
  return [];
}

/**
 * La propuesta de qué renglones sin sector acumular: **clave de la tarea →
 * ids de los renglones**, sólo las claves con dos o más.
 *
 * Es una propuesta y no un grupo: no escribe nada. La pantalla la muestra y la
 * persona la acepta juntando esos ids (`sePuedenJuntar`), o no.
 *
 * Entran los renglones sin sector confirmado (ver `sinSectorConfirmado`) que
 * no están ya juntados por una persona —eso ya está decidido— ni convertidos.
 * **La propuesta no cruza cargas**: agrupa dentro de cada `cuaderno_id` y
 * nunca entre dos. Sin ese corte, «Tranqueras D6» de septiembre y la de
 * noviembre se propondrían juntas, y eso sería una OT que cruza dos meses sin
 * que nadie lo haya pedido. (`POST` de renglones ya impide juntar a mano entre
 * cargas: éste es el otro lado.) La clave del mapa lleva el cuaderno por lo
 * mismo.
 *
 * Dos renglones son «la misma tarea» cuando su tarea normalizada coincide;
 * **el lugar no cuenta**, porque en los renglones sin sector casi siempre está
 * vacío: «Tranqueras D6» lleva el equipo en la tarea. El riesgo es que
 * «Alambrado» de dos lugares se proponga junto, y por eso es sólo una
 * propuesta.
 *
 * Lo que `sePuedenJuntar` rechazaría no se propone: una propuesta que la
 * pantalla no puede ejecutar es peor que no hacerla.
 */
export function propuestaDeGrupos(renglones: readonly RenglonDelCuaderno[]): Map<string, string[]> {
  const porTarea = new Map<string, RenglonDelCuaderno[]>();
  for (const r of renglones) {
    if (r.orden_trabajo_id || r.grupo_id || !sinSectorConfirmado(r)) continue;
    const tarea = claveDeTarea(r.tarea);
    if (!tarea) continue;
    const clave = `${r.cuaderno_id}|${tarea}`;
    const lista = porTarea.get(clave);
    if (lista) lista.push(r);
    else porTarea.set(clave, [r]);
  }

  const propuesta = new Map<string, string[]>();
  for (const [clave, miembros] of porTarea) {
    if (miembros.length < 2) continue;
    if (sePuedenJuntar(miembros).length > 0) continue;
    propuesta.set(clave, miembros.map((m) => m.id));
  }
  return propuesta;
}

// ── Lo que sale como OT ─────────────────────────────────────

type Resolucion = { ordenes: GrupoDeCuaderno[]; pendientes: PendienteDeCuaderno[] };

/** Un grupo o un renglón suelto: la unidad que sería una OT. */
function unidades(renglones: readonly RenglonDelCuaderno[]): { grupo_id: string | null; miembros: RenglonDelCuaderno[] }[] {
  const porGrupo = new Map<string, RenglonDelCuaderno[]>();
  const salida: { grupo_id: string | null; miembros: RenglonDelCuaderno[] }[] = [];
  for (const r of renglones) {
    if (!r.grupo_id) { salida.push({ grupo_id: null, miembros: [r] }); continue; }
    const lista = porGrupo.get(r.grupo_id);
    if (lista) lista.push(r);
    else porGrupo.set(r.grupo_id, [r]);
  }
  for (const [grupo_id, miembros] of porGrupo) salida.push({ grupo_id, miembros });
  return salida;
}

const porFechaYLinea = (a: RenglonDelCuaderno, b: RenglonDelCuaderno) =>
  (a.fecha ?? "9999").localeCompare(b.fecha ?? "9999") || numero(a.linea) - numero(b.linea);

function resolver(renglones: readonly RenglonDelCuaderno[]): Resolucion {
  const ordenes: GrupoDeCuaderno[] = [];
  const pendientes: PendienteDeCuaderno[] = [];

  for (const { grupo_id, miembros: sinOrdenar } of unidades(renglones)) {
    const miembros = [...sinOrdenar].sort(porFechaYLinea);
    const ids = miembros.map((m) => m.id);
    const pendiente = (motivo: MotivoPendiente, explicacion: string) =>
      pendientes.push({ motivo, explicacion, grupo_id, renglon_ids: ids });

    const ot_existentes = distintos(
      miembros.map((m) => m.orden_trabajo_id).filter((o): o is string => !!o)
    );
    const sinOT = miembros.filter((m) => !m.orden_trabajo_id);

    // Qué sector tiene la unidad. Una sola vara, la estricta: **todos** los
    // renglones tienen que traer sector y ninguno propuesto sin confirmar. Un
    // renglón sin sector no hereda el del grupo —sería dejar pasar la peor
    // suposición mientras la mejor, una propuesta del catálogo, se frena— y
    // «lo que nadie confirmó no se genera». Juntar y después fijarle el sector
    // a cada uno es el camino.
    const sectores = distintos(miembros.map((m) => m.sector_id).filter((s): s is string => !!s));
    const sector_id = sectores.length === 1 ? sectores[0] : null;

    const primero = miembros[0];
    const fechas = miembros.map((m) => m.fecha).filter((f): f is string => !!f).sort();
    const horas = redondear(miembros.reduce((s, m) => s + numero(m.horas), 0));
    const costos = miembros.filter((m) => numero(m.costo) > 0);
    const costo = costos.length > 0 ? redondear(costos.reduce((s, m) => s + numero(m.costo), 0)) : null;

    const equipos = distintos(miembros.map((m) => m.equipo_id));
    const equipo_id = equipos.length === 1 ? equipos[0] : null;

    const grupo = (accion: AccionDeGrupo): GrupoDeCuaderno => ({
      clave: grupo_id ?? `solo:${primero.id}`,
      grupo_id,
      sector_id,
      equipo_id,
      tarea: primero.tarea.trim(),
      tareas: distintos(miembros.map((m) => m.tarea.trim())),
      horas,
      costo,
      desde: fechas[0] ?? null,
      hasta: fechas[fechas.length - 1] ?? null,
      renglon_ids: ids,
      renglon_ids_sin_ot: sinOT.map((m) => m.id),
      ot_existentes,
      accion,
      detalle: miembros.map((m) => ({
        id: m.id, fecha: m.fecha, tarea: m.tarea.trim(), lugar_raw: m.lugar_raw,
        horas: m.horas, costo: m.costo,
      })),
    });

    // Dos órdenes en un mismo grupo es una inconsistencia que ya existe en la
    // base: se denuncia primero, antes de mirar nada más, y no se toca ninguna.
    // Repartir las horas entre dos órdenes ya creadas sería inventar.
    if (ot_existentes.length > 1) { ordenes.push(grupo("denunciar")); continue; }

    // Todo convertido a una sola orden: no hay nada que hacer. No es un
    // pendiente tampoco —no falta nada—, así que no vuelve a salir.
    if (sinOT.length === 0) continue;

    if (sectores.length > 1) {
      pendiente(
        "sectores_distintos",
        "Los renglones del grupo quedaron en sectores distintos y una orden tiene uno solo. Hay que dejarlos en el mismo o separarlos."
      );
      continue;
    }
    if (miembros.some((m) => m.sector_id && m.sector_propuesto)) {
      pendiente(
        "sector_sin_confirmar",
        "El sector lo propuso el sistema y nadie lo confirmó. Lo que nadie confirmó no se genera."
      );
      continue;
    }
    if (!sector_id || miembros.some((m) => !m.sector_id)) {
      pendiente(
        "sin_sector",
        miembros.length > 1
          ? "Algún renglón del grupo no tiene sector: sin sector no hay orden de trabajo. Hay que fijárselo a cada uno."
          : "No tiene sector: sin sector no hay orden de trabajo."
      );
      continue;
    }
    if (fechas.length === 0) {
      pendiente("sin_fecha", "No tiene fecha: una orden de trabajo no puede nacer sin ella.");
      continue;
    }
    // Un renglón en blanco —el papel une varias tareas con una llave y un solo
    // total, y los otros entran sin horas— daría una OT de 0 h, que es un
    // registro vacío. No genera, pero tampoco se pierde: queda a la vista para
    // que alguien lo junte con el que tiene las horas. Si ya está en un grupo
    // con ellas, el total del grupo no es cero y sale.
    if (horas === 0 && costo === null) {
      pendiente(
        "sin_horas",
        "No tiene horas ni precio. Si es parte de una llave del papel, hay que juntarlo con el renglón que trae el total."
      );
      continue;
    }

    ordenes.push(grupo(ot_existentes.length === 1 ? "sumar" : "crear"));
  }

  const orden = (a: { desde?: string | null; tarea?: string }, b: { desde?: string | null; tarea?: string }) =>
    (a.desde ?? "").localeCompare(b.desde ?? "") || (a.tarea ?? "").localeCompare(b.tarea ?? "");
  ordenes.sort(orden);
  return { ordenes, pendientes };
}

/**
 * Las órdenes de trabajo que van a salir de estos renglones.
 *
 * **Se niega ella misma a generar sin sector.** No lo hereda de ningún lado:
 * `loQueFaltaParaCrear` exige el sector desde el 19/10/2026, pero la
 * generación del otro contratista (`partes-contratista/generar`) no la llama
 * —comprobado el 01/11/2026—, arma el registro y lo inserta. Esta función es la
 * que escribe la regla «lo que nadie confirmó no se genera». Quedan afuera:
 *
 * - los renglones **sin sector**, y los grupos en los que **alguno** no lo
 *   tiene (el sector no se hereda del grupo);
 * - los de **sector propuesto sin confirmar** (`sector_propuesto = true`), y
 *   los grupos en los que alguno lo está;
 * - los grupos cuyos renglones quedaron en **sectores distintos**;
 * - los renglones **sin fecha**.
 *
 * **Los renglones en blanco de una llave.** El papel une varias tareas con una
 * llave y un solo total: las 46 h quedan en el renglón donde están escritas y
 * los otros entran sin horas. Suelto, un renglón sin horas ni precio **no
 * genera**: una OT de 0 h es un registro vacío. Pero tampoco se descarta en
 * silencio —eso contradiría «no se descarta nada»—: `pendientesDeOrdenes` lo
 * devuelve con el motivo `sin_horas`, y la pantalla lo muestra igual que a los
 * sin sector. Si alguien los junta, el total del grupo se calcula entero y la
 * OT sale con las 46 h. Un renglón con precio y sin horas **sí** genera: los
 * empalmes y parches se cobran por trabajo y no por hora.
 *
 * Cada grupo trae su `accion`: crear, sumar a la OT que ya tiene, o denunciar
 * si tiene dos. Un grupo ya convertido por completo no vuelve a salir.
 */
export function enOrdenes(renglones: readonly RenglonDelCuaderno[]): GrupoDeCuaderno[] {
  return resolver(renglones).ordenes;
}

/**
 * Los renglones que **no** salen como OT, agrupados como saldrían, cada uno con
 * su motivo. Es el complemento de `enOrdenes`: entre las dos está cada renglón
 * que no se convirtió ya, y ninguno se pierde sin que la pantalla lo pueda
 * mostrar.
 */
export function pendientesDeOrdenes(renglones: readonly RenglonDelCuaderno[]): PendienteDeCuaderno[] {
  return resolver(renglones).pendientes;
}
