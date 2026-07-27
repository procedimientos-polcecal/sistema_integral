import { describe, it, expect } from "vitest";
import { haversineKm, distanciaRuta } from "./geo";

describe("haversineKm", () => {
  it("es 0 para el mismo punto", () => {
    expect(haversineKm({ lat: -34.6, lng: -58.4 }, { lat: -34.6, lng: -58.4 })).toBe(0);
  });

  it("da ~aprox la distancia conocida entre Obelisco y Aeroparque (CABA), ~7km", () => {
    const obelisco = { lat: -34.6037, lng: -58.3816 };
    const aeroparque = { lat: -34.5592, lng: -58.4156 };
    const km = haversineKm(obelisco, aeroparque);
    expect(km).toBeGreaterThan(4);
    expect(km).toBeLessThan(10);
  });

  it("es simétrica", () => {
    const a = { lat: -34.6, lng: -58.4 };
    const b = { lat: -34.7, lng: -58.5 };
    expect(haversineKm(a, b)).toBeCloseTo(haversineKm(b, a), 10);
  });
});

describe("distanciaRuta", () => {
  it("es 0 para 0 o 1 parada", () => {
    expect(distanciaRuta([])).toBe(0);
    expect(distanciaRuta([{ lat: 0, lng: 0 }])).toBe(0);
  });

  it("suma las distancias entre paradas consecutivas", () => {
    const a = { lat: -34.6, lng: -58.4 };
    const b = { lat: -34.65, lng: -58.45 };
    const c = { lat: -34.7, lng: -58.5 };
    expect(distanciaRuta([a, b, c])).toBeCloseTo(haversineKm(a, b) + haversineKm(b, c), 10);
  });
});
