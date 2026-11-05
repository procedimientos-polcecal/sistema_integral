/**
 * Lo que llega del formulario de carga, validado y convertido a lo que va a la
 * base.
 *
 * Vive acá y no adentro de la ruta por la razón de siempre en este repo: las
 * rutas no tienen tests, así que la lógica que decide si una muestra es válida
 * se saca a `lib/` para poder probarla. Es lo que hizo `repartirRegistroDeOT`
 * después de que un campo se colara del lado equivocado sin que nada lo notara.
 *
 * **El formulario y esta validación leen los números con la MISMA función**, la
 * de acá abajo. No es una preferencia de estilo: que cada lado tuviera su
 * propia lectura de la misma cadena era el bug. El formulario entendía "1,32"
 * y el servidor lo leía `NaN`, así que la pantalla calculaba el porcentaje con
 * un número que el servidor no veía.
 */

export interface MuestraQueLlega {
  fecha?: string;
  producto_id?: string;
  observaciones?: string | null;
  humedad_p_recipiente?: unknown;
  humedad_p_inicial?: unknown;
  humedad_p_final?: unknown;
  peso_vol_gramos?: unknown;
  peso_vol_volumen_cc?: unknown;
  cal_util_ml_acido?: unknown;
  cal_util_peso_muestra_g?: unknown;
  granulometria_peso_muestra_g?: unknown;
  retenidos?: { malla?: unknown; retenido_g?: unknown }[];
}

export interface MuestraValidada {
  fecha: string;
  producto_id: string;
  observaciones: string | null;
  humedad_p_recipiente: number | null;
  humedad_p_inicial: number | null;
  humedad_p_final: number | null;
  peso_vol_gramos: number | null;
  peso_vol_volumen_cc: number | null;
  cal_util_ml_acido: number | null;
  cal_util_peso_muestra_g: number | null;
  granulometria_peso_muestra_g: number | null;
}

export interface RetenidoValidado {
  malla: number;
  retenido_g: number;
}

/**
 * Un número que tipea el laboratorio: vacío es "no se midió", no cero.
 *
 * **La coma es decimal y el punto también, y acá no hay separador de miles.**
 * Esto lo usan las dos puntas —el formulario para calcular mientras se tipea y
 * esta validación para guardar—, y ésa es toda la gracia: hasta el 05/11/2026
 * eran dos funciones distintas, el formulario entendía la coma y el servidor la
 * leía `NaN` con `Number()`. Salía por dos lados y el peor es el silencioso:
 * en un retenido frenaba la carga diciendo que faltaba una malla **que estaba
 * escrita en la pantalla** —y nombraba una sola por vez, así que corregirla
 * destapaba la siguiente—, y en cualquier otro campo no frenaba nada y guardaba
 * null, después de que la pantalla ya hubiera mostrado el resultado.
 *
 * **No usa `numeroArgentino` del núcleo, y conviene saber por qué.** Esa función
 * desempata el punto ambiguo y decide que "299.668" son doscientos noventa y
 * nueve mil, que es lo correcto para un precio. Acá es una balanza: son
 * 299,668 g, y 299.668 g serían trescientos kilos en un recipiente de 330 cc.
 * Lo que vuelve seguro no tener la regla de miles es que las cantidades están
 * acotadas por la física — medido sobre las 81 muestras cargadas, el valor más
 * grande de los 897 es 617,27 y ninguno llega a 1000, así que un separador de
 * miles no puede aparecer—. El día que este formulario reciba un número que
 * pase los mil, esta decisión hay que volver a mirarla.
 */
export function numeroTipeado(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const t = String(v).trim();
  if (t === "") return null;
  const n = Number(t.replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

export function validarMuestra(
  cuerpo: MuestraQueLlega
): { muestra: MuestraValidada; retenidos: RetenidoValidado[] } | { problema: string } {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(cuerpo.fecha ?? "")) {
    return { problema: "Falta la fecha de la muestra." };
  }
  if (!cuerpo.producto_id) {
    return { problema: "Falta el producto." };
  }

  const muestra: MuestraValidada = {
    fecha: cuerpo.fecha as string,
    producto_id: cuerpo.producto_id,
    observaciones: (cuerpo.observaciones ?? "").toString().trim() || null,
    humedad_p_recipiente: numeroTipeado(cuerpo.humedad_p_recipiente),
    humedad_p_inicial: numeroTipeado(cuerpo.humedad_p_inicial),
    humedad_p_final: numeroTipeado(cuerpo.humedad_p_final),
    peso_vol_gramos: numeroTipeado(cuerpo.peso_vol_gramos),
    peso_vol_volumen_cc: numeroTipeado(cuerpo.peso_vol_volumen_cc),
    cal_util_ml_acido: numeroTipeado(cuerpo.cal_util_ml_acido),
    cal_util_peso_muestra_g: numeroTipeado(cuerpo.cal_util_peso_muestra_g),
    granulometria_peso_muestra_g: numeroTipeado(cuerpo.granulometria_peso_muestra_g),
  };

  const retenidos: RetenidoValidado[] = [];
  const vistas = new Set<number>();

  for (const crudo of cuerpo.retenidos ?? []) {
    const malla = numeroTipeado(crudo.malla);
    const retenido = numeroTipeado(crudo.retenido_g);

    // Una fila sin ninguno de los dos es un renglón que quedó en blanco en la
    // pantalla, no un error: se descarta.
    if (malla === null && retenido === null) continue;

    if (malla === null || !Number.isInteger(malla) || malla <= 0) {
      return { problema: "Hay un renglón de granulometría sin número de malla." };
    }
    if (retenido === null || retenido < 0) {
      return { problema: `Falta el retenido de la malla #${malla}.` };
    }
    if (vistas.has(malla)) {
      return { problema: `La malla #${malla} está dos veces.` };
    }

    vistas.add(malla);
    retenidos.push({ malla, retenido_g: retenido });
  }

  // UNA MUESTRA SIN NINGUNA DETERMINACIÓN NO ES UNA MUESTRA. Guardarla deja una
  // fila que en el listado se lee como "ese día se ensayó y no dio nada", que es
  // justo la confusión que este módulo existe para evitar.
  const hayAlgo =
    retenidos.length > 0 ||
    [
      muestra.humedad_p_recipiente,
      muestra.humedad_p_inicial,
      muestra.humedad_p_final,
      muestra.peso_vol_gramos,
      muestra.cal_util_ml_acido,
    ].some((v) => v !== null);

  if (!hayAlgo) {
    return { problema: "La muestra no tiene ninguna determinación cargada." };
  }

  return { muestra, retenidos };
}
