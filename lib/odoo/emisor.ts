import { buscarLeer, idDeRelacion } from "./client";
import { normalizarCuit } from "@/lib/core/cuit";
import {
  elegirPartnerDelEmisor,
  type EleccionDelEmisor,
  type PartnerCandidato,
} from "./proveedores";

/**
 * Quién emitió la factura, preguntándoselo a Odoo.
 *
 * El buzón resolvía el emisor contra el padrón del SdG, y eso dejaba afuera al
 * **56% de las facturas que entran** (1.558 de las 2.776 de 2026): su CUIT no
 * está en ese padrón, y sin proveedor no se podía crear el borrador. Odoo tiene
 * el CUIT del 100% de esos partners.
 *
 * La regla para elegir entre varios —y por qué a veces no se elige— está en
 * `elegirPartnerDelEmisor`, que es pura y está testeada. Acá va sólo el viaje.
 */

/** Los campos que hacen falta para decidir, y nada más. */
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

function aCandidato(p: PartnerCrudo): PartnerCandidato {
  return {
    id: p.id,
    nombre: p.name,
    empresa: idDeRelacion(p.company_id),
    activo: p.active,
    // `parent_id` puesto significa que es un contacto de otro —la dirección de
    // entrega de la misma empresa—, no el proveedor.
    esContactoDeOtro: idDeRelacion(p.parent_id) !== null,
    usos: Number(p.supplier_rank ?? 0),
  };
}

/**
 * Los partners de Odoo que tienen alguno de esos CUIT.
 *
 * Se piden **todos juntos** y no de a uno: cargar veinte facturas de una tanda
 * haría veinte viajes a Odoo, que no es rápido. `active_test: false` a propósito:
 * un partner archivado tiene que aparecer para poder decir "está archivado" en
 * vez de "no existe", que son dos problemas distintos.
 */
export async function buscarPartnersPorCuit(
  cuits: string[]
): Promise<Map<string, PartnerCandidato[]>> {
  const limpios = [...new Set(cuits.map(normalizarCuit).filter((c): c is string => c !== null))];
  const porCuit = new Map<string, PartnerCandidato[]>();
  if (!limpios.length) return porCuit;

  const crudos = await buscarLeer<PartnerCrudo>(
    "res.partner",
    [["vat", "in", limpios]],
    CAMPOS,
    { limite: 3000, contexto: { active_test: false } }
  );

  for (const p of crudos) {
    const cuit = normalizarCuit(p.vat || null);
    if (!cuit) continue;
    if (!porCuit.has(cuit)) porCuit.set(cuit, []);
    porCuit.get(cuit)!.push(aCandidato(p));
  }

  return porCuit;
}

/** El emisor de **una** factura. Devuelve el partner, o por qué no se pudo. */
export async function resolverElEmisor(
  cuit: string | null,
  companyId: number
): Promise<EleccionDelEmisor> {
  const limpio = normalizarCuit(cuit);
  if (!limpio) {
    return {
      partner: null,
      motivo: "La factura no tiene el CUIT del emisor, que es lo único con que se lo reconoce.",
      candidatos: [],
    };
  }

  const porCuit = await buscarPartnersPorCuit([limpio]);
  return elegirPartnerDelEmisor(porCuit.get(limpio) ?? [], companyId);
}
