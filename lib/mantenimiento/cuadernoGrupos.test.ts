import { describe, expect, it } from "vitest";
import {
  enOrdenes,
  pendientesDeOrdenes,
  propuestaDeGrupos,
  sePuedenJuntar,
  sePuedeSeparar,
  type RenglonDelCuaderno,
} from "./cuadernoGrupos";

const TRITURACION_1 = "sector-trit-1";
const MOLIENDA = "sector-molienda";
const CANTERA = "sector-cantera";

let contador = 0;
/** Un renglon con lo minimo; cada test pisa lo que le importa. */
function r(parcial: Partial<RenglonDelCuaderno> = {}): RenglonDelCuaderno {
  contador += 1;
  return {
    id: `r${contador}`,
    cuaderno_id: "c1",
    fecha: "2026-09-17",
    tarea: "Tarea",
    lugar_raw: "",
    sector_id: null,
    sector_propuesto: false,
    equipo_id: null,
    horas: 2,
    costo: null,
    grupo_id: null,
    orden_trabajo_id: null,
    ...parcial,
  };
}

const enTrituracion1 = r({ tarea: "Reparar rodillos", sector_id: TRITURACION_1 });
const enMolienda = r({ tarea: "Cambiar chapas", sector_id: MOLIENDA });

const tranq17 = () => r({ tarea: "Tranqueras D6", fecha: "2026-09-17", horas: 6 });
const tranq21 = () => r({ tarea: "Tranqueras D6", fecha: "2026-09-21", horas: 4 });
const tranq23 = () => r({ tarea: "Tranqueras D6", fecha: "2026-09-23", horas: 6 });

describe("sePuedenJuntar", () => {
  it("dos renglones de sectores distintos no se juntan", () => {
    const p = sePuedenJuntar([enTrituracion1, enMolienda]);
    expect(p[0]).toContain("una orden de trabajo tiene un solo sector");
  });

  it("un sector propuesto tambien cuenta como sector", () => {
    const p = sePuedenJuntar([
      r({ sector_id: CANTERA, sector_propuesto: true }),
      r({ sector_id: MOLIENDA }),
    ]);
    expect(p[0]).toContain("una orden de trabajo tiene un solo sector");
  });

  it("un renglon ya convertido no se junta con nada", () => {
    const p = sePuedenJuntar([r({ orden_trabajo_id: "ot-1" }), r()]);
    expect(p).toHaveLength(1);
    expect(p[0]).toContain("en una orden de trabajo y no se junta con nada");
  });

  it("un solo renglon no se junta con nadie", () => {
    expect(sePuedenJuntar([r()])[0]).toContain("al menos dos");
    expect(sePuedenJuntar([])[0]).toContain("al menos dos");
  });

  it("renglones sin sector, o del mismo sector, se pueden juntar", () => {
    expect(sePuedenJuntar([r(), r()])).toEqual([]);
    expect(sePuedenJuntar([r({ sector_id: CANTERA }), r({ sector_id: CANTERA }), r()])).toEqual([]);
  });

  it("informa todos los problemas juntos", () => {
    const p = sePuedenJuntar([
      r({ sector_id: CANTERA, orden_trabajo_id: "ot-1" }),
      r({ sector_id: MOLIENDA }),
    ]);
    expect(p).toHaveLength(2);
  });
});

describe("sePuedeSeparar", () => {
  it("un grupo que ya tiene una OT no se separa", () => {
    const p = sePuedeSeparar([r({ grupo_id: "g", orden_trabajo_id: "ot-1" }), r({ grupo_id: "g" })]);
    expect(p[0]).toContain("ya tiene una orden de trabajo");
  });

  it("un grupo sin OT se separa", () => {
    expect(sePuedeSeparar([r({ grupo_id: "g" }), r({ grupo_id: "g" })])).toEqual([]);
  });
});

describe("propuestaDeGrupos", () => {
  it("sin sector, la propuesta junta los que son la misma tarea", () => {
    const a = tranq17(), b = tranq21(), c = tranq23();
    const propuesta = propuestaDeGrupos([a, b, c]);
    expect(propuesta.size).toBe(1);
    expect([...propuesta.values()][0]).toEqual([a.id, b.id, c.id]);
  });

  it("sin sector, dos tareas distintas no se juntan", () => {
    const propuesta = propuestaDeGrupos([
      r({ tarea: "Tranqueras D6" }),
      r({ tarea: "Alambrado" }),
    ]);
    expect(propuesta.size).toBe(0);
  });

  it("no distingue mayusculas, acentos ni espacios de mas", () => {
    const a = r({ tarea: "Clasificar  Manganes" });
    const b = r({ tarea: "clasificar manganes." });
    const c = r({ tarea: "CLASIFICAR MANGANÉS" });
    const d = r({ tarea: "Clasificar manganés" });
    expect([...propuestaDeGrupos([a, b, c, d]).values()][0]).toHaveLength(4);
  });

  it("un renglon con sector confirmado no se propone para juntar", () => {
    const propuesta = propuestaDeGrupos([
      r({ tarea: "Tranqueras D6", sector_id: CANTERA }),
      r({ tarea: "Tranqueras D6", sector_id: CANTERA }),
    ]);
    expect(propuesta.size).toBe(0);
  });

  it("un sector propuesto sin confirmar sigue siendo un renglon sin sector", () => {
    const a = r({ tarea: "Tranqueras D6", sector_id: CANTERA, sector_propuesto: true });
    const b = r({ tarea: "Tranqueras D6", sector_id: CANTERA, sector_propuesto: true });
    expect([...propuestaDeGrupos([a, b]).values()][0]).toEqual([a.id, b.id]);
  });

  it("no propone lo que una persona ya junto ni lo que ya se convirtio", () => {
    const propuesta = propuestaDeGrupos([
      r({ tarea: "Alambrado", grupo_id: "g" }),
      r({ tarea: "Alambrado", grupo_id: "g" }),
      r({ tarea: "Alambrado", orden_trabajo_id: "ot-1" }),
      r({ tarea: "Alambrado" }),
    ]);
    expect(propuesta.size).toBe(0);
  });

  it("la propuesta no cruza cargas", () => {
    const sep = (c: string, f: string) => r({ tarea: "Tranqueras D6", cuaderno_id: c, fecha: f });
    const a = sep("septiembre", "2026-09-17"), b = sep("septiembre", "2026-09-21");
    const c = sep("noviembre", "2026-11-03"), d = sep("noviembre", "2026-11-05");
    const propuesta = [...propuestaDeGrupos([a, c, b, d]).values()];
    expect(propuesta).toHaveLength(2);
    expect(propuesta).toContainEqual([a.id, b.id]);
    expect(propuesta).toContainEqual([c.id, d.id]);
  });

  it("una tarea que aparece una vez por carga no se propone", () => {
    const a = r({ tarea: "Alambrado", cuaderno_id: "septiembre" });
    const b = r({ tarea: "Alambrado", cuaderno_id: "noviembre" });
    expect(propuestaDeGrupos([a, b]).size).toBe(0);
  });

  it("no propone juntar lo que sePuedenJuntar rechazaria", () => {
    const propuesta = propuestaDeGrupos([
      r({ tarea: "Alambrado", sector_id: CANTERA, sector_propuesto: true }),
      r({ tarea: "Alambrado", sector_id: MOLIENDA, sector_propuesto: true }),
    ]);
    expect(propuesta.size).toBe(0);
  });
});

describe("enOrdenes", () => {
  it("con sector, cada renglon es su propia OT", () => {
    const grupos = enOrdenes([enTrituracion1, enMolienda]);
    expect(grupos.length).toBe(2);
    expect(grupos.every((g) => g.accion === "crear")).toBe(true);
  });

  it("dos renglones iguales con sector siguen siendo dos OT", () => {
    const a = r({ tarea: "Reparar rodillos", sector_id: CANTERA, fecha: "2026-09-17" });
    const b = r({ tarea: "Reparar rodillos", sector_id: CANTERA, fecha: "2026-09-18" });
    expect(enOrdenes([a, b])).toHaveLength(2);
  });

  it("un grupo juntado a mano suma las horas y toma el rango de fechas", () => {
    const g = "grupo-tranqueras";
    const [orden] = enOrdenes([
      { ...tranq23(), sector_id: CANTERA, grupo_id: g },
      { ...tranq17(), sector_id: CANTERA, grupo_id: g },
      { ...tranq21(), sector_id: CANTERA, grupo_id: g },
    ]);
    expect(orden.horas).toBe(16);
    expect(orden.desde).toBe("2026-09-17");
    expect(orden.hasta).toBe("2026-09-23");
    expect(orden.sector_id).toBe(CANTERA);
    expect(orden.renglon_ids).toHaveLength(3);
  });

  it("las horas se suman sin arrastrar error de coma flotante", () => {
    const g = "g";
    const [orden] = enOrdenes([
      r({ sector_id: CANTERA, grupo_id: g, horas: 0.1 }),
      r({ sector_id: CANTERA, grupo_id: g, horas: 0.2 }),
    ]);
    expect(orden.horas).toBe(0.3);
  });

  it("un renglon sin sector confirmado no sale en las ordenes", () => {
    expect(enOrdenes([r()])).toHaveLength(0);
  });

  it("un renglon con sector propuesto sin confirmar no sale en las ordenes", () => {
    expect(enOrdenes([r({ sector_id: CANTERA, sector_propuesto: true })])).toHaveLength(0);
  });

  it("un grupo con un solo renglon sin confirmar no sale entero", () => {
    const g = "g";
    const salida = enOrdenes([
      r({ sector_id: CANTERA, grupo_id: g }),
      r({ sector_id: CANTERA, sector_propuesto: true, grupo_id: g }),
    ]);
    expect(salida).toHaveLength(0);
  });

  it("un grupo con un renglon sin sector no sale, aunque otro tenga sector confirmado", () => {
    const g = "g";
    const renglones = [
      r({ sector_id: CANTERA, grupo_id: g, horas: 3 }),
      r({ sector_id: null, grupo_id: g, horas: 4 }),
    ];
    expect(enOrdenes(renglones)).toHaveLength(0);
    expect(pendientesDeOrdenes(renglones)[0].motivo).toBe("sin_sector");
  });

  it("un grupo cuyos renglones quedaron en sectores distintos no sale", () => {
    const g = "g";
    // Se juntaron y despues alguien le cambio el sector a uno: el grupo ya no
    // es una orden y no se elige por la persona.
    expect(enOrdenes([
      r({ sector_id: CANTERA, grupo_id: g }),
      r({ sector_id: MOLIENDA, grupo_id: g }),
    ])).toHaveLength(0);
  });

  it("un grupo que ya tiene una OT la trae en vez de pedir otra", () => {
    const g = "g";
    const convertido = r({ sector_id: CANTERA, grupo_id: g, horas: 6, orden_trabajo_id: "ot-1" });
    const nuevo = r({ sector_id: CANTERA, grupo_id: g, horas: 4, fecha: "2026-09-21" });
    const [orden] = enOrdenes([convertido, nuevo]);
    expect(orden.accion).toBe("sumar");
    expect(orden.ot_existentes).toEqual(["ot-1"]);
    expect(orden.renglon_ids_sin_ot).toEqual([nuevo.id]);
    // El total es el del grupo entero: la OT se reescribe y no se le suma al
    // numero que ya tiene, que contaria dos veces lo de antes.
    expect(orden.horas).toBe(10);
  });

  it("dos OT distintas en el mismo grupo se denuncian y no se tocan", () => {
    const g = "g";
    const [orden] = enOrdenes([
      r({ sector_id: CANTERA, grupo_id: g, orden_trabajo_id: "ot-1" }),
      r({ sector_id: CANTERA, grupo_id: g, orden_trabajo_id: "ot-2" }),
      r({ sector_id: CANTERA, grupo_id: g }),
    ]);
    expect(orden.accion).toBe("denunciar");
    expect(orden.ot_existentes).toEqual(["ot-1", "ot-2"]);
  });

  it("un grupo ya convertido por completo no vuelve a salir", () => {
    const g = "g";
    expect(enOrdenes([
      r({ sector_id: CANTERA, grupo_id: g, orden_trabajo_id: "ot-1" }),
      r({ sector_id: CANTERA, grupo_id: g, orden_trabajo_id: "ot-1" }),
    ])).toHaveLength(0);
  });

  it("un renglon en blanco no genera una OT vacia", () => {
    expect(enOrdenes([r({ sector_id: CANTERA, horas: null, costo: null })])).toHaveLength(0);
    expect(enOrdenes([r({ sector_id: CANTERA, horas: 0, costo: 0 })])).toHaveLength(0);
  });

  it("los renglones en blanco de una llave entran en la OT si alguien los junta", () => {
    const g = "llave";
    const [orden] = enOrdenes([
      r({ tarea: "Cambiar rodillos", sector_id: TRITURACION_1, grupo_id: g, horas: 46 }),
      r({ tarea: "Cambiar bulones", sector_id: TRITURACION_1, grupo_id: g, horas: null }),
      r({ tarea: "Soldar chapas", sector_id: TRITURACION_1, grupo_id: g, horas: null }),
    ]);
    expect(orden.horas).toBe(46);
    expect(orden.renglon_ids).toHaveLength(3);
    expect(orden.tareas).toEqual(["Cambiar rodillos", "Cambiar bulones", "Soldar chapas"]);
  });

  it("un renglon con precio y sin horas sale como OT", () => {
    const [orden] = enOrdenes([r({ sector_id: CANTERA, horas: null, costo: 920000 })]);
    expect(orden.horas).toBe(0);
    expect(orden.costo).toBe(920000);
  });

  it("el costo es null cuando ningun renglon trae precio", () => {
    const [orden] = enOrdenes([r({ sector_id: CANTERA })]);
    expect(orden.costo).toBeNull();
  });

  it("el equipo es el de todos los renglones, y null si no coinciden", () => {
    const g = "g";
    const igual = enOrdenes([
      r({ sector_id: CANTERA, grupo_id: g, equipo_id: "e1" }),
      r({ sector_id: CANTERA, grupo_id: g, equipo_id: "e1" }),
    ]);
    expect(igual[0].equipo_id).toBe("e1");

    const distinto = enOrdenes([
      r({ sector_id: CANTERA, grupo_id: "h", equipo_id: "e1" }),
      r({ sector_id: CANTERA, grupo_id: "h", equipo_id: "e2" }),
    ]);
    expect(distinto[0].equipo_id).toBeNull();

    const conUnoSinEquipo = enOrdenes([
      r({ sector_id: CANTERA, grupo_id: "i", equipo_id: "e1" }),
      r({ sector_id: CANTERA, grupo_id: "i", equipo_id: null }),
    ]);
    expect(conUnoSinEquipo[0].equipo_id).toBeNull();
  });

  it("un renglon sin fecha no sale", () => {
    expect(enOrdenes([r({ sector_id: CANTERA, fecha: null })])).toHaveLength(0);
  });

  it("un grupo con un renglon sin fecha toma el rango de los que si la tienen", () => {
    const g = "g";
    const [orden] = enOrdenes([
      r({ sector_id: CANTERA, grupo_id: g, fecha: null }),
      r({ sector_id: CANTERA, grupo_id: g, fecha: "2026-09-21" }),
    ]);
    expect(orden.desde).toBe("2026-09-21");
    expect(orden.hasta).toBe("2026-09-21");
  });
});

describe("pendientesDeOrdenes", () => {
  it("un renglon sin sector se informa como pendiente", () => {
    const solo = r();
    const [p] = pendientesDeOrdenes([solo]);
    expect(p.motivo).toBe("sin_sector");
    expect(p.renglon_ids).toEqual([solo.id]);
  });

  it("un sector propuesto se informa como pendiente de confirmar", () => {
    const [p] = pendientesDeOrdenes([r({ sector_id: CANTERA, sector_propuesto: true })]);
    expect(p.motivo).toBe("sector_sin_confirmar");
  });

  it("un renglon en blanco se informa y no se pierde", () => {
    const blanco = r({ sector_id: CANTERA, horas: null, costo: null });
    const [p] = pendientesDeOrdenes([blanco]);
    expect(p.motivo).toBe("sin_horas");
    expect(p.renglon_ids).toEqual([blanco.id]);
  });

  it("un grupo con sectores distintos se informa", () => {
    const g = "g";
    const [p] = pendientesDeOrdenes([
      r({ sector_id: CANTERA, grupo_id: g }),
      r({ sector_id: MOLIENDA, grupo_id: g }),
    ]);
    expect(p.motivo).toBe("sectores_distintos");
    expect(p.grupo_id).toBe(g);
  });

  it("un renglon sin fecha se informa", () => {
    const [p] = pendientesDeOrdenes([r({ sector_id: CANTERA, fecha: null })]);
    expect(p.motivo).toBe("sin_fecha");
  });

  it("lo que sale como OT no es pendiente, y lo ya convertido tampoco", () => {
    expect(pendientesDeOrdenes([
      r({ sector_id: CANTERA }),
      r({ sector_id: CANTERA, orden_trabajo_id: "ot-1" }),
    ])).toHaveLength(0);
  });

  it("cada renglon esta en las ordenes o en los pendientes, nunca en ninguno", () => {
    const todos = [
      enTrituracion1, enMolienda, r(), r({ sector_id: CANTERA, sector_propuesto: true }),
      r({ sector_id: CANTERA, horas: null }),
      r({ sector_id: CANTERA, grupo_id: "g" }), r({ sector_id: CANTERA, grupo_id: "g" }),
      r({ sector_id: CANTERA, fecha: null }),
    ];
    const vistos = new Set([
      ...enOrdenes(todos).flatMap((g) => g.renglon_ids),
      ...pendientesDeOrdenes(todos).flatMap((p) => p.renglon_ids),
    ]);
    expect([...vistos].sort()).toEqual(todos.map((x) => x.id).sort());
  });
});
