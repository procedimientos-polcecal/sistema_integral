/**
 * La propuesta del historial cruzada con lo que decidió una persona.
 *
 * `tareasPreventivas.ts` dice qué tareas se vienen haciendo, en qué equipos y
 * con qué ritmo. Esto le suma la única cosa que el historial no puede
 * contestar: **cuáles son de verdad**.
 *
 * ── LA PROPUESTA NO SE GUARDA, SE RECALCULA ────────────────────────────────
 *
 * Y por eso este módulo existe. Qué tareas hay y cada cuánto sale de las OT de
 * los últimos 365 días, en cada lectura; la tabla `mant_tareas_preventivas`
 * guarda sólo la decisión. Si la propuesta se guardara, diría «cada 4 días»
 * tres meses después de que el ritmo cambió y nada avisaría.
 *
 * La consecuencia es la que ordena todo lo de abajo: **los dos lados pueden no
 * coincidir**. Hay tareas propuestas sin decidir, decisiones sobre tareas que
 * la ventana ya no ve, y el ritmo medido puede haberse movido desde el día en
 * que alguien fijó el período. Las tres cosas se muestran, ninguna se esconde.
 *
 * ── LA UNIDAD ES EL EQUIPO ─────────────────────────────────────────────────
 *
 * Una tarea del catálogo es `(equipo, acción, componente)` y no
 * `(acción, componente)`. «Rotación de martillos» se hace en seis equipos con
 * ritmos distintos —cada ~4 días en PO-C1-04 y cada ~22 en PY-C1-03—: un plan
 * es por máquina, así que una decisión también.
 */
import {
  ACCIONES_PREVENTIVAS, comoSeLee, type CatalogoPropuesto,
} from "./tareasPreventivas";

/** Una fila de `mant_tareas_preventivas`, como la trae la base. */
export interface DecisionGuardada {
  equipment_id: string;
  accion: string;
  componente: string;
  nombre: string;
  periodo_dias: number | null;
  estado: string;
  motivo: string | null;
}

export type EstadoDeLaTarea = "propuesta" | "confirmada" | "descartada";

export interface RenglonDelCatalogo {
  equipmentId: string;
  accion: string;
  componente: string;
  /** Cómo se llama: lo que escribió una persona, o el nombre que propone el sistema. */
  nombre: string;
  estado: EstadoDeLaTarea;
  /** Cuántas veces se hizo en la ventana. **0 si la ventana ya no la ve.** */
  veces: number;
  /** La mediana de los huecos, medida hoy. null si no alcanza para decirlo. */
  intervaloMedido: number | null;
  /** El período que fijó una persona. null si confirmó sin fijarlo. */
  periodoDecidido: number | null;
  motivo: string | null;
  /**
   * La tarea está decidida y **el historial de la ventana ya no la muestra**.
   *
   * No es un error ni se esconde: una tarea confirmada es un plan, y que no se
   * haya hecho en los últimos 365 días es justamente lo que alguien querría
   * ver. Puede ser que se dejó de hacer, o que el equipo salió de servicio.
   */
  sinRespaldoEnElHistorial: boolean;
}

export interface Catalogo {
  renglones: RenglonDelCatalogo[];
  resumen: { propuestas: number; confirmadas: number; descartadas: number };
}

const clave = (equipmentId: string, accion: string, componente: string) =>
  `${equipmentId}|${accion}|${componente}`;

/** `CONFIRMADA` / `DESCARTADA` de la base, como lo nombra la pantalla. */
function comoLoLlamaLaPantalla(estado: string): EstadoDeLaTarea {
  return estado === "DESCARTADA" ? "descartada" : "confirmada";
}

/**
 * Las dos listas, cruzadas.
 *
 * El orden es el que conviene para trabajar: **primero lo que falta decidir**,
 * y dentro de eso lo que más órdenes representa. Una pantalla que arranca con
 * lo ya resuelto obliga a buscar el trabajo pendiente.
 */
export function cruzarConLasDecisiones(
  propuesto: CatalogoPropuesto,
  decisiones: readonly DecisionGuardada[]
): Catalogo {
  const porClave = new Map(
    decisiones.map((d) => [clave(d.equipment_id, d.accion, d.componente), d])
  );
  const usadas = new Set<string>();
  const renglones: RenglonDelCatalogo[] = [];

  for (const tarea of propuesto.tareas) {
    for (const equipo of tarea.equipos) {
      const k = clave(equipo.equipmentId, tarea.accion, tarea.componente);
      const decision = porClave.get(k);
      if (decision) usadas.add(k);

      renglones.push({
        equipmentId: equipo.equipmentId,
        accion: tarea.accion,
        componente: tarea.componente,
        nombre: decision?.nombre ?? comoSeLee(tarea.accion, tarea.componente),
        estado: decision ? comoLoLlamaLaPantalla(decision.estado) : "propuesta",
        veces: equipo.veces,
        intervaloMedido: equipo.intervaloTipico,
        periodoDecidido: decision?.periodo_dias ?? null,
        motivo: decision?.motivo ?? null,
        sinRespaldoEnElHistorial: false,
      });
    }
  }

  // Y las decididas que la ventana ya no ve. Van al final y con `veces: 0`,
  // que es lo que son: una decisión sin nada que la respalde hoy.
  for (const d of decisiones) {
    const k = clave(d.equipment_id, d.accion, d.componente);
    if (usadas.has(k)) continue;
    renglones.push({
      equipmentId: d.equipment_id,
      accion: d.accion,
      componente: d.componente,
      nombre: d.nombre,
      estado: comoLoLlamaLaPantalla(d.estado),
      veces: 0,
      intervaloMedido: null,
      periodoDecidido: d.periodo_dias,
      motivo: d.motivo,
      sinRespaldoEnElHistorial: true,
    });
  }

  const peso: Record<EstadoDeLaTarea, number> = {
    propuesta: 0, confirmada: 1, descartada: 2,
  };
  renglones.sort(
    (a, b) =>
      peso[a.estado] - peso[b.estado] ||
      b.veces - a.veces ||
      a.nombre.localeCompare(b.nombre, "es") ||
      a.equipmentId.localeCompare(b.equipmentId)
  );

  return {
    renglones,
    resumen: {
      propuestas: renglones.filter((r) => r.estado === "propuesta").length,
      confirmadas: renglones.filter((r) => r.estado === "confirmada").length,
      descartadas: renglones.filter((r) => r.estado === "descartada").length,
    },
  };
}

/**
 * Qué le falta a una decisión para poder guardarse.
 *
 * **Todo junto y en castellano**, que es la vara de `validar()` del núcleo.
 *
 * El período es opcional: se puede confirmar que la tarea existe sin decidir
 * todavía cada cuánto. Lo que no se acepta es un período que no es un número
 * de días — guardar un 0 o un -3 deja una fila que el motor de planes no va a
 * poder usar y que nadie va a volver a mirar.
 */
export const PERIODO_MAXIMO_DIAS = 3650;

export function loQueFaltaParaDecidir(datos: {
  accion: unknown;
  componente: unknown;
  nombre: unknown;
  estado: unknown;
  periodo_dias: unknown;
}): string[] {
  const falta: string[] = [];
  const texto = (v: unknown) => String(v ?? "").trim();

  if (!texto(datos.accion)) falta.push("la acción");
  else if (!ACCIONES_PREVENTIVAS.some((a) => a.clave === texto(datos.accion))) {
    falta.push("una acción del vocabulario");
  }

  if (!texto(datos.componente)) falta.push("el componente");
  if (!texto(datos.nombre)) falta.push("el nombre de la tarea");

  if (!["CONFIRMADA", "DESCARTADA"].includes(texto(datos.estado))) {
    falta.push("si se confirma o se descarta");
  }

  // `null` y `""` son «no lo decidí todavía» y están bien. Lo que no entra es
  // un valor que pretende ser un período y no lo es.
  const p = datos.periodo_dias;
  if (p !== null && p !== undefined && String(p).trim() !== "") {
    const n = Number(p);
    if (!Number.isInteger(n) || n <= 0 || n > PERIODO_MAXIMO_DIAS) {
      falta.push(`un período en días de 1 a ${PERIODO_MAXIMO_DIAS}`);
    }
  }

  return falta;
}

/**
 * El período que conviene proponerle a quien confirma.
 *
 * Es la mediana medida, **redondeada a la unidad con la que se habla**: nadie
 * programa «cada 27 días», programa «cada mes». Sin medición no se propone
 * nada, que es distinto de proponer cero.
 *
 * Los cortes salen de los ritmos que tiene esta planta: rotación de martillos
 * cada ~4 días, regulación de péndulos cada ~6, clasificación de cuerpos
 * moledores cada ~24. Por debajo de dos semanas el día importa y no se
 * redondea; de ahí para arriba, a semanas hasta el mes y a meses después.
 */
export function periodoSugerido(intervaloMedido: number | null): number | null {
  if (intervaloMedido === null || intervaloMedido <= 0) return null;
  if (intervaloMedido <= 14) return Math.round(intervaloMedido);
  if (intervaloMedido <= 31) return Math.round(intervaloMedido / 7) * 7;
  return Math.round(intervaloMedido / 30) * 30;
}
