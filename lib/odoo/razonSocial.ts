/**
 * La razón social de cada proveedor del padrón, sacada de Odoo por el CUIT.
 *
 * ## Por qué por CUIT y no por nombre
 *
 * Porque el nombre es justamente lo que no coincide: de los 168 proveedores
 * con CUIT, **108 se llaman distinto en el padrón que en Odoo** (medido el
 * 11/11/2026). El CUIT es el único dato que identifica a la empresa en los dos
 * lados, y es el que ya usa el resto del módulo.
 *
 * ## Por qué esto no reemplaza el nombre
 *
 * El `nombre` del padrón es **el texto que escribe la planilla de Compras**, y
 * con él la sincronización busca al proveedor: si no lo encuentra, crea una
 * fila nueva. Cambiarlo por la razón social dejaría 57 duplicados en la corrida
 * siguiente —el incidente del 14/09/2026, que re-apuntó 1.937 requerimientos a
 * filas recién creadas sin CUIT—. Y además la razón social no es como se lo
 * conoce: «Roxaf» en Odoo es «ROXAF HERRAMIENTAS E INSUMOS DE FERRETERIA
 * SOCIEDAD DE RESPONSABILIDAD LIMITADA».
 *
 * Son dos datos y el padrón guarda los dos. El porqué completo está en la
 * migración `20261111110129`.
 */

import { normalizarCuit } from "@/lib/core/cuit";

export interface ProveedorConCuit {
  id: string;
  nombre: string;
  cuit: string | null;
  /** Lo que ya tenga guardado, para no reescribir lo mismo. */
  razonSocial?: string | null;
}

export interface PartnerDeOdoo {
  nombre: string;
  cuit: string | null | false;
}

export interface RazonSocialPropuesta {
  proveedorId: string;
  nombre: string;
  razonSocial: string;
}

/** Un CUIT que en Odoo tiene más de un nombre: no se elige, se informa. */
export interface ConDosNombres {
  proveedorId: string;
  nombre: string;
  cuit: string;
  enOdoo: string[];
}

export interface Propuestas {
  razones: RazonSocialPropuesta[];
  conDosNombres: ConDosNombres[];
}

/**
 * Qué razón social le corresponde a cada uno, y a cuáles no se les puede saber.
 *
 * Se deja en null —no se elige una— cuando el CUIT no está en Odoo o cuando
 * tiene **dos nombres distintos** allá. Ese segundo caso son 31 proveedores, y
 * casi siempre es el mismo partner duplicado una vez por empresa con el nombre
 * escrito distinto; elegir uno al azar pondría en un documento formal un
 * nombre que nadie confirmó.
 *
 * Tampoco se propone si el proveedor **ya tiene** esa razón social: reescribir
 * lo mismo ensucia el `updated_at` y hace que una corrida parezca haber hecho
 * algo.
 */
export function razonesSocialesDeOdoo(
  delPadron: readonly ProveedorConCuit[],
  deOdoo: readonly PartnerDeOdoo[]
): Propuestas {
  const porCuit = new Map<string, Set<string>>();

  for (const p of deOdoo) {
    const cuit = normalizarCuit(p.cuit || null);
    const nombre = p.nombre?.trim();
    if (!cuit || !nombre) continue;
    if (!porCuit.has(cuit)) porCuit.set(cuit, new Set());
    porCuit.get(cuit)!.add(nombre);
  }

  const razones: RazonSocialPropuesta[] = [];
  const conDosNombres: ConDosNombres[] = [];

  for (const prov of delPadron) {
    const cuit = normalizarCuit(prov.cuit);
    if (!cuit) continue;

    const nombres = porCuit.get(cuit);
    if (!nombres?.size) continue;

    if (nombres.size > 1) {
      conDosNombres.push({
        proveedorId: prov.id,
        nombre: prov.nombre,
        cuit,
        enOdoo: [...nombres].sort(),
      });
      continue;
    }

    const razonSocial = [...nombres][0];
    if ((prov.razonSocial ?? "").trim() === razonSocial) continue;

    razones.push({ proveedorId: prov.id, nombre: prov.nombre, razonSocial });
  }

  return { razones, conDosNombres };
}
