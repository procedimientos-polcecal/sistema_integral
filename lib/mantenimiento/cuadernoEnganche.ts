import { codigoDeSector, numeroDeCinta } from "./cuadernoAbreviaturas";
import { normalizarLugar } from "./partesDeContratista";

/**
 * El enganche del cuaderno de Piparo: traduce el lugar **tal como lo escribió**
 * («Reparar rodillos 2/cinta 9 P/Trit N°3», «Tranqueras D6») a un `sector_id` y
 * un `equipo_id` del catálogo.
 *
 * Es pura: el catálogo aprendido, los sectores y los equipos llegan por
 * parámetro, así que no habla con la base ni con la red. Quien la llama lee los
 * tres una vez por foto y no una por renglón.
 *
 * **Por qué importa más de lo que parece:** el sector no es sólo un dato de la
 * fila. Decide cuántas órdenes de trabajo salen —un renglón con sector es su
 * propia OT, y los que no lo tienen se proponen acumulados entre sí—. Un sector
 * equivocado manda las horas al centro de costo que no es, y eso no se nota
 * nunca. Por eso, igual que en todo el sistema, **lo que no se reconoce con
 * certeza queda en `null`**: enlazar al que se le parece es peor que dejarlo
 * vacío.
 *
 * El orden de las tres capas es lo que manda:
 *
 * 1. **El catálogo aprendido** (`mant_contratista_lugares`) gana siempre: alguien
 *    ya contestó esa pregunta mirando el papel.
 * 2. **El intérprete** (`codigoDeSector` + `numeroDeCinta`) lee lo que el texto
 *    nombra.
 * 3. **El sector deducido del equipo**, cuando hay equipo y el papel no nombra
 *    sector.
 *
 * `sector_propuesto` es `true` **sólo en el tercer camino**, que es el único que
 * es una deducción y no algo que el papel diga: quien carga tiene que verlo. En
 * los otros dos el texto nombra el sector. Y **no se inventa ninguno**: un
 * renglón sin sector y sin equipo («Hormigonar Dep 05») queda con `sector_id`
 * en `null` hasta que una persona elija.
 */

/** Lo que la base guarda de un lugar enseñado: a qué sector y equipo va. */
export type LugarAprendido = {
  sector_id: string | null;
  equipo_id: string | null;
};

export type SectorDelCatalogo = { id: string; codigo: string };

export type EquipoDelCatalogo = {
  id: string;
  code: string;
  name: string;
  sector_id: string | null;
};

export type Enganche = {
  sector_id: string | null;
  equipo_id: string | null;
  sector_propuesto: boolean;
};

const SIN_ENGANCHE: Enganche = { sector_id: null, equipo_id: null, sector_propuesto: false };

/**
 * La cinta N de un sector. La búsqueda es por sector **y** número, nunca por
 * nombre solo: hay 63 equipos llamados «Cinta transportadora N» —uno por
 * planta— y la cinta 9 existe en varias.
 *
 * Si la planta tiene dos equipos que responden, no se elige.
 */
function cintaDelSector(numero: number, sectorId: string, equipos: EquipoDelCatalogo[]): EquipoDelCatalogo | null {
  const candidatos = equipos.filter((e) => {
    if (e.sector_id !== sectorId) return false;
    const m = /^cinta transportadora (\d+)$/.exec(normalizarLugar(e.name));
    return m !== null && Number(m[1]) === numero;
  });
  return candidatos.length === 1 ? candidatos[0] : null;
}

/**
 * El equipo cuyo código aparece como palabra suelta en el renglón
 * («Tranqueras D6» → el equipo `D6`). Con límites de palabra: `d6` no está en
 * «ad6a». Si el código lo comparten dos equipos, no se elige ninguno.
 *
 * Los códigos de una sola letra o dígito se ignoran: aparecerían en cualquier
 * renglón y no prueban nada.
 */
function equipoPorCodigo(texto: string, equipos: EquipoDelCatalogo[]): EquipoDelCatalogo | null {
  const t = normalizarLugar(texto);
  const candidatos = equipos.filter((e) => {
    const codigo = normalizarLugar(e.code);
    if (codigo.length < 2) return false;
    const escapado = codigo.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(?<![a-z0-9ñ])${escapado}(?![a-z0-9ñ])`).test(t);
  });
  return candidatos.length === 1 ? candidatos[0] : null;
}

/** Completa el sector desde el equipo: la única deducción, y por eso `propuesto`. */
function conSectorDelEquipo(equipoId: string | null, equipos: EquipoDelCatalogo[]): Enganche {
  const sectorDelEquipo = equipoId ? (equipos.find((e) => e.id === equipoId)?.sector_id ?? null) : null;
  return { sector_id: sectorDelEquipo, equipo_id: equipoId, sector_propuesto: sectorDelEquipo !== null };
}

export function engancharRenglon(
  texto: string,
  catalogo: Map<string, LugarAprendido>,
  sectores: SectorDelCatalogo[],
  equipos: EquipoDelCatalogo[],
): Enganche {
  // La misma normalización que corre al guardar el catálogo: con otra, lo
  // aprendido no se encontraría nunca.
  const clave = normalizarLugar(texto);
  if (!clave) return SIN_ENGANCHE;

  // 1. Lo aprendido gana. Una entrada con las dos puntas vacías no contesta
  //    nada, así que no corta el camino.
  const aprendido = catalogo.get(clave);
  if (aprendido && (aprendido.sector_id || aprendido.equipo_id)) {
    if (aprendido.sector_id) {
      return { sector_id: aprendido.sector_id, equipo_id: aprendido.equipo_id, sector_propuesto: false };
    }
    return conSectorDelEquipo(aprendido.equipo_id, equipos);
  }

  // 2. El intérprete. Un código que el catálogo no tiene no se enlaza a otro.
  const codigo = codigoDeSector(texto);
  const sectorId = codigo ? (sectores.find((s) => s.codigo === codigo)?.id ?? null) : null;

  const numero = numeroDeCinta(texto);
  let equipo: EquipoDelCatalogo | null = null;
  if (numero !== null && sectorId) equipo = cintaDelSector(numero, sectorId, equipos);
  // Sin cinta, o si la planta no la tiene, el código del equipo puede nombrarlo.
  if (!equipo) equipo = equipoPorCodigo(texto, equipos);

  if (sectorId) {
    // El papel nombra el sector. Un equipo de otro sector contradice al papel:
    // no hay manera de saber cuál de los dos es el del trabajo, así que el
    // equipo queda sin enlazar y el sector, que el papel sí dice, se conserva.
    if (equipo && equipo.sector_id !== null && equipo.sector_id !== sectorId) equipo = null;
    return { sector_id: sectorId, equipo_id: equipo?.id ?? null, sector_propuesto: false };
  }

  // 3. Hay equipo y el papel no nombra sector: se deduce del equipo.
  if (equipo) return conSectorDelEquipo(equipo.id, equipos);

  return SIN_ENGANCHE;
}
