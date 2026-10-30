import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./drive", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./drive")>()),
  listarArchivos: vi.fn(),
  bajarYDescomprimir: vi.fn(),
}));
vi.mock("./importar", () => ({ importarMolino: vi.fn() }));
vi.mock("@/lib/core/sincronizaciones", () => ({ registrarSincronizacion: vi.fn(async () => {}) }));

import { listarArchivos, bajarYDescomprimir } from "./drive";
import { importarMolino } from "./importar";
import { registrarSincronizacion } from "@/lib/core/sincronizaciones";
import { sincronizarMolinos } from "./sincronizar";

const AHORA = new Date("2026-10-29T14:00:00Z");

const CATALOGO = [
  { id: "m1", clave: "filler_1", nombre: "Filler 1", formato: "filler_1", prefijo_archivo: "Filler 1" },
  { id: "m2", clave: "filler_2", nombre: "Filler 2 (Calera)", formato: "filler_2", prefijo_archivo: "Filler 2" },
];

const zipDe = (clave: string, nombre: string, modificado: string) => ({ molinoClave: clave, nombre, id: `id-${clave}`, modificado });
const ZIP_F1 = zipDe("filler_1", "Filler 1 2026-10-29.zip", "2026-10-29T12:30:00Z");
const ZIP_F2 = zipDe("filler_2", "Filler 2 2026-10-29.zip", "2026-10-29T11:55:00Z");

const resultado = (extra: Partial<Awaited<ReturnType<typeof importarMolino>>> = {}) => ({
  turnos: 100, insertados: 0, actualizados: 0, borrados: 0, diasNoOperativos: [], avisos: [], ...extra,
});

/** El `admin` mínimo: sólo lee el catálogo. */
const adminCon = (catalogo: unknown, error: { message: string } | null = null) =>
  ({
    from: () => ({
      select: () => ({ eq: () => ({ order: () => Promise.resolve({ data: catalogo, error }) }) }),
    }),
  }) as never;

const anotado = () => vi.mocked(registrarSincronizacion).mock.calls.map((c) => c[0]);

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(registrarSincronizacion).mockResolvedValue(undefined);
  vi.mocked(bajarYDescomprimir).mockResolvedValue({});
});

describe("sincronizarMolinos", () => {
  it("con todo al día importa los dos y lo anota como ok, con la suma de turnos", async () => {
    vi.mocked(listarArchivos).mockResolvedValue({ archivos: [ZIP_F1, ZIP_F2], sinMolino: [] });
    vi.mocked(importarMolino).mockResolvedValueOnce(resultado({ turnos: 869 })).mockResolvedValueOnce(resultado({ turnos: 1038 }));

    const r = await sincronizarMolinos(adminCon(CATALOGO), AHORA);

    expect(r).toMatchObject({ ok: true, errores: [], avisos: [] });
    expect(r.molinos.map((m) => [m.clave, m.obsoleto])).toEqual([["filler_1", false], ["filler_2", false]]);
    expect(anotado()).toEqual([
      { modulo: "produccion", recurso: "molinos", ok: true, error: null, filas: 1907 },
    ]);
  });

  it("un zip de 24 horas o más se importa igual pero queda como ok: false", async () => {
    const viejo = zipDe("filler_1", "Filler 1 2026-10-28.zip", "2026-10-28T14:00:00Z"); // justo 24 h
    vi.mocked(listarArchivos).mockResolvedValue({ archivos: [viejo, ZIP_F2], sinMolino: [] });
    vi.mocked(importarMolino).mockResolvedValue(resultado());

    const r = await sincronizarMolinos(adminCon(CATALOGO), AHORA);

    expect(r.ok).toBe(false);
    expect(r.molinos.find((m) => m.clave === "filler_1")).toMatchObject({ obsoleto: true });
    expect(r.molinos.find((m) => m.clave === "filler_2")).toMatchObject({ obsoleto: false });
    expect(r.errores).toHaveLength(1);
    expect(r.errores[0]).toMatch(/Filler 1.*hace más de un día/);
    // Lo que había se importó: el dato es viejo, no incorrecto.
    expect(importarMolino).toHaveBeenCalledTimes(2);
    expect(anotado()[0]).toMatchObject({ ok: false, filas: 200 });
    expect(anotado()[0].error).toMatch(/hace más de un día/);
  });

  it("un zip de hace 23 h 59 min no es obsoleto", async () => {
    const casi = zipDe("filler_1", "Filler 1 2026-10-28.zip", "2026-10-28T14:00:01Z");
    vi.mocked(listarArchivos).mockResolvedValue({ archivos: [casi, ZIP_F2], sinMolino: [] });
    vi.mocked(importarMolino).mockResolvedValue(resultado());
    expect((await sincronizarMolinos(adminCon(CATALOGO), AHORA)).ok).toBe(true);
  });

  it("un molino que falla no frena al otro, y el que falló queda en los errores", async () => {
    vi.mocked(listarArchivos).mockResolvedValue({ archivos: [ZIP_F1, ZIP_F2], sinMolino: [] });
    vi.mocked(importarMolino)
      .mockRejectedValueOnce(new Error("El zip se encogió: trae 3 días y la base ya tiene 5."))
      .mockResolvedValueOnce(resultado({ turnos: 1038 }));

    const r = await sincronizarMolinos(adminCon(CATALOGO), AHORA);

    expect(r.ok).toBe(false);
    expect(r.molinos.map((m) => m.clave)).toEqual(["filler_2"]);
    expect(r.errores).toEqual(["Filler 1: El zip se encogió: trae 3 días y la base ya tiene 5."]);
    expect(importarMolino).toHaveBeenCalledTimes(2);
    expect(anotado()[0]).toMatchObject({ ok: false, filas: 1038 });
  });

  it("también cuando falla la bajada del zip de un molino, el otro se importa", async () => {
    vi.mocked(listarArchivos).mockResolvedValue({ archivos: [ZIP_F1, ZIP_F2], sinMolino: [] });
    vi.mocked(bajarYDescomprimir).mockRejectedValueOnce(new Error("Drive 500")).mockResolvedValueOnce({});
    vi.mocked(importarMolino).mockResolvedValue(resultado());

    const r = await sincronizarMolinos(adminCon(CATALOGO), AHORA);
    expect(r.molinos.map((m) => m.clave)).toEqual(["filler_2"]);
    expect(r.errores).toEqual(["Filler 1: Drive 500"]);
  });

  it("un molino sin zip en la carpeta es un error, y el otro se importa", async () => {
    vi.mocked(listarArchivos).mockResolvedValue({ archivos: [ZIP_F1], sinMolino: [] });
    vi.mocked(importarMolino).mockResolvedValue(resultado());

    const r = await sincronizarMolinos(adminCon(CATALOGO), AHORA);

    expect(r.ok).toBe(false);
    expect(r.errores).toEqual(['Filler 2 (Calera): no hay ningún zip "Filler 2 ..." en la carpeta.']);
    expect(r.molinos.map((m) => m.clave)).toEqual(["filler_1"]);
  });

  it("se anota también cuando Drive falla entero, con lo que dijo Drive", async () => {
    vi.mocked(listarArchivos).mockRejectedValue(new Error("Google Drive: 404 File not found"));

    const r = await sincronizarMolinos(adminCon(CATALOGO), AHORA);

    expect(r).toMatchObject({ ok: false, molinos: [] });
    expect(importarMolino).not.toHaveBeenCalled();
    expect(anotado()).toEqual([
      { modulo: "produccion", recurso: "molinos", ok: false, error: "Google Drive: 404 File not found", filas: 0 },
    ]);
  });

  it("se anota también cuando no se puede leer el catálogo", async () => {
    const r = await sincronizarMolinos(adminCon(null, { message: "permission denied" }), AHORA);

    expect(r.ok).toBe(false);
    expect(listarArchivos).not.toHaveBeenCalled();
    expect(anotado()).toHaveLength(1);
    expect(anotado()[0]).toMatchObject({ ok: false });
    expect(anotado()[0].error).toMatch(/permission denied/);
  });

  it("los avisos del parseo se anotan con ok: true, porque la importación se hizo", async () => {
    vi.mocked(listarArchivos).mockResolvedValue({ archivos: [ZIP_F1, ZIP_F2], sinMolino: ["Filler 9 2026-10-29.zip"] });
    vi.mocked(importarMolino)
      .mockResolvedValueOnce(resultado({ avisos: ["DAT00000001, línea 4: tiene 3 campos."] }))
      .mockResolvedValueOnce(resultado());

    const r = await sincronizarMolinos(adminCon(CATALOGO), AHORA);

    expect(r.ok).toBe(true);
    expect(r.avisos).toHaveLength(2);
    expect(anotado()[0]).toMatchObject({ ok: true });
    expect(anotado()[0].error).toMatch(/Filler 9 2026-10-29\.zip/);
    expect(anotado()[0].error).toMatch(/Filler 1: DAT00000001, línea 4/);
  });
});
