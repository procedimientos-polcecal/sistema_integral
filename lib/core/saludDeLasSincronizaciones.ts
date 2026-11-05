/**
 * Cuándo un recurso de sincronización está caído, y desde hace cuánto.
 *
 * Es `estadoDelPaso` de `lib/agenda/avisosDeLaAgenda.ts` sacado de la Agenda:
 * lo único que cambia es que la tolerancia llega por parámetro y no como la
 * constante `HORAS_SIN_CORRER`, porque cada recurso corre a su propio ritmo —un
 * cron diario no se mide con la vara de uno que corre cada 15 minutos—. Son
 * funciones puras: leer `ultima_sincronizacion` es de quien las llama.
 *
 * **Y la Agenda llama acá**: desde el 05/11/2026 su `estadoDelPaso` es una
 * envoltura de `estadoDeRecurso` con `HORAS_SIN_CORRER`. No quedan dos copias
 * de la misma decisión, porque de dos copias la que nadie toca es la que
 * termina mintiendo.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

/** Lo que `ultima_sincronizacion` dice de la última corrida de un recurso. */
export interface CorridaLeida {
  modulo: string;
  recurso: string;
  ok: boolean;
  /** Lo que dijo el recurso al fallar, sin traducir. */
  error: string | null;
  created_at: string;
}

/**
 * Lo único que hace falta para decir cómo está un recurso: si la última corrida
 * anduvo y cuándo fue.
 *
 * Es más angosto que `CorridaLeida` a propósito, para que la Agenda —que lee
 * las mismas filas con su propio tipo, sin `modulo`— pueda usar
 * `estadoDeRecurso` en vez de tener su propia copia de la misma decisión.
 */
export type CorridaParaElEstado = Pick<CorridaLeida, "ok" | "created_at">;

/** Cómo está un recurso. `sana` es la única que no es un problema. */
export type EstadoDeRecurso = "nunca" | "fallo" | "vieja" | "sana";

/**
 * «hace 5 h», «hace 2 días»: lo justo para saber si un recurso está al día.
 *
 * **No es `haceCuanto` de `lib/core/haceCuanto.ts`**, y por eso tiene otro
 * nombre: aquélla dice «hace 5 horas» y «recién», y una fecha ilegible le sale
 * como «nunca» —que acá sería mentir, porque corrió y lo que no se entiende es
 * cuándo—. Vivía en `lib/agenda/avisosDeLaAgenda.ts` y se mudó para acá cuando
 * la Agenda pasó a usar `estadoDeRecurso`: con la función allá, el core
 * importaba de la Agenda y la Agenda del core.
 */
export function haceCuantoCorto(desde: string, ahora: Date): string {
  const ms = ahora.getTime() - new Date(desde).getTime();
  if (Number.isNaN(ms)) return "en una fecha ilegible";
  const horas = Math.max(0, Math.round(ms / 3_600_000));
  if (horas < 48) return `hace ${horas} h`;
  return `hace ${Math.floor(horas / 24)} días`;
}

/**
 * **Tres cosas dejan caído a un recurso**, y la tercera es la que justifica que
 * esto exista:
 *
 *  1. La última corrida **falló** (`ok = false`): el recurso ya lo anotó, con lo
 *     que dijo del otro lado. Gana sobre la edad: un fallo de hace cuatro días
 *     se nombra por el fallo, que es lo que hay que arreglar, y no por «vieja».
 *  2. La última corrida es **vieja**: el recurso no corrió. **No deja ninguna
 *     fila de fallo** —si no corre, no escribe—, así que mirar sólo `ok` lo vería
 *     verde para siempre. Es el canal muerto que no se distingue de uno sano.
 *  3. **Nunca corrió**: no hay fila. Una sincronización que jamás corrió no está
 *     sana, aunque tampoco haya fallado.
 *
 * Una fecha ilegible cuenta como `vieja` y no como `sana`: no se puede afirmar
 * que corrió hace un rato con un dato que no se entiende, y equivocarse para el
 * lado de «todo bien» es justo lo que esta función existe para no hacer.
 */
export function estadoDeRecurso(
  corrida: CorridaParaElEstado | undefined,
  toleranciaHoras: number,
  ahora: Date
): EstadoDeRecurso {
  if (!corrida) return "nunca";
  if (!corrida.ok) return "fallo";
  const cuando = new Date(corrida.created_at).getTime();
  const corte = ahora.getTime() - toleranciaHoras * 3_600_000;
  return Number.isNaN(cuando) || cuando < corte ? "vieja" : "sana";
}

/**
 * La cantidad con la que un recurso caído entra a la campana y al resumen.
 *
 * **Su número no cuenta cosas.** No son recursos ni canales ni filas: son las
 * **tolerancias enteras** que lleva sin correr, y existe sólo para que
 * descartar el aviso no lo silencie para siempre. Es la misma nota de
 * `cantidadDelAviso` en `lib/home/ritmo.ts`: `filtrarDescartadas` vuelve a
 * mostrar un aviso cuando su cantidad superó a la que tenía al descartarlo,
 * así que un número fijo dejaría mudo a un recurso que sigue caído semanas, y
 * uno que crece solo cada noche haría inútil descartarlo. Contar tolerancias da
 * el punto medio: descartarlo a las 25 h (1) lo calla hasta las 48 h (2).
 *
 * Es al menos 1 en cualquier caso caído, porque un aviso con cantidad 0 no
 * existe: cubre el fallo reciente (la corrida es de hace una hora, 0
 * tolerancias de silencio, pero el recurso está caído), el recurso que nunca
 * corrió y la fecha ilegible —en esos dos últimos no hay desde cuándo contar,
 * y quedan en 1 fijo, igual que «nunca se cargó» en `cantidadDelAviso`—.
 */
export function cuantasTolerancias(
  corrida: CorridaLeida | undefined,
  toleranciaHoras: number,
  ahora: Date
): number {
  if (!corrida) return 1;
  const cuando = new Date(corrida.created_at).getTime();
  if (Number.isNaN(cuando)) return 1;
  const horasDeSilencio = (ahora.getTime() - cuando) / 3_600_000;
  return Math.max(1, Math.floor(horasDeSilencio / toleranciaHoras));
}

/**
 * ── EL REGISTRO ─────────────────────────────────────────────────────────────
 *
 * Declara **cuánto silencio tolera cada recurso** y cuáles no se vigilan. Es a
 * propósito una tabla escrita a mano, y no algo que se calcule, porque las dos
 * maneras de calcularla dan mal:
 *
 *  - **Derivarla del cron declarado** deja todo en rojo para siempre. Los crons
 *    de GitHub Actions declaran una frecuencia y corren otra: `mantenimiento/
 *    ordenes` declara cada 15 minutos y corre cada 3,5 h. Dos ciclos de 15
 *    minutos lo dejarían caído permanente contra una mediana real de 3,5 h.
 *  - **Derivarla de la propia historia** normaliza la escasez: un recurso que
 *    corre poco tendría una tolerancia larga *porque* corre poco, y la falta de
 *    corridas se volvería su costumbre.
 *
 * Por eso el número que va acá es **la tolerancia y no la cadencia**, y cada
 * uno lleva al lado lo que se midió (60 días, sólo corridas del despliegue
 * canónico, el 05/11/2026) para que se pueda revisar después. «Hueco mayor» es
 * el silencio más largo que ese recurso tuvo en esos 60 días sin que nada
 * estuviera roto: el piso por debajo del cual no se puede poner la tolerancia
 * sin que suene una alarma falsa.
 *
 * **Que alguien tenga que contestar la pregunta para un recurso nuevo es la
 * defensa**, no la tabla: `recursosSinDeclarar` nombra lo que la vista trae y
 * acá no está, y un test lo ata. Es la misma forma de
 * `scripts/revisar-exportaciones.mjs` —no decide si algo está bien, logra que
 * nadie agregue uno sin haber dicho qué espera de él—. El recurso que se
 * agrega sin declarar no queda mudo: queda nombrado.
 *
 * **Exceptuar no es no mirar.** Una entrada con `toleranciaHoras: null` no se
 * vigila, pero tiene que decir en cuál de tres familias cae y por qué. Cada una
 * es un caso donde la regla «una corrida vieja o fallida es un problema» da una
 * alarma falsa, y un fallo esperado que se ve igual que uno real entrena a no
 * mirar ninguno:
 *
 *  - `solo-escribe-si-hay-algo`: la fila se escribe únicamente cuando hay algo
 *    que decir, así que su edad no mide nada y un fallo queda clavado hasta el
 *    próximo evento.
 *  - `se-ve-en-otro-lado`: lo que le pasaría ya se ve, con más detalle, donde la
 *    persona lo mira de todos modos.
 *  - `apagado-a-proposito`: no corre porque alguien decidió que no corra; la
 *    entrada dice quién lo levanta y cómo.
 */
export type FamiliaDeExcepcion =
  | "solo-escribe-si-hay-algo"
  | "se-ve-en-otro-lado"
  | "apagado-a-proposito";

interface EntradaBase {
  modulo: string;
  /** Uno, o varios cuando una sola corrida los escribe a todos. */
  recursos: string[];
  titulo: string;
}

/** Una entrada que se vigila: tiene tolerancia y no tiene excepción. */
interface EntradaVigilada extends EntradaBase {
  toleranciaHoras: number;
  excepcion?: undefined;
}

/** Una entrada exceptuada: no tiene tolerancia y **tiene** que decir por qué. */
interface EntradaExceptuada extends EntradaBase {
  toleranciaHoras: null;
  excepcion: { familia: FamiliaDeExcepcion; porque: string; quienLoLevanta?: string };
}

/**
 * `toleranciaHoras` es `null` si y sólo si la entrada está exceptuada. Las dos
 * mitades son tipos distintos para que no se pueda escribir una exceptuada sin
 * su porqué ni una vigilada con excepción: el test lo comprueba sobre los
 * datos, el tipo lo comprueba al escribirlos.
 */
export type EntradaDelRegistro = EntradaVigilada | EntradaExceptuada;

export const REGISTRO: readonly EntradaDelRegistro[] = [
  // ── Mantenimiento: cada 15 min declarado, Actions corre cada ~3,5 h ──
  // Hueco mayor en 60 días: 10,2 h (mediana 3,5 h).
  { modulo: "mantenimiento", recursos: ["ordenes"], titulo: "Órdenes de trabajo", toleranciaHoras: 24 },
  { modulo: "mantenimiento", recursos: ["avisos"], titulo: "Avisos de Mantenimiento", toleranciaHoras: 24 },
  { modulo: "mantenimiento", recursos: ["ordenes-servicio"], titulo: "Órdenes de servicio", toleranciaHoras: 24 },
  { modulo: "mantenimiento", recursos: ["comparativas"], titulo: "Comparativas de Mantenimiento", toleranciaHoras: 24 },

  // ── Inventario: cada 15 min declarado. Hueco mayor 10,2 h (mediana 4,1 h) ──
  { modulo: "inventario", recursos: ["movimientos"], titulo: "Movimientos de inventario", toleranciaHoras: 24 },
  { modulo: "inventario", recursos: ["articulos"], titulo: "Artículos de inventario", toleranciaHoras: 24 },

  // Cantera: cada 20 min declarado. Hueco mayor 7,9 h (mediana 3,2 h).
  { modulo: "cantera", recursos: ["acarreo"], titulo: "Acarreo de Cantera", toleranciaHoras: 24 },

  // Taller Vial: cada 20 min declarado. Hueco mayor 9,4 h (mediana 3,9 h).
  { modulo: "taller_vial", recursos: ["cargas"], titulo: "Cargas de Taller Vial", toleranciaHoras: 24 },

  // ── Calidad: envases, cada 15 min declarado. Hueco mayor 10,1 h ──
  { modulo: "calidad", recursos: ["envases_movimientos"], titulo: "Movimientos de envases", toleranciaHoras: 24 },
  { modulo: "calidad", recursos: ["envases_articulos"], titulo: "Artículos de envases", toleranciaHoras: 24 },

  // Carbonilla: cron diario. 36 h y no 24: con 24 suena una corrida que sólo
  // llegó un poco tarde, y una corrida salteada igual suena a las 36.
  { modulo: "calidad", recursos: ["carbonilla-planilla"], titulo: "Carbonilla desde la planilla", toleranciaHoras: 36 },
  { modulo: "calidad", recursos: ["carbonilla-odoo"], titulo: "Carbonilla contra Odoo", toleranciaHoras: 36 },

  // ── RRHH ──
  // Cada 6 h declarado. Hueco mayor 13,1 h (mediana 7,3 h).
  { modulo: "rrhh", recursos: ["recalculo"], titulo: "Recálculo de RRHH", toleranciaHoras: 24 },
  // Diario (hueco mayor y mediana 24,0 h). 50 h: una corrida salteada no suena,
  // la segunda sí —el mismo cálculo que `HORAS_SIN_CORRER` de la Agenda—.
  { modulo: "rrhh", recursos: ["lenox-marcaciones"], titulo: "Marcaciones desde Lenox", toleranciaHoras: 50 },

  // ── Diarios: 50 h por la misma cuenta que Lenox ──
  { modulo: "produccion", recursos: ["molinos"], titulo: "Molinos desde el robot", toleranciaHoras: 50 },
  { modulo: "seguridad_higiene", recursos: ["respaldo_fotos"], titulo: "Respaldo de fotos de Seguridad e Higiene", toleranciaHoras: 50 },
  // Diario, 05:00 UTC. 50 h es el valor que ya tenían antes de este registro.
  { modulo: "agenda", recursos: ["canales"], titulo: "Canales de Google de la Agenda", toleranciaHoras: 50 },
  { modulo: "agenda", recursos: ["barrido"], titulo: "Barrido de las casillas de la Agenda", toleranciaHoras: 50 },

  // ── Respaldo: cron semanal, 2 corridas en 60 días, hueco mayor 170 h ──
  // **Una sola entrada para las ocho filas**: la corrida escribe una por pestaña
  // más una del conjunto («sheets») a propósito, para saber cuál pestaña quedó
  // vieja. Si cada una fuera una entrada, un cron muerto movería el conteo de 0
  // a 8 y taparía todo lo demás. 14 días y no 7: cada pestaña se borra y se
  // reescribe entera, así que un respaldo de hace tres días es válido y lo que
  // se mide es la edad de la última, no cuántas corridas faltaron.
  {
    modulo: "respaldo",
    recursos: [
      "sheets",
      "RRHH - Padron",
      "RRHH - Asistencia",
      "RRHH - Marcaciones",
      "Remises - Plan",
      "Remises - Asistencia",
      "Calidad - Ensayos",
      "Facturacion - Buzon",
    ],
    titulo: "Respaldo de las planillas",
    toleranciaHoras: 14 * 24,
  },

  // Compras: lo dispara un webhook y no un cron, así que no hay cadencia que
  // declarar. Hueco mayor 0,8 h el 05/11/2026.
  { modulo: "compras", recursos: ["planilla"], titulo: "Compras desde la planilla", toleranciaHoras: 24 },

  // ── Exceptuados ──
  {
    modulo: "agenda",
    recursos: ["pendientes"],
    titulo: "Reintento de lo pendiente de la Agenda",
    toleranciaHoras: null,
    excepcion: {
      familia: "se-ve-en-otro-lado",
      porque:
        "Es reescribir lo que no se pudo escribir, y eso ya se ve en el evento: un fallo acá no dice nada que el evento no diga.",
    },
  },
  {
    modulo: "agenda",
    recursos: ["aviso_de_google"],
    titulo: "Aviso de Google a la Agenda",
    toleranciaHoras: null,
    excepcion: {
      familia: "solo-escribe-si-hay-algo",
      porque:
        "La fila se escribe sólo cuando hay algo que decir, así que su edad no mide nada y un fallo queda clavado hasta el próximo aviso.",
    },
  },
  {
    modulo: "calidad",
    recursos: ["envases_bajada"],
    titulo: "Bajada semanal de envases",
    toleranciaHoras: null,
    excepcion: {
      familia: "apagado-a-proposito",
      porque:
        "El cron está apagado para no dejar una corrida en rojo todos los lunes: un fallo esperado que se ve igual que uno real entrena a no mirar ninguno.",
      quienLoLevanta:
        "admin_sistema, descomentando el `schedule:` de `.github/workflows/calidad-envases-bajada.yml`",
    },
  },
];

/** Una entrada del registro que está caída, lista para volverse un aviso. */
export interface EntradaCaida {
  /** `${modulo}/${recursos[0]}`: identifica a la entrada, no a cada recurso del grupo. */
  clave: string;
  titulo: string;
  estado: "nunca" | "fallo" | "vieja";
  /** Ver `cuantasTolerancias`: el silencio en tolerancias enteras, al menos 1. */
  tolerancias: number;
  /** El texto del error **sin traducir**, o cuánto hace que no corre. */
  detalle: string;
}

type EstadoCaido = Exclude<EstadoDeRecurso, "sana">;

/** De peor a mejor, para elegir «la peor» corrida de un grupo. */
const GRAVEDAD: Record<EstadoCaido, number> = { fallo: 3, nunca: 2, vieja: 1 };

const claveDe = (modulo: string, recurso: string) => `${modulo}/${recurso}`;

/**
 * Las entradas vigiladas que están caídas. **Una por entrada y no una por
 * recurso**, y de un grupo cuenta la peor corrida —un fallo gana sobre un
 * recurso que nunca corrió, y éste sobre uno viejo—: una pestaña del respaldo
 * rota hace caer al grupo y dice cuál.
 *
 * Un recurso de un grupo que **no está en la vista** cuenta como `nunca`: la
 * corrida los escribe a todos juntos, así que que falte uno es una anomalía
 * y no algo que se pueda dar por sano.
 */
export function entradasCaidas(corridas: CorridaLeida[], ahora: Date = new Date()): EntradaCaida[] {
  const porClave = new Map(corridas.map((c) => [claveDe(c.modulo, c.recurso), c]));
  const caidas: EntradaCaida[] = [];

  for (const entrada of REGISTRO) {
    if (entrada.toleranciaHoras === null) continue;

    let peor: { estado: EstadoCaido; corrida: CorridaLeida | undefined } | undefined;
    for (const recurso of entrada.recursos) {
      const corrida = porClave.get(claveDe(entrada.modulo, recurso));
      const estado = estadoDeRecurso(corrida, entrada.toleranciaHoras, ahora);
      if (estado === "sana") continue;
      // Entre dos del mismo estado queda la más vieja: es la que lleva más
      // tiempo así, y la que dice más de lo que hay que mirar.
      const pesa =
        !peor ||
        GRAVEDAD[estado] > GRAVEDAD[peor.estado] ||
        (GRAVEDAD[estado] === GRAVEDAD[peor.estado] &&
          corrida !== undefined &&
          peor.corrida !== undefined &&
          new Date(corrida.created_at).getTime() < new Date(peor.corrida.created_at).getTime());
      if (pesa) peor = { estado, corrida };
    }
    if (!peor) continue;

    caidas.push({
      clave: claveDe(entrada.modulo, entrada.recursos[0]),
      titulo: entrada.titulo,
      estado: peor.estado,
      tolerancias: cuantasTolerancias(peor.corrida, entrada.toleranciaHoras, ahora),
      detalle: detalleDe(peor.estado, peor.corrida, ahora),
    });
  }
  return caidas;
}

/** `fallo` dice lo que dijo el recurso, sin traducir; `vieja` y `nunca`, lo que se sabe. */
function detalleDe(estado: EstadoCaido, corrida: CorridaLeida | undefined, ahora: Date): string {
  if (estado === "nunca" || !corrida) return "nunca corrió";
  if (estado === "fallo") return corrida.error ?? "falló sin dejar el motivo";
  return haceCuantoCorto(corrida.created_at, ahora);
}

/**
 * Los recursos que la vista trae y el registro no nombra —**ni vigilados ni
 * exceptuados**—. Es la defensa de que el registro no se quede atrás: un
 * recurso nuevo que nadie declaró aparece acá en vez de pasar mudo.
 */
export function recursosSinDeclarar(corridas: CorridaLeida[]): string[] {
  const declarados = new Set(REGISTRO.flatMap((e) => e.recursos.map((r) => claveDe(e.modulo, r))));
  return corridas.map((c) => claveDe(c.modulo, c.recurso)).filter((clave) => !declarados.has(clave));
}

/** Lo que se pudo saber de la salud de todas las sincronizaciones. */
export interface SaludDelSistema {
  caidas: EntradaCaida[];
  sinDeclarar: string[];
  /**
   * **La comprobación misma falló.** No es «todo bien» ni es «algo cayó»: es que
   * no se sabe. Es un estado aparte y no un 0.
   */
  sinComprobar: boolean;
  /** Lo leído, para dibujar la pantalla. Vacío si no se pudo leer. */
  corridas: CorridaLeida[];
}

/**
 * La salud de todos los recursos, leída de `ultima_sincronizacion`. Es
 * `leerLaSaludDeLaAgenda` de `lib/agenda/avisosDeLaAgenda.ts` ensanchada de un
 * módulo a todos, y su docstring tiene el argumento largo; acá va el resumen.
 *
 * **Si la lectura falla NO devuelve 0**: devuelve `sinComprobar`. Es el único
 * aviso del sistema cuyo trabajo es detectar que algo dejó de funcionar en
 * silencio, y uno que dice «todo bien» cuando no pudo mirar cierra el fallo un
 * piso más abajo y lo abre un piso más arriba. Tampoco tira —ni por un error de
 * PostgREST ni por una excepción de red—: la campana corre en cada página del
 * sistema y no puede caerse por esto. El fallo va al log.
 *
 * Tampoco filtra por módulo, a diferencia de la de la Agenda: se quieren todos.
 * Y **no pagina con `traerTodo()`** a propósito: la vista trae **una fila por
 * recurso** (29 hoy), no una por corrida, así que no es una tabla que pueda
 * crecer hasta el corte de 1000 filas de PostgREST.
 */
export async function leerLaSalud(
  supabase: SupabaseClient,
  ahora: Date = new Date()
): Promise<SaludDelSistema> {
  try {
    const { data, error } = await supabase
      .from("ultima_sincronizacion")
      .select("modulo, recurso, ok, error, created_at")
      .returns<CorridaLeida[]>();
    if (error) throw new Error(error.message);
    // Sin error y sin datos tampoco es una lectura: no se afirma nada con ella.
    if (!data) throw new Error("la vista no devolvió datos ni error");
    return {
      caidas: entradasCaidas(data, ahora),
      sinDeclarar: recursosSinDeclarar(data),
      sinComprobar: false,
      corridas: data,
    };
  } catch (e) {
    console.error("salud: no se pudo comprobar la salud del sistema:", e instanceof Error ? e.message : e);
    return { caidas: [], sinDeclarar: [], sinComprobar: true, corridas: [] };
  }
}
