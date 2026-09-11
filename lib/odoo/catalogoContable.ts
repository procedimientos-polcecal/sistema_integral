import { buscarLeer, idDeRelacion, nombreDeRelacion } from "./client";

/**
 * Las cuentas con las que se imputa una línea de factura de proveedor.
 *
 * Son dos catálogos distintos y hay que no confundirlos:
 *
 * - **La cuenta contable** (`account.account`) dice *en qué gasto* cae la
 *   línea: `5.2.1.01.220 Repuestos`, `5.1.1.01.011 Fletes y Acarreos`.
 * - **La cuenta analítica** (`account.analytic.account`) dice *para qué* fue:
 *   `EM6 - CATERPILLAR 950 G`, `TALLER DE MANTENIMIENTO`. Va en la distribución
 *   analítica, que reparte la línea en porcentajes.
 *
 * Los dos son **por empresa**: hay 355 cuentas en Polcecal y 350 en Polysan, y
 * 358 y 359 analíticas. La misma cuenta "Repuestos" es el id 706 en una y el 742
 * en la otra — usar la de la otra empresa no da un error prolijo, da un asiento
 * en la contabilidad equivocada. Es la misma trampa que los impuestos.
 *
 * Se leen enteros y no por búsqueda incremental porque la pantalla necesita
 * poder mostrarlos agrupados por plan, y porque son 700 filas: una llamada.
 */

export interface CuentaContable {
  id: number;
  /** `5.2.1.01.220`. Es por donde la busca quien la conoce. */
  codigo: string;
  nombre: string;
}

export interface CuentaAnalitica {
  id: number;
  nombre: string;
  /** `EQUIPOS MÓVILES`, `MANTENIMIENTO`, `CANTERA`. Agrupa el selector. */
  plan: string | null;
}

/**
 * Los tipos de cuenta que puede llevar una línea de compra.
 *
 * Medido contra las 11.048 líneas de factura de proveedor de la instancia: las
 * cuentas que usan son de gasto y de activo corriente —`114001000000 Materiales
 * e insumos` es de las más usadas y es un activo—, así que filtrar sólo por
 * `expense` dejaría afuera la segunda cuenta más frecuente. Lo que sí se excluye
 * son las de banco, las de cliente y las de proveedor: ahí no va un gasto.
 */
const TIPOS_IMPUTABLES = [
  "expense",
  "expense_depreciation",
  "expense_direct_cost",
  "asset_current",
  "asset_fixed",
  "asset_non_current",
  "asset_prepayments",
];

export async function leerCuentasContables(companyId: number): Promise<CuentaContable[]> {
  const crudas = await buscarLeer<{ id: number; code: string | false; name: string }>(
    "account.account",
    [
      ["company_id", "=", companyId],
      ["deprecated", "=", false],
      ["account_type", "in", TIPOS_IMPUTABLES],
    ],
    ["code", "name"],
    { limite: 2000, orden: "code asc" }
  );

  return crudas.map((c) => ({ id: c.id, codigo: c.code || "", nombre: c.name }));
}

export async function leerCuentasAnaliticas(companyId: number): Promise<CuentaAnalitica[]> {
  /*
   * `company_id` de la analítica es un many2one que puede venir vacío: una
   * cuenta sin empresa la comparten las dos. Hoy no hay ninguna así —medido: 0—,
   * pero el dominio las acepta igual para que el día que alguien cree una
   * compartida no desaparezca del selector sin que nadie entienda por qué.
   */
  const crudas = await buscarLeer<{ id: number; name: string; plan_id: unknown }>(
    "account.analytic.account",
    ["|", ["company_id", "=", companyId], ["company_id", "=", false]],
    ["name", "plan_id"],
    { limite: 3000, orden: "name asc" }
  );

  return crudas.map((c) => ({
    id: c.id,
    nombre: c.name,
    plan: nombreDeRelacion(c.plan_id),
  }));
}

/** Los ids de las analíticas que existen, para no mandar a Odoo una que se borró. */
export async function analiticasQueExisten(ids: number[]): Promise<Set<number>> {
  if (!ids.length) return new Set();
  const crudas = await buscarLeer<{ id: number }>(
    "account.analytic.account",
    [["id", "in", ids]],
    ["id"],
    { limite: 3000 }
  );
  return new Set(crudas.map((c) => c.id));
}

/** El `company_id` de una cuenta, para poder avisar si es de la otra empresa. */
export async function empresaDeLaCuenta(id: number): Promise<number | null> {
  const [cuenta] = await buscarLeer<{ id: number; company_id: unknown }>(
    "account.account",
    [["id", "=", id]],
    ["company_id"],
    { limite: 1 }
  );
  return cuenta ? idDeRelacion(cuenta.company_id) : null;
}
