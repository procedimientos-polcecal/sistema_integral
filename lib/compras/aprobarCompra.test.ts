import { describe, it, expect } from "vitest";
import { puedeAprobarLaCompra, esAprobacionNueva } from "./aprobarCompra";

const YO = "u-nico";
const OTRO = "u-maxi";

/**
 * Aprobar la compra tiene dos caminos —elegir un presupuesto, y aprobar sin
 * comparativa— y los dos tienen que pedir lo mismo. Cuando la regla estaba
 * escrita en cada ruta por separado, la del PATCH se habia olvidado de la
 * lista de aprobadores.
 */
describe("quien puede aprobar una compra", () => {
  it("la persona asignada y en la lista, si", () => {
    const v = puedeAprobarLaCompra({
      asignadaA: YO, usuarioId: YO, estaEnLaLista: true, estadoCompra: "PARA_COMPRAR",
    });
    expect(v.ok).toBe(true);
  });

  it("otra persona no, aunque este en la lista", () => {
    // En la planilla el estado dice a quien le toca: que apruebe otro dejaria
    // los dos lados diciendo cosas distintas.
    const v = puedeAprobarLaCompra({
      asignadaA: OTRO, usuarioId: YO, estaEnLaLista: true, estadoCompra: "PARA_COMPRAR",
    });
    expect(v.ok).toBe(false);
    expect(v.estado).toBe(403);
    expect(v.error).toMatch(/asign/);
  });

  it("el asignado que salio de la lista, tampoco", () => {
    const v = puedeAprobarLaCompra({
      asignadaA: YO, usuarioId: YO, estaEnLaLista: false, estadoCompra: "PARA_COMPRAR",
    });
    expect(v.ok).toBe(false);
    expect(v.estado).toBe(403);
    expect(v.error).toMatch(/lista/);
  });

  it("sin nadie asignado no puede aprobar nadie", () => {
    const v = puedeAprobarLaCompra({
      asignadaA: null, usuarioId: YO, estaEnLaLista: true, estadoCompra: "PARA_COMPRAR",
    });
    expect(v.ok).toBe(false);
  });

  it("una compra que no esta para comprar no se aprueba", () => {
    const v = puedeAprobarLaCompra({
      asignadaA: YO, usuarioId: YO, estaEnLaLista: true, estadoCompra: "PEDIDO",
    });
    expect(v.ok).toBe(false);
    expect(v.estado).toBe(409);
  });

  it("sin pasar el estado no se lo valida: lo hace quien llama", () => {
    const v = puedeAprobarLaCompra({ asignadaA: YO, usuarioId: YO, estaEnLaLista: true });
    expect(v.ok).toBe(true);
  });
});

describe("el estado que dice decidida sin nada decidido", () => {
  const base = { asignadaA: "u1", usuarioId: "u1", estaEnLaLista: true };

  /*
   * 35 requerimientos están en APROBADO sin proveedor ni presupuesto elegido:
   * el estado vino de la columna de la planilla. Exigir el estado exacto los
   * dejaba sin salida, porque la pantalla congelada esconde lo que permitiría
   * resolverlo.
   */
  it("se puede aprobar: es la primera vez, por más que el estado diga otra cosa", () => {
    expect(puedeAprobarLaCompra({ ...base, estadoCompra: "APROBADO", yaDecidida: false }).ok).toBe(true);
    expect(puedeAprobarLaCompra({ ...base, estadoCompra: "PEDIDO", yaDecidida: false }).ok).toBe(true);
  });

  it("con algo ya decidido NO se puede: eso es aprobar dos veces", () => {
    const v = puedeAprobarLaCompra({ ...base, estadoCompra: "APROBADO", yaDecidida: true });
    expect(v.ok).toBe(false);
    expect(v.estado).toBe(409);
  });

  it("sin saber si está decidida, se mantiene la regla estricta", () => {
    // La ruta que no pasa el dato no puede abrir la excepción por omisión.
    expect(puedeAprobarLaCompra({ ...base, estadoCompra: "APROBADO" }).ok).toBe(false);
  });

  it("la excepción no alcanza a los estados que no son de decisión", () => {
    // EN_COMPARATIVA o SIN_INICIAR no dicen "ya se decidió": son etapas previas,
    // y aprobar desde ahí saltearía el circuito.
    expect(puedeAprobarLaCompra({ ...base, estadoCompra: "EN_COMPARATIVA", yaDecidida: false }).ok).toBe(false);
    expect(puedeAprobarLaCompra({ ...base, estadoCompra: "SIN_INICIAR", yaDecidida: false }).ok).toBe(false);
    expect(puedeAprobarLaCompra({ ...base, estadoCompra: "EN_ESPERA", yaDecidida: false }).ok).toBe(false);
  });

  it("la excepción no saltea los otros dos permisos", () => {
    const ajeno = puedeAprobarLaCompra({ ...base, asignadaA: "otro", estadoCompra: "APROBADO", yaDecidida: false });
    expect(ajeno.ok).toBe(false);
    expect(ajeno.estado).toBe(403);

    const fuera = puedeAprobarLaCompra({ ...base, estaEnLaLista: false, estadoCompra: "APROBADO", yaDecidida: false });
    expect(fuera.ok).toBe(false);
    expect(fuera.estado).toBe(403);
  });
});

describe("aprobar es pasar a aprobado, no volver a guardar", () => {
  it("pasar de para comprar a aprobado es una aprobación", () => {
    expect(esAprobacionNueva("PARA_COMPRAR", "APROBADO")).toBe(true);
  });

  /*
   * El caso que rompía el guardado: el formulario manda `estado_compra` siempre,
   * así que tocar el proveedor de una compra ya aprobada se leía como aprobarla
   * de nuevo. Resultado: 403 para quien no la tenía asignada, y el cambio
   * perdido. Además re-estampaba quién aprobó y cuándo.
   */
  it("guardar una compra que YA estaba aprobada no lo es", () => {
    expect(esAprobacionNueva("APROBADO", "APROBADO")).toBe(false);
  });

  it("los otros estados no aprueban nada", () => {
    expect(esAprobacionNueva("APROBADO", "PEDIDO")).toBe(false);
    expect(esAprobacionNueva("PARA_COMPRAR", "EN_ESPERA")).toBe(false);
    expect(esAprobacionNueva("APROBADO", undefined)).toBe(false);
  });

  it("volver a aprobar después de retroceder sí lo es", () => {
    // Si alguien devolvió la compra a comparativa, aprobarla otra vez es una
    // decisión nueva y tiene que pasar por el permiso.
    expect(esAprobacionNueva("EN_COMPARATIVA", "APROBADO")).toBe(true);
  });
});
