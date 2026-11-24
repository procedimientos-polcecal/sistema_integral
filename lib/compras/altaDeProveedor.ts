/**
 * Las decisiones del alta de un proveedor desde la carga de un presupuesto.
 *
 * Es un alta distinta de la de `/compras/proveedores`, y la diferencia es una
 * sola: **acá el CUIT es obligatorio**. Este camino existe para llegar a una
 * orden de compra, y sin CUIT no se puede ni buscar si el proveedor ya está en
 * Odoo ni crearlo sin arriesgar un duplicado. Medido el 23/11/2026: de los 45
 * proveedores cotizados en 180 días que no pueden llegar a una orden, **40 no
 * tienen CUIT**. En la pantalla de administración sigue siendo opcional, porque
 * ahí se cargan también contratistas que nunca van a tener una orden en Odoo.
 *
 * ## Por qué el CUIT frena y el nombre sólo avisa
 *
 * No son dos grados del mismo control: son dos cosas distintas.
 *
 * El **CUIT repetido frena** porque es el caso que `cruzarProveedores()`
 * informa y **no enlaza**: con dos filas del SdG apuntando al mismo CUIT,
 * ninguna de las dos puede llegar a una orden de compra. Crear la segunda no
 * agrega un proveedor, rompe al que ya estaba.
 *
 * El **nombre parecido avisa** porque dos nombres parecidos pueden ser dos
 * proveedores de verdad. Y va `nombresParecidos()`, el laxo, y no la igualdad
 * de `claveProveedor()`: `proveedores.nombre` es `unique`, así que un nombre
 * **exactamente** igual ya lo rechaza la base con un 23505, y un freno por
 * igualdad de clave sería código muerto justo en el caso para el que existe.
 * Medido sobre las 484 filas del padrón: **81 grupos** colisionan por igualdad
 * de clave —casi todos variantes de mayúsculas y acentos, «Matelec» contra
 * «MATELEC»— y **119** por el laxo, que es el que además junta «TODO RULEMAN»
 * con «TODO RULEMAN, EQUIPARTES».
 */

import { normalizarCuit, cuitEsValido } from "@/lib/core/cuit";
import { nombresParecidos } from "@/lib/core/proveedores";

export interface ProveedorDelPadron {
  id: string;
  nombre: string;
  cuit: string | null;
}

export interface ProblemaDelAlta {
  campo: "nombre" | "cuit";
  mensaje: string;
  /** Quién tiene ya ese CUIT. Es lo que deja ofrecer «usá éste» en vez del error. */
  proveedorExistente?: { id: string; nombre: string };
}

export function validarAlta(
  datos: { nombre: string; cuit: string },
  padron: ProveedorDelPadron[]
): ProblemaDelAlta[] {
  const problemas: ProblemaDelAlta[] = [];

  if (!datos.nombre.trim()) {
    problemas.push({ campo: "nombre", mensaje: "El nombre es obligatorio" });
  }

  /*
   * «Falta» y «está mal escrito» se dicen distinto a propósito.
   * `normalizarCuit` devuelve null en los dos casos, y contestar «es
   * obligatorio» a quien escribió diez dígitos es falso: llenó el campo. El
   * mensaje tiene que decirle qué le falta al número, no al formulario.
   */
  const cuit = normalizarCuit(datos.cuit);
  if (!cuit) {
    problemas.push({
      campo: "cuit",
      mensaje: datos.cuit.trim()
        ? "El CUIT tiene que tener once dígitos"
        : "El CUIT es obligatorio: es con lo único que se reconoce al proveedor en Odoo",
    });
    return problemas;
  }

  if (!cuitEsValido(cuit)) {
    problemas.push({ campo: "cuit", mensaje: "El dígito verificador del CUIT no cierra" });
    return problemas;
  }

  const yaEsta = padron.find((p) => normalizarCuit(p.cuit) === cuit);
  if (yaEsta) {
    problemas.push({
      campo: "cuit",
      mensaje: `Ese CUIT ya es de «${yaEsta.nombre}»`,
      proveedorExistente: { id: yaEsta.id, nombre: yaEsta.nombre },
    });
  }

  return problemas;
}

/**
 * Los del padrón cuyo nombre se parece a éste.
 *
 * Se arma pasando el nombre nuevo **junto con** los del padrón y buscando el
 * grupo que lo contiene: `nombresParecidos()` agrupa una lista contra sí misma,
 * así que es la forma de preguntarle «¿a quién se parece éste?».
 */
export function parecidosEnElPadron(
  nombre: string,
  padron: ProveedorDelPadron[]
): ProveedorDelPadron[] {
  const grupo = nombresParecidos([nombre, ...padron.map((p) => p.nombre)])
    .find((g) => g.includes(nombre));
  if (!grupo) return [];

  const otros = new Set(grupo.filter((n) => n !== nombre));
  return padron.filter((p) => otros.has(p.nombre));
}

/**
 * En qué empresas de Odoo hace falta el proveedor, según el RI.
 *
 * La empresa no se elige: sale del requerimiento. `paga_ambas` quiere decir las
 * dos, y en Odoo un partner pertenece a **una**, así que ese caso son dos
 * `res.partner` y no uno — el 40% de los RI, medido.
 *
 * Devuelve vacío cuando no hay contra qué trabajar: un RI sin empresa y sin
 * `paga_ambas` (17 de 1.024), o una empresa sin `odoo_company_id`. Ahí no se
 * busca ni se crea nada, y quien llama lo tiene que decir en pantalla.
 */
export function empresasDelRequerimiento(
  ri: { empresa_id: string | null; paga_ambas: boolean },
  todas: { id: string; odoo_company_id: number | null }[]
): { id: string; odooCompanyId: number }[] {
  const elegidas = ri.paga_ambas ? todas : todas.filter((e) => e.id === ri.empresa_id);

  return elegidas
    .filter((e) => e.odoo_company_id !== null)
    .map((e) => ({ id: e.id, odooCompanyId: e.odoo_company_id! }));
}
