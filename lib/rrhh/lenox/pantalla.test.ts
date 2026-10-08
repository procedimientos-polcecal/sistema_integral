import { describe, it, expect } from "vitest";
import {
  bloqueoPorUltimaSync, ESPERA_TRAS_429_SEGUNDOS, rangoPorDefecto, segundosDeEspera, textoDeEspera,
} from "./pantalla";

describe("rangoPorDefecto", () => {
  it("son siete días contando hoy", () => {
    // 12:00 en Argentina
    expect(rangoPorDefecto(new Date("2026-10-08T15:00:00Z"))).toEqual({ desde: "2026-10-02", hasta: "2026-10-08" });
  });

  it("de noche termina en hoy de Argentina y no en el día UTC, que ya es mañana", () => {
    // 22:30 del 8/10 en Argentina = 01:30 del 9/10 en UTC
    expect(rangoPorDefecto(new Date("2026-10-09T01:30:00Z"))).toEqual({ desde: "2026-10-02", hasta: "2026-10-08" });
  });

  it("cruza el cambio de mes", () => {
    expect(rangoPorDefecto(new Date("2026-10-03T15:00:00Z"))).toEqual({ desde: "2026-09-27", hasta: "2026-10-03" });
  });
});

describe("segundosDeEspera", () => {
  it("usa el Retry-After cuando es un número", () => {
    expect(segundosDeEspera("900")).toBe(900);
    expect(segundosDeEspera("61.2")).toBe(62);
  });

  it("sin header, o con basura, espera lo que dice el mensaje y no cero", () => {
    expect(segundosDeEspera(null)).toBe(ESPERA_TRAS_429_SEGUNDOS);
    expect(segundosDeEspera("")).toBe(ESPERA_TRAS_429_SEGUNDOS);
    expect(segundosDeEspera("mañana")).toBe(ESPERA_TRAS_429_SEGUNDOS);
    expect(segundosDeEspera("0")).toBe(ESPERA_TRAS_429_SEGUNDOS);
    expect(segundosDeEspera("-5")).toBe(ESPERA_TRAS_429_SEGUNDOS);
  });
});

describe("bloqueoPorUltimaSync", () => {
  const t0 = new Date("2026-10-08T12:00:00Z").getTime();
  const falloDe429 = {
    ok: false,
    error: "Lenox no atendió el pedido porque se hicieron demasiadas consultas seguidas. (429)",
    created_at: new Date(t0).toISOString(),
  };

  it("sigue bloqueado hasta 15 minutos después del 429", () => {
    expect(bloqueoPorUltimaSync(falloDe429, t0 + 60_000)).toBe(t0 + 15 * 60_000);
  });

  it("se destraba pasados los 15 minutos", () => {
    expect(bloqueoPorUltimaSync(falloDe429, t0 + 15 * 60_000)).toBeNull();
    expect(bloqueoPorUltimaSync(falloDe429, t0 + 16 * 60_000)).toBeNull();
  });

  it("un fallo que no es 429 no bloquea: ahí reintentar sí tiene sentido", () => {
    expect(bloqueoPorUltimaSync({ ...falloDe429, error: "Lenox respondió 500: boom" }, t0 + 1000)).toBeNull();
  });

  it("una corrida bien o sin corridas no bloquea", () => {
    expect(bloqueoPorUltimaSync({ ...falloDe429, ok: true, error: null }, t0 + 1000)).toBeNull();
    expect(bloqueoPorUltimaSync(null, t0)).toBeNull();
  });
});

describe("textoDeEspera", () => {
  it("minutos y segundos, y sólo segundos al final", () => {
    expect(textoDeEspera(14 * 60_000 + 5_000)).toBe("14 min 05 s");
    expect(textoDeEspera(45_000)).toBe("45 s");
    expect(textoDeEspera(0)).toBe("0 s");
    expect(textoDeEspera(-10)).toBe("0 s");
  });
});
