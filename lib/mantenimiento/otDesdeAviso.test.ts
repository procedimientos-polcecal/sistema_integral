import { describe, it, expect } from "vitest";
import {
  cuerpoDeLaOT, loQuePropone, loQueFaltaDelAviso, loQueHayQuePreguntar,
  loQueElAvisoNoTrae, RESPUESTAS_VACIAS, sembradoDesdeElAviso, extrasDelAviso,
  type AvisoParaLaOT,
} from "./otDesdeAviso";
import { prioridadDeUrgencia } from "./avisos";

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
// La especialidad y la fecha de fin son las dos que el aviso no puede
// contestar de ninguna manera: una no tiene de donde salir, y la otra es una
// estimacion de quien va a hacer el trabajo.
const completo = () => ({
  ...propuesto(), especialidad: "MECÁNICO", fecha_fin: "2026-10-24",
});

describe("con qué arranca el formulario", () => {
  it("el aviso llena lo que sabe", () => {
    const p = propuesto();
    expect(p.descripcion).toBe("TRANSMISION HORNO 4    SALTA LA CADENA");
    expect(p.sector_id).toBe("sec-calcinacion");
    expect(p.equipment_id).toBe("eq-27");
    expect(p.equipo_raw).toBe("PO-B1-27 – Cadena");
  });

  /** Alguien reporto una falla: no es un preventivo programado. */
  it("correctiva, y por hacer", () => {
    expect(propuesto().tipo).toBe("CORRECTIVO");
    expect(cuerpoDeLaOT(AVISO, completo()).estado).toBe("POR_HACER");
  });

  /**
   * `prioridadDeUrgencia` devuelve la palabra pelada; el emoji se lo pone la
   * ruta con `prioridadParaLaPlanilla`, una sola vez y antes de sus dos usos.
   * Son DOS traducciones encadenadas: inventar aca el emoji saltearia la
   * segunda, que es lo que el 16/10 dejo OT que el filtro no encontraba.
   */
  it("la prioridad sale de la urgencia, con la traduccion que ya habia", () => {
    expect(propuesto().prioridad).toBe("MEDIA");
    expect(loQuePropone({ ...AVISO, urgencia: "🟠 Alta" }, DE_ENTRADA).prioridad).toBe("ALTA");
    expect(loQuePropone({ ...AVISO, urgencia: null }, DE_ENTRADA).prioridad).toBe("MEDIA");
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

describe("lo que se escribe es lo que se guarda", () => {
  /**
   * EL PEDIDO DEL 21/10/2026. Un aviso lo escribe quien ve la falla, con las
   * palabras que tiene a mano; la OT la lee despues quien la va a hacer. Que
   * el texto del aviso fuera ademas, sin tocar, el de la orden obligaba a
   * elegir entre dejar la orden mal escrita o no usar el boton.
   */
  it("la descripcion corregida es la que va a la orden", () => {
    const c = cuerpoDeLaOT(AVISO, {
      ...completo(),
      descripcion: "Ajustar transmisión del horno 4: salta la cadena",
    });
    expect(c.descripcion).toBe("Ajustar transmisión del horno 4: salta la cadena");
  });

  /** Es la estimacion; la real es la de cierre, que aca va siempre vacia. */
  it("la fecha de fin viaja en el cuerpo", () => {
    const c = cuerpoDeLaOT(AVISO, { ...completo(), fecha_fin: "2026-10-25" });
    expect(c.fecha_fin).toBe("2026-10-25");
  });

  /**
   * Obligatoria desde el 04/11/2026, pero armar el cuerpo no es validarlo: una
   * carga sin senal encolada antes de que el campo existiera vuelve SIN esa
   * clave, y tiene que poder armarse igual para que el 400 lo dé la regla y
   * nombre el campo, en vez de reventar antes con un `undefined`.
   */
  it("sin la clave viaja vacia y no rompe nada", () => {
    const { fecha_fin: _, ...sinLaClave } = completo();
    expect(cuerpoDeLaOT(AVISO, sinLaClave as never).fecha_fin).toBe("");
  });

  it("tambien el tipo, la prioridad, el sector y el equipo", () => {
    const c = cuerpoDeLaOT(AVISO, {
      ...completo(),
      tipo: "PROGRAMADO", prioridad: "ALTA",
      sector_id: "sec-otro", sector_raw: "Hidratación",
      equipment_id: "eq-99", equipo_raw: "PO-C1-06 – Elevador", equipo_code: "PO-C1-06",
    });
    expect(c.tipo).toBe("PROGRAMADO");
    expect(c.prioridad).toBe("ALTA");
    expect(c.sector_raw).toBe("Hidratación");
    expect(c.equipo_raw).toBe("PO-C1-06 – Elevador");
    expect(c.equipo_code).toBe("PO-C1-06");
  });

  /**
   * Lo unico que NO se edita, y por que: el aviso al que pertenece —para que
   * quede apuntando a su orden y nadie genere una segunda— y el repuesto, que
   * tiene su propia pantalla con renglones y cantidades.
   */
  it("el aviso al que pertenece no se puede cambiar", () => {
    const c = cuerpoDeLaOT(AVISO, completo());
    expect(c.aviso_id).toBe("av-1");
    expect(c.repuesto).toBeNull();
  });

  it("los espacios de mas no viajan", () => {
    const c = cuerpoDeLaOT(AVISO, { ...completo(), descripcion: "  Ajustar la cadena  " });
    expect(c.descripcion).toBe("Ajustar la cadena");
  });

  it("un campo vaciado viaja como null y no como cadena vacia", () => {
    const c = cuerpoDeLaOT(AVISO, { ...completo(), equipment_id: "", equipo_raw: "" });
    expect(c.equipment_id).toBeNull();
    expect(c.equipo_raw).toBeNull();
  });

  /**
   * Se pide trabajo, no se carga trabajo hecho. Van explicitos para que
   * `loQueFaltaParaCrear` vea lo mismo aca que en el servidor: si llegaran
   * `undefined`, el cierre no se exigiria de este lado y el 400 saldria recien
   * al guardar.
   */
  it("no nace cerrada", () => {
    const c = cuerpoDeLaOT(AVISO, completo());
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
  it("son los que no vienen de ningun lado", () => {
    expect(loQueHayQuePreguntar(AVISO)).toContain("la especialidad");
    expect(loQueHayQuePreguntar(AVISO)).toContain("quién lo realiza");
    expect(loQueHayQuePreguntar(AVISO)).toContain("la fecha de inicio");
  });

  /**
   * Y ESTE ES EL TEST QUE IMPIDE QUE VUELVA A PASAR. La lista no esta escrita
   * en el formulario: sale de `loQueFaltaParaCrear`, la misma funcion que
   * corre el servidor. Si manana la regla exige un campo mas, aparece aca y el
   * formulario lo pide solo — este test se pone rojo y lo nombra, en vez de
   * que el boton empiece a fallar en silencio.
   */
  it("la lista sale de la regla compartida y no de una copia", () => {
    // Con lo que el aviso propone mas la especialidad, no falta nada: o sea
    // que preguntar eso alcanza.
    expect(loQueFaltaDelAviso(AVISO, completo())).toEqual([]);
    // Y con el formulario en blanco, cada pregunta es de verdad algo que falta.
    const enBlanco = loQueFaltaDelAviso(AVISO, RESPUESTAS_VACIAS);
    for (const p of loQueHayQuePreguntar(AVISO)) expect(enBlanco).toContain(p);
  });

  it("contestando de a una, la lista se achica", () => {
    expect(loQueFaltaDelAviso(AVISO, { ...completo(), fecha_ejecucion: "" }))
      .toEqual(["la fecha de inicio"]);
    expect(loQueFaltaDelAviso(AVISO, { ...completo(), descripcion: "", especialidad: "" }))
      .toEqual(["la descripción", "la especialidad"]);
  });

  it("los espacios no cuentan como contestado", () => {
    expect(loQueFaltaDelAviso(AVISO, { ...completo(), especialidad: "   " }))
      .toEqual(["la especialidad"]);
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

  /** Y se puede crear igual, completandolo a mano: eso es lo que cambio. */
  it("un aviso sin equipo ya se puede convertir, eligiendolo", () => {
    const sinEquipo = { ...AVISO, equipment_id: null, equipo_raw: null, equipo_code: null };
    const elegido = {
      ...loQuePropone(sinEquipo, DE_ENTRADA),
      especialidad: "MECÁNICO", fecha_fin: "2026-10-24",
      equipment_id: "eq-27", equipo_raw: "PO-B1-27 – Cadena", equipo_code: "PO-B1-27",
    };
    expect(loQueFaltaDelAviso(sinEquipo, elegido)).toEqual([]);
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

  it("el cuerpo sin contestar manda las tres notas en null", () => {
    const cuerpo = cuerpoDeLaOT(AVISO, completo());
    expect(cuerpo.gut_gravedad).toBeNull();
    expect(cuerpo.gut_urgencia).toBeNull();
    expect(cuerpo.gut_tendencia).toBeNull();
  });

  it("lo que una persona elige viaja como número", () => {
    const cuerpo = cuerpoDeLaOT(AVISO, {
      ...completo(), gut_gravedad: "5", gut_urgencia: "4", gut_tendencia: "3",
    });
    expect([cuerpo.gut_gravedad, cuerpo.gut_urgencia, cuerpo.gut_tendencia]).toEqual([5, 4, 3]);
  });

  it("no es obligatorio: sin notas la orden se puede crear", () => {
    expect(loQueFaltaDelAviso(AVISO, completo())).toEqual([]);
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

  // Review Focus 3
  it("una urgencia que no conoce no inventa una prioridad ni rompe", () => {
    for (const u of [null, "", "URGENTÍSIMO"]) {
      const s = sembradoDesdeElAviso({ ...AVISO, urgencia: u }, "2026-11-19");
      expect(typeof s.prioridad).toBe("string");
      expect(s.prioridad).toBe(prioridadDeUrgencia(u));
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

  // Review Focus 5: el enlace no vive en el estado del formulario.
  it("los extras llevan el aviso y su repuesto", () => {
    expect(extrasDelAviso(AVISO)).toEqual({ aviso_id: "av-1", repuesto: "cadena" });
  });
});
