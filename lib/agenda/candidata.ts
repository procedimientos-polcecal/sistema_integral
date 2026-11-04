import { fechaParaElCalendario, instanteDe, laOTEstaCerrada } from "@/lib/agenda/evento";

/** Lo que de una OT hace falta para decidir si entra sola al calendario. */
export interface OTCandidata {
  fecha_ejecucion?: string | null;
  fecha_ejecucion_pendiente?: string | null;
  fecha_cierre?: string | null;
  estado?: string | null;
}

/**
 * ¿Entra esta OT sola al calendario? Si sí, con qué fecha; si no, **por qué**.
 *
 * Sin red y sin base. El motivo no es decoración: quien llama lo anota, y una OT
 * que no entró sin decir por qué es indistinguible de una que se perdió.
 *
 * - **Cerrada no entra**, por las dos puntas de `laOTEstaCerrada`
 *   (`fecha_cierre` o `REALIZADO`): 168 de 986 `REALIZADO` no tienen fecha.
 * - **La fecha es la de `fechaParaElCalendario`**, o sea la pendiente cuando la
 *   hay: es la que la persona acaba de elegir y la planilla todavía no devolvió.
 * - **El filtro es por día y no por hora.** Una OT cargada a las 15:00 con fecha
 *   de hoy entra aunque las 08:00 ya hayan pasado; sólo las de un día anterior
 *   se descartan.
 * - **La fecha puede ser cualquier cosa**: viene de una planilla. Una mal
 *   formada no entra, porque armaría un evento ilegible.
 *
 * `hoy` y la fecha son `AAAA-MM-DD` y se comparan **como texto**: en ese formato
 * el orden alfabético es el cronológico, y parsearlas a `Date` metería la zona
 * del servidor (UTC) en un día que es de Argentina.
 */
export function esCandidataAlCalendario(
  o: OTCandidata,
  hoy: string
): { ok: true; fecha: string } | { ok: false; motivo: string; fechaIlegible?: true } {
  if (laOTEstaCerrada(o)) {
    return { ok: false, motivo: "La OT ya está cerrada" };
  }

  const fecha = fechaParaElCalendario({
    fecha_ejecucion: o.fecha_ejecucion ?? null,
    fecha_ejecucion_pendiente: o.fecha_ejecucion_pendiente,
  });
  if (!fecha) {
    return { ok: false, motivo: "La OT no tiene fecha de ejecución" };
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha) || instanteDe(`${fecha}T00:00:00`) === null) {
    // `fechaIlegible` separa este rechazo de los otros: las cerradas, las que no
    // tienen fecha y las pasadas son lo normal y quien barre las calla; ésta es
    // un dato roto de la planilla y es la que tiene que nombrarse.
    return {
      ok: false,
      fechaIlegible: true,
      motivo: `La fecha de ejecución «${fecha}» no es una fecha válida (tiene que ser AAAA-MM-DD)`,
    };
  }

  if (fecha < hoy) {
    return { ok: false, motivo: `La fecha de ejecución ${fecha} ya pasó` };
  }

  return { ok: true, fecha };
}

/** La clave de apilado vive en `apilado.ts`; se reexporta porque quien decide quién entra es quien también agrupa. */
export { claveDeApilado } from "@/lib/agenda/apilado";
