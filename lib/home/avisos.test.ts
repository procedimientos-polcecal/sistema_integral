import { describe, expect, it } from "vitest";
import { avisosDeConteos, avisosDeRitmo } from "./avisos";

describe("avisosDeConteos", () => {
  it("no genera avisos cuando está todo en cero", () => {
    expect(avisosDeConteos({ mantenimientoAtrasadas: 0, comprasEsperandoAprobacion: 0 })).toEqual([]);
  });

  it("ignora los conteos que no le pasaron", () => {
    expect(avisosDeConteos({})).toEqual([]);
  });

  it("genera un aviso por cada conteo mayor que cero", () => {
    const avisos = avisosDeConteos({ mantenimientoAtrasadas: 20, facturacionSinVincular: 1 });
    expect(avisos.map((a) => a.id)).toEqual(["mant-atrasadas", "facturacion-sin-vincular"]);
    expect(avisos[0]).toEqual({
      id: "mant-atrasadas",
      titulo: "Órdenes de trabajo atrasadas",
      cantidad: 20,
      href: "/mantenimiento/ordenes?estado=ATRASADO",
    });
  });

  /*
   * La bandeja de carbonilla es lo único que queda sin aplicarse después del
   * 23/10/2026, cuando una fila cambiada pasó a releerse sola. Lo que cae ahí
   * es lo que el SdG NO puede resolver: una fila vaciada, un código que no es
   * de ningún carbonillero, un id duplicado por copiar y pegar.
   *
   * Existe desde el 13/10 y no la miró nadie. Mientras tanto el SdG estuvo 8 t
   * abajo una semana y 59 t abajo dos días después, y las dos veces me enteré
   * porque alguien me lo pidió. Un tablero que hay que acordarse de abrir no es
   * un tablero.
   */
  it("avisa de las filas de carbonilla que el SdG no pudo resolver", () => {
    expect(avisosDeConteos({ calidadCarbonillaBandeja: 3 })).toEqual([
      {
        id: "calidad-carbonilla-bandeja",
        titulo: "Filas de la planilla de carbonilla que el sistema no pudo leer",
        cantidad: 3,
        href: "/calidad/carbonilla",
      },
    ]);
  });

  it("incluye los dos módulos nuevos", () => {
    const avisos = avisosDeConteos({ calidadEnvasesSinPlanilla: 2, trituracionSinPlanilla: 2 });
    expect(avisos.map((a) => a.id)).toEqual(["calidad-envases-sin-planilla", "trituracion-sin-planilla"]);
  });

  /*
   * El aviso que reemplazó a los dos de service de 250 hs, que medían una tabla
   * con un solo service y sólo podían decir 0 o 1. El `id` se fija acá a
   * propósito: tiene que ser **nuevo** y no reusar
   * `taller-vial-service-vencido` ni `taller-vial-service-proximo`, porque a
   * quien hubiera descartado alguno de esos le llegaría ya silenciado un aviso
   * que nunca vio.
   */
  it("avisa de los equipos sin ningún service registrado, con un id propio", () => {
    expect(avisosDeConteos({ tallerVialSinService: 15 })).toEqual([
      {
        id: "taller-vial-sin-service",
        titulo: "Equipos sin ningún service registrado",
        cantidad: 15,
        href: "/taller-vial/services",
      },
    ]);
  });

  it("sale después del aviso de cargas sin equipo, como antes salían los de service", () => {
    const avisos = avisosDeConteos({ tallerVialSinEquipo: 3, tallerVialSinService: 15, trituracionSinPlanilla: 1 });
    expect(avisos.map((a) => a.id)).toEqual([
      "taller-vial-sin-equipo",
      "taller-vial-sin-service",
      "trituracion-sin-planilla",
    ]);
  });
});

describe("avisosDeRitmo", () => {
  const ritmo = {
    despacho: { ultimaFecha: "2026-10-01", diasSinCargar: 5, umbral: 4, atrasado: true },
    trituracion: { ultimaFecha: "2026-08-31", diasSinCargar: 36, umbral: 4, atrasado: true },
    inventario: { ultimaFecha: "2026-10-05", diasSinCargar: 1, umbral: 5, atrasado: false },
    produccion: { ultimaFecha: null, diasSinCargar: null, umbral: 3, atrasado: true },
  };

  /*
   * En la tarjeta la señal aparece apenas pasa el umbral; en la campana recién
   * al doble, para que Despacho con 5 días no haga ruido y Trituración con 36 sí.
   */
  it("sólo avisa pasado el doble del umbral", () => {
    const avisos = avisosDeRitmo(ritmo, ["despacho", "trituracion", "inventario"]);
    expect(avisos.map((a) => a.id)).toEqual(["ritmo-trituracion"]);
  });

  it("un módulo que nunca se cargó avisa siempre, con cantidad 1", () => {
    const avisos = avisosDeRitmo(ritmo, ["produccion"]);
    expect(avisos).toEqual([
      {
        id: "ritmo-produccion",
        titulo: "Producción: nunca se cargó nada",
        cantidad: 1,
        href: "/produccion",
      },
    ]);
  });

  it("la cantidad no crece de un día para el otro", () => {
    const hoy = avisosDeRitmo({ trituracion: { ultimaFecha: "x", diasSinCargar: 36, umbral: 4, atrasado: true } }, ["trituracion"]);
    const manana = avisosDeRitmo({ trituracion: { ultimaFecha: "x", diasSinCargar: 37, umbral: 4, atrasado: true } }, ["trituracion"]);
    expect(manana[0].cantidad).toBe(hoy[0].cantidad);
  });

  it("no avisa de un módulo al que el usuario no tiene acceso", () => {
    expect(avisosDeRitmo(ritmo, ["inventario"])).toEqual([]);
  });
});
