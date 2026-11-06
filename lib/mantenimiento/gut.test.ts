import { describe, it, expect } from "vitest";
import {
  ESCALAS_GUT, SIN_PUNTAJE, EMPUJON_ABIERTA, CERRADAS_GUT, ES_ALTO_GUT,
  type NotasGut, puntajeGut, claveDeOrdenGut, bandaDeGut, esGutAlto, esquemaGut,
} from "./gut";
import { validar } from "@/lib/core/validar";

describe("ESCALAS_GUT", () => {
  it("son las cinco palabras del material, en orden", () => {
    expect(ESCALAS_GUT.gravedad[0]).toBe("No reviste gravedad");
    expect(ESCALAS_GUT.gravedad[4]).toBe("Extremadamente grave");
    expect(ESCALAS_GUT.urgencia[4]).toBe("Sin tiempo disponible");
    expect(ESCALAS_GUT.tendencia[4]).toBe("Empeorará muy rápidamente");
    expect(ESCALAS_GUT.tendencia).toHaveLength(5);
  });
});

describe("las constantes", () => {
  it("el 27 es 3×3×3, el empujón es 1000 y el corte de lo alto es 65", () => {
    expect(SIN_PUNTAJE).toBe(27);
    expect(EMPUJON_ABIERTA).toBe(1000);
    expect(ES_ALTO_GUT).toBe(65);
    expect(CERRADAS_GUT).toEqual(["REALIZADO", "SUSPENDIDA"]);
  });
});

describe("puntajeGut", () => {
  it("multiplica las tres notas", () => {
    expect(puntajeGut({ gut_gravedad: 4, gut_urgencia: 5, gut_tendencia: 4 })).toBe(80);
  });
  it("es null si falta una, aunque haya dos cargadas", () => {
    expect(puntajeGut({ gut_gravedad: 5, gut_urgencia: 5, gut_tendencia: null })).toBeNull();
  });
  it("es null si no hay ninguna", () => {
    expect(puntajeGut({})).toBeNull();
  });
});

describe("claveDeOrdenGut", () => {
  it("una abierta con puntaje suma el empujón", () => {
    expect(claveDeOrdenGut({ estado: "POR_HACER", gut_gravedad: 4, gut_urgencia: 5, gut_tendencia: 4 })).toBe(1080);
  });
  it("una abierta sin puntaje vale 27 más el empujón, y no cero", () => {
    // Si valiera cero, las 29 pendientes sin puntuar se hundirían al fondo.
    expect(claveDeOrdenGut({ estado: "POR_HACER" })).toBe(1027);
  });
  it("una realizada con puntaje alto queda por debajo de cualquier abierta", () => {
    const realizada = claveDeOrdenGut({ estado: "REALIZADO", gut_gravedad: 5, gut_urgencia: 5, gut_tendencia: 5 });
    const abierta = claveDeOrdenGut({ estado: "ATRASADO", gut_gravedad: 1, gut_urgencia: 1, gut_tendencia: 1 });
    expect(realizada).toBeLessThan(abierta);
  });
  it("un estado desconocido o vacío cuenta como abierta", () => {
    // Una orden en un estado que nadie previó no se hunde.
    expect(claveDeOrdenGut({ estado: null })).toBe(1027);
    expect(claveDeOrdenGut({ estado: "LO_QUE_VENGA" })).toBe(1027);
  });
});

describe("bandaDeGut", () => {
  it("cierra los agujeros que deja el material de origen", () => {
    // 64, 27, 10 y 1 no caían en ninguna banda del PDF, y 64 y 27 son
    // productos posibles: 4×4×4 y 3×3×3.
    expect(bandaDeGut(64)).toBe(3);
    expect(bandaDeGut(27)).toBe(2);
    expect(bandaDeGut(10)).toBe(1);
    expect(bandaDeGut(1)).toBe(1);
  });
  it("los bordes de cada banda", () => {
    expect(bandaDeGut(125)).toBe(5);
    expect(bandaDeGut(80)).toBe(5);
    expect(bandaDeGut(79)).toBe(4);
    expect(bandaDeGut(65)).toBe(4);
    expect(bandaDeGut(28)).toBe(3);
    expect(bandaDeGut(11)).toBe(2);
  });
});

describe("esGutAlto", () => {
  it("es alto desde 65", () => {
    expect(esGutAlto({ gut_gravedad: 5, gut_urgencia: 5, gut_tendencia: 3 })).toBe(true);   // 75
    expect(esGutAlto({ gut_gravedad: 4, gut_urgencia: 4, gut_tendencia: 4 })).toBe(false);  // 64
  });
  it("sin puntaje no es alto", () => {
    expect(esGutAlto({})).toBe(false);
  });
});

describe("esquemaGut", () => {
  it("acepta las tres notas, o ninguna, o dos: no obliga", () => {
    expect(validar(esquemaGut, { gut_gravedad: 1, gut_urgencia: 5, gut_tendencia: 3 }).ok).toBe(true);
    expect(validar(esquemaGut, {}).ok).toBe(true);
    expect(validar(esquemaGut, { gut_gravedad: 4 }).ok).toBe(true);
  });
  it("un null explícito es válido: es como se borra una nota", () => {
    expect(validar(esquemaGut, { gut_gravedad: null, gut_urgencia: null, gut_tendencia: null }).ok).toBe(true);
  });
  it("rechaza el 0, el 6, el decimal y el texto", () => {
    expect(validar(esquemaGut, { gut_gravedad: 0 }).ok).toBe(false);
    expect(validar(esquemaGut, { gut_gravedad: 6 }).ok).toBe(false);
    expect(validar(esquemaGut, { gut_gravedad: 2.5 }).ok).toBe(false);
    expect(validar(esquemaGut, { gut_gravedad: "3" }).ok).toBe(false);
  });
  it("informa los tres problemas juntos, en castellano", () => {
    const r = validar(esquemaGut, { gut_gravedad: 0, gut_urgencia: 6, gut_tendencia: 2.5 });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.problemas).toHaveLength(3);
    expect(r.problemas.join(" ")).toContain("gut_gravedad");
    expect(r.problemas.join(" ")).toContain("gut_urgencia");
    expect(r.problemas.join(" ")).toContain("gut_tendencia");
  });
});

// Diez órdenes que cubren los dos estados cerrados, los abiertos, con puntaje,
// sin puntaje, con dos de tres cargadas y con el estado vacío.
const CASOS = [
  { estado: "REALIZADO", gut_gravedad: 5, gut_urgencia: 5, gut_tendencia: 5 },
  { estado: "REALIZADO" },
  { estado: "SUSPENDIDA", gut_gravedad: 2, gut_urgencia: 3, gut_tendencia: 4 },
  { estado: "SUSPENDIDA", gut_gravedad: 5, gut_urgencia: 5, gut_tendencia: null },
  { estado: "POR_HACER", gut_gravedad: 4, gut_urgencia: 5, gut_tendencia: 4 },
  { estado: "POR_HACER" },
  { estado: "EN_PROCESO", gut_gravedad: 1, gut_urgencia: 1, gut_tendencia: 1 },
  { estado: "ATRASADO", gut_gravedad: 3, gut_urgencia: null, gut_tendencia: 3 },
  { estado: "ATRASADO", gut_gravedad: 3, gut_urgencia: 3, gut_tendencia: 3 },
  { estado: null },
];

describe("la clave de orden y la columna generada dicen lo mismo", () => {
  it("reproduce el coalesce y el case de la migración", () => {
    // Espejo de `gut_orden`, con el 1000 y el 27 como literales y no como las
    // constantes: así, cambiar `EMPUJON_ABIERTA` o `SIN_PUNTAJE` en TypeScript
    // rompe este test en vez de mover los dos lados juntos. Lo que atrapa es que
    // `claveDeOrdenGut` se aparte de la expresión de la migración, en estructura
    // o en valor. Lo que no puede ver es el SQL mismo: si los números de la
    // migración cambiaran, este test no se enteraría. Se sobrevive a eso porque
    // en este repo una migración aplicada no se edita, se corrige con otra.
    // Se reescribe a propósito en vez de llamar a claveDeOrdenGut: un ayudante
    // compartido sólo probaría al ayudante contra sí mismo.
    const comoLoHaceLaBase = (o: NotasGut & { estado?: string | null }) =>
      (CERRADAS_GUT.includes(o.estado ?? "") ? 0 : 1000)
      + (puntajeGut(o) ?? 27);
    for (const o of CASOS) expect(claveDeOrdenGut(o)).toBe(comoLoHaceLaBase(o));
  });
});
