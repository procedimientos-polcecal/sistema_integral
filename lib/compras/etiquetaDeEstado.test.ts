import { describe, it, expect } from "vitest";
import { etiquetaDeEstadoCompra } from "./sheets";

describe("que texto va en la celda de Estado de la planilla", () => {
  it("los estados que el desplegable tiene se escriben con su texto exacto", () => {
    // Los desplegables de la planilla son estrictos: un texto que no sea
    // exactamente uno de estos deja la celda fuera de rango y rompe las
    // formulas y filtros que dependen de el.
    expect(etiquetaDeEstadoCompra("EN_COMPARATIVA")).toBe("EN PROCESO (COMPARATIVA)");
    expect(etiquetaDeEstadoCompra("APROBADO")).toBe("APROBADO");
    expect(etiquetaDeEstadoCompra("PEDIDO")).toBe("PEDIDO");
    expect(etiquetaDeEstadoCompra("DENEGADO")).toBe("DENEGADO");
    expect(etiquetaDeEstadoCompra("EN_ESPERA")).toBe("EN ESPERA");
  });

  it("SIN_INICIAR vacia la celda, y eso es una decision", () => {
    // Vacio NO es lo mismo que null acá: este estado no tiene etiqueta en el
    // desplegable y corresponde que la celda quede en blanco.
    expect(etiquetaDeEstadoCompra("SIN_INICIAR")).toBe("");
  });

  it("RECIBIDO no se escribe: devuelve null, no cadena vacia", () => {
    // El caso que costo un dato el 06/10/2026. RECIBIDO no esta en el
    // desplegable, asi que el sistema no tiene nada que decir sobre esa celda
    // y hay que dejarla como esta. Con `?? ""` el null se aplastaba contra ""
    // y el sistema BORRABA el "PEDIDO" que habia escrito el mes pasado.
    expect(etiquetaDeEstadoCompra("RECIBIDO")).toBeNull();
    expect(etiquetaDeEstadoCompra("RECIBIDO")).not.toBe("");
  });

  it("un estado que no esta en el mapa tampoco se escribe", () => {
    // La direccion inofensiva del error: no decir nada deja el dato de la
    // planilla intacto; escribir vacio lo pierde sin que nadie se entere. Vale
    // para el dia que se agregue un estado nuevo y alguien se olvide del mapa.
    expect(etiquetaDeEstadoCompra("UN_ESTADO_NUEVO")).toBeNull();
    expect(etiquetaDeEstadoCompra("")).toBeNull();
  });

  it("PARA_COMPRAR no sale de aca", () => {
    // Lleva entre parentesis el alias de quien tiene que aprobar, asi que lo
    // arma `textoParaComprar` con ese dato. Que devuelva null es correcto: si
    // alguna vez se lo pide por este camino, no escribe en vez de escribir algo
    // incompleto.
    expect(etiquetaDeEstadoCompra("PARA_COMPRAR")).toBeNull();
  });
});
