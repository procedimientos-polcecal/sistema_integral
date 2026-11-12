import { describe, it, expect } from "vitest";
import {
  ACCIONES_CORRECTIVAS, ACCIONES_PREVENTIVAS, accionDe, catalogoPropuesto, comoSeLee,
  candidatasAComponente, componenteDe, intervaloTipico, nombresDe, normalizar,
  type OrdenPreventiva,
} from "./tareasPreventivas";

/** Los nombres tal como estan en `equipos_componentes`, con sus barras. */
const COMPONENTES = [
  "Martillos", "Tensor de cinta", "Raspador / limpiador cinta", "Cangilones",
  "Banda / cadena elevadora", "Mallas clasificadoras", "Membrana / lona porosa",
];

let siguiente = 1;
function ot(descripcion: string, p: Partial<OrdenPreventiva> = {}): OrdenPreventiva {
  return {
    ot_number: siguiente++,
    descripcion,
    equipment_id: "eq-1",
    fecha_ejecucion: "2026-06-01",
    ...p,
  };
}

describe("normalizar el texto de la planilla", () => {
  it("saca acentos, mayusculas y puntuacion", () => {
    expect(normalizar("Rotación de MARTILLOS.")).toBe("rotacion de martillos");
  });

  it("junta los espacios y recorta", () => {
    expect(normalizar("  cambio   de\ngrillas ")).toBe("cambio de grillas");
  });

  it("lo vacio es vacio y no revienta", () => {
    expect(normalizar(null)).toBe("");
    expect(normalizar(undefined)).toBe("");
    expect(normalizar("   ")).toBe("");
  });
});

/**
 * La planilla escribe la misma tarea de tres formas —el sustantivo, el
 * infinitivo y el pasado reflexivo— y las tres son la misma. Es lo que hace
 * que "regulacion de pendulos" (18 veces) y "se regulan pendulos" (5) dejen de
 * ser dos tareas distintas.
 */
describe("reconocer la accion", () => {
  it("las tres formas de escribir lo mismo caen en la misma accion", () => {
    for (const texto of ["Rotación de martillos", "Rotar martillos", "Se rotan martillos"]) {
      expect(accionDe(texto)?.accion.clave).toBe("ROTACION");
    }
  });

  it("reconoce las seis preventivas", () => {
    expect(accionDe("Limpieza de tolva")?.accion.clave).toBe("LIMPIEZA");
    expect(accionDe("Cambio de correas")?.accion.clave).toBe("CAMBIO");
    expect(accionDe("Revisión de rodamientos")?.accion.clave).toBe("REVISION");
    expect(accionDe("Regulación de péndulos")?.accion.clave).toBe("REGULACION");
    expect(accionDe("Rotación de martillos")?.accion.clave).toBe("ROTACION");
    expect(accionDe("Engrase de cadena")?.accion.clave).toBe("LUBRICACION");
  });

  it("todas las preventivas se marcan como preventivas", () => {
    expect(accionDe("Limpieza general")?.esPreventiva).toBe(true);
  });

  /**
   * 270 de las 1.025 programadas con accion reconocida son esto: trabajo
   * correctivo y de mejora cargado como PROGRAMADO. Se reconocen para no
   * contarlas, no para reclasificar la orden.
   */
  it("reconoce las correctivas y las marca como no preventivas", () => {
    for (const [texto, clave] of [
      ["Reparación empalme de banda", "REPARACION"],
      ["Se suelda cuchilla", "SOLDADURA"],
      ["Construcción vereda portería", "MONTAJE"],
      ["Colocar deflectores en descarga", "MONTAJE"],
    ] as const) {
      const r = accionDe(texto);
      expect(r?.accion.clave).toBe(clave);
      expect(r?.esPreventiva).toBe(false);
    }
  });

  /** El orden de las listas es parte del significado, y por eso se fija. */
  it("una preventiva le gana a una correctiva en la misma frase", () => {
    expect(accionDe("Se cambian y se sueldan grillas")?.accion.clave).toBe("CAMBIO");
    expect(accionDe("Se cambian y se sueldan grillas")?.esPreventiva).toBe(true);
  });

  it("rotar le gana a cambiar, porque rotar es lo que se hizo", () => {
    expect(accionDe("Se rotan y se cambian martillos")?.accion.clave).toBe("ROTACION");
  });

  it("el cambio de aceite es lubricar, no reemplazar una pieza", () => {
    expect(accionDe("Cambio de aceite del reductor")?.accion.clave).toBe("LUBRICACION");
  });

  /** "VER LA ESTRUCTURA ESTA VIBRANDO MUCHO" y "Se colabora con contratista". */
  it("lo que no nombra ninguna accion es null", () => {
    expect(accionDe("VER LA ESTRUCTURA ESTA VIBRANDO MUCHO")).toBeNull();
    expect(accionDe("Se colabora con contratista")).toBeNull();
    expect(accionDe("")).toBeNull();
    expect(accionDe(null)).toBeNull();
  });

  it("ninguna clave se repite entre las dos listas", () => {
    const claves = [...ACCIONES_PREVENTIVAS, ...ACCIONES_CORRECTIVAS].map((a) => a.clave);
    expect(new Set(claves).size).toBe(claves.length);
  });
});

describe("los nombres de un componente", () => {
  /** La barra separa sinonimos a proposito en el catalogo. */
  it("la barra parte el nombre en dos buscables", () => {
    expect(nombresDe("Raspador / limpiador cinta")).toEqual(["raspador", "limpiador cinta"]);
  });

  it("un nombre sin barra es uno solo", () => {
    expect(nombresDe("Martillos")).toEqual(["martillos"]);
  });

  /**
   * Un componente mal reconocido es peor que ninguno: con "eje" suelto
   * engancha cualquier descripcion que lo tenga adentro de otra palabra.
   */
  it("los pedazos de menos de cuatro letras no se buscan", () => {
    expect(nombresDe("Eje / pin")).toEqual([]);
    expect(nombresDe("Rotor / eje")).toEqual(["rotor"]);
  });
});

describe("reconocer el componente", () => {
  it("lo encuentra por su nombre", () => {
    expect(componenteDe("Rotación de martillos", COMPONENTES)).toBe("Martillos");
  });

  it("lo encuentra por el sinonimo de la otra punta de la barra", () => {
    expect(componenteDe("Cambio de raspador de cinta 5", COMPONENTES))
      .toBe("Raspador / limpiador cinta");
    expect(componenteDe("Se cambia limpiador cinta", COMPONENTES))
      .toBe("Raspador / limpiador cinta");
  });

  /** El que mas dice gana: "banda" tambien esta adentro del otro nombre. */
  it("gana el nombre mas largo que aparezca", () => {
    expect(componenteDe("Cambio de banda cadena elevadora", COMPONENTES))
      .toBe("Banda / cadena elevadora");
  });

  it("lo que no nombra ningun componente es null", () => {
    expect(componenteDe("Limpieza general en planta", COMPONENTES)).toBeNull();
    expect(componenteDe(null, COMPONENTES)).toBeNull();
    expect(componenteDe("Rotación de martillos", [])).toBeNull();
  });
});

describe("cada cuantos dias se repite", () => {
  it("es la mediana de los huecos", () => {
    // Huecos de 10, 10 y 40: la mediana es 10 y el promedio seria 20.
    expect(intervaloTipico(["2026-01-01", "2026-01-11", "2026-01-21", "2026-03-02"])).toBe(10);
  });

  it("con cantidad par de huecos promedia los dos del medio", () => {
    // Huecos de 10 y 20.
    expect(intervaloTipico(["2026-01-01", "2026-01-11", "2026-01-31"])).toBe(15);
  });

  /** Una sola distancia entre dos fechas puede ser cualquier cosa. */
  it("con menos de tres fechas no opina", () => {
    expect(intervaloTipico(["2026-01-01", "2026-01-11"])).toBeNull();
    expect(intervaloTipico(["2026-01-01"])).toBeNull();
    expect(intervaloTipico([])).toBeNull();
  });

  it("dos ordenes del mismo dia no son dos repeticiones", () => {
    expect(intervaloTipico(["2026-01-01", "2026-01-01", "2026-01-11"])).toBeNull();
  });

  it("no depende del orden en que vengan las fechas", () => {
    expect(intervaloTipico(["2026-03-02", "2026-01-01", "2026-01-21", "2026-01-11"])).toBe(10);
  });
});

describe("el catalogo que propone el historial", () => {
  it("junta las formas de escribir la misma tarea en una sola", () => {
    const r = catalogoPropuesto(
      [
        ot("Rotación de martillos"),
        ot("Se rotan martillos"),
        ot("Rotar martillos a 2da cara"),
      ],
      COMPONENTES
    );
    expect(r.tareas).toHaveLength(1);
    expect(r.tareas[0]).toMatchObject({ accion: "ROTACION", componente: "Martillos", veces: 3 });
  });

  it("las ordena por cuantas veces se hicieron", () => {
    const r = catalogoPropuesto(
      [
        ot("Limpieza de cangilones"),
        ...[1, 2, 3].map(() => ot("Rotación de martillos")),
        ...[1, 2].map(() => ot("Cambio de tensor de cinta")),
      ],
      COMPONENTES
    );
    expect(r.tareas.map((t) => `${t.accion}|${t.componente}`)).toEqual([
      "ROTACION|Martillos", "CAMBIO|Tensor de cinta", "LIMPIEZA|Cangilones",
    ]);
  });

  it("separa los equipos y les calcula su propio intervalo", () => {
    const r = catalogoPropuesto(
      [
        ot("Rotación de martillos", { equipment_id: "molino", fecha_ejecucion: "2026-01-01" }),
        ot("Rotación de martillos", { equipment_id: "molino", fecha_ejecucion: "2026-01-11" }),
        ot("Rotación de martillos", { equipment_id: "molino", fecha_ejecucion: "2026-01-21" }),
        ot("Rotación de martillos", { equipment_id: "rompedora", fecha_ejecucion: "2026-02-01" }),
      ],
      COMPONENTES
    );
    expect(r.tareas[0].veces).toBe(4);
    expect(r.tareas[0].equipos).toEqual([
      { equipmentId: "molino", veces: 3, intervaloTipico: 10 },
      { equipmentId: "rompedora", veces: 1, intervaloTipico: null },
    ]);
  });

  /** Existe aunque no se sepa cuando: lo que no puede es aportar a un intervalo. */
  it("una orden sin fecha igual cuenta como una vez que se hizo", () => {
    const r = catalogoPropuesto(
      [
        ot("Rotación de martillos", { fecha_ejecucion: null }),
        ot("Rotación de martillos", { fecha_ejecucion: "2026-01-01" }),
      ],
      COMPONENTES
    );
    expect(r.tareas[0].veces).toBe(2);
    expect(r.tareas[0].equipos[0].intervaloTipico).toBeNull();
  });

  it("una orden sin equipo no arma tarea, pero su accion se cuenta", () => {
    const r = catalogoPropuesto(
      [ot("Rotación de martillos", { equipment_id: null })], COMPONENTES
    );
    expect(r.tareas).toEqual([]);
    expect(r.cobertura.conAccionPreventiva).toBe(1);
  });

  /** El correctivo cargado como PROGRAMADO no entra al catalogo preventivo. */
  it("una reparacion no arma tarea", () => {
    const r = catalogoPropuesto([ot("Reparación de banda cadena elevadora")], COMPONENTES);
    expect(r.tareas).toEqual([]);
    expect(r.cobertura.conAccionCorrectiva).toBe(1);
    expect(r.cobertura.enElCatalogo).toBe(0);
  });

  /**
   * Las cuatro cuentas cierran contra las ordenes leidas, igual que `afuera`
   * en `mttr.ts`: es lo que vuelve auditable al porcentaje de cobertura.
   */
  it("la cobertura cierra contra las ordenes", () => {
    const ordenes = [
      ot("Rotación de martillos"),
      ot("Limpieza general en planta"),
      ot("Reparación"),
      ot("VER LA ESTRUCTURA ESTA VIBRANDO MUCHO"),
    ];
    const c = catalogoPropuesto(ordenes, COMPONENTES).cobertura;
    expect(c.conAccionPreventiva + c.conAccionCorrectiva + c.sinAccion).toBe(c.ordenes);
    expect(c).toEqual({
      ordenes: 4, conAccionPreventiva: 2, conAccionCorrectiva: 1, sinAccion: 1,
      enElCatalogo: 1,
    });
  });

  it("sin ordenes no inventa nada", () => {
    const r = catalogoPropuesto([], COMPONENTES);
    expect(r.tareas).toEqual([]);
    expect(r.cobertura.ordenes).toBe(0);
  });
});

describe("como se lee una tarea", () => {
  it("usa la forma corta de la accion", () => {
    expect(comoSeLee("ROTACION", "Martillos")).toBe("rotación de Martillos");
    expect(comoSeLee("LIMPIEZA", "Cangilones")).toBe("limpieza de Cangilones");
  });

  it("una accion que no esta en el vocabulario no rompe la frase", () => {
    expect(comoSeLee("INVENTADA", "Martillos")).toBe("inventada Martillos");
  });
});

/**
 * El hallazgo que se encontro corriendo esto contra los datos: el catalogo de
 * componentes y las descripciones hablan idiomas distintos. Esta funcion dice
 * que le falta al catalogo, para que lo agregue alguien de planta.
 */
describe("las palabras que piden un componente nuevo", () => {
  const EQUIPOS = ["Molino a martillos", "Elevador de cangilones", "Cinta transportadora 3"];

  it("saca la palabra que falta, con cuantas veces se pidio", () => {
    const r = candidatasAComponente(
      [ot("Regulación de péndulos"), ot("Se regulan péndulos"), ot("Cambio de grillas")],
      COMPONENTES, EQUIPOS
    );
    expect(r).toEqual([{ palabra: "pendulos", veces: 2 }, { palabra: "grillas", veces: 1 }]);
  });

  /** "limpieza" aparece 211 veces y es el verbo, no un componente. */
  it("no propone las palabras del propio vocabulario de acciones", () => {
    const r = candidatasAComponente([ot("Limpieza general")], COMPONENTES, EQUIPOS);
    expect(r.map((c) => c.palabra)).not.toContain("limpieza");
  });

  /**
   * El filtro que separa una lista util de una de ruido: "rompedora",
   * "molino", "elevador" y "cinta" son maquinas, y la maquina ya viaja en
   * `equipment_id`.
   */
  it("no propone las palabras que nombran un equipo", () => {
    const r = candidatasAComponente([ot("Revisión de elevador")], COMPONENTES, EQUIPOS);
    expect(r.map((c) => c.palabra)).not.toContain("elevador");
  });

  it("no propone lo que el catalogo ya tiene", () => {
    const r = candidatasAComponente([ot("Rotación de martillos")], COMPONENTES, EQUIPOS);
    expect(r).toEqual([]);
  });

  /** Una descripcion que repite la palabra no son dos pedidos del componente. */
  it("cuenta una vez por orden, no una por aparicion", () => {
    const r = candidatasAComponente(
      [ot("Cambio de grillas, se rotan las grillas y se revisan grillas")],
      COMPONENTES, EQUIPOS
    );
    expect(r.find((c) => c.palabra === "grillas")?.veces).toBe(1);
  });

  it("no mira las correctivas ni las que no tienen accion", () => {
    const r = candidatasAComponente(
      [ot("Reparación de pendulos"), ot("VER LOS PENDULOS")], COMPONENTES, EQUIPOS
    );
    expect(r).toEqual([]);
  });
});
