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
import { nombresParecidos } from "./proveedores";

export interface ProveedorParaAgrupar {
  id: string;
  nombre: string;
  cuit: string | null;
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
 * **Un grupo de nombres parecidos donde ninguno tiene CUIT no se devuelve.** No
 * es que no sea un duplicado: es que fusionarlo no destraba nada —ninguna de
 * las dos filas se iba a conectar con Odoo igual— y llenaría la pantalla de
 * decisiones sin consecuencia. Son datos a ordenar, no un circuito frenado.
 */
export function gruposDeDuplicados(
  proveedores: readonly ProveedorParaAgrupar[]
): GrupoDeDuplicados[] {
  const grupos: GrupoDeDuplicados[] = [];
  const yaAgrupado = new Set<string>();

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
  const conCuit = new Set(sueltos.filter((p) => normalizarCuit(p.cuit)).map((p) => p.id));

  for (const nombres of nombresParecidos([...idsPorNombre.keys()])) {
    const ids = nombres.flatMap((n) => idsPorNombre.get(n) ?? []);
    if (ids.length < 2) continue;
    // Sin ninguno con CUIT no hay nada que destrabar: ver el docstring.
    if (!ids.some((id) => conCuit.has(id))) continue;
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
    if (!ids.some((id) => conCuit.has(id))) continue;
    grupos.push({ motivo: "nombre parecido", clave: nombre, ids });
    for (const id of ids) yaAgrupado.add(id);
  }

  return grupos;
}
