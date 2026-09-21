import { describe, expect, it } from "vitest";
import { filaDestapeDeRegistro, registrosDeDestape } from "./importarDestape";
import type { EmpleadoLiviano, FleteroLiviano } from "./destape";

const FLETEROS: FleteroLiviano[] = [
  { id: "orsatti1", nombre: "Orsatti 1" }, { id: "orsatti2", nombre: "Orsatti 2" },
  { id: "amaray", nombre: "Amaray" }, { id: "schneider", nombre: "Schneider" },
];
const EMPLEADOS: EmpleadoLiviano[] = [
  { id: "jorge", nombre: "JORGE ENRIQUE", apellido: "BECKER" },
];
const EQUIPOS = [{ id: "em3", code: "EM3" }];

describe("filaDestapeDeRegistro — filas reales de la planilla", () => {
  it("fletero externo: Orsatti, Camión grande, 8h, 16 viajes — sin resolver (Orsatti ambiguo)", () => {
    const fila = [46245, 46235, "D1", "", "Fletero externo", "Orsatti", "Camión grande", 8, 16, 0, ""];
    const r = filaDestapeDeRegistro(fila, FLETEROS, EMPLEADOS, EQUIPOS);
    expect(r).not.toBeNull();
    expect(r!.fecha).toBe("2026-08-11");
    expect(r!.tipo_recurso).toBe("fletero_externo");
    expect(r!.fletero_id).toBeNull(); // "Orsatti" sin número es ambiguo
    expect(r!.recurso_raw).toBe("Orsatti");
    expect(r!.tipo_camion).toBe("camion_grande");
    expect(r!.horas).toBe(8);
    expect(r!.viajes).toBe(16);
  });

  it("fletero externo: Amaray (no ambiguo) resuelve a un fletero_id", () => {
    const fila = [46246, 46235, "D1", "", "Fletero externo", "Amaray", "Camión chico", 8, 28, 448, ""];
    const r = filaDestapeDeRegistro(fila, FLETEROS, EMPLEADOS, EQUIPOS);
    expect(r!.fletero_id).toBe("amaray");
    expect(r!.tipo_camion).toBe("camion_chico");
  });

  it("operario propio: Jorge Becker con EM3 resuelve operario_id y equipo_id", () => {
    const fila = [46245, 46235, "D1", "", "Operario propio", "Jorge Becker", "EM3 - Doosan 225 1", 8, "", "", ""];
    const r = filaDestapeDeRegistro(fila, FLETEROS, EMPLEADOS, EQUIPOS);
    expect(r!.tipo_recurso).toBe("operario_propio");
    expect(r!.operario_id).toBe("jorge");
    expect(r!.equipo_id).toBe("em3");
    expect(r!.viajes).toBeNull();
    expect(r!.tipo_camion).toBeNull();
  });

  it("yacimiento vacío con 'frente' tipo 'chocol' — yacimiento_codigo null, frente guardado tal cual", () => {
    const fila = [46249, 46235, "", "chocol", "Fletero externo", "Arenzo", "Camión chico", 8, "", "", ""];
    const r = filaDestapeDeRegistro(fila, FLETEROS, EMPLEADOS, EQUIPOS);
    expect(r!.yacimiento_codigo).toBeNull();
    expect(r!.frente).toBe("chocol");
  });

  it("sin horas o con horas 0 se descarta (fila sin dato real)", () => {
    const fila = [46249, 46235, "D1", "", "", "", "", "", "", "", ""];
    expect(filaDestapeDeRegistro(fila, FLETEROS, EMPLEADOS, EQUIPOS)).toBeNull();
  });
});

describe("registrosDeDestape", () => {
  it("salta las 3 filas de encabezado y cuenta las descartadas", () => {
    const encabezados = [["t1"], ["t2"], ["t3"]];
    const filas = [
      ...encabezados,
      [46245, 46235, "D1", "", "Fletero externo", "Amaray", "Camión chico", 8, 16, 128, ""],
      [46246, 46235, "D1", "", "", "", "", "", "", "", ""],
    ];
    const { registros, saltadas } = registrosDeDestape(filas, FLETEROS, EMPLEADOS, EQUIPOS);
    expect(registros).toHaveLength(1);
    expect(saltadas).toBe(1);
  });
});
