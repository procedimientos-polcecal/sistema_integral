import type { Despacho } from "./types";

/**
 * De los renglones del papel a los totales por producto.
 *
 * En el Excel estos totales se tipean ya sumados. Son una cuenta hecha a mano
 * sobre números que ya están escritos en el papel: hacerla acá quita un paso y
 * un lugar donde equivocarse.
 */

export interface TotalesDeDespacho {
  /** Bultos despachados por producto. */
  despachado: Record<string, number>;
  /** Separadas como en el papel: la rotura pasa al cargar el camión. */
  roturaBolsa: Record<string, number>;
  roturaBolson: Record<string, number>;
  /** Renglones sin producto reconocido. No se suman, pero no se pierden. */
  sinProducto: Despacho[];
}

export function totalesDeDespacho(renglones: readonly Despacho[]): TotalesDeDespacho {
  const t: TotalesDeDespacho = {
    despachado: {}, roturaBolsa: {}, roturaBolson: {}, sinProducto: [],
  };

  for (const r of renglones) {
    if (!r.renglon_papel_id) {
      t.sinProducto.push(r);
      continue;
    }
    const id = r.renglon_papel_id;
    t.despachado[id] = (t.despachado[id] ?? 0) + (r.bultos ?? 0);
    t.roturaBolsa[id] = (t.roturaBolsa[id] ?? 0) + (r.rotura_bolsa ?? 0);
    t.roturaBolson[id] = (t.roturaBolson[id] ?? 0) + (r.rotura_bolson ?? 0);
  }
  return t;
}

/**
 * La rotura de un producto, sumadas las dos.
 *
 * Un producto del catálogo es bolsa o bolsón (campo `envase`), así que en un
 * parte bien cargado uno de los dos términos siempre es cero: sumarlos no
 * mezcla nada, sólo junta el que vale con el que quedó en cero. Si algún día
 * un renglón mal tipeado cargara los dos, la suma sigue siendo lo correcto
 * para la planilla: tiene una sola columna de rotura por producto, no una por
 * envase.
 */
export function roturaTotal(t: TotalesDeDespacho): Record<string, number> {
  const salida: Record<string, number> = {};
  for (const id of new Set([...Object.keys(t.roturaBolsa), ...Object.keys(t.roturaBolson)])) {
    salida[id] = (t.roturaBolsa[id] ?? 0) + (t.roturaBolson[id] ?? 0);
  }
  return salida;
}

/**
 * Los kilos por unidad de cada renglón del papel, a partir de sus productos.
 *
 * Ya no es una columna del renglón: el kg por unidad es del **producto**, y un
 * renglón del papel puede agrupar varios —si el papel cuenta "cal en bolsón" en
 * un solo renglón, ahí caen las tres variantes que Odoo despacha—.
 *
 * **Sólo vale si los productos del renglón coinciden.** Si dos declaran kilos
 * distintos, el renglón queda en null y la comprobación no corre para él:
 * elegir uno de los dos, o promediarlos, sería inventar el número contra el que
 * se avisa, y un aviso que sale de un número inventado es peor que no avisar.
 * Lo mismo si ninguno tiene el kg cargado — el del bolsón sigue sin confirmar.
 */
export function kilosQueCoinciden(
  filas: readonly { renglon_papel_id: string; kg_por_unidad: number | null }[]
): Record<string, number | null> {
  const porRenglon = new Map<string, Set<number>>();
  for (const f of filas) {
    const vistos = porRenglon.get(f.renglon_papel_id) ?? new Set<number>();
    if (f.kg_por_unidad !== null && f.kg_por_unidad !== undefined) {
      vistos.add(Number(f.kg_por_unidad));
    }
    porRenglon.set(f.renglon_papel_id, vistos);
  }

  const salida: Record<string, number | null> = {};
  for (const [renglon, kilos] of porRenglon) {
    salida[renglon] = kilos.size === 1 ? [...kilos][0] : null;
  }
  return salida;
}

export interface DesajusteDeKilos {
  despachoId: string;
  bultos: number;
  kilos: number;
  kilosEsperados: number;
}

/**
 * Los renglones donde los kilos no cierran con los bultos.
 *
 * **Avisa, no bloquea.** El papel es el papel: si el capataz escribió dos
 * números que no cierran, el parte se guarda igual y la pantalla muestra la
 * diferencia. Corregir el papel desde el sistema sería inventar.
 *
 * La tolerancia por defecto es 5%: una bolsa no pesa exactamente 25 kg y el
 * camión se pesa en báscula. Ojo: el caso real relevado del papel (1.200
 * bolsas / 29.280 kg, 2,4% de diferencia) queda por debajo de este umbral y no
 * dispara aviso. Si 5% resulta poco exigente para lo que calidad quiere
 * vigilar, es una decisión de calidad, no de este archivo — queda en 5% hasta
 * que lo decidan.
 */
export function desajustesDeKilos(
  renglones: readonly Despacho[],
  kgPorUnidad: ReadonlyMap<string, number | null>,
  tolerancia = 0.05
): DesajusteDeKilos[] {
  const salida: DesajusteDeKilos[] = [];

  for (const r of renglones) {
    if (!r.renglon_papel_id || r.kilos === null || r.bultos === null) continue;

    const kg = kgPorUnidad.get(r.renglon_papel_id);
    // Sin kg por unidad no hay contra qué comparar, y no se inventa un número:
    // el del bolsón está sin confirmar. `== null` distingue esto de un
    // kg_por_unidad en 0 (que no debería existir en el catálogo, pero si
    // existiera compararía contra 0 esperados, no lo saltearía en silencio).
    if (kg == null) continue;

    const esperados = r.bultos * kg;
    // Bultos en 0 con kg conocido: no hay nada despachado en este renglón, no
    // hay contra qué comparar (dividir por 0 sería el problema, no un dato).
    if (esperados === 0) continue;

    if (Math.abs(r.kilos - esperados) / esperados > tolerancia) {
      salida.push({
        despachoId: r.id,
        bultos: r.bultos,
        kilos: r.kilos,
        kilosEsperados: esperados,
      });
    }
  }
  return salida;
}
