import { describe, it, expect } from "vitest";
import {
  COLUMNAS_COMPARATIVA, mapearEncabezados, filasParaEsteRi,
  totalCotizacion, parsearFila, filaParaPlanilla, DISPONIBILIDADES, PLAZOS_PAGO,
  datosDePagoDe, alCambiarDeProveedor,
  diferenciaPorcentual, detalleCotizacion, costosParaElPedido,
  totalEnPesos, faltaLaCotizacion, numero, diasDePlazo,
} from "./comparativa";
import type { CotizacionLeida } from "./comparativa";

const ENCABEZADO = [...COLUMNAS_COMPARATIVA];

describe("total de una cotización", () => {
  it("suma el envío, que la fórmula de la planilla dejaba afuera", () => {
    // 100 × 2 = 200, sin descuento, +21% = 242, + 50 de envío = 292
    expect(totalCotizacion({
      precio_unitario: 100, cantidad: 2, descuento: 0, iva: 0.21, costo_envio: 50,
    })).toBe(292);
  });

  it("el descuento sale del neto, sin IVA encima", () => {
    // 100 × 1 = 100 de neto. Con IVA: 121. El 10% de descuento son 10 —del
    // neto, no del total— asi que 121 - 10 = 111.
    //
    // Descontar primero y aplicar el IVA al resultado daria 108.9, que es lo
    // que hacia antes. Compras calcula el otro, y el test fija cual.
    expect(totalCotizacion({
      precio_unitario: 100, cantidad: 1, descuento: 0.1, iva: 0.21, costo_envio: null,
    })).toBe(111);
  });

  it("con descuento en cero las dos formas coinciden", () => {
    // Por esto la diferencia no se veia: 310 de las 312 cotizaciones cargadas
    // tienen descuento cero.
    expect(totalCotizacion({
      precio_unitario: 290, cantidad: 1, descuento: 0, iva: 0.21, costo_envio: null,
    })).toBe(350.9);
  });

  it("una cantidad vacía vale 1: es una cotización por monto total", () => {
    expect(totalCotizacion({
      precio_unitario: 1000, cantidad: null, descuento: null, iva: 0, costo_envio: null,
    })).toBe(1000);
  });

  it("redondea a dos decimales", () => {
    // 33.33 × 3 = 99.99, +21% = 120.9879
    expect(totalCotizacion({
      precio_unitario: 33.33, cantidad: 3, descuento: 0, iva: 0.21, costo_envio: null,
    })).toBe(120.99);
  });
});

describe("numeros de la planilla", () => {
  it("saca el simbolo de moneda y los espacios", () => {
    expect(numero("$ 1500")).toBe(1500);
    expect(numero("  1500  ")).toBe(1500);
  });

  it("un porcentaje vuelve como fraccion", () => {
    expect(numero("10%")).toBeCloseTo(0.1);
    expect(numero("21%")).toBeCloseTo(0.21);
    expect(numero("21,5%")).toBeCloseTo(0.215);
  });

  /**
   * El punto de miles. "1.500" es mil quinientos y entraba como 1,5: en una
   * comparativa eso convierte al presupuesto mas caro en el mas barato.
   * La regla vive en `lib/core/numeroArgentino.ts` y esta probada alla; aca se
   * fija que `numero()` la use de verdad.
   */
  it("el punto de miles no se lee como decimal", () => {
    expect(numero("1.500")).toBe(1500);
    expect(numero("$ 1.234.567")).toBe(1234567);
    expect(numero("1.500,50")).toBeCloseTo(1500.5);
    // Y los decimales de verdad siguen siendo decimales.
    expect(numero("1500,50")).toBeCloseTo(1500.5);
    expect(numero("1.5")).toBeCloseTo(1.5);
  });

  it("el IVA guardado como fraccion no se convierte en miles", () => {
    expect(numero("0.210")).toBeCloseTo(0.21);
  });

  it("lo que no es un numero queda sin definir", () => {
    expect(numero("")).toBeNull();
    expect(numero("s/d")).toBeNull();
    expect(numero(null)).toBeNull();
  });

  it("un plazo con punto de miles ya no pasa por dos dias", () => {
    // Antes "1.500" daba 1,5, redondeaba a 2 y se guardaba como dos dias de
    // plazo. Ahora son 1500, que supera el tope de un año: sin definir.
    expect(diasDePlazo("1.500")).toBeNull();
    expect(diasDePlazo("30")).toBe(30);
    expect(diasDePlazo("30/60")).toBeNull();
  });
});

describe("mapeo de encabezados", () => {
  it("encuentra las columnas de la plantilla genérica", () => {
    const r = mapearEncabezados(ENCABEZADO);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.idx.nro_ri).toBe(0);
    expect(r.idx.proveedor).toBe(4);
    expect(r.idx.precio_unitario).toBe(7);
    expect(r.idx.eleccion).toBe(18);
  });

  it("tolera acentos, mayúsculas y espacios de más", () => {
    const raro = ENCABEZADO.map((c) => `  ${c.toLowerCase()}  `);
    expect(mapearEncabezados(raro).ok).toBe(true);
  });

  it("rechaza una planilla con otra estructura y dice qué falta", () => {
    const r = mapearEncabezados(["FECHA", "COSA", "OTRA COSA"]);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    const dice = r.faltan.join(" | ");
    expect(dice).toContain("PROVEEDOR");
    expect(dice).toContain("PRECIO UNITARIO");
  });
});

describe("regla de la columna A", () => {
  const filas = [
    ["", "", "", "", "Proveedor Sin Ri", "", "", "100"],      // fila 2: sin numero
    ["1850", "", "", "", "Proveedor Propio", "", "", "200"],  // fila 3: de este RI
    ["999", "", "", "", "Proveedor Ajeno", "", "", "300"],    // fila 4: de otro RI
    ["", "", "", "", "", "", "", ""],                         // fila 5: vacia
  ];

  it("trae solo las filas de este RI", () => {
    const r = filasParaEsteRi(filas, 0, 1850);
    expect(r.propias.map((p) => p.numeroFila)).toEqual([3]);
  });

  /**
   * Antes una fila sin numero se tomaba como propia. Las planillas son por
   * articulo y acumulan cotizaciones de años sin etiquetar, asi que esa regla
   * le pego 238 presupuestos ajenos a un solo pedido. Sin numero no significa
   * "es de este RI", significa "no se sabe de cual es".
   */
  it("no reclama las filas sin numero: las cuenta aparte", () => {
    const r = filasParaEsteRi(filas, 0, 1850);
    expect(r.sinRi).toBe(1);
    expect(r.propias).toHaveLength(1);
  });

  it("las de otro RI se cuentan y no se tocan", () => {
    const r = filasParaEsteRi(filas, 0, 1850);
    expect(r.ajenas).toBe(1);
  });

  it("una fila del todo vacia no cuenta para ningun lado", () => {
    const r = filasParaEsteRi(filas, 0, 1850);
    expect(r.propias.length + r.ajenas + r.sinRi).toBe(3);
  });
});

describe("parsear una fila de la planilla", () => {
  it("lee los porcentajes como fracción y las fechas como ISO", () => {
    const r = mapearEncabezados(ENCABEZADO);
    if (!r.ok) throw new Error("encabezado inválido");
    const fila = [
      "1850", "1/8/2026", "Mantenimiento", "Filtro de aceite", "Repuestos SA",
      "XCMG", "unidad", "1500,50", "4", "800", "10%", "21%", "", "31/8/2026",
      "30", "Transferencia 30 días", "4-7 días", "Sin stock del original", "",
    ];
    const c = parsearFila(fila, r.idx);
    expect(c).not.toBeNull();
    if (!c) return;
    expect(c.proveedor_nombre).toBe("Repuestos SA");
    expect(c.marca).toBe("XCMG");
    expect(c.precio_unitario).toBe(1500.5);
    expect(c.cantidad).toBe(4);
    expect(c.costo_envio).toBe(800);
    expect(c.descuento).toBe(0.1);
    expect(c.iva).toBe(0.21);
    expect(c.precio_hasta).toBe("2026-08-31");
    expect(c.plazo_pago_dias).toBe(30);
    expect(c.disponibilidad).toBe("4-7 días");
  });

  it("una fila sin proveedor ni precio no es un presupuesto", () => {
    const r = mapearEncabezados(ENCABEZADO);
    if (!r.ok) throw new Error("encabezado inválido");
    expect(parsearFila(["1850", "", "", "", "", ""], r.idx)).toBeNull();
  });
});

describe("fila para escribir en la planilla", () => {
  it("pone el N° de RI en la columna A y la fórmula del total con el envío", () => {
    const r = mapearEncabezados(ENCABEZADO);
    if (!r.ok) throw new Error("encabezado inválido");

    const fila = filaParaPlanilla({
      idx: r.idx,
      numeroFila: 7,
      nroRi: 1850,
      fecha: "2026-08-21",
      area: "Mantenimiento",
      descripcion: "Filtro de aceite",
      cotizacion: {
        proveedor_nombre: "Repuestos SA", marca: "XCMG", unidad_medida: "unidad",
        precio_unitario: 1500.5, cantidad: 4, costo_envio: 800,
        descuento: 0.1, iva: 0.21, precio_hasta: "2026-08-31",
        plazo_pago_dias: 30, condiciones_pago: "Transferencia",
        disponibilidad: "4-7 días", comentario: "",
      },
    });

    expect(fila).toHaveLength(19);
    expect(fila[0]).toBe("1850");
    expect(fila[4]).toBe("Repuestos SA");
    expect(fila[10]).toBe("10%");
    expect(fila[11]).toBe("21%");
    // El neto se nombra dos veces: el IVA multiplica y el descuento se resta
    // aparte, sin IVA encima. Las letras salen del encabezado: en esta version
    // K es DESCUENTO, L es IVA y J es ENVIO.
    expect(fila[12]).toBe("=H7*I7*(1+L7)-(H7*I7*K7)+J7");
    expect(fila[18]).toBe("FALSE");
  });

  /** Los mismos datos de arriba, para variar de a un campo por caso. */
  const cotizacionBase: CotizacionLeida = {
    proveedor_nombre: "Repuestos SA", marca: "XCMG", unidad_medida: "unidad",
    precio_unitario: 1500.5, cantidad: 4, costo_envio: 800,
    descuento: 0.1, iva: 0.21, precio_hasta: "2026-08-31",
    plazo_pago_dias: 30, condiciones_pago: "Transferencia",
    disponibilidad: "4-7 días", comentario: "",
  };

  const armar = (
    cotizacion: CotizacionLeida,
    extra: { moneda?: string | null; dolar?: number | null } = {}
  ) => {
    const r = mapearEncabezados(ENCABEZADO);
    if (!r.ok) throw new Error("encabezado inválido");
    return filaParaPlanilla({
      idx: r.idx, numeroFila: 7, nroRi: 1850, fecha: "2026-08-21",
      area: "Mantenimiento", descripcion: "Filtro de aceite", cotizacion, ...extra,
    });
  };

  /**
   * La cantidad multiplica, así que una celda vacía no es neutra: vale cero y
   * anula el total entero. `totalCotizacion` trata la cantidad ausente como 1
   * —es una cotizacion por monto total— y la formula tiene que decir lo mismo.
   *
   * Pasaba al reves: la app mostraba 1210 y la planilla escribia 0.
   */
  it("sin cantidad, la fórmula es el unitario solo y no lo multiplica por vacío", () => {
    const fila = armar({ ...cotizacionBase, precio_unitario: 1000, cantidad: null, costo_envio: null, descuento: null, iva: 0.21 });

    expect(fila[8]).toBe("");
    // El neto es H7 solo. El descuento y el envio siguen nombrados —no
    // multiplican— pero la I ya no aparece en ningun lado.
    expect(fila[12]).toBe("=H7*(1+L7)-(H7*K7)+J7");
    expect(fila[12]).not.toContain("I7");

    // Y da lo mismo que muestra la app: con K7 y J7 vacias, 1000*1,21 = 1210.
    expect(totalCotizacion({ precio_unitario: 1000, cantidad: null, descuento: null, iva: 0.21, costo_envio: null })).toBe(1210);
  });

  /**
   * El IVA, el descuento y el envio si se dejan referenciados aunque esten
   * vacios: no multiplican —son ×(1+0), −0 y +0— y asi la planilla recalcula
   * sola si despues alguien los completa.
   */
  it("el IVA, el descuento y el envío vacíos siguen nombrados: no anulan nada", () => {
    const fila = armar({ ...cotizacionBase, cantidad: 4, descuento: null, iva: null, costo_envio: null });
    expect(fila[12]).toBe("=H7*I7*(1+L7)-(H7*I7*K7)+J7");
  });

  /**
   * En dolares y sin cotizacion, `montoParaLaPlanilla` deja el unitario vacio
   * a proposito. La formula lo multiplicaba igual y daba 0 — que en una
   * comparativa donde gana el mas barato, gana siempre.
   */
  it("en dólares y sin cotización no escribe fórmula: un total en cero ganaría la comparativa", () => {
    const fila = armar(cotizacionBase, { moneda: "USD", dolar: null });

    expect(fila[7]).toBe("");
    expect(fila[9]).toBe("");
    expect(fila[12]).toBe("");
  });

  it("en dólares con cotización escribe todo, ya convertido a pesos", () => {
    const fila = armar({ ...cotizacionBase, precio_unitario: 100, cantidad: 2, costo_envio: 10 }, { moneda: "USD", dolar: 1500 });

    expect(fila[7]).toBe("150000");
    expect(fila[9]).toBe("15000");
    expect(fila[12]).toBe("=H7*I7*(1+L7)-(H7*I7*K7)+J7");
  });
});

describe("listas de la planilla", () => {
  it("los plazos de pago son los del desplegable", () => {
    expect(PLAZOS_PAGO).toEqual([0, 15, 21, 30, 45, 60, 90, 120, 150]);
  });

  it("la disponibilidad copia el desplegable tal cual, con su error de tipeo", () => {
    // "1-3 día" está en singular en la planilla. Corregirlo acá haría que la
    // validación de datos de Sheets rechace el valor al escribirlo.
    expect(DISPONIBILIDADES[1]).toBe("1-3 día");
  });
});

describe("diferencia contra el mas barato", () => {
  it("el mas barato no muestra diferencia", () => {
    expect(diferenciaPorcentual(6536.18, 6536.18)).toBeNull();
  });

  it("los demas se expresan como porcentaje de mas", () => {
    expect(diferenciaPorcentual(7602.4, 6536.18)).toBe("+16%");
    expect(diferenciaPorcentual(7743.6, 6536.18)).toBe("+18%");
  });

  it("sin un minimo con el que comparar, no hay diferencia", () => {
    expect(diferenciaPorcentual(1000, 0)).toBeNull();
    expect(diferenciaPorcentual(null, 6536.18)).toBeNull();
  });
});

describe("detalle de un presupuesto en una linea", () => {
  it("arma la cuenta que hay detras del total", () => {
    expect(detalleCotizacion({
      marca: "XCMG", precio_unitario: 1500.5, cantidad: 4,
      descuento: 0.1, iva: 0.21, costo_envio: null,
    })).toBe("XCMG · $ 1.500,50 × 4 · −10% · IVA 21%");
  });

  it("suma el envio cuando lo hay y omite el descuento cuando no", () => {
    expect(detalleCotizacion({
      marca: null, precio_unitario: 1290, cantidad: 4,
      descuento: 0, iva: 0.21, costo_envio: 1500,
    })).toBe("$ 1.290,00 × 4 · IVA 21% · + $ 1.500,00 de envío");
  });

  it("una cotizacion por monto total no muestra la multiplicacion", () => {
    expect(detalleCotizacion({
      marca: null, precio_unitario: 1000, cantidad: null,
      descuento: null, iva: 0, costo_envio: null,
    })).toBe("$ 1.000,00 · IVA 0%");
  });
});

describe("que deja el presupuesto elegido en el requerimiento", () => {
  it("el costo + IVA es el total sin el envio, que va en su propio campo", () => {
    // 6.243,60 de mercaderia + 1.500 de envio = 7.743,60 de total
    expect(costosParaElPedido({
      proveedor_id: "prov-1", precio_total: 7743.6, costo_envio: 1500,
    })).toEqual({ proveedor_id: "prov-1", costo_iva: 6243.6, costo_envio: 1500 });
  });

  it("sin envio, el costo + IVA es todo el total", () => {
    expect(costosParaElPedido({
      proveedor_id: "prov-2", precio_total: 6536.18, costo_envio: null,
    })).toEqual({ proveedor_id: "prov-2", costo_iva: 6536.18, costo_envio: 0 });
  });
});

/**
 * Los encabezados no son identicos entre planillas: el numero de RI aparece
 * como "NRO RI", "N° RI" o "N RI" segun quien la haya armado. Como la columna A
 * es el vinculo con el pedido, no reconocerla deja la planilla afuera entera.
 */
describe("variantes del encabezado", () => {
  const conNroRi = (titulo: string): string[] => [titulo, ...COLUMNAS_COMPARATIVA.slice(1)];

  it("reconoce el numero de RI escrito de varias formas", () => {
    for (const titulo of ["NRO RI", "N° RI", "Nº RI", "N RI", "N. RI", "NUMERO RI"]) {
      const r = mapearEncabezados(conNroRi(titulo));
      expect(r.ok, `no reconocio "${titulo}"`).toBe(true);
      if (r.ok) expect(r.idx.nro_ri).toBe(0);
    }
  });

  it("reconoce las variantes de cantidad y precio unitario", () => {
    const cabecera: string[] = [...COLUMNAS_COMPARATIVA];
    cabecera[7] = "PRECIO UNIT.";
    cabecera[8] = "CAN";
    const r = mapearEncabezados(cabecera);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.idx.precio_unitario).toBe(7);
    expect(r.idx.cantidad).toBe(8);
  });

  it("cuando falta algo, dice tambien que encabezados encontro", () => {
    const r = mapearEncabezados(["FECHA", "COSA"]);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.encontrados).toEqual(["FECHA", "COSA"]);
    // El nombre que falta se ofrece con sus variantes, para poder corregir la planilla.
    expect(r.faltan.join(" ")).toContain("N° RI");
  });
});

/**
 * `plazo_pago_dias` es la unica columna entera que sale de la planilla, y ahi
 * la gente escribe lo que quiere. Un decimal hacia fallar el INSERT entero con
 * "invalid input syntax for type integer", asi que una sola celda rara dejaba
 * sin adjuntar toda la comparativa.
 */
describe("el plazo de pago entra en una columna entera", () => {
  const idx = (() => {
    const r = mapearEncabezados([...COLUMNAS_COMPARATIVA]);
    if (!r.ok) throw new Error("encabezado invalido");
    return r.idx;
  })();

  const conPlazo = (valor: string) => {
    const fila = new Array(19).fill("");
    fila[0] = "1850";
    fila[4] = "Repuestos SA";
    fila[7] = "1000";
    fila[14] = valor;
    return parsearFila(fila, idx);
  };

  it("redondea un decimal en vez de romper el insert", () => {
    expect(conPlazo("30.6")?.plazo_pago_dias).toBe(31);
    expect(conPlazo("30,4")?.plazo_pago_dias).toBe(30);
  });

  it("un entero queda igual", () => {
    expect(conPlazo("30")?.plazo_pago_dias).toBe(30);
    expect(conPlazo("60 dias")?.plazo_pago_dias).toBe(60);
  });

  it("lo que no es un plazo de pago queda sin definir, no en cualquier cosa", () => {
    // "30/60" son dos opciones, no 3060 dias.
    expect(conPlazo("30/60")?.plazo_pago_dias).toBeNull();
    expect(conPlazo("contado")?.plazo_pago_dias).toBeNull();
    expect(conPlazo("")?.plazo_pago_dias).toBeNull();
    expect(conPlazo("-5")?.plazo_pago_dias).toBeNull();
  });
});

/**
 * La conversion a pesos de un presupuesto en dolares.
 *
 * Es donde esta la plata: si esto se equivoca, se elige el presupuesto
 * equivocado y nadie se entera hasta que llega la factura.
 */
describe("totalEnPesos", () => {
  const enPesos = { precio_total: 150000, moneda: "ARS", cotizacion: null };
  const enDolares = { precio_total: 1000, moneda: "USD", cotizacion: null };

  it("un presupuesto en pesos no se toca, aunque le pasen cotizacion", () => {
    expect(totalEnPesos(enPesos, 1535)).toBe(150000);
  });

  it("los presupuestos viejos, sin moneda, son pesos", () => {
    expect(totalEnPesos({ precio_total: 150000 }, 1535)).toBe(150000);
  });

  it("en dolares y sin congelar: usa el dolar del dia", () => {
    expect(totalEnPesos(enDolares, 1535)).toBe(1_535_000);
  });

  it("congelado: usa SU cotizacion, no la de hoy", () => {
    // Lo que se pago no cambia porque hoy el dolar este mas caro.
    const congelado = { precio_total: 1000, moneda: "USD", cotizacion: 1200 };
    expect(totalEnPesos(congelado, 1535)).toBe(1_200_000);
  });

  it("sin cotizacion no inventa un numero", () => {
    // Un cero se leeria como un presupuesto gratis y ganaria la comparacion.
    expect(totalEnPesos(enDolares, null)).toBeNull();
    expect(totalEnPesos(enDolares, 0)).toBeNull();
  });

  it("sin total no hay nada que convertir", () => {
    expect(totalEnPesos({ precio_total: null, moneda: "USD" }, 1535)).toBeNull();
  });

  it("redondea a centavos", () => {
    expect(totalEnPesos({ precio_total: 10.005, moneda: "USD" }, 1000)).toBe(10005);
  });
});

describe("faltaLaCotizacion", () => {
  it("a un presupuesto en pesos nunca le falta", () => {
    expect(faltaLaCotizacion({ moneda: "ARS" }, null)).toBe(false);
    expect(faltaLaCotizacion({}, null)).toBe(false);
  });

  it("en dolares, sin dolar del dia ni congelado, falta", () => {
    expect(faltaLaCotizacion({ moneda: "USD" }, null)).toBe(true);
  });

  it("congelado no le falta nada, aunque no haya dolar de hoy", () => {
    expect(faltaLaCotizacion({ moneda: "USD", cotizacion: 1200 }, null)).toBe(false);
  });
});

describe("costosParaElPedido con presupuestos en dolares", () => {
  it("un presupuesto en pesos no se toca", () => {
    const r = costosParaElPedido({
      proveedor_id: "p1", precio_total: 121000, costo_envio: 1000, moneda: "ARS", cotizacion: null,
    });
    expect(r).toEqual({ proveedor_id: "p1", costo_iva: 120000, costo_envio: 1000 });
  });

  it("uno en dolares viaja al pedido ya convertido", () => {
    // El requerimiento lleva pesos: es lo que suma el dashboard y lo que va a
    // la planilla.
    const r = costosParaElPedido({
      proveedor_id: "p1", precio_total: 1100, costo_envio: 100, moneda: "USD", cotizacion: 1000,
    });
    expect(r).toEqual({ proveedor_id: "p1", costo_iva: 1_000_000, costo_envio: 100_000 });
  });

  it("en dolares sin cotizacion congelada no inventa la conversion", () => {
    // No deberia pasar —se congela al elegir— pero si pasa, es preferible un
    // numero en dolares que uno en pesos calculado con una cotizacion inventada.
    const r = costosParaElPedido({
      proveedor_id: "p1", precio_total: 1100, costo_envio: 100, moneda: "USD", cotizacion: null,
    });
    expect(r.costo_iva).toBe(1000);
  });
});

/**
 * Al elegir el proveedor, el formulario completa solo lo que la base ya sabe de
 * el: en cuantos dias se le paga y como. Hoy 60 de 284 proveedores tienen el
 * plazo cargado y 109 la forma, asi que lo normal es que traiga poco o nada:
 * eso tiene que quedar vacio, no roto.
 */
describe("datosDePagoDe", () => {
  it("sin proveedor no completa nada", () => {
    expect(datosDePagoDe(null)).toEqual({ plazo: "", condiciones: "" });
  });

  it("un proveedor sin datos de pago no completa nada", () => {
    expect(datosDePagoDe({ plazo_pago_dias: null, forma_pago: null, condicion_pago: null }))
      .toEqual({ plazo: "", condiciones: "" });
  });

  it("trae el plazo como lo espera el desplegable", () => {
    expect(datosDePagoDe({ plazo_pago_dias: 30, forma_pago: null, condicion_pago: null }).plazo).toBe("30");
  });

  it("el contado son 0 dias, y 0 es un plazo de verdad", () => {
    expect(datosDePagoDe({ plazo_pago_dias: 0, forma_pago: null, condicion_pago: null }).plazo).toBe("0");
  });

  it("un plazo que el desplegable no ofrece se deja vacio", () => {
    // Elegirlo igual dejaria el select en blanco mostrando un valor que no
    // existe: se prefiere no completar y que la persona elija.
    expect(datosDePagoDe({ plazo_pago_dias: 40, forma_pago: null, condicion_pago: null }).plazo).toBe("");
  });

  it("junta la forma y la condicion", () => {
    expect(datosDePagoDe({ plazo_pago_dias: null, forma_pago: "ECHEQ", condicion_pago: "FF" }).condiciones)
      .toBe("ECHEQ · FF");
  });

  it("con una sola de las dos no deja el separador colgado", () => {
    expect(datosDePagoDe({ plazo_pago_dias: null, forma_pago: "CTA CTE", condicion_pago: null }).condiciones)
      .toBe("CTA CTE");
    expect(datosDePagoDe({ plazo_pago_dias: null, forma_pago: null, condicion_pago: "ANTICIPADO" }).condiciones)
      .toBe("ANTICIPADO");
  });

  it("un campo con espacios nada mas cuenta como vacio", () => {
    expect(datosDePagoDe({ plazo_pago_dias: null, forma_pago: "  ", condicion_pago: "FF" }).condiciones).toBe("FF");
  });
});

/**
 * Cambiar de proveedor recompleta los campos, pero lo que escribio una persona
 * no se pisa: si alguien acordo condiciones distintas para esta compra, esas
 * mandan.
 */
describe("alCambiarDeProveedor", () => {
  it("un campo vacio se completa", () => {
    expect(alCambiarDeProveedor("", "", "30")).toBe("30");
  });

  it("lo que puso el autocompletado anterior se reemplaza", () => {
    expect(alCambiarDeProveedor("30", "30", "60")).toBe("60");
  });

  it("lo que escribio una persona se respeta", () => {
    expect(alCambiarDeProveedor("45", "30", "60")).toBe("45");
  });

  it("si el proveedor nuevo no tiene el dato, el campo se vacia igual", () => {
    // Dejar el plazo del proveedor anterior seria peor: diria que este cobra a
    // 30 dias cuando no lo sabemos.
    expect(alCambiarDeProveedor("30", "30", "")).toBe("");
  });

  it("un campo que alguien vacio a proposito se vuelve a completar", () => {
    expect(alCambiarDeProveedor("", "30", "60")).toBe("60");
  });
});
