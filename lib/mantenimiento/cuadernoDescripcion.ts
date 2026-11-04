import { claveDeTarea } from "./cuadernoGrupos";

/**
 * La descripción de una OT del cuaderno: **sólo qué se hizo**.
 *
 * ── POR QUÉ ES SÓLO LA TAREA (03/11/2026) ───────────────────────────────────
 *
 * Hasta hoy la descripción acumulaba todo lo que la orden sabía:
 *
 *     Resoldar chapas impacto rompedores p/ TRT Nº2 — PIPARO. El 19/10.
 *     8 h en total. Según el cuaderno: Resoldar chapas impacto rompedores
 *     p/ TRT Nº2 (19/10, 8 h).
 *
 * Cuatro datos —contratista, fecha de cierre, horas y el detalle— metidos en
 * una celda de texto **que tienen su propia columna en el master**: N
 * CONTRATISTA, K FECHA DE CIERRE, O HORAS. Escribirlos en la descripción no es
 * redundancia inofensiva: una columna no se puede filtrar ni sumar desde un
 * párrafo, y la planilla es de donde lee quien no entra al sistema.
 *
 * El precio ya viajaba aparte y sigue igual: va en `REPUESTO UTILIZADO`, que es
 * donde la práctica ya lo ponía a mano (ver `costoEnRepuesto.ts`).
 *
 * ── EL DENOMINADOR COMÚN, Y POR QUÉ NO ES «LA PRIMERA» ──────────────────────
 *
 * Un renglón suelto trae su tarea y listo. Un grupo trae varias, y hasta hoy se
 * pegaban una atrás de otra. Medido sobre los cinco grupos que una persona
 * juntó de verdad (03/11/2026): **ninguno tiene las cuatro tareas idénticas**,
 * así que «si son todas iguales, usar ésa» no habría servido para ninguno.
 *
 *     «Limpieza techo Hidratación» · «Limpieza techo hidratacion» ·
 *     «Limpieza techos hidratacion» · «Limpieza techos hidratación»
 *
 * Son la misma tarea escrita de cuatro formas. Por eso el denominador son **las
 * palabras que están en todas**, dichas con las palabras de la primera —que es
 * como la escribió quien llevó el cuaderno—, y por eso `mismaPalabra` tolera el
 * plural: sin eso, «techo» y «techos» no coinciden y el denominador se queda en
 * «Limpieza».
 *
 * ── Y CUÁNDO NO HAY DENOMINADOR ─────────────────────────────────────────────
 *
 * El quinto grupo real es «Limpieza en cinta tolva», «Limpieza cola cinta 1
 * filer 2 parte superior», «Limpieza en cinta 2 filer p/ sup.» y «Limpieza
 * costado tolva filer 2»: lo único que comparten es «limpieza». Una orden que
 * dijera sólo eso es peor que no simplificar nada, así que **con menos de dos
 * palabras en común se listan las tareas distintas**. Simplificar cuando hay
 * algo a qué simplificar; no inventar un resumen cuando no lo hay.
 */

/** Las palabras de una tarea, normalizadas: minúsculas, sin acentos ni puntuación. */
function palabrasDe(tarea: string): string[] {
  return claveDeTarea(tarea).split(" ").filter(Boolean);
}

/**
 * Si dos palabras normalizadas son la misma.
 *
 * Iguales, o una prefijo de la otra con **las dos de cuatro letras o más y a lo
 * sumo dos de diferencia**. Es lo que hace que «techo» y «techos» cuenten como
 * una sola, que es el caso medido.
 *
 * Los dos límites están para que no se parezcan dos cosas distintas: sin el de
 * cuatro letras, «sin» entraría en «sinfín»; sin el de dos caracteres,
 * «cinta» entraría en «cintaplast». Y como el prefijo tiene que ser exacto,
 * «Nº1» y «Nº2» no se parecen nunca —que es justo lo que no puede fallar—.
 */
export function mismaPalabra(a: string, b: string): boolean {
  if (a === b) return true;
  const [corta, larga] = a.length <= b.length ? [a, b] : [b, a];
  return corta.length >= 4 && larga.length - corta.length <= 2 && larga.startsWith(corta);
}

/** Cuántas palabras en común hacen falta para que el denominador sirva. */
const MINIMO_DE_PALABRAS = 2;

/**
 * El texto original recortado a las palabras comunes, conservando cómo estaban
 * escritas: los acentos, las mayúsculas y los `Nº2`.
 *
 * Se trabaja sobre los trozos del original separados por espacios. Uno que al
 * normalizarse no deja nada —`«—»`, `«/»`— se cae solo, y uno que deja varias
 * palabras sólo entra si **todas** son comunes.
 */
function recortar(original: string, comunes: ReadonlySet<string>): string {
  return original
    .split(/\s+/)
    .filter((trozo) => {
      const ws = palabrasDe(trozo);
      return ws.length > 0 && ws.every((w) => comunes.has(w));
    })
    .join(" ")
    .trim();
}

/**
 * Qué dice la descripción de una orden armada con estas tareas.
 *
 * Una sola tarea sale tal cual se escribió. Varias salen por su denominador
 * común y, si no lo hay, listadas con `·`.
 */
export function denominadorComun(tareas: readonly string[]): string {
  const limpias = tareas.map((t) => String(t ?? "").trim()).filter(Boolean);
  if (limpias.length === 0) return "";
  if (limpias.length === 1) return limpias[0];

  const porTarea = limpias.map(palabrasDe);
  const [primera, ...resto] = porTarea;

  // Las palabras de la primera que aparecen —ellas o su plural— en todas las
  // demás. El orden es el de la primera: es el texto que se va a recortar.
  const comunes = new Set(
    primera.filter((p) => resto.every((ws) => ws.some((w) => mismaPalabra(p, w))))
  );

  if (comunes.size >= MINIMO_DE_PALABRAS) {
    const recortado = recortar(limpias[0], comunes);
    if (recortado) return recortado;
  }

  return [...new Set(limpias)].join(" · ");
}
