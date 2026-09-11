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
 * Cobertura medida contra los 1957 requerimientos reales de Compras y los 378
 * comprables del catálogo (10/09/2026, después de resolver el empate hacia el
 * nombre más corto en vez de rechazarlo — ver más abajo): 1139 de 1957 (58%)
 * sugeridos, 818 (42%) sin sugerencia. Lo que falta lo va llenando la tabla de
 * lo aprendido. (El spec de diseño trae los números de la muestra de 300 con
 * la que se probó el criterio antes de medir contra todo lo real; no son estos
 * números.)
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
  "UNA", "EN", "MM", "CM", "MT", "MTS", "KG", "LTS", "UNIDAD", "TIPO", "X",
]);

/** Sólo dígitos: una medida (`3`, `4`) no es una palabra vacía aunque sea corta. */
const esNumero = (palabra: string) => /^[0-9]+$/.test(palabra);

/**
 * Plural tosco: saca la `S` final de las palabras de 4 letras o más.
 *
 * `GUANTES` → `GUANTE`, y así el rubro en plural del catálogo empareja con la
 * descripción en singular. Se deja corta a propósito: `GAS` no es `GA`.
 *
 * RIESGO ASUMIDO: no toca los plurales en `-ES` (`BULONES`, `PERFILES`,
 * `AMORTIGUADORES`, `RETENES`, `IMANES`, `SENSORES`, `CONTACTORES`,
 * `DISYUNTORES`, `BOTINES` — unas 21 cabezas así en el catálogo). Un RI que
 * diga "Bulón de 1/2" en singular no engancha con `BULONES`. No se arregla
 * a propósito: estirar la regla a `-ES` se lleva puestas palabras que no son
 * plurales (`MES`, `INTERES`, `PIES` ya son otra cosa sin la `S`), y ese error
 * —enlazar mal— es el caro. Éste falla hacia `sin_sugerencia`, que es el lado
 * seguro: se pierde cobertura, no se rompe nada.
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

  // El plural tosco corre ANTES que las vacías, no después: si primero se
  // filtran las vacías, "TIPOS" (no está en la lista) sobrevive y la raíz lo
  // deja en "TIPO", pero "TIPO" escrito así de entrada sí está en la lista y
  // se filtra — la misma palabra da una clave distinta según cómo estaba
  // escrita en el RI, que es exactamente lo que la normalización tiene que
  // evitar. Con la raíz primero, las dos formas llegan a "TIPO" y ahí sí se
  // filtran igual.
  //
  // A propósito, NO se descarta un token por ser corto (una o dos letras): la
  // clave tiene que distinguir "CORREA A-68" de "CORREA B 68", y un filtro de
  // longitud acá los igualaba a los dos en "CORREA 68". El filtro de longitud
  // vive sólo en `tokens()`, que se usa para comparar, no para la clave.
  return base
    .split(" ")
    .map(raiz)
    .filter((p) => !VACIAS.has(p))
    .join(" ");
}

// El filtro de longitud queda acá, aparte de la clave: sirve para no
// engancharse con una letra suelta al comparar contra el catálogo, pero no
// puede tocar `normalizarDescripcion` porque ahí borraría el dato que
// distingue (ver el comentario de arriba).
const tokens = (texto: string) => {
  const normalizado = normalizarDescripcion(texto);
  if (normalizado === "") return [];
  return normalizado.split(" ").filter((p) => esNumero(p) || p.length >= 3);
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
  // `GUANTES` y `GUANTES DE NITRILO` para "Guantes", el rubro. De 1957 RI
  // reales, 82 de los 83 empates son un solo caso —`FILTRO` contra `FILTROS`,
  // dos entradas duplicadas del mismo rubro en el catálogo de Odoo— y ahí
  // rechazar en vez de elegir tira la sugerencia justo en lo que más se
  // compra. El desempate no arriesga nada que "entrar entero" no haya
  // arriesgado ya: los dos ya son candidatos válidos, sólo falta uno.
  const ordenados = [...candidatos].sort(
    (a, b) => a.toks.length - b.toks.length || a.p.nombre.length - b.p.nombre.length
  );
  const gana = ordenados[0];

  return {
    producto: gana.p,
    motivo: "sugerido",
    alternativas: ordenados.slice(1).map((c) => c.p),
  };
}

/**
 * La frase que explica **la sugerencia** debajo del selector.
 *
 * Vive acá y no en la pantalla porque ya mintió una vez: decía "sugerido por la
 * descripción" callándose que habían empatado varios, que es justo el caso en
 * que mirar importa —el emparejador se queda con el nombre más corto y el
 * elegido puede no ser el que corresponde—. Una frase que describe una decisión
 * es lógica, y la lógica se testea.
 *
 * Habla de lo propuesto, nunca de lo que quedó elegido en el selector: son dos
 * hechos distintos y contarlos con una sola frase fue el error original.
 */
export function explicacionDeSugerencia(s: Sugerencia): string {
  const empates = s.alternativas.map((p) => p.nombre).join(", ");

  if (s.motivo === "aprendido") {
    return "Ya se usó este producto para un pedido con esta misma descripción.";
  }

  if (s.motivo === "sugerido") {
    return empates
      ? `Sugerido por la descripción del pedido. Empató con: ${empates}.`
      : "Sugerido por la descripción del pedido.";
  }

  return empates
    ? `Sin coincidencia clara: va como ART. VARIOS. Empiezan igual: ${empates}.`
    : "Sin coincidencia: va como ART. VARIOS.";
}

/**
 * ¿Hay que guardar este producto como aprendido?
 *
 * Tres condiciones, y las tres salieron de una revisión que encontro que la
 * tabla se ensuciaba sola:
 *
 * - **Hay producto.** Sin producto no se aprende `ART. VARIOS`, que no es una
 *   elección sino la ausencia de una.
 * - **La elección es humana.** Si el producto salió de la propia tabla,
 *   reescribir la fila con lo que ella misma dictó no agrega informacion: le
 *   pisa el `created_by` con el de ahora y borra quién lo decidió de verdad.
 * - **Se creó alguna orden.** Si las dos ya existían en Odoo no se tocó
 *   ninguna línea, así que ese producto no decidió nada: aprenderlo sería
 *   aprender de un gesto que no pasó.
 */
export function correspondeAprender(caso: {
  hayProducto: boolean;
  eleccionHumana: boolean;
  ordenes: { yaExistia: boolean }[];
}): boolean {
  if (!caso.hayProducto) return false;
  if (!caso.eleccionHumana) return false;
  return caso.ordenes.some((o) => !o.yaExistia);
}
