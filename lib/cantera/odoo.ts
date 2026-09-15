/**
 * El cruce de lectura con Odoo: las facturas de los contratistas de cantera.
 *
 * Sólo lee. La regla de la integración no se toca acá: la contabilidad la
 * escribe Odoo (docs/ODOO-INTEGRACION.md). Nunca se crea ni se postea nada —
 * se vincula un registro de cantera a una factura que ya existe, y se compara.
 */

import { buscarLeer, nombreDeRelacion, idDeRelacion, type Dominio } from "@/lib/odoo/client";

export interface FacturaOdoo {
  id: number;
  /** La secuencia interna de Odoo ("BILL/2026/08/0204"), no el número de papel del proveedor. */
  name: string;
  /**
   * El número real de la factura ("FC A 0002-00002979"): NO viaja en `ref`
   * —ahí casi nunca está cargado, 2 de 135 medido en los contratistas de
   * cantera— sino en `display_name`, que es lo que arma Odoo para mostrar en
   * la columna "Número" de la lista de facturas y que sí está en las 135.
   */
  numero: string;
  /** El campo "Referencia" de Odoo. Casi siempre vacío; se guarda por si acaso. */
  ref: string | null;
  fecha: string | null;
  empresa: string;
  /** El neto — es contra esto que se cruza, porque el monto de cantera también es neto. */
  importeNeto: number;
  importeTotal: number;
  proveedor: string;
}

interface FilaCruda {
  id: number;
  name: string;
  display_name: string;
  ref: string | false;
  invoice_date: string | false;
  amount_untaxed: number;
  amount_total: number;
  company_id: [number, string] | false;
  partner_id: [number, string] | false;
}

/** "Polcecal S.A." → "POLCECAL", para que coincida con `empresas.nombre` del SdG. */
function nombreDeEmpresa(valor: unknown): string {
  const n = nombreDeRelacion(valor) ?? "";
  if (/polcecal/i.test(n)) return "POLCECAL";
  if (/polysan/i.test(n)) return "POLYSAN";
  return n || "?";
}

const CAMPOS = ["name", "display_name", "ref", "invoice_date", "amount_untaxed", "amount_total", "company_id", "partner_id"];

/**
 * Las facturas de proveedor (`in_invoice`, posteadas) de una lista de
 * partners, sin las que ya estén en `excluirIds`. Es el picker: lo que
 * finanzas puede vincular a una etapa o a un bochón.
 *
 * Sin `fields` explícitos Odoo devuelve los 200+ campos de `account.move`
 * —el cuidado de siempre con Odoo Online—, así que van fijos.
 */
export async function facturasDisponibles(
  partnerIds: number[],
  excluirIds: number[] = []
): Promise<FacturaOdoo[]> {
  if (partnerIds.length === 0) return [];

  const dominio: Dominio = [
    ["partner_id", "in", partnerIds],
    ["move_type", "=", "in_invoice"],
    ["state", "=", "posted"],
  ];
  if (excluirIds.length > 0) dominio.push(["id", "not in", excluirIds]);

  const filas = await buscarLeer<FilaCruda>("account.move", dominio, CAMPOS, {
    orden: "invoice_date desc",
    limite: 200,
  });

  return filas.map(aFacturaOdoo);
}

function aFacturaOdoo(f: FilaCruda): FacturaOdoo {
  return {
    id: f.id,
    name: f.name,
    numero: f.display_name || f.name,
    ref: f.ref || null,
    fecha: f.invoice_date || null,
    empresa: nombreDeEmpresa(f.company_id),
    importeNeto: f.amount_untaxed,
    importeTotal: f.amount_total,
    proveedor: nombreDeRelacion(f.partner_id) ?? "?",
  };
}

/** Una factura puntual por id, para cachear sus datos al vincularla. */
export async function facturaPorId(id: number): Promise<FacturaOdoo | null> {
  const filas = await buscarLeer<FilaCruda>("account.move", [["id", "=", id]], CAMPOS, { limite: 1 });
  return filas[0] ? aFacturaOdoo(filas[0]) : null;
}

/**
 * Que la factura elegida sea realmente de uno de los contratistas — no se
 * confía en lo que mande el navegador. `idDeRelacion` porque `partner_id`
 * llega como `[id, nombre]`.
 */
export async function facturaEsDeAlgunContratista(
  id: number,
  partnerIds: number[]
): Promise<FacturaOdoo | null> {
  const filas = await buscarLeer<FilaCruda>("account.move", [["id", "=", id]], CAMPOS, { limite: 1 });
  const f = filas[0];
  if (!f) return null;
  const partnerId = idDeRelacion(f.partner_id);
  return partnerId !== null && partnerIds.includes(partnerId) ? aFacturaOdoo(f) : null;
}
