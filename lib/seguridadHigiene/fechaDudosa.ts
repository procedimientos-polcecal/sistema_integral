/**
 * Las cinco fechas de detección que vinieron dudosas del Excel, para que la
 * ficha lo diga mientras sigan así.
 *
 * Es la tabla de `CLAUDE.md` («Las cinco fechas dudosas, con su evidencia»)
 * pasada a código, y el motivo no es decorativo: la única señal que quedaba en
 * los datos —que tres de ellas (N° 42, 43 y 44) eran futuras— se borró sola el
 * 13/11/2026, y desde ese día **la pantalla no tiene cómo mostrarlas distinto
 * de una fecha buena**.
 *
 * **Se compara el número Y el valor guardado**, no sólo el número: si alguien
 * corrige la fecha desde la ficha, el valor deja de ser el dudoso y el aviso
 * desaparece solo. Con el número solo, una fecha ya corregida seguiría
 * declarándose en duda.
 *
 * Los números 1 a 44 son los de la planilla (`numero` conserva el N° de origen);
 * las condiciones cargadas desde el sistema empiezan en el 46.
 *
 * **HAY DOS FORMAS DE QUE LA ADVERTENCIA SE VAYA, y la segunda no se adivina:**
 *
 *   1. **Corregir la fecha** desde la ficha: el valor guardado deja de ser el
 *      dudoso y la advertencia se apaga sola.
 *   2. **Confirmar que la fecha estaba bien**: no cambia ningún dato, así que
 *      nada la apaga. Se hace **borrando la entrada de `DUDOSAS`**. Si no se
 *      borra, la ficha sigue diciendo «sin confirmar y no se corrigió» para
 *      siempre, y eso pasa a ser falso.
 *
 * **La tabla vive en dos lugares** —`CLAUDE.md` y acá— y nada las ata: se
 * mueven juntas. Sacar una fila de la una sin la otra deja a una de las dos
 * mintiendo.
 *
 * Son conjeturas sobre el dato de otro y **ninguna está confirmada con quien
 * armó el `21-10-26.xlsm`**: los textos lo dicen. La del N° 6 es la más floja
 * de las cinco y el texto lo dice aparte.
 */

const SIN_CONFIRMAR = "Sin confirmar con quien armó la planilla, y no se corrigió.";

const COMO_EL_BLOQUE_DE_PLANTA_3 =
  "Fecha en duda: viene del Excel y dice 13/11/2026, pero el nombre de las fotos en la planilla dice 13/10/2026, " +
  "igual que las otras condiciones de su bloque (38 a 41). Parece un 11 por un 10. " +
  SIN_CONFIRMAR;

const DUDOSAS: { numero: number; detectada_el: string; texto: string }[] = [
  { numero: 42, detectada_el: "2026-11-13", texto: COMO_EL_BLOQUE_DE_PLANTA_3 },
  { numero: 43, detectada_el: "2026-11-13", texto: COMO_EL_BLOQUE_DE_PLANTA_3 },
  { numero: 44, detectada_el: "2026-11-13", texto: COMO_EL_BLOQUE_DE_PLANTA_3 },
  {
    numero: 7,
    detectada_el: "2026-01-10",
    texto:
      "Fecha en duda: viene del Excel y dice 10/01/2026, la única de enero. " +
      "Parece 01/10 leído con el mes y el día al revés. " +
      SIN_CONFIRMAR,
  },
  {
    numero: 6,
    detectada_el: "2026-10-10",
    texto:
      "Fecha en duda, la más floja de las cinco: viene del Excel y dice 10/10/2026, y la foto en la planilla es del 06/10. " +
      "Eso no prueba nada por sí solo: en esa planilla la foto no siempre es del día de la detección. " +
      SIN_CONFIRMAR,
  },
];

/** El texto de por qué la fecha de esta condición está en duda, o `null` si no lo está. */
export function fechaDudosaDelExcel(numero: number, detectada_el: string): string | null {
  return DUDOSAS.find((d) => d.numero === numero && d.detectada_el === detectada_el)?.texto ?? null;
}
