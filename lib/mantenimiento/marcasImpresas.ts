/**
 * Cómo se dice la especialidad de una orden **en papel**.
 *
 * En pantalla la especialidad es un color y alcanza. La impresora del taller es
 * blanco y negro, así que los cinco colores salen en cinco grises que no se
 * distinguen —y una fotocopia los junta todavía más—. Por eso acá la
 * especialidad es una letra en un recuadro: `M`, `E`, `C`, `L`, y `–` para
 * todo lo demás.
 *
 * Y hay una razón que va más allá de la impresora, medida: el relleno rojo de
 * «atrasada» **tapa el color de la especialidad** —una franja encima del color
 * da entre 1,20:1 y 2,03:1 de contraste, por debajo del 3:1 de WCAG—, así que
 * hoy, en pantalla, una orden atrasada no dice de qué especialidad es. La letra
 * sobrevive al relleno negro. La hoja va a decir algo que la pantalla no puede.
 *
 * Las cinco letras, y no seis: `INSTRUMENTACIÓN` y `OTRO` caen en `–` igual que
 * una especialidad vacía, que es exactamente lo que hacen hoy
 * `colorDeEspecialidad` (las manda al gris) y `oficioDeLaEspecialidad` (les
 * devuelve `null`). Las dos tienen 0 usos en 2.900 OT: inventarles una letra
 * sería gastar un símbolo del papel en algo que nadie carga.
 */
import { norm } from "@/lib/core/texto";

/**
 * La letra que representa esa especialidad.
 *
 * El `–` es un guión medio (U+2013) y no un guión corto: en un recuadro de 6
 * puntos el corto se confunde con un borde mal impreso.
 */
export function letraDeEspecialidad(especialidad: string | null | undefined): string {
  switch (norm(especialidad)) {
    case "MECANICO": return "M";
    case "ELECTRICO": return "E";
    case "CIVIL": return "C";
    case "LUBRICACION": return "L";
    default: return "–";
  }
}

/**
 * La leyenda que va al pie de cada hoja, en el orden en que se las nombra.
 *
 * Tiene que cubrir **todas** las letras que `letraDeEspecialidad` puede
 * devolver: una marca en la hoja que la leyenda no explica es peor que no tener
 * leyenda, porque quien la lee cree que la buscó mal.
 */
export const LEYENDA_IMPRESA: { letra: string; nombre: string }[] = [
  { letra: "M", nombre: "Mecánico" },
  { letra: "E", nombre: "Eléctrico" },
  { letra: "C", nombre: "Civil" },
  { letra: "L", nombre: "Lubricación" },
  { letra: "–", nombre: "Otra o vacía" },
];
