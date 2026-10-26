/**
 * Si un repuesto que falta **ya tiene un requerimiento pedido**.
 *
 * ── POR QUÉ, Y QUÉ ES "PEDIR DOS VECES" DE VERDAD ───────────────────────────
 *
 * La orden dice qué repuestos hacen falta y ofrece pedirlos a Compras. Nadie
 * ve, en ese momento, si alguien ya lo pidió — así que se pide de nuevo.
 *
 * Medido el 26/10/2026 sobre los 2.198 requerimientos: **116 códigos aparecen
 * más de una vez**, pero casi todos son reposición normal a lo largo de meses
 * —los guantes `00473` se pidieron 22 veces en un año, todos recibidos—. Eso no
 * es un error y avisarlo sería ruido.
 *
 * Lo que sí es el problema es el que tiene **varios en vuelo a la vez**: ese
 * mismo `00473` tenía dos `SIN_INICIAR` y dos `PEDIDO` conviviendo. Por eso acá
 * sólo cuentan los que todavía están en curso.
 *
 * ── CÓMO SE CRUZAN, Y POR QUÉ DE DOS FORMAS ─────────────────────────────────
 *
 * Por código es exacto, pero hoy alcanza para poco: de los 2.198 RI **sólo 555
 * tienen código**, y de los repuestos cargados en órdenes, 2 de 13. Buscar sólo
 * así casi nunca avisaría de nada — aunque va a mejorar solo, porque desde el
 * 26/10 el alta carga el repuesto eligiéndolo del inventario.
 *
 * Por nombre encuentra lo que hay hoy, y es texto libre que escribió gente
 * distinta. Así que se devuelven **separados**: la pantalla puede decir "es
 * éste" de uno y "puede ser éste" del otro. Mezclarlos daría una sola
 * afirmación con dos niveles de certeza adentro, que es como un falso "ya está
 * pedido" termina en que la pieza no se pide nunca.
 *
 * **Esto nunca bloquea el pedido**, y es la decisión que más importa: un falso
 * positivo que impide pedir es peor que pedir dos veces. Informa y deja seguir.
 */

import { norm } from "@/lib/core/texto";

/**
 * Los estados de compra en los que el pedido **ya no está en curso**.
 *
 * `RECIBIDO` queda afuera de "en vuelo" aunque sea el 75% de los RI: ya llegó,
 * así que no es un pedido pendiente sino historia. Si contara, el aviso saldría
 * casi siempre y nadie lo miraría — es la misma vara que `saludDePlanilla`, no
 * sonar por lo que no importa.
 */
export const COMPRA_TERMINADA: readonly string[] = ["RECIBIDO", "DENEGADO"];

/** Lo que hace falta de un requerimiento para decidir si ya cubre el repuesto. */
export interface RiPosible {
  nro_ri: number;
  descripcion: string | null;
  codigo: string | null;
  estado_aprobacion: string | null;
  estado_compra: string | null;
}

/**
 * Si el requerimiento todavía está en curso.
 *
 * Denegado por quien aprueba o denegado por Compras son dos columnas distintas
 * y las dos significan que ese pedido no va a traer nada: mostrarlos sería
 * decirle a alguien que no pida algo que nadie va a comprar.
 */
export function estaEnVuelo(ri: RiPosible): boolean {
  if (String(ri.estado_aprobacion ?? "").trim().toUpperCase() === "DENEGADA") return false;
  return !COMPRA_TERMINADA.includes(String(ri.estado_compra ?? "").trim().toUpperCase());
}

/** Las palabras que sirven para comparar: las de tres letras o más. */
const palabrasDe = (texto: string): string[] =>
  norm(texto).split(" ").filter((p) => p.length >= 3);

/** Si una palabra es un número de pieza: lleva un dígito, así que distingue. */
const tieneDigito = (p: string): boolean => /\d/.test(p);

/**
 * Si dos descripciones nombran el mismo repuesto, con la cautela que hace falta.
 *
 * La regla: **todas las palabras significativas de la más corta están en la más
 * larga**, en cualquier orden — que es el mismo criterio con el que busca el
 * resto del sistema (`coincide` de `components/desplegables.ts`).
 *
 * Y un freno que no es obvio: con **una sola palabra no alcanza, salvo que
 * lleve un dígito**. «Eje» está adentro de «Eje de transmisión del molino» y de
 * otras treinta cosas; «6206» o «B-75» son números de pieza y sí distinguen.
 * Sin ese freno, el repuesto escrito con una palabra genérica marcaría como
 * "ya pedido" a media planta.
 *
 * Ejemplos que fija el test: «Rodamiento 6206» y «RODAMIENTO 6206 SKF» son el
 * mismo; «Correa B-75» y «Correa B-65» no.
 */
export function mismoRepuesto(uno: string | null, otro: string | null): boolean {
  const a = palabrasDe(String(uno ?? ""));
  const b = palabrasDe(String(otro ?? ""));
  if (a.length === 0 || b.length === 0) return false;

  const [corta, larga] = a.length <= b.length ? [a, b] : [b, a];
  if (corta.length === 1 && !tieneDigito(corta[0])) return false;

  const enLaLarga = new Set(larga);
  return corta.every((p) => enLaLarga.has(p));
}

/** Lo que se encontró, separado por qué tan seguro es. */
export interface RisDelRepuesto<T> {
  /** Mismo código: es el mismo artículo, sin lugar a dudas. */
  porCodigo: T[];
  /** Se parece el nombre. Puede ser otro; la pantalla lo dice así. */
  porNombre: T[];
}

/**
 * Los requerimientos en curso que podrían ser este repuesto.
 *
 * Uno que coincide por código **no se repite** en los del nombre: es el mismo
 * pedido, y listarlo dos veces haría pensar que hay dos.
 */
export function risDelRepuesto<T extends RiPosible>(
  repuesto: { nombre: string | null; codigo: string | null },
  ris: readonly T[]
): RisDelRepuesto<T> {
  const enVuelo = ris.filter(estaEnVuelo);
  const codigo = norm(repuesto.codigo ?? "");

  const porCodigo = codigo
    ? enVuelo.filter((r) => norm(r.codigo ?? "") === codigo)
    : [];

  const yaEstan = new Set(porCodigo.map((r) => r.nro_ri));
  const porNombre = enVuelo.filter(
    (r) => !yaEstan.has(r.nro_ri) && mismoRepuesto(repuesto.nombre, r.descripcion)
  );

  return { porCodigo, porNombre };
}

/** Si hay algo que mostrar. Para no dibujar una sección vacía. */
export const hayAlgunRi = (r: RisDelRepuesto<unknown>): boolean =>
  r.porCodigo.length > 0 || r.porNombre.length > 0;
