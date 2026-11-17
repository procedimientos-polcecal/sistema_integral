import { describe, it, expect } from "vitest";
import { validar } from "@/lib/core/validar";
import {
  camposDeAdminEnviados,
  esquemaDeCambio,
  problemaDelLugarResultante,
} from "./cambioDeCondicion";

describe("camposDeAdminEnviados", () => {
  it("un cuerpo de la primera etapa no trae ninguno", () => {
    expect(camposDeAdminEnviados({ descripcion: "x", prioridad: 2, sector_id: null })).toEqual([]);
  });

  it("nombra cada campo de admin con su nombre de pantalla", () => {
    expect(
      camposDeAdminEnviados({ descripcion: "x", magnitud_dano: 9, fecha_maxima: "2026-11-01", fecha_ejecucion: null })
    ).toEqual(["magnitud del daño", "fecha máxima", "fecha de ejecución"]);
  });

  it("cuenta el campo aunque venga en null o con un valor inválido: el 403 va antes que el 400", () => {
    expect(camposDeAdminEnviados({ frecuencia: null })).toEqual(["frecuencia"]);
    expect(camposDeAdminEnviados({ frecuencia: 99 })).toEqual(["frecuencia"]);
  });

  it("un cuerpo que no es un objeto no trae ninguno", () => {
    expect(camposDeAdminEnviados(null)).toEqual([]);
    expect(camposDeAdminEnviados("hola")).toEqual([]);
  });
});

describe("esquemaDeCambio", () => {
  it("acepta un cambio parcial", () => {
    const r = validar(esquemaDeCambio, { descripcion: "Otra cosa" });
    expect(r.ok).toBe(true);
  });

  it("acepta vaciar un puntaje y reabrir (fecha de ejecución en null)", () => {
    const r = validar(esquemaDeCambio, { legislacion: null, fecha_ejecucion: null });
    expect(r.ok).toBe(true);
  });

  it("rechaza un puntaje fuera de la escala, en castellano", () => {
    const r = validar(esquemaDeCambio, { controles: 4 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.problemas.join(" ")).toContain("controles");
  });

  it("rechaza una descripción vacía y una prioridad que no es 1, 2 o 3", () => {
    const r = validar(esquemaDeCambio, { descripcion: "   ", prioridad: 7 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.problemas).toHaveLength(2);
  });

  it("rechaza una fecha que no es una fecha", () => {
    expect(validar(esquemaDeCambio, { fecha_maxima: "mañana" }).ok).toBe(false);
  });
});

describe("problemaDelLugarResultante", () => {
  const enSector = { sector_id: "s1", equipo_id: null };

  it("un cambio que no toca el lugar no dice nada, aunque la condición no tenga lugar", () => {
    expect(problemaDelLugarResultante({ sector_id: null, equipo_id: null }, {})).toBeNull();
  });

  it("mover de sector a equipo exige mandar los dos campos", () => {
    expect(problemaDelLugarResultante(enSector, { equipo_id: "e1" })).toBe(
      "Una condición está en un sector o en un equipo, no en los dos."
    );
    expect(problemaDelLugarResultante(enSector, { sector_id: null, equipo_id: "e1" })).toBeNull();
  });

  it("no se puede dejar una condición sin lugar", () => {
    expect(problemaDelLugarResultante(enSector, { sector_id: null })).toBe(
      "Falta decir en qué sector o equipo es."
    );
  });

  it("completar el lugar de una migrada sin lugar está bien", () => {
    expect(problemaDelLugarResultante({ sector_id: null, equipo_id: null }, { sector_id: "s1" })).toBeNull();
  });
});
