/**
 * Un aviso que llega tarde a una orden que ya existe.
 *
 * ── POR QUÉ EXISTE ──────────────────────────────────────────────────────────
 *
 * El encargado del área se adelanta: ve la falla, carga la OT por su lado y
 * recién después aparece el aviso que alguien había reportado. El aviso queda
 * pendiente **para siempre** aunque el trabajo ya esté andando, que es
 * exactamente el ruido que «No va» vino a sacar de esa lista el 21/10/2026 —
 * sólo que acá el aviso no es que no corresponda: es que ya se hizo.
 *
 * Hasta hoy un aviso pendiente tenía dos salidas: generar la orden o
 * desestimarla. La tercera —«ya tiene una, es la 2814»— no existía, y la única
 * forma de decirlo era escribir el número a mano en la planilla y esperar la
 * sincronización.
 *
 * ── EL NÚMERO SE TIPEA, ASÍ QUE LA ORDEN SE MUESTRA ─────────────────────────
 *
 * La OT se identifica por su número, que es como la nombra quien se adelantó.
 * Un número tipeado se equivoca con un dedo, y **un enlace equivocado no se
 * nota nunca**: el aviso desaparece de «sin orden de trabajo» y el trabajo que
 * reportaba queda sin que nadie lo tome, mientras una OT ajena carga un
 * problema que no es el suyo. Es la regla de todo el SdG —enlazar al que se le
 * parece es peor que dejar en null—, con la diferencia de que acá hay una
 * persona mirando: por eso la pantalla **muestra qué dice esa orden antes de
 * enlazar** y no enlaza de una.
 *
 * De ahí sale la otra decisión, la que no se deduce: **un número que el
 * sistema no conoce no se enlaza.** Si el encargado cargó la OT en la planilla
 * y la sincronización todavía no corrió, ese número no está acá y no hay nada
 * que mostrar — y lo que no se puede mostrar, no se puede confirmar. Se dice
 * qué pasó y se manda a traer la planilla, en vez de guardar un número que
 * nadie pudo mirar.
 *
 * ── QUÉ FRENA Y QUÉ SÓLO AVISA ──────────────────────────────────────────────
 *
 * Son dos listas distintas a propósito:
 *
 * - `loQueImpideEnlazar` frena. Hoy lo único que frena es que el aviso ya
 *   tenga algo en `OT ASIGNADA`, porque enlazar lo pisaría.
 * - `loQueHayQueMirarAntesDeEnlazar` **no frena**: pone adelante lo que haría
 *   sospechar de un número mal tipeado, y deja decidir. El caso que importa es
 *   el equipo distinto: un aviso del HORNO 4 enlazado a una OT del MOLINO 2 es
 *   casi siempre un dedo, y casi nunca se mira después.
 *
 * Que la segunda avise y no frene no es tibieza: las dos cosas pasan de
 * verdad. Un mismo trabajo puede cubrir dos avisos —dos personas reportan la
 * misma falla—, y una OT puede estar escrita contra otro equipo del mismo
 * sector sin que eso la vuelva la orden equivocada. Frenarlas haría que la
 * pantalla no sirva justo cuando se la necesita, y el aviso vuelva a arreglarse
 * a mano en la planilla.
 *
 * **El aviso no se toca y la orden tampoco.** Lo único que cambia es a cuál
 * apunta el aviso: la orden ya está escrita por quien se adelantó, y el aviso
 * sigue diciendo lo que dijo quien lo cargó.
 */

/** Lo que del aviso hace falta para decidir si se puede enlazar. */
export interface AvisoAEnlazar {
  oa_number: string | null;
  work_order_id: string | null;
  /** Texto libre de la planilla: un N° de OT, "si", "Revision" o vacío. */
  ot_asignada: string | null;
  equipment_id: string | null;
  equipo_raw: string | null;
  desestimado_en?: string | null;
}

/** La orden que se encontró con el número que se escribió. */
export interface OTAEnlazar {
  id: string;
  ot_number: number;
  fecha: string | null;
  descripcion: string | null;
  equipment_id: string | null;
  equipo_raw: string | null;
  sector_raw: string | null;
  especialidad: string | null;
  estado: string | null;
  /** Los avisos que ya apuntan a esta orden. Vacío es lo normal. */
  avisos?: ReadonlyArray<{ oa_number: string | null }> | null;
}

const texto = (v: string | null | undefined) => String(v ?? "").trim();

/**
 * Lo que impide enlazar, en castellano y listo para mostrar.
 *
 * Vacío es que se puede. Hoy hay un solo motivo, y está acá —y no suelto en la
 * ruta— para que la pantalla pueda correr la misma regla antes de dejar
 * apretar el botón.
 */
export function loQueImpideEnlazar(aviso: AvisoAEnlazar, _ot: OTAEnlazar): string[] {
  const yaTiene = texto(aviso.ot_asignada);

  // `work_order_id` sin texto en la columna pasa cuando la OT se generó desde
  // el sistema y la planilla no se pudo escribir: igual ya tiene orden.
  if (aviso.work_order_id && !yaTiene) {
    return [
      `El aviso ${texto(aviso.oa_number) || "—"} ya está enlazado a una orden de trabajo.`,
    ];
  }

  if (yaTiene) {
    return [
      `El aviso ${texto(aviso.oa_number) || "—"} ya dice «${yaTiene}» en OT ASIGNADA, ` +
      `así que enlazarlo pisaría eso. Si está mal, corregilo en la planilla y ` +
      `traela de nuevo.`,
    ];
  }

  return [];
}

/**
 * Lo que conviene mirar antes de apretar, sin frenar nada.
 *
 * Se muestra junto a la orden, no en lugar de ella: lo que decide es la
 * persona que está leyendo las dos cosas.
 */
export function loQueHayQueMirarAntesDeEnlazar(
  aviso: AvisoAEnlazar,
  ot: OTAEnlazar
): string[] {
  const mirar: string[] = [];

  // Sólo cuando los dos están enlazados a un equipo del sistema. Comparar los
  // textos libres daría distinto por una mayúscula y gritaría todo el tiempo,
  // que es como se vuelve invisible un aviso que sí importa.
  if (aviso.equipment_id && ot.equipment_id && aviso.equipment_id !== ot.equipment_id) {
    mirar.push(
      `La orden es de ${texto(ot.equipo_raw) || "otro equipo"} y el aviso es de ` +
      `${texto(aviso.equipo_raw) || "otro"}. Si el número está bien, enlazá igual.`
    );
  }

  const otros = (ot.avisos ?? [])
    .map((a) => texto(a?.oa_number))
    .filter((n) => n !== "" && n !== texto(aviso.oa_number));

  if (otros.length > 0) {
    mirar.push(
      `Esa orden ya es del aviso ${otros.join(", ")}. Puede estar bien —dos personas ` +
      `reportando la misma falla— o ser un número de más.`
    );
  }

  return mirar;
}

/** Un renglón de los que se leen para reconocer la orden. */
export interface RenglonDeLaOT {
  etiqueta: string;
  valor: string;
}

/**
 * La orden, como se lee para decidir si es ésa.
 *
 * **Ningún renglón se oculta por estar vacío.** Que falte haría parecer que la
 * orden dice menos de lo que dice, y lo que se está decidiendo es justamente
 * si es la correcta: un «—» en el equipo es información, un renglón ausente no.
 */
export function comoSeLeeLaOT(ot: OTAEnlazar): RenglonDeLaOT[] {
  const o = (v: string | null) => texto(v) || "—";
  return [
    { etiqueta: "Equipo", valor: o(ot.equipo_raw) },
    { etiqueta: "Sector", valor: o(ot.sector_raw) },
    { etiqueta: "Qué dice", valor: o(ot.descripcion) },
    { etiqueta: "Estado", valor: o(ot.estado) },
    { etiqueta: "Especialidad", valor: o(ot.especialidad) },
    { etiqueta: "Fecha", valor: o(ot.fecha) },
  ];
}

/**
 * Lo que se le dice a quien enlazó.
 *
 * Si la planilla no se pudo escribir va **lo que dijo Google sin traducir**:
 * un diagnóstico que no se distingue de otro no es un diagnóstico.
 */
export function avisoDeEnlazada(
  oaNumber: string | null,
  otNumber: number,
  planillaError: string | null
): string {
  const base = `El aviso ${texto(oaNumber) || "—"} quedó enlazado a la OT #${otNumber}.`;
  if (!planillaError) return base;
  return (
    `${base} Ojo: en el sistema quedó, pero la planilla de avisos sigue sin decirlo ` +
    `(${planillaError}). Quien la mire va a seguir viendo el aviso como pendiente.`
  );
}
