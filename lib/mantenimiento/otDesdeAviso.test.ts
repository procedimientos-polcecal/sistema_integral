import { describe, it, expect } from "vitest";
import {
  loQuePropone, loQueElAvisoNoTrae, sembradoDesdeElAviso, extrasDelAviso,
  type AvisoParaLaOT,
} from "./otDesdeAviso";
import { PRIORIDADES_DE_OT } from "./filtrosOt";

/**
 * Un aviso como los que entraron el 20/10/2026: con equipo y sector
 * enlazados, urgencia media, y nada que diga de que especialidad es ni quien
 * lo va a hacer.
 */
const AVISO: AvisoParaLaOT = {
  id: "av-1",
  oa_number: "A180",
  descripcion: "TRANSMISION HORNO 4    SALTA LA CADENA",
  urgencia: "🟡 Media",
  sector_id: "sec-calcinacion",
  sector_raw: "Calcinación",
  equipment_id: "eq-27",
  equipo_raw: "PO-B1-27 – Cadena",
  equipo_code: "PO-B1-27",
  repuesto: null,
};

const DE_ENTRADA = { quien: "INTERNO", fecha_ejecucion: "2026-10-23" };
const propuesto = () => loQuePropone(AVISO, DE_ENTRADA);

describe("con qué arranca el formulario", () => {
  it("el aviso llena lo que sabe", () => {
    const p = propuesto();
    expect(p.descripcion).toBe("TRANSMISION HORNO 4    SALTA LA CADENA");
    expect(p.sector_id).toBe("sec-calcinacion");
    expect(p.equipment_id).toBe("eq-27");
    expect(p.equipo_raw).toBe("PO-B1-27 – Cadena");
  });

  /** Alguien reporto una falla: no es un preventivo programado. */
  it("correctiva", () => {
    expect(propuesto().tipo).toBe("CORRECTIVO");
  });

  /**
   * La urgencia la traduce `prioridadDeUrgencia` y el emoji se lo pone
   * `prioridadParaLaPlanilla`: son DOS traducciones encadenadas y las dos
   * tienen que correr acá, porque lo que sale de esta funcion lo muestra el
   * desplegable de `NuevaOTModal`. Inventar el emoji al lado saltearia la
   * segunda, que es lo que el 16/10 dejo OT que el filtro no encontraba.
   */
  it("la prioridad sale de la urgencia, en el vocabulario de la planilla", () => {
    expect(propuesto().prioridad).toBe("🟡 Media");
    expect(loQuePropone({ ...AVISO, urgencia: "🟠 Alta" }, DE_ENTRADA).prioridad).toBe("🟠 Alta");
    expect(loQuePropone({ ...AVISO, urgencia: "🟢 Baja" }, DE_ENTRADA).prioridad).toBe("🟢 Baja");
    expect(loQuePropone({ ...AVISO, urgencia: null }, DE_ENTRADA).prioridad).toBe("🟡 Media");
  });

  it("un aviso sin descripcion se nombra por su numero, no queda vacio", () => {
    expect(loQuePropone({ ...AVISO, descripcion: null }, DE_ENTRADA).descripcion)
      .toBe("Aviso A180");
  });

  /** El aviso no da ni un indicio: acertarle de memoria seria adivinar. */
  it("la especialidad arranca vacia", () => {
    expect(propuesto().especialidad).toBe("");
  });
});

describe("lo que el aviso no trae", () => {
  /**
   * Ya no es un callejon sin salida —el sector y el equipo se eligen en el
   * formulario—, pero se nombra igual: no es lo mismo corregir un dato que
   * inventarlo, y cuando el aviso no trajo equipo nadie lo verifico.
   */
  it("se dice cuando el aviso llego sin equipo o sin sector", () => {
    expect(loQueElAvisoNoTrae({ ...AVISO, equipment_id: null })).toEqual(["el equipo"]);
    expect(loQueElAvisoNoTrae({ ...AVISO, sector_id: null })).toEqual(["el sector"]);
    expect(loQueElAvisoNoTrae({ ...AVISO, sector_id: null, equipment_id: null }))
      .toEqual(["el sector", "el equipo"]);
  });

  it("un aviso completo no tiene nada de eso", () => {
    expect(loQueElAvisoNoTrae(AVISO)).toEqual([]);
  });
});

/**
 * NADIE HEREDA UN PUNTAJE. La urgencia del aviso la puso quien reportó la
 * falla; el GUT lo contesta quien reparte el trabajo. Sembrar uno desde el
 * otro pondría en el orden una nota que nadie contestó, pesando igual que una
 * que sí.
 */
describe("el puntaje GUT no sale del aviso", () => {
  it("arranca vacío, con la urgencia que sea", () => {
    for (const urgencia of ["🟠 Alta", "🟡 Media", "🟢 Baja", null]) {
      const p = loQuePropone({ ...AVISO, urgencia }, DE_ENTRADA);
      expect(p.gut_gravedad).toBe("");
      expect(p.gut_urgencia).toBe("");
      expect(p.gut_tendencia).toBe("");
    }
  });
});

describe("lo que el aviso siembra", () => {
  const AVISO: AvisoParaLaOT = {
    id: "av-1", oa_number: "A123", descripcion: "TRANSMISION HORNO 4 SALTA LA CADENA",
    urgencia: "ALTA", sector_id: "sec-1", sector_raw: "Molienda",
    equipment_id: "eq-1", equipo_raw: "M2 – Molino 2", equipo_code: "M2",
    repuesto: "cadena",
  };

  it("siembra lo que el aviso sabe y nada más", () => {
    const s = sembradoDesdeElAviso(AVISO, "2026-11-19");
    expect(s.descripcion).toBe("TRANSMISION HORNO 4 SALTA LA CADENA");
    expect(s.sector_id).toBe("sec-1");
    expect(s.equipment_id).toBe("eq-1");
    expect(s.tipo).toBe("CORRECTIVO");
    expect(s.quien).toBe("INTERNO");
    expect(s.fecha_ejecucion).toBe("2026-11-19");
    // Lo que el aviso no sabe NO viaja: pisaría el valor por defecto del
    // formulario con un vacío que nadie eligió. (Review Focus 4)
    expect(s).not.toHaveProperty("especialidad");
    expect(s).not.toHaveProperty("fecha_fin");
    expect(s).not.toHaveProperty("gut_gravedad");
    expect(s).not.toHaveProperty("estado");
    expect(s).not.toHaveProperty("contratista");
  });

  // Review Focus 2
  it("sin descripción cae en el número del aviso y nunca en vacío", () => {
    const s = sembradoDesdeElAviso({ ...AVISO, descripcion: "   " }, "2026-11-19");
    expect(s.descripcion).toBe("Aviso A123");
  });

  /*
   * EL CONTRATO QUE FALTABA, Y POR ESO ESTO LLEGÓ A LA REVISIÓN FINAL. Acá
   * decía `expect(s.prioridad).toBe(prioridadDeUrgencia(u))`, o sea el sembrado
   * contra su propia fuente: da verde pase lo que pase, incluso —como pasaba—
   * con un valor que el desplegable no tiene y que abría el campo en blanco.
   *
   * La pregunta correcta no es de dónde sale sino **si quien lo va a mostrar lo
   * conoce**, así que se le pregunta a `PRIORIDADES_DE_OT`, que es la lista que
   * renderiza `NuevaOTModal`. Con las tres urgencias y con una que no existe:
   * una desconocida cae en MEDIA, y eso también tiene que ser mostrable.
   */
  it("el valor sembrado existe en el desplegable que lo va a mostrar", () => {
    for (const u of ["🟠 Alta", "🟡 Media", "🟢 Baja", null, "", "URGENTÍSIMO"]) {
      const s = sembradoDesdeElAviso({ ...AVISO, urgencia: u }, "2026-11-19");
      expect(PRIORIDADES_DE_OT).toContain(s.prioridad);
    }
  });

  // Review Focus 1
  it("un aviso sin sector ni equipo nombra los dos", () => {
    const sinNada = { ...AVISO, sector_id: null, equipment_id: null };
    expect(loQueElAvisoNoTrae(sinNada)).toEqual(["el sector", "el equipo"]);
    const s = sembradoDesdeElAviso(sinNada, "2026-11-19");
    expect(s.sector_id).toBe("");
    expect(s.equipment_id).toBe("");
  });

  /*
   * Review Focus 5: el enlace no vive en el estado del formulario.
   *
   * Y EL `repuesto` NO VIAJA, aunque el aviso lo tenga. El formulario completo
   * manda `repuestos` —un arreglo, siempre— y `repuestosDelCuerpo` mira
   * `body.repuesto` sólo cuando no hay arreglo, así que mandarlo era mandar un
   * campo que la ruta descarta. Antes esto afirmaba lo contrario y daba verde.
   */
  it("los extras llevan el aviso y nada más", () => {
    expect(extrasDelAviso(AVISO)).toEqual({ aviso_id: "av-1" });
    expect(extrasDelAviso(AVISO)).not.toHaveProperty("repuesto");
  });
});
