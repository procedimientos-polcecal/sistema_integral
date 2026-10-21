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
 * El formulario **no tiene su propia lista de campos**. Arma el cuerpo con lo
 * que hay y se lo pasa a `loQueFaltaParaCrear` —la misma función que corre el
 * servidor—, y pregunta por lo que esa función nombre. Si mañana la regla
 * exige un campo más, el formulario lo pide solo; si deja de exigir uno, deja
 * de pedirlo. Las dos mitades ya no pueden separarse porque hay una sola.
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

import { loQueFaltaParaCrear, type DatosDelAltaDeOT } from "@/lib/mantenimiento/altaDeOT";
import { prioridadDeUrgencia } from "@/lib/mantenimiento/avisos";

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
  /** Lo que el aviso propone y se puede corregir. */
  descripcion: string;
  tipo: string;
  prioridad: string;
  sector_id: string;
  sector_raw: string;
  equipment_id: string;
  equipo_raw: string;
  equipo_code: string;
}

export const RESPUESTAS_VACIAS: RespuestasDelAviso = {
  especialidad: "", quien: "", fecha_ejecucion: "",
  descripcion: "", tipo: "", prioridad: "",
  sector_id: "", sector_raw: "", equipment_id: "", equipo_raw: "", equipo_code: "",
};

/**
 * Con qué arranca el formulario.
 *
 * **Correctiva siempre**: alguien reportó una falla, no es un preventivo
 * programado. Y la prioridad sale de la urgencia del aviso por
 * `prioridadDeUrgencia`, que es la traducción que ya existía — no una segunda.
 * Esa función devuelve la palabra pelada («MEDIA»); el emoji se lo pone la
 * ruta con `prioridadParaLaPlanilla`, una sola vez y antes de sus dos usos.
 *
 * Los tres que el aviso no puede contestar quedan como se los pase quien
 * llama: la especialidad vacía —el aviso no da ni un indicio y acertarle de
 * memoria sería enlazar al que se le parece— y los otros dos con el valor
 * normal, que se ve y se cambia.
 */
export function loQuePropone(
  aviso: AvisoParaLaOT,
  deEntrada: { quien: string; fecha_ejecucion: string }
): RespuestasDelAviso {
  return {
    especialidad: "",
    quien: deEntrada.quien,
    fecha_ejecucion: deEntrada.fecha_ejecucion,

    descripcion: aviso.descripcion?.trim() || `Aviso ${aviso.oa_number ?? ""}`.trim(),
    tipo: "CORRECTIVO",
    prioridad: prioridadDeUrgencia(aviso.urgencia),
    sector_id: aviso.sector_id ?? "",
    sector_raw: aviso.sector_raw ?? "",
    equipment_id: aviso.equipment_id ?? "",
    equipo_raw: aviso.equipo_raw ?? "",
    equipo_code: aviso.equipo_code ?? "",
  };
}

/**
 * El cuerpo que se le manda a `POST /api/mantenimiento/ordenes`.
 *
 * Del aviso quedan sólo dos cosas: **a cuál pertenece** —para que el aviso
 * quede apuntando a su orden y nadie genere una segunda— y el repuesto, que no
 * se edita acá porque la orden tiene su propia pantalla de repuestos, con
 * renglones y cantidades.
 */
export function cuerpoDeLaOT(
  aviso: AvisoParaLaOT,
  respuestas: RespuestasDelAviso
): Record<string, unknown> & DatosDelAltaDeOT {
  const texto = (v: string) => v.trim();

  return {
    aviso_id: aviso.id,
    repuesto: aviso.repuesto,
    estado: "POR_HACER",

    equipment_id: texto(respuestas.equipment_id) || null,
    sector_id: texto(respuestas.sector_id) || null,
    sector_raw: texto(respuestas.sector_raw) || null,
    equipo_raw: texto(respuestas.equipo_raw) || null,
    equipo_code: texto(respuestas.equipo_code) || null,
    descripcion: texto(respuestas.descripcion),
    tipo: texto(respuestas.tipo),
    prioridad: texto(respuestas.prioridad),

    especialidad: texto(respuestas.especialidad),
    quien: texto(respuestas.quien),
    fecha_ejecucion: texto(respuestas.fecha_ejecucion),

    // Una OT que nace de un aviso no nace cerrada: se está pidiendo trabajo,
    // no cargando trabajo hecho. Van explícitos para que `loQueFaltaParaCrear`
    // vea lo mismo acá que en el servidor.
    fecha_cierre: "",
    horas: "",
    contratista: "",
    operario_1: "",
    operario_2: "",
    operario_3: "",
  };
}

/**
 * Qué le falta a la orden, con lo que haya escrito hasta ahora.
 *
 * Delega en la regla compartida. **No hay una lista de campos acá**: ése es el
 * punto de todo el archivo.
 */
export function loQueFaltaDelAviso(
  aviso: AvisoParaLaOT,
  respuestas: RespuestasDelAviso
): string[] {
  return loQueFaltaParaCrear(cuerpoDeLaOT(aviso, respuestas));
}

/**
 * Lo que el aviso **no puede** contestar ni con la mejor voluntad.
 *
 * Es lo mismo de arriba con el formulario en blanco: lo que quede nombrado es
 * lo que no viene de ningún lado. Así, el día que la regla cambie, el
 * formulario cambia con ella sin que nadie se acuerde.
 */
export function loQueHayQuePreguntar(aviso: AvisoParaLaOT): string[] {
  return loQueFaltaDelAviso(aviso, RESPUESTAS_VACIAS);
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
