/**
 * El `res.partner` de un proveedor del SdG: buscarlo y, si no está, crearlo.
 *
 * Esto es lo que destraba la cadena «cargo el presupuesto → si avanza, le
 * genero la orden de compra»: la orden necesita un `partner_id` de Odoo, y
 * hasta ahora el SdG sabía **encontrarlo** pero nunca **crearlo**.
 *
 * ## Por qué no alcanza con `buscarPartnersPorCuit()`
 *
 * Esa función —de `emisor.ts`, y es la buena para el buzón de facturas— busca
 * con `["vat", "in", [<11 dígitos>]]`. Medido contra Odoo el 23/11/2026: de los
 * 1.639 partners con `vat`, 1.636 lo tienen en dígitos puros y **dos lo tienen
 * con guiones** (`30-689471524`, `33-655088429`). Para el buzón eso es un 0,1%
 * que termina en «revisalo a mano»; acá termina en que la pantalla diga
 * «todavía no está en Odoo» y la generación de la orden **cree un partner que
 * ya existía**, que no se borra una vez que tiene documentos.
 *
 * Por eso el dominio pregunta dos cosas y el filtro fino se hace en JS, que es
 * donde `normalizarCuit` puede comparar de verdad.
 *
 * ## Lo que sí se reusa, y es lo importante
 *
 * **Elegir** entre varios candidatos no se reimplementa acá: va
 * `elegirPartnerDelEmisor()` de `proveedores.ts`, que ya está probada y sabe lo
 * que este archivo no tiene por qué volver a aprender — que un `parent_id`
 * puesto es un contacto hijo (una dirección de entrega, no el proveedor), que
 * un archivado hay que verlo para poder decir «está archivado» en vez de «no
 * existe», que el partner propio de la empresa le gana al compartido, y que
 * **con un empate real no se elige**. De 1.555 partners con CUIT, 57 claves
 * quedan ambiguas: ahí decide una persona.
 */

import { buscarLeer, crearEn, llamar, idDeRelacion } from "./client";
import { normalizarCuit } from "@/lib/core/cuit";
import type { PartnerCandidato } from "./proveedores";

/** Los mismos campos que mira `emisor.ts`, por la misma razón: deciden. */
const CAMPOS = ["name", "vat", "company_id", "active", "parent_id", "supplier_rank"];

interface PartnerCrudo {
  id: number;
  name: string;
  vat: string | false;
  company_id: unknown;
  active: boolean;
  parent_id: unknown;
  supplier_rank: number;
}

/**
 * El dominio para encontrar a un proveedor por CUIT, con guiones o sin ellos.
 *
 * Son tres términos en OR y cada uno cubre una forma distinta de escribirlo,
 * porque Odoo guarda el `vat` como lo tipeó quien cargó el partner:
 *
 * 1. **Los once dígitos pelados**, que es como está la enorme mayoría.
 * 2. **Los últimos seis contiguos**, que atrapa al que lleva un solo guion
 *    (`30-689471524`): son los 2 de 1.639 medidos el 23/11/2026. Trae de más,
 *    y de eso se ocupa `candidatosDelCuit`.
 * 3. **El canónico argentino `XX-XXXXXXXX-X`**, que necesita término propio
 *    justamente porque el guion del final **parte los últimos seis** y el
 *    `ilike` del punto 2 no lo ve. Hoy no hay ninguno así en Odoo, pero es la
 *    forma en que una persona tipea un CUIT: el día que alguien cargue uno a
 *    mano, no encontrarlo significa crear el duplicado que toda esta búsqueda
 *    existe para evitar, que es el anti-objetivo número uno de este trabajo.
 */
export function dominioPorCuit(cuit: string): unknown[] {
  const d = normalizarCuit(cuit) ?? "";
  const canonico = d.length === 11 ? `${d.slice(0, 2)}-${d.slice(2, 10)}-${d.slice(10)}` : d;

  // Notación polaca: dos `|` para encadenar tres términos en OR.
  return [
    "|", "|",
    ["vat", "=", d],
    ["vat", "ilike", `%${d.slice(-6)}%`],
    ["vat", "=", canonico],
  ];
}

/**
 * Si hay que crear el `res.partner` de este CUIT **en esta empresa**.
 *
 * La pregunta no es «¿existe este CUIT en Odoo?» sino «¿existe **acá**?», y
 * confundirlas fue un bug de verdad: `res.partner` es por empresa, así que con
 * un RI de AMBAS la primera vuelta creaba el partner en POLCECAL y la segunda
 * lo encontraba al buscar por CUIT, daba por hecho que ya estaba y no creaba
 * nada en POLYSAN. La orden de POLYSAN quedaba sin proveedor, `armarOrdenes`
 * la frenaba, y como se frenan todas juntas **tampoco salía la de POLCECAL** —
 * dejando un partner recién creado en la contabilidad real sin ninguna orden
 * detrás, que es exactamente lo que no se quería—. El reintento repetía lo
 * mismo para siempre.
 *
 * Se crea sólo cuando **ningún** partner con ese CUIT podría servir acá: ni
 * propio de esta empresa ni compartido. Y se mira al candidato entero, no sólo
 * al utilizable, porque un partner archivado o un contacto hijo de esta
 * empresa **frenan la creación**: ahí el duplicado ya existe y lo que hace
 * falta es que alguien lo desarchive, no un segundo registro. Lo mismo con un
 * empate sin resolver: tres registros con el mismo CUIT son peor que dos.
 */
export function hayQueCrearlo(candidatos: PartnerCandidato[], odooCompanyId: number): boolean {
  return !candidatos.some((c) => c.empresa === odooCompanyId || c.empresa === null);
}

/** Los candidatos cuyo `vat`, normalizado, es exactamente ese CUIT. */
export function candidatosDelCuit(
  crudos: PartnerCandidato[],
  cuit: string,
  vatPorId: Map<number, string | false>
): PartnerCandidato[] {
  const buscado = normalizarCuit(cuit);
  if (!buscado) return [];
  return crudos.filter((c) => normalizarCuit(vatPorId.get(c.id) || null) === buscado);
}

/** El viaje: los partners de Odoo que tienen ese CUIT, con o sin guiones. */
export async function buscarCandidatos(cuit: string): Promise<PartnerCandidato[]> {
  const limpio = normalizarCuit(cuit);
  if (!limpio) return [];

  const crudos = await buscarLeer<PartnerCrudo>(
    "res.partner",
    dominioPorCuit(limpio),
    CAMPOS,
    // `active_test: false` a propósito: un partner archivado tiene que
    // aparecer para poder decir «está archivado» y no «no existe».
    { limite: 50, contexto: { active_test: false } }
  );

  const vatPorId = new Map<number, string | false>(crudos.map((p) => [p.id, p.vat]));
  const candidatos: PartnerCandidato[] = crudos.map((p) => ({
    id: p.id,
    nombre: p.name,
    empresa: idDeRelacion(p.company_id),
    activo: p.active,
    esContactoDeOtro: idDeRelacion(p.parent_id) !== null,
    usos: Number(p.supplier_rank ?? 0),
  }));

  return candidatosDelCuit(candidatos, limpio, vatPorId);
}

/**
 * El nombre del tipo de documento en Odoo.
 *
 * Va el nombre y no el id, como `NOMBRE_IMPUESTO` en `contexto.ts`: el id es
 * por base —en staging «CUIT» es el 25— y la regla del repo es que ningún id
 * de Odoo se escribe en el código.
 */
const NOMBRE_TIPO_DOCUMENTO = "CUIT";

/**
 * El id de «CUIT» en el catálogo de tipos de documento, o `null`.
 *
 * `null` no es un fallo: el campo no es `required` en Odoo, así que si el
 * catálogo de producción no tiene una fila con ese nombre exacto, el partner se
 * crea sin él. Inventar un id sería peor.
 */
export async function tipoDeDocumentoCuit(): Promise<number | null> {
  const filas = await buscarLeer<{ id: number; name: string }>(
    "partner.document.type",
    [["name", "=", NOMBRE_TIPO_DOCUMENTO]],
    ["name"],
    { limite: 5 }
  );
  return filas[0]?.id ?? null;
}

/**
 * Lo que se le manda a Odoo para crear el proveedor.
 *
 * Medido el 23/11/2026 sobre los 658 partners con `supplier_rank > 0`: 627
 * tienen `partner_document_type_id` = CUIT y 656 `income_wh_registration` = "1".
 *
 * `supplier_rank: 1` no es cosmético: el cruce masivo de
 * `/api/odoo/proveedores/enlazar` busca `[["supplier_rank", ">", 0]]`, así que
 * un partner creado sin eso queda **invisible** para el cruce y volvería a
 * aparecer como «no está en Odoo» aunque esté.
 *
 * Los dos campos que pueden faltar **no viajan en null**: el tipo de documento
 * porque no es obligatorio en Odoo, y el régimen de ganancias porque sí lo es
 * —si `default_get` no lo dio, que falle Odoo con su propio mensaje y no el
 * SdG mandando un vacío—.
 */
export function valsDelPartner(p: {
  nombre: string;
  cuit: string;
  tipoDocumentoId: number | null;
  regimenGanancias: string | null;
}): Record<string, unknown> {
  const vals: Record<string, unknown> = {
    name: p.nombre,
    vat: normalizarCuit(p.cuit),
    supplier_rank: 1,
  };
  if (p.tipoDocumentoId !== null) vals.partner_document_type_id = p.tipoDocumentoId;
  if (p.regimenGanancias !== null) vals.income_wh_registration = p.regimenGanancias;
  return vals;
}

/**
 * Crear el proveedor en Odoo, en esa empresa. Devuelve el id del partner.
 *
 * El régimen de ganancias se **lee** de Odoo en vez de inventarse: es el
 * régimen de retenciones, o sea plata, y `default_get` lo contesta por empresa
 * («1» en las dos, medido). Así el partner queda completo sin que el SdG
 * afirme por su cuenta un régimen de retención.
 */
export async function crearPartnerDeProveedor(
  datos: { nombre: string; cuit: string },
  odooCompanyId: number
): Promise<number> {
  const contexto = { allowed_company_ids: [odooCompanyId], company_id: odooCompanyId };

  const [tipoDocumentoId, defaults] = await Promise.all([
    tipoDeDocumentoCuit(),
    llamar<Record<string, unknown>>(
      "res.partner",
      "default_get",
      [["income_wh_registration"]],
      { context: contexto }
    ),
  ]);

  const regimen = defaults?.income_wh_registration;
  return crearEn(
    "res.partner",
    odooCompanyId,
    valsDelPartner({
      nombre: datos.nombre,
      cuit: datos.cuit,
      tipoDocumentoId,
      regimenGanancias: typeof regimen === "string" ? regimen : null,
    })
  );
}
