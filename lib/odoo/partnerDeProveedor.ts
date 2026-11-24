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

import { buscarLeer, idDeRelacion } from "./client";
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
 * El `ilike` de los últimos seis dígitos es lo que atrapa al guardado con
 * guiones; trae de más, y de eso se ocupa `candidatosDelCuit`.
 */
export function dominioPorCuit(cuit: string): unknown[] {
  const digitos = normalizarCuit(cuit) ?? "";
  return ["|", ["vat", "=", digitos], ["vat", "ilike", `%${digitos.slice(-6)}%`]];
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
