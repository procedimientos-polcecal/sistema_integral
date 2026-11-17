import { describe, it, expect } from "vitest";
import {
  encabezadoDeLaPlanilla,
  fechaCorta,
  filasDeMarcaciones,
  horasTrabajadas,
  marcacionDeUnaFichada,
  marcacionesDelDia,
  nombreDelArchivo,
  nombreDelDia,
  observacionesDelDia,
  tieneActividad,
  totalesDeMarcaciones,
  type DiaDeLaPlanilla,
} from "./marcacionesDelMes";

/** Un día con lo mínimo, para pedir sólo lo que cada prueba mira. */
function dia(p: Partial<DiaDeLaPlanilla> & { fecha: string }): DiaDeLaPlanilla {
  return {
    tipo_dia: "HABIL",
    horas_normales: 0,
    horas_extra_50: 0,
    horas_extra_100: 0,
    fichadas: [],
    ...p,
  };
}

describe("marcacionDeUnaFichada", () => {
  it("escribe un turno de día como entrada-salida", () => {
    // 08:00 y 16:00 de Argentina (UTC-3).
    expect(
      marcacionDeUnaFichada({ hora_entrada: "2026-10-29T11:00:00Z", hora_salida: "2026-10-29T19:00:00Z" })
    ).toBe("08:00-16:00");
  });

  it("marca con +1 el turno que termina al día siguiente", () => {
    // El turno de noche: entra 19:39 del 29 y sale 03:35 del 30.
    expect(
      marcacionDeUnaFichada({ hora_entrada: "2026-10-29T22:39:00Z", hora_salida: "2026-10-30T06:35:00Z" })
    ).toBe("19:39-03:35 +1");
  });

  it("mira el día de Argentina y no el de UTC", () => {
    /*
     * El caso que distingue una cosa de la otra: 23:30 del 29 a 00:30 del 30,
     * hora de acá. Los dos instantes caen el 30 en UTC, así que comparar
     * `toISOString()` diría que no cruza la medianoche — y es justo el turno
     * que sí la cruza.
     */
    expect(
      marcacionDeUnaFichada({ hora_entrada: "2026-10-30T02:30:00Z", hora_salida: "2026-10-30T03:30:00Z" })
    ).toBe("23:30-00:30 +1");
  });

  it("no inventa la salida de una fichada abierta", () => {
    expect(marcacionDeUnaFichada({ hora_entrada: "2026-10-29T11:00:00Z", hora_salida: null })).toBe("08:00-?");
  });

  it("junta las marcaciones del día con un separador", () => {
    const d = dia({
      fecha: "2026-10-30",
      fichadas: [
        { hora_entrada: "2026-10-30T09:00:00Z", hora_salida: "2026-10-30T15:00:00Z" },
        { hora_entrada: "2026-10-30T16:00:00Z", hora_salida: "2026-10-30T23:00:00Z" },
      ],
    });
    expect(marcacionesDelDia(d)).toBe("06:00-12:00 · 13:00-20:00");
  });
});

describe("fechaCorta y nombreDelDia", () => {
  it("escribe la fecha como la lee una persona", () => {
    expect(fechaCorta("2026-10-29")).toBe("29/10/2026");
  });

  it("acepta un timestamp completo, no sólo el día suelto", () => {
    expect(fechaCorta("2026-10-29T00:00:00+00:00")).toBe("29/10/2026");
  });

  it("nombra el día de la semana", () => {
    expect(nombreDelDia("2026-10-29")).toBe("Jueves");
    expect(nombreDelDia("2026-11-01")).toBe("Domingo");
  });
});

describe("horasTrabajadas", () => {
  it("suma las normales y las dos clases de extra", () => {
    expect(horasTrabajadas(dia({ fecha: "2026-10-29", horas_normales: 8, horas_extra_50: 1.5, horas_extra_100: 2 }))).toBe(11.5);
  });

  it("lee los numeric que PostgREST devuelve como texto", () => {
    expect(horasTrabajadas(dia({ fecha: "2026-10-29", horas_normales: "8.00", horas_extra_50: "0.50", horas_extra_100: null }))).toBe(8.5);
  });
});

describe("tieneActividad", () => {
  it("deja afuera el día sin marcaciones y sin horas", () => {
    expect(tieneActividad(dia({ fecha: "2026-11-01" }))).toBe(false);
  });

  it("deja adentro el día con horas aunque no tenga marcaciones", () => {
    // Las horas cargadas a mano no traen fichadas y son las que más importan.
    expect(tieneActividad(dia({ fecha: "2026-10-29", horas_normales: 8, horas_manual: true }))).toBe(true);
  });

  it("deja adentro el día con una fichada abierta y cero horas", () => {
    const d = dia({ fecha: "2026-10-29", fichadas: [{ hora_entrada: "2026-10-29T11:00:00Z", hora_salida: null }] });
    expect(tieneActividad(d)).toBe(true);
  });
});

describe("observacionesDelDia", () => {
  it("no dice nada de un día normal", () => {
    expect(observacionesDelDia(dia({ fecha: "2026-10-29", horas_normales: 8 }))).toBe("");
  });

  it("avisa que las extras todavía no las validó nadie", () => {
    expect(observacionesDelDia(dia({ fecha: "2026-10-29", horas_normales: 8, horas_extra_50: 2 }))).toBe("Extras sin validar");
  });

  it("dice validadas cuando lo están", () => {
    const d = dia({ fecha: "2026-10-29", horas_normales: 8, horas_extra_50: 2, extras_validadas: true });
    expect(observacionesDelDia(d)).toBe("Extras validadas");
  });

  it("no habla de extras en un día que no tuvo", () => {
    const d = dia({ fecha: "2026-10-29", horas_normales: 8, extras_validadas: true });
    expect(observacionesDelDia(d)).toBe("");
  });

  it("junta la tardanza, el retiro y la corrección a mano", () => {
    const d = dia({ fecha: "2026-10-29", horas_normales: 6, tarde: true, retiro_anticipado: true, horas_manual: true });
    expect(observacionesDelDia(d)).toBe("Tardanza · Retiro anticipado · Horas corregidas a mano");
  });
});

describe("filasDeMarcaciones", () => {
  const dias: DiaDeLaPlanilla[] = [
    dia({ fecha: "2026-10-30", horas_normales: 8, horas_extra_50: 1 }),
    dia({ fecha: "2026-11-01" }), // domingo sin trabajar: no entra
    dia({
      fecha: "2026-10-29",
      tipo_dia: "HABIL",
      horas_normales: 8,
      fichadas: [{ hora_entrada: "2026-10-29T22:39:00Z", hora_salida: "2026-10-30T06:35:00Z" }],
    }),
  ];

  it("ordena por fecha y filtra los días vacíos", () => {
    expect(filasDeMarcaciones(dias).map((f) => f.fecha)).toEqual(["29/10/2026", "30/10/2026"]);
  });

  it("lleva el turno de noche entero al día en que empezó", () => {
    const [primera] = filasDeMarcaciones(dias);
    expect(primera.marcaciones).toBe("19:39-03:35 +1");
    expect(primera.horas).toBe(8);
  });

  it("no toca el arreglo que recibe", () => {
    const copia = [...dias];
    filasDeMarcaciones(dias);
    expect(dias).toEqual(copia);
  });
});

describe("totalesDeMarcaciones", () => {
  it("cuenta los días que vino, no los del período", () => {
    const t = totalesDeMarcaciones([
      dia({ fecha: "2026-10-29", horas_normales: 8, horas_extra_50: 1 }),
      dia({ fecha: "2026-10-30", horas_normales: "8.00", horas_extra_100: "2.00" }),
      dia({ fecha: "2026-10-31" }),
    ]);
    expect(t).toEqual({ dias: 2, horas: 19, extra50: 1, extra100: 2 });
  });

  it("da todo en cero cuando no hay nada", () => {
    expect(totalesDeMarcaciones([])).toEqual({ dias: 0, horas: 0, extra50: 0, extra100: 0 });
  });

  it("no arrastra la cola del punto flotante al total", () => {
    /*
     * Medido contra octubre de CEJAS, ALEJANDRO ANTONIO: veintisiete días
     * daban 224.51999999999998. En la pantalla no se ve —muestra un decimal—
     * pero la celda del .xlsx guarda ese número tal cual.
     */
    const dias = [
      dia({ fecha: "2026-10-01", horas_normales: 8, horas_extra_50: "0.52" }),
      ...Array.from({ length: 27 }, (_, i) => dia({ fecha: `2026-10-${String(i + 2).padStart(2, "0")}`, horas_normales: 8 })),
    ];
    const t = totalesDeMarcaciones(dias);
    expect(t.horas).toBe(224.52);
    expect(t.extra50).toBe(0.52);
  });
});

describe("encabezadoDeLaPlanilla", () => {
  it("arma los datos de arriba de la hoja", () => {
    expect(
      encabezadoDeLaPlanilla({ apellido: "CEJAS", nombre: "MARIO AGUSTIN", legajo: "154", sector: "Molienda" }, "2026-10-01", "2026-10-31")
    ).toEqual([
      ["Empleado", "CEJAS, MARIO AGUSTIN"],
      ["Legajo", "154"],
      ["Sector", "Molienda"],
      ["Período", "01/10/2026 al 31/10/2026"],
    ]);
  });

  it("omite el sector cuando el empleado no tiene", () => {
    const filas = encabezadoDeLaPlanilla({ apellido: "CEJAS", nombre: "MARIO", legajo: null, sector: null }, "2026-10-01", "2026-10-31");
    expect(filas.map(([e]) => e)).toEqual(["Empleado", "Legajo", "Período"]);
    expect(filas[1][1]).toBe("—");
  });
});

describe("nombreDelArchivo", () => {
  it("lleva la persona y el período, para que no se pisen entre sí", () => {
    expect(nombreDelArchivo("CEJAS, MARIO AGUSTIN", "2026-10-01", "2026-10-31", "xlsx")).toBe(
      "marcaciones-cejas-mario-agustin-2026-10-01-a-2026-10-31.xlsx"
    );
  });

  it("usa la extensión que se le pide", () => {
    expect(nombreDelArchivo("PEREZ, ANA", "2026-10-01", "2026-10-31", "pdf")).toMatch(/\.pdf$/);
  });
});
