/**
 * Qué dice el sistema de una OT y qué dice la planilla.
 *
 * ── POR QUÉ HACE FALTA ──────────────────────────────────────────────────────
 *
 * El 21/10/2026 la OT 2845 tenía el 1/10 en el sistema y el **3/10** en la
 * planilla, y las horas en el sistema y la celda vacía allá. Nadie se enteró:
 * las dos mitades se leen en pantallas distintas, y ninguna de las seis
 * comprobaciones del repo mira el dato del otro lado —`npm run planillas` mira
 * si la planilla se cayó, no si dice lo mismo que la base—.
 *
 * Una divergencia así **no avisa nunca**. La OT se lee bien en los dos lados;
 * simplemente dicen cosas distintas, y quien mira uno no mira el otro. Peor: en
 * cuanto una orden queda con `sheets_pendiente`, la importación **la saltea** a
 * propósito —para no pisar lo que el sistema sabe y la planilla todavía no—,
 * así que la diferencia se congela de los dos lados en vez de resolverse sola.
 *
 * ── LO DIFÍCIL NO ES COMPARAR: ES NO SONAR POR LO QUE NO IMPORTA ────────────
 *
 * Es la misma vara que `saludDePlanilla`. Hay tres diferencias que son normales
 * y que, si se informaran, harían que nadie mire la lista:
 *
 * 1. **La cola.** Una orden con `sheets_pendiente` **tiene** que diferir: el
 *    sistema sabe algo que la planilla todavía no. Eso no es una divergencia,
 *    es trabajo en curso, y se informa aparte.
 * 2. **El estado «por hacer».** Es el único que no se exporta nunca, porque la
 *    columna `M` del master trae `=IF(J="","",L)` y escribirla la reemplaza por
 *    un literal. Así que la planilla calcula sola «Por hacer» o «Atrasado»
 *    según la fecha, y que diga «Atrasado» mientras el sistema dice `POR_HACER`
 *    es exactamente lo que tiene que pasar.
 * 3. **Vacío contra nulo.** Una celda sin nada y un `null` son lo mismo.
 */

import type { OrdenLeida } from "@/lib/mantenimiento/ordenes";

/** Lo que el sistema guarda de una orden, en lo que se puede contrastar. */
export interface OrdenDelSistema {
  ot_number: number;
  sector_raw: string | null;
  equipo_raw: string | null;
  especialidad: string | null;
  tipo: string | null;
  quien: string | null;
  descripcion: string | null;
  fecha_ejecucion: string | null;
  fecha_cierre: string | null;
  estado: string | null;
  contratista: string | null;
  horas: number | null;
  operario_1: string | null;
  operario_2: string | null;
  operario_3: string | null;
  prioridad: string | null;
  /** Lo que el alta no pudo exportar. Mientras tenga algo, diferir es normal. */
  sheets_pendiente?: string | null;
  /**
   * La fecha de ejecución ya escrita en «Altas del sistema» que el derrame
   * del master todavía no refleja. Mientras tenga valor, que los dos lados
   * digan fechas distintas es lo normal y no un problema: el derrame tarda
   * de 3 a 53 horas, medido el 21/10/2026.
   */
  fecha_ejecucion_pendiente?: string | null;
}

export interface Divergencia {
  ot_number: number;
  campo: string;
  enElSistema: string;
  enLaPlanilla: string;
}

export interface Contraste {
  /** Lo que hay que mirar: dicen cosas distintas y nadie lo sabe. */
  divergencias: Divergencia[];
  /** Esperando que la planilla reciba la fila. No es un problema todavía. */
  enLaCola: number[];
  /** En el sistema y no en la planilla: el alta no llegó a escribir. */
  soloEnElSistema: number[];
  /** En la planilla y no en el sistema: falta sincronizar. */
  soloEnLaPlanilla: number[];
}

/** Los campos que se contrastan, con el nombre que se lee en pantalla. */
const CAMPOS: readonly [keyof OrdenDelSistema & keyof OrdenLeida, string][] = [
  ["sector_raw", "el sector"],
  ["equipo_raw", "el equipo"],
  ["especialidad", "la especialidad"],
  ["tipo", "el tipo"],
  ["quien", "quién lo realiza"],
  ["descripcion", "la descripción"],
  ["fecha_ejecucion", "la fecha de ejecución"],
  ["fecha_cierre", "la fecha de cierre"],
  ["estado", "el estado"],
  ["contratista", "el contratista"],
  ["horas", "las horas"],
  ["operario_1", "el operario 1"],
  ["operario_2", "el operario 2"],
  ["operario_3", "el operario 3"],
  ["prioridad", "la prioridad"],
];

/** Vacío y nulo son lo mismo; de los números importa el valor, no el texto. */
function comparable(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "number") return String(v);
  return String(v).trim();
}

/**
 * Los estados que la planilla calcula sola cuando el sistema dice «por hacer».
 *
 * La `M` de una orden por hacer lleva `=IF(J="","",L)`, así que muestra lo que
 * la `L` calcula: «Por hacer» hasta que la fecha se vence y «Atrasado»
 * después. El sistema sigue diciendo `POR_HACER` en los dos casos, y eso no es
 * una divergencia sino la fórmula haciendo su trabajo.
 *
 * **Hasta el 29/10/2026 esta excusa tapaba un defecto**, y conviene saber por
 * qué: el sistema NO escribía la `M` de una orden por hacer, creyendo que la
 * columna ya traía esa fórmula. No la traía. Entonces la celda quedaba vacía,
 * `estadoDeTexto` la leía como «por hacer», el sistema también decía «por
 * hacer», y esto la dejaba pasar. Ocho órdenes sin estado en la planilla que
 * el contraste no podía ver. De ahí sale `laCeldaDelEstadoEstaVacia`.
 */
const LOS_QUE_CALCULA_LA_PLANILLA = new Set(["POR_HACER", "ATRASADO"]);

function esElEstadoQueCalculaLaPlanilla(sistema: unknown, planilla: unknown): boolean {
  return comparable(sistema) === "POR_HACER"
    && LOS_QUE_CALCULA_LA_PLANILLA.has(comparable(planilla));
}

/**
 * La celda del ESTADO está vacía y no debería.
 *
 * Es un defecto distinto de los demás y por eso se mira aparte: no es que los
 * dos lados digan cosas distintas —el sistema dice «por hacer» y la celda
 * vacía también se lee «por hacer»—, es que **a la celda le falta la
 * fórmula**. Quien mire la planilla ve una orden sin estado, y cuando la
 * fecha se venza va a seguir sin verlo.
 *
 * **Sin fecha de ejecución no cuenta**, y ésa es la mitad que importa de esta
 * función: ahí `=IF(J="","",L)` devuelve vacío *porque corresponde* —no hay
 * nada que calcular—, así que marcarla sería ruido permanente. Es el caso de
 * la OT 622, la única del libro sin fecha.
 */
export function laCeldaDelEstadoEstaVacia(p: OrdenLeida): boolean {
  return comparable(p.estado_raw) === "" && comparable(p.fecha_ejecucion) !== "";
}

/**
 * Qué dicen distinto el sistema y la planilla, de las órdenes que están en los
 * dos lados.
 *
 * Es puro: lo que habla con Google y con la base es el script. Y no arregla
 * nada — decir qué pasa y decidir qué hacer son dos cosas, y la segunda la
 * toma una persona porque **no se sabe cuál de los dos lados tiene razón**.
 */
export function contrastar(
  sistema: readonly OrdenDelSistema[],
  planilla: readonly OrdenLeida[]
): Contraste {
  const enLaPlanilla = new Map<number, OrdenLeida>();
  for (const o of planilla) enLaPlanilla.set(o.ot_number, o);

  const divergencias: Divergencia[] = [];
  const enLaCola: number[] = [];
  const soloEnElSistema: number[] = [];
  const vistas = new Set<number>();

  for (const s of sistema) {
    vistas.add(s.ot_number);

    const p = enLaPlanilla.get(s.ot_number);
    if (!p) { soloEnElSistema.push(s.ot_number); continue; }

    // La cola no es una divergencia: es que el sistema sabe algo que la
    // planilla todavía no. Se informa aparte y no se compara, porque comparar
    // la contaría como problema cada vez.
    if (comparable(s.sheets_pendiente) !== "") { enLaCola.push(s.ot_number); continue; }

    // Lo mismo para una fecha que ya salió y todavía no derramó. Va acá y no
    // como una excepción del campo porque mientras esté en camino **toda** la
    // fila está en tránsito: compararle el resto sería informar diferencias
    // de una foto que se está moviendo.
    if (comparable(s.fecha_ejecucion_pendiente) !== "") { enLaCola.push(s.ot_number); continue; }

    // Va antes de comparar campo por campo porque no es una comparación: los
    // dos lados dicen «por hacer» y aun así la planilla está mal. Se informa
    // con el nombre del problema y no con el del campo, para que quien lo lea
    // sepa que lo que falta es la fórmula y no un dato.
    if (laCeldaDelEstadoEstaVacia(p)) {
      divergencias.push({
        ot_number: s.ot_number,
        campo: "la celda del estado, sin la fórmula",
        enElSistema: comparable(s.estado) || "(vacío)",
        enLaPlanilla: "(vacía: no dice nada y no se va a actualizar sola)",
      });
    }

    for (const [campo, nombre] of CAMPOS) {
      const a = comparable(s[campo]);
      const b = comparable(p[campo]);
      if (a === b) continue;
      if (campo === "estado" && esElEstadoQueCalculaLaPlanilla(s.estado, p.estado)) continue;

      divergencias.push({
        ot_number: s.ot_number,
        campo: nombre,
        enElSistema: a === "" ? "(vacío)" : a,
        enLaPlanilla: b === "" ? "(vacío)" : b,
      });
    }
  }

  const soloEnLaPlanilla = planilla
    .map((p) => p.ot_number)
    .filter((n) => !vistas.has(n));

  return {
    divergencias,
    enLaCola,
    soloEnElSistema,
    soloEnLaPlanilla: soloEnLaPlanilla.sort((a, b) => a - b),
  };
}

/**
 * Las divergencias agrupadas por orden, que es como se leen.
 *
 * Una OT con la fecha de ejecución y la de cierre corridas es **un** problema
 * con dos síntomas, no dos problemas: imprimirlas de a una hace que tres
 * órdenes parezcan nueve.
 */
export function porOrden(divergencias: readonly Divergencia[]): Map<number, Divergencia[]> {
  const m = new Map<number, Divergencia[]>();
  for (const d of divergencias) {
    const lista = m.get(d.ot_number) ?? [];
    lista.push(d);
    m.set(d.ot_number, lista);
  }
  return m;
}
