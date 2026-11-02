import { normalizarLugar } from "./partesDeContratista";

/**
 * El idioma de Piparo: las abreviaturas que escribe en el cuaderno, traducidas
 * a los códigos del catálogo.
 *
 * Es la capa más baja del cuaderno y es pura: no habla con la base ni con la
 * red. Devuelve **códigos y números**, no ids; quien engancha contra el
 * catálogo resuelve el id.
 *
 * **La regla de la casa: lo que no coincide devuelve `null`.** Enlazar al que
 * se le parece pone las horas en el sector que no es, y eso no se nota nunca.
 * Por eso ninguna expresión de acá tiene un caso "por defecto", y por eso
 * «P/Trit» sin número no es la planta 1: es nada.
 *
 * Los códigos están comprobados contra el catálogo de producción el 30/10/2026.
 */

/**
 * Lo que va entre «trit» y el número: un «N°», «Nº», «N.» o «n» suelto, con o
 * sin espacios. Piparo escribe «P/Trit N°1», «P/TRT Nº2» y «p/ trit 1», y el
 * modelo que lee la foto no distingue el grado del ordinal, así que se aceptan
 * los dos. (`normalizarLugar` ya pasó todo a minúsculas.)
 */
const NUMERO = String.raw`\s*(?:n\s*[°º.]?\s*)?`;

/** Plantas de trituración por número: PO-A1, PO-A2 y PO-A3. */
const TRITURACION: Record<string, string> = { "1": "PO-A1", "2": "PO-A2", "3": "PO-A3" };

/** Plantas filler por número. Van PY-A1, PY-B1 y PY-D1: no hay PY-C1. */
const FILLER: Record<string, string> = { "1": "PY-A1", "2": "PY-B1", "3": "PY-D1" };

/**
 * Qué escribe Piparo a la izquierda, qué código del catálogo va a la derecha.
 *
 * Se prueba en orden y gana la primera que coincide; ninguna se pisa con otra
 * porque cada una exige su palabra completa.
 */
const SECTORES: ReadonlyArray<readonly [RegExp, (numero: string) => string | null]> = [
  // «P/Trit N°1», «P/TRT Nº2», «p/ trit 1»: planta de trituración. El número
  // es obligatorio y de 1 a 3, que son las plantas que existen.
  [new RegExp(String.raw`\bp\s*/\s*(?:trit\w*|trt)${NUMERO}([123])\b`), (n) => TRITURACION[n] ?? null],
  // «Molino cal»: la molienda de cal (PO-D1).
  [/\bmolino (?:de )?cal\b/, () => "PO-D1"],
  // «Idratación», así, sin la hache: Piparo la escribe como suena. Con hache
  // también, por si el modelo la corrige.
  [/\bh?idrataci(?:on|ones)\b/, () => "PO-C1"],
  // «Filer 02», «filer 1»: planta filler. Una sola «l» en el cuaderno; dos si
  // el modelo la completa.
  [new RegExp(String.raw`\bfil{1,2}er${NUMERO}0?([123])\b`), (n) => FILLER[n] ?? null],
];

/**
 * El código de sector que nombra un renglón del cuaderno, o `null` si no
 * nombra ninguno.
 *
 * «Tranqueras D6», «Hormigonar Dep 05» o «Clasificar manganeso» no dicen
 * dónde se trabajó, y está bien que así sea: el renglón queda sin sector y lo
 * completa una persona.
 */
export function codigoDeSector(texto: string): string | null {
  const t = normalizarLugar(texto);
  if (!t) return null;

  for (const [patron, aCodigo] of SECTORES) {
    const m = patron.exec(t);
    if (m) return aCodigo(m[1]);
  }
  return null;
}

/**
 * El número de la cinta que nombra el renglón, o `null`.
 *
 * Existe porque hay **63 equipos llamados «Cinta transportadora N»**, uno por
 * planta, con código tipo `PO-A1-15` (la cinta 9 de Trituración 1). Sin el
 * número no se llega al equipo exacto, y con el sector solo tampoco.
 *
 * Se toma el número que **sigue** a la palabra «cinta»: en «2/cinta 9» el 2 es
 * la cantidad de rodillos y no la cinta. Acepta paréntesis, «Cinta (11)», que
 * es como lo anota Piparo cuando el número va aparte del resto.
 *
 * «Reparar paño zaranda 5» trae un número y no es una cinta, así que no
 * alcanza con que haya un número en el renglón: tiene que venir pegado a la
 * palabra.
 */
export function numeroDeCinta(texto: string): number | null {
  const t = normalizarLugar(texto);
  const m = /\bcinta(?:\s+transportadora)?\s*\(?\s*(\d{1,2})\b/.exec(t);
  return m ? Number(m[1]) : null;
}
