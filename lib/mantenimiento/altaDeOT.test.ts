import { describe, it, expect } from "vitest";
import { loQueFaltaParaCrear, loQueSeContradice } from "./altaDeOT";

/**
 * Lo que una OT tiene que decir si o si. Son los campos de los que viven
 * despues el MTBF, las horas por sector y el orden del trabajo: una orden sin
 * equipo no se puede contar contra ninguna maquina, y una sin fecha de
 * ejecucion no se puede dar por atrasada nunca.
 *
 * El formulario los traia opcionales y la planilla los recibia vacios.
 */
const completa = {
  sector_id: "s-1",
  equipment_id: "eq-1",
  descripcion: "Cambio de rodamientos",
  especialidad: "MECÁNICO",
  tipo: "CORRECTIVO",
  quien: "INTERNO",
  fecha_ejecucion: "2026-10-20",
  fecha_fin: "2026-10-25",
  fecha_cierre: "",
  horas: "",
  contratista: "",
  operario_1: "",
  operario_2: "",
  operario_3: "",
  cierre_justificacion: "",
};

/**
 * La fecha de fin es una estimacion y la de cierre es la real, asi que esto no
 * mira el cierre: mira que la ventana estimada no este dada vuelta.
 *
 * Es aparte de `loQueFaltaParaCrear` porque es otra clase de problema. Aquello
 * dice que falta un dato; esto dice que los dos que hay se contradicen, y un
 * "Falta cargar la fecha de fin" cuando la fecha esta cargada seria mentira.
 */
describe("lo que se contradice en una orden nueva", () => {
  it("una ventana al derecho no se queja", () => {
    expect(loQueSeContradice({ ...completa, fecha_fin: "2026-10-25" })).toEqual([]);
  });

  it("terminar el mismo dia que empieza esta bien", () => {
    expect(loQueSeContradice({ ...completa, fecha_fin: "2026-10-20" })).toEqual([]);
  });

  it("la fecha de fin anterior a la de inicio se nombra con las dos fechas", () => {
    expect(loQueSeContradice({ ...completa, fecha_fin: "2026-10-19" }))
      .toEqual(["la fecha de fin (2026-10-19) es anterior a la de inicio (2026-10-20)"]);
  });

  /** Es opcional: sin ella no hay nada que contradecir. */
  it("sin fecha de fin no hay problema", () => {
    expect(loQueSeContradice(completa)).toEqual([]);
    expect(loQueSeContradice({ ...completa, fecha_fin: "" })).toEqual([]);
  });

  /** Sin fecha de inicio el que habla es `loQueFaltaParaCrear`, no este. */
  it("sin fecha de inicio no opina", () => {
    expect(loQueSeContradice({ ...completa, fecha_ejecucion: "", fecha_fin: "2026-10-19" }))
      .toEqual([]);
  });

  /**
   * Y tambien mira la de cierre, que es la otra fecha que no puede ir antes
   * del inicio. Es `loQueImpideCerrar`, la misma funcion que corre el PATCH:
   * una orden que nace cerrada y una que se cierra despues dicen lo mismo.
   */
  it("una orden que nace cerrada antes de empezar no pasa", () => {
    expect(loQueSeContradice({ ...completa, fecha_cierre: "2026-10-19" }))
      .toEqual(["la fecha de cierre (2026-10-19) es anterior a la de inicio (2026-10-20)"]);
  });

  /**
   * Desde el 12/11/2026 ese bloqueo cede si hay un motivo que explica, y la
   * justificacion le llega por esta funcion: sin pasarsela, el alta mostraria
   * el campo que pide el motivo y el cartel rojo al mismo tiempo.
   */
  it("con justificacion, nacer cerrada antes de empezar deja de contradecirse", () => {
    expect(loQueSeContradice({
      ...completa,
      fecha_cierre: "2026-10-19",
      cierre_justificacion: "El equipo fallo antes y se intervino",
    })).toEqual([]);
  });

  /**
   * Y la de fin NO cede, que es la mitad que nadie pidio dar vuelta: es la
   * ventana estimada, no la real.
   */
  it("la justificacion no destraba la fecha de fin dada vuelta", () => {
    expect(loQueSeContradice({
      ...completa,
      fecha_fin: "2026-10-19",
      cierre_justificacion: "El equipo fallo antes y se intervino",
    })).toEqual(["la fecha de fin (2026-10-19) es anterior a la de inicio (2026-10-20)"]);
  });

  it("cerrar el mismo dia que empieza esta bien", () => {
    expect(loQueSeContradice({ ...completa, fecha_cierre: "2026-10-20" })).toEqual([]);
  });

  it("sin fecha de cierre no se mira nada del cierre", () => {
    expect(loQueSeContradice({ ...completa, fecha_cierre: "" })).toEqual([]);
  });

  /** Las dos juntas salen juntas, que es la vara de `validar()` del nucleo. */
  it("las dos fechas dadas vuelta se dicen de una sola vez", () => {
    expect(loQueSeContradice({
      ...completa, fecha_fin: "2026-10-18", fecha_cierre: "2026-10-19",
    })).toEqual([
      "la fecha de fin (2026-10-18) es anterior a la de inicio (2026-10-20)",
      "la fecha de cierre (2026-10-19) es anterior a la de inicio (2026-10-20)",
    ]);
  });
});

describe("que le falta a una orden nueva", () => {
  it("completa no falta nada", () => {
    expect(loQueFaltaParaCrear(completa)).toEqual([]);
  });

  it("nombra cada campo que falta, con el nombre que se ve en pantalla", () => {
    expect(loQueFaltaParaCrear({ ...completa, sector_id: "" })).toEqual(["el sector"]);
    expect(loQueFaltaParaCrear({ ...completa, equipment_id: "" })).toEqual(["el equipo"]);
    expect(loQueFaltaParaCrear({ ...completa, descripcion: "" })).toEqual(["la descripción"]);
    expect(loQueFaltaParaCrear({ ...completa, especialidad: "" })).toEqual(["la especialidad"]);
    expect(loQueFaltaParaCrear({ ...completa, tipo: "" })).toEqual(["el tipo de trabajo"]);
    expect(loQueFaltaParaCrear({ ...completa, quien: "" })).toEqual(["quién lo realiza"]);
    expect(loQueFaltaParaCrear({ ...completa, fecha_ejecucion: "" }))
      .toEqual(["la fecha de inicio"]);
    expect(loQueFaltaParaCrear({ ...completa, fecha_fin: "" }))
      .toEqual(["la fecha de fin estimada"]);
  });

  /**
   * La clave AUSENTE cuenta como faltante, igual que la vacia. Es el caso de
   * una carga sin senal encolada antes de que el campo existiera: vuelve sin
   * la clave, y tiene que recibir un 400 que la nombre en vez de pasar.
   *
   * El `as never` es a proposito: el tipo exige la clave justamente para que
   * nadie la omita por descuido —el dia que se volvio obligatoria, la ruta del
   * alta la omitia y habria rechazado todas las ordenes—. Acá se omite a
   * sabiendas, para probar que en tiempo de ejecucion tambien se defiende.
   */
  it("una carga vieja sin la clave tambien la pide", () => {
    const { fecha_fin: _, ...sinLaClave } = completa;
    expect(loQueFaltaParaCrear(sinLaClave as never)).toEqual(["la fecha de fin estimada"]);
  });

  /** La vara de `validar()` del nucleo: todo junto, no de a uno. */
  it("dice todo lo que falta de una sola vez, y en el orden del formulario", () => {
    expect(loQueFaltaParaCrear({
      ...completa, sector_id: "", especialidad: "", fecha_ejecucion: "",
    })).toEqual(["el sector", "la especialidad", "la fecha de inicio"]);
  });

  it("los espacios no cuentan como cargado", () => {
    expect(loQueFaltaParaCrear({ ...completa, descripcion: "   " }))
      .toEqual(["la descripción"]);
  });

  /**
   * Y arrastra lo del cierre: si ademas trae fecha de cierre, las horas y
   * quien la hizo se exigen por el mismo camino. Una sola lista y un solo
   * mensaje — que el campo sea obligatorio siempre o solo al cerrar es una
   * distincion del codigo, no de quien completa.
   */
  it("con fecha de cierre suma lo que el cierre exige", () => {
    const r = loQueFaltaParaCrear({
      ...completa, fecha_cierre: "2026-10-20", horas: "", operario_1: "",
    });
    expect(r).toContain("las horas que llevó");
    expect(r).toContain("al menos un operario");
  });

  it("sin fecha de cierre no exige nada del cierre", () => {
    expect(loQueFaltaParaCrear(completa)).toEqual([]);
  });

  it("junta las dos listas en una sola", () => {
    const r = loQueFaltaParaCrear({
      ...completa, sector_id: "", fecha_cierre: "2026-10-20", horas: "",
      operario_1: "Aguirre",
    });
    expect(r).toEqual(["el sector", "las horas que llevó"]);
  });

  it("con el cierre anterior al inicio pide la justificacion", () => {
    expect(loQueFaltaParaCrear({
      ...completa, fecha_ejecucion: "2026-10-20", fecha_cierre: "2026-10-18",
      horas: "4", operario_1: "Aguirre",
    })).toEqual(["por qué se cerró antes de la fecha de inicio"]);
  });

  it("con la justificacion cargada no pide nada", () => {
    expect(loQueFaltaParaCrear({
      ...completa, fecha_ejecucion: "2026-10-20", fecha_cierre: "2026-10-18",
      horas: "4", operario_1: "Aguirre",
      cierre_justificacion: "El equipo fallo antes y se intervino",
    })).toEqual([]);
  });

  // Un solo mensaje y no tres pantallas: es la vara de `validar()` del nucleo.
  it("sale junto con todo lo demas que falte, en el orden del formulario", () => {
    expect(loQueFaltaParaCrear({
      ...completa, sector_id: "", fecha_ejecucion: "2026-10-20",
      fecha_cierre: "2026-10-18", horas: "", operario_1: "Aguirre",
    })).toEqual([
      "el sector", "las horas que llevó", "por qué se cerró antes de la fecha de inicio",
    ]);
  });
});
