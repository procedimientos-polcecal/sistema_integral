/**
 * Los repuestos de cada equipo, leídos de las OT que ya existen.
 *
 * POR QUÉ EXISTE
 *
 * `equipos_repuestos` —"qué conviene tener a mano para este equipo"— está
 * vacía desde que se creó: nunca hubo un libro para importar. Pero la columna
 * `repuesto` de la planilla de OT viene cargándose desde diciembre de 2025, y
 * ahí está escrito, equipo por equipo, qué se le cambió de verdad. Esto
 * convierte ese texto libre en una lista.
 *
 * QUÉ SE PUEDE ESPERAR
 *
 * De 2.174 OT, 275 tienen algo escrito en `repuesto` y 266 están enlazadas a un
 * equipo. No es poco: son 100 equipos, y los que más repuestos consumen —los
 * molinos a martillos, las rompedoras, los ventiladores— son justamente los que
 * más OT tienen.
 *
 * LA REGLA QUE GOBIERNA EL PARSEO
 *
 * **Un código parecido no se junta con otro.** "22216" y "22216 EK" son dos
 * rodamientos distintos —uno es de agujero cónico y va con manguito— y
 * fusionarlos escribiría en la ficha un repuesto que nadie pidió. Se agrupa
 * sólo lo que normaliza igual: mayúsculas, sin acentos y con los espacios
 * colapsados. Lo que no se reconoce queda marcado `revisar` y no se inventa.
 *
 * Es la misma idea que gobierna los enlaces de las planillas: enlazar al que se
 * le parece es peor que dejar en null.
 */
import { norm } from "@/lib/core/texto";

/** Un renglón de repuesto ya leído. */
export interface ItemDeRepuesto {
  /** El sustantivo en singular: "rodamiento", "correa". `null` si no se reconoció. */
  tipo: string | null;
  /** Lo que identifica la pieza: "22216 EK", "B-86", "2 MM". */
  codigo: string | null;
  /** Las palabras que sobran, tal como estaban: "fabricadas por ING. MAZZEO". */
  nota: string | null;
  cantidad: number | null;
  /** "u" cuando se cuentan piezas; "m", "cm", "kg", "l" cuando se mide. */
  unidad: string;
  /** El requerimiento interno que la planilla anota entre paréntesis: "RI 258". */
  ri: string | null;
  /**
   * `alta` cuando se reconoció el sustantivo; `revisar` cuando el tipo salió
   * de inferir —un código de correa suelto— o cuando el texto es una crónica
   * del trabajo y no una lista de piezas.
   */
  confianza: "alta" | "revisar";
  /** El fragmento tal cual, para que quien revise pueda comparar. */
  crudo: string;
}

/**
 * Los sustantivos que nombran una pieza, y cómo se escriben en la planilla.
 *
 * La clave es la forma normalizada (`norm`) tal como aparece; el valor es el
 * singular que va a la ficha. Las abreviaturas —"rod.", "mang."— están porque
 * la planilla las usa: `norm` les come el punto, así que acá van sin él.
 *
 * **Y por eso "paño" se escribe PANO y "piñón" PINON**: `norm` descompone la
 * palabra y tira los acentos, y la tilde de la ñ es uno de ellos. Una clave
 * escrita con Ñ no matchea nunca y no avisa — ese repuesto simplemente queda
 * sin tipo.
 */
const SUSTANTIVOS: Record<string, string> = {
  // Transmisión y rodadura
  RODAMIENTO: "rodamiento", RODAMIENTOS: "rodamiento", ROD: "rodamiento",
  RULEMAN: "rodamiento", RULEMANES: "rodamiento", COJINETE: "cojinete", COJINETES: "cojinete",
  MANGUITO: "manguito", MANGUITOS: "manguito", MANG: "manguito",
  CAJA: "caja de rodamiento", CAJAS: "caja de rodamiento",
  OBTURACION: "obturación", OBTURACIONES: "obturación",
  CRAPODINA: "crapodina", CRAPODINAS: "crapodina",
  RETEN: "retén", RETENES: "retén",
  CORREA: "correa", CORREAS: "correa",
  POLEA: "polea", POLEAS: "polea",
  PINON: "piñón", PINONES: "piñón", CORONA: "corona", CORONAS: "corona",
  CADENA: "cadena", CADENAS: "cadena", ESLABON: "eslabón", ESLABONES: "eslabón",
  ACOPLE: "acople", ACOPLES: "acople", PERIFLEX: "periflex",
  BUJE: "buje", BUJES: "buje", PASADOR: "pasador", PASADORES: "pasador",
  REDUCTOR: "reductor", REDUCTORES: "reductor",
  EJE: "eje", EJES: "eje", ROTOR: "rotor", ROTORES: "rotor",
  TAMBOR: "tambor", TAMBORES: "tambor", RODILLO: "rodillo", RODILLOS: "rodillo",

  // Molienda y trituración
  GRILLA: "grilla", GRILLAS: "grilla",
  MARTILLO: "martillo", MARTILLOS: "martillo",
  BRAZO: "brazo", BRAZOS: "brazo", BRAZITO: "brazo", BRAZITOS: "brazo",
  BRACITO: "brazo", BRACITOS: "brazo",
  PLACA: "placa", PLACAS: "placa",
  MANDIBULA: "mandíbula", MANDIBULAS: "mandíbula",
  "CUERPOS MOLEDORES": "cuerpos moledores", "CUERPO MOLEDOR": "cuerpos moledores",
  PALETA: "paleta", PALETAS: "paleta",
  BALDE: "balde", BALDES: "balde",
  PANO: "paño", PANOS: "paño",
  MALLA: "malla", MALLAS: "malla",

  // Cintas
  PARCHE: "parche", PARCHES: "parche",
  EMPALME: "empalme", EMPALMES: "empalme",
  BANDA: "banda", BANDAS: "banda",
  GOMA: "goma", GOMAS: "goma",
  GUARDERA: "guardera", GUARDERAS: "guardera",

  // Filtros y neumática
  MANGA: "manga", MANGAS: "manga",
  PICO: "pico", PICOS: "pico",
  VALVULA: "válvula", VALVULAS: "válvula",
  ELECTROVALVULA: "electroválvula", ELECTROVALVULAS: "electroválvula",
  DIAFRAGMA: "diafragma", DIAFRAGMAS: "diafragma",
  BOMBA: "bomba", BOMBAS: "bomba",
  MANGUERA: "manguera", MANGUERAS: "manguera",
  CILINDRO: "cilindro", CILINDROS: "cilindro",
  ASPERSOR: "aspersor", ASPERSORES: "aspersor",
  CANON: "cañón", CANONES: "cañón",
  ROTAMETRO: "rotámetro", ROTAMETROS: "rotámetro",
  FLUIDOR: "fluidor", FLUIDORES: "fluidor",

  // Eléctrico
  MOTOR: "motor", MOTORES: "motor",
  CONTACTOR: "contactor", CONTACTORES: "contactor",
  GUARDAMOTOR: "guardamotor", GUARDAMOTORES: "guardamotor",
  TERMICA: "térmica", TERMICAS: "térmica",
  VARIADOR: "variador", VARIADORES: "variador",
  SENSOR: "sensor", SENSORES: "sensor",
  CELDA: "celda de carga", CELDAS: "celda de carga",
  MICROINTERRUPTOR: "microinterruptor", MICROINTERRUPTORES: "microinterruptor",
  PULSADOR: "pulsador", PULSADORES: "pulsador",
  FUSIBLE: "fusible", FUSIBLES: "fusible",
  CABLE: "cable", CABLES: "cable",
  COOLER: "cooler", COOLERS: "cooler",
  FOCO: "foco", FOCOS: "foco",
  RELE: "relé", RELES: "relé",

  // Lubricación
  ACEITE: "aceite", ACEITES: "aceite", GRASA: "grasa",
  FILTRO: "filtro", FILTROS: "filtro",

  // Ferretería y obra
  BULON: "bulón", BULONES: "bulón",
  TUERCA: "tuerca", TUERCAS: "tuerca",
  ARANDELA: "arandela", ARANDELAS: "arandela",
  TORNILLO: "tornillo", TORNILLOS: "tornillo",
  AUTOPERFORANTE: "autoperforante", AUTOPERFORANTES: "autoperforante",
  PERFIL: "perfil", PERFILES: "perfil",
  CHAPA: "chapa", CHAPAS: "chapa",
  PLANCHUELA: "planchuela", PLANCHUELAS: "planchuela",
  HIERRO: "hierro", HIERROS: "hierro",
  BARRA: "barra", BARRAS: "barra",
  CANO: "caño", CANOS: "caño", CANERIA: "cañería", CANERIAS: "cañería",
  PERNO: "perno", PERNOS: "perno", CUCHILLA: "cuchilla", CUCHILLAS: "cuchilla",
  RESORTE: "resorte", RESORTES: "resorte",
  SOPORTE: "soporte", SOPORTES: "soporte",
  JUNTA: "junta", JUNTAS: "junta",
};

/** Palabras que no aportan nada al código: se tiran antes de armarlo. */
const RELLENO = new Set([
  "DE", "DEL", "LA", "EL", "LOS", "LAS", "UN", "UNA", "UNOS", "UNAS",
  "Y", "E", "CON", "PARA", "POR", "EN", "A", "AL", "SEGUN", "MAS",
  "UNIDAD", "UNIDADES", "JUEGO", "JUEGOS", "NRO", "NUMERO", "N",
]);

/** El número escrito en palabras, que aparece suelto: "Dos rodamientos 32222". */
const NUMEROS: Record<string, number> = {
  UN: 1, UNA: 1, UNO: 1, DOS: 2, TRES: 3, CUATRO: 4, CINCO: 5, SEIS: 6,
  SIETE: 7, OCHO: 8, NUEVE: 9, DIEZ: 10, ONCE: 11, DOCE: 12,
};

/**
 * Un código de correa en V: la letra del perfil y el largo.
 *
 * Se reconoce suelto —"2 B-58", "2 C-77"— porque es lo único que se escribe
 * así en toda la planilla; igual el item queda en `revisar`, porque el tipo
 * no estaba escrito y lo estamos poniendo nosotros.
 */
const CODIGO_DE_CORREA = /^(SPA|SPB|SPC|SPZ|[ABCDZ])[\s-]?(\d{2,4})$/i;

/**
 * ¿El texto es sólo un importe, sin pieza ninguna?
 *
 * Un tercio de lo que hay cargado en la columna es el costo del trabajo y no
 * un repuesto: las cintas transportadoras se vulcanizan y lo que se anota es
 * lo que salió. Eso no va a la ficha de repuestos.
 *
 * **Un número pelado es ambiguo** y hay que resolverlo por tamaño: "970000"
 * es un precio y "2306" es un rodamiento. Se toma por importe el que trae `$`,
 * separador de miles o decimales, o seis dígitos o más — ningún código de los
 * que aparecen en la planilla llega a seis dígitos sin letra adelante.
 */
export function esSoloImporte(texto: string): boolean {
  const t = texto.trim();
  if (!t) return true;
  // "Costo de materiales utilizados $52684.76"
  if (/^costo\b/i.test(t)) return true;
  if (!/^\(?\s*\$?\s*[\d]+(?:[.,]\d+)*\s*\)?$/.test(t)) return false;
  if (/[$.,]/.test(t)) return true;
  return t.replace(/\D/g, "").length >= 6;
}

/** El importe entre paréntesis que la planilla deja al final: se saca y se devuelve aparte. */
function sacarImporte(texto: string): { texto: string; importe: string | null } {
  const m = texto.match(/\(([^)]*\$[\d\s.,]+[^)]*)\)\s*$/);
  if (!m) return { texto, importe: null };
  return { texto: texto.slice(0, m.index).trim(), importe: m[1].trim() };
}

/** El requerimiento interno: "(RI 258)" al final. */
function sacarRi(texto: string): { texto: string; ri: string | null } {
  const m = texto.match(/\(?\s*\bRI[\s.:-]*(\d+)\s*\)?\s*$/i);
  if (!m) return { texto, ri: null };
  return { texto: texto.slice(0, m.index).replace(/[\s,;-]+$/, "").trim(), ri: `RI ${m[1]}` };
}

/**
 * El verbo con el que arranca media planilla: "Cambio de", "Reemplazo de".
 *
 * No se saca por prolijidad: si queda, "cambio" entra al código del primer
 * item y dos textos que dicen lo mismo dejan de agrupar juntos.
 */
function sacarVerbo(texto: string): string {
  return texto
    .replace(/^\s*(se\s+)?(cambi[oa]n?|reemplaz[oa]n?|recambio|coloca[rn]?|agrega[rn]?|provisi[oó]n)\s+(de\s+)?/i, "")
    .trim();
}

/**
 * Partir el texto en renglones.
 *
 * Las comas y la "y" separan siempre. El guión con espacios —"Rodamiento 22217
 * EK - Manguito H317"— separa **sólo si del otro lado hay otro sustantivo**:
 * en "Aceite SAE 320 - 50 litros" y en "Chapa 1/2\" - 1500 mm x 400 mm" ese
 * mismo guión está uniendo la pieza con su medida, y cortarlo ahí perdería la
 * cantidad o la medida.
 */
export function partirRepuesto(texto: string): string[] {
  const porComaYuncion = texto
    .split(/\s*,\s*|\s+y\s+|\s*\+\s*/i)
    .flatMap((trozo) => {
      const partes = trozo.split(/\s+-\s+/);
      if (partes.length < 2) return [trozo];
      // Sólo si cada lado nombra una pieza; si no, el guión no separaba nada.
      return partes.every((p) => sustantivoDe(p) !== null) ? partes : [trozo];
    })
    .map((t) => t.trim())
    .filter(Boolean);
  return porComaYuncion;
}

/** El primer sustantivo conocido del fragmento, con dónde empieza y dónde termina. */
function sustantivoDe(fragmento: string): { tipo: string; desde: number; hasta: number } | null {
  const palabras = [...fragmento.matchAll(/[\p{L}\p{N}/"'°º.-]+/gu)];
  for (let i = 0; i < palabras.length; i++) {
    // Primero el de dos palabras ("cuerpos moledores"), que si no se lo come el de una.
    if (i + 1 < palabras.length) {
      const doble = norm(`${palabras[i][0]} ${palabras[i + 1][0]}`);
      if (SUSTANTIVOS[doble]) {
        return {
          tipo: SUSTANTIVOS[doble],
          desde: palabras[i].index,
          hasta: palabras[i + 1].index + palabras[i + 1][0].length,
        };
      }
    }
    const simple = norm(palabras[i][0]);
    if (SUSTANTIVOS[simple]) {
      return { tipo: SUSTANTIVOS[simple], desde: palabras[i].index, hasta: palabras[i].index + palabras[i][0].length };
    }
  }
  return null;
}

/** La cantidad con la que arranca el fragmento: "2", "980kg", "40 Litros", "2m", "Dos". */
function sacarCantidad(texto: string): { texto: string; cantidad: number | null; unidad: string } {
  const m = texto.match(/^\s*(\d+(?:[.,]\d+)?)\s*(kg|kgs|kilos?|lts?|litros?|m|mts?|metros?|cm|mm)?\b\.?\s*/i);
  if (m) {
    const unidad = unidadDe(m[2]);
    // "2 mm" sin sustantivo no es una cantidad de dos milímetros: es una medida.
    if (unidad === "mm") return { texto, cantidad: null, unidad: "u" };
    return { texto: texto.slice(m[0].length), cantidad: Number(m[1].replace(",", ".")), unidad };
  }
  const palabra = texto.match(/^\s*([\p{L}]+)\s+/u);
  if (palabra && NUMEROS[norm(palabra[1])] !== undefined) {
    return { texto: texto.slice(palabra[0].length), cantidad: NUMEROS[norm(palabra[1])], unidad: "u" };
  }
  return { texto, cantidad: null, unidad: "u" };
}

/**
 * La cantidad que la planilla deja al final, detrás de un guión.
 *
 * "Aceite SAE 320 - 50 litros" son cincuenta litros de ese aceite. El guión no
 * separa dos piezas —por eso `partirRepuesto` no corta ahí—, pero la cantidad
 * hay que ir a buscarla igual. Se piden unidades de medida y no "u": un
 * "- 1500 mm x 400 mm" es la medida de una chapa, no cuántas hay.
 */
function sacarCantidadFinal(texto: string): { texto: string; cantidad: number | null; unidad: string } {
  const m = texto.match(/\s*[-–]\s*(\d+(?:[.,]\d+)?)\s*(kg|kgs|kilos?|lts?|litros?|m|mts?|metros?|cm)\s*$/i);
  if (!m) return { texto, cantidad: null, unidad: "u" };
  return {
    texto: texto.slice(0, m.index).trim(),
    cantidad: Number(m[1].replace(",", ".")),
    unidad: unidadDe(m[2]),
  };
}

function unidadDe(bruta: string | undefined): string {
  if (!bruta) return "u";
  const u = norm(bruta);
  if (u === "KG" || u === "KGS" || u === "KILO" || u === "KILOS") return "kg";
  if (u === "LT" || u === "LTS" || u === "LITRO" || u === "LITROS") return "l";
  if (u === "M" || u === "MT" || u === "MTS" || u === "METRO" || u === "METROS") return "m";
  if (u === "CM") return "cm";
  if (u === "MM") return "mm";
  return "u";
}

/**
 * El código y la nota de lo que queda después de sacar el sustantivo.
 *
 * Al código van los pedazos que tienen un número —es lo que identifica la
 * pieza—; a la nota, las palabras sueltas. Un código largo deja de ser código
 * y pasa entero a la nota: "ZELL Modelo TSA 100kg Sensibilidad (2.99mV/V) N°
 * serie 21D316461" es la especificación de una celda de carga, no algo que
 * alguien vaya a comparar de un vistazo en una lista.
 */
function codigoYnota(resto: string, tipo: string | null = null): { codigo: string | null; nota: string | null } {
  const pegado = resto
    // "p/FACO 8050E": el "para" abreviado tapa la marca que viene atrás.
    .replace(/\bp\//gi, "")
    // La unidad va pegada al número o no va: "2 mm" y "2mm" son la misma
    // grilla, y si quedan distintas la lista muestra dos repuestos iguales.
    .replace(/(\d)\s+(mm|cm|kg|kw|hp|v|w|")\b/gi, "$1$2")
    // "N°3005", "Nro 25": el marcador de número no es parte del código.
    .replace(/\bN(?:RO)?\s*[°º]?\s*(\d)/gi, "$1");

  const piezas = pegado
    .split(/\s+/)
    .map((p) => p.replace(/^[(,;]+|[),;.]+$/g, ""))
    .filter((p) => p && !RELLENO.has(norm(p)));

  // Lo que ya dice el tipo no se repite en la nota: "Celda de carga (de carga
  // ZELL…)" se lee como un error de quien lo escribió.
  const delTipo = new Set(norm(tipo ?? "").split(" "));

  // Más de cuatro pedazos ya no es un código: es la especificación entera de
  // la pieza, y entra mejor en la nota que en una columna monoespaciada.
  if (piezas.length > 4) {
    return { codigo: null, nota: piezas.filter((p) => !delTipo.has(norm(p))).join(" ") || null };
  }

  const codigo: string[] = [];
  const palabras: string[] = [];
  for (let i = 0; i < piezas.length; i++) {
    const pieza = piezas[i];
    if (/\d/.test(pieza)) {
      codigo.push(pieza);
      continue;
    }
    // La "x" de una medida: 'bulón 3/8 x 2"' es una sola medida, y sin esto
    // el código queda '3/8 2"', que no se parece a cómo se pide.
    if (/^x$/i.test(pieza) && codigo.length > 0 && piezas[i + 1] && /\d/.test(piezas[i + 1])) {
      codigo.push(pieza);
      continue;
    }
    // La marca que viene delante del número lo califica: "SNL 513",
    // "MRC 5308", "SAE 320", "Perfil C 100". Se pide que venga en mayúsculas,
    // que es lo que separa una marca de un adjetivo: en "placa de cierre
    // N°3005" el cierre describe la placa y va a la nota, no al código.
    if (
      codigo.length === 0 &&
      piezas[i + 1] &&
      /\d/.test(piezas[i + 1]) &&
      pieza.length <= 12 &&
      pieza === pieza.toUpperCase() &&
      /[A-Z]/.test(pieza)
    ) {
      codigo.push(pieza);
      continue;
    }
    // El sufijo corto que viene detrás también: el "EK" de "22216 EK" es lo
    // que distingue el agujero cónico, y sin él son dos rodamientos
    // confundidos en uno.
    if (codigo.length > 0 && piezas[i - 1] === codigo[codigo.length - 1] && /^[A-Z]{1,4}$/.test(pieza)) {
      codigo.push(pieza);
      continue;
    }
    palabras.push(pieza);
  }

  const sobra = palabras.filter((p) => !delTipo.has(norm(p)));

  return { codigo: canonizarCodigo(tipo, norm(codigo.join(" "))), nota: sobra.join(" ").trim() || null };
}

/**
 * El código, escrito siempre igual.
 *
 * Una correa en V la escriben "B-86", "B 86" y "b86", y sin esto la ficha del
 * ventilador 6 muestra tres repuestos donde hay uno solo. Se canoniza sólo
 * donde la forma es conocida y sin ambigüedad: el resto del código queda como
 * vino, porque normalizar de más junta piezas distintas.
 */
function canonizarCodigo(tipo: string | null, codigo: string): string | null {
  if (!codigo) return null;
  if (tipo === "correa") {
    const m = codigo.match(CODIGO_DE_CORREA);
    if (m) return `${m[1].toUpperCase()}-${m[2]}`;
  }
  return codigo;
}

/**
 * ¿El fragmento es la medida del renglón anterior y no una pieza más?
 *
 * En "Cambio de piñon y corona, paso 1\"" el paso es del piñón y la corona:
 * heredar el sustantivo ahí inventa una corona de paso 1" que no existe. Es la
 * contracara de la elisión —"10 de 4mm" sí hereda—, y lo que las distingue es
 * que acá hay una palabra que anuncia una medida.
 */
function esMedidaDelAnterior(fragmento: string): boolean {
  return /^(paso|medida|largo|ancho|diametro|diámetro|espesor|peso)\b/i.test(fragmento.trim());
}

/**
 * Un fragmento, leído.
 *
 * `tipoHeredado` es para la elisión del castellano: en "30 grillas de 2mm y 10
 * de 4mm" el segundo renglón no repite el sustantivo porque se sobreentiende.
 * Sin esto esas diez grillas se perderían, y son el patrón más común que tiene
 * la planilla.
 */
export function leerItem(fragmento: string, tipoHeredado: string | null = null): ItemDeRepuesto | null {
  const crudo = fragmento.trim();
  if (!crudo) return null;

  const { texto: sinImporte } = sacarImporte(crudo);
  const { texto: sinRi, ri } = sacarRi(sinImporte);
  const sinVerbo = sacarVerbo(sinRi);
  if (!sinVerbo || esSoloImporte(sinVerbo)) return null;

  const cola = sacarCantidadFinal(sinVerbo);
  const { texto: sinCantidad, cantidad: cantidadAdelante, unidad: unidadAdelante } = sacarCantidad(cola.texto);
  const cantidad = cantidadAdelante ?? cola.cantidad;
  const unidad = cantidadAdelante !== null ? unidadAdelante : cola.unidad;
  const encontrado = sustantivoDe(sinCantidad);

  // Es una crónica del trabajo y no una lista de piezas: "se limpian 5 mangas
  // llenas" cuenta mangas que nadie cambió. Se lee igual, marcado.
  const esCronica = /\b(se\s+(limpia|revisa|repara|ajusta|saca|abre|gira|acomoda|suelda|corta))/i.test(crudo);

  if (encontrado) {
    const resto = `${sinCantidad.slice(0, encontrado.desde)} ${sinCantidad.slice(encontrado.hasta)}`;
    const { codigo, nota } = codigoYnota(resto, encontrado.tipo);
    return {
      tipo: encontrado.tipo, codigo, nota, cantidad, unidad, ri,
      confianza: esCronica ? "revisar" : "alta", crudo,
    };
  }

  // Sin sustantivo: o lo hereda del renglón anterior, o es un código de correa
  // suelto, o no sabemos qué es y lo decimos.
  const pelado = sinCantidad.trim().replace(/^[(]+|[).]+$/g, "");

  // Un número solo —"2306" en un vibrador— no era una cantidad: era el
  // código. Lo que no se sabe es de qué pieza, y eso no se adivina.
  if (!pelado && cantidad !== null) {
    return {
      tipo: tipoHeredado, codigo: String(cantidad), nota: null, cantidad: null, unidad: "u", ri,
      confianza: tipoHeredado ? "alta" : "revisar", crudo,
    };
  }
  if (tipoHeredado) {
    if (esMedidaDelAnterior(pelado)) return null;
    const { codigo, nota } = codigoYnota(sinCantidad, tipoHeredado);
    if (codigo) return { tipo: tipoHeredado, codigo, nota, cantidad, unidad, ri, confianza: "alta", crudo };
  }
  if (CODIGO_DE_CORREA.test(pelado)) {
    const m = pelado.match(CODIGO_DE_CORREA)!;
    return {
      tipo: "correa", codigo: `${m[1].toUpperCase()}-${m[2]}`, nota: null,
      cantidad, unidad, ri, confianza: "revisar", crudo,
    };
  }
  const { codigo, nota } = codigoYnota(sinCantidad);
  if (!codigo && !nota) return null;
  return { tipo: null, codigo, nota, cantidad, unidad, ri, confianza: "revisar", crudo };
}

/** Todos los items de un texto de repuesto, en orden. */
export function itemsDeRepuesto(texto: string): ItemDeRepuesto[] {
  if (!texto || !texto.trim() || texto.trim() === "-") return [];
  if (esSoloImporte(texto)) return [];
  const items: ItemDeRepuesto[] = [];
  let ultimoTipo: string | null = null;
  for (const fragmento of partirRepuesto(texto)) {
    const item = leerItem(fragmento, ultimoTipo);
    if (!item) continue;
    if (item.tipo) ultimoTipo = item.tipo;
    items.push(item);
  }
  return items;
}

/**
 * La clave con la que dos renglones son el mismo repuesto.
 *
 * Tipo y código, normalizados. Nada de distancias ni parecidos: "22216" y
 * "22216 EK" tienen que quedar separados, y los va a juntar una persona si
 * decide que son lo mismo.
 */
export function claveDeItem(item: ItemDeRepuesto): string {
  return `${item.tipo ?? "?"}|${item.codigo ?? norm(item.nota ?? "")}`;
}

/** Cómo se llama en la ficha: el tipo con mayúscula, que es lo que lee quien mira. */
export function nombreDeItem(item: ItemDeRepuesto): string {
  const base = item.tipo ?? "Sin identificar";
  return base.charAt(0).toUpperCase() + base.slice(1);
}

/* ──────────────────────────────────────────────────────────────────────────
 * Segunda pasada: las piezas nombradas en la descripción
 *
 * 564 OT nombran una pieza en la descripción y no tienen nada en la columna
 * `repuesto`. Es material más flojo y hay que tratarlo como tal: ahí se
 * describe **el trabajo**, no la pieza, y casi nunca viene con medida ni
 * código.
 *
 * Lo que sí se puede saber es si la pieza se cambió o sólo se miró, y esa
 * diferencia es la que vale: "se cambia bulón cortado" dice que ese bulón hay
 * que tenerlo, y "revisar rodamiento posición 9" dice solamente que el equipo
 * tiene rodamientos. Las dos cosas sirven, pero no para lo mismo, así que no
 * se mezclan.
 * ────────────────────────────────────────────────────────────────────────── */

/** Qué le pasó a la pieza según el verbo de la oración. */
export type AccionSobreLaPieza = "cambio" | "revision" | "mencion";

/*
 * Los verbos se buscan sobre el texto ya normalizado con `norm`, y no sobre el
 * original. El motivo es una trampa de JavaScript: `\b` se define con `\w`,
 * que no incluye las vocales acentuadas, así que en "Se cambió válvula" el
 * `\b` del final no existe —entre "ó" y el espacio no hay frontera— y el
 * patrón no matchea. Medido: 'Se cambió válvula de soplado' quedaba como "se
 * nombró" y 'Se cambio ventilador motor' como "cambió". `norm` saca los
 * acentos y el problema con ellos.
 */
const VERBOS_DE_CAMBIO =
  /\b(CAMBI\w*|RECAMBI\w*|REEMPLAZ\w*|SUSTITUY\w*|COLOC\w*|AGREG\w*|INSTAL\w*|RENOV\w*|PONE|PUSO|PROVE\w*|FABRIC\w*)\b/;

const VERBOS_DE_REVISION =
  /\b(REVIS\w*|REPAR\w*|LIMPI\w*|AJUST\w*|CORRIG\w*|ACOMOD\w*|SUEL[DT]\w*|GIR\w*|SAC\w*|CORT\w*|CALIBR\w*|APRIE\w*|APRET\w*|DESCONECT\w*|CONTROL\w*|VERIFIC\w*|LUBRIC\w*|ENGRAS\w*|ELIMIN\w*|INSPECCION\w*|DESMONT\w*|VER|MIR\w*)\b/;

/** Una pieza nombrada en la descripción de una OT. */
export interface PiezaNombrada {
  tipo: string;
  /** El código, cuando la descripción llegó a darlo: "se agrega una grilla de 4mm". */
  codigo: string | null;
  accion: AccionSobreLaPieza;
  cantidad: number | null;
  /** La oración de donde salió, para que quien revise no tenga que abrir la OT. */
  crudo: string;
}

/**
 * Las piezas que nombra la descripción de una OT.
 *
 * Se parte en oraciones porque el verbo manda sobre las piezas de **su**
 * oración y no sobre las de la de al lado: en "Se coloca 2 mangas caidas, se
 * repara puntera sin fin descarga filtro de manga" las mangas se cambiaron y
 * el filtro sólo se tocó.
 *
 * La barra también separa —"Revisar reductor/cadena/rodamiento"— pero sólo
 * entre palabras: si hay un número de un lado es una medida, como en "3/8".
 */
export function piezasDeLaDescripcion(descripcion: string | null): PiezaNombrada[] {
  if (!descripcion || !descripcion.trim()) return [];

  const oraciones = descripcion
    .split(/[,;.]\s*|\s+y\s+/i)
    .flatMap((o) => (/^[\p{L}\s]+\/[\p{L}\s/]+$/u.test(o.trim()) ? o.split("/") : [o]))
    .map((o) => o.trim())
    .filter(Boolean);

  const piezas: PiezaNombrada[] = [];
  const vistas = new Set<string>();
  let accionPrevia: AccionSobreLaPieza = "mencion";

  for (const oracion of oraciones) {
    // Una oración sin verbo propio —"reductor" después de "Revisar
    // reductor/cadena"— sigue bajo el verbo de la anterior.
    const normalizada = norm(oracion);
    const hayCambio = VERBOS_DE_CAMBIO.test(normalizada);
    const hayRevision = VERBOS_DE_REVISION.test(normalizada);
    const accion: AccionSobreLaPieza = hayCambio ? "cambio" : hayRevision ? "revision" : accionPrevia;
    if (hayCambio || hayRevision) accionPrevia = accion;

    // Varias piezas en la misma oración: se recorre sacando la que ya se leyó.
    let resto = oracion;
    for (let vuelta = 0; vuelta < 6; vuelta++) {
      const encontrado = sustantivoDe(resto);
      if (!encontrado) break;
      const cola = resto.slice(encontrado.hasta);
      const { cantidad } = sacarCantidad(resto.slice(0, encontrado.desde).trim().split(/\s+/).at(-1) ?? "");
      // Sólo el código que viene pegado al sustantivo, y sólo si tiene número:
      // "grilla de 4mm" sí, "rodamiento posición 9" no, que es dónde está y no
      // cuál es.
      const pegado = cola.match(/^\s*(?:de\s+)?(\d+\s?(?:mm|cm|")|[A-Z]{1,4}[\s-]?\d{2,5}|\d{4,6})\b/i);
      const clave = `${encontrado.tipo}|${pegado ? norm(pegado[1]) : ""}|${accion}`;
      if (!vistas.has(clave)) {
        vistas.add(clave);
        piezas.push({
          tipo: encontrado.tipo,
          codigo: pegado ? norm(pegado[1]).replace(/\s(MM|CM)$/, "$1") : null,
          accion,
          cantidad,
          crudo: oracion,
        });
      }
      resto = cola;
    }
  }
  return piezas;
}

/** Una OT, con lo poco que hace falta para esto. */
export interface OtConRepuesto {
  ot_number: number;
  fecha: string | null;
  equipment_id: string | null;
  repuesto: string | null;
}

/** Un repuesto de un equipo, con de dónde salió. */
export interface RepuestoDeEquipo {
  equipment_id: string;
  tipo: string | null;
  codigo: string | null;
  nombre: string;
  nota: string | null;
  /** Las OT donde apareció, de la más vieja a la más nueva. */
  ots: number[];
  /** Cuánto se consumió en total, cuando todas las veces vino con cantidad. */
  total: number | null;
  unidad: string;
  ultimaFecha: string | null;
  confianza: "alta" | "revisar";
  /** Los textos tal como estaban, para que quien revise pueda comparar. */
  crudos: string[];
  ri: string[];
}

/**
 * El catálogo por equipo.
 *
 * Ordena por cuántas OT lo nombran: lo que se cambia seguido es lo que
 * conviene tener, y es la única señal de criticidad que la planilla da.
 */
export function repuestosPorEquipo(ots: OtConRepuesto[]): Map<string, RepuestoDeEquipo[]> {
  const porEquipo = new Map<string, Map<string, RepuestoDeEquipo>>();

  for (const ot of [...ots].sort((a, b) => a.ot_number - b.ot_number)) {
    if (!ot.equipment_id || !ot.repuesto) continue;
    for (const item of itemsDeRepuesto(ot.repuesto)) {
      if (!porEquipo.has(ot.equipment_id)) porEquipo.set(ot.equipment_id, new Map());
      const delEquipo = porEquipo.get(ot.equipment_id)!;
      const clave = claveDeItem(item);
      const ya = delEquipo.get(clave);
      if (!ya) {
        delEquipo.set(clave, {
          equipment_id: ot.equipment_id,
          tipo: item.tipo,
          codigo: item.codigo,
          nombre: nombreDeItem(item),
          nota: item.nota,
          ots: [ot.ot_number],
          total: item.cantidad,
          unidad: item.unidad,
          ultimaFecha: ot.fecha,
          confianza: item.confianza,
          crudos: [item.crudo],
          ri: item.ri ? [item.ri] : [],
        });
        continue;
      }
      if (!ya.ots.includes(ot.ot_number)) ya.ots.push(ot.ot_number);
      // El total sólo vale si todas las veces vino con cantidad; si una no la
      // trajo, un número redondo mentiría sobre lo que se consumió.
      ya.total = ya.total === null || item.cantidad === null ? null : ya.total + item.cantidad;
      if (ot.fecha && (!ya.ultimaFecha || ot.fecha > ya.ultimaFecha)) ya.ultimaFecha = ot.fecha;
      // Con que una vez se haya reconocido bien, el repuesto es bueno.
      if (item.confianza === "alta") ya.confianza = "alta";
      if (!ya.crudos.includes(item.crudo)) ya.crudos.push(item.crudo);
      if (!ya.nota && item.nota) ya.nota = item.nota;
      if (item.ri && !ya.ri.includes(item.ri)) ya.ri.push(item.ri);
    }
  }

  const salida = new Map<string, RepuestoDeEquipo[]>();
  for (const [equipo, mapa] of porEquipo) {
    salida.set(
      equipo,
      [...mapa.values()].sort(
        (a, b) => b.ots.length - a.ots.length || (a.nombre + a.codigo).localeCompare(b.nombre + b.codigo)
      )
    );
  }
  return salida;
}

/** Una pieza de un equipo, juntada de las descripciones de sus OT. */
export interface PiezaDeEquipo {
  equipment_id: string;
  tipo: string;
  codigo: string | null;
  accion: AccionSobreLaPieza;
  ots: number[];
  ultimaFecha: string | null;
  crudos: string[];
}

/**
 * Las piezas por equipo, de las descripciones.
 *
 * **Se saltean las OT que ya dijeron algo en la columna `repuesto`**: ésas ya
 * están en el otro informe, y contarlas dos veces haría parecer que hay más
 * evidencia de la que hay.
 */
export function piezasPorEquipo(
  ots: Array<OtConRepuesto & { descripcion: string | null }>
): Map<string, PiezaDeEquipo[]> {
  const porEquipo = new Map<string, Map<string, PiezaDeEquipo>>();

  for (const ot of [...ots].sort((a, b) => a.ot_number - b.ot_number)) {
    if (!ot.equipment_id) continue;
    if (itemsDeRepuesto(ot.repuesto ?? "").length > 0) continue;
    for (const pieza of piezasDeLaDescripcion(ot.descripcion)) {
      if (!porEquipo.has(ot.equipment_id)) porEquipo.set(ot.equipment_id, new Map());
      const delEquipo = porEquipo.get(ot.equipment_id)!;
      const clave = `${pieza.tipo}|${pieza.codigo ?? ""}|${pieza.accion}`;
      const ya = delEquipo.get(clave);
      if (!ya) {
        delEquipo.set(clave, {
          equipment_id: ot.equipment_id,
          tipo: pieza.tipo,
          codigo: pieza.codigo,
          accion: pieza.accion,
          ots: [ot.ot_number],
          ultimaFecha: ot.fecha,
          crudos: [pieza.crudo],
        });
        continue;
      }
      if (!ya.ots.includes(ot.ot_number)) ya.ots.push(ot.ot_number);
      if (ot.fecha && (!ya.ultimaFecha || ot.fecha > ya.ultimaFecha)) ya.ultimaFecha = ot.fecha;
      if (ya.crudos.length < 5 && !ya.crudos.includes(pieza.crudo)) ya.crudos.push(pieza.crudo);
    }
  }

  const salida = new Map<string, PiezaDeEquipo[]>();
  for (const [equipo, mapa] of porEquipo) {
    const orden: Record<AccionSobreLaPieza, number> = { cambio: 0, revision: 1, mencion: 2 };
    salida.set(
      equipo,
      [...mapa.values()].sort(
        (a, b) => orden[a.accion] - orden[b.accion] || b.ots.length - a.ots.length || a.tipo.localeCompare(b.tipo)
      )
    );
  }
  return salida;
}

/**
 * ¿La pieza se llama como el equipo?
 *
 * "Se cambio ventilador motor" en el equipo "Ventilador 5": el motor es la
 * pieza y el ventilador es el equipo. Un sustantivo que repite el nombre del
 * equipo casi nunca nombra un repuesto, y dejarlo llena la lista de piezas que
 * son el equipo entero.
 */
export function nombraAlEquipo(tipo: string, nombreDelEquipo: string | null | undefined): boolean {
  if (!nombreDelEquipo) return false;
  const palabras = new Set(norm(nombreDelEquipo).split(" "));
  return norm(tipo).split(" ").some((p) => palabras.has(p));
}

/**
 * La nota que va a la ficha: de dónde salió el repuesto.
 *
 * Sin esto, quien lo mire dentro de seis meses no sabe si alguien lo relevó en
 * la planta o si lo dedujo un script de las OT — y no es lo mismo.
 */
export function notaDeFicha(r: RepuestoDeEquipo): string {
  const partes: string[] = [];
  partes.push(r.ots.length === 1 ? `Visto en la OT ${r.ots[0]}` : `Visto en ${r.ots.length} OT (${r.ots.join(", ")})`);
  if (r.total !== null) partes.push(`${r.total} ${r.unidad} en total`);
  if (r.ultimaFecha) partes.push(`última ${r.ultimaFecha.split("-").reverse().join("/")}`);
  if (r.nota) partes.push(r.nota);
  if (r.ri.length) partes.push(r.ri.join(", "));
  partes.push("de las OT, sin relevar en planta");
  return partes.join(" · ");
}
