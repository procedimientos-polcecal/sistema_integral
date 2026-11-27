/**
 * Pasar varios requerimientos a comparativa de una sola vez.
 *
 * El circuito deja los pedidos aprobados en `SIN_INICIAR` hasta que alguien
 * los pone a juntar presupuestos, y eso se hacía de a uno: abrir la ficha,
 * avanzar, volver al listado. Medido el 27/11/2026 hay **62 pedidos aprobados
 * esperando ahí**, el más viejo del 20/08, así que ponerlos en marcha son 62
 * idas y vueltas.
 *
 * ── POR QUÉ ES UNA RUTA APARTE Y NO UN `PATCH` CON VARIOS IDS ───────────────
 *
 * Porque el `PATCH` de un requerimiento hace mucho más que cambiar el estado:
 * valida quince campos agrupados por quién los puede tocar, resuelve costos
 * desde el presupuesto elegido, crea la orden en Odoo y exporta a dos libros.
 * Repetirlo N veces desde el cliente es lo que ya se puede hacer hoy; meterle
 * una lista adentro lo convertiría en dos rutas con el mismo nombre.
 *
 * Acá el movimiento es **uno solo y conocido** —`SIN_INICIAR` →
 * `EN_COMPARATIVA`—, que es justamente el que no pide ningún dato nuevo: no
 * hay proveedor que elegir, ni costo, ni Odoo. Por eso se puede hacer en tanda
 * sin repetir aquella validación.
 *
 * ── LO QUE ESTO LE HACE A LA PLANILLA, Y HAY QUE SABERLO ────────────────────
 *
 * En Compras **manda la planilla en el alta y la app en lo que gestiona**, y
 * la bisagra es el trigger de `editado_en_app`: en cuanto cambia
 * `estado_compra`, la importación deja de pisar ese pedido. De los 62, **60
 * todavía no estaban marcados**, así que esta acción los saca de la mano de la
 * planilla de una vez. Es la misma consecuencia que tiene avanzarlos uno por
 * uno —no es nueva—, pero hacerlo de a sesenta la vuelve un solo paso grande,
 * y por eso la pantalla lo dice antes de confirmar.
 */

/** Lo que hace falta saber de un pedido para decidir si puede pasar. */
export interface RiParaMover {
  id: string;
  nro_ri: number | null;
  estado_compra: string;
  estado_aprobacion: string;
}

/** Un pedido que quedó afuera, con el motivo que se le muestra a la persona. */
export interface NoPasa {
  nro_ri: number | null;
  motivo: string;
}

/**
 * Por qué este pedido no puede pasar a comparativa, o `null` si puede.
 *
 * Los cuatro motivos son distintos a propósito: «no se pudo» sin decir cuál de
 * los cuatro deja a quien seleccionó treinta pedidos sin saber cuáles revisar.
 *
 * El orden importa para el mensaje y no para el resultado. La aprobación va
 * primero porque un pedido sin aprobar que además avanzó es una contradicción,
 * y ahí lo que hay que contar es que le falta la aprobación.
 */
export function motivoPorElQueNoPasa(r: RiParaMover): string | null {
  // Es la misma exigencia que el PATCH de un requerimiento: gestionar la
  // compra pide que el pedido esté aprobado. Un DENEGADA cae acá también, y no
  // es un efecto colateral: son 27 filas viejas que siguen en SIN_INICIAR
  // —desde que denegar pone `estado_compra: "DENEGADO"` ya no pasa— y una
  // selección de «todos» no las tiene que revivir.
  if (r.estado_aprobacion !== "APROBADA") return "todavía no está aprobado";

  if (r.estado_compra === "EN_COMPARATIVA") return "ya está en comparativa";

  /*
   * Un pedido en espera está frenado a propósito y volver tiene su propia
   * puerta: el PATCH guarda en `etapa_previa` de dónde venía y lo limpia al
   * salir. Arrastrarlo desde acá perdería ese dato sin que nadie lo note, que
   * es exactamente el tipo de cosa que esta tanda no debe hacer.
   */
  if (r.estado_compra === "EN_ESPERA") {
    return "está en espera y hay que sacarlo desde su ficha";
  }

  if (r.estado_compra !== "SIN_INICIAR") return "ya está más adelante en el circuito";

  return null;
}

/**
 * Reparte los seleccionados entre los que pasan y los que no.
 *
 * Devuelve las dos mitades y no sólo la buena porque la respuesta tiene que
 * poder decir qué pasó con cada uno: una tanda que mueve 18 de 23 y no nombra
 * los 5 restantes obliga a buscarlos a ojo en un listado de 50 filas.
 */
export function repartirSegunPuedenPasar(
  candidatos: RiParaMover[]
): { pasan: RiParaMover[]; noPasan: NoPasa[] } {
  const pasan: RiParaMover[] = [];
  const noPasan: NoPasa[] = [];

  for (const r of candidatos) {
    const motivo = motivoPorElQueNoPasa(r);
    if (motivo === null) pasan.push(r);
    else noPasan.push({ nro_ri: r.nro_ri, motivo });
  }

  return { pasan, noPasan };
}
