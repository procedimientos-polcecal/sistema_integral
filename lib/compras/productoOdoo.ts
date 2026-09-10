/**
 * Qué producto del catálogo de Odoo le corresponde a un requerimiento.
 *
 * Toda orden generada desde el SdG llevaba `ART. VARIOS`. La descripción del RI
 * va en el `name` de la línea —que es lo que se ve e imprime—, así que la orden
 * se leía bien; lo que quedaba mal es la **cuenta contable**, que la aporta el
 * producto, y con eso todo el gasto del módulo caía en la misma bolsa.
 *
 * POR QUÉ LA CABEZA
 *
 * El catálogo de Odoo no son SKUs sino rubros —`GUANTES`, `CABLES`, `BUJES`—.
 * Un primer prototipo puntuaba por "qué proporción del nombre del producto
 * aparece en la descripción" y **fallaba con confianza**: `Guantes de grasa`
 * daba `GRASAS`, y `MASCARILLA CON VÁLVULA` daba `VÁLVULAS`. Exigir que la
 * primera palabra significativa de la descripción sea también la primera del
 * producto arregla justo esos casos, con la misma cobertura.
 *
 * POR QUÉ NO SE ACEPTAN LOS PARCIALES
 *
 * Medido sobre 300 requerimientos reales: la franja que comparte la cabeza pero
 * no el resto del nombre son 29 (10%), y ahí el match está **mayormente mal**
 * —`Llave combinada fija 13mm` → `LLAVE DE IMPACTO`, `Rollo de Papel Higiénico`
 * → `ROLLO PAPEL FILM`, `Bolsas de cal Moreno` → `BOLSAS CAL GÜEMES`, que es
 * otra marca—. Un producto equivocado no se nota nunca. Se prefiere no sugerir.
 *
 * Cobertura medida con esta regla: 160 de 300 (53%) sugeridos, 111 (37%) sin
 * sugerencia. Lo que falta lo va llenando la tabla de lo aprendido.
 */

/** Un producto comprable de Odoo. El id es de `product.product`. */
export interface ProductoDeOdoo {
  id: number;
  nombre: string;
}

export type MotivoDeSugerencia = "aprendido" | "sugerido" | "sin_sugerencia";

export interface Sugerencia {
  /** `null` cuando no hay nada con qué arriesgar: la orden usa `ART. VARIOS`. */
  producto: ProductoDeOdoo | null;
  motivo: MotivoDeSugerencia;
  /** Los que empataron, para que la pantalla los ofrezca a un clic. */
  alternativas: ProductoDeOdoo[];
}

/**
 * Palabras que no distinguen nada.
 *
 * Van las preposiciones y las unidades: `Cable de 3 mm` y `Cable 3mm` tienen que
 * dar lo mismo. No van los adjetivos ni los materiales —`GOMA`, `ACERO`—, que sí
 * distinguen un producto de otro.
 */
const VACIAS = new Set([
  "DE", "DEL", "LA", "EL", "LOS", "LAS", "PARA", "CON", "SIN", "POR", "UN",
  "UNA", "EN", "MM", "CM", "MT", "MTS", "KG", "LTS", "UNIDAD", "TIPO",
]);

/** Sólo dígitos: una medida (`3`, `4`) no es una palabra vacía aunque sea corta. */
const esNumero = (palabra: string) => /^[0-9]+$/.test(palabra);

/**
 * Plural tosco: saca la `S` final de las palabras de 4 letras o más.
 *
 * `GUANTES` → `GUANTE`, y así el rubro en plural del catálogo empareja con la
 * descripción en singular. Se deja corta a propósito: `GAS` no es `GA`.
 */
const raiz = (palabra: string) =>
  palabra.length >= 4 && palabra.endsWith("S") ? palabra.slice(0, -1) : palabra;

/** El texto listo para comparar, y la clave de lo aprendido. */
export function normalizarDescripcion(texto: string): string {
  const base = String(texto ?? "")
    .normalize("NFD")
    // Marcas combinantes (acentos, diéresis) que deja sueltas la normalizacion
    // NFD. Van los escapes explicitos U+0300-U+036F: el mismo rango pegado
    // como caracteres literales es indistinguible a simple vista de uno mal
    // copiado, y si no saca el acento la mitad del emparejador (todo lo que
    // dependa de que "Guante" con tilde y sin tilde den la misma clave) se
    // rompe en silencio.
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!base) return "";

  // Palabras vacías y plural tosco se aplican acá, no sólo al tokenizar para
  // comparar contra el catálogo: esta función es también la clave con la que
  // se guarda y se busca en la tabla de lo aprendido, y "Guantes de grasa" y
  // "Guante grasa" tienen que ser la misma clave.
  return base
    .split(" ")
    .filter((p) => esNumero(p) || (p.length >= 3 && !VACIAS.has(p)))
    .map(raiz)
    .join(" ");
}

const tokens = (texto: string) => {
  const normalizado = normalizarDescripcion(texto);
  return normalizado === "" ? [] : normalizado.split(" ");
};

export function sugerirProducto(
  descripcion: string,
  catalogo: ProductoDeOdoo[],
  /** Descripción normalizada → id de `product.product`, de lo ya confirmado. */
  aprendidos: Map<string, number>
): Sugerencia {
  const sinNada: Sugerencia = { producto: null, motivo: "sin_sugerencia", alternativas: [] };

  const aprendido = aprendidos.get(normalizarDescripcion(descripcion));
  if (aprendido !== undefined) {
    const p = catalogo.find((c) => c.id === aprendido);
    // Un producto archivado en Odoo ya no está en el catálogo: se cae a la
    // regla en vez de proponer un id que la orden va a rechazar.
    if (p) return { producto: p, motivo: "aprendido", alternativas: [] };
  }

  const dela = tokens(descripcion);
  if (dela.length === 0) return sinNada;

  const enDescripcion = new Set(dela);
  const candidatos = catalogo
    .map((p) => ({ p, toks: tokens(p.nombre) }))
    .filter(({ toks }) => toks.length > 0 && toks[0] === dela[0])
    // Entero: todos los tokens del producto están en la descripción.
    .filter(({ toks }) => toks.every((t) => enDescripcion.has(t)));

  if (candidatos.length === 0) {
    // Los que comparten la cabeza pero no entran enteros se ofrecen como
    // alternativas: no se sugieren, pero ahorran buscarlos en 378 nombres.
    const mismaCabeza = catalogo.filter((p) => {
      const t = tokens(p.nombre);
      return t.length > 0 && t[0] === dela[0];
    });
    return { ...sinNada, alternativas: mismaCabeza };
  }

  // Con empate gana el nombre más corto, que es el más genérico: entre
  // `GUANTES` y `GUANTES DE NITRILO` para "Guantes", el rubro.
  const ordenados = [...candidatos].sort(
    (a, b) => a.toks.length - b.toks.length || a.p.nombre.length - b.p.nombre.length
  );
  const gana = ordenados[0];
  const empatan = ordenados.filter((c) => c.toks.length === gana.toks.length);

  // Dos productos igual de específicos y los dos entran enteros: no hay con qué
  // elegir, así que se ofrecen los dos y no se arriesga ninguno.
  if (empatan.length > 1) {
    return { ...sinNada, alternativas: empatan.map((c) => c.p) };
  }

  return {
    producto: gana.p,
    motivo: "sugerido",
    alternativas: ordenados.slice(1).map((c) => c.p),
  };
}
