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
 *
 * ── Y SE PUEDE DESHACER, PERO NO CUALQUIERA ────────────────────────────────
 *
 * Desde el 26/10/2026. Hace falta justamente porque el número se tipea: la
 * 2815 en lugar de la 2814 se arreglaba editando la base a mano, que es el
 * mismo argumento que el DELETE de `avisos/desestimar` deja escrito.
 *
 * Lo que no es obvio es **qué** se puede deshacer, porque desenlazar borra:
 * limpia la tabla y **vacía la celda de `OT ASIGNADA` en la planilla**. Hay
 * tres maneras de que un aviso tenga OT y sólo una se deshace:
 *
 * 1. **Lo escribió una persona en la planilla.** Es el caso normal, no el
 *    raro: medido el 26/10/2026, de 186 avisos con algo en esa columna, 182
 *    no tienen `work_order_id` —«RI 1888», «Revision», «si», «1889 - 1886»—.
 *    Vaciar esa celda es borrar lo que alguien puso donde lee quien no entra
 *    al sistema. No se ofrece, y se distingue solo.
 * 2. **La OT la generó el sistema desde este aviso.** Desenlazarla deja una
 *    orden que nadie reclama, y devuelve el aviso a la lista de pendientes
 *    invitando a que alguien genere una segunda orden para el mismo
 *    problema. No se ofrece: si esa orden no corresponde, hay que darla de
 *    baja a ella, que es la misma respuesta que ya da `desestimar`.
 * 3. **Se enlazó con este botón.** La orden existía antes y sigue existiendo
 *    sin el aviso. Deshacerlo devuelve exactamente el estado anterior.
 *
 * Los casos 2 y 3 dejan lo mismo en la tabla —los escribe la misma función,
 * `marcarElAviso`—, así que distinguirlos necesitó una columna:
 * `ot_enlazada_en`, que escribe **sólo** la ruta de enlazar. El porqué, con
 * los números y con la trampa del `check` que no se puede poner, está en la
 * migración `20261026080748`.
 *
 * **Desenlazar no se audita**, por lo mismo que no se audita retomar un aviso
 * desestimado: es el deshacer, no lo irreversible.
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

/** Lo que del aviso hace falta para decidir si se puede desenlazar. */
export interface AvisoADesenlazar {
  oa_number: string | null;
  work_order_id: string | null;
  /** Texto libre de la planilla: un N° de OT, "si", "Revision" o vacío. */
  ot_asignada: string | null;
  /**
   * Cuándo se enlazó con «Ya tiene OT». `null` es que ese enlace **no** lo
   * hizo ese botón, que es lo que vale para los 196 avisos anteriores al
   * 26/10/2026 y para todo lo que salga de «Generar OT».
   */
  ot_enlazada_en?: string | null;
}

/**
 * Lo que impide desenlazar, en castellano y listo para mostrar.
 *
 * Vacío es que se puede. Cada motivo dice además **dónde se arregla**, porque
 * los tres se arreglan en lugares distintos —la planilla, la orden, ningún
 * lado— y «no se puede» a secas devolvería a la gente a editar la base.
 *
 * ── EL SEGUNDO ARGUMENTO, Y POR QUÉ SE PUEDE NO SABERLO ────────────────────
 *
 * `otNumber` es el número de la orden a la que el aviso apunta **hoy**, y
 * sirve para una sola cosa: comprobar que la celda de la planilla sigue
 * diciendo lo que el sistema escribió. Si alguien la editó a mano después,
 * vaciarla es pisarlo — y no hacerlo tampoco sirve, porque `finalDelAviso`
 * lee esa misma columna y la próxima sincronización la traería de vuelta: el
 * aviso seguiría con OT y el botón parecería no hacer nada.
 *
 * `null` quiere decir «todavía no se leyó la orden», y entonces esa
 * comprobación se saltea. Lo usa la pantalla, que decide si **ofrecer** el
 * botón con lo que tiene en la mano; quien decide si **hacerlo** es la ruta,
 * que lee la orden primero. O sea que la pantalla puede ofrecer algo que la
 * ruta rechace, y eso está bien: el rechazo es un mensaje que dice dónde
 * arreglarlo, no un fracaso silencioso. Es la misma repartija que ya hace
 * `loQueImpideEnlazar`, donde la ruta vuelve a buscar la OT y vuelve a correr
 * la regla antes de escribir.
 */
export function loQueImpideDesenlazar(
  aviso: AvisoADesenlazar,
  otNumber: number | null
): string[] {
  const oa = texto(aviso.oa_number) || "—";
  const dice = texto(aviso.ot_asignada);

  if (!aviso.work_order_id && dice === "") {
    return [`El aviso ${oa} no tiene ninguna orden de trabajo enlazada.`];
  }

  // El caso normal y no el raro: 182 de 186. Es texto que alguien escribió en
  // la planilla, y desenlazar vacía esa celda.
  if (!aviso.work_order_id) {
    return [
      `El aviso ${oa} dice «${dice}» en OT ASIGNADA, pero el sistema no tiene ninguna ` +
      `orden enlazada: ese texto está sólo en la planilla y lo puso alguien a mano. ` +
      `Borrarlo desde acá sería pisarlo — si está mal, corregilo en la planilla.`,
    ];
  }

  if (!aviso.ot_enlazada_en) {
    return [
      `La OT #${dice || "—"} se generó desde el aviso ${oa}, así que desenlazarla dejaría ` +
      `una orden que el sistema creó y que ya nadie reclama, y el aviso volvería a la ` +
      `lista de pendientes invitando a que alguien genere una segunda. Si esa orden no ` +
      `corresponde, hay que darla de baja a ella.`,
    ];
  }

  // Vacía no es «alguien la cambió»: enlazar guarda primero y escribe después,
  // así que una celda en blanco es la de un enlace cuya escritura no salió. No
  // hay nada que pisar.
  if (otNumber !== null && dice !== "" && dice !== String(otNumber)) {
    return [
      `El aviso ${oa} está enlazado a la OT #${otNumber}, pero la planilla dice ` +
      `«${dice}». Eso lo cambió alguien a mano después de enlazar, así que no se vacía ` +
      `desde acá: corregilo en la planilla y traela de nuevo.`,
    ];
  }

  return [];
}

/**
 * Si la pantalla ofrece el botón de desenlazar.
 *
 * Es la misma regla con lo que la pantalla puede saber —ver el segundo
 * argumento de `loQueImpideDesenlazar`—, y no una segunda regla escrita
 * aparte: dos listas de condiciones se separan, y la que se separa es siempre
 * la que decide qué se muestra.
 */
export function sePuedeDesenlazar(aviso: AvisoADesenlazar): boolean {
  return loQueImpideDesenlazar(aviso, null).length === 0;
}

/**
 * Lo que se le dice a quien desenlazó.
 *
 * Si la planilla no se pudo vaciar, el aviso **no queda a medias: queda peor
 * que antes**, y eso hay que decirlo. La celda sigue diciendo el número, así
 * que la próxima sincronización lo trae de vuelta a `ot_asignada` —ahora sin
 * `work_order_id`—, el aviso vuelve a contar como «con OT» y pasa a ser
 * indistinguible de los 182 que alguien escribió a mano: desde ahí ya no se
 * puede desenlazar desde el sistema nunca más. Por eso el texto pide borrar
 * la celda a mano, y no se conforma con avisar que la planilla «no se
 * enteró», que es lo que alcanza en `desestimar`.
 *
 * Va con **lo que dijo Google sin traducir**: un diagnóstico que no se
 * distingue de otro no es un diagnóstico.
 */
export function avisoDeDesenlazada(
  oaNumber: string | null,
  otNumber: number | null,
  planillaError: string | null
): string {
  const oa = texto(oaNumber) || "—";
  const cual = otNumber === null ? "su orden de trabajo" : `la OT #${otNumber}`;
  const base = `El aviso ${oa} ya no está enlazado a ${cual} y vuelve a estar pendiente.`;
  if (!planillaError) return base;
  return (
    `${base} Ojo: la planilla sigue diciendo que tiene OT y no se pudo vaciar ` +
    `(${planillaError}). Hay que borrar esa celda a mano: si no, la próxima ` +
    `sincronización la trae de vuelta y el aviso vuelve a contar como que ya tiene orden.`
  );
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
