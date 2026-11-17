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
  rangoDeFechas,
  repartirVacacionesYAusencias,
  type NovedadesDelDia,
} from "./novedadesDelDia";

const VACIO: NovedadesDelDia = { ausencias: [], vacaciones: [], francosTomados: [], francosGenerados: [] };

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
