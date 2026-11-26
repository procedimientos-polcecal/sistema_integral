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

/**
 * De qué empresas es un proveedor: de una, de las dos, o no se sabe.
 *
 * Es la misma forma que `compras_requerimientos` usa para decir quién paga
 * (`empresa_id` + `paga_ambas`), y por eso las dos puntas las resuelve la
 * misma función. Las dos columnas de `proveedores` son excluyentes por un
 * check, así que `ambas: true` con `empresaId` cargado no existe en la base.
 */
export interface DeQueEmpresas {
  empresaId: string | null;
  ambas: boolean;
}

/**
 * A qué perfiles de Odoo apunta el alta de un proveedor.
 *
 * En Odoo funcionan dos empresas —POLCECAL es la `res.company` 1 y POLYSAN la
 * 2— y un `res.partner` pertenece a una. En el SdG el padrón es uno solo y
 * compartido, así que al dar de alta hay que decir a cuál de las dos va, y de
 * eso depende dónde se lo busca ahora y dónde se lo crea al generar la orden.
 *
 * El orden de precedencia es el que importa y no es obvio:
 *
 * 1. **Lo que la persona eligió en el alta**, que es lo único que sabe si este
 *    proveedor le vende a una sola o a las dos. 39 de los 130 proveedores
 *    enlazados a Odoo están en una sola empresa, así que la pregunta tiene
 *    respuestas distintas de verdad.
 * 2. **Lo que dice el pedido**, para cuando no eligió. Es lo que hacía el
 *    sistema entero antes del 24/11/2026.
 * 3. **Las dos**, cuando no hay pedido. Enlazar no escribe nada en Odoo —el
 *    partner ya existe allá—, así que mirar de más no arriesga nada y dejar
 *    el enlace sin hacer obliga a resolverlo después a mano.
 *
 * Y un cuarto caso que **no** cae en el 3: un pedido que existe pero no dice
 * empresa ni AMBAS (17 de 1.024) devuelve vacío. Que el pedido no conteste no
 * es lo mismo que no tener pedido: ahí la ruta lo dice en vez de elegir una.
 */
export function destinoDelAlta(
  elegido: DeQueEmpresas,
  ri: { empresa_id: string | null; paga_ambas: boolean } | null,
  todas: { id: string; odoo_company_id: number | null }[]
): { id: string; odooCompanyId: number }[] {
  if (elegido.ambas || elegido.empresaId) {
    return empresasDelRequerimiento(
      { empresa_id: elegido.empresaId, paga_ambas: elegido.ambas },
      todas
    );
  }

  if (ri) return empresasDelRequerimiento(ri, todas);

  return empresasDelRequerimiento({ empresa_id: null, paga_ambas: true }, todas);
}

/**
 * Las dos columnas de empresa, normalizadas antes de escribirlas.
 *
 * `proveedores` tiene un check —`proveedores_empresa_o_ambas`— que prohíbe
 * decir «es de POLCECAL» y «es de las dos» a la vez. Un formulario puede
 * mandar las dos sin querer: se tilda «las dos» después de haber elegido una,
 * y el valor viejo sigue en el estado. Si eso llega a la base, Postgres
 * contesta un 23514 crudo que no le dice nada a nadie.
 *
 * Acá gana «las dos», que es lo que la persona acaba de marcar, y la cadena
 * vacía del desplegable se lee como «no se sabe» y no como un id.
 */
export function empresaParaGuardar(
  body: { empresa_id?: unknown; trabaja_con_ambas?: unknown }
): { empresa_id: string | null; trabaja_con_ambas: boolean } {
  const ambas = body.trabaja_con_ambas === true;
  const id = typeof body.empresa_id === "string" && body.empresa_id !== "" ? body.empresa_id : null;
  return { empresa_id: ambas ? null : id, trabaja_con_ambas: ambas };
}
