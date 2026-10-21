import { describe, it, expect } from "vitest";
import {
  cuerpoDeLaOT, loQueFaltaDelAviso, loQueHayQuePreguntar, loQueNoSeArreglaAca,
  RESPUESTAS_VACIAS, type AvisoParaLaOT,
} from "./otDesdeAviso";

/**
 * Un aviso como los cuatro que entraron el 20/10/2026: con equipo y sector
 * enlazados, urgencia media, y nada que diga de que especialidad es ni quien
 * lo va a hacer.
 */
const AVISO: AvisoParaLaOT = {
  id: "av-1",
  oa_number: "A180",
  descripcion: "TRANSMISION HORNO 4 SALTA LA CADENA",
  urgencia: "🟡 Media",
  sector_id: "sec-calcinacion",
  sector_raw: "Calcinación",
  equipment_id: "eq-27",
  equipo_raw: "PO-B1-27 – Cadena",
  equipo_code: "PO-B1-27",
  repuesto: null,
};

const RESPUESTAS = {
  especialidad: "MECÁNICO", quien: "INTERNO", fecha_ejecucion: "2026-10-23",
};

describe("lo que el aviso ya contesta", () => {
  it("arrastra el equipo, el sector y la descripcion sin volver a preguntarlos", () => {
    const c = cuerpoDeLaOT(AVISO, RESPUESTAS);
    expect(c.equipment_id).toBe("eq-27");
    expect(c.sector_id).toBe("sec-calcinacion");
    expect(c.equipo_raw).toBe("PO-B1-27 – Cadena");
    expect(c.descripcion).toBe("TRANSMISION HORNO 4 SALTA LA CADENA");
    expect(c.aviso_id).toBe("av-1");
  });

  /** Alguien reporto una falla: no es un preventivo programado. */
  it("nace correctiva y por hacer", () => {
    const c = cuerpoDeLaOT(AVISO, RESPUESTAS);
    expect(c.tipo).toBe("CORRECTIVO");
    expect(c.estado).toBe("POR_HACER");
  });

  /**
   * Por `prioridadDeUrgencia`, que es la traduccion que ya existia, y que
   * devuelve la palabra pelada: "MEDIA". El emoji se lo pone la ruta con
   * `prioridadParaLaPlanilla`, una sola vez y antes de sus dos usos, para que
   * la base y la planilla no queden con dos formas de lo mismo.
   *
   * O sea que son DOS traducciones encadenadas y no una: urgencia → palabra
   * aca, palabra → emoji alla. Este test fija la primera; la segunda la fija
   * `prioridad.test.ts`. Inventar aca el emoji saltearia la segunda.
   */
  it("la prioridad sale de la urgencia, con la traduccion que ya habia", () => {
    expect(cuerpoDeLaOT(AVISO, RESPUESTAS).prioridad).toBe("MEDIA");
    expect(cuerpoDeLaOT({ ...AVISO, urgencia: "🟠 Alta" }, RESPUESTAS).prioridad).toBe("ALTA");
    expect(cuerpoDeLaOT({ ...AVISO, urgencia: null }, RESPUESTAS).prioridad).toBe("MEDIA");
  });

  it("un aviso sin descripcion se nombra por su numero, no queda vacio", () => {
    const c = cuerpoDeLaOT({ ...AVISO, descripcion: null }, RESPUESTAS);
    expect(c.descripcion).toBe("Aviso A180");
  });

  /**
   * Se pide trabajo, no se carga trabajo hecho. Van explicitos para que
   * `loQueFaltaParaCrear` vea lo mismo aca que en el servidor: si llegaran
   * `undefined`, el cierre no se exigiria de este lado y el 400 saldria
   * recien al guardar.
   */
  it("no nace cerrada", () => {
    const c = cuerpoDeLaOT(AVISO, RESPUESTAS);
    expect(c.fecha_cierre).toBe("");
    expect(c.horas).toBe("");
    expect(c.operario_1).toBe("");
  });
});

describe("lo que hay que preguntar", () => {
  /**
   * EL BUG DEL 19/10/2026. El boton mandaba seis campos y ninguno de estos
   * tres, asi que desde ese dia contestaba "Falta cargar la especialidad,
   * quien lo realiza, la fecha de ejecucion" y no generaba nada.
   */
  it("son exactamente los tres que el aviso no puede contestar", () => {
    expect(loQueHayQuePreguntar(AVISO))
      .toEqual(["la especialidad", "quién lo realiza", "la fecha de ejecución"]);
  });

  /**
   * Y ESTE ES EL TEST QUE IMPIDE QUE VUELVA A PASAR. La lista no esta escrita
   * en el formulario: sale de `loQueFaltaParaCrear`, la misma funcion que
   * corre el servidor. Si manana la regla exige un campo mas, aparece aca y el
   * formulario lo pide solo — este test se pone rojo y nombra el campo nuevo,
   * en vez de que el boton empiece a fallar en silencio.
   */
  it("la lista sale de la regla compartida y no de una copia", () => {
    const preguntas = loQueHayQuePreguntar(AVISO);
    // Con todo contestado no queda nada: o sea que preguntar eso alcanza.
    expect(loQueFaltaDelAviso(AVISO, RESPUESTAS)).toEqual([]);
    // Y cada una de las preguntas es, de verdad, algo que falta.
    for (const p of preguntas) {
      expect(loQueFaltaDelAviso(AVISO, RESPUESTAS_VACIAS)).toContain(p);
    }
  });

  it("contestando de a una, la lista se achica", () => {
    expect(loQueFaltaDelAviso(AVISO, { ...RESPUESTAS_VACIAS, especialidad: "CIVIL" }))
      .toEqual(["quién lo realiza", "la fecha de ejecución"]);
    expect(loQueFaltaDelAviso(AVISO, { ...RESPUESTAS, fecha_ejecucion: "" }))
      .toEqual(["la fecha de ejecución"]);
  });

  it("los espacios no cuentan como contestado", () => {
    expect(loQueFaltaDelAviso(AVISO, { ...RESPUESTAS, especialidad: "   " }))
      .toEqual(["la especialidad"]);
  });
});

describe("lo que el formulario no puede arreglar", () => {
  /**
   * El enlace se arregla en el aviso o en la planilla. Ponerle un desplegable
   * de equipos a esta pantalla dejaria al aviso mintiendo sobre a que maquina
   * se refiere: la OT diria una cosa y el aviso otra.
   */
  it("un aviso sin equipo no se convierte desde aca, y se dice", () => {
    expect(loQueNoSeArreglaAca({ ...AVISO, equipment_id: null })).toEqual(["el equipo"]);
    expect(loQueNoSeArreglaAca({ ...AVISO, sector_id: null })).toEqual(["el sector"]);
    expect(loQueNoSeArreglaAca({ ...AVISO, sector_id: null, equipment_id: null }))
      .toEqual(["el sector", "el equipo"]);
  });

  it("un aviso completo no tiene nada de eso", () => {
    expect(loQueNoSeArreglaAca(AVISO)).toEqual([]);
  });

  /** Y aparecen igual en la lista general: son obligatorios como los demas. */
  it("tambien los nombra la regla compartida", () => {
    expect(loQueHayQuePreguntar({ ...AVISO, equipment_id: null })).toContain("el equipo");
  });
});
