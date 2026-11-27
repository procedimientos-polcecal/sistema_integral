/**
 * Los proveedores que están cargados dos veces en el padrón.
 *
 * `proveedores` es catálogo del núcleo y lo comparten los seis módulos, así que
 * un duplicado no es un problema de Compras: es el mismo proveedor recibiendo
 * la mitad de sus datos en cada fila. Medido el 26/11/2026 sobre 484
 * proveedores: **105 grupos**, 4 por CUIT repetido y 101 por nombre parecido.
 *
 * ## De dónde salen
 *
 * De que `asegurarProveedores()` **crea la fila que no encuentra por nombre**
 * cuando importa la planilla de Compras. La columna PROVEEDOR es texto libre,
 * así que cada forma nueva de escribirlo —«Fundición Navarro» a mano y
 * «FUNDICIONES NAVARRO» en la planilla— es un proveedor nuevo. Hay 22 celdas
 * que directamente nombran a varios: «SINGLA, FASE 3» es una fila del padrón.
 *
 * ## Las dos formas de reconocerlos, y por qué están separadas
 *
 * **El mismo CUIT es un hecho**: identifica a la empresa en AFIP y en Odoo, y
 * mientras dos filas lo compartan `cruzarProveedores()` no enlaza a ninguna de
 * las dos. **El nombre parecido es una sospecha** que confirma una persona.
 * Mezclarlas haría que la lista no se pueda leer por grado de certeza, que es
 * justamente el orden en que conviene resolverla.
 *
 * El parecido no lo decide este archivo: lo decide `nombresParecidos()` del
 * mismo núcleo, que junta los nombres donde uno contiene al otro entero y ya
 * sabe que «Metalúrgica Fonavi» y «Metalúrgica Mario» comparten el rubro y no
 * el proveedor.
 */

import { normalizarCuit } from "./cuit";
import { claveDeProveedor, nombresParecidos } from "./proveedores";

export interface ProveedorParaAgrupar {
  id: string;
  nombre: string;
  cuit: string | null;
}

/** Una ficha que en realidad es una celda con varios proveedores adentro. */
export interface FichaCompuesta {
  id: string;
  nombre: string;
  /** Los proveedores que nombra, como están escritos en su propia ficha. */
  partes: string[];
}

/**
 * Las fichas que no son un proveedor sino **una celda con varios adentro**.
 *
 * Pasa cuando a un mismo pedido se le compró a más de uno y quien llenó la
 * planilla escribió «TORRACO, BOLSAFLEX» en la columna PROVEEDOR.
 * `asegurarProveedores()` no sabe leer eso: toma la celda entera como el
 * nombre de un proveedor nuevo. Al 26/11/2026 son **19 fichas de 395**, cada
 * una con **exactamente un requerimiento** colgando.
 *
 * **No son duplicados y por eso se apartan antes de agrupar.** Mezcladas,
 * ensucian un grupo entero: «PLATINO, ZMG, TRACK MAR, EQUIPARTES» arrastra a
 * «PLATINO», «TRACK MAR» y «EQUIPARTES» —que son tres proveedores de verdad— a
 * un solo grupo de nueve fichas donde ya no se ve cuál es el duplicado real
 * (ahí lo era «PLATINO» contra «Platino», y nada más).
 *
 * **Y fusionarlas no serviría igual**: mientras la celda de la planilla siga
 * diciendo «TORRACO, BOLSAFLEX», la sincronización vuelve a crear la ficha en
 * la corrida siguiente. Lo que hay que decidir —a qué proveedor queda apuntando
 * ese requerimiento, si es que a uno solo— no se puede contestar desde acá.
 *
 * El reconocimiento es conservador a propósito: **cada** pedazo tiene que ser
 * un proveedor que ya existe por su cuenta en el padrón. Con eso, un nombre que
 * lleva una coma por otro motivo —«Pagano y Kopaitich SRL»— no entra.
 */
export function fichasCompuestas(
  proveedores: readonly ProveedorParaAgrupar[]
): FichaCompuesta[] {
  const porClave = new Map<string, string>();
  for (const p of proveedores) porClave.set(claveDeProveedor(p.nombre), p.id);

  const compuestas: FichaCompuesta[] = [];
  for (const p of proveedores) {
    const partes = p.nombre.split(/\s*[,;]\s*|\s+-\s+/).map((x) => x.trim()).filter(Boolean);
    if (partes.length < 2) continue;
    const todasExisten = partes.every((x) => {
      const otro = porClave.get(claveDeProveedor(x));
      return otro !== undefined && otro !== p.id;
    });
    if (todasExisten) compuestas.push({ id: p.id, nombre: p.nombre, partes });
  }
  return compuestas;
}

export interface GrupoDeDuplicados {
  /**
   * `mismo cuit` es un hecho y `nombre parecido` una sospecha. La pantalla los
   * muestra en ese orden y lo dice con todas las letras.
   */
  motivo: "mismo cuit" | "nombre parecido";
  /** El CUIT, o el primer nombre del grupo: sirve para nombrarlo en pantalla. */
  clave: string;
  ids: string[];
}

/**
 * Los grupos de filas que probablemente sean el mismo proveedor.
 *
 * Un grupo por CUIT repetido primero, y después los parecidos por nombre entre
 * los que quedaron sueltos: una fila no puede estar en dos grupos, porque
 * fusionar uno cambiaría el otro mientras alguien lo mira.
 *
 * Las fichas compuestas se apartan antes de empezar, así que no aparecen en
 * ningún grupo.
 *
 * **Hasta el 27/11/2026 un grupo donde ninguno tenía CUIT no se devolvía.** El
 * motivo escrito acá era que fusionarlo no destraba nada —ninguna de las dos
 * filas se iba a conectar con Odoo igual— y que llenaría la pantalla de
 * decisiones sin consecuencia. Eso era cierto mientras el objetivo era Odoo, y
 * dejó de serlo cuando se empezaron a cargar comparativas: ahí alguien elige
 * un proveedor de una lista, y ver la misma empresa dos veces **sí** tiene
 * consecuencia —la mitad de los presupuestos cuelga de una ficha y la mitad de
 * la otra, y el historial del proveedor deja de servir para comparar—.
 *
 * Lo que se midió antes de sacarlo, que es lo que hacía falta saber: sin el
 * filtro aparecen **14 grupos más**, no cien. Cuatro son idénticos salvo
 * mayúsculas o comillas (`Prestigio`/`PRESTIGIO`), seis son la misma empresa
 * escrita distinto (`BULL VIAL`/`BULL-VIAL`, `ConMet`/`Con-Met`) y el resto
 * son celdas con varios proveedores que ya se apartan por otro lado. Si algún
 * día esa cuenta se dispara, el filtro que conviene no es éste sino ordenar
 * los grupos por cuántas filas cuelgan de ellos.
 */
export function gruposDeDuplicados(
  entrada: readonly ProveedorParaAgrupar[]
): GrupoDeDuplicados[] {
  const grupos: GrupoDeDuplicados[] = [];
  const yaAgrupado = new Set<string>();

  // Las celdas con varios proveedores adentro no son duplicados de nadie y
  // ensucian el grupo al que se peguen: ver `fichasCompuestas`.
  const compuestas = new Set(fichasCompuestas(entrada).map((f) => f.id));
  const proveedores = entrada.filter((p) => !compuestas.has(p.id));

  const porCuit = new Map<string, string[]>();
  for (const p of proveedores) {
    const cuit = normalizarCuit(p.cuit);
    if (!cuit) continue;
    porCuit.set(cuit, [...(porCuit.get(cuit) ?? []), p.id]);
  }

  // Ordenado por CUIT para que dos corridas devuelvan lo mismo: la pantalla
  // numera los grupos y un orden que cambia haría que «el grupo 7» no sea el
  // mismo grupo entre una lectura y la siguiente.
  for (const cuit of [...porCuit.keys()].sort()) {
    const ids = porCuit.get(cuit)!;
    if (ids.length < 2) continue;
    grupos.push({ motivo: "mismo cuit", clave: cuit, ids });
    for (const id of ids) yaAgrupado.add(id);
  }

  const sueltos = proveedores.filter((p) => !yaAgrupado.has(p.id));

  /*
   * `nombresParecidos` habla de nombres y acá hace falta volver a los ids: dos
   * filas distintas pueden llamarse igual —pasa, y son el duplicado más obvio
   * de todos—, así que un nombre puede traer más de un id.
   */
  const idsPorNombre = new Map<string, string[]>();
  for (const p of sueltos) {
    idsPorNombre.set(p.nombre, [...(idsPorNombre.get(p.nombre) ?? []), p.id]);
  }
  for (const nombres of nombresParecidos([...idsPorNombre.keys()])) {
    const ids = nombres.flatMap((n) => idsPorNombre.get(n) ?? []);
    if (ids.length < 2) continue;
    grupos.push({ motivo: "nombre parecido", clave: nombres[0], ids });
    for (const id of ids) yaAgrupado.add(id);
  }

  /*
   * Y los nombres repetidos exactos que `nombresParecidos` no devolvió por su
   * propio filtro —un nombre de menos de cuatro letras, o que es sólo una
   * palabra del rubro— siguen siendo el mismo nombre dos veces.
   */
  for (const [nombre, ids] of idsPorNombre) {
    if (ids.length < 2 || ids.some((id) => yaAgrupado.has(id))) continue;
    grupos.push({ motivo: "nombre parecido", clave: nombre, ids });
    for (const id of ids) yaAgrupado.add(id);
  }

  return grupos;
}
