import { describe, it, expect } from "vitest";
import {
  corteDeFotosAtascadas,
  cualesRespaldar,
  DIAS_ANTES_DE_AVISAR,
  diagnosticoDeDrive,
  fallaEsDeLaCarpeta,
  MAXIMO_POR_CORRIDA,
  nombreEnDrive,
  tipoDeLaFoto,
} from "./respaldoDeFotos";

function foto(id: string, subida_el: string, respaldada_en_drive_el: string | null = null) {
  return { id, subida_el, respaldada_en_drive_el };
}

describe("cualesRespaldar", () => {
  it("elige las que nunca se respaldaron, las más viejas primero", () => {
    const fotos = [
      foto("c", "2026-10-29T12:00:00Z"),
      foto("ya", "2026-10-01T12:00:00Z", "2026-10-02T03:00:00Z"),
      foto("a", "2026-10-27T12:00:00Z"),
      foto("b", "2026-10-28T12:00:00Z"),
    ];

    expect(cualesRespaldar(fotos, 10).map((f) => f.id)).toEqual(["a", "b", "c"]);
  });

  it("no devuelve más que el máximo por corrida, y deja afuera las más nuevas", () => {
    const fotos = [
      foto("tres", "2026-10-29T00:00:00Z"),
      foto("uno", "2026-10-27T00:00:00Z"),
      foto("dos", "2026-10-28T00:00:00Z"),
    ];

    expect(cualesRespaldar(fotos, 2).map((f) => f.id)).toEqual(["uno", "dos"]);
  });

  it("compara instantes y no textos: la zona horaria no cambia el orden", () => {
    // Por TEXTO, "2026-10-29T23:00:00-03:00" < "2026-10-30T01:00:00Z" y la
    // primera iría antes. Por INSTANTE es al revés: 23:00 en -03 son las 02:00Z
    // del 30, o sea POSTERIOR a la 01:00Z. Sólo un orden por instante da
    // ["b", "a"]; uno por texto daría ["a", "b"].
    const a = foto("a", "2026-10-29T23:00:00-03:00");
    const b = foto("b", "2026-10-30T01:00:00Z");

    expect(cualesRespaldar([a, b], 5).map((f) => f.id)).toEqual(["b", "a"]);
    expect(cualesRespaldar([b, a], 5).map((f) => f.id)).toEqual(["b", "a"]);
  });

  it("desempata por id, para que dos corridas no discutan el orden", () => {
    const fotos = [foto("b", "2026-10-29T00:00:00Z"), foto("a", "2026-10-29T00:00:00Z")];
    expect(cualesRespaldar(fotos, 5).map((f) => f.id)).toEqual(["a", "b"]);
  });

  it("con todo respaldado o sin fotos no hay nada que hacer", () => {
    expect(cualesRespaldar([], 5)).toEqual([]);
    expect(cualesRespaldar([foto("a", "2026-10-29T00:00:00Z", "2026-10-30T00:00:00Z")], 5)).toEqual([]);
  });

  it("un máximo de cero o inválido no respalda nada, y no rompe", () => {
    const fotos = [foto("a", "2026-10-29T00:00:00Z")];
    expect(cualesRespaldar(fotos, 0)).toEqual([]);
    expect(cualesRespaldar(fotos, -3)).toEqual([]);
    expect(cualesRespaldar(fotos, Number.NaN)).toEqual([]);
  });

  it("no modifica lo que recibe", () => {
    const fotos = [foto("b", "2026-10-29T00:00:00Z"), foto("a", "2026-10-28T00:00:00Z")];
    const copia = JSON.parse(JSON.stringify(fotos));
    cualesRespaldar(fotos, 1);
    expect(fotos).toEqual(copia);
  });

  it("el máximo de la corrida es un número usable", () => {
    expect(MAXIMO_POR_CORRIDA).toBeGreaterThan(0);
  });
});

describe("nombreEnDrive", () => {
  const f = { id: "9f1c2d3e-0000-4000-8000-abcdefabcdef", ruta: "condiciones/x/1730200000000.JPG", subida_el: "2026-10-29T15:30:00+00:00" };

  it("lleva el número de la condición, el día y el id entero de la foto", () => {
    expect(nombreEnDrive(f, 42)).toBe("condicion-0042_2026-10-29_9f1c2d3e-0000-4000-8000-abcdefabcdef.jpg");
  });

  it("sin número queda dicho, no vacío", () => {
    expect(nombreEnDrive(f, null)).toContain("condicion-sin-numero_");
    expect(nombreEnDrive(f, undefined)).toContain("condicion-sin-numero_");
  });

  it("la extensión sale de la ruta y es siempre minúscula", () => {
    expect(nombreEnDrive({ ...f, ruta: "condiciones/x/1.png" }, 1).endsWith(".png")).toBe(true);
    expect(nombreEnDrive({ ...f, ruta: "sin-extension" }, 1).endsWith(".jpg")).toBe(true);
  });

  it("dos fotos de la misma condición y del mismo día no se llaman igual", () => {
    expect(nombreEnDrive({ ...f, id: "a" }, 1)).not.toBe(nombreEnDrive({ ...f, id: "b" }, 1));
  });

  it("no deja pasar en el nombre lo que no es del id", () => {
    expect(nombreEnDrive({ ...f, id: "a/../b" }, 1)).not.toContain("/");
  });
});

describe("tipoDeLaFoto", () => {
  it("sale de la extensión, con jpeg por defecto", () => {
    expect(tipoDeLaFoto("a/b.png")).toBe("image/png");
    expect(tipoDeLaFoto("a/b.WEBP")).toBe("image/webp");
    expect(tipoDeLaFoto("a/b.heic")).toBe("image/heic");
    expect(tipoDeLaFoto("a/b.jpg")).toBe("image/jpeg");
    expect(tipoDeLaFoto("a/b")).toBe("image/jpeg");
  });
});

describe("fallaEsDeLaCarpeta", () => {
  it("el permiso, la carpeta que no existe y el freno de Google frenan la corrida", () => {
    expect(fallaEsDeLaCarpeta(403, "{}")).toBe(true);
    expect(fallaEsDeLaCarpeta(404, "{}")).toBe(true);
    expect(fallaEsDeLaCarpeta(401, "{}")).toBe(true);
    expect(fallaEsDeLaCarpeta(429, "{}")).toBe(true);
  });

  it("la falta de cuota frena, venga con el código que venga", () => {
    expect(fallaEsDeLaCarpeta(400, '{"error":{"errors":[{"reason":"storageQuotaExceeded"}]}}')).toBe(true);
    expect(fallaEsDeLaCarpeta(500, "Service Accounts do not have storage quota")).toBe(true);
  });

  it("un error del servidor es de esa foto: se sigue con la siguiente", () => {
    expect(fallaEsDeLaCarpeta(500, "backend error")).toBe(false);
    expect(fallaEsDeLaCarpeta(503, "")).toBe(false);
  });
});

describe("diagnosticoDeDrive", () => {
  it("empieza por lo que dijo Google, sin traducir", () => {
    const cuerpo = '{"error":{"code":403,"message":"The caller does not have permission"}}';
    const d = diagnosticoDeDrive(403, cuerpo, "sdg@proyecto.iam.gserviceaccount.com");

    expect(d.startsWith(`Drive respondió 403: ${cuerpo}`)).toBe(true);
    expect(d).toContain("Qué hacer:");
    expect(d).toContain("sdg@proyecto.iam.gserviceaccount.com");
  });

  it("el error de cuota dice que la carpeta tiene que estar en una unidad compartida", () => {
    const d = diagnosticoDeDrive(403, "Service Accounts do not have storage quota", "sdg@x");
    expect(d).toContain("Service Accounts do not have storage quota");
    expect(d).toContain("unidad compartida");
  });

  it("recorta un cuerpo larguísimo en vez de llenar el registro", () => {
    const d = diagnosticoDeDrive(500, "x".repeat(5000));
    expect(d.length).toBeLessThan(900);
    expect(d).toContain("…");
  });
});

describe("corteDeFotosAtascadas", () => {
  it("es tres días antes de ahora, en ISO UTC", () => {
    expect(DIAS_ANTES_DE_AVISAR).toBe(3);
    expect(corteDeFotosAtascadas(new Date("2026-11-03T12:00:00Z"))).toBe("2026-10-31T12:00:00.000Z");
  });

  it("la foto de ayer no es atascada y la de hace cuatro días sí", () => {
    const corte = corteDeFotosAtascadas(new Date("2026-11-03T12:00:00Z"));
    expect("2026-11-02T12:00:00.000Z" < corte).toBe(false);
    expect("2026-10-30T12:00:00.000Z" < corte).toBe(true);
  });
});
