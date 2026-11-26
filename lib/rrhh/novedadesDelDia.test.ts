import { describe, it, expect } from "vitest";
import {
  asuntoDelCorreo,
  comoSeLlama,
  cuantasSon,
  cuerpoDelCorreo,
  destinatariosDelCorreo,
  diaLargo,
  fechaCorta,
  hayAlgoQueMandar,
  juntarAusentesDelDia,
  rangoDeFechas,
  repartirAusentesDelDia,
  repartirVacacionesYAusencias,
  soloLoQueCorrespondeAlDia,
  tocaElDiaOElFuturo,
  comoEstaEnElDia,
  SIN_NOVEDADES,
  type NovedadesDelDia,
} from "./novedadesDelDia";

const VACIO: NovedadesDelDia = SIN_NOVEDADES;

const CEJAS = { apellido: "CEJAS", nombre: "MARIO AGUSTIN", legajo: "PC_118" };
const PEREZ = { apellido: "PÉREZ", nombre: "ANA", legajo: null };

function con(p: Partial<NovedadesDelDia>): NovedadesDelDia {
  return { ...VACIO, ...p };
}

const UNA_AUSENCIA = {
  empleado: CEJAS,
  fecha_desde: "2026-11-16",
  fecha_hasta: "2026-11-18",
  tipo: "ENFERMEDAD_ACCIDENTE_INCULPABLE",
  justificada: true,
};

describe("fechaCorta, diaLargo y rangoDeFechas", () => {
  it("escribe la fecha como la lee una persona", () => {
    expect(fechaCorta("2026-11-16")).toBe("16/11/2026");
  });

  it("acepta un timestamp completo", () => {
    expect(fechaCorta("2026-11-16T18:50:00+00:00")).toBe("16/11/2026");
  });

  it("nombra el día de la semana en castellano", () => {
    // El 16/11/2026 es lunes: es el día de los montones de francos.
    expect(diaLargo("2026-11-16")).toBe("lunes 16/11/2026");
    expect(diaLargo("2026-11-15")).toBe("domingo 15/11/2026");
  });

  it("un solo día no se escribe como un rango", () => {
    expect(rangoDeFechas("2026-11-16", "2026-11-16")).toBe("el 16/11/2026");
    expect(rangoDeFechas("2026-11-16", "2026-11-18")).toBe("del 16/11/2026 al 18/11/2026");
  });
});

describe("comoSeLlama", () => {
  it("lleva el legajo cuando lo hay", () => {
    expect(comoSeLlama(CEJAS)).toBe("CEJAS, MARIO AGUSTIN (PC_118)");
  });

  it("sin legajo no inventa el paréntesis", () => {
    expect(comoSeLlama(PEREZ)).toBe("PÉREZ, ANA");
  });

  it("dice que falta el empleado en vez de dejar el renglón mudo", () => {
    // El embed puede no resolver; un renglón que empieza con "—" se lee como
    // un error del correo y no como un dato que falta.
    expect(comoSeLlama(null)).toBe("(empleado no encontrado)");
    expect(comoSeLlama({ apellido: null, nombre: null })).toBe("(empleado sin nombre)");
  });
});

describe("repartirVacacionesYAusencias", () => {
  const laAusenciaDeLaVacacion = {
    id: "aus-1",
    empleado: PEREZ,
    fecha_desde: "2026-11-20",
    fecha_hasta: "2026-11-27",
    tipo: "VACACIONES",
    justificada: true,
    observaciones: "Pidió adelantar una semana",
    cargadaPor: "Agustina Are",
  };
  const elPeriodo = {
    empleado: PEREZ,
    fecha_desde: "2026-11-20",
    fecha_hasta: "2026-11-27",
    dias_tomados: 7,
    anio_correspondiente: 2025,
    ausencia_id: "aus-1",
  };

  it("una licencia sale UNA vez, y del lado que dice más", () => {
    /*
     * Desde el 17/11/2026 toda vacación nace con su ausencia, así que sin esto
     * la misma licencia saldría dos veces en el mismo correo.
     */
    const r = repartirVacacionesYAusencias([laAusenciaDeLaVacacion], [elPeriodo]);
    expect(r.ausencias).toEqual([]);
    expect(r.vacaciones).toHaveLength(1);
  });

  it("y se lleva puesto lo que la ausencia tenía de más", () => {
    // Las observaciones y el autor viven en la ausencia; si no se pegan acá,
    // al no listarla se pierden.
    const [v] = repartirVacacionesYAusencias([laAusenciaDeLaVacacion], [elPeriodo]).vacaciones;
    expect(v.observaciones).toBe("Pidió adelantar una semana");
    expect(v.cargadaPor).toBe("Agustina Are");
    expect(v.anio_correspondiente).toBe(2025);
  });

  it("no toca las ausencias que no son esa vacación", () => {
    const otra = { ...UNA_AUSENCIA, id: "aus-2" };
    const r = repartirVacacionesYAusencias([laAusenciaDeLaVacacion, otra], [elPeriodo]);
    expect(r.ausencias.map((a) => a.id)).toEqual(["aus-2"]);
  });

  it("una vacación suelta sale igual, sin inventarle observaciones", () => {
    // Las 20 viejas, cargadas por la puerta que no creaba la ausencia.
    const suelta = { ...elPeriodo, ausencia_id: null };
    const r = repartirVacacionesYAusencias([], [suelta]);
    expect(r.vacaciones).toHaveLength(1);
    expect(r.vacaciones[0].observaciones).toBeUndefined();
    expect(r.vacaciones[0].cargadaPor).toBeUndefined();
  });

  it("una ausencia de vacaciones sin período del día se queda donde está", () => {
    // El período se creó otro día, o no se creó. Mejor decir menos que no
    // decirlo: la ausencia sigue saliendo.
    const r = repartirVacacionesYAusencias([laAusenciaDeLaVacacion], []);
    expect(r.ausencias.map((a) => a.id)).toEqual(["aus-1"]);
    expect(r.vacaciones).toEqual([]);
  });

  it("un ausencia_id que no es de hoy no borra ninguna ausencia", () => {
    const deOtroDia = { ...elPeriodo, ausencia_id: "aus-de-ayer" };
    const r = repartirVacacionesYAusencias([{ ...UNA_AUSENCIA, id: "aus-2" }], [deOtroDia]);
    expect(r.ausencias.map((a) => a.id)).toEqual(["aus-2"]);
    expect(r.vacaciones).toHaveLength(1);
  });

  it("no modifica los arreglos que recibe", () => {
    const aus = [laAusenciaDeLaVacacion];
    const vac = [elPeriodo];
    repartirVacacionesYAusencias(aus, vac);
    expect(aus).toHaveLength(1);
    expect(vac[0]).not.toHaveProperty("cargadaPor");
  });
});

describe("hayAlgoQueMandar", () => {
  it("sin novedades no se manda nada", () => {
    expect(hayAlgoQueMandar(VACIO)).toBe(false);
    expect(cuantasSon(VACIO)).toBe(0);
  });

  it("una sola ausencia alcanza", () => {
    expect(hayAlgoQueMandar(con({ ausencias: [UNA_AUSENCIA] }))).toBe(true);
  });

  it("un franco generado solo también alcanza", () => {
    // Es el lunes con el montón del recálculo y nada más. Se manda igual
    // —se pidió así— y por eso el correo dice que son automáticos.
    const n = con({ francosGenerados: [{ empleado: CEJAS, fecha_generado: "2026-11-15", horas: 8 }] });
    expect(hayAlgoQueMandar(n)).toBe(true);
  });

  it("cuenta las cuatro secciones", () => {
    const n = con({
      ausencias: [UNA_AUSENCIA],
      vacaciones: [{ empleado: PEREZ, fecha_desde: "2026-11-20", fecha_hasta: "2026-11-27", dias_tomados: 7, anio_correspondiente: 2025, ausencia_id: null }],
      francosTomados: [{ empleado: CEJAS, fecha_generado: "2026-11-01", fecha_tomado: "2026-11-16", horas: 8 }],
      francosGenerados: [{ empleado: PEREZ, fecha_generado: "2026-11-15", horas: 8 }],
    });
    expect(cuantasSon(n)).toBe(4);
  });
});

describe("soloLoQueCorrespondeAlDia", () => {
  const HOY = "2026-11-17";

  it("una ausencia que ya termino no se informa", () => {
    // El caso que lo motivó: el 16/11 se cargó una ausencia del 02 al 03/11.
    const n = con({ ausencias: [{ ...UNA_AUSENCIA, fecha_desde: "2026-11-02", fecha_hasta: "2026-11-03" }] });
    expect(soloLoQueCorrespondeAlDia(n, HOY).ausencias).toEqual([]);
  });

  it("una que empezó antes pero sigue, sí", () => {
    // El corte va sobre la fecha final, no sobre la de inicio: mirar
    // `fecha_desde` dejaría afuera justo la licencia que está en curso.
    const n = con({ ausencias: [{ ...UNA_AUSENCIA, fecha_desde: "2026-11-10", fecha_hasta: "2026-11-20" }] });
    expect(soloLoQueCorrespondeAlDia(n, HOY).ausencias).toHaveLength(1);
  });

  it("la que termina justo hoy entra", () => {
    const n = con({ ausencias: [{ ...UNA_AUSENCIA, fecha_desde: "2026-11-10", fecha_hasta: HOY }] });
    expect(soloLoQueCorrespondeAlDia(n, HOY).ausencias).toHaveLength(1);
  });

  it("una del futuro entra", () => {
    const n = con({ ausencias: [{ ...UNA_AUSENCIA, fecha_desde: "2026-12-01", fecha_hasta: "2026-12-10" }] });
    expect(soloLoQueCorrespondeAlDia(n, HOY).ausencias).toHaveLength(1);
  });

  it("se lleva los francos generados por un domingo anterior", () => {
    /*
     * Medido: 130 de 143 francos llevan un `fecha_generado` anterior al día en
     * que el recálculo los creó, porque los genera el lunes por el domingo. Es
     * el montón de 17 renglones automáticos que ya no sale.
     */
    const n = con({
      francosGenerados: [{ empleado: CEJAS, fecha_generado: "2026-11-15", horas: 8 }],
      francosTomados: [{ empleado: CEJAS, fecha_generado: "2026-11-01", fecha_tomado: HOY, horas: 8 }],
    });
    const r = soloLoQueCorrespondeAlDia(n, HOY);
    expect(r.francosGenerados).toEqual([]);
    // El tomado sobrevive: se marcó hoy, y marcarlo es un acto de hoy.
    expect(r.francosTomados).toHaveLength(1);
  });

  it("no toca las dos secciones de presencia", () => {
    // No son movimientos: su criterio es cubrir el día, no haber empezado hoy.
    const unAusente = { empleado: CEJAS, fecha_desde: "2026-11-01", fecha_hasta: "2026-11-30", tipo: "VACACIONES" };
    const n = con({ empiezanOTerminan: [unAusente], siguenAusentes: [unAusente] });
    const r = soloLoQueCorrespondeAlDia(n, HOY);
    expect(r.empiezanOTerminan).toHaveLength(1);
    expect(r.siguenAusentes).toHaveLength(1);
  });

  it("acepta un timestamp completo, no sólo el día suelto", () => {
    expect(tocaElDiaOElFuturo("2026-11-17T00:00:00+00:00", HOY)).toBe(true);
    expect(tocaElDiaOElFuturo("2026-11-16T00:00:00+00:00", HOY)).toBe(false);
  });
});

describe("repartirAusentesDelDia y comoEstaEnElDia", () => {
  const HOY = "2026-11-17";
  const arranca = { empleado: CEJAS, fecha_desde: HOY, fecha_hasta: "2026-11-20", tipo: "VACACIONES" };
  const termina = { empleado: PEREZ, fecha_desde: "2026-11-10", fecha_hasta: HOY, tipo: "ENFERMEDAD_ACCIDENTE_INCULPABLE" };
  const sigue = { empleado: PEREZ, fecha_desde: "2026-11-10", fecha_hasta: "2026-11-30", tipo: "VACACIONES" };
  const unSoloDia = { empleado: CEJAS, fecha_desde: HOY, fecha_hasta: HOY, tipo: "PERMISO_PERSONAL" };

  it("parte la lista en dos sin repetir a nadie", () => {
    // Las dos secciones salen de la MISMA lista: listar «los que cambian» y
    // después «todos» pondría a la misma persona dos veces.
    const r = repartirAusentesDelDia([arranca, termina, sigue], HOY);
    expect(r.empiezanOTerminan).toHaveLength(2);
    expect(r.siguenAusentes).toHaveLength(1);
    expect(r.empiezanOTerminan.length + r.siguenAusentes.length).toBe(3);
  });

  it("dice qué le pasa a cada uno ese día", () => {
    expect(comoEstaEnElDia(arranca, HOY)).toBe("arranca hoy, hasta el 20/11/2026");
    expect(comoEstaEnElDia(termina, HOY)).toBe("último día, mañana se reintegra");
    expect(comoEstaEnElDia(sigue, HOY)).toBe("hasta el 30/11/2026");
    expect(comoEstaEnElDia(unSoloDia, HOY)).toBe("hoy solamente");
  });

  it("el de un solo día cuenta como que cambia", () => {
    const r = repartirAusentesDelDia([unSoloDia], HOY);
    expect(r.empiezanOTerminan).toHaveLength(1);
    expect(r.siguenAusentes).toEqual([]);
  });
});

describe("juntarAusentesDelDia", () => {
  const HOY = "2026-11-26";
  const RAMALLO = { apellido: "RAMALLO", nombre: "NESTOR FABIAN", legajo: "PS_008" };

  const enfermo = {
    id: "a1",
    empleado: CEJAS,
    fecha_desde: "2026-11-20",
    fecha_hasta: "2026-11-30",
    tipo: "ENFERMEDAD_ACCIDENTE_INCULPABLE",
  };
  const periodoSuelto = {
    empleado: RAMALLO,
    fecha_desde: "2026-11-02",
    fecha_hasta: "2026-11-29",
    ausencia_id: null,
  };

  it("trae al que está de vacaciones aunque no tenga ausencia", () => {
    /*
     * El caso real del 26/11/2026: 0 ausencias y 3 períodos de vacaciones, los
     * tres con `ausencia_id` en null porque se cargaron antes del 16/11. Sin
     * esto la sección sale vacía con gente de licencia.
     */
    const r = juntarAusentesDelDia([], [periodoSuelto]);
    expect(r).toHaveLength(1);
    expect(r[0].tipo).toBe("VACACIONES");
    expect(comoSeLlama(r[0].empleado)).toBe("RAMALLO, NESTOR FABIAN (PS_008)");
  });

  it("no cuenta dos veces a la vacación que ya tiene su ausencia", () => {
    /*
     * Las fechas acá NO coinciden, a propósito: de los 21 períodos atados,
     * uno tiene la ausencia terminando un día después (13→19 contra 13→20).
     * O sea que el enlace por id tiene que alcanzar solo, sin ayuda de la
     * comparación de fechas.
     */
    const suAusencia = {
      id: "a9",
      empleado: RAMALLO,
      fecha_desde: "2026-11-02",
      fecha_hasta: "2026-11-30",
      tipo: "VACACIONES",
    };
    const atada = { ...periodoSuelto, ausencia_id: "a9" };
    const r = juntarAusentesDelDia([suAusencia], [atada]);
    expect(r).toHaveLength(1);
    expect(r[0].fecha_hasta).toBe("2026-11-30");
  });

  it("una ausencia de otro tipo con las mismas fechas no se come la vacación", () => {
    /*
     * Sólo una ausencia de tipo VACACIONES puede ser «la misma licencia
     * escrita dos veces». Si alguien tiene cargada una enfermedad justo en
     * esas fechas, es un dato que se contradice y el correo lo muestra: no
     * se elige en silencio cuál de los dos es el bueno.
     */
    const enfermedadIgual = {
      id: "a9",
      empleado: RAMALLO,
      fecha_desde: "2026-11-02",
      fecha_hasta: "2026-11-29",
      tipo: "ENFERMEDAD_ACCIDENTE_INCULPABLE",
    };
    expect(juntarAusentesDelDia([enfermedadIgual], [periodoSuelto])).toHaveLength(2);
  });

  it("tampoco cuando las cargaron por separado, sin enlazarlas", () => {
    // El `ausencia_id` está en null pero hay una ausencia VACACIONES del mismo
    // legajo con las mismas fechas: es la misma licencia escrita dos veces.
    const gemela = {
      id: "a9",
      empleado: RAMALLO,
      fecha_desde: "2026-11-02",
      fecha_hasta: "2026-11-29",
      tipo: "VACACIONES",
    };
    const r = juntarAusentesDelDia([gemela], [periodoSuelto]);
    expect(r).toHaveLength(1);
  });

  it("una vacación de otras fechas sí es otra licencia", () => {
    const otraAusencia = {
      id: "a9",
      empleado: RAMALLO,
      fecha_desde: "2026-11-02",
      fecha_hasta: "2026-11-10",
      tipo: "VACACIONES",
    };
    expect(juntarAusentesDelDia([otraAusencia], [periodoSuelto])).toHaveLength(2);
  });

  it("deja afuera la tardanza, que cubre el día pero viene", () => {
    const tardanza = {
      id: "a2",
      empleado: PEREZ,
      fecha_desde: HOY,
      fecha_hasta: HOY,
      tipo: "TARDANZA",
    };
    const r = juntarAusentesDelDia([enfermo, tardanza], []);
    expect(r.map((a) => a.tipo)).toEqual(["ENFERMEDAD_ACCIDENTE_INCULPABLE"]);
  });

  it("ordena por fecha de inicio y no deja las vacaciones al final", () => {
    // Vienen de dos consultas distintas: pegarlas una atrás de la otra daría
    // dos listas ordenadas en vez de una.
    const r = juntarAusentesDelDia([enfermo], [periodoSuelto]);
    expect(r.map((a) => a.fecha_desde)).toEqual(["2026-11-02", "2026-11-20"]);
  });

  it("las dos puertas juntas llegan enteras a las dos secciones", () => {
    const r = repartirAusentesDelDia(juntarAusentesDelDia([enfermo], [periodoSuelto]), HOY);
    expect(r.empiezanOTerminan).toEqual([]);
    expect(r.siguenAusentes).toHaveLength(2);
    const cuerpo = cuerpoDelCorreo(con({ ausencias: [UNA_AUSENCIA], siguenAusentes: r.siguenAusentes }), HOY);
    expect(cuerpo).toContain("SIGUEN AUSENTES (2)");
    expect(cuerpo).toContain("Vacaciones · hasta el 29/11/2026");
  });
});

describe("las secciones de presencia no disparan el correo", () => {
  const unAusente = { empleado: CEJAS, fecha_desde: "2026-11-01", fecha_hasta: "2026-11-30", tipo: "VACACIONES" };

  it("con gente ausente pero sin movimientos, no se manda", () => {
    /*
     * Es la regla original del usuario, y sin esto se cae: hubo al menos una
     * persona ausente los 46 días de 46 medidos, así que el correo saldría
     * todos los días diciendo casi lo mismo.
     */
    const n = con({ empiezanOTerminan: [unAusente], siguenAusentes: [unAusente] });
    expect(hayAlgoQueMandar(n)).toBe(false);
    expect(cuantasSon(n)).toBe(0);
  });

  it("un solo movimiento alcanza, y entonces la presencia viaja con él", () => {
    const n = con({ ausencias: [UNA_AUSENCIA], siguenAusentes: [unAusente] });
    expect(hayAlgoQueMandar(n)).toBe(true);
    expect(cuerpoDelCorreo(n, "2026-11-17")).toContain("SIGUEN AUSENTES (1)");
  });
});

describe("asuntoDelCorreo", () => {
  it("dice cuánto hay de cada cosa, no sólo el total", () => {
    const n = con({
      ausencias: [UNA_AUSENCIA, UNA_AUSENCIA, UNA_AUSENCIA],
      francosGenerados: Array.from({ length: 17 }, () => ({ empleado: CEJAS, fecha_generado: "2026-11-15", horas: 8 })),
    });
    expect(asuntoDelCorreo(n, "2026-11-16")).toBe(
      "RR.HH. — novedades del 16/11/2026: 3 ausencias, 17 francos generados"
    );
  });

  it("no nombra las secciones vacías", () => {
    const n = con({ ausencias: [UNA_AUSENCIA] });
    expect(asuntoDelCorreo(n, "2026-11-16")).toBe("RR.HH. — novedades del 16/11/2026: 1 ausencia");
  });

  it("distingue los francos tomados de los generados", () => {
    const n = con({
      francosTomados: [{ empleado: CEJAS, fecha_generado: "2026-11-01", fecha_tomado: "2026-11-16", horas: 8 }],
      francosGenerados: [{ empleado: PEREZ, fecha_generado: "2026-11-15", horas: 8 }],
    });
    expect(asuntoDelCorreo(n, "2026-11-16")).toBe(
      "RR.HH. — novedades del 16/11/2026: 1 franco tomado, 1 franco generado"
    );
  });
});

describe("cuerpoDelCorreo", () => {
  const n = con({
    ausencias: [{ ...UNA_AUSENCIA, observaciones: "reposo por 3 días", cargadaPor: "Karen Shtefec" }],
    vacaciones: [{ empleado: PEREZ, fecha_desde: "2026-11-20", fecha_hasta: "2026-11-27", dias_tomados: 7, anio_correspondiente: 2025, ausencia_id: null }],
    francosGenerados: [{ empleado: CEJAS, fecha_generado: "2026-11-15", horas: 8 }],
  });

  it("arma las secciones con su cuenta y el detalle de cada renglón", () => {
    const cuerpo = cuerpoDelCorreo(n, "2026-11-16");
    expect(cuerpo).toContain("Novedades cargadas el lunes 16/11/2026.");
    expect(cuerpo).toContain("AUSENCIAS (1)");
    expect(cuerpo).toContain("- CEJAS, MARIO AGUSTIN (PC_118) — del 16/11/2026 al 18/11/2026 · Enfermedad/accidente inculpable · justificada");
    expect(cuerpo).toContain("    Observaciones: reposo por 3 días");
    expect(cuerpo).toContain("    La cargó: Karen Shtefec");
    expect(cuerpo).toContain("VACACIONES (1)");
    expect(cuerpo).toContain("- PÉREZ, ANA — del 20/11/2026 al 27/11/2026 · 7 días · año 2025");
  });

  it("el renglón de vacaciones lleva lo que absorbió de su ausencia", () => {
    const conDetalle = con({
      vacaciones: [{
        empleado: PEREZ, fecha_desde: "2026-11-20", fecha_hasta: "2026-11-27",
        dias_tomados: 7, anio_correspondiente: 2025, ausencia_id: "aus-1",
        observaciones: "Pidió adelantar una semana", cargadaPor: "Agustina Are",
      }],
    });
    const cuerpo = cuerpoDelCorreo(conDetalle, "2026-11-17");
    expect(cuerpo).toContain("    Observaciones: Pidió adelantar una semana");
    expect(cuerpo).toContain("    La cargó: Agustina Are");
  });

  it("un día de vacaciones no dice «1 días»", () => {
    const unDia = con({
      vacaciones: [{ empleado: PEREZ, fecha_desde: "2026-11-20", fecha_hasta: "2026-11-20", dias_tomados: 1, anio_correspondiente: 2026, ausencia_id: null }],
    });
    expect(cuerpoDelCorreo(unDia, "2026-11-17")).toContain("el 20/11/2026 · 1 día · año 2026");
  });

  it("dice que los francos generados los hace el sistema", () => {
    // Sin esta línea, «17 novedades» un lunes se lee como 17 cosas que cargó
    // alguien. Es la aclaración que sostiene que el correo se siga abriendo.
    const cuerpo = cuerpoDelCorreo(n, "2026-11-16");
    expect(cuerpo).toContain("FRANCOS GENERADOS POR EL SISTEMA (1)");
    expect(cuerpo).toContain("no los carga una persona");
  });

  it("no imprime una sección vacía", () => {
    const cuerpo = cuerpoDelCorreo(con({ ausencias: [UNA_AUSENCIA] }), "2026-11-16");
    expect(cuerpo).not.toContain("VACACIONES");
    expect(cuerpo).not.toContain("FRANCOS");
    expect(cuerpo).not.toContain("SIGUEN AUSENTES");
    expect(cuerpo).not.toContain("EMPIEZAN O TERMINAN");
  });

  it("escribe las dos secciones de presencia con lo que le pasa a cada uno", () => {
    const n = con({
      ausencias: [UNA_AUSENCIA],
      empiezanOTerminan: [{ empleado: CEJAS, fecha_desde: "2026-11-17", fecha_hasta: "2026-11-20", tipo: "VACACIONES" }],
      siguenAusentes: [{ empleado: PEREZ, fecha_desde: "2026-11-10", fecha_hasta: "2026-11-30", tipo: "LICENCIA_ART" }],
    });
    const cuerpo = cuerpoDelCorreo(n, "2026-11-17");
    expect(cuerpo).toContain("EMPIEZAN O TERMINAN HOY (1)");
    expect(cuerpo).toContain("- CEJAS, MARIO AGUSTIN (PC_118) — Vacaciones · arranca hoy, hasta el 20/11/2026");
    expect(cuerpo).toContain("SIGUEN AUSENTES (1)");
    expect(cuerpo).toContain("- PÉREZ, ANA — Licencia por ART · hasta el 30/11/2026");
  });

  it("pone el encabezado y el cierre que configuró RR.HH.", () => {
    const cuerpo = cuerpoDelCorreo(n, "2026-11-16", { encabezado: "Buenas tardes:", cierre: "Saludos,\nGestión de Personas" });
    expect(cuerpo.startsWith("Buenas tardes:")).toBe(true);
    expect(cuerpo.endsWith("Saludos,\nGestión de Personas")).toBe(true);
  });

  it("sin texto configurado no inventa nada y arranca por el dato", () => {
    const cuerpo = cuerpoDelCorreo(n, "2026-11-16", { encabezado: "   ", cierre: null });
    expect(cuerpo.startsWith("Novedades cargadas el")).toBe(true);
    expect(cuerpo.endsWith("\n")).toBe(false);
  });

  it("una ausencia sin observaciones no deja el renglón colgado", () => {
    const cuerpo = cuerpoDelCorreo(con({ ausencias: [UNA_AUSENCIA] }), "2026-11-16");
    expect(cuerpo).not.toContain("Observaciones:");
    expect(cuerpo).not.toContain("La cargó:");
  });

  it("sangra una observación de varios renglones", () => {
    /*
     * Visto en el correo del 13/11/2026 armado con los datos reales: «Envía
     * certificado por WhatsApp⏎Laringitis» dejaba «Laringitis» pegado al
     * margen, donde se lee como una novedad más y no como parte de la de
     * arriba.
     */
    const cuerpo = cuerpoDelCorreo(
      con({ ausencias: [{ ...UNA_AUSENCIA, observaciones: "Envía certificado por WhatsApp\nLaringitis" }] }),
      "2026-11-16"
    );
    expect(cuerpo).toContain("    Observaciones: Envía certificado por WhatsApp\n    Laringitis");
    expect(cuerpo).not.toContain("\nLaringitis");
  });

  it("marca la ausencia injustificada como tal", () => {
    const cuerpo = cuerpoDelCorreo(con({ ausencias: [{ ...UNA_AUSENCIA, justificada: false, tipo: "INJUSTIFICADA" }] }), "2026-11-16");
    expect(cuerpo).toContain("Ausencia injustificada · injustificada");
  });
});

describe("destinatariosDelCorreo", () => {
  const usuarios = [
    { id: "1", email: "gerencia@polcecal.com", rol: "encargado", activo: true },
    { id: "2", email: "compras@polcecal.com", rol: "encargado", activo: true },
    { id: "3", email: "nicolaslenzetti@polcecal.com", rol: "admin_sistema", activo: true },
    { id: "4", email: "gestiondepersonas@polcecal.com", rol: "operario", activo: true },
  ];

  it("sin nadie elegido va a todos los encargados", () => {
    expect(destinatariosDelCorreo(usuarios, [])).toEqual(["gerencia@polcecal.com", "compras@polcecal.com"]);
    expect(destinatariosDelCorreo(usuarios, null)).toHaveLength(2);
  });

  it("con gente elegida va exactamente a ésa, aunque no sea encargada", () => {
    // La consecuencia que la pantalla avisa: elegir apaga la regla. Acá el
    // encargado de compras queda afuera a propósito.
    expect(destinatariosDelCorreo(usuarios, ["3", "4"])).toEqual([
      "nicolaslenzetti@polcecal.com",
      "gestiondepersonas@polcecal.com",
    ]);
  });

  it("un id que ya no existe no rompe la lista", () => {
    // `destinatarios` es un arreglo de uuid sin foreign key: un usuario
    // borrado deja el id colgado y el resto tiene que salir igual.
    expect(destinatariosDelCorreo(usuarios, ["1", "99999"])).toEqual(["gerencia@polcecal.com"]);
  });

  it("no le manda a un usuario dado de baja", () => {
    const conBaja = [...usuarios, { id: "5", email: "exempleado@polcecal.com", rol: "encargado", activo: false }];
    expect(destinatariosDelCorreo(conBaja, [])).not.toContain("exempleado@polcecal.com");
    expect(destinatariosDelCorreo(conBaja, ["5"])).toEqual([]);
  });

  it("descarta el que no tiene correo y no repite direcciones", () => {
    const raros = [
      { id: "1", email: "gerencia@polcecal.com", rol: "encargado", activo: true },
      { id: "2", email: "", rol: "encargado", activo: true },
      { id: "3", email: "  GERENCIA@polcecal.com ", rol: "encargado", activo: true },
    ];
    expect(destinatariosDelCorreo(raros, [])).toEqual(["gerencia@polcecal.com"]);
  });

  it("sin ningún encargado no devuelve a nadie en vez de caer a todos", () => {
    const sinEncargados = usuarios.filter((u) => u.rol !== "encargado");
    expect(destinatariosDelCorreo(sinEncargados, [])).toEqual([]);
  });
});
