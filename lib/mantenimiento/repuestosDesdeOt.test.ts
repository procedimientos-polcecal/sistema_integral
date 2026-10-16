/**
 * Los casos son textos de verdad, sacados de las 275 OT que tienen cargada la
 * columna `repuesto`. No hay ninguno inventado: la gracia del parseo es que
 * aguante cómo escribe la gente, no cómo uno supone que escribiría.
 */
import { describe, it, expect } from "vitest";
import {
  esSoloImporte,
  partirRepuesto,
  itemsDeRepuesto,
  repuestosPorEquipo,
  notaDeFicha,
  claveDeItem,
  piezasDeLaDescripcion,
  piezasPorEquipo,
  nombraAlEquipo,
} from "@/lib/mantenimiento/repuestosDesdeOt";

describe("esSoloImporte", () => {
  it("descarta el importe pelado, que es la mitad de lo que hay en las cintas", () => {
    for (const t of ["$280,000", "970000", "$52684.76", "($17255)", "$990,000"]) {
      expect(esSoloImporte(t)).toBe(true);
    }
  });

  it("descarta lo que arranca diciendo que es un costo", () => {
    expect(esSoloImporte("Costo de materiales utilizados $52684.76")).toBe(true);
    expect(esSoloImporte("Costo en materiales ($17255)")).toBe(true);
  });

  it("no descarta una pieza que además trae el precio", () => {
    expect(esSoloImporte("Parche de 200x200 ($190000)")).toBe(false);
    expect(esSoloImporte("empalme ($380000)")).toBe(false);
  });
});

describe("partirRepuesto", () => {
  it("parte por coma y por 'y'", () => {
    expect(partirRepuesto("1 rodamiento 22216, 1 manguito, 4 brazitos y 4 martillos")).toEqual([
      "1 rodamiento 22216",
      "1 manguito",
      "4 brazitos",
      "4 martillos",
    ]);
  });

  it("parte por guión cuando de los dos lados hay una pieza", () => {
    expect(partirRepuesto("Rodamiento 22217 EK - Manguito H317")).toEqual([
      "Rodamiento 22217 EK",
      "Manguito H317",
    ]);
    expect(partirRepuesto("Guardamotor 5.5 kW - Contactor 5.5 kW")).toEqual([
      "Guardamotor 5.5 kW",
      "Contactor 5.5 kW",
    ]);
  });

  it("NO parte por guión cuando del otro lado hay una medida", () => {
    // Cortar acá perdería los 50 litros y los 400 mm.
    expect(partirRepuesto("Aceite SAE 320 - 50 litros")).toEqual(["Aceite SAE 320 - 50 litros"]);
    expect(partirRepuesto('Chapa 1/2" -  1500 mm x 400 mm')).toEqual(['Chapa 1/2" -  1500 mm x 400 mm']);
  });
});

describe("itemsDeRepuesto", () => {
  it("lee el caso más común: pieza con cantidad y código", () => {
    expect(itemsDeRepuesto("2 rodamientos 22212 y 2 manguitos h312")).toEqual([
      expect.objectContaining({ tipo: "rodamiento", codigo: "22212", cantidad: 2, confianza: "alta" }),
      expect.objectContaining({ tipo: "manguito", codigo: "H312", cantidad: 2, confianza: "alta" }),
    ]);
  });

  it("junta las tres formas de escribir la misma correa", () => {
    const claves = ["3 correas B-86", "3 correas b-86", "2 Correas B 91"]
      .flatMap((t) => itemsDeRepuesto(t))
      .map(claveDeItem);
    expect(claves[0]).toBe(claves[1]);
    expect(claves[0]).toBe("correa|B-86");
    expect(claves[2]).toBe("correa|B-91");
  });

  it("NO junta el rodamiento con su variante EK, que es otra pieza", () => {
    const a = claveDeItem(itemsDeRepuesto("1 rodamiento 22216")[0]);
    const b = claveDeItem(itemsDeRepuesto("2 rodamientos 22216 EK")[0]);
    expect(a).toBe("rodamiento|22216");
    expect(b).toBe("rodamiento|22216 EK");
    expect(a).not.toBe(b);
  });

  it("hereda el sustantivo cuando el segundo renglón lo da por sobreentendido", () => {
    // "30 grillas de 2mm y 10 de 4mm": las diez son grillas aunque no lo diga.
    expect(itemsDeRepuesto("30 grillas de 2mm y 10 de 4mm")).toEqual([
      expect.objectContaining({ tipo: "grilla", codigo: "2MM", cantidad: 30 }),
      expect.objectContaining({ tipo: "grilla", codigo: "4MM", cantidad: 10 }),
    ]);
    expect(itemsDeRepuesto("25 grillas 2mm y 15 de 4mm")).toHaveLength(2);
  });

  it("escribe igual la grilla con y sin espacio antes del mm", () => {
    const con = claveDeItem(itemsDeRepuesto("3 grillas de 2 mm")[0]);
    const sin = claveDeItem(itemsDeRepuesto("3 grillas de 2mm")[0]);
    expect(con).toBe(sin);
    expect(con).toBe("grilla|2MM");
  });

  it("no confunde la medida con la cantidad", () => {
    // "4 grillas de 2mm" son cuatro grillas, no dos.
    const [g] = itemsDeRepuesto("4 grillas de 2mm");
    expect(g.cantidad).toBe(4);
    expect(g.codigo).toBe("2MM");
  });

  it("entiende el número escrito con letras", () => {
    expect(itemsDeRepuesto("Dos rodamientos 32222 y un rodamiento 22320.")).toEqual([
      expect.objectContaining({ tipo: "rodamiento", codigo: "32222", cantidad: 2 }),
      expect.objectContaining({ tipo: "rodamiento", codigo: "22320", cantidad: 1 }),
    ]);
  });

  it("saca el verbo con el que arranca media planilla", () => {
    expect(itemsDeRepuesto("cambio de 16 grillas de 4mm")).toEqual([
      expect.objectContaining({ tipo: "grilla", codigo: "4MM", cantidad: 16 }),
    ]);
    expect(itemsDeRepuesto("Cambio de placa de cierre N°3005")).toEqual([
      expect.objectContaining({ tipo: "placa", codigo: "3005" }),
    ]);
  });

  it("lee la lista larga de un cambio de rotor entero", () => {
    const items = itemsDeRepuesto(
      "Cambio de rotor, 90 grillas de 4mm, 4 martillos, 4 brazos, 2 rodamientos 22216 y 2 manguitos h316"
    );
    expect(items.map((i) => i.tipo)).toEqual([
      "rotor", "grilla", "martillo", "brazo", "rodamiento", "manguito",
    ]);
    expect(items[1].cantidad).toBe(90);
    expect(items[4].codigo).toBe("22216");
  });

  it("normaliza las tres formas de decir brazo", () => {
    for (const t of ["4 brazos", "4 brazitos", "4 bracitos"]) {
      expect(itemsDeRepuesto(t)[0].tipo).toBe("brazo");
    }
  });

  it("entiende las abreviaturas con punto de la planilla", () => {
    expect(itemsDeRepuesto("2 rod. 22212, 2 mang. h312, 1 caja 512")).toEqual([
      expect.objectContaining({ tipo: "rodamiento", codigo: "22212" }),
      expect.objectContaining({ tipo: "manguito", codigo: "H312" }),
      expect.objectContaining({ tipo: "caja de rodamiento", codigo: "512" }),
    ]);
  });

  it("se queda con la marca pegada al número", () => {
    expect(itemsDeRepuesto("Caja SNL 513")[0].codigo).toBe("SNL 513");
    expect(itemsDeRepuesto("1 Rodamiento MRC 5308")[0].codigo).toBe("MRC 5308");
    expect(itemsDeRepuesto("Aceite SAE 320 - 50 litros")[0]).toMatchObject({
      tipo: "aceite", codigo: "SAE 320", cantidad: 50, unidad: "l",
    });
  });

  it("lee la cantidad medida y no contada", () => {
    expect(itemsDeRepuesto("980kg cuerpos moledores")[0]).toMatchObject({
      tipo: "cuerpos moledores", cantidad: 980, unidad: "kg",
    });
    expect(itemsDeRepuesto("40 Litros Aceite 320")[0]).toMatchObject({
      tipo: "aceite", cantidad: 40, unidad: "l",
    });
  });

  it("guarda el requerimiento interno aparte", () => {
    expect(itemsDeRepuesto("Paño de zaranda según especificaciones (RI 258)")[0]).toMatchObject({
      tipo: "paño", ri: "RI 258",
    });
    expect(itemsDeRepuesto("Rodamiento 22218 (RI 332)")[0]).toMatchObject({
      tipo: "rodamiento", codigo: "22218", ri: "RI 332",
    });
  });

  it("tira el importe pero se queda con la pieza", () => {
    expect(itemsDeRepuesto("Parche de 200x200 ($190000)")[0]).toMatchObject({
      tipo: "parche", codigo: "200X200",
    });
    expect(itemsDeRepuesto("2 parches de 400x200 ($380000)")[0]).toMatchObject({
      tipo: "parche", codigo: "400X200", cantidad: 2,
    });
  });

  it("no devuelve nada cuando el texto era sólo el precio", () => {
    expect(itemsDeRepuesto("$480,000")).toEqual([]);
    expect(itemsDeRepuesto("Costo en materiales ($17255)")).toEqual([]);
    expect(itemsDeRepuesto("-")).toEqual([]);
    expect(itemsDeRepuesto("")).toEqual([]);
  });

  it("infiere la correa del código suelto, pero lo deja marcado", () => {
    // "2 B-58" y "2 C-77" son correas en V y no hay otra cosa que se escriba
    // así; igual el tipo lo estamos poniendo nosotros, así que se revisa.
    expect(itemsDeRepuesto("2 B-58")[0]).toMatchObject({
      tipo: "correa", codigo: "B-58", cantidad: 2, confianza: "revisar",
    });
    expect(itemsDeRepuesto("b-58")[0]).toMatchObject({ tipo: "correa", confianza: "revisar" });
  });

  it("deja sin tipo lo que no se reconoce, en vez de adivinar", () => {
    // "2306" sobre un vibrador es casi seguro un rodamiento, y por eso mismo
    // no se pone: el que lo lea va a querer saber que nadie lo escribió.
    expect(itemsDeRepuesto("2306")[0]).toMatchObject({ tipo: null, codigo: "2306", confianza: "revisar" });
  });

  it("marca para revisar la crónica del trabajo metida en la columna", () => {
    const items = itemsDeRepuesto(
      "Se limpia camara de soplado, se cambian 7 mangas rotas, se limpian 5 mangas llenas y se cambian 4 picos de soplado"
    );
    const mangas = items.filter((i) => i.tipo === "manga");
    expect(mangas).toHaveLength(2);
    // Las cinco que se limpiaron no son un repuesto consumido.
    expect(mangas.some((m) => m.confianza === "revisar")).toBe(true);
  });

  it("manda a la nota la especificación larga, que no es un código", () => {
    const [celda] = itemsDeRepuesto(
      "Celda de carga ZELL Modelo TSA 100kg Sensibilidad (2.99mV/V) N° serie 21D316461"
    );
    expect(celda.tipo).toBe("celda de carga");
    expect(celda.codigo).toBeNull();
    expect(celda.nota).toContain("ZELL");
  });

  it("escribe la correa siempre igual, aunque la planilla la escriba de tres formas", () => {
    // El ventilador 6 tiene "B-86", "b-86" y "3 correas B 86": si no se
    // canoniza, su ficha muestra tres repuestos donde hay uno.
    const claves = ["4 Correas C 136", "3 correas c-136", "2 correas c136"].map(
      (t) => claveDeItem(itemsDeRepuesto(t)[0])
    );
    expect(new Set(claves).size).toBe(1);
    expect(claves[0]).toBe("correa|C-136");
  });

  it("no hereda el sustantivo cuando lo que sigue es la medida del anterior", () => {
    // "paso 1\"" es el paso del piñón y la corona, no una corona más.
    const items = itemsDeRepuesto('Cambio de piñon y corona, paso 1"');
    expect(items.map((i) => i.tipo)).toEqual(["piñón", "corona"]);
  });

  it("no repite en la nota lo que ya dice el tipo", () => {
    const [celda] = itemsDeRepuesto("Celda de carga ZELL Modelo TSA 100kg");
    expect(celda.tipo).toBe("celda de carga");
    expect(celda.nota).not.toContain("carga");
  });

  it("aguanta las pulgadas y las fracciones de la ferretería", () => {
    const items = itemsDeRepuesto('8 bulones 3/8 x 2" c/tuerca y arandela');
    expect(items[0]).toMatchObject({ tipo: "bulón", cantidad: 8 });
    expect(items[0].codigo).toContain("3/8");
    expect(items.at(-1)?.tipo).toBe("arandela");
  });
});

describe("repuestosPorEquipo", () => {
  const ots = [
    { ot_number: 2261, fecha: "2026-08-07", equipment_id: "vent6", repuesto: "3 correas B-86" },
    { ot_number: 2615, fecha: "2026-09-30", equipment_id: "vent6", repuesto: "3 correas B-86" },
    { ot_number: 2774, fecha: "2026-10-10", equipment_id: "vent6", repuesto: "3 correas b-86" },
    { ot_number: 2481, fecha: "2026-09-14", equipment_id: "vent6", repuesto: "2 rodamientos 22212 y 2 manguitos h312" },
    { ot_number: 2417, fecha: "2026-09-01", equipment_id: "cinta1", repuesto: "$320,000" },
    { ot_number: 999, fecha: "2026-01-01", equipment_id: null, repuesto: "2 rodamientos 22211" },
  ];

  it("junta las tres correas iguales en un repuesto y suma el consumo", () => {
    const porEquipo = repuestosPorEquipo(ots);
    const correa = porEquipo.get("vent6")!.find((r) => r.tipo === "correa")!;
    expect(correa.codigo).toBe("B-86");
    expect(correa.ots).toEqual([2261, 2615, 2774]);
    expect(correa.total).toBe(9);
    expect(correa.ultimaFecha).toBe("2026-10-10");
  });

  it("ordena por cuántas OT lo nombran, que es la única criticidad que hay", () => {
    const lista = repuestosPorEquipo(ots).get("vent6")!;
    expect(lista[0].codigo).toBe("B-86");
    expect(lista).toHaveLength(3);
  });

  it("no inventa un equipo para la OT que no lo tiene enlazado", () => {
    expect(repuestosPorEquipo(ots).has("null")).toBe(false);
    expect([...repuestosPorEquipo(ots).keys()]).toEqual(["vent6"]);
  });

  it("deja el total en null si alguna vez no vino la cantidad", () => {
    const lista = repuestosPorEquipo([
      { ot_number: 1, fecha: "2026-01-01", equipment_id: "m1", repuesto: "2 grillas de 4mm" },
      { ot_number: 2, fecha: "2026-02-01", equipment_id: "m1", repuesto: "grillas de 4mm" },
    ]).get("m1")!;
    expect(lista[0].ots).toEqual([1, 2]);
    expect(lista[0].total).toBeNull();
  });
});

describe("piezasDeLaDescripcion", () => {
  it("separa lo que se cambió de lo que sólo se miró", () => {
    // La diferencia es todo el valor de esta pasada: el bulón hay que tenerlo,
    // el cable sólo dice que el equipo tiene cables.
    expect(piezasDeLaDescripcion("Se cambia bulón cortado de placas")).toEqual([
      expect.objectContaining({ tipo: "bulón", accion: "cambio" }),
      expect.objectContaining({ tipo: "placa", accion: "cambio" }),
    ]);
    expect(piezasDeLaDescripcion("se repara cable dañado en vibrador por cortocircuito")).toEqual([
      expect.objectContaining({ tipo: "cable", accion: "revision" }),
    ]);
  });

  it("el verbo manda sobre las piezas de su oración y no sobre las de al lado", () => {
    const piezas = piezasDeLaDescripcion(
      "Se coloca 2 mangas caidas, se repara puntera sin fin descarga filtro de manga"
    );
    expect(piezas.find((p) => p.tipo === "manga" && p.accion === "cambio")).toBeDefined();
    expect(piezas.find((p) => p.tipo === "filtro")?.accion).toBe("revision");
  });

  it("parte por la barra entre palabras, que es cómo se listan tres piezas", () => {
    expect(piezasDeLaDescripcion("Revisar reductor/cadena/rodamiento").map((p) => p.tipo)).toEqual([
      "reductor", "cadena", "rodamiento",
    ]);
    // Pero no por la barra de una fracción.
    expect(piezasDeLaDescripcion('Se cambia bulón 3/8 de la tapa')[0]).toMatchObject({
      tipo: "bulón", accion: "cambio",
    });
  });

  it("se queda con el código sólo cuando viene pegado al sustantivo", () => {
    expect(piezasDeLaDescripcion("se agrega una grilla de 4mm")[0]).toMatchObject({
      tipo: "grilla", codigo: "4MM", accion: "cambio",
    });
    // "posición 9" es dónde está el rodamiento, no cuál es.
    expect(piezasDeLaDescripcion("Revisar rodamiento posición 9 y 8, valores elevados de vibraciones")[0])
      .toMatchObject({ tipo: "rodamiento", codigo: null, accion: "revision" });
  });

  it("reconoce el verbo con tilde, que en JavaScript es una trampa", () => {
    // `\b` se define con `\w`, que no incluye la "ó": sin normalizar, "Se
    // cambió válvula" no matchea y "Se cambio válvula" sí.
    expect(piezasDeLaDescripcion("Se cambió válvula de soplado")[0]).toMatchObject({
      tipo: "válvula", accion: "cambio",
    });
    expect(piezasDeLaDescripcion("Se reparó cañeria")[0]?.accion).toBe("revision");
  });

  it("no inventa nada cuando la descripción no nombra ninguna pieza", () => {
    expect(piezasDeLaDescripcion("Se calibro tolva de piedra")).toEqual([]);
    expect(piezasDeLaDescripcion(null)).toEqual([]);
  });
});

describe("piezasPorEquipo", () => {
  it("saltea las OT que ya dijeron algo en la columna repuesto", () => {
    // Si no, la misma OT suma evidencia en los dos informes.
    const porEquipo = piezasPorEquipo([
      { ot_number: 1, fecha: "2026-01-01", equipment_id: "m", repuesto: "2 grillas de 4mm", descripcion: "Se cambian grillas" },
      { ot_number: 2, fecha: "2026-02-01", equipment_id: "m", repuesto: null, descripcion: "Se cambia rodamiento" },
    ]);
    expect(porEquipo.get("m")!.map((p) => p.tipo)).toEqual(["rodamiento"]);
  });

  it("pone primero lo que se cambió", () => {
    const lista = piezasPorEquipo([
      { ot_number: 1, fecha: "2026-01-01", equipment_id: "m", repuesto: null, descripcion: "Revisar cadena" },
      { ot_number: 2, fecha: "2026-02-01", equipment_id: "m", repuesto: null, descripcion: "Se cambia correa" },
    ]).get("m")!;
    expect(lista[0]).toMatchObject({ tipo: "correa", accion: "cambio" });
  });
});

describe("nombraAlEquipo", () => {
  it("descarta la pieza que se llama igual que el equipo", () => {
    // En "Ventilador 5", el ventilador es el equipo y el motor es la pieza.
    expect(nombraAlEquipo("ventilador", "Ventilador 5")).toBe(true);
    expect(nombraAlEquipo("motor", "Ventilador 5")).toBe(false);
    expect(nombraAlEquipo("manga", "Filtro de manga")).toBe(true);
    expect(nombraAlEquipo("rodamiento", null)).toBe(false);
  });
});

describe("notaDeFicha", () => {
  it("dice de dónde salió, que es lo que nadie va a poder deducir después", () => {
    const [r] = repuestosPorEquipo([
      { ot_number: 2261, fecha: "2026-08-07", equipment_id: "v", repuesto: "3 correas B-86" },
      { ot_number: 2615, fecha: "2026-09-30", equipment_id: "v", repuesto: "3 correas B-86" },
    ]).get("v")!;
    const nota = notaDeFicha(r);
    expect(nota).toContain("Visto en 2 OT (2261, 2615)");
    expect(nota).toContain("6 u en total");
    expect(nota).toContain("última 30/09/2026");
    expect(nota).toContain("de las OT, sin relevar en planta");
    expect(nota).not.toContain("confirmar");
  });

  it("avisa en la ficha cuando el tipo lo dedujimos nosotros", () => {
    // En el informe se ve el ⚠; en la ficha del equipo, si no está escrito en
    // la nota, la duda se pierde.
    const [r] = repuestosPorEquipo([
      { ot_number: 1492, fecha: "2026-04-13", equipment_id: "c", repuesto: "2 B-58" },
    ]).get("c")!;
    expect(r.confianza).toBe("revisar");
    expect(notaDeFicha(r)).toContain("tipo deducido del código, confirmar");
  });
});
