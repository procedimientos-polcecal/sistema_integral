/**
 * Emparejar el padrón de proveedores del SdG con los de Odoo.
 *
 * Es el cimiento de todo lo demás: una orden de compra necesita el `partner_id`
 * de Odoo, así que sin este cruce no se puede empujar nada.
 *
 * Tres hechos medidos el 03/09/2026, que son los que dan forma a esto:
 *
 * 1. **El CUIT está escrito distinto en cada lado.** Odoo lo guarda sin guiones
 *    (`30708699574`), el SdG con guiones (`20-36215654-9`). Un cruce literal
 *    devuelve cero coincidencias y ningún error: hay que normalizar.
 * 2. **Un proveedor del SdG puede ser dos de Odoo.** De 610 registros de
 *    proveedor en Odoo hay 422 CUITs distintos, y 147 están en las dos empresas:
 *    el mismo proveedor, un registro por empresa. Por eso el resultado es una
 *    lista de partners por proveedor, no un id.
 * 3. **Sólo 145 de los 287 proveedores del SdG tienen CUIT.** Los otros 142 no se
 *    pueden cruzar, y **no se cruzan por nombre**: enlazar al que se le parece es
 *    peor que dejar en null, porque un enlace equivocado no se nota nunca — el
 *    dato simplemente aparece en el lugar que no es. Quedan informados para que
 *    alguien los resuelva a mano, o para que la sync traiga el CUIT desde Odoo.
 */

import type { Many2One } from "./client";
import { idDeRelacion } from "./client";

export interface ProveedorSdG {
  id: string;
  nombre: string;
  cuit: string | null;
}

export interface PartnerDeOdoo {
  id: number;
  name: string;
  vat: string | false;
  company_id: Many2One;
}

export interface PartnerEnlazado {
  odooId: number;
  nombre: string;
  /** `null` = partner compartido por las dos empresas (en Odoo, sin empresa). */
  empresa: number | null;
}

export interface Enlace {
  proveedorId: string;
  nombre: string;
  cuit: string;
  partners: PartnerEnlazado[];
}

export interface ProveedorSinEnlazar {
  proveedorId: string;
  nombre: string;
  cuit: string | null;
  motivo: "sin cuit" | "cuit invalido" | "no esta en odoo";
}

export interface ResultadoDelCruce {
  enlaces: Enlace[];
  sinEnlazar: ProveedorSinEnlazar[];
  /**
   * Dos o más proveedores del SdG con el mismo CUIT.
   *
   * No es un problema de Odoo: es el padrón del SdG que tiene el mismo proveedor
   * cargado dos veces. Enlazarlos a los dos dejaría dos filas del SdG apuntando
   * al mismo partner, y cualquier lectura de vuelta no sabría a cuál corresponde.
   * Se informan y no se enlazan.
   */
  cuitRepetidoEnSdG: { cuit: string; proveedores: { id: string; nombre: string }[] }[];
  /** Partners de Odoo con CUIT que ningún proveedor del SdG reclamó. */
  partnersHuerfanos: number;
}

/**
 * Deja un CUIT en sus once dígitos, o `null` si no es un CUIT.
 *
 * Saca guiones, puntos, espacios y cualquier otra cosa: los dos padrones se
 * cargaron a mano en momentos distintos y no hay garantía de un solo formato.
 */
export function normalizarCuit(valor: string | null | false | undefined): string | null {
  if (!valor) return null;
  const digitos = valor.replace(/\D/g, "");
  return digitos.length === 11 ? digitos : null;
}

/**
 * ¿El dígito verificador del CUIT cierra?
 *
 * Sirve para **informar**, no para rechazar: un CUIT mal tipeado en el SdG se
 * puede corregir, pero descartarlo en silencio sería otra vez el error de que el
 * dato desaparezca sin que nadie se entere. Los 145 CUITs del SdG los cargó
 * alguien a mano, así que vale la pena chequearlos.
 */
export function cuitEsValido(cuit: string): boolean {
  const digitos = normalizarCuit(cuit);
  if (!digitos) return false;

  const pesos = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
  const suma = pesos.reduce((acc, peso, i) => acc + peso * Number(digitos[i]), 0);
  const resto = suma % 11;

  // 11 - resto, con las dos convenciones del padrón de AFIP: 11 → 0 y 10 → 9.
  const esperado = resto === 0 ? 0 : resto === 1 ? 9 : 11 - resto;
  return Number(digitos[10]) === esperado;
}

/**
 * Cruza los dos padrones por CUIT normalizado.
 *
 * Función pura: recibe las dos listas ya leídas y no habla con nadie. Así el
 * cruce —que es donde están todas las decisiones— se puede testear sin red y
 * mostrar en pantalla antes de escribir una sola fila.
 */
export function cruzarProveedores(
  delSdG: ProveedorSdG[],
  deOdoo: PartnerDeOdoo[]
): ResultadoDelCruce {
  // Odoo, indexado por CUIT: cada CUIT puede tener uno o dos partners.
  const partnersPorCuit = new Map<string, PartnerEnlazado[]>();
  for (const p of deOdoo) {
    const cuit = normalizarCuit(p.vat);
    if (!cuit) continue;
    if (!partnersPorCuit.has(cuit)) partnersPorCuit.set(cuit, []);
    partnersPorCuit.get(cuit)!.push({
      odooId: p.id,
      nombre: p.name,
      empresa: idDeRelacion(p.company_id),
    });
  }

  // El SdG, agrupado por CUIT, para detectar los repetidos antes de enlazar.
  const proveedoresPorCuit = new Map<string, ProveedorSdG[]>();
  const sinEnlazar: ProveedorSinEnlazar[] = [];

  for (const prov of delSdG) {
    const cuit = normalizarCuit(prov.cuit);

    if (!cuit) {
      sinEnlazar.push({
        proveedorId: prov.id,
        nombre: prov.nombre,
        cuit: prov.cuit,
        motivo: "sin cuit",
      });
      continue;
    }

    if (!proveedoresPorCuit.has(cuit)) proveedoresPorCuit.set(cuit, []);
    proveedoresPorCuit.get(cuit)!.push(prov);
  }

  const enlaces: Enlace[] = [];
  const cuitRepetidoEnSdG: ResultadoDelCruce["cuitRepetidoEnSdG"] = [];
  const cuitsUsados = new Set<string>();

  for (const [cuit, proveedores] of proveedoresPorCuit) {
    if (proveedores.length > 1) {
      cuitRepetidoEnSdG.push({
        cuit,
        proveedores: proveedores.map((p) => ({ id: p.id, nombre: p.nombre })),
      });
      continue;
    }

    const prov = proveedores[0];
    const partners = partnersPorCuit.get(cuit);

    if (!partners?.length) {
      sinEnlazar.push({
        proveedorId: prov.id,
        nombre: prov.nombre,
        cuit: prov.cuit,
        // Un CUIT que no cierra casi nunca está en Odoo, y saberlo cambia qué
        // hacer: uno se corrige en el SdG, el otro se da de alta en Odoo.
        motivo: cuitEsValido(cuit) ? "no esta en odoo" : "cuit invalido",
      });
      continue;
    }

    cuitsUsados.add(cuit);
    enlaces.push({
      proveedorId: prov.id,
      nombre: prov.nombre,
      cuit,
      // Por empresa, para que el orden no dependa de cómo vinieron de Odoo.
      partners: [...partners].sort((a, b) => (a.empresa ?? 0) - (b.empresa ?? 0)),
    });
  }

  return {
    enlaces,
    sinEnlazar,
    cuitRepetidoEnSdG,
    partnersHuerfanos: [...partnersPorCuit.keys()].filter((c) => !cuitsUsados.has(c)).length,
  };
}
