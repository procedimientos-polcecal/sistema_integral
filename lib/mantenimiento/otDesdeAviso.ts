/**
 * La orden de trabajo que sale de un aviso.
 *
 * ── QUÉ SE ROMPIÓ, Y POR QUÉ NO LO VIO NADIE ────────────────────────────────
 *
 * El 19/10/2026 una OT nueva pasó a exigir siete campos —sector, equipo,
 * descripción, especialidad, tipo, quién lo realiza y fecha de ejecución—
 * porque de ellos viven el MTBF, el atraso y las horas por sector. El botón de
 * «generar OT» de la pantalla de avisos manda **seis campos y ninguno de esos
 * tres últimos**, así que desde ese día contesta «Falta cargar la especialidad,
 * quién lo realiza, la fecha de ejecución» y no genera nada.
 *
 * Nada lo notó porque **las dos mitades están en archivos distintos y ninguna
 * sabe de la otra**: la regla es una lista de strings en `altaDeOT.ts` y el
 * botón es un `JSON.stringify` a mano en un `.tsx`. No hay tipo que los una —el
 * cuerpo de un `fetch` es `any`— ni test que los cruce, porque las pantallas no
 * tienen tests.
 *
 * ── LO QUE HACE ESTE ARCHIVO, QUE ES LO ÚNICO QUE IMPIDE QUE VUELVA ──────────
 *
 * El formulario **no tiene su propia lista de campos**. Arma el cuerpo con lo
 * que el aviso ya sabe, se lo pasa a `loQueFaltaParaCrear` —la misma función
 * que corre el servidor— y pregunta por lo que esa función nombre. Si mañana la
 * regla exige un campo más, el formulario lo pide solo; si deja de exigir uno,
 * deja de pedirlo. Las dos mitades ya no pueden separarse porque hay una sola.
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

/** Lo que el aviso no puede contestar y tiene que poner una persona. */
export interface RespuestasDelAviso {
  especialidad: string;
  quien: string;
  fecha_ejecucion: string;
}

export const RESPUESTAS_VACIAS: RespuestasDelAviso = {
  especialidad: "", quien: "", fecha_ejecucion: "",
};

/**
 * El cuerpo que se le manda a `POST /api/mantenimiento/ordenes`.
 *
 * **Correctiva siempre**: alguien reportó una falla, no es un preventivo
 * programado. Y la prioridad sale de la urgencia del aviso por
 * `prioridadDeUrgencia`, que es la traducción que ya existía — no una segunda.
 */
export function cuerpoDeLaOT(
  aviso: AvisoParaLaOT,
  respuestas: RespuestasDelAviso
): Record<string, unknown> & DatosDelAltaDeOT {
  return {
    aviso_id: aviso.id,
    equipment_id: aviso.equipment_id,
    sector_id: aviso.sector_id,
    sector_raw: aviso.sector_raw,
    equipo_raw: aviso.equipo_raw,
    equipo_code: aviso.equipo_code,
    descripcion: aviso.descripcion?.trim() || `Aviso ${aviso.oa_number ?? ""}`.trim(),
    repuesto: aviso.repuesto,
    tipo: "CORRECTIVO",
    estado: "POR_HACER",
    prioridad: prioridadDeUrgencia(aviso.urgencia),

    especialidad: respuestas.especialidad,
    quien: respuestas.quien,
    fecha_ejecucion: respuestas.fecha_ejecucion,

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
 * Qué le falta a la orden, con las respuestas que haya hasta ahora.
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
 * Es lo mismo de arriba con las respuestas vacías: lo que quede nombrado es lo
 * que el formulario tiene que preguntar. Así, el día que la regla cambie, el
 * formulario cambia con ella sin que nadie se acuerde.
 */
export function loQueHayQuePreguntar(aviso: AvisoParaLaOT): string[] {
  return loQueFaltaDelAviso(aviso, RESPUESTAS_VACIAS);
}

/**
 * Lo que falta y **el formulario no puede arreglar**: el sector y el equipo.
 *
 * Un aviso sin equipo enlazado no se puede convertir desde acá, y decirlo es
 * mejor que un desplegable de equipos en esta pantalla: el enlace se arregla
 * en el aviso —o en la planilla—, y hacerlo acá dejaría el aviso mintiendo
 * sobre a qué máquina se refiere.
 *
 * Hoy son 1 de 183 avisos, medido el 21/10/2026.
 */
export function loQueNoSeArreglaAca(aviso: AvisoParaLaOT): string[] {
  const falta: string[] = [];
  if (!String(aviso.sector_id ?? "").trim()) falta.push("el sector");
  if (!String(aviso.equipment_id ?? "").trim()) falta.push("el equipo");
  return falta;
}
