import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import JSZip from "jszip";

// Sin credenciales: el token es de mentira y el resto del módulo es el de verdad.
vi.mock("@/lib/core/google", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/core/google")>()),
  obtenerToken: vi.fn(async () => "token-falso"),
}));

import { listarArchivos, bajarYDescomprimir } from "./drive";

const MOLINOS = [
  { clave: "filler_1", prefijo_archivo: "Filler 1" },
  { clave: "filler_2", prefijo_archivo: "Filler 2" },
];

let fetchFalso: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.stubEnv("GOOGLE_DRIVE_PCROBOT_FOLDER_ID", "CARPETA123");
  fetchFalso = vi.fn();
  vi.stubGlobal("fetch", fetchFalso);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const urlDe = (llamada: number) => new URL(String(fetchFalso.mock.calls[llamada][0]));
const json = (cuerpo: unknown) => new Response(JSON.stringify(cuerpo), { status: 200 });

describe("listarArchivos", () => {
  it("pide la unidad compartida: supportsAllDrives e includeItemsFromAllDrives, sin los cuales Drive contesta 404", async () => {
    fetchFalso.mockResolvedValueOnce(json({ files: [] }));
    await listarArchivos(MOLINOS);

    const url = urlDe(0);
    expect(url.origin + url.pathname).toBe("https://www.googleapis.com/drive/v3/files");
    expect(url.searchParams.get("supportsAllDrives")).toBe("true");
    expect(url.searchParams.get("includeItemsFromAllDrives")).toBe("true");
    expect(url.searchParams.get("q")).toBe("'CARPETA123' in parents and trashed = false");
    expect(url.searchParams.get("orderBy")).toBe("modifiedTime desc");
    expect(fetchFalso.mock.calls[0][1]).toMatchObject({ headers: { Authorization: "Bearer token-falso" } });
  });

  it("sigue el nextPageToken hasta el final y junta las dos páginas", async () => {
    fetchFalso
      .mockResolvedValueOnce(json({
        nextPageToken: "pagina-2",
        files: [{ id: "a", name: "Filler 1 2026-10-29.zip", modifiedTime: "2026-10-29T12:30:00Z" }],
      }))
      .mockResolvedValueOnce(json({
        files: [{ id: "b", name: "Filler 2 2026-10-29.zip", modifiedTime: "2026-10-29T11:55:00Z" }],
      }));

    const r = await listarArchivos(MOLINOS);

    expect(fetchFalso).toHaveBeenCalledTimes(2);
    expect(urlDe(0).searchParams.get("pageToken")).toBeNull();
    expect(urlDe(1).searchParams.get("pageToken")).toBe("pagina-2");
    // Las dos páginas llevan los parámetros de la unidad compartida, no sólo la primera.
    expect(urlDe(1).searchParams.get("supportsAllDrives")).toBe("true");
    expect(urlDe(1).searchParams.get("includeItemsFromAllDrives")).toBe("true");
    expect(r.archivos.map((a) => [a.molinoClave, a.id])).toEqual([["filler_1", "a"], ["filler_2", "b"]]);
  });

  it("un error de Drive sale como error y no como una lista vacía", async () => {
    fetchFalso.mockResolvedValueOnce(new Response("{}", { status: 404 }));
    await expect(listarArchivos(MOLINOS)).rejects.toThrow();
  });

  it("sin la variable de la carpeta se niega, y dice cuál falta", async () => {
    vi.stubEnv("GOOGLE_DRIVE_PCROBOT_FOLDER_ID", "");
    await expect(listarArchivos(MOLINOS)).rejects.toThrow(/GOOGLE_DRIVE_PCROBOT_FOLDER_ID/);
    expect(fetchFalso).not.toHaveBeenCalled();
  });
});

/** Un zip con los bytes que se le den, tal como los sube el robot. */
async function zipDe(entradas: Record<string, Uint8Array | string | null>): Promise<ArrayBuffer> {
  const zip = new JSZip();
  for (const [ruta, contenido] of Object.entries(entradas)) {
    if (contenido === null) zip.folder(ruta);
    else zip.file(ruta, contenido);
  }
  return zip.generateAsync({ type: "arraybuffer" });
}

describe("bajarYDescomprimir", () => {
  it("baja con alt=media y supportsAllDrives, y el id va escapado", async () => {
    fetchFalso.mockResolvedValueOnce(new Response(await zipDe({ "DAT00000001.CSV": "x" })));
    await bajarYDescomprimir("id con/raro");

    const url = urlDe(0);
    expect(url.pathname).toBe("/drive/v3/files/id%20con%2Fraro");
    expect(url.searchParams.get("alt")).toBe("media");
    expect(url.searchParams.get("supportsAllDrives")).toBe("true");
    expect(fetchFalso.mock.calls[0][1]).toMatchObject({ headers: { Authorization: "Bearer token-falso" } });
  });

  it("decodifica los CSV como cp1252 y no como UTF-8", async () => {
    // 0xE1 = á, 0xF1 = ñ y 0x80 = € en cp1252. Leídos como UTF-8 los tres son
    // secuencias inválidas y salen como U+FFFD; leídos como latin1, 0x80 sale
    // como un carácter de control y no como €.
    const bytes = Uint8Array.from([0x6d, 0xe1, 0x71, 0x75, 0x69, 0x6e, 0x61, 0x3b, 0x61, 0xf1, 0x6f, 0x3b, 0x80]);
    fetchFalso.mockResolvedValueOnce(new Response(await zipDe({ "DAT00000001.CSV": bytes })));

    const r = await bajarYDescomprimir("zip");
    expect(r["DAT00000001.CSV"]).toBe("máquina;año;€");
  });

  it("devuelve sólo los .csv y los llama por su nombre, sin carpetas", async () => {
    fetchFalso.mockResolvedValueOnce(new Response(await zipDe({
      "DAT00000001.CSV": "uno",
      "adentro/de/carpetas/DAT00000002.csv": "dos",
      "DATADAT00000001.txt": "resto de febrero",
      "LEEME.TXT": "nota",
      "carpeta vacia/": null,
    })));

    const r = await bajarYDescomprimir("zip");
    expect(Object.keys(r).sort()).toEqual(["DAT00000001.CSV", "DAT00000002.csv"]);
    expect(r["DAT00000002.csv"]).toBe("dos");
  });

  it("un error de Drive en la descarga sale como error", async () => {
    fetchFalso.mockResolvedValueOnce(new Response("no existe", { status: 404 }));
    await expect(bajarYDescomprimir("zip")).rejects.toThrow();
  });

  it("lo que no es un zip no se acepta en silencio", async () => {
    fetchFalso.mockResolvedValueOnce(new Response("<html>login</html>"));
    await expect(bajarYDescomprimir("zip")).rejects.toThrow();
  });
});
