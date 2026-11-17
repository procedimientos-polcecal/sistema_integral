/**
 * Pasar una muestra de Ensayos a la misma forma larga que el histórico.
 *
 * Las dos mitades de la búsqueda tienen que poder salir en la misma lista: el
 * histórico ya es largo —una fila por valor— y Ensayos es ancho y guarda los
 * gramos. Esto despeja sus porcentajes al leer, **sin guardarlos**.
 *
 * Las etiquetas se reusan de `lib/calidad/ensayos/reporte.ts` y del mismo texto
 * que trae la planilla vieja. Si las dos mitades no se escriben igual, buscar
 * "humedad" encuentra una sola.
 *
 * Y la escala las distingue sin ambigüedad: Ensayos devuelve la humedad **en por
 * ciento** —0,68 quiere decir 0,68%— mientras el histórico la guarda como
 * fracción —0,0068 quiere decir lo mismo—. Las dos conviven en la lista porque
 * cada una dice en qué escala está.
 */

import { humedad, pesoVolumetrico, calUtilVial } from "@/lib/calidad/ensayos/determinaciones";
import { granulometria } from "@/lib/calidad/ensayos/granulometria";
import type { Muestra, Retenido } from "@/lib/calidad/ensayos/types";
import type { Escala } from "./escala";

export interface FilaDeLaBusqueda {
  fecha: string;
  origen: string;
  determinacion: string;
  valor: number;
  escala: Escala;
  unidad: string | null;
  fuente: "historico" | "ensayos";
  revisar: string | null;
  /** Sólo el histórico la tiene: es lo que distingue dos muestras del mismo día. */
  fila_excel: number | null;
}

/** Cómo se llama cada determinación. El mismo texto que usa la planilla vieja. */
const ETIQUETA = {
  humedad: "Humedad bh (%)",
  pesoVolumetrico: "Peso volumétrico (g/l)",
  calUtilVial: "Cal Util Vial (%)",
  retenido: (malla: number) => `Ret #${malla} (%)`,
  acumulado: (malla: number) => `Acumulado en #${malla} (%)`,
} as const;

/**
 * Una muestra de Ensayos, como filas de la búsqueda.
 *
 * Lo que no se midió no genera fila: una muestra con humedad y nada más
 * devuelve una sola, no siete vacías.
 */
export function aplanarMuestra(
  muestra: Muestra,
  retenidos: Retenido[],
  producto: string
): FilaDeLaBusqueda[] {
  const filas: FilaDeLaBusqueda[] = [];

  const sumar = (determinacion: string, valor: number | null, unidad: string) => {
    if (valor === null) return;
    filas.push({
      fecha: muestra.fecha,
      origen: producto,
      determinacion,
      valor,
      // Las cuentas de Ensayos devuelven por ciento y g/l ya hechos.
      escala: unidad === "%" ? "porcentaje" : "absoluto",
      unidad,
      fuente: "ensayos",
      revisar: null,
      fila_excel: null,
    });
  };

  sumar(ETIQUETA.humedad, humedad({
    recipiente: muestra.humedad_p_recipiente,
    inicial: muestra.humedad_p_inicial,
    final: muestra.humedad_p_final,
  }).valor, "%");

  sumar(ETIQUETA.pesoVolumetrico, pesoVolumetrico({
    gramos: muestra.peso_vol_gramos,
    volumenCc: muestra.peso_vol_volumen_cc,
  }).valor, "g/l");

  sumar(ETIQUETA.calUtilVial, calUtilVial({
    mlAcido: muestra.cal_util_ml_acido,
    pesoMuestraG: muestra.cal_util_peso_muestra_g,
  }).valor, "%");

  const granos = granulometria({
    pesoMuestraG: muestra.granulometria_peso_muestra_g,
    retenidos: retenidos.map((r) => ({ malla: r.malla, retenido_g: r.retenido_g })),
  });
  for (const fila of granos.filas) {
    sumar(ETIQUETA.retenido(fila.malla), fila.retenido.valor, "%");
    sumar(ETIQUETA.acumulado(fila.malla), fila.acumulado.valor, "%");
  }

  return filas;
}

/**
 * Un texto listo para buscar: sin acentos, sin eñes y en minúscula.
 *
 * Hace falta porque la planilla escribe `BOLSAS CAL GÜEMES` y nadie busca con
 * diéresis. Sin esto el dato existe y no aparece, que es la peor forma de que un
 * buscador falle.
 */
export function normalizarParaBuscar(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}
