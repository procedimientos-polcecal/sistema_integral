import { describe, it, expect } from "vitest";
import { emparejar, estaObsoleto } from "./drive";
import {
  planDeReconciliacion, sanearTurnos, leerCsvsDelMolino, importarMolino,
  type MolinoACargar,
} from "./importar";
import type { TurnoDeRobot } from "./turnos";

// ─────────────────────────────────────────────────────────────
// Drive: qué zip es de qué molino, y cuándo uno está viejo
// ─────────────────────────────────────────────────────────────

describe("emparejar", () => {
  const molinos = [
    { clave: "filler_1", prefijo_archivo: "Filler 1" },
    { clave: "filler_2", prefijo_archivo: "Filler 2" },
  ];

  it("empareja el archivo con el molino por prefijo, y no adivina", () => {
    const r = emparejar(
      [{ nombre: "Filler 1 2026-10-29.zip" }, { nombre: "Filler 9 2026-10-29.zip" }],
      [{ clave: "filler_1", prefijo_archivo: "Filler 1" }],
    );
    expect(r.archivos.map((a) => a.molinoClave)).toEqual(["filler_1"]);
    expect(r.sinMolino).toEqual(["Filler 9 2026-10-29.zip"]);
  });

  it("'Filler 10' no es de 'Filler 1': el prefijo tiene que terminar donde termina la palabra", () => {
    const r = emparejar([{ nombre: "Filler 10 2026-10-29.zip" }], molinos);
    expect(r.archivos).toEqual([]);
    expect(r.sinMolino).toEqual(["Filler 10 2026-10-29.zip"]);
  });

  it("se queda con el zip más nuevo de cada molino", () => {
    const r = emparejar(
      [
        { nombre: "Filler 1 2026-10-27.zip", id: "viejo", modificado: "2026-10-27T12:30:00Z" },
        { nombre: "Filler 1 2026-10-29.zip", id: "nuevo", modificado: "2026-10-29T12:30:00Z" },
        { nombre: "Filler 1 2026-10-28.zip", id: "medio", modificado: "2026-10-28T12:30:00Z" },
        { nombre: "Filler 2 2026-10-29.zip", id: "f2", modificado: "2026-10-29T11:55:00Z" },
      ],
      molinos,
    );
    expect(r.archivos.map((a) => [a.molinoClave, a.id])).toEqual([
      ["filler_1", "nuevo"],
      ["filler_2", "f2"],
    ]);
    // Los viejos no son un problema: que haya días anteriores es lo normal.
    expect(r.sinMolino).toEqual([]);
  });

  it("lo que no es un zip no se importa aunque empiece con el prefijo", () => {
    const r = emparejar([{ nombre: "Filler 1 notas.txt" }], molinos);
    expect(r.archivos).toEqual([]);
    expect(r.sinMolino).toEqual(["Filler 1 notas.txt"]);
  });

  it("si dos prefijos compiten, gana el más largo", () => {
    const r = emparejar(
      [{ nombre: "Filler 1 Calera 2026-10-29.zip" }],
      [
        { clave: "filler_1", prefijo_archivo: "Filler 1" },
        { clave: "filler_1_calera", prefijo_archivo: "Filler 1 Calera" },
      ],
    );
    expect(r.archivos.map((a) => a.molinoClave)).toEqual(["filler_1_calera"]);
  });
});

describe("estaObsoleto", () => {
  it("marca obsoleto cuando el archivo mas nuevo tiene mas de un dia", () => {
    expect(estaObsoleto("2026-10-27T12:00:00Z", new Date("2026-10-29T12:00:00Z"))).toBe(true);
    expect(estaObsoleto("2026-10-29T12:00:00Z", new Date("2026-10-29T13:00:00Z"))).toBe(false);
  });

  it("el borde es a las 24 horas, y cuenta el borde", () => {
    const ahora = new Date("2026-10-29T12:00:00Z");
    expect(estaObsoleto("2026-10-28T12:00:00Z", ahora)).toBe(true);
    expect(estaObsoleto("2026-10-28T12:00:01Z", ahora)).toBe(false);
  });

  it("una fecha ilegible no se da por buena", () => {
    expect(estaObsoleto("", new Date("2026-10-29T12:00:00Z"))).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────
// La reconciliación, sobre datos
// ─────────────────────────────────────────────────────────────

const turno = (fecha: string, t: TurnoDeRobot["turno"], kg: number, extra: Partial<TurnoDeRobot> = {}): TurnoDeRobot => ({
  fecha, turno: t, kg, minutosMarcha: 240, minutosTeoricos: 240, estado: "normal", porMaterial: {}, ...extra,
});

/** Todos los turnos de una lista de días: es lo que tiene un día operativo. */
const dias = (fechas: string[], kg = 1000): TurnoDeRobot[] =>
  fechas.flatMap((f) => (["00_04", "04_12", "12_20", "20_00"] as const).map((t) => turno(f, t, kg)));

describe("planDeReconciliacion", () => {
  it("lo nuevo se inserta, lo igual no se toca, lo cambiado se reescribe", () => {
    const base = [turno("2026-10-27", "00_04", 100), turno("2026-10-27", "04_12", 200)];
    const zip = [
      turno("2026-10-27", "00_04", 100),                 // igual
      turno("2026-10-27", "04_12", 250),                 // cambió el kg
      turno("2026-10-27", "12_20", 300),                 // nuevo
    ];
    const plan = planDeReconciliacion(zip, base);
    expect(plan.turnosAInsertar.map((t) => `${t.turno}:${t.kg}`)).toEqual(["04_12:250", "12_20:300"]);
    expect(plan.turnosABorrar).toEqual([]);
  });

  it("detecta el cambio en cada campo y no sólo en los kilos", () => {
    const base = [turno("2026-10-27", "00_04", 100, { porMaterial: { caliza: 5, dolomita: 1 } })];
    const cambia = (extra: Partial<TurnoDeRobot>) =>
      planDeReconciliacion([{ ...base[0], ...extra }], base).turnosAInsertar.length;
    expect(cambia({})).toBe(0);
    // El orden de las claves del jsonb no cuenta como cambio.
    expect(cambia({ porMaterial: { dolomita: 1, caliza: 5 } })).toBe(0);
    expect(cambia({ minutosMarcha: 200 })).toBe(1);
    expect(cambia({ minutosTeoricos: 480 })).toBe(1);
    expect(cambia({ estado: "acumulado" })).toBe(1);
    expect(cambia({ porMaterial: { caliza: 6, dolomita: 1 } })).toBe(1);
  });

  it("borra lo que el zip ya no trae", () => {
    const base = dias(["2026-10-27", "2026-10-28"]);
    const zip = dias(["2026-10-27", "2026-10-29"]);
    const plan = planDeReconciliacion(zip, base);
    expect(plan.turnosABorrar.map((b) => b.fecha)).toEqual(Array(4).fill("2026-10-28"));
    expect(plan.turnosAInsertar.map((t) => t.fecha)).toEqual(Array(4).fill("2026-10-29"));
  });

  it("un zip con menos dias de los que la base ya tiene no se aplica", () => {
    const dosDias = dias(["2026-10-27", "2026-10-28"]);
    const muchos = dias(Array.from({ length: 600 }, (_, i) => new Date(Date.UTC(2025, 0, 1 + i)).toISOString().slice(0, 10)));
    expect(() => planDeReconciliacion(dosDias, muchos)).toThrow(/encogi/i);
  });

  it("el freno cuenta días y no turnos: el día en curso puede traer menos turnos", () => {
    const base = dias(["2026-10-27", "2026-10-28"]);
    const zip = [...dias(["2026-10-27"]), turno("2026-10-28", "00_04", 1)];
    expect(() => planDeReconciliacion(zip, base)).not.toThrow();
  });

  it("con la base vacía, cualquier zip entra entero; y un zip vacío sobre una base vacía no es un error", () => {
    expect(planDeReconciliacion(dias(["2026-10-27"]), []).turnosAInsertar).toHaveLength(4);
    expect(planDeReconciliacion([], [])).toEqual({ turnosAInsertar: [], turnosABorrar: [] });
  });

  it("un zip vacío sobre una base con historia es un encogimiento", () => {
    expect(() => planDeReconciliacion([], dias(["2026-10-27"]))).toThrow(/encogi/i);
  });
});

describe("sanearTurnos", () => {
  it("lleva un negativo a cero y lo dice; lo válido no se toca", () => {
    const { turnos, avisos } = sanearTurnos([
      turno("2026-10-27", "00_04", -5),
      turno("2026-10-27", "04_12", 7, { minutosMarcha: -1 }),
      turno("2026-10-27", "12_20", 9),
    ]);
    expect(turnos.map((t) => [t.kg, t.minutosMarcha])).toEqual([[0, 240], [7, 0], [9, 240]]);
    expect(avisos).toHaveLength(2);
    expect(avisos[0]).toContain("2026-10-27 00_04");
  });

  it("un valor que no es número tampoco llega a la base", () => {
    const { turnos } = sanearTurnos([turno("2026-10-27", "00_04", NaN)]);
    expect(turnos[0].kg).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────
// Qué archivo del zip alimenta cada turno
// ─────────────────────────────────────────────────────────────

/** Una línea de Filler 2: fecha, hora y seis pares kg;minutos (sólo el primero con valor). */
const lineaF2 = (fecha: string, hora: string, kg: number, min: number) =>
  `${fecha};${hora};${kg};${min};${Array(10).fill(0).join(";")}\r\n`;

const CORTES_F2 = [
  ["3:59", 240],
  ["11:59", 480],
  ["19:59", 480],
  ["23:59", 240],
] as const;

/** El contenido de los cuatro CSV de Filler 2 para una lista de días d/m/yyyy. */
function zipF2(fechas: string[], kg = 1000): Record<string, string> {
  const csvs: Record<string, string> = {};
  CORTES_F2.forEach(([hora, min], i) => {
    csvs[`DAT0000000${i + 1}.CSV`] = fechas.map((f) => lineaF2(f, hora, kg, min)).join("") + "\r\n\r\n";
  });
  return csvs;
}

describe("leerCsvsDelMolino", () => {
  it("Filler 2: DAT00000001..04 son los cortes 3:59, 11:59, 19:59 y 23:59 por orden", () => {
    const { filas, avisos } = leerCsvsDelMolino("filler_2", {
      "DAT00000002.CSV": lineaF2("27/10/2026", "11:59", 1500, 480),
    });
    expect(filas.map((f) => [f.fecha, f.corte, f.kg])).toEqual([["2026-10-27", "11:59", 1500]]);
    // Faltan tres archivos: se dice cuáles en vez de callar.
    expect(avisos.filter((a) => /no trae DAT0000000[134]/.test(a))).toHaveLength(3);
  });

  it("encuentra los archivos sin importar mayúsculas", () => {
    const { filas } = leerCsvsDelMolino("filler_2", { "dat00000001.csv": lineaF2("27/10/2026", "3:59", 10, 240) });
    expect(filas).toHaveLength(1);
  });

  it("Filler 2 sin ninguno de sus cuatro archivos no es un zip de Filler 2", () => {
    expect(() => leerCsvsDelMolino("filler_2", { "DAT00000010.CSV": "x" })).toThrow(/ninguno/);
  });

  it("Filler 1 sin DAT00000001 se niega, y sin el desglose avisa pero sigue", () => {
    expect(() => leerCsvsDelMolino("filler_1", {})).toThrow(/DAT00000001/);
    const dat1 = "27/10/2026;23:59;47576;0;0;0;239;min;MEMBRANERO;AUTOMATICO\r\n";
    const { filas, avisos } = leerCsvsDelMolino("filler_1", { "DAT00000001.CSV": dat1 });
    expect(filas).toHaveLength(1);
    expect(filas[0].kg).toBe(47576);
    expect(avisos.filter((a) => /sin reparto/.test(a))).toHaveLength(4);
  });

  it("Filler 1: cada archivo del desglose cae en el corte que le toca, sin avisos de hora cruzada", () => {
    const horas = ["3:59", "11:59", "19:59", "23:59"];
    const dat1 = horas.map((h) => `27/10/2026;${h};1000;0;0;0;240;min;MEMBRANERO;AUTOMATICO
`).join("");
    const csvs: Record<string, string> = { "DAT00000001.CSV": dat1 };
    horas.forEach((h, i) => { csvs[`DAT0000000${i + 3}.CSV`] = `27/10/2026;${h};1000;0;0
`; });
    const { filas, avisos } = leerCsvsDelMolino("filler_1", csvs);
    expect(avisos).toEqual([]);
    expect(filas.every((f) => f.porMaterial.membranero === 1000)).toBe(true);
  });

  it("Filler 1: el desglose del archivo 06 es el de las 23:59", () => {
    const dat1 = "27/10/2026;23:59;47576;0;0;0;239;min;MEMBRANERO;AUTOMATICO\r\n";
    const { filas } = leerCsvsDelMolino("filler_1", {
      "DAT00000001.CSV": dat1,
      "DAT00000006.CSV": "27/10/2026;23:59;47576;0;0\r\n",
    });
    expect(filas[0].porMaterial).toEqual({ membranero: 47576, dolomita: 0, caliza: 0 });
  });
});

// ─────────────────────────────────────────────────────────────
// importarMolino contra una base en memoria
// ─────────────────────────────────────────────────────────────

type Fila = Record<string, unknown>;

/**
 * Lo mínimo de PostgREST que usa la importación: select/eq/order/range, upsert
 * por (molino_id, fecha, turno), delete con eq/in. Anota qué tablas se tocaron.
 */
function baseEnMemoria(inicial: Record<string, Fila[]>) {
  const tablas = inicial;
  const tocadas = new Set<string>();
  const admin = {
    from(nombre: string) {
      tocadas.add(nombre);
      const filas = tablas[nombre] ?? (tablas[nombre] = []);
      const consulta = (modo: "select" | "delete") => {
        const filtros: ((f: Fila) => boolean)[] = [];
        let rango: [number, number] | null = null;
        const q = {
          eq: (c: string, v: unknown) => (filtros.push((f) => f[c] === v), q),
          in: (c: string, vs: unknown[]) => (filtros.push((f) => vs.includes(f[c])), q),
          order: () => q,
          range: (a: number, b: number) => ((rango = [a, b]), q),
          then: (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => {
            const coinciden = filas.filter((f) => filtros.every((p) => p(f)));
            if (modo === "delete") {
              for (const f of coinciden) filas.splice(filas.indexOf(f), 1);
              return Promise.resolve({ data: null, error: null }).then(ok, ko);
            }
            // PostgREST corta en 1000 filas y no avisa, pida lo que pida.
            const data = (rango ? coinciden.slice(rango[0], rango[1] + 1) : coinciden).slice(0, 1000);
            return Promise.resolve({ data: data.map((f) => ({ ...f })), error: null }).then(ok, ko);
          },
        };
        return q;
      };
      return {
        select: () => consulta("select"),
        delete: () => consulta("delete"),
        upsert: (lote: Fila[]) => {
          for (const n of lote) {
            const i = filas.findIndex(
              (f) => f.molino_id === n.molino_id && f.fecha === n.fecha && f.turno === n.turno,
            );
            if (i >= 0) filas[i] = { ...filas[i], ...n };
            else filas.push({ ...n });
          }
          return Promise.resolve({ error: null });
        },
      };
    },
  };
  return { admin: admin as never, tablas, tocadas };
}

const FILLER_2: MolinoACargar = { id: "m2", clave: "filler_2", nombre: "Filler 2", formato: "filler_2" };

describe("importarMolino", () => {
  it("la primera vez inserta todo y la segunda no escribe nada", async () => {
    const { admin, tablas } = baseEnMemoria({ produccion_molino_turnos: [] });
    const zip = zipF2(["27/10/2026", "28/10/2026"]);

    const a = await importarMolino(admin, FILLER_2, zip);
    expect(a).toMatchObject({ turnos: 8, insertados: 8, actualizados: 0, borrados: 0 });
    expect(tablas.produccion_molino_turnos).toHaveLength(8);

    const b = await importarMolino(admin, FILLER_2, zip);
    expect(b).toMatchObject({ turnos: 8, insertados: 0, actualizados: 0, borrados: 0 });
    expect(tablas.produccion_molino_turnos).toHaveLength(8);
  });

  it("los turnos huérfanos también se guardan, y releer el zip no los reescribe", async () => {
    // Un día con sólo las dos primeras filas: las de las 19:59 y 23:59 quedan huérfanas.
    const { admin, tablas } = baseEnMemoria({ produccion_molino_turnos: [] });
    const zip = zipF2(["27/10/2026"]);
    zip["DAT00000003.CSV"] = "\r\n";
    zip["DAT00000004.CSV"] = "\r\n";
    const a = await importarMolino(admin, FILLER_2, zip);
    expect(a.insertados).toBe(4);
    expect(tablas.produccion_molino_turnos.filter((t) => t.estado === "huerfano")).toHaveLength(2);
    expect(tablas.produccion_molino_turnos.find((t) => t.estado === "huerfano")).toMatchObject({ kg: 0, minutos_teoricos: 0 });
    expect(await importarMolino(admin, FILLER_2, zip)).toMatchObject({ insertados: 0, actualizados: 0 });
  });

  it("escribe lo que armó el cálculo: kg, minutos, estado y fecha ISO", async () => {
    const { admin, tablas } = baseEnMemoria({ produccion_molino_turnos: [] });
    await importarMolino(admin, FILLER_2, zipF2(["27/10/2026"], 1234));
    const f = tablas.produccion_molino_turnos.find((t) => t.turno === "04_12");
    expect(f).toMatchObject({
      molino_id: "m2", fecha: "2026-10-27", kg: 1234, minutos_marcha: 480, minutos_teoricos: 480, estado: "normal",
    });
    expect((f!.por_material as Record<string, number>).piedra_membranero).toBe(1234);
  });

  it("reconciliar no pisa la parada que cargo una persona", async () => {
    // Base: 27, 28 y 29, con una parada explicada el 28. El zip nuevo perdió el
    // 28 (planta cerrada) y trae el 30: los turnos del 28 se borran, la parada no.
    const parada = { id: "p1", molino_id: "m2", fecha: "2026-10-28", turno: "04_12", motivo: "Cambio de martillos" };
    const { admin, tablas, tocadas } = baseEnMemoria({
      produccion_molino_turnos: [],
      produccion_molino_paradas: [parada],
    });
    await importarMolino(admin, FILLER_2, zipF2(["27/10/2026", "28/10/2026", "29/10/2026"]));
    tocadas.clear();

    const r = await importarMolino(admin, FILLER_2, zipF2(["27/10/2026", "29/10/2026", "30/10/2026"]));
    expect(r.borrados).toBe(4);
    expect(tablas.produccion_molino_turnos.some((t) => t.fecha === "2026-10-28")).toBe(false);

    expect(tablas.produccion_molino_paradas).toEqual([parada]);
    // Y no se la tocó ni para leerla.
    expect(tocadas.has("produccion_molino_paradas")).toBe(false);
  });

  it("un zip que perdió un día sin reemplazo no se aplica y no borra nada", async () => {
    const { admin, tablas } = baseEnMemoria({ produccion_molino_turnos: [] });
    await importarMolino(admin, FILLER_2, zipF2(["27/10/2026", "28/10/2026", "29/10/2026"]));

    await expect(importarMolino(admin, FILLER_2, zipF2(["27/10/2026", "28/10/2026"]))).rejects.toThrow(/encogi/i);
    expect(tablas.produccion_molino_turnos).toHaveLength(12);
  });

  it("lo que cambió en el zip se actualiza en su lugar", async () => {
    const { admin, tablas } = baseEnMemoria({ produccion_molino_turnos: [] });
    await importarMolino(admin, FILLER_2, zipF2(["27/10/2026"], 1000));
    const r = await importarMolino(admin, FILLER_2, zipF2(["27/10/2026"], 2000));
    expect(r).toMatchObject({ insertados: 0, actualizados: 4, borrados: 0 });
    expect(tablas.produccion_molino_turnos.every((t) => t.kg === 2000)).toBe(true);
    expect(tablas.produccion_molino_turnos).toHaveLength(4);
  });

  it("borrar los turnos de un molino no toca los del otro", async () => {
    const ajeno = { molino_id: "m1", fecha: "2026-10-28", turno: "04_12", kg: 5, minutos_marcha: 1, minutos_teoricos: 480, estado: "normal", por_material: {} };
    const { admin, tablas } = baseEnMemoria({ produccion_molino_turnos: [ajeno] });
    await importarMolino(admin, FILLER_2, zipF2(["27/10/2026", "28/10/2026"]));
    await importarMolino(admin, FILLER_2, zipF2(["27/10/2026", "29/10/2026"]));
    expect(tablas.produccion_molino_turnos).toContainEqual(ajeno);
  });

  it("el freno de un molino no mira la historia del otro", async () => {
    const historiaAjena = dias(Array.from({ length: 10 }, (_, i) => `2026-09-${String(i + 1).padStart(2, "0")}`))
      .map((t) => ({ molino_id: "m1", fecha: t.fecha, turno: t.turno, kg: 1, minutos_marcha: 1, minutos_teoricos: 240, estado: "normal", por_material: {} }));
    const { admin } = baseEnMemoria({ produccion_molino_turnos: historiaAjena });
    await expect(importarMolino(admin, FILLER_2, zipF2(["27/10/2026", "28/10/2026"]))).resolves.toMatchObject({ insertados: 8 });
  });

  it("lee la base entera aunque pase de las 1000 filas que PostgREST devuelve de una vez", async () => {
    const { admin, tablas } = baseEnMemoria({ produccion_molino_turnos: [] });
    // 300 días x 4 turnos = 1.200 filas.
    const fechas = Array.from({ length: 300 }, (_, i) => {
      const d = new Date(Date.UTC(2026, 0, 1 + i));
      return `${d.getUTCDate()}/${d.getUTCMonth() + 1}/${d.getUTCFullYear()}`;
    });
    const zip = zipF2(fechas);
    await importarMolino(admin, FILLER_2, zip);
    expect(tablas.produccion_molino_turnos).toHaveLength(1200);

    // Si la lectura se quedara en las primeras 1000, creería que 200 turnos
    // son nuevos y los reescribiría.
    const otra = await importarMolino(admin, FILLER_2, zip);
    expect(otra).toMatchObject({ insertados: 0, actualizados: 0, borrados: 0 });
  });

  it("los avisos del parseo vuelven en el resultado", async () => {
    const { admin } = baseEnMemoria({ produccion_molino_turnos: [] });
    const zip = zipF2(["27/10/2026"]);
    zip["DAT00000001.CSV"] += "31/2/2026;3:59;1;1;0;0;0;0;0;0;0;0;0;0\r\n";
    const r = await importarMolino(admin, FILLER_2, zip);
    expect(r.avisos.some((a) => /fecha/.test(a))).toBe(true);
    expect(r.turnos).toBe(4);
  });
});
