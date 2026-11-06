import { describe, it, expect } from "vitest";
import { CuerpoDelUmbral } from "./ajustes";
import { validar } from "@/lib/core/validar";

const probar = (cuerpo: unknown) => validar(CuerpoDelUmbral, cuerpo);

describe("el cuerpo que guarda el umbral de monto alto", () => {
  it("acepta un entero positivo", () => {
    expect(probar({ umbral_monto_alto: 2_000_000 })).toEqual({
      ok: true,
      datos: { umbral_monto_alto: 2_000_000 },
    });
  });

  it("rechaza cero y negativos, que no separarian nada", () => {
    expect(probar({ umbral_monto_alto: 0 }).ok).toBe(false);
    expect(probar({ umbral_monto_alto: -5 }).ok).toBe(false);
  });

  it("rechaza lo que no es un numero entero", () => {
    expect(probar({ umbral_monto_alto: 1500.5 }).ok).toBe(false);
    expect(probar({ umbral_monto_alto: "1500000" }).ok).toBe(false);
    expect(probar({ umbral_monto_alto: Number.NaN }).ok).toBe(false);
  });

  it("rechaza un cero de mas", () => {
    expect(probar({ umbral_monto_alto: 15_000_000_000 }).ok).toBe(false);
  });

  it("dice que falta cuando no viene", () => {
    const r = probar({});
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.problemas).toEqual(["Falta umbral_monto_alto."]);
  });
});
