/**
 * Cuánto cuesta tener una máquina.
 *
 * Tres cosas distintas que hasta ahora nadie sumaba: lo que se le compró
 * (Compras), lo que se le pagó a un tercero (órdenes de servicio) y lo que
 * costó el trabajo propio (órdenes de trabajo × la tarifa de la hora).
 *
 * Todo se agrega **por año**. Sumar pesos de 2025 con pesos de 2026 da un
 * número que sirve para ordenar máquinas entre sí, no para comparar años.
 */

/** El precio de la hora, con desde cuándo rige. */
export interface TarifaHora {
  valor: number | string;
  vigente_desde: string;
}

export interface RequerimientoDeMaquina {
  costo_iva: number | string | null;
  fecha_pedido: string | null;
  fecha: string | null;
}

export interface OrdenDeServicio {
  costo: number | string | null;
  fecha: string | null;
}

export interface OrdenDeTrabajo {
  horas: number | string | null;
  /**
   * Las tres columnas de operario de la planilla. Un guión suelto es cómo se
   * escribe "acá no va nada", igual que en el resto del módulo.
   */
  operario_1: string | null;
  operario_2: string | null;
  operario_3: string | null;
  /** Si lo hizo un tercero, las horas no son nuestras. */
  contratista: string | null;
  fecha_ejecucion: string | null;
  fecha_cierre: string | null;
  fecha: string | null;
}

export interface CostoDeUnAnio {
  anio: string;
  materiales: number;
  terceros: number;
  manoDeObra: number;
  total: number;
}

export interface CostoDelEquipo {
  /** Del año más reciente al más viejo. */
  anios: CostoDeUnAnio[];
  total: number;
  materiales: number;
  terceros: number;
  manoDeObra: number;
  /** Lo que no se pudo costear, para poder decirlo en vez de sumar cero. */
  huecos: {
    riSinCosto: number;
    osSinCosto: number;
    otSinHoras: number;
    /** Horas de trabajos que hizo un contratista: no hay con qué costearlas. */
    horasDeContratista: number;
    /** Horas propias trabajadas antes de la primera tarifa cargada. */
    horasSinTarifa: number;
  };
  /** Horas-hombre propias efectivamente costeadas. */
  horasHombre: number;
}

/** Un número tal como puede venir de la base o de una planilla. */
function numero(valor: number | string | null | undefined): number | null {
  if (valor === null || valor === undefined || valor === "") return null;
  const n = typeof valor === "number" ? valor : Number(String(valor).replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

/** Un guión suelto no es un nombre: es "acá no va nada". */
function tieneTexto(valor: string | null | undefined): boolean {
  const s = String(valor ?? "").trim();
  return s !== "" && s !== "-";
}

function anioDe(...fechas: (string | null | undefined)[]): string | null {
  for (const f of fechas) {
    if (!f) continue;
    const anio = String(f).slice(0, 4);
    if (/^\d{4}$/.test(anio)) return anio;
  }
  return null;
}

/**
 * Cuánta gente propia trabajó en esta orden.
 *
 * Con contratista es cero aunque haya operarios anotados: si intervino un
 * tercero, esas horas no son mano de obra propia y su costo está —cuando
 * está— en una orden de servicio.
 *
 * `Ambos` se cuenta como uno solo. Aparece en 59 órdenes y quiere decir "los
 * dos", pero no dice cuáles: contarlo como dos sería inventar. Subestima, y
 * está declarado.
 */
export function operariosPropios(ot: OrdenDeTrabajo): number {
  if (tieneTexto(ot.contratista)) return 0;
  return [ot.operario_1, ot.operario_2, ot.operario_3].filter(tieneTexto).length;
}

/**
 * Horas-hombre de una orden: la duración por la cantidad de gente.
 *
 * `horas` es cuánto duró el trabajo, no horas-hombre. Se verificó contra los
 * datos: las órdenes con tres operarios tienen la misma mediana que las de uno
 * —3 horas—, cuando serían el triple si ya vinieran multiplicadas.
 */
export function horasHombreDe(ot: OrdenDeTrabajo): number {
  const horas = numero(ot.horas);
  if (horas === null || horas <= 0) return 0;
  return horas * operariosPropios(ot);
}

/**
 * La tarifa que regía una fecha dada.
 *
 * La de mayor `vigente_desde` anterior o igual. Antes de la primera cargada no
 * hay tarifa, y eso no es cero: esas horas se cuentan aparte.
 */
export function tarifaVigente(tarifas: TarifaHora[], fecha: string | null): number | null {
  if (!fecha) return null;
  const dia = String(fecha).slice(0, 10);

  let mejor: TarifaHora | null = null;
  for (const t of tarifas) {
    if (t.vigente_desde > dia) continue;
    if (mejor === null || t.vigente_desde > mejor.vigente_desde) mejor = t;
  }

  return mejor === null ? null : numero(mejor.valor);
}

export function costoDelEquipo(
  requerimientos: RequerimientoDeMaquina[],
  ordenesServicio: OrdenDeServicio[],
  ordenesTrabajo: OrdenDeTrabajo[],
  tarifas: TarifaHora[]
): CostoDelEquipo {
  const porAnio = new Map<string, CostoDeUnAnio>();
  const huecos = {
    riSinCosto: 0,
    osSinCosto: 0,
    otSinHoras: 0,
    horasDeContratista: 0,
    horasSinTarifa: 0,
  };
  let horasHombre = 0;

  const fila = (anio: string) => {
    const y = porAnio.get(anio) ?? { anio, materiales: 0, terceros: 0, manoDeObra: 0, total: 0 };
    porAnio.set(anio, y);
    return y;
  };

  for (const r of requerimientos) {
    const monto = numero(r.costo_iva);
    if (monto === null) {
      huecos.riSinCosto++;
      continue;
    }
    const anio = anioDe(r.fecha_pedido, r.fecha);
    if (anio) fila(anio).materiales += monto;
  }

  for (const os of ordenesServicio) {
    const monto = numero(os.costo);
    if (monto === null || monto === 0) {
      huecos.osSinCosto++;
      continue;
    }
    const anio = anioDe(os.fecha);
    if (anio) fila(anio).terceros += monto;
  }

  for (const ot of ordenesTrabajo) {
    const horas = numero(ot.horas);
    if (horas === null || horas <= 0) {
      huecos.otSinHoras++;
      continue;
    }
    // Las de contratista se cuentan como horas ajenas y no se costean.
    if (tieneTexto(ot.contratista)) {
      huecos.horasDeContratista += horas;
      continue;
    }

    const hh = horasHombreDe(ot);
    if (hh === 0) continue;

    const cuando = ot.fecha_ejecucion ?? ot.fecha_cierre ?? ot.fecha;
    const tarifa = tarifaVigente(tarifas, cuando);
    if (tarifa === null) {
      huecos.horasSinTarifa += hh;
      continue;
    }

    horasHombre += hh;
    const anio = anioDe(cuando);
    if (anio) fila(anio).manoDeObra += hh * tarifa;
  }

  const anios = [...porAnio.values()]
    .map((a) => ({ ...a, total: a.materiales + a.terceros + a.manoDeObra }))
    .sort((a, b) => b.anio.localeCompare(a.anio));

  return {
    anios,
    total: anios.reduce((a, y) => a + y.total, 0),
    materiales: anios.reduce((a, y) => a + y.materiales, 0),
    terceros: anios.reduce((a, y) => a + y.terceros, 0),
    manoDeObra: anios.reduce((a, y) => a + y.manoDeObra, 0),
    huecos,
    horasHombre,
  };
}
