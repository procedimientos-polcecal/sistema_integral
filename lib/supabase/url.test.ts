import { describe, it, expect, vi } from "vitest";
import { normalizarUrlSupabase, claveAnonima } from "./url";

describe("normalizarUrlSupabase", () => {
  const bien = "https://abc.supabase.co";

  it("deja intacto el origen pelado", () => {
    expect(normalizarUrlSupabase(bien)).toBe(bien);
  });

  it("saca el /rest/v1 que muestra el panel en Data API", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    // Pegar esa URL hacía que el login pidiera /rest/v1/auth/v1/authorize y
    // PostgREST respondiera "No API key found in request".
    expect(normalizarUrlSupabase(`${bien}/rest/v1`)).toBe(bien);
  });

  it("saca también las bases de los otros servicios", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    for (const s of ["auth", "storage", "realtime"]) {
      expect(normalizarUrlSupabase(`${bien}/${s}/v1`)).toBe(bien);
    }
  });

  it("saca espacios y barra final", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(normalizarUrlSupabase(`  ${bien}/  `)).toBe(bien);
  });

  it("falla claro si no está configurada", () => {
    expect(() => normalizarUrlSupabase("")).toThrow(/Falta NEXT_PUBLIC_SUPABASE_URL/);
    expect(() => normalizarUrlSupabase(undefined)).toThrow(/Falta NEXT_PUBLIC_SUPABASE_URL/);
  });
});

describe("claveAnonima", () => {
  it("recorta el espacio que queda al pegarla", () => {
    expect(claveAnonima(" eyJabc ")).toBe("eyJabc");
  });

  it("falla claro si está vacía", () => {
    expect(() => claveAnonima("   ")).toThrow(/Falta NEXT_PUBLIC_SUPABASE_ANON_KEY/);
  });
});
