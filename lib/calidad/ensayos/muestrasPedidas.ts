import { TOPE_DE_MUESTRAS } from "./comparacion";

/**
 * Los ids de muestra que pide la URL de la curva granulométrica.
 *
 * **Se aceptan las dos formas.** `?muestras=a,b` es la nueva; `?muestra=a` es
 * la que tuvo la pantalla desde el 05/11/2026 y se sigue leyendo porque ya hay
 * enlaces de una muestra sola dando vueltas —se comparten por chat, que es
 * para lo que la muestra viaja en la URL— y romperlos no tiene ninguna ventaja.
 *
 * Saca repetidos y corta en `TOPE_DE_MUESTRAS`. Las dos cosas son por lo mismo:
 * la URL la escribe cualquiera, y un id repetido dibujaría la misma curva dos
 * veces mientras que una lista larga llenaría la pantalla de líneas y pediría
 * una consulta por cada una.
 *
 * No valida que sean UUID: de eso se encarga la base, que simplemente no
 * encuentra la muestra y la pantalla la saltea.
 */
export function leerMuestrasPedidas(crudo: {
  muestra?: string | string[];
  muestras?: string | string[];
}): string[] {
  const unico = (v: string | string[] | undefined): string => (Array.isArray(v) ? (v[0] ?? "") : (v ?? ""));

  const pedidos = [...unico(crudo.muestra).split(","), ...unico(crudo.muestras).split(",")]
    .map((id) => id.trim())
    .filter((id) => id !== "");

  return [...new Set(pedidos)].slice(0, TOPE_DE_MUESTRAS);
}
