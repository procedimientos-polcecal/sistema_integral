import { describe, it, expect } from "vitest";
import { MAXIMO_DE_DIAS, loQueFaltaParaPostergar } from "./postergar";
import { RAZON_DEL_PLAN, justificacionDelPlan, queHacerConElItem } from "./planAlCalendario";

const ITEM = { ot_number: 2951 };

/** «Hoy» es el 04/11/2026: todas las fechas de abajo son de hoy en adelante, salvo las que dicen lo contrario. */
const HOY = "2026-11-04";

function orden(extra: Partial<Parameters<typeof queHacerConElItem>[1] & object> = {}) {
  return {
    fecha_ejecucion: "2026-11-06",
    fecha_ejecucion_pendiente: null,
    fecha_cierre: null,
    estado: "PENDIENTE",
    app_created: true,
    ...extra,
  };
}

describe("que hacer con cada item del plan", () => {
  it("si las fechas coinciden, se manda y listo", () => {
    expect(queHacerConElItem(ITEM, orden(), "2026-11-06", HOY)).toEqual({ que: "mandar", fecha: "2026-11-06" });
  });

  it("coincidir no depende de quien la creo: una del formulario tambien se manda sin mas", () => {
    expect(queHacerConElItem(ITEM, orden({ app_created: false }), "2026-11-06", HOY).que).toBe("mandar");
  });

  it("si el plan es posterior y la OT es del SdG, se le corre la fecha", () => {
    expect(queHacerConElItem(ITEM, orden(), "2026-11-10", HOY)).toEqual({
      que: "correr-y-mandar", dias: 4, fecha: "2026-11-10",
    });
  });

  it("cruza el fin de mes sin perder un dia", () => {
    const r = queHacerConElItem(ITEM, orden({ fecha_ejecucion: "2026-11-28" }), "2026-12-02", HOY);
    expect(r).toEqual({ que: "correr-y-mandar", dias: 4, fecha: "2026-12-02" });
  });

  /** Postergar exige `dias > 0`: adelantar una fecha no es postergarla. */
  it("si el plan es ANTERIOR, se manda en la fecha de la OT avisando", () => {
    const r = queHacerConElItem(ITEM, orden(), "2026-11-02", HOY);
    expect(r.que).toBe("mandar-avisando");
    if (r.que !== "mandar-avisando") return;
    expect(r.fecha).toBe("2026-11-06");
    expect(r.aviso).toContain("02/11/2026");
    expect(r.aviso).toContain("06/11/2026");
  });

  it("si la OT vino del formulario, se manda en su fecha avisando", () => {
    for (const app_created of [false, null]) {
      const r = queHacerConElItem(ITEM, orden({ app_created }), "2026-11-10", HOY);
      expect(r.que).toBe("mandar-avisando");
      if (r.que !== "mandar-avisando") continue;
      expect(r.fecha).toBe("2026-11-06");
      // Nombra el bloqueo: su fecha se cambia en la planilla.
      expect(r.aviso).toMatch(/formulario/i);
      expect(r.aviso).toMatch(/planilla/i);
      expect(r.aviso).toContain("10/11/2026");
    }
  });

  it("una OT cerrada se saltea diciendolo, por las dos puntas", () => {
    for (const cerrada of [{ fecha_cierre: "2026-11-01" }, { estado: "REALIZADO" }]) {
      const r = queHacerConElItem(ITEM, orden(cerrada), "2026-11-10", HOY);
      expect(r.que).toBe("saltear");
      if (r.que !== "saltear") continue;
      expect(r.motivo).toMatch(/cerrada/i);
    }
  });

  it("una OT sin ninguna fecha se saltea: no hay de donde correrla", () => {
    const r = queHacerConElItem(ITEM, orden({ fecha_ejecucion: null }), "2026-11-10", HOY);
    expect(r.que).toBe("saltear");
    if (r.que !== "saltear") return;
    expect(r.motivo).toMatch(/fecha/i);
  });

  /** Review Focus 5: la OT se borro entre que se abrio la pantalla y el boton. */
  it("un item cuya OT ya no existe se saltea y no rompe el lote", () => {
    const r = queHacerConElItem({ ot_number: 2951 }, null, "2026-11-06", HOY);
    expect(r.que).toBe("saltear");
    if (r.que !== "saltear") return;
    expect(r.motivo).toContain("2951");
  });

  /** MAXIMO_DE_DIAS es 90: mas lejos, postergar lo rechaza. */
  it("una diferencia mayor al maximo se manda avisando, no se intenta correr", () => {
    // 2026-11-06 + 91 dias = 2027-02-05
    const r = queHacerConElItem(ITEM, orden(), "2027-02-05", HOY);
    expect(r.que).toBe("mandar-avisando");
    if (r.que !== "mandar-avisando") return;
    expect(r.fecha).toBe("2026-11-06");
    expect(r.aviso).toContain(String(MAXIMO_DE_DIAS));
  });

  it("justo en el maximo todavia se corre", () => {
    // 2026-11-06 + 90 dias = 2027-02-04
    expect(queHacerConElItem(ITEM, orden(), "2027-02-04", HOY)).toEqual({
      que: "correr-y-mandar", dias: 90, fecha: "2027-02-04",
    });
  });

  /**
   * La fecha de la OT es la que manda el calendario: la pendiente, si la hay.
   * Una recien postergada ya esta para otro dia aunque `fecha_ejecucion` no lo
   * diga todavia en el master.
   */
  it("la fecha de la OT es la pendiente cuando la hay", () => {
    const o = orden({ fecha_ejecucion: "2026-11-06", fecha_ejecucion_pendiente: "2026-11-10" });
    expect(queHacerConElItem(ITEM, o, "2026-11-10", HOY)).toEqual({ que: "mandar", fecha: "2026-11-10" });
  });
});

describe("una fecha que ya paso no se manda, venga por donde venga", () => {
  /**
   * `mandarLaOTAlCalendario` rechaza el pasado sólo con `turno: null`; con
   * turno elegido a mano no lo mira. Sin esto, en una misma corrida unos
   * ítems fallaban con «la fecha ya pasó» y otros creaban un evento en el
   * pasado, según si la orden tenía el turno puesto. Se decide acá, una vez.
   */
  const VIEJA = "2026-09-15";

  it("la orden del formulario con fecha vieja se saltea: no hay dia futuro al que mandarla", () => {
    const r = queHacerConElItem(ITEM, orden({ fecha_ejecucion: VIEJA, app_created: false }), "2026-11-10", HOY);
    expect(r.que).toBe("saltear");
    if (r.que !== "saltear") return;
    expect(r.motivo).toContain("15/09/2026");
    expect(r.motivo).toMatch(/pas/i);
    // Y sigue diciendo por qué el plan no la pudo mover.
    expect(r.motivo).toMatch(/formulario/i);
  });

  it("un plan de ayer sobre una orden de ayer se saltea", () => {
    const r = queHacerConElItem(ITEM, orden({ fecha_ejecucion: "2026-11-03" }), "2026-11-03", HOY);
    expect(r.que).toBe("saltear");
  });

  it("la de hoy todavia entra: el filtro es por dia y no por hora", () => {
    expect(queHacerConElItem(ITEM, orden({ fecha_ejecucion: HOY }), HOY, HOY)).toEqual({ que: "mandar", fecha: HOY });
  });

  it("una orden vieja del SdG que el plan lleva a un dia futuro se corre y se manda", () => {
    const r = queHacerConElItem(ITEM, orden({ fecha_ejecucion: "2026-11-01" }), "2026-11-10", HOY);
    expect(r).toEqual({ que: "correr-y-mandar", dias: 9, fecha: "2026-11-10" });
  });

  it("si correrla dejaria a la orden en el pasado, se saltea", () => {
    // Orden de septiembre, plan de octubre: 'posterior', pero igual pasado.
    const r = queHacerConElItem(ITEM, orden({ fecha_ejecucion: "2026-09-20" }), "2026-10-05", HOY);
    expect(r.que).toBe("saltear");
  });

  it("un plan anterior sobre una orden futura se manda en la de la orden: el destino no es pasado", () => {
    const r = queHacerConElItem(ITEM, orden({ fecha_ejecucion: "2026-11-06" }), "2026-10-01", HOY);
    expect(r.que).toBe("mandar-avisando");
  });

  it("pasado el maximo de dias sobre una orden vieja, se saltea", () => {
    const r = queHacerConElItem(ITEM, orden({ fecha_ejecucion: "2026-05-01" }), "2026-11-10", HOY);
    expect(r.que).toBe("saltear");
  });
});

describe("lo que el plan le pide a postergar", () => {
  it("la razon propia no es la de falta de repuesto", () => {
    expect(RAZON_DEL_PLAN).toBe("planificacion_del_dia");
    expect(RAZON_DEL_PLAN).not.toBe("falta_repuesto");
  });

  it("la justificacion dice a que plan se movio, en dia/mes/anio", () => {
    expect(justificacionDelPlan("2026-11-06")).toBe("Movida al plan del 06/11/2026.");
  });

  /** Postergar la rechaza si falta algo: lo que arma el plan tiene que pasar. */
  it("razon, dias y justificacion del plan satisfacen a postergar", () => {
    const r = queHacerConElItem(ITEM, orden(), "2026-11-10", HOY);
    if (r.que !== "correr-y-mandar") throw new Error("se esperaba correr-y-mandar");
    expect(
      loQueFaltaParaPostergar({ razon: RAZON_DEL_PLAN, dias: r.dias, justificacion: justificacionDelPlan("2026-11-10") })
    ).toEqual([]);
  });
});
