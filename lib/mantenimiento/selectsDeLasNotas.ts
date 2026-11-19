/**
 * Que ningún `select` sobre `ordenes_trabajo_notas` se olvide una columna de la
 * conversación — leyendo **el texto** de los archivos, no corriendo las rutas.
 *
 * ── POR QUÉ ESTO EXISTE, Y POR QUÉ NO ES UN TERCER TEST DE RUTA ──────────────
 *
 * El fallo más caro de esta tabla es un `select` incompleto, y **no se parece a un
 * error**. Sin `tipo`, `repuesto_id` o `responde_a`, `preguntasAbiertas` devuelve
 * `[]`: ninguna pregunta aparece abierta, la bandeja de Compras sale vacía y el
 * historial de la OT deja de ofrecer «Ya llegó», todo sin una sola excepción. Sin
 * `creado_en`, `laUltimaNota` y el orden de la bandeja se van a cero y la pantalla
 * imprime «Preguntó Ana · nunca». Sin `orden_id`, ninguna nota se agrupa con su
 * orden y pasa lo mismo que sin `tipo`.
 *
 * Nada de eso lo ve el compilador: la casa obliga a que el `select` vaya **literal**
 * —armado en una variable, Supabase pierde la inferencia— y el cliente admin no
 * recibe el tipo `Database`, así que lo que trae llega sin tipos y la ruta lo castea.
 *
 * Hasta el 31/10/2026 la guarda era una **lista de columnas escrita a mano** en cada
 * test de ruta, una por ruta. Falló la segunda vez que se usó, y falló de la única
 * forma que importa: a la lista de `rutaDeConsultas.test.ts` le faltaba `creado_en`,
 * así que sacar esa columna del `select` pasaba los 164 tests y mataba en silencio
 * «la más vieja arriba», que es la razón declarada de esa pantalla. Agregarle
 * `creado_en` a la lista habría arreglado el síntoma y dejado sin guarda a la
 * próxima columna, y a la próxima ruta.
 *
 * Esto es esa guarda hecha una sola vez: cubre las dos rutas que hay **y la tercera
 * que nadie escribió todavía**. Lo que el texto no puede ver —que un rechazo no
 * inserte ni escriba la planilla ni avise, la forma del `insert`, que un push caído
 * no voltee lo guardado— se queda en los tests de ruta con su Supabase de mentira,
 * que es donde sí vale.
 *
 * ── QUÉ DISPARA LA EXIGENCIA, Y POR QUÉ NO ES «TODO SELECT» ──────────────────
 *
 * Exigirle las cinco columnas a cualquier `select` de la tabla sería rojo desde el
 * primer día, y un chequeo siempre rojo no lo mira nadie: el `DELETE` de la ruta de
 * notas pide `select("id")` para saber si borró, y después `select("id, texto,
 * creado_en")` para `laUltimaNota`, y las dos cosas están bien. El disparador es
 * **nombrar alguna columna de la conversación**: un `select` que trae `tipo`,
 * `repuesto_id` o `responde_a` está leyendo la conversación, y quien lee la
 * conversación la necesita entera.
 *
 * El agujero que eso deja, dicho: un `select` que no nombre **ninguna** de las tres
 * es invisible acá. Lo tapan los tests de ruta por el otro lado —sin `tipo` la
 * bandeja sale vacía y sus casos se caen—, así que el hueco es el de sacar las tres
 * juntas, que ya no es editar un `select` sino escribirlo de nuevo.
 *
 * `orden_id` va aparte porque sólo hace falta cuando el `select` **cruza órdenes**:
 * una lectura acotada con `.eq("orden_id", …)` ya sabe de cuál es cada fila, y un
 * `insert` escribe la columna él mismo.
 */

/** Las columnas sin las que la conversación se lee mal, y en silencio. */
export const COLUMNAS_DE_LA_CONVERSACION = [
  // `preguntasAbiertas` las usa para decidir qué espera respuesta.
  "tipo",
  "repuesto_id",
  "responde_a",
  // `laUltimaNota` y el orden de la bandeja. Sin ella todo pasa a «nunca».
  "creado_en",
] as const;

/**
 * Las que delatan que un `select` está leyendo la conversación.
 *
 * `creado_en` no está: lo trae también quien sólo quiere la última nota, que es un
 * uso legítimo y no necesita el resto.
 */
export const DISPARADORES = ["tipo", "repuesto_id", "responde_a"] as const;

/** Lo que se reporta cuando el `select` no se pudo leer del texto. */
export const NO_VA_LITERAL = "el select no va literal (la cadena tiene que ir escrita)";

/** Un `select` sobre la tabla, tal como está escrito en el archivo. */
export interface SelectDeLasNotas {
  archivo: string;
  /** La línea del `.from(`, contada desde 1, para poder ir. */
  linea: number;
  /** Las columnas pedidas, o `null` si el argumento no es una cadena escrita. */
  columnas: string[] | null;
  /** La cadena lleva `.eq("orden_id", …)`: es de una sola orden. */
  acotadoAUnaOrden: boolean;
  /** Es un `insert(...).select(...)`: la fila la escribe la ruta. */
  esInsert: boolean;
}

const LA_TABLA = 'from("ordenes_trabajo_notas")';

/** El primer argumento de `.select(`, si es una cadena escrita a mano. */
function columnasDe(cadena: string): string[] | null {
  const desde = cadena.indexOf(".select(");
  if (desde === -1) return null;

  const argumento = cadena.slice(desde + ".select(".length).trimStart();
  const comilla = argumento[0];
  if (comilla !== '"' && comilla !== "'") return null;

  const hasta = argumento.indexOf(comilla, 1);
  if (hasta === -1) return null;

  // Las comas de adentro de un paréntesis son de un embed —`autor:usuarios(nombre)`—
  // y no separan columnas.
  return argumento
    .slice(1, hasta)
    .split(/,(?![^(]*\))/)
    .map((c) => c.trim())
    .filter(Boolean);
}

/**
 * Los `select` sobre `ordenes_trabajo_notas` que hay en un archivo.
 *
 * Una cadena arranca en `.from("ordenes_trabajo_notas")` y termina en el primer `;`
 * o en el `.from(` siguiente, lo que venga antes: el segundo corte es lo que impide
 * que dos consultas hermanas de un `Promise.all` se lean como una sola.
 *
 * Una cadena sin `select` —un `delete()` pelado— no devuelve nada: no hay columnas
 * que mirar.
 */
export function selectsDeLasNotas(archivo: string, fuente: string): SelectDeLasNotas[] {
  const salida: SelectDeLasNotas[] = [];

  for (let i = fuente.indexOf(LA_TABLA); i !== -1; i = fuente.indexOf(LA_TABLA, i + 1)) {
    const siguienteFrom = fuente.indexOf(".from(", i + LA_TABLA.length);
    const puntoYComa = fuente.indexOf(";", i);
    const fin = Math.min(
      siguienteFrom === -1 ? fuente.length : siguienteFrom,
      puntoYComa === -1 ? fuente.length : puntoYComa
    );
    const cadena = fuente.slice(i, fin);

    if (!cadena.includes(".select(")) continue;

    salida.push({
      archivo,
      linea: fuente.slice(0, i).split("\n").length,
      columnas: columnasDe(cadena),
      acotadoAUnaOrden: cadena.includes('.eq("orden_id"'),
      esInsert: cadena.includes(".insert("),
    });
  }

  return salida;
}

/**
 * Qué le falta a un `select` para poder leer la conversación, o `[]` si está bien.
 *
 * Un `select("*")` trae todo y pasa. Uno que no nombra ninguna columna de la
 * conversación no la está leyendo y también pasa: el porqué está en el encabezado.
 */
export function loQueLeFalta(select: SelectDeLasNotas): string[] {
  const { columnas } = select;
  if (columnas === null) return [NO_VA_LITERAL];
  if (columnas.includes("*")) return [];

  if (!DISPARADORES.some((c) => columnas.includes(c))) return [];

  const faltan: string[] = COLUMNAS_DE_LA_CONVERSACION.filter((c) => !columnas.includes(c));

  // Cruza órdenes: hay que saber de cuál es cada fila.
  if (!select.esInsert && !select.acotadoAUnaOrden && !columnas.includes("orden_id")) {
    faltan.push("orden_id");
  }

  return faltan;
}
