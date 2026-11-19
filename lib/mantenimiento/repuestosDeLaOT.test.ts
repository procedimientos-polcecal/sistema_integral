import { describe, it, expect } from "vitest";
import {
  lineasQueValen, textoParaLaPlanilla, filasParaLaBase, repuestosDelCuerpo,
  lineasDesdeElCuerpo, lineasDesdeLasFilas, elReemplazoDelCuerpo, loQueCambiaDeLaLista,
} from "@/lib/mantenimiento/repuestosDeLaOT";
import { itemsDeRepuesto } from "@/lib/mantenimiento/repuestosDesdeOt";

describe("lineasQueValen", () => {
  it("tira el renglón vacío, que es el que queda al apretar 'agregar' de más", () => {
    expect(lineasQueValen([
      { cantidad: "2", nombre: "grillas 2 mm" },
      { cantidad: "", nombre: "" },
      { cantidad: "4", nombre: "   " },
    ])).toEqual([{ cantidad: "2", nombre: "grillas 2 mm" }]);
  });

  it("deja pasar el renglón sin cantidad: no saberla no es no haberlo usado", () => {
    expect(lineasQueValen([{ cantidad: "", nombre: "periflex" }]))
      .toEqual([{ cantidad: "", nombre: "periflex" }]);
  });

  it("cambia por un espacio la coma y el punto y coma del nombre", () => {
    // El `;` separa los renglones en el texto de la planilla y la `,` también
    // corta al volver a leerlo: cualquiera de los dos adentro de un nombre
    // partiría ese renglón en dos.
    expect(lineasQueValen([{ cantidad: "1", nombre: "rodamiento 22216, EK" }]))
      .toEqual([{ cantidad: "1", nombre: "rodamiento 22216 EK" }]);
    expect(lineasQueValen([{ cantidad: "1", nombre: "rodamiento 22216; EK" }]))
      .toEqual([{ cantidad: "1", nombre: "rodamiento 22216 EK" }]);
  });

  it("aguanta que no venga nada", () => {
    expect(lineasQueValen(undefined)).toEqual([]);
    expect(lineasQueValen(null)).toEqual([]);
    expect(lineasQueValen([])).toEqual([]);
  });
});

describe("textoParaLaPlanilla", () => {
  it("separa los renglones con punto y coma", () => {
    // Pedido el 21/10/2026: en la celda de la planilla un `;` se ve de lejos y
    // una coma no, porque adentro de un repuesto ya hay comas.
    expect(textoParaLaPlanilla([
      { cantidad: "2", nombre: "grillas 2 mm" },
      { cantidad: "4", nombre: "martillos" },
    ])).toBe("2 grillas 2 mm; 4 martillos");
  });

  it("con un solo renglón no pone separador", () => {
    expect(textoParaLaPlanilla([{ cantidad: "2", nombre: "grillas 2 mm" }]))
      .toBe("2 grillas 2 mm");
  });

  it("sin cantidad escribe sólo el nombre, sin el espacio de más", () => {
    expect(textoParaLaPlanilla([{ cantidad: "", nombre: "periflex" }])).toBe("periflex");
  });

  it("sin renglones devuelve null y no una cadena vacía", () => {
    // En la planilla se ven igual; en la base no, y `repuesto` es null cuando
    // no se usó nada.
    expect(textoParaLaPlanilla([])).toBeNull();
    expect(textoParaLaPlanilla([{ cantidad: "3", nombre: "" }])).toBeNull();
  });
});

describe("el texto que escribimos lo tiene que poder leer el parseo que ya existe", () => {
  /*
   * Es la vara de verdad de este archivo. `itemsDeRepuesto()` es el que sacó
   * los repuestos de las 275 OT viejas; si lo que escribimos hoy no cae del
   * mismo lado, el día que alguien vuelva a correr ese extractor las OT nuevas
   * van a leerse peor que las que cargó la gente a mano.
   */
  it("dos renglones vuelven a ser dos items, con su tipo y su cantidad", () => {
    const texto = textoParaLaPlanilla([
      { cantidad: "2", nombre: "grillas de 2mm" },
      { cantidad: "4", nombre: "martillos" },
    ])!;
    expect(itemsDeRepuesto(texto)).toEqual([
      expect.objectContaining({ tipo: "grilla", codigo: "2MM", cantidad: 2 }),
      expect.objectContaining({ tipo: "martillo", cantidad: 4 }),
    ]);
  });

  it("un rodamiento con su manguito sobrevive la vuelta completa", () => {
    const texto = textoParaLaPlanilla([
      { cantidad: "2", nombre: "rodamientos 22212" },
      { cantidad: "2", nombre: "manguitos H312" },
    ])!;
    expect(texto).toBe("2 rodamientos 22212; 2 manguitos H312");
    expect(itemsDeRepuesto(texto).map((i) => `${i.tipo} ${i.codigo}`))
      .toEqual(["rodamiento 22212", "manguito H312"]);
  });

  it("y la coma del nombre, que sin limpiar partiría el renglón en dos", () => {
    const texto = textoParaLaPlanilla([{ cantidad: "2", nombre: "rodamientos 22216, EK" }])!;
    expect(itemsDeRepuesto(texto)).toHaveLength(1);
    expect(itemsDeRepuesto(texto)[0]).toMatchObject({ tipo: "rodamiento", codigo: "22216 EK" });
  });

  it("tres renglones separados por `;` vuelven a ser tres items", () => {
    // La vuelta completa del separador nuevo: si `partirRepuesto` no cortara
    // por `;`, esto daría un solo item y las OT nuevas se leerían peor que las
    // que cargó la gente a mano.
    const texto = textoParaLaPlanilla([
      { cantidad: "2", nombre: "rodamientos 22212" },
      { cantidad: "2", nombre: "manguitos H312" },
      { cantidad: "1", nombre: "correa SPB 2000" },
    ])!;
    expect(texto).toBe("2 rodamientos 22212; 2 manguitos H312; 1 correa SPB 2000");
    expect(itemsDeRepuesto(texto).map((i) => `${i.tipo} ${i.codigo}`))
      // El código de la correa sale normalizado —"SPB-2000"—, que es lo que
      // ese parseo viene haciendo con las 277 OT viejas.
      .toEqual(["rodamiento 22212", "manguito H312", "correa SPB-2000"]);
  });
});

describe("filasParaLaBase", () => {
  it("arma una fila por renglón, con el código vacío", () => {
    expect(filasParaLaBase("ot-1", [
      { cantidad: "2", nombre: "grillas 2 mm" },
      { cantidad: "", nombre: "periflex" },
    ])).toEqual([
      { work_order_id: "ot-1", nombre: "grillas 2 mm", codigo: null, cantidad: "2" },
      { work_order_id: "ot-1", nombre: "periflex", codigo: null, cantidad: null },
    ]);
  });

  it("sin renglones no arma ninguna fila", () => {
    expect(filasParaLaBase("ot-1", [])).toEqual([]);
  });
});

describe("repuestosDelCuerpo", () => {
  it("con renglones, arma el texto y las filas", () => {
    const r = repuestosDelCuerpo({ repuestos: [
      { cantidad: "2", nombre: "grillas 2 mm" },
      { cantidad: "4", nombre: "martillos" },
    ] });
    expect(r.texto).toBe("2 grillas 2 mm; 4 martillos");
    expect(r.lineas).toHaveLength(2);
  });

  it("con el campo viejo de texto suelto, lo respeta", () => {
    // La carga sin señal manda el cuerpo que armó días atrás: un teléfono sin
    // actualizar sigue mandando `repuesto`. Ignorarlo le borraría el repuesto
    // a esa OT sin que nadie se entere.
    const r = repuestosDelCuerpo({ repuesto: "  2 grillas 2 mm  " });
    expect(r.texto).toBe("2 grillas 2 mm");
    expect(r.lineas).toEqual([]);
  });

  it("los renglones ganan si vienen los dos", () => {
    const r = repuestosDelCuerpo({ repuesto: "lo viejo", repuestos: [{ cantidad: "1", nombre: "lo nuevo" }] });
    expect(r.texto).toBe("1 lo nuevo");
  });

  it("sin ninguno de los dos, null", () => {
    expect(repuestosDelCuerpo({})).toEqual({ texto: null, lineas: [] });
    expect(repuestosDelCuerpo({ repuesto: "   " })).toEqual({ texto: null, lineas: [] });
  });

  it("una lista vacía es 'no se usó nada' y no el texto viejo", () => {
    expect(repuestosDelCuerpo({ repuesto: "lo viejo", repuestos: [] }).texto).toBeNull();
  });
});

describe("lineasDesdeElCuerpo", () => {
  it("recupera los renglones de una carga parada", () => {
    expect(lineasDesdeElCuerpo({ repuestos: [{ cantidad: "2", nombre: "grillas 2 mm" }] }))
      .toEqual([{ cantidad: "2", nombre: "grillas 2 mm" }]);
  });

  it("recupera el texto suelto de una carga parada hace dos semanas", () => {
    // La cola guarda el cuerpo tal como se armó: un teléfono que no se
    // actualizó dejó parada una OT con `repuesto` de texto. Recuperarla vacía
    // obligaría a cargar los repuestos de nuevo sin decir por qué.
    expect(lineasDesdeElCuerpo({ repuesto: "2 grillas 2 mm" }))
      .toEqual([{ cantidad: "", nombre: "2 grillas 2 mm" }]);
  });

  it("siempre deja un renglón donde escribir", () => {
    expect(lineasDesdeElCuerpo(null)).toEqual([{ cantidad: "", nombre: "" }]);
    expect(lineasDesdeElCuerpo({})).toEqual([{ cantidad: "", nombre: "" }]);
    expect(lineasDesdeElCuerpo({ repuestos: [] })).toEqual([{ cantidad: "", nombre: "" }]);
    expect(lineasDesdeElCuerpo({ repuesto: "   " })).toEqual([{ cantidad: "", nombre: "" }]);
    expect(lineasDesdeElCuerpo({ repuestos: [{ cantidad: "3", nombre: "" }] }))
      .toEqual([{ cantidad: "", nombre: "" }]);
  });
});

/**
 * EL CODIGO DEL INVENTARIO, desde el 26/10/2026. El alta ahora busca contra el
 * inventario igual que el modal de "Repuestos que hacen falta", asi que el
 * renglon puede traer el codigo de la fila que la persona eligio.
 *
 * Hasta ese dia `filasParaLaBase` escribia `null` fijo, y el motivo —«un codigo
 * inventado es peor que un codigo vacio»— seguia siendo bueno: lo que cambio es
 * que ya no lo inventa nadie.
 */
describe("el codigo del inventario en el renglon", () => {
  it("viaja a la base cuando salio de la busqueda", () => {
    expect(filasParaLaBase("ot-1", [
      { cantidad: "2", nombre: "Rodamiento 6206", codigo: "RD-6206" },
    ])).toEqual([
      { work_order_id: "ot-1", nombre: "Rodamiento 6206", codigo: "RD-6206", cantidad: "2" },
    ]);
  });

  /** Lo escrito a mano sigue yendo en null, como estaba todo hasta ese dia. */
  it("lo escrito a mano sigue sin codigo", () => {
    expect(filasParaLaBase("ot-1", [{ cantidad: "1", nombre: "Correa B-75" }]))
      .toEqual([{ work_order_id: "ot-1", nombre: "Correa B-75", codigo: null, cantidad: "1" }]);
    expect(filasParaLaBase("ot-1", [{ cantidad: "1", nombre: "Correa", codigo: "   " }])[0].codigo)
      .toBeNull();
  });

  /**
   * LA CELDA DE LA PLANILLA NO CAMBIA. Su vara no es "que se entienda" sino que
   * `itemsDeRepuesto()` la pueda volver a leer, y ese parseo saca los repuestos
   * de las 277 OT viejas. Meterle el codigo ahi cambiaria lo que vuelve a
   * entrar por la sincronizacion.
   */
  it("el codigo no se cuela en el texto de la planilla", () => {
    expect(textoParaLaPlanilla([
      { cantidad: "2", nombre: "Rodamiento 6206", codigo: "RD-6206" },
    ])).toBe("2 Rodamiento 6206");
  });

  /** Una carga parada que ya tenia codigo lo recupera, no lo pierde. */
  it("una carga parada recupera su codigo", () => {
    expect(lineasDesdeElCuerpo({
      repuestos: [{ cantidad: "2", nombre: "Rodamiento 6206", codigo: "RD-6206" }],
    })).toEqual([{ cantidad: "2", nombre: "Rodamiento 6206", codigo: "RD-6206" }]);
  });

  /**
   * Y sin codigo la clave NO esta, en vez de estar vacia. Es la misma
   * distincion que `filasParaLaBase` lleva a `null`, y es lo que deja intactos
   * los renglones de todo lo que ya existia.
   */
  it("sin codigo la clave no esta", () => {
    expect(lineasQueValen([{ cantidad: "1", nombre: "Correa" }]))
      .toEqual([{ cantidad: "1", nombre: "Correa" }]);
    expect(lineasQueValen([{ cantidad: "1", nombre: "Correa", codigo: "  " }]))
      .toEqual([{ cantidad: "1", nombre: "Correa" }]);
  });
});

describe("lineasDesdeLasFilas", () => {
  it("un null de la base llega como campo vacio y no como el texto 'null'", () => {
    expect(lineasDesdeLasFilas([
      { id: "r1", nombre: "periflex", codigo: null, cantidad: null },
    ])).toEqual([{ id: "r1", cantidad: "", nombre: "periflex" }]);
  });

  it("conserva el codigo, que es el enlace al panol", () => {
    expect(lineasDesdeLasFilas([
      { id: "r1", nombre: "CAJA DE RODAMIENTO UPC 213", codigo: "00185", cantidad: "2" },
    ])).toEqual([
      { id: "r1", cantidad: "2", nombre: "CAJA DE RODAMIENTO UPC 213", codigo: "00185" },
    ]);
  });

  it("una OT sin repuestos abre con un renglon en blanco: sin donde escribir no se completa", () => {
    expect(lineasDesdeLasFilas([])).toEqual([{ cantidad: "", nombre: "" }]);
    expect(lineasDesdeLasFilas(null)).toEqual([{ cantidad: "", nombre: "" }]);
  });
});

describe("elReemplazoDelCuerpo", () => {
  it("sin la clave `repuestos` no reemplaza: un cuerpo incompleto borraria la lista entera", () => {
    const falta = { ok: false, error: "Falta la lista de repuestos" };
    expect(elReemplazoDelCuerpo({})).toEqual(falta);
    expect(elReemplazoDelCuerpo(null)).toEqual(falta);
    expect(elReemplazoDelCuerpo({ repuestos: "2 grillas" })).toEqual(falta);
  });

  it("una lista vacia si reemplaza: sacar todos los renglones es «no se uso ninguno»", () => {
    expect(elReemplazoDelCuerpo({ repuestos: [] })).toEqual({ ok: true, lineas: [] });
  });

  it("limpia los renglones con la misma regla que el alta, y conserva el id", () => {
    expect(elReemplazoDelCuerpo({ repuestos: [
      { id: "r1", cantidad: "2", nombre: "rodamiento 22216, EK", codigo: "00185" },
      { cantidad: "", nombre: "   " },
    ] })).toEqual({
      ok: true,
      lineas: [{ id: "r1", cantidad: "2", nombre: "rodamiento 22216 EK", codigo: "00185" }],
    });
  });
});

describe("loQueCambiaDeLaLista", () => {
  const existentes = [
    { id: "r1", nombre: "periflex" },
    { id: "r2", nombre: "rodamiento 6206" },
  ];

  it("un renglon sin id se inserta", () => {
    expect(loQueCambiaDeLaLista([], [{ cantidad: "2", nombre: "grillas 2 mm" }]))
      .toEqual({
        insertar: [{ cantidad: "2", nombre: "grillas 2 mm" }],
        actualizar: [],
        borrar: [],
      });
  });

  /**
   * El renglon que no cambio de nombre NO se borra, y esto es lo caro de la
   * tarea: `mant_ri_de_repuesto.repuesto_id` es `on delete cascade` —los RI
   * pegados a ese renglon mueren— y `ordenes_trabajo_notas.repuesto_id` es
   * `on delete set null` —la pregunta a Compras se suelta y deja de estar
   * abierta—. Un reemplazo a lo bruto se los lleva sin un solo error.
   */
  it("un renglon que conserva el nombre se actualiza en su lugar", () => {
    expect(loQueCambiaDeLaLista(existentes, [
      { id: "r1", cantidad: "3", nombre: "periflex", codigo: "00185" },
      { id: "r2", cantidad: "", nombre: "rodamiento 6206" },
    ])).toEqual({
      insertar: [],
      actualizar: [
        { id: "r1", cantidad: "3", codigo: "00185" },
        { id: "r2", cantidad: null, codigo: null },
      ],
      borrar: [],
    });
  });

  it("cambiar solo mayusculas o espacios no es otro repuesto", () => {
    expect(loQueCambiaDeLaLista(existentes, [
      { id: "r1", cantidad: "1", nombre: "  PERIFLEX " },
      { id: "r2", cantidad: "", nombre: "rodamiento 6206" },
    ]).insertar).toEqual([]);
  });

  /**
   * Y un renglon cuyo nombre cambio SI se borra y se inserta: un RI pegado a
   * «rodamiento 6206» no vale para «6207», y heredar el enlace es «enlazar al
   * que se le parece», que es peor que dejarlo en null.
   */
  it("un renglon cuyo nombre cambio se borra y se inserta de nuevo", () => {
    expect(loQueCambiaDeLaLista(existentes, [
      { id: "r1", cantidad: "", nombre: "periflex" },
      { id: "r2", cantidad: "1", nombre: "rodamiento 6207" },
    ])).toEqual({
      insertar: [{ id: "r2", cantidad: "1", nombre: "rodamiento 6207" }],
      actualizar: [{ id: "r1", cantidad: null, codigo: null }],
      borrar: ["r2"],
    });
  });

  it("el id que ya no esta en la lista se borra: sacarlo tiene que poder sacarlo", () => {
    expect(loQueCambiaDeLaLista(existentes, [{ id: "r1", cantidad: "", nombre: "periflex" }]))
      .toEqual({
        insertar: [],
        actualizar: [{ id: "r1", cantidad: null, codigo: null }],
        borrar: ["r2"],
      });
  });

  it("un id que la base ya no tiene se inserta en vez de perderse", () => {
    // Dos personas en la misma OT: la otra saco el renglon mientras este modal
    // estaba abierto. Lo que se escribio no se tira.
    expect(loQueCambiaDeLaLista([], [{ id: "r9", cantidad: "1", nombre: "correa B-75" }]))
      .toEqual({
        insertar: [{ id: "r9", cantidad: "1", nombre: "correa B-75" }],
        actualizar: [],
        borrar: [],
      });
  });
});
