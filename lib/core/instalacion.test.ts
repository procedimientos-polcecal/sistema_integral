import { describe, expect, it } from "vitest";
import { plataformaDeInstalacion } from "./instalacion";

// User agents reales, tal como los mandan los navegadores.
const SAFARI_IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1";
const CHROME_IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/122.0 Mobile/15E148 Safari/604.1";
const SAFARI_IPAD =
  "Mozilla/5.0 (iPad; CPU OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1";
const CHROME_ANDROID =
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Mobile Safari/537.36";
const CHROME_WINDOWS =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";
const SAFARI_MAC =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15";

describe("plataformaDeInstalacion", () => {
  it("ya-instalada gana sobre todo lo demás", () => {
    for (const ua of [SAFARI_IPHONE, CHROME_ANDROID, CHROME_WINDOWS, ""]) {
      expect(plataformaDeInstalacion(ua, true)).toBe("ya-instalada");
    }
  });

  it("Safari en iPhone es ios", () => {
    expect(plataformaDeInstalacion(SAFARI_IPHONE, false)).toBe("ios");
  });

  it("Chrome en iOS también es ios, aunque diga Chrome", () => {
    expect(plataformaDeInstalacion(CHROME_IPHONE, false)).toBe("ios");
  });

  it("iPad es ios", () => {
    expect(plataformaDeInstalacion(SAFARI_IPAD, false)).toBe("ios");
  });

  it("Chrome en Android es android", () => {
    expect(plataformaDeInstalacion(CHROME_ANDROID, false)).toBe("android");
  });

  it("Chrome en escritorio es escritorio", () => {
    expect(plataformaDeInstalacion(CHROME_WINDOWS, false)).toBe("escritorio");
  });

  it("Safari de escritorio es escritorio y no ios", () => {
    expect(plataformaDeInstalacion(SAFARI_MAC, false)).toBe("escritorio");
  });

  it("un user agent vacío es escritorio", () => {
    expect(plataformaDeInstalacion("", false)).toBe("escritorio");
  });
});
