/**
 * El tablero del inicio de Taller Vial: lo que hay que mirar hoy, sin tener
 * que recorrer tablas. Todo acá es puro — no lee la base; quien llama arma
 * los datos con `consultas.ts` y las funciones de `combustible.ts`,
 * `estados.ts` y `service.ts`, y esto sólo decide qué merece atención.
 *
 * Los umbrales están arriba, con nombre, porque son criterio del taller y no
 * verdades técnicas: si "siete días sin cargar" resulta ser mucho o poco, se
 * cambia acá y no en la pantalla.
 */

import type { CargaConTrabajo } from "./combustible";
import type { EstadoDiario, EstadoPlano } from "./estados";
import type { LecturaDeService } from "./service";

/** Días seguidos fuera de servicio a partir de los cuales deja de ser "una parada" y pasa a ser un problema. */
const DIAS_FS_PROLONGADO = 3;
/** Piso de días sin cargar: aunque un equipo cargue todos los días, una semana sin cargar no es una demora. */
const DIAS_SIN_CARGA_MINIMO = 7;
/** Cuántas veces su intervalo habitual de carga tiene que pasar sin cargar para avisar. */
const VECES_EL_INTERVALO_HABITUAL = 3;
/** Un intervalo habitual con menos cargas que éstas es una suposición, no una costumbre. */
const MIN_CARGAS_PARA_CONOCER_LA_COSTUMBRE = 5;
/** Un equipo sin ninguna carga en este tiempo no "dejó de cargar": ya estaba parado o no consume (carretón). No se avisa. */
const VENTANA_EQUIPO_ACTIVO = 60;
/** Si ningún equipo cargó en tantos días, el problema no es de un equipo: nadie está anotando. */
const DIAS_SIN_CARGAS_EN_TODA_LA_FLOTA = 4;
/**
 * Consumo: se compara una ventana reciente entera —no una carga suelta—
 * contra los meses anteriores del mismo equipo. Una carga sola es puro ruido:
 * no siempre se llena el tanque, y EM4 va de 4,5 a 24,6 L/hs en un mismo mes
 * sin que nada raro pase. Medido el 06/10/2026 sobre las cargas reales.
 */
const VENTANA_CONSUMO_RECIENTE = 30;
const VENTANA_CONSUMO_REFERENCIA = 180;
const FACTOR_CONSUMO_ALTO = 1.25;
const MIN_CARGAS_RECIENTES = 3;
const MIN_CARGAS_DE_REFERENCIA = 5;
/** Las cargas con problemas más viejas que esto no se listan: ya no se pueden arreglar con provecho. */
const DIAS_A_REVISAR = 120;
/** Una fecha anterior a ésta es un error de tipeo (2006, 0226), no una carga vieja. */
const ANIO_MINIMO_PLAUSIBLE = 2020;

// ── Fechas ────────────────────────────────────────────────────────────────

function aMs(iso: string): number {
  const [a, m, d] = iso.split("-").map(Number);
  return Date.UTC(a, m - 1, d);
}

/** Días de calendario entre dos "YYYY-MM-DD" (hasta − desde). */
export function diasEntre(desde: string, hasta: string): number {
  return Math.round((aMs(hasta) - aMs(desde)) / 86400000);
}

/** "YYYY-MM-DD" desplazado `dias` días (negativo hacia atrás). */
function sumarDias(iso: string, dias: number): string {
  return new Date(aMs(iso) + dias * 86400000).toISOString().slice(0, 10);
}

/**
 * Si una fecha puede ser real: no anterior a 2020 ni posterior a mañana. Una
 * carga con fecha 2006 o "0226" es un error de tipeo en la planilla; si entra
 * a las cuentas se ordena primero y rompe el encadenado de lecturas.
 */
export function fechaPlausible(fecha: string, hoy: string): boolean {
  return Number(fecha.slice(0, 4)) >= ANIO_MINIMO_PLAUSIBLE && fecha <= sumarDias(hoy, 1);
}

const NUM1 = new Intl.NumberFormat("es-AR", { maximumFractionDigits: 1 });
const NUM0 = new Intl.NumberFormat("es-AR", { maximumFractionDigits: 0 });

/** "2026-09-28" → "28/09", para los textos cortos. */
function diaMes(iso: string): string {
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
}

// ── Tarjetas de la flota ──────────────────────────────────────────────────

export interface TarjetaDeEquipo {
  equipoId: string;
  /** Null si nunca se cargó un estado de este equipo. */
  estado: EstadoDiario | null;
  /** Desde cuándo está en ese estado, sin interrupción. Null junto con `estado`. */
  desde: string | null;
  /** Días que lleva en ese estado, contando hoy. */
  diasEnEstado: number | null;
  /** La última lectura de horómetro/km cargada. */
  horometro: number | null;
  ultimaCarga: string | null;
  diasSinCarga: number | null;
}

/**
 * Una tarjeta por equipo: cómo está, hace cuánto, cuánto marca y cuándo
 * cargó por última vez.
 *
 * La racha del estado se corta en el primer día registrado con otro estado.
 * Un día sin registro NO la corta: la planilla no tiene todos los días de
 * todos los equipos, y tratar un hueco como un cambio de estado inventaría
 * rachas que nadie cargó.
 */
export function tarjetasDeFlota(
  equipoIds: string[],
  estados: EstadoPlano[],
  cargas: { equipoId: string; fecha: string; lectura: number | null }[],
  hoy: string
): TarjetaDeEquipo[] {
  return equipoIds.map((equipoId) => {
    const delEquipo = estados.filter((e) => e.equipoId === equipoId).sort((a, b) => a.fecha.localeCompare(b.fecha));
    let estado: EstadoDiario | null = null;
    let desde: string | null = null;
    if (delEquipo.length > 0) {
      estado = delEquipo[delEquipo.length - 1].estado;
      desde = delEquipo[delEquipo.length - 1].fecha;
      for (let i = delEquipo.length - 2; i >= 0 && delEquipo[i].estado === estado; i--) desde = delEquipo[i].fecha;
    }

    const cargasDelEquipo = cargas.filter((c) => c.equipoId === equipoId);
    const ultimaCarga = cargasDelEquipo.reduce<string | null>((f, c) => (f === null || c.fecha > f ? c.fecha : f), null);
    // Un 0 no es una lectura: la planilla lo trae de relleno (EM8, EM15) y mostrarlo diría que el equipo marca cero.
    const conLectura = cargasDelEquipo.filter((c) => c.lectura !== null && c.lectura > 0);
    const ultimaConLectura = conLectura.reduce<(typeof conLectura)[number] | null>(
      (m, c) => (m === null || c.fecha > m.fecha ? c : m),
      null
    );

    return {
      equipoId,
      estado,
      desde,
      diasEnEstado: desde !== null ? Math.max(1, diasEntre(desde, hoy) + 1) : null,
      horometro: ultimaConLectura?.lectura ?? null,
      ultimaCarga,
      diasSinCarga: ultimaCarga !== null ? Math.max(0, diasEntre(ultimaCarga, hoy)) : null,
    };
  });
}

// ── Alertas ───────────────────────────────────────────────────────────────

export type TipoDeAlerta = "FUERA_DE_SERVICIO" | "SIN_CARGA" | "FLOTA_SIN_CARGAS" | "CONSUMO_ALTO" | "SERVICE_VENCIDO" | "SERVICE_PROXIMO";

export interface Alerta {
  tipo: TipoDeAlerta;
  /** "critica" va en rojo y primero; "atencion" en ámbar. */
  nivel: "critica" | "atencion";
  /** Null en una alerta de toda la flota. */
  equipoId: string | null;
  /** El texto sin el nombre del equipo: la pantalla lo pone adelante. */
  texto: string;
}

export interface ServiceParaAlerta {
  equipoId: string;
  lectura: LecturaDeService | null;
  horasFaltantes: number | null;
}

/**
 * Lo que pide acción, ordenado: primero lo crítico. `unidadDe` da "hs" o "km"
 * para los textos de consumo.
 */
export function alertasDeFlota(datos: {
  tarjetas: TarjetaDeEquipo[];
  cargasConTrabajo: CargaConTrabajo[];
  services: ServiceParaAlerta[];
  unidadDe: (equipoId: string) => string;
  hoy: string;
}): Alerta[] {
  const { tarjetas, cargasConTrabajo, services, unidadDe, hoy } = datos;
  const alertas: Alerta[] = [];

  // Si nadie cargó nada en días, una alerta por equipo sería la misma noticia
  // ocho veces: se dice una vez, y las individuales no se repiten.
  const ultimaDeLaFlota = tarjetas.reduce<string | null>((f, t) => (t.ultimaCarga !== null && (f === null || t.ultimaCarga > f) ? t.ultimaCarga : f), null);
  const diasSinCargasEnLaFlota = ultimaDeLaFlota !== null ? diasEntre(ultimaDeLaFlota, hoy) : null;
  const nadieCargo = diasSinCargasEnLaFlota !== null && diasSinCargasEnLaFlota >= DIAS_SIN_CARGAS_EN_TODA_LA_FLOTA;
  if (nadieCargo) {
    alertas.push({
      tipo: "FLOTA_SIN_CARGAS", nivel: "critica", equipoId: null,
      texto: `No se cargó combustible de ningún equipo hace ${diasSinCargasEnLaFlota} días (última carga el ${diaMes(ultimaDeLaFlota!)}). Si se están cargando, falta anotarlas`,
    });
  }

  for (const t of tarjetas) {
    if (t.estado === "FUERA_DE_SERVICIO" && t.diasEnEstado !== null && t.diasEnEstado >= DIAS_FS_PROLONGADO) {
      alertas.push({
        tipo: "FUERA_DE_SERVICIO", nivel: "critica", equipoId: t.equipoId,
        texto: `Fuera de servicio hace ${t.diasEnEstado} días (desde el ${diaMes(t.desde!)})`,
      });
    }

    if (nadieCargo || t.estado === "FUERA_DE_SERVICIO" || t.diasSinCarga === null || t.diasSinCarga > VENTANA_EQUIPO_ACTIVO) continue;

    // Cada equipo tiene su costumbre: EM5 carga casi todos los días, EM1 cada
    // semana. Un mismo corte de 7 días le avisaría tarde al primero y de más
    // al segundo.
    const fechas = cargasConTrabajo
      .filter((c) => c.equipoId === t.equipoId && c.fecha >= sumarDias(hoy, -VENTANA_CONSUMO_REFERENCIA))
      .map((c) => c.fecha)
      .sort();
    if (fechas.length < MIN_CARGAS_PARA_CONOCER_LA_COSTUMBRE) continue;
    const intervalos = fechas.slice(1).map((f, i) => diasEntre(fechas[i], f)).sort((a, b) => a - b);
    const habitual = intervalos[Math.floor(intervalos.length / 2)];
    const umbral = Math.max(DIAS_SIN_CARGA_MINIMO, habitual * VECES_EL_INTERVALO_HABITUAL);
    if (t.diasSinCarga > umbral) {
      alertas.push({
        tipo: "SIN_CARGA", nivel: "atencion", equipoId: t.equipoId,
        texto: `Sin cargar combustible hace ${t.diasSinCarga} días (suele cargar cada ${habitual || 1}; última el ${diaMes(t.ultimaCarga!)})`,
      });
    }
  }

  const corteReciente = sumarDias(hoy, -VENTANA_CONSUMO_RECIENTE);
  const corteReferencia = sumarDias(hoy, -VENTANA_CONSUMO_REFERENCIA);
  const equiposConCargas = [...new Set(cargasConTrabajo.map((c) => c.equipoId))];
  for (const equipoId of equiposConCargas) {
    const conConsumo = cargasConTrabajo.filter((c) => c.equipoId === equipoId && c.consumoPorUnidad !== null && c.trabajado !== null);
    const recientes = conConsumo.filter((c) => c.fecha >= corteReciente);
    const referencia = conConsumo.filter((c) => c.fecha < corteReciente && c.fecha >= corteReferencia);
    if (recientes.length < MIN_CARGAS_RECIENTES || referencia.length < MIN_CARGAS_DE_REFERENCIA) continue;

    const consumoDe = (l: CargaConTrabajo[]) => l.reduce((x, c) => x + c.litros, 0) / l.reduce((x, c) => x + c.trabajado!, 0);
    const actual = consumoDe(recientes);
    const habitual = consumoDe(referencia);
    if (!(actual > habitual * FACTOR_CONSUMO_ALTO)) continue;

    alertas.push({
      tipo: "CONSUMO_ALTO", nivel: "atencion", equipoId,
      texto: `Consume ${NUM1.format(actual)} L/${unidadDe(equipoId)} en el último mes, ${Math.round((actual / habitual - 1) * 100)}% más que lo habitual (${NUM1.format(habitual)})`,
    });
  }

  for (const s of services) {
    if (s.lectura === "VENCIDO" && s.horasFaltantes !== null) {
      alertas.push({
        tipo: "SERVICE_VENCIDO", nivel: "critica", equipoId: s.equipoId,
        texto: `Service de 250 hs vencido hace ${NUM0.format(Math.abs(s.horasFaltantes))} hs`,
      });
    } else if (s.lectura === "PROXIMO" && s.horasFaltantes !== null) {
      alertas.push({
        tipo: "SERVICE_PROXIMO", nivel: "atencion", equipoId: s.equipoId,
        texto: `Service de 250 hs en ${NUM0.format(s.horasFaltantes)} hs`,
      });
    }
  }

  return alertas.sort((a, b) => (a.nivel === b.nivel ? 0 : a.nivel === "critica" ? -1 : 1));
}

// ── Cargas para revisar ───────────────────────────────────────────────────

export type TipoDeProblemaDeCarga = "FECHA_DUDOSA" | "SIN_EQUIPO" | "LECTURA_MENOR" | "LECTURA_MAYOR";

export interface ProblemaDeCarga {
  tipo: TipoDeProblemaDeCarga;
  cargaId: string;
  fecha: string;
  equipoId: string | null;
  equipoRaw: string;
  detalle: string;
}

/**
 * Las cargas con un dato que probablemente está mal, antes de que ensucie los
 * consumos. Tres clases:
 *
 * - **Fecha imposible** (2006, "0226"): error de tipeo en la planilla.
 * - **Sin equipo reconocido**: la planilla nombra algo que no es un equipo
 *   móvil (o lo escribieron distinto). Los litros están en el total pero no
 *   en ningún equipo.
 * - **Lectura que no cuadra** con las demás. Un horómetro sólo sube, así que
 *   un valor menor que el anterior, o mayor que el siguiente, es casi siempre
 *   un error de tipeo (7.995 → 79.950). Se marca la carga rara y no la de al
 *   lado.
 *
 * Las cargas del mismo día se ordenan por lectura: dos cargas el mismo día no
 * tienen un orden real, y sin esto una carga correcta aparecería "menor".
 */
export function revisarCargas(
  todas: { id: string; equipoId: string | null; equipoRaw: string; fecha: string; lectura: number | null }[],
  hoy: string
): ProblemaDeCarga[] {
  const problemas: ProblemaDeCarga[] = [];
  const desde = sumarDias(hoy, -DIAS_A_REVISAR);

  // La fecha imposible se avisa siempre, sin importar cuán vieja parezca (si
  // dice 2006 no se sabe cuán vieja es), y la carga queda fuera del resto:
  // en una fecha inventada no hay lectura que comparar.
  const cargas = todas.filter((c) => {
    if (fechaPlausible(c.fecha, hoy)) return true;
    problemas.push({
      tipo: "FECHA_DUDOSA", cargaId: c.id, fecha: c.fecha, equipoId: c.equipoId, equipoRaw: c.equipoRaw,
      detalle: `La fecha ${c.fecha} no puede ser real: seguro es un error de tipeo en la planilla`,
    });
    return false;
  });

  for (const c of cargas) {
    if (c.equipoId === null && c.fecha >= desde) {
      problemas.push({
        tipo: "SIN_EQUIPO", cargaId: c.id, fecha: c.fecha, equipoId: null, equipoRaw: c.equipoRaw,
        detalle: "No se reconoce el equipo: los litros cuentan en el total pero no en ninguno",
      });
    }
  }

  const porEquipo = new Map<string, typeof cargas>();
  for (const c of cargas) {
    if (c.equipoId === null || c.lectura === null) continue;
    const lista = porEquipo.get(c.equipoId) ?? [];
    lista.push(c);
    porEquipo.set(c.equipoId, lista);
  }

  for (const [equipoId, lista] of porEquipo) {
    const s = [...lista].sort((a, b) => a.fecha.localeCompare(b.fecha) || a.lectura! - b.lectura!);

    // La subsecuencia creciente más larga son las lecturas que "cuadran
    // entre sí"; las que quedan afuera son las que hay que mirar. Comparar de
    // a pares no alcanza: un 79.500 donde iba 7.950 haría quedar mal parada a
    // la carga siguiente, que está bien.
    const largo = s.map(() => 1);
    const anterior = s.map(() => -1);
    for (let i = 0; i < s.length; i++) {
      for (let j = 0; j < i; j++) {
        if (s[j].lectura! <= s[i].lectura! && largo[j] + 1 > largo[i]) { largo[i] = largo[j] + 1; anterior[i] = j; }
      }
    }
    // En un empate se queda con la cadena que termina más tarde: lo último que se cargó es lo más probable que esté bien.
    let fin = 0;
    for (let i = 1; i < s.length; i++) if (largo[i] >= largo[fin]) fin = i;
    const cuadra = new Set<number>();
    for (let i = fin; i >= 0 && s.length > 0; i = anterior[i]) cuadra.add(i);

    for (let i = 0; i < s.length; i++) {
      if (cuadra.has(i) || s[i].fecha < desde) continue;
      const l = s[i].lectura!;
      let k = i - 1;
      while (k >= 0 && !cuadra.has(k)) k--;
      let n = i + 1;
      while (n < s.length && !cuadra.has(n)) n++;
      const prev = k >= 0 ? s[k] : null;
      const next = n < s.length ? s[n] : null;

      if (prev && l < prev.lectura!) {
        problemas.push({
          tipo: "LECTURA_MENOR", cargaId: s[i].id, fecha: s[i].fecha, equipoId, equipoRaw: s[i].equipoRaw,
          detalle: `Lectura ${NUM1.format(l)}, menor que la de la carga anterior (${NUM1.format(prev.lectura!)} el ${diaMes(prev.fecha)}): una de las dos tiene un error`,
        });
      } else if (next) {
        problemas.push({
          tipo: "LECTURA_MAYOR", cargaId: s[i].id, fecha: s[i].fecha, equipoId, equipoRaw: s[i].equipoRaw,
          detalle: `Lectura ${NUM1.format(l)}, mayor que la de la carga siguiente (${NUM1.format(next.lectura!)} el ${diaMes(next.fecha)}): una de las dos tiene un error`,
        });
      }
    }
  }

  // Las fechas imposibles primero: ordenadas por fecha quedarían al final del todo.
  const rango = (p: ProblemaDeCarga) => (p.tipo === "FECHA_DUDOSA" ? 0 : 1);
  return problemas.sort((a, b) => rango(a) - rango(b) || b.fecha.localeCompare(a.fecha));
}

// ── Consumo contra el promedio del propio equipo ──────────────────────────

export type NivelDeConsumo = "NORMAL" | "ATENCION" | "ALTO";

export interface BarraDeConsumo {
  /** Ancho de la barra, 0–100. */
  anchoPct: number;
  /** Dónde cae el promedio histórico sobre la barra, 0–100. Null sin referencia. */
  marcaPct: number | null;
  /** Cuánto se aleja del promedio: +12 es 12% más. Null sin referencia. */
  desvioPct: number | null;
  nivel: NivelDeConsumo | null;
}

/** La escala llega a 1,5× el promedio: la marca queda a 2/3 del ancho y hay lugar para ver cuánto se pasa. */
const ESCALA_DE_BARRA = 1.5;

/**
 * La barra de un equipo: el consumo del mes contra su propio promedio de los
 * meses anteriores. Se compara contra uno mismo y no contra otros equipos
 * porque un camión (L/km) y una excavadora (L/hs) no tienen una escala común,
 * y porque lo que importa no es quién consume más sino quién consume más de lo
 * que le corresponde.
 *
 * Hasta +10% es normal, hasta +25% pide un vistazo, más que eso es alto.
 */
export function barraDeConsumo(consumoDelMes: number | null, referencia: number | null): BarraDeConsumo {
  if (consumoDelMes === null) return { anchoPct: 0, marcaPct: null, desvioPct: null, nivel: null };
  if (referencia === null || referencia <= 0) return { anchoPct: 50, marcaPct: null, desvioPct: null, nivel: null };

  const razon = consumoDelMes / referencia;
  return {
    anchoPct: Math.min(100, (razon / ESCALA_DE_BARRA) * 100),
    marcaPct: (1 / ESCALA_DE_BARRA) * 100,
    desvioPct: Math.round((razon - 1) * 100),
    nivel: razon <= 1.1 ? "NORMAL" : razon <= 1.25 ? "ATENCION" : "ALTO",
  };
}

// ── Tendencia de la disponibilidad ────────────────────────────────────────

export interface DisponibilidadDelMes {
  mes: string; // "YYYY-MM"
  /** Días operativo sobre días con estado cargado, de toda la flota. Null si ese mes no tiene ningún dato. */
  pct: number | null;
  dias: number;
}

/**
 * La disponibilidad de toda la flota mes a mes. Misma cuenta que el informe
 * mensual (`armarInformeDisponibilidad`): días operativo sobre días
 * registrados; "con fallas" y "fuera de servicio" cuentan como no disponible.
 * Sumada sobre todos los equipos, no el promedio de los porcentajes: un equipo
 * con tres días cargados no pesa lo mismo que uno con treinta.
 */
export function disponibilidadMensualDeLaFlota(estados: EstadoPlano[], meses: string[]): DisponibilidadDelMes[] {
  return meses.map((mes) => {
    const delMes = estados.filter((e) => e.fecha.startsWith(mes));
    const operativos = delMes.filter((e) => e.estado === "OPERATIVO").length;
    return { mes, pct: delMes.length > 0 ? (operativos / delMes.length) * 100 : null, dias: delMes.length };
  });
}
