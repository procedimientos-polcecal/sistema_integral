/**
 * La orden de trabajo que sale de un aviso.
 *
 * ── QUÉ SE ROMPIÓ, Y POR QUÉ NO LO VIO NADIE ────────────────────────────────
 *
 * El 19/10/2026 una OT nueva pasó a exigir siete campos —sector, equipo,
 * descripción, especialidad, tipo, quién lo realiza y fecha de ejecución—
 * porque de ellos viven el MTBF, el atraso y las horas por sector. El botón de
 * «generar OT» de la pantalla de avisos mandaba **seis campos y ninguno de
 * esos tres últimos**, así que desde ese día contestaba «Falta cargar la
 * especialidad, quién lo realiza, la fecha de ejecución» y no generaba nada.
 *
 * Nada lo notó porque **las dos mitades están en archivos distintos y ninguna
 * sabe de la otra**: la regla es una lista de strings en `altaDeOT.ts` y el
 * botón era un `JSON.stringify` a mano en un `.tsx`. No hay tipo que los una
 * —el cuerpo de un `fetch` es `any`— ni test que los cruce, porque las
 * pantallas no tienen tests.
 *
 * ── LO QUE HACE ESTE ARCHIVO, QUE ES LO ÚNICO QUE IMPIDE QUE VUELVA ──────────
 *
 * **Ya no hay un formulario recortado para los avisos.** Se unificaron: desde
 * un aviso se abre el mismo formulario completo que para una OT cualquiera
 * (`NuevaOTModal`), y el aviso sólo lo **siembra**. Lo que sigue en pie de
 * aquel arreglo es la raíz del bug: el formulario no tiene su propia lista de
 * campos obligatorios, sino que pregunta por lo que nombre `loQueFaltaParaCrear`
 * —la misma función que corre el servidor—. Por eso `sembradoDesdeElAviso`
 * sale de `loQuePropone` y no es una segunda regla de sembrado: dos reglas
 * que tenían que decir lo mismo y vivían en archivos distintos fueron
 * exactamente lo que se rompió.
 *
 * ── DESDE UN AVISO TAMBIÉN SE PUEDE CARGAR TRABAJO YA HECHO ──────────────────
 *
 * Antes la orden que nacía de un aviso nacía siempre cerrada en «por hacer»,
 * con `fecha_cierre` vacía: se pensó que un aviso pide trabajo y no carga
 * trabajo hecho, y el formulario recortado ni mostraba esos dos campos. **Eso
 * dejó de ser cierto**: el pedido fue que el formulario fuera el mismo, así
 * que desde un aviso se ven y se pueden usar «estado inicial» y «fecha de
 * cierre». Registrar contra un aviso un trabajo que ya se hizo es un caso real
 * —quien lo arregló antes de que alguien lo cargara—, y no queda sin control:
 * con fecha de cierre `loQueFaltaParaCrear` exige las horas y quién lo hizo,
 * igual que en cualquier otra OT.
 *
 * ── EL AVISO PROPONE; LA ORDEN LA ESCRIBE UNA PERSONA ───────────────────────
 *
 * Desde el 21/10/2026 **todo lo que la orden va a decir se puede cambiar antes
 * de crearla**. El aviso llena el formulario —equipo, sector, qué pasa, con
 * qué urgencia— y lo que quede es lo que se guarda.
 *
 * No es comodidad: un aviso lo escribe quien ve la falla, con las palabras que
 * tiene a mano —«TRANSMISION HORNO 4 SALTA LA CADENA»—, y la OT la lee después
 * quien la va a hacer y quien va a contar las horas contra esa máquina. Que el
 * texto del aviso fuera además, sin tocar, el texto de la orden obligaba a
 * elegir entre dejar la orden mal escrita o no usar el botón.
 *
 * **El aviso no se toca.** Lo que se corrige acá es la orden: el aviso sigue
 * diciendo lo que dijo quien lo cargó, que es lo que lo hace una prueba de qué
 * se reportó y cuándo.
 */

import { prioridadDeUrgencia } from "@/lib/mantenimiento/avisos";
import { prioridadParaLaPlanilla, PRIORIDAD_MEDIA } from "@/lib/mantenimiento/prioridad";

/** Lo que de un aviso hace falta para armar la orden. */
export interface AvisoParaLaOT {
  id: string;
  oa_number: string | null;
  descripcion: string | null;
  urgencia: string | null;
  sector_id: string | null;
  sector_raw: string | null;
  equipment_id: string | null;
  equipo_raw: string | null;
  equipo_code: string | null;
  /**
   * La columna `repuesto` del aviso. **Hoy no viaja a la orden** y el porqué
   * está en `extrasDelAviso`; se nombra igual porque es de acá de donde
   * saldría el primer renglón de `repuestos` el día que esa columna se use.
   */
  repuesto: string | null;
}

/**
 * Lo que va a decir la orden.
 *
 * Arranca con lo que el aviso propone —ver `loQuePropone`— y se puede cambiar
 * entero antes de crearla. Lo que llega acá es lo que se guarda: la ruta no
 * vuelve a mirar el aviso para ninguno de estos campos.
 */
export interface RespuestasDelAviso {
  /** Lo que el aviso no puede contestar de ninguna manera. */
  especialidad: string;
  quien: string;
  fecha_ejecucion: string;
  /**
   * Cuándo se estima que termina. El aviso no lo sabe: lo estima quien va a
   * hacer el trabajo, y la real es la de cierre, que una OT recién pedida no
   * tiene. Que sea obligatoria lo decide `loQueFaltaParaCrear`, no este tipo.
   */
  fecha_fin: string;
  /** Lo que el aviso propone y se puede corregir. */
  descripcion: string;
  tipo: string;
  prioridad: string;
  sector_id: string;
  sector_raw: string;
  equipment_id: string;
  equipo_raw: string;
  equipo_code: string;
  /**
   * Las tres notas GUT, como las deja el desplegable: "" sin elegir o "1" a
   * "5". **No vienen del aviso** —ver `loQuePropone`— y por eso no están entre
   * los que el aviso propone.
   */
  gut_gravedad: string;
  gut_urgencia: string;
  gut_tendencia: string;
}

/**
 * Con qué arranca el formulario.
 *
 * **Correctiva siempre**: alguien reportó una falla, no es un preventivo
 * programado. Y la prioridad sale de la urgencia del aviso por
 * `prioridadDeUrgencia`, que es la traducción que ya existía — no una segunda.
 *
 * ── Y SALE CON EL EMOJI, PORQUE ACÁ YA NO TERMINA EN LA RUTA ────────────────
 *
 * `prioridadDeUrgencia` devuelve la palabra pelada —"MEDIA"— y eso alcanzaba
 * mientras esto llenaba un formulario propio, que ofrecía esas mismas tres
 * palabras. Desde que el aviso siembra el formulario completo, quien muestra
 * este valor es el desplegable de `NuevaOTModal`, que ofrece
 * `PRIORIDADES_DE_OT` —"🟠 Alta", "🟡 Media", "🟢 Baja"—: con la palabra pelada
 * **ninguna opción coincide y el campo se abre en blanco**. Si nadie lo toca el
 * dato igual sale bien, porque la ruta normaliza; si alguien lo toca, elige a
 * ciegas sobre una urgencia que nunca llegó a ver.
 *
 * Por eso la segunda traducción —`prioridadParaLaPlanilla`, la misma que corre
 * la ruta— se aplica acá y no se inventa un emoji al lado: sigue habiendo una
 * sola tabla de equivalencias, y la ruta la vuelve a aplicar sin efecto porque
 * es idempotente ("🟡 Media" entra y sale igual). Lo ata el test «el valor
 * sembrado existe en el desplegable», que pregunta por `PRIORIDADES_DE_OT` y no
 * por la función de la que sale: comparar el sembrado contra su propia fuente
 * da verde pase lo que pase, y es lo que dejó pasar esto.
 *
 * Los tres que el aviso no puede contestar quedan como se los pase quien
 * llama: la especialidad vacía —el aviso no da ni un indicio y acertarle de
 * memoria sería enlazar al que se le parece— y los otros dos con el valor
 * normal, que se ve y se cambia.
 *
 * ── EL PUNTAJE GUT ARRANCA VACÍO, Y NO SE SIEMBRA DESDE LA URGENCIA ─────────
 *
 * Acá, con `prioridadDeUrgencia` a la vista, es donde alguien va a querer
 * escribir `gut_urgencia: …` «para ahorrarle un click a quien genera la
 * orden». Parece gratis y parece correcto, y es justo lo que el diseño del GUT
 * no quiere (docs/superpowers/specs/2026-10-21-mantenimiento-gut-design.md,
 * «nadie hereda un puntaje»).
 *
 * La urgencia de un aviso la puso **quien reportó la falla**, con lo que ve
 * desde su puesto; el GUT lo contesta **quien reparte el trabajo**, mirando
 * cuánto tiempo hay y hacia dónde va. Son dos personas mirando dos cosas, y
 * una nota sembrada pesaría en el orden exactamente igual que una que alguien
 * contestó: un número que nadie contestó, impreso como si fuera una medición.
 * Las tres notas quedan en blanco y las contesta una persona; sin las tres, la
 * orden vale 27 en la lista, que es lo que corresponde a una sin puntuar.
 */
export function loQuePropone(
  aviso: AvisoParaLaOT,
  deEntrada: { quien: string; fecha_ejecucion: string }
): RespuestasDelAviso {
  return {
    especialidad: "",
    quien: deEntrada.quien,
    fecha_ejecucion: deEntrada.fecha_ejecucion,
    // El aviso dice que algo falla, no cuánto va a llevar arreglarlo.
    fecha_fin: "",

    descripcion: aviso.descripcion?.trim() || `Aviso ${aviso.oa_number ?? ""}`.trim(),
    tipo: "CORRECTIVO",
    // El `??` no se alcanza: `prioridadDeUrgencia` devuelve siempre ALTA,
    // MEDIA o BAJA, y las tres están en la tabla. Está porque el tipo de
    // `prioridadParaLaPlanilla` admite null —se la llama también con lo que
    // venga de la planilla— y un `!` acá sería afirmar sin red lo que el
    // desplegable no puede mostrar: Media es su valor por defecto.
    prioridad: prioridadParaLaPlanilla(prioridadDeUrgencia(aviso.urgencia)) ?? PRIORIDAD_MEDIA,
    sector_id: aviso.sector_id ?? "",
    sector_raw: aviso.sector_raw ?? "",
    equipment_id: aviso.equipment_id ?? "",
    equipo_raw: aviso.equipo_raw ?? "",
    equipo_code: aviso.equipo_code ?? "",

    // Vacías a propósito: ver «EL PUNTAJE GUT ARRANCA VACÍO» más arriba.
    gut_gravedad: "",
    gut_urgencia: "",
    gut_tendencia: "",
  };
}

/**
 * Un equipo como lo necesita el desplegable del formulario. Vive acá y no en
 * el modal porque la página de avisos también lo importa, y ese archivo no
 * tiene por qué conocer al formulario.
 */
export interface EquipoDelAviso {
  id: string; name: string; code: string | null; sector_id: string | null;
}

/**
 * Lo que el aviso le propone al formulario completo: **sólo las claves que
 * llena**, para que se extiendan sobre los valores por defecto del formulario.
 *
 * Sale de `loQuePropone` y no de una segunda regla: dos reglas de sembrado
 * fueron el bug de octubre. No devuelve `especialidad`, `fecha_fin` ni las
 * notas GUT porque el aviso no las sabe, y devolverlas en "" pisaría el
 * valor por defecto con un vacío que nadie eligió.
 *
 * El tipo de retorno nombra las diez claves a propósito: un `Record<string,
 * string>` dejaría pasar en silencio una clave mal escrita o que falte, que es
 * la forma de separación entre dos mitades que este archivo existe para evitar.
 */
export function sembradoDesdeElAviso(
  aviso: AvisoParaLaOT,
  hoy: string
): Pick<
  RespuestasDelAviso,
  | "descripcion" | "tipo" | "prioridad" | "sector_id" | "sector_raw"
  | "equipment_id" | "equipo_raw" | "equipo_code" | "quien" | "fecha_ejecucion"
> {
  const p = loQuePropone(aviso, { quien: "INTERNO", fecha_ejecucion: hoy });
  return {
    descripcion: p.descripcion,
    tipo: p.tipo,
    prioridad: p.prioridad,
    sector_id: p.sector_id,
    sector_raw: p.sector_raw,
    equipment_id: p.equipment_id,
    equipo_raw: p.equipo_raw,
    equipo_code: p.equipo_code,
    quien: p.quien,
    fecha_ejecucion: p.fecha_ejecucion,
  };
}

/**
 * Lo que viaja en el cuerpo además de los campos del formulario: a cuál aviso
 * pertenece la orden, para que el aviso quede apuntando a ella y nadie genere
 * una segunda. No vive en el estado del formulario —ver la prop `aviso` de
 * `NuevaOTModal`— y por eso se suma recién al armar el cuerpo.
 *
 * ── POR QUÉ NO MANDA EL `repuesto` DEL AVISO, AUNQUE LO MANDABA ─────────────
 *
 * Lo mandaba el formulario recortado, que no tenía lista de repuestos: ahí
 * `repuesto` era el único campo del tema y la ruta lo leía. El formulario
 * completo manda **`repuestos`** —un arreglo, siempre, aunque sea el renglón
 * vacío con el que arranca—, y `repuestosDelCuerpo` (`repuestosDeLaOT.ts`)
 * mira `body.repuesto` **sólo cuando no hay arreglo**. O sea que mandarlo era
 * mandar un campo que la ruta descarta: un contrato que el test afirmaba y
 * nadie honraba, que es peor que no tenerlo.
 *
 * Hoy no se pierde nada: medido el 19/11/2026, **0 de 254 avisos tienen
 * `repuesto` cargado**. El día que alguien empiece a usar esa columna, lo que
 * corresponde **no es revivir este campo** —volvería a caer en la rama que la
 * ruta no mira— sino sembrarlo como **primer renglón de `repuestos`**, que es
 * por donde el formulario completo los manda y donde además se puede ver y
 * corregir antes de crear la orden.
 */
export function extrasDelAviso(aviso: AvisoParaLaOT): { aviso_id: string } {
  return { aviso_id: aviso.id };
}

/**
 * Lo que el aviso no trae y hay que elegir a mano, aunque el formulario lo
 * muestre.
 *
 * Antes esto decía «no se arregla acá» y mandaba a corregir el aviso. Dejó de
 * ser cierto el 21/10/2026, cuando el sector y el equipo pasaron a poder
 * elegirse en el formulario: un aviso sin equipo enlazado ya no es un callejón
 * sin salida, es un desplegable vacío que hay que completar.
 *
 * Se sigue nombrando aparte porque **no es lo mismo corregir un dato que
 * inventarlo**: cuando el aviso no trajo equipo, nadie lo verificó, y la
 * pantalla lo dice en vez de dejar que parezca que vino del aviso.
 */
export function loQueElAvisoNoTrae(aviso: AvisoParaLaOT): string[] {
  const falta: string[] = [];
  if (!String(aviso.sector_id ?? "").trim()) falta.push("el sector");
  if (!String(aviso.equipment_id ?? "").trim()) falta.push("el equipo");
  return falta;
}
