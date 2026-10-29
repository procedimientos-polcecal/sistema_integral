import { describe, it, expect } from "vitest";
import {
  cuerpoDeLaOT, loQueFaltaDelMantenimiento, loQueHayQuePreguntar, loQueNoSeArreglaAca,
  especialidadDeTipo, etiquetaDeTipo, nombreDelAsignado, respuestasIniciales,
  RESPUESTAS_VACIAS, TIPOS_DE_MANTENIMIENTO,
  loQueFaltaParaGenerar, especialidadDelProgramado,
  type MantenimientoParaLaOT,
} from "./otDesdeMantenimiento";
import { ESPECIALIDADES } from "./ordenes";
import { QUIENES_DE_OT } from "./filtrosOt";

/**
 * El único mantenimiento programado que existe, tal cual está en la base el
 * 21/10/2026. Se copia de ahí y no se inventa: los dos errores que este archivo
 * fija salen justamente de lo que esta fila tiene y no tiene —`assigned_to` en
 * null y un `maintenance_type` que no es ninguna especialidad—.
 */
const MANTENIMIENTO: MantenimientoParaLaOT = {
  id: "afe8aa63-05ac-4612-8163-cbcc8affe110",
  equipment_id: "03dc185f-6fa6-46c0-a249-b8b6dafb8ed9",
  maintenance_type: "Lubricacion",
  description: "Lubricación mensual de rodamientos",
  next_date: "2026-08-08",
  estimated_hours: null,
  equipos: {
    code: "PO-B1-27",
    name: "Rodamiento principal",
    sector_id: "sec-calcinacion",
    sectores: { nombre: "Calcinación" },
  },
  assigned_user: null,
};

/** El mismo, pero con alguien asignado: el caso que el de arriba no cubre. */
const CON_ASIGNADO: MantenimientoParaLaOT = {
  ...MANTENIMIENTO,
  assigned_user: { nombre: "Juan", apellido: "Pérez" },
};

describe("de qué especialidad es un tipo de mantenimiento", () => {
  /**
   * EL ERROR 1. `maintenance_type` viajaba crudo a `especialidad`, donde el
   * vocabulario es `ESPECIALIDADES`. "Lubricacion" sin tilde y capitalizado no
   * es ninguno de los cuatro, así que esa OT no la filtraba nadie.
   */
  it("reconoce el que es una especialidad escrita de otra forma", () => {
    expect(especialidadDeTipo("Lubricacion")).toBe("LUBRICACIÓN");
    expect(especialidadDeTipo("LUBRICACIÓN")).toBe("LUBRICACIÓN");
    expect(especialidadDeTipo("  mecanico  ")).toBe("MECÁNICO");
  });

  /** El `_` con el que la base escribe este tipo no lo toca `norm`. */
  it("reconoce la revisión eléctrica, guión bajo incluido", () => {
    expect(especialidadDeTipo("Revision_electrica")).toBe("ELÉCTRICO");
    expect(especialidadDeTipo("Revisión eléctrica")).toBe("ELÉCTRICO");
  });

  /**
   * Y ÉSTA ES LA DECISIÓN, NO UNA OMISIÓN: enlazar al que se le parece es peor
   * que dejar en null. Una inspección puede ser mecánica o eléctrica; mandarla
   * como MECÁNICO porque la mayoría lo son deja la OT en el filtro equivocado,
   * y eso no se nota nunca.
   */
  it("lo que no se sabe con certeza queda sin enlazar", () => {
    expect(especialidadDeTipo("Inspeccion")).toBe("");
    expect(especialidadDeTipo("Limpieza")).toBe("");
    expect(especialidadDeTipo("Ajuste")).toBe("");
    expect(especialidadDeTipo("Reemplazo")).toBe("");
    expect(especialidadDeTipo("cualquier cosa")).toBe("");
    expect(especialidadDeTipo(null)).toBe("");
    expect(especialidadDeTipo("   ")).toBe("");
  });

  /**
   * LA TRAMPA QUE ABRIÓ EL 21/10/2026, cuando `ESPECIALIDADES` sumó OTRO. El
   * tipo de tarea "Otro" pasó a coincidir **por nombre** con la especialidad
   * "OTRO", así que la traducción automática se la habría puesto sola. Y no
   * prueba nada: que la tarea esté sin clasificar no dice que el oficio lo
   * esté. Peor todavía, es el caso donde más falta hace preguntar — un trabajo
   * marcado "Otro" es justo el que nadie describió.
   *
   * Este test es la única defensa: agregar un valor al vocabulario no avisa de
   * que empezó a coincidir con un tipo.
   */
  it("el tipo «Otro» no se traduce a la especialidad OTRO, aunque se llamen igual", () => {
    expect(ESPECIALIDADES).toContain("OTRO");
    expect(especialidadDeTipo("Otro")).toBe("");
    expect(especialidadDeTipo("OTRO")).toBe("");
  });

  /**
   * LA INVARIANTE QUE IMPIDE QUE EL ERROR 1 VUELVA POR OTRO TIPO. Lo que salga
   * de acá está en `ESPECIALIDADES` o está vacío — nunca un tercer valor. El
   * día que alguien agregue un tipo nuevo al formulario, este test lo cruza
   * contra el vocabulario sin que nadie se acuerde de hacerlo.
   */
  it("nunca devuelve un valor que no esté en el vocabulario", () => {
    for (const t of TIPOS_DE_MANTENIMIENTO) {
      const e = especialidadDeTipo(t.value);
      if (e !== "") expect(ESPECIALIDADES).toContain(e);
    }
  });

  it("la etiqueta es la de pantalla, no la cruda con guión bajo", () => {
    expect(etiquetaDeTipo("Revision_electrica")).toBe("Revisión eléctrica");
    expect(etiquetaDeTipo("Lubricacion")).toBe("Lubricación");
    // Un tipo que no está en la lista se nombra como viene, no desaparece.
    expect(etiquetaDeTipo("Soldadura")).toBe("Soldadura");
    expect(etiquetaDeTipo(null)).toBe("");
  });
});

describe("quién lo realiza", () => {
  /**
   * EL ERROR 2, Y EL QUE MÁS COSTÓ. El botón armaba
   * `quien: nombreCompleto(s.assigned_user)`: un nombre de persona en un campo
   * cuyo vocabulario es INTERNO / CONTRATADO. Una OT con `quien = "Juan Pérez"`
   * no la encuentra nunca el filtro del listado, que es un `.in()` liso.
   */
  it("es del vocabulario cerrado y nunca el nombre de una persona", () => {
    const c = cuerpoDeLaOT(CON_ASIGNADO, respuestasIniciales(CON_ASIGNADO));
    expect(c.quien).toBe("INTERNO");
    expect(QUIENES_DE_OT).toContain(c.quien);
    expect(c.quien).not.toContain("Juan");
  });

  /** La persona va al campo que existe para nombrar gente. */
  it("la persona asignada va a operario_1", () => {
    const c = cuerpoDeLaOT(CON_ASIGNADO, respuestasIniciales(CON_ASIGNADO));
    expect(c.operario_1).toBe("Juan Pérez");
  });

  /**
   * Nombrar a alguien de la casa como operario de un trabajo que hace un
   * tercero es dejar la orden diciendo dos cosas.
   */
  it("pero no si el trabajo está contratado", () => {
    const c = cuerpoDeLaOT(CON_ASIGNADO, {
      ...respuestasIniciales(CON_ASIGNADO), quien: "CONTRATADO",
    });
    expect(c.operario_1).toBe("");
  });

  it("sin nadie asignado, operario_1 queda vacío y no con un guión", () => {
    expect(nombreDelAsignado(MANTENIMIENTO)).toBe("");
    expect(cuerpoDeLaOT(MANTENIMIENTO, respuestasIniciales(MANTENIMIENTO)).operario_1).toBe("");
  });
});

describe("lo que el mantenimiento ya contesta", () => {
  it("arrastra el equipo, el sector y la descripción", () => {
    const c = cuerpoDeLaOT(MANTENIMIENTO, respuestasIniciales(MANTENIMIENTO));
    expect(c.equipment_id).toBe("03dc185f-6fa6-46c0-a249-b8b6dafb8ed9");
    expect(c.sector_id).toBe("sec-calcinacion");
    expect(c.sector_raw).toBe("Calcinación");
    expect(c.equipo_raw).toBe("PO-B1-27 — Rodamiento principal");
    expect(c.descripcion).toBe("Lubricación mensual de rodamientos");
    expect(c.schedule_id).toBe("afe8aa63-05ac-4612-8163-cbcc8affe110");
  });

  /** Nace de un preventivo con fecha, no de una falla que alguien reportó. */
  it("nace programada y por hacer", () => {
    const c = cuerpoDeLaOT(MANTENIMIENTO, respuestasIniciales(MANTENIMIENTO));
    expect(c.tipo).toBe("PROGRAMADO");
    expect(c.estado).toBe("POR_HACER");
  });

  /**
   * Un mantenimiento programado no tiene urgencia de donde sacar una prioridad,
   * y ponerle "MEDIA" sería inventar el dato del que sale el orden del tablero.
   * La ruta la deja en null, que es lo que ya hacía.
   */
  it("no inventa una prioridad", () => {
    expect(cuerpoDeLaOT(MANTENIMIENTO, respuestasIniciales(MANTENIMIENTO)).prioridad)
      .toBeUndefined();
  });

  /** Sin descripción se nombra por su tarea, con la etiqueta y no con lo crudo. */
  it("sin descripción se nombra por el tipo y el equipo", () => {
    const m = { ...MANTENIMIENTO, description: null, maintenance_type: "Revision_electrica" };
    expect(cuerpoDeLaOT(m, respuestasIniciales(m)).descripcion)
      .toBe("Revisión eléctrica — Rodamiento principal");
  });

  /** La fecha que el mantenimiento ya tiene puesta, no una inventada. */
  it("hereda la próxima fecha como fecha de ejecución", () => {
    expect(respuestasIniciales(MANTENIMIENTO).fecha_ejecucion).toBe("2026-08-08");
    expect(cuerpoDeLaOT(MANTENIMIENTO, respuestasIniciales(MANTENIMIENTO)).fecha_ejecucion)
      .toBe("2026-08-08");
  });

  /**
   * Se pide trabajo, no se carga trabajo hecho. Van explícitos para que
   * `loQueFaltaParaCrear` vea lo mismo acá que en el servidor: si llegaran
   * `undefined`, el cierre no se exigiría de este lado y el 400 saldría recién
   * al guardar.
   */
  it("no nace cerrada", () => {
    const c = cuerpoDeLaOT(MANTENIMIENTO, respuestasIniciales(MANTENIMIENTO));
    expect(c.fecha_cierre).toBe("");
    expect(c.contratista).toBe("");
    expect(c.operario_2).toBe("");
    expect(c.operario_3).toBe("");
  });

  /** Las horas estimadas viajan como texto: la ruta hace `Number(horas)`. */
  it("las horas estimadas van como texto, y vacías si no hay", () => {
    expect(cuerpoDeLaOT(MANTENIMIENTO, respuestasIniciales(MANTENIMIENTO)).horas).toBe("");
    const m = { ...MANTENIMIENTO, estimated_hours: 2.5 };
    expect(cuerpoDeLaOT(m, respuestasIniciales(m)).horas).toBe("2.5");
  });
});

describe("lo que hay que preguntar", () => {
  /**
   * EL BUG DEL 21/10/2026, FIJADO. El único mantenimiento programado que existe
   * no tiene `assigned_to`, así que `nombreCompleto(null)` daba "" y
   * `loQueFaltaParaCrear` contestaba «Falta cargar quién lo realiza»: el botón
   * directamente no generaba nada. Medido: 0 OT nacidas de un schedule en toda
   * la historia.
   *
   * Con las respuestas iniciales no falta nada, o sea que el botón genera — y
   * genera **sin que nadie complete nada**, porque el mantenimiento ya sabía
   * las tres cosas.
   */
  it("el mantenimiento que hoy existe ya puede generar su OT", () => {
    expect(loQueFaltaDelMantenimiento(MANTENIMIENTO, respuestasIniciales(MANTENIMIENTO)))
      .toEqual([]);
  });

  it("son las tres que el mantenimiento contesta por su cuenta", () => {
    expect(loQueHayQuePreguntar(MANTENIMIENTO))
      .toEqual(["la especialidad", "quién lo realiza", "la fecha de ejecución"]);
  });

  /**
   * Y ÉSTE ES EL TEST QUE IMPIDE QUE SE SEPAREN OTRA VEZ. La lista no está
   * escrita en el formulario: sale de `loQueFaltaParaCrear`, la misma función
   * que corre el servidor. Si mañana la regla exige un campo más, aparece acá y
   * el formulario lo pide solo — este test se pone rojo y nombra el campo
   * nuevo, en vez de que el botón empiece a fallar en silencio.
   */
  it("la lista sale de la regla compartida y no de una copia", () => {
    for (const p of loQueHayQuePreguntar(MANTENIMIENTO)) {
      expect(loQueFaltaDelMantenimiento(MANTENIMIENTO, RESPUESTAS_VACIAS)).toContain(p);
    }
  });

  /** Un tipo que no se reconoce deja la especialidad para que alguien la elija. */
  it("un tipo sin especialidad cierta deja ese campo pendiente", () => {
    const m = { ...MANTENIMIENTO, maintenance_type: "Inspeccion" };
    expect(respuestasIniciales(m).especialidad).toBe("");
    expect(loQueFaltaDelMantenimiento(m, respuestasIniciales(m))).toEqual(["la especialidad"]);
    expect(loQueFaltaDelMantenimiento(m, { ...respuestasIniciales(m), especialidad: "MECÁNICO" }))
      .toEqual([]);
  });

  /** Un mantenimiento sin próxima fecha no se puede atrasar nunca. */
  it("sin próxima fecha queda pendiente la de ejecución", () => {
    const m = { ...MANTENIMIENTO, next_date: null };
    expect(loQueFaltaDelMantenimiento(m, respuestasIniciales(m)))
      .toEqual(["la fecha de ejecución"]);
  });

  it("los espacios no cuentan como contestado", () => {
    expect(loQueFaltaDelMantenimiento(MANTENIMIENTO, {
      ...respuestasIniciales(MANTENIMIENTO), especialidad: "   ",
    })).toEqual(["la especialidad"]);
  });
});

describe("lo que el formulario no puede arreglar", () => {
  /**
   * Un equipo sin sector se arregla en el equipo. Ponerle un desplegable de
   * sectores a esta pantalla dejaría la OT diciendo una cosa y la ficha del
   * equipo otra.
   */
  it("un equipo sin sector no se convierte desde acá, y se dice", () => {
    const m = {
      ...MANTENIMIENTO,
      equipos: { ...MANTENIMIENTO.equipos!, sector_id: null },
    };
    expect(loQueNoSeArreglaAca(m)).toEqual(["el sector"]);
    // Y lo nombra igual la regla compartida: es obligatorio como los demás.
    expect(loQueFaltaDelMantenimiento(m, respuestasIniciales(m))).toContain("el sector");
  });

  it("un mantenimiento sin equipo tampoco", () => {
    expect(loQueNoSeArreglaAca({ ...MANTENIMIENTO, equipment_id: null, equipos: null }))
      .toEqual(["el sector", "el equipo"]);
  });

  it("el que hoy existe no tiene nada de eso", () => {
    expect(loQueNoSeArreglaAca(MANTENIMIENTO)).toEqual([]);
  });
});

/**
 * Lo que le falta a un programado para que lo genere **un proceso**.
 *
 * Es distinto de lo que le falta para que lo genere una persona: un cron no
 * está mirando el formulario, así que lo que no venga puesto no se completa,
 * se saltea. Y lo que puede faltar es la especialidad, porque
 * `especialidadDeTipo` sólo resuelve dos de los siete tipos.
 */
describe("lo que le falta a un programado para generar solo", () => {
  it("a uno de lubricación no le falta nada: el tipo resuelve la especialidad", () => {
    expect(loQueFaltaParaGenerar(MANTENIMIENTO)).toEqual([]);
  });

  it("a una inspección le falta la especialidad, porque el tipo no la dice", () => {
    expect(loQueFaltaParaGenerar({ ...MANTENIMIENTO, maintenance_type: "Inspeccion" }))
      .toEqual(["la especialidad"]);
  });

  it("con la especialidad propia cargada, esa misma inspección ya puede", () => {
    expect(loQueFaltaParaGenerar({
      ...MANTENIMIENTO, maintenance_type: "Inspeccion", especialidad: "ELÉCTRICO",
    })).toEqual([]);
  });

  /** La propia le gana al tipo: es la que alguien eligió a mano. */
  it("la especialidad propia manda sobre la que deduce el tipo", () => {
    expect(especialidadDelProgramado({ ...MANTENIMIENTO, especialidad: "CIVIL" })).toBe("CIVIL");
    // Sin la propia cae en la del tipo: «Lubricacion» coincide por nombre con
    // la especialidad LUBRICACIÓN, que es uno de los dos tipos que resuelven.
    expect(especialidadDelProgramado(MANTENIMIENTO)).toBe("LUBRICACIÓN");
  });

  it("una especialidad en blanco no cuenta como cargada", () => {
    expect(loQueFaltaParaGenerar({
      ...MANTENIMIENTO, maintenance_type: "Otro", especialidad: "   ",
    })).toEqual(["la especialidad"]);
  });

  it("sin equipo tampoco genera, y lo dice junto con lo otro", () => {
    expect(loQueFaltaParaGenerar({
      ...MANTENIMIENTO, maintenance_type: "Limpieza", equipment_id: null,
    })).toEqual(["la especialidad", "el equipo"]);
  });
});
