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
// El CUIT vive en el núcleo desde que lo necesitó Facturación. Se reexporta
// para no romper a quien ya lo importaba de acá.
import { cuitEsValido, normalizarCuit } from "@/lib/core/cuit";

export { cuitEsValido, normalizarCuit };

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

export interface FilaDeEnlace {
  proveedor_id: string;
  empresa_id: string;
  odoo_partner_id: number;
  cuit: string;
}

/**
 * Las filas que van a `proveedores_odoo`, una por proveedor y empresa.
 *
 * Dos cosas que no son obvias y que decide esta función:
 *
 * **Un partner sin empresa en Odoo se guarda dos veces**, una por empresa. En
 * Odoo un `res.partner` sin `company_id` lo usan todas; en el SdG la tabla lleva
 * `empresa_id` NOT NULL para que la clave primaria no necesite nulos. Así que lo
 * compartido se expande.
 *
 * **Si un CUIT tiene partner compartido *y* partner propio de una empresa, gana
 * el propio.** No es un empate a resolver por gusto: el partner de la empresa es
 * el que tiene sus datos fiscales y su cuenta contable, y es el que Odoo usaría
 * si alguien cargara la factura a mano ahí. Sin esta regla, las dos filas chocan
 * y el upsert entero se cae con "ON CONFLICT DO UPDATE command cannot affect row
 * a second time" —que es exactamente lo que pasó la primera vez que se corrió—.
 */
export function filasParaGuardar(
  cruce: ResultadoDelCruce,
  /** id de `res.company` de Odoo → uuid de `empresas` del SdG. */
  empresaPorOdoo: Map<number, string>
): { filas: FilaDeEnlace[]; empresaDesconocida: number; compartidoPisado: number } {
  const porClave = new Map<string, { fila: FilaDeEnlace; esCompartido: boolean }>();
  let empresaDesconocida = 0;
  let compartidoPisado = 0;

  for (const enlace of cruce.enlaces) {
    for (const partner of enlace.partners) {
      const esCompartido = partner.empresa === null;
      const empresas = esCompartido
        ? [...empresaPorOdoo.values()]
        : empresaPorOdoo.has(partner.empresa!)
          ? [empresaPorOdoo.get(partner.empresa!)!]
          : [];

      if (!empresas.length) {
        // Una empresa de Odoo que el SdG no conoce: se cuenta, no se adivina.
        empresaDesconocida++;
        continue;
      }

      for (const empresaId of empresas) {
        const clave = `${enlace.proveedorId}|${empresaId}`;
        const previo = porClave.get(clave);
        if (previo) {
          // El propio de la empresa le gana al compartido, sin importar el orden
          // en que Odoo los devolvió. Cualquier otro empate lo gana el primero.
          const loReemplaza = previo.esCompartido && !esCompartido;
          if (!loReemplaza) continue;
          compartidoPisado++;
        }

        porClave.set(clave, {
          esCompartido,
          fila: {
            proveedor_id: enlace.proveedorId,
            empresa_id: empresaId,
            odoo_partner_id: partner.odooId,
            cuit: enlace.cuit,
          },
        });
      }
    }
  }

  return {
    filas: [...porClave.values()].map((v) => v.fila),
    empresaDesconocida,
    compartidoPisado,
  };
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

// ── El emisor de una factura, resuelto contra Odoo ───────────

/**
 * Un `res.partner` candidato a ser el emisor, con lo que hace falta para elegir.
 */
export interface PartnerCandidato {
  id: number;
  nombre: string;
  /** `res.company`, o `null` si es compartido entre las dos empresas. */
  empresa: number | null;
  activo: boolean;
  /** `parent_id`: si lo tiene, es un contacto de otro, no el proveedor. */
  esContactoDeOtro: boolean;
  /**
   * `supplier_rank`: cuántas veces Odoo lo usó como proveedor.
   *
   * Es el desempate entre duplicados, y es un dato y no una corazonada: los
   * duplicados reales del grupo son un registro con uso y otro en cero o
   * marcado "(No usar)" —`IPERACTIVE S.A.` 37 contra `Ipertactive S.A.` 0—.
   */
  usos: number;
}

export type EleccionDelEmisor =
  | { partner: PartnerCandidato; motivo: null }
  | { partner: null; motivo: string; candidatos: PartnerCandidato[] };

/**
 * Cuál de los partners de Odoo es el emisor de la factura.
 *
 * **Es lo que destraba más de la mitad de las facturas.** Medido sobre las 2.776
 * facturas de proveedor de 2026: en **1.558 (56%)** el CUIT del emisor no está en
 * el padrón del SdG, así que el buzón no podía resolver el proveedor y sin
 * proveedor no se podía crear el borrador. Y no es que falte el dato: Odoo tiene
 * el CUIT del **100%** de esos partners. El padrón del SdG tiene 293 proveedores
 * y Odoo 587, y los que más facturan —transportistas y servicios— nunca pasaron
 * por un requerimiento de Compras, que es de donde salió el padrón.
 *
 * ## Cómo se elige, y por qué así
 *
 * Sobre los 1.555 partners con CUIT hay **1.341 claves (CUIT, empresa)** y 142
 * con más de un registro. Casi todos esos duplicados son **contactos hijos** —la
 * dirección de entrega de la misma empresa, con `parent_id` puesto— o registros
 * archivados. Descartando esos dos, **1.283 claves quedan con un solo partner y
 * 57 siguen ambiguas (4%)**.
 *
 * Con las 57 no se elige: se informan los candidatos para que decida una persona.
 * Un partner equivocado manda la factura a nombre de otro y eso no se nota.
 *
 * La empresa manda sobre el resto: en Odoo cada registro pertenece a una, y
 * facturarle a POLCECAL con el partner de POLYSAN es un asiento en la
 * contabilidad equivocada. Un partner sin empresa está compartido y sirve para
 * las dos, pero sólo si no hay uno propio.
 */
export function elegirPartnerDelEmisor(
  candidatos: PartnerCandidato[],
  companyId: number
): EleccionDelEmisor {
  const utiles = candidatos.filter((p) => p.activo && !p.esContactoDeOtro);

  if (utiles.length === 0) {
    return candidatos.length === 0
      ? { partner: null, motivo: "Ningún proveedor de Odoo tiene ese CUIT.", candidatos: [] }
      : {
          partner: null,
          motivo:
            "Los proveedores de Odoo con ese CUIT están archivados o son contactos de otro, " +
            "así que no sirven para facturar.",
          candidatos,
        };
  }

  // El propio de la empresa gana; el compartido sirve sólo si no hay propio.
  const propios = utiles.filter((p) => p.empresa === companyId);
  const elegibles = propios.length ? propios : utiles.filter((p) => p.empresa === null);

  if (elegibles.length === 1) return { partner: elegibles[0], motivo: null };

  /*
   * Desempatar por uso. De los 9 CUIT que quedaban ambiguos en las facturas de
   * 2026, **todos** son un registro usado y otro sin usar o mal escrito: BAX 68
   * contra 0, DON ALFREDO 41 contra 0, `R&C MAQUINADOS SRL` 10 contra
   * `R&C MAQUINADOS SRL (No usar)` 2.
   *
   * Se exige que el primero **triplique** al segundo. Con eso no se elige entre
   * dos registros que se usan de verdad —que sería inventar—, y sí se resuelve
   * el caso real, que es un duplicado que nadie limpió. El más flojo de los
   * medidos es 5 a 1.
   */
  if (elegibles.length > 1) {
    const porUso = [...elegibles].sort((a, b) => b.usos - a.usos);
    if (porUso[0].usos > 0 && porUso[0].usos >= porUso[1].usos * 3) {
      return { partner: porUso[0], motivo: null };
    }
  }

  if (elegibles.length === 0) {
    return {
      partner: null,
      motivo:
        "Ese CUIT existe en Odoo pero en la otra empresa. Hay que darlo de alta en ésta, " +
        "o cambiarle la empresa a la factura.",
      candidatos: utiles,
    };
  }

  return {
    partner: null,
    motivo: `En Odoo hay ${elegibles.length} proveedores con ese CUIT en la misma empresa: hay que elegir cuál.`,
    candidatos: elegibles,
  };
}
