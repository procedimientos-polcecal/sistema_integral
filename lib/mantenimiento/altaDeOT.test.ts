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
  fecha_cierre: "",
  horas: "",
  contratista: "",
  operario_1: "",
  operario_2: "",
  operario_3: "",
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
});
