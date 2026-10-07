import type { EmpleadoLenox } from "./tipos";

/** Lo que el cotejo necesita saber de un empleado del SdG. */
export interface EmpleadoDelPadron {
  legajo: string | null;
  nombre: string;
  apellido: string;
  activo: boolean;
}

/**
 * El legajo tal como se compara: sin espacios al borde. Es la misma
 * normalización con la que se enlazan las marcaciones (el agrupador también
 * recorta), y tiene que serlo: si el cotejo dijera "está" y el enlace dijera
 * "no existe" —o al revés—, un aviso contradiría al otro y nadie les creería a
 * los dos. Mayúsculas y minúsculas NO se igualan, por la misma razón.
 */
function legajoDe(valor: string | null | undefined): string {
  return String(valor ?? "").trim();
}

/**
 * Lo que el cotejo encontró, partido por el criterio que usa toda la
 * sincronización: **un error es algo que hizo que un dato no se cargara**.
 * Todo lo demás es un pendiente, que alguien tiene que atender pero que no
 * cuenta como fallo de la corrida. Si se mezclaran, un activo legítimo sin
 * reloj —gerencia, por ejemplo— daría el mismo "error" todos los días y el
 * número dejaría de significar algo: el problema de las fichadas abiertas.
 */
export interface ResultadoDelCotejo {
  /** Datos que no se cargaron: hoy, las altas sin cargar. */
  errores: string[];
  /** Datos maestros por actualizar, sin nada perdido: bajas sin cargar y "sin reloj". */
  pendientes: string[];
}

/**
 * Las diferencias entre el padrón de Lenox y el del SdG, como avisos. Es pura:
 * informa y no toca nada. Los catálogos del núcleo se leen, no se rehacen desde
 * un módulo, y enlazar al que se le parece es peor que dejar en null — por eso
 * ni siquiera propone un par cuando los legajos no coinciden.
 *
 * Tres diferencias, y la cuarta combinación se calla a propósito:
 *
 * - **Alta sin cargar** (error): Lenox tiene al empleado, activo, y el SdG no.
 *   Sus marcaciones no se cargaron: hay datos faltando ahora mismo. Hoy eso
 *   aparece como `legajo "PC_241" no encontrado` recién cuando ya falló la
 *   carga; acá aparece antes y con nombre y apellido.
 * - **Baja sin cargar** (pendiente): Lenox lo marca de baja y el SdG lo tiene
 *   activo. No se perdió nada; hay que actualizar un dato maestro.
 * - **Sin reloj** (pendiente): activo en el SdG y no existe en Lenox.
 *   Probablemente sea permanente y legítimo.
 * - Una baja de Lenox que el SdG no tiene NO avisa: no hay nada que cargar.
 *
 * Un legajo vacío de Lenox se ignora (no hay con qué compararlo). Uno vacío del
 * SdG no: un activo sin legajo no se puede enlazar con ninguna marcación, y
 * eso es justo lo que este aviso tiene que decir.
 */
export function cotejarPadron(delSdG: EmpleadoDelPadron[], deLenox: EmpleadoLenox[]): ResultadoDelCotejo {
  const errores: string[] = [];
  const pendientes: string[] = [];
  const enSdG = new Map<string, EmpleadoDelPadron>();
  for (const e of delSdG) enSdG.set(legajoDe(e.legajo), e);

  const enLenox = new Set<string>();
  for (const e of deLenox) {
    const legajo = legajoDe(e.legajo);
    if (!legajo) continue;
    enLenox.add(legajo);

    // Un `fechaBaja` en blanco no es una baja.
    const baja = String(e.fechaBaja ?? "").trim();
    const local = enSdG.get(legajo);
    if (!local) {
      if (!baja) {
        errores.push(`Alta sin cargar: ${legajo} — ${e.nombre} ${e.apellido} está en Lenox y no en el SdG`);
      }
      continue;
    }
    if (baja && local.activo) {
      pendientes.push(
        `Baja sin cargar: ${legajo} — ${local.nombre} ${local.apellido} figura de baja en Lenox el ${baja} y activo en el SdG`
      );
    }
  }

  for (const e of delSdG) {
    const legajo = legajoDe(e.legajo);
    if (e.activo && !enLenox.has(legajo)) {
      pendientes.push(
        `Sin reloj: ${legajo || "(sin legajo)"} — ${e.nombre} ${e.apellido} está activo en el SdG y no existe en Lenox`
      );
    }
  }

  return { errores, pendientes };
}
