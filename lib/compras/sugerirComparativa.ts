/**
 * Qué planilla de comparativa le corresponde a un pedido.
 *
 * Hasta el 27/11/2026 esto lo elegía la persona de una lista de 199 archivos,
 * y el componente que la mostraba decía que «no se puede adivinar». Con 1.717
 * pedidos ya enlazados eso se podía medir en vez de suponer, y medido resultó
 * ser mitad cierto: **no se puede adivinar siempre, pero sí se puede sugerir**.
 *
 * ── LAS TRES SEÑALES, Y CUÁNTO ACIERTA CADA UNA ────────────────────────────
 *
 * Simulando hacia adelante, pedido por pedido, sobre los 1.717 enlaces reales
 * —cada uno adivinado usando sólo los que lo precedían—:
 *
 * | señal | acierta | contesta en |
 * |---|---|---|
 * | el mismo artículo ya se enlazó antes | **95,1%** | 407 de 1.667 |
 * | el nombre del archivo | 68,4% | 1.259 |
 * | un pedido parecido fue a ese archivo | 68,0% | 1.560 |
 * | el área del pedido | 18,5% | 1.663 |
 *
 * El área quedó afuera: 18,5% es peor que tirar la moneda entre dos, y sumarla
 * sólo movía el total de 69,3% a 69,3%.
 *
 * Las otras tres son **complementarias y por eso están las tres**. La primera
 * es casi certera pero muda en tres de cada cuatro pedidos, porque la mayoría
 * son de un artículo que nunca se pidió. La del nombre es la única que puede
 * contestar por un archivo **que nunca se usó**, y eso importa más de lo que
 * parece: el 12,1% de los enlaces estrenan un archivo, y ése es el techo duro
 * de cualquier método que sólo mire el pasado. En esos 175 estrenos el nombre
 * solo acierta el **69,1%**, porque los archivos se llaman como el artículo en
 * plural: CORREAS, MECHAS, CAÑOS, FICHAS, MANGUERAS, RODAMIENTOS.
 *
 * ── POR QUÉ SUGIERE Y NO ELIGE ─────────────────────────────────────────────
 *
 * Porque fuera de la señal fuerte acierta dos de cada tres, y es la misma
 * cuenta que ya hizo `historicoDelArticulo` para no marcar nada solo: «un
 * aviso que se equivoca una de cada cinco veces enseña a ignorar los avisos».
 * Elegir sola la planilla equivocada es peor que no elegir ninguna —las filas
 * de otro RI se importan a éste— y el error no se nota hasta que alguien mira
 * los presupuestos y no reconoce ninguno.
 *
 * Así que devuelve **hasta tres**, cada una con el motivo en castellano, y
 * dice cuál es de la clase certera. Las tres juntas contienen la correcta el
 * **80,6%** de las veces. La carpeta entera sigue abajo, como antes.
 *
 * ── CÓMO «APRENDE» ─────────────────────────────────────────────────────────
 *
 * No hay tabla nueva ni nada que entrenar: lo que aprende es el historial de
 * `comparativa_drive_id`, que ya se escribía. Cada enlace que una persona
 * hace mejora la sugerencia siguiente, y un artículo que se enlaza dos veces
 * al mismo archivo pasa a la señal del 95%. Eso también quiere decir que **no
 * hay nada que mantener ni que reentrenar**, y que una corrección se aplica
 * sola: si alguien enlaza distinto, el próximo pedido igual sigue al nuevo.
 */

/** Un archivo de la carpeta de comparativas de Drive. */
export interface ArchivoDeLaCarpeta {
  id: string;
  nombre: string;
}

/** Un pedido que ya tiene su comparativa elegida. Es de lo que se aprende. */
export interface EnlacePasado {
  driveId: string;
  nombre: string | null;
  claveArticulo: string | null;
  descripcion: string | null;
}

export interface Sugerencia {
  driveId: string;
  nombre: string;
  /** Por qué se sugiere, en castellano y nombrando la evidencia. */
  porque: string;
  /**
   * Si viene de la señal del 95%: el mismo artículo ya se enlazó antes.
   *
   * La pantalla la distingue porque son dos cosas distintas de creer. Mostrar
   * las cuatro juntas sin decir cuál es cuál hace que la de 95% pese lo mismo
   * que la de 68%, y entonces la buena no sirve para ahorrar la revisión.
   */
  fuerte: boolean;
}

/** Palabras que aparecen en todo y no distinguen ningún archivo. */
const VACIAS = new Set([
  "DE", "DEL", "LA", "EL", "LOS", "LAS", "PARA", "POR", "CON", "Y", "EN",
  "UN", "UNA", "SEGUN", "MM", "CM", "TIPO", "MARCA",
]);

/**
 * Las palabras con las que se compara un texto, sin acentos y sin plural.
 *
 * El plural es lo que hace funcionar todo el mecanismo y no es un detalle de
 * estilo: los archivos se llaman en plural —CORREAS— y los pedidos en singular
 * —«CORREA D-162»—, así que sin unificarlos la señal del nombre no encuentra
 * nada. La regla es tosca a propósito (saca una «S» o un «ES» final) porque
 * acertar la morfología del castellano no hace falta para parear dos palabras
 * que ya son casi la misma.
 *
 * Los tokens de menos de tres letras y los que tienen un número se tiran:
 * «B-58», «6204», «3P» son lo que distingue un pedido de otro **dentro** de un
 * mismo archivo, que es justo lo contrario de lo que se busca acá.
 */
export function raicesDelTexto(texto: string): string[] {
  const limpio = String(texto ?? "")
    .normalize("NFD")
    // Sólo los diacríticos: el rango no toca la ñ, que es una letra y no una
    // n con sombrero. Descomponerla partiría CAÑO en CAN + O.
    .replace(/[̀-̂̄-ͯ]/g, "")
    // Y se vuelve a componer: la ñ es «n + tilde» después del NFD, y el filtro
    // de abajo la borraría dejando CAÑO en CANO —o en CAN, que fue lo que
    // pasó—. Sacar los diacríticos sin recomponer es la trampa que este repo
    // ya tiene anotada para `norm`.
    .normalize("NFC")
    .toUpperCase()
    .replace(/[^A-ZÑ0-9 ]/g, " ");

  const raices = new Set<string>();

  for (const token of limpio.split(" ")) {
    if (token.length < 3) continue;
    if (/[0-9]/.test(token)) continue;
    if (VACIAS.has(token)) continue;

    const raiz = token.endsWith("ES") && token.length > 4
      ? token.slice(0, -2)
      : token.endsWith("S") && token.length > 3
        ? token.slice(0, -1)
        : token;

    raices.add(raiz);
  }

  return [...raices];
}

/** Cuánto pesa cada señal. El orden entre ellas es lo medido; el valor, no. */
const PESO = {
  /* Alto para que gane siempre: con 95% de acierto, que una suma de parecidos
     la desplace sería cambiar la señal buena por la floja. */
  mismoArticulo: 100,
  nombre: 3,
  parecido: 1,
};

interface Candidato {
  puntos: number;
  porque: string;
  fuerte: boolean;
  /** Para desempatar el motivo: gana el que más evidencia tiene. */
  fuerza: number;
}

/**
 * Hasta tres planillas para este pedido, de la más probable a la menos.
 *
 * Devuelve vacío cuando ninguna señal dice nada, y eso es deliberado: el
 * primero de una lista ordenada al azar se lee como una recomendación. Medido
 * sobre los enlaces reales, eso pasa en 2 de 1.667 pedidos.
 */
export function sugerirComparativa(
  pedido: { descripcion: string | null; claveArticulo: string | null },
  carpeta: ArchivoDeLaCarpeta[],
  pasados: EnlacePasado[],
  cuantas = 3
): Sugerencia[] {
  const raicesDelPedido = raicesDelTexto(pedido.descripcion ?? "");
  if (carpeta.length === 0) return [];

  const candidatos = new Map<string, Candidato>();
  const sumar = (id: string, puntos: number, porque: string, fuerte: boolean, fuerza: number) => {
    const previo = candidatos.get(id);
    if (!previo) {
      candidatos.set(id, { puntos, porque, fuerte, fuerza });
      return;
    }
    previo.puntos += puntos;
    // El motivo que se muestra es el de la señal más fuerte que lo eligió, no
    // el último en sumarse: «2 pedidos de lo mismo fueron acá» explica mejor
    // que «el nombre dice CORREAS» cuando valen las dos.
    if (fuerza > previo.fuerza) {
      previo.porque = porque;
      previo.fuerza = fuerza;
      previo.fuerte = fuerte;
    }
  };

  // Sólo se sugiere lo que está en la carpeta hoy: un archivo que el historial
  // conoce pero que alguien borró de Drive no se puede abrir, y ofrecerlo es
  // mandar a un callejón.
  const enLaCarpeta = new Map(carpeta.map((a) => [a.id, a.nombre]));

  // ── 1. El mismo artículo, ya enlazado antes ──
  const clave = (pedido.claveArticulo ?? "").trim();
  if (clave) {
    const porArchivo = new Map<string, number>();
    for (const p of pasados) {
      if (p.claveArticulo?.trim() !== clave) continue;
      if (!enLaCarpeta.has(p.driveId)) continue;
      porArchivo.set(p.driveId, (porArchivo.get(p.driveId) ?? 0) + 1);
    }
    for (const [id, veces] of porArchivo) {
      sumar(
        id,
        PESO.mismoArticulo * veces,
        `${veces} pedido${veces === 1 ? "" : "s"} de lo mismo ${veces === 1 ? "fue" : "fueron"} a esta planilla`,
        true,
        3
      );
    }
  }

  if (raicesDelPedido.length > 0) {
    // ── 2. El nombre del archivo ──
    for (const a of carpeta) {
      const raicesDelNombre = raicesDelTexto(a.nombre);
      if (raicesDelNombre.length === 0) continue;

      const comunes = raicesDelNombre.filter((p) => raicesDelPedido.includes(p));
      if (comunes.length === 0) continue;

      // Dividido por el largo del nombre: un archivo que se llama con una sola
      // palabra y la comparte vale más que uno de cinco palabras que comparte
      // una. Sin eso, los nombres largos ganan por tener más chances.
      sumar(
        a.id,
        (PESO.nombre * comunes.length) / raicesDelNombre.length,
        `el nombre de la planilla dice «${a.nombre}»`,
        false,
        2
      );
    }

    // ── 3. Otro pedido parecido fue a ese archivo ──
    //
    // La única de las tres que mira la descripción de los pedidos viejos. Es
    // la que salva a los archivos genéricos —«REPUESTOS MÁQUINAS», el más
    // usado con 157 pedidos— cuyo nombre no se parece a nada.
    const mejorParecido = new Map<string, { puntos: number; descripcion: string }>();
    for (const p of pasados) {
      if (!enLaCarpeta.has(p.driveId)) continue;

      const suyas = raicesDelTexto(p.descripcion ?? "");
      if (suyas.length === 0) continue;

      const comunes = suyas.filter((x) => raicesDelPedido.includes(x)).length;
      if (comunes === 0) continue;

      const puntos = comunes / Math.max(raicesDelPedido.length, suyas.length);
      const previo = mejorParecido.get(p.driveId);
      if (!previo || puntos > previo.puntos) {
        mejorParecido.set(p.driveId, { puntos, descripcion: p.descripcion ?? "" });
      }
    }
    for (const [id, { puntos, descripcion }] of mejorParecido) {
      sumar(id, PESO.parecido * puntos, `«${descripcion}» fue a esta planilla`, false, 1);
    }
  }

  return [...candidatos.entries()]
    .sort((a, b) => b[1].puntos - a[1].puntos)
    .slice(0, cuantas)
    .map(([id, c]) => ({
      driveId: id,
      nombre: enLaCarpeta.get(id) ?? "",
      porque: c.porque,
      fuerte: c.fuerte,
    }));
}
