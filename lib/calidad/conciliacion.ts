/**
 * El libro contra Odoo: qué camión no tiene orden de compra.
 *
 * **Es una vista, no un estado.** Se calcula al abrirla y no se guarda: un
 * derivado guardado se desincroniza y nada avisa, que es la regla que este
 * módulo ya tiene escrita para los saldos.
 *
 * Odoo dejó de crear movimientos el 13/10/2026 —la planilla manda sobre el
 * libro— y pasó a ser esto: el único lugar que dice que un camión entró sin
 * orden de compra, que es plata que después no se puede facturar.
 *
 * Spec: docs/superpowers/specs/2026-10-13-calidad-la-planilla-manda-design.md
 */

/**
 * Cuánto puede tardar Odoo en recibir la orden de un camión ya pesado.
 *
 * Medido sobre un año: 1.053 de 1.055 órdenes se cargan el mismo día y el
 * máximo son 3. Dos días deja afuera muy poco y evita que un camión aparee con
 * la orden de otro de la misma semana.
 */
const DIAS_DE_GRACIA = 2;

/** Menos que esto es el mismo número: la base guarda `numeric(12,3)`. */
const TOLERANCIA = 0.005;

export interface CamionDelLibro {
  id: string;
  fecha: string;
  odooPartnerId: number;
  /** Positiva. */
  toneladas: number;
}

export interface LineaDeOdooParaControl {
  ordenNombre: string;
  fecha: string;
  partnerId: number;
  partnerNombre: string;
  cantidad: number;
}

export interface CantidadDistinta {
  camionId: string;
  fecha: string;
  ordenNombre: string;
  enElLibro: number;
  enOdoo: number;
}

export interface Desvios {
  /** En la planilla y sin orden de compra. **No se puede facturar.** */
  sinOrden: CamionDelLibro[];
  /** En Odoo y sin camión en el libro. */
  sinCamion: LineaDeOdooParaControl[];
  cantidadDistinta: CantidadDistinta[];
}

function dias(a: string, b: string): number {
  return Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000;
}

export function desviosContraOdoo(
  camiones: CamionDelLibro[],
  lineas: LineaDeOdooParaControl[]
): Desvios {
  const libres = lineas.map((l) => ({ l, usada: false }));

  const sinOrden: CamionDelLibro[] = [];
  const cantidadDistinta: CantidadDistinta[] = [];

  for (const c of camiones) {
    // EL PROVEEDOR TIENE QUE SER EL MISMO. Aparear por fecha y cantidad entre
    // proveedores distintos es el cruce difuso que este módulo existe para
    // eliminar: dos desvíos del mismo día no son un match, son dos desvíos.
    const candidatas = libres.filter(
      (x) =>
        !x.usada &&
        x.l.partnerId === c.odooPartnerId &&
        dias(x.l.fecha, c.fecha) <= DIAS_DE_GRACIA
    );
    if (candidatas.length === 0) {
      sinOrden.push(c);
      continue;
    }

    // La más parecida en cantidad, y se consume: así dos camiones iguales del
    // mismo día no se quedan los dos con la única orden que hay.
    candidatas.sort(
      (a, b) => Math.abs(a.l.cantidad - c.toneladas) - Math.abs(b.l.cantidad - c.toneladas)
    );
    const elegida = candidatas[0];
    elegida.usada = true;

    if (Math.abs(elegida.l.cantidad - c.toneladas) >= TOLERANCIA) {
      cantidadDistinta.push({
        camionId: c.id,
        fecha: c.fecha,
        ordenNombre: elegida.l.ordenNombre,
        enElLibro: c.toneladas,
        enOdoo: elegida.l.cantidad,
      });
    }
  }

  return {
    sinOrden,
    sinCamion: libres.filter((x) => !x.usada).map((x) => x.l),
    cantidadDistinta,
  };
}
