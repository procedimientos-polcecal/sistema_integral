import { describe, expect, it } from "vitest";
import { genteDelDia, oficioDeLaEspecialidad } from "./genteDelDia";
import type { AusenciaCruda, FrancoCrudo, PersonaDelTaller } from "./disponibilidad";

const persona = (
  empleadoId: string,
  oficio: PersonaDelTaller["oficio"],
  extra: Partial<PersonaDelTaller> = {},
): PersonaDelTaller => ({
  empleadoId,
  oficio,
  grupo: null,
  desde: "2026-01-01",
  hasta: null,
  ...extra,
});

const DIA = "2026-11-06";

/** Dos mecánicos, un electricista y un lubricador: un taller chico pero con los tres oficios. */
const PADRON: PersonaDelTaller[] = [
  persona("m1", "mecanico"),
  persona("m2", "mecanico"),
  persona("e1", "electricista"),
  persona("l1", "lubricador"),
];

const ausencia = (
  empleado_id: string,
  fecha_desde: string,
  fecha_hasta: string,
  tipo = "ENFERMEDAD",
): AusenciaCruda => ({ empleado_id, fecha_desde, fecha_hasta, tipo });

/** Por defecto `TOMADO`: lo que importa de un franco acá es su fecha_descanso. */
const franco = (
  empleado_id: string,
  fecha_descanso: string | null,
  estado = "TOMADO",
): FrancoCrudo => ({ empleado_id, estado, fecha_descanso });

function porOficio(r: ReturnType<typeof genteDelDia>) {
  if (!r.sabemos) throw new Error("se esperaba que supiera");
  return r.porOficio;
}

describe("cuanta gente del taller hay un dia", () => {
  /** La decision del usuario: por DIA, no por turno. Los grupos A y B nunca van
      a 8-16, asi que contar por turno daria cero mecanicos para siempre. */
  it("cuenta a todo el taller presente, sin mirar el turno", () => {
    // Los dos mecanicos estan en grupos distintos (uno en 4-12, otro en 12-20
    // esa semana): ninguno va a 8-16 y los dos cuentan.
    const padron = [
      persona("m1", "mecanico", { grupo: "A" }),
      persona("m2", "mecanico", { grupo: "B" }),
      persona("e1", "electricista"),
      persona("l1", "lubricador", { grupo: "A" }),
    ];
    expect(porOficio(genteDelDia(padron, [], [], DIA))).toEqual({
      mecanico: 2,
      electricista: 1,
      lubricador: 1,
    });
  });

  it("un oficio sin nadie en el padron es cero sabiendo, no desconocido", () => {
    // El padron tiene gente, asi que la ausencia de electricistas es un dato.
    const r = genteDelDia([persona("m1", "mecanico")], [], [], DIA);
    expect(r).toEqual({
      sabemos: true,
      porOficio: { mecanico: 1, electricista: 0, lubricador: 0 },
    });
  });

  it("un ausente no cuenta", () => {
    const r = porOficio(genteDelDia(PADRON, [ausencia("m1", "2026-11-05", "2026-11-07")], [], DIA));
    expect(r.mecanico).toBe(1);
    expect(r.electricista).toBe(1);
  });

  it("una ausencia que ya termino o todavia no empieza no saca a nadie", () => {
    const r = porOficio(
      genteDelDia(
        PADRON,
        [ausencia("m1", "2026-11-01", "2026-11-05"), ausencia("m2", "2026-11-07", "2026-11-09")],
        [],
        DIA,
      ),
    );
    expect(r.mecanico).toBe(2);
  });

  /** Un franco abre hueco por `fecha_descanso`, NUNCA por `fecha_tomado`. */
  it("un franco con fecha_descanso ese dia no cuenta", () => {
    const r = porOficio(genteDelDia(PADRON, [], [franco("l1", DIA)], DIA));
    expect(r.lubricador).toBe(0);
    expect(r.mecanico).toBe(2);
  });

  it("un franco con fecha_descanso otro dia no saca a nadie ese dia", () => {
    const r = porOficio(genteDelDia(PADRON, [], [franco("l1", "2026-11-07")], DIA));
    expect(r.lubricador).toBe(1);
  });

  it("un franco que todavia no se tomo no abre hueco, aunque traiga fecha", () => {
    // Misma vara que la programacion: sin TOMADO el franco no tiene dia firme.
    const r = porOficio(genteDelDia(PADRON, [], [franco("l1", DIA, "PENDIENTE")], DIA));
    expect(r.lubricador).toBe(1);
  });

  it("un franco con fecha_descanso en null no abre hueco", () => {
    // Los 56 viejos: el sistema no sabe cuando descansaron.
    const r = porOficio(genteDelDia(PADRON, [], [franco("m1", null), franco("m2", null)], DIA));
    expect(r.mecanico).toBe(2);
  });

  /** Una TARDANZA viene a trabajar. */
  it("una tardanza no saca a nadie", () => {
    const r = porOficio(genteDelDia(PADRON, [ausencia("e1", DIA, DIA, "TARDANZA")], [], DIA));
    expect(r.electricista).toBe(1);
  });

  it("alguien fuera de su vigencia no cuenta", () => {
    const padron = [
      persona("m1", "mecanico"),
      persona("m2", "mecanico", { desde: "2026-11-07" }), // entra mañana
      persona("m3", "mecanico", { hasta: "2026-11-05" }), // se fue ayer
      persona("e1", "electricista"),
    ];
    const r = porOficio(genteDelDia(padron, [], [], DIA));
    expect(r.mecanico).toBe(1);
  });

  it("una persona con ausencia y franco el mismo dia se cuenta una sola vez fuera", () => {
    const r = porOficio(
      genteDelDia(PADRON, [ausencia("m1", DIA, DIA)], [franco("m1", DIA)], DIA),
    );
    expect(r.mecanico).toBe(1);
  });

  /**
   * El esquema no impide dos filas vigentes de la misma persona (no hay unique
   * ni exclusion), y el padron esta vacio: cargarlo es lo primero que se va a
   * hacer. Contar filas duplicaria a quien tenga dos.
   */
  it("una persona con dos filas vigentes del padron cuenta una sola vez", () => {
    const padron = [
      persona("m1", "mecanico"),
      persona("m1", "mecanico", { desde: "2026-06-01" }),
      persona("m2", "mecanico"),
    ];
    expect(porOficio(genteDelDia(padron, [], [], DIA)).mecanico).toBe(2);
  });

  it("y si esa persona falta ese dia, no cuenta ninguna de sus dos filas", () => {
    const padron = [persona("m1", "mecanico"), persona("m1", "mecanico", { desde: "2026-06-01" })];
    expect(porOficio(genteDelDia(padron, [ausencia("m1", DIA, DIA)], [], DIA)).mecanico).toBe(0);
  });

  /** La distincion que el anti-objetivo exige: cero no es lo mismo que no se. */
  it("con el padron vacio contesta que no sabe, no cero", () => {
    expect(genteDelDia([], [], [], "2026-11-06")).toEqual({ sabemos: false });
  });

  it("con el padron vacio no sabe aunque haya ausencias y francos cargados", () => {
    expect(
      genteDelDia([], [ausencia("m1", DIA, DIA)], [franco("m1", DIA)], DIA),
    ).toEqual({ sabemos: false });
  });

  /** Padron con gente, pero nadie vigente ese dia: el padron no esta vacio, y
      un dia sin nadie es un dato. Es el caso que distingue "no se" de "cero". */
  it("con padron cargado pero nadie vigente ese dia, dice cero y no que no sabe", () => {
    const padron = [persona("m1", "mecanico", { desde: "2027-01-01" })];
    expect(genteDelDia(padron, [], [], DIA)).toEqual({
      sabemos: true,
      porOficio: { mecanico: 0, electricista: 0, lubricador: 0 },
    });
  });
});

describe("de la especialidad al oficio", () => {
  it("las tres que tienen oficio lo encuentran", () => {
    expect(oficioDeLaEspecialidad("MECÁNICO")).toBe("mecanico");
    expect(oficioDeLaEspecialidad("ELÉCTRICO")).toBe("electricista");
    expect(oficioDeLaEspecialidad("LUBRICACIÓN")).toBe("lubricador");
  });

  it("no depende de la tilde ni de las mayusculas", () => {
    expect(oficioDeLaEspecialidad("Lubricacion")).toBe("lubricador");
    expect(oficioDeLaEspecialidad(" mecanico ")).toBe("mecanico");
  });

  /** 279 ordenes: son contratistas o albañileria, y no llevan gente del taller. */
  it("CIVIL no tiene oficio", () => {
    expect(oficioDeLaEspecialidad("CIVIL")).toBeNull();
    expect(oficioDeLaEspecialidad(null)).toBeNull();
    expect(oficioDeLaEspecialidad(undefined)).toBeNull();
    expect(oficioDeLaEspecialidad("")).toBeNull();
  });

  it("tampoco lo tienen las demas especialidades del vocabulario, ni un texto desconocido", () => {
    expect(oficioDeLaEspecialidad("INSTRUMENTACIÓN")).toBeNull();
    expect(oficioDeLaEspecialidad("OTRO")).toBeNull();
    expect(oficioDeLaEspecialidad("PLOMERÍA")).toBeNull();
  });
});
