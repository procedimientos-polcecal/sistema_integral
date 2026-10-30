import { describe, expect, it } from "vitest";
import {
  clasificar, emparejarEmpleado, porQueNoSeReconoce, tipoDesdeElMotivo, type NovedadDePlanilla,
} from "./importarNovedades";

const emp = [
  { id: "e1", nombre: "Roberto Orlando", apellido: "PICART" },
  { id: "e2", nombre: "Claudio Dario", apellido: "FERNANDEZ" },
  { id: "e3", nombre: "Carlos Abel", apellido: "FERNANDEZ" },
];

const nov = (o: Partial<NovedadDePlanilla> = {}): NovedadDePlanilla => ({
  fila: 2,
  nombre: "PICART Roberto Orlando",
  desde: "2026-03-10",
  hasta: "2026-03-12",
  motivo: "Vacaciones",
  ...o,
});

describe("emparejarEmpleado", () => {
  it("empareja APELLIDO Nombre ignorando acentos y mayusculas", () => {
    expect(emparejarEmpleado("PICART Roberto Orlando", emp)).toBe("e1");
    expect(emparejarEmpleado("  picart   roberto orlando ", emp)).toBe("e1");
  });

  it("ignora los acentos de los dos lados", () => {
    const con = [{ id: "x", nombre: "María José", apellido: "NÚÑEZ" }];
    expect(emparejarEmpleado("NUNEZ Maria Jose", con)).toBe("x");
  });

  it("no adivina cuando el apellido tiene dos personas y el nombre no alcanza", () => {
    expect(emparejarEmpleado("FERNANDEZ", emp)).toBeNull();
  });

  it("no adivina con un nombre que no esta", () => {
    expect(emparejarEmpleado("MILIA Pablo Ramiro Ramiro", emp)).toBeNull();
  });

  it("no adivina por parecido: un nombre de más o de menos no es la misma persona", () => {
    expect(emparejarEmpleado("PICART Roberto", emp)).toBeNull();
    expect(emparejarEmpleado("FERNANDEZ Claudio Dario Dario", emp)).toBeNull();
  });

  it("si dos empleados tienen exactamente el mismo nombre, no elige", () => {
    const repetidos = [
      { id: "a", nombre: "Juan", apellido: "PEREZ" },
      { id: "b", nombre: "Juan", apellido: "PEREZ" },
    ];
    expect(emparejarEmpleado("PEREZ Juan", repetidos)).toBeNull();
  });

  it("un nombre vacío no empareja con nadie", () => {
    expect(emparejarEmpleado("", emp)).toBeNull();
    expect(emparejarEmpleado("   ", [{ id: "z", nombre: "", apellido: "" }])).toBeNull();
  });
});

describe("tipoDesdeElMotivo", () => {
  it("traduce las etiquetas de la planilla al enum", () => {
    expect(tipoDesdeElMotivo("Enfermedad/accidente inculpable")).toBe("ENFERMEDAD_ACCIDENTE_INCULPABLE");
    expect(tipoDesdeElMotivo("Otra (aclarar)")).toBe("OTRA");
    expect(tipoDesdeElMotivo("Cualquier cosa")).toBeNull();
  });

  it("reconoce las dos etiquetas que la planilla escribe distinto de la pantalla", () => {
    // La planilla dice «Exámen/estudio» (con la tilde mal puesta) y «Fallecimiento
    // familiar» (sin el «de»): son los motivos 8 y 2 de las 218 novedades.
    expect(tipoDesdeElMotivo("Exámen/estudio")).toBe("EXAMEN_ESTUDIO");
    expect(tipoDesdeElMotivo("Fallecimiento familiar")).toBe("FALLECIMIENTO_FAMILIAR");
  });

  it("reconoce las doce, con mayúsculas y espacios de más", () => {
    expect(tipoDesdeElMotivo("  ausencia injustificada ")).toBe("INJUSTIFICADA");
    expect(tipoDesdeElMotivo("VACACIONES")).toBe("VACACIONES");
    expect(tipoDesdeElMotivo("")).toBeNull();
  });
});

describe("clasificar", () => {
  it("reconoce como ya cargada una que se solapa con la misma persona", () => {
    const existentes = [
      { empleado_id: "e1", fecha_desde: "2026-03-11", fecha_hasta: "2026-03-20", tipo: "VACACIONES" },
    ];
    const r = clasificar([nov()], emp, existentes);
    expect(r.yaEstaban).toHaveLength(1);
    expect(r.aImportar).toHaveLength(0);
    expect(r.sinReconocer).toHaveLength(0);
  });

  it("el solapamiento incluye los dos extremos: terminar el día que otra empieza ya es solaparse", () => {
    const existentes = [
      { empleado_id: "e1", fecha_desde: "2026-03-12", fecha_hasta: "2026-03-14", tipo: "OTRA" },
    ];
    expect(clasificar([nov()], emp, existentes).yaEstaban).toHaveLength(1);
  });

  it("el tipo no cuenta para saber si ya estaba: 60 se solapan y sólo 57 con el mismo tipo", () => {
    const existentes = [
      { empleado_id: "e1", fecha_desde: "2026-03-10", fecha_hasta: "2026-03-12", tipo: "PERMISO_PERSONAL" },
    ];
    expect(clasificar([nov()], emp, existentes).yaEstaban).toHaveLength(1);
  });

  it("el mismo rango de OTRA persona no cuenta como ya cargado", () => {
    const existentes = [
      { empleado_id: "e2", fecha_desde: "2026-03-10", fecha_hasta: "2026-03-12", tipo: "VACACIONES" },
    ];
    const r = clasificar([nov()], emp, existentes);
    expect(r.aImportar).toHaveLength(1);
    expect(r.yaEstaban).toHaveLength(0);
  });

  it("un rango de la misma persona que no se toca se importa, con su empleado y su tipo", () => {
    const existentes = [
      { empleado_id: "e1", fecha_desde: "2026-03-13", fecha_hasta: "2026-03-20", tipo: "VACACIONES" },
    ];
    const r = clasificar([nov({ motivo: "Permiso personal" })], emp, existentes);
    expect(r.aImportar).toEqual([
      { ...nov({ motivo: "Permiso personal" }), empleadoId: "e1", tipo: "PERMISO_PERSONAL" },
    ]);
  });

  it("lo que no se reconoce no se importa ni se descarta: se informa", () => {
    const r = clasificar(
      [
        nov({ fila: 5, nombre: "MILIA Pablo Ramiro Ramiro" }),
        nov({ fila: 6, motivo: "Cualquier cosa" }),
      ],
      emp,
      []
    );
    expect(r.aImportar).toHaveLength(0);
    expect(r.yaEstaban).toHaveLength(0);
    expect(r.sinReconocer.map((n) => n.fila)).toEqual([5, 6]);
  });

  it("un rango invertido no se importa: va a la lista que mira una persona", () => {
    // La tabla `ausencias` no tiene un check para esto y RRHH tampoco lo valida
    // al dar de alta. En producción hay cero: no se va a crear la primera acá.
    const r = clasificar([nov({ fila: 9, desde: "2026-03-12", hasta: "2026-03-10" })], emp, []);
    expect(r.aImportar).toHaveLength(0);
    expect(r.sinReconocer.map((n) => n.fila)).toEqual([9]);
  });

  it("una fecha que no se pudo leer tampoco se importa", () => {
    const r = clasificar([nov({ fila: 11, desde: "" })], emp, []);
    expect(r.aImportar).toHaveLength(0);
    expect(r.sinReconocer.map((n) => n.fila)).toEqual([11]);
  });

  it("una novedad repetida en la misma planilla entra una sola vez", () => {
    const r = clasificar([nov({ fila: 2 }), nov({ fila: 3 })], emp, []);
    expect(r.aImportar.map((n) => n.fila)).toEqual([2]);
    expect(r.yaEstaban.map((n) => n.fila)).toEqual([3]);
  });

  it("dos novedades de la misma persona que se pisan pero no son iguales entran las dos", () => {
    // No se adivina cuál es la «buena»: las dos son lo que la planilla dice.
    const r = clasificar(
      [
        nov({ fila: 2, desde: "2026-03-10", hasta: "2026-03-20", motivo: "Vacaciones" }),
        nov({ fila: 3, desde: "2026-03-15", hasta: "2026-03-15", motivo: "Permiso personal" }),
      ],
      emp,
      []
    );
    expect(r.aImportar.map((n) => n.fila)).toEqual([2, 3]);
  });
});

describe("porQueNoSeReconoce", () => {
  it("dice cuál de las comprobaciones falló, y null si ninguna", () => {
    expect(porQueNoSeReconoce(nov(), emp)).toBeNull();
    expect(porQueNoSeReconoce(nov({ nombre: "MILIA Pablo" }), emp)).toContain("nombre");
    expect(porQueNoSeReconoce(nov({ motivo: "Cualquier cosa" }), emp)).toContain("motivo");
    expect(porQueNoSeReconoce(nov({ desde: "2026-03-12", hasta: "2026-03-10" }), emp)).toContain("invertido");
    expect(porQueNoSeReconoce(nov({ desde: "" }), emp)).toContain("fecha ilegible");
  });
});
