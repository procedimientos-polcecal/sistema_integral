import { describe, it, expect, vi, afterEach } from "vitest";
import {
  ventanasDe,
  traerMarcaciones,
  traerEmpleados,
  hayCredencialesLenox,
  DIAS_MAX_POR_PEDIDO,
} from "./cliente";
import { toUtcDateOnly } from "../dates";

function dia(y: number, m: number, d: number) {
  return toUtcDateOnly(y, m - 1, d);
}
function iso(d: Date) {
  return d.toISOString().slice(0, 10);
}

describe("ventanasDe", () => {
  it("el tope es el que impone la API: 7 días", () => {
    // Medido el 07/10/2026: con 8 días el servidor devuelve 400.
    expect(DIAS_MAX_POR_PEDIDO).toBe(7);
  });

  it("un rango que entra en el tope es una sola ventana", () => {
    const v = ventanasDe(dia(2026, 10, 1), dia(2026, 10, 7));
    expect(v.map((x) => [iso(x.desde), iso(x.hasta)])).toEqual([["2026-10-01", "2026-10-07"]]);
  });

  it("un día más que el tope son dos ventanas", () => {
    const v = ventanasDe(dia(2026, 10, 1), dia(2026, 10, 8));
    expect(v.map((x) => [iso(x.desde), iso(x.hasta)])).toEqual([
      ["2026-10-01", "2026-10-07"],
      ["2026-10-08", "2026-10-08"],
    ]);
  });

  it("un mes se parte en ventanas de 7 días, sin huecos ni solapes", () => {
    const v = ventanasDe(dia(2026, 10, 1), dia(2026, 10, 31));
    expect(v).toHaveLength(5);
    expect(iso(v[0].desde)).toBe("2026-10-01");
    expect(iso(v[0].hasta)).toBe("2026-10-07");
    expect(iso(v[1].desde)).toBe("2026-10-08");
    expect(iso(v[4].hasta)).toBe("2026-10-31");
    for (let i = 1; i < v.length; i++) {
      const finAnterior = v[i - 1].hasta.getTime();
      const inicio = v[i].desde.getTime();
      expect(inicio - finAnterior).toBe(86_400_000); // exactamente un día
    }
  });

  it("ninguna ventana supera el tope que impone la API", () => {
    for (const x of ventanasDe(dia(2026, 1, 1), dia(2026, 3, 15))) {
      const dias = (x.hasta.getTime() - x.desde.getTime()) / 86_400_000 + 1;
      expect(dias).toBeLessThanOrEqual(DIAS_MAX_POR_PEDIDO);
    }
  });

  it("un solo día es una ventana de un día", () => {
    const v = ventanasDe(dia(2026, 10, 5), dia(2026, 10, 5));
    expect(v.map((x) => [iso(x.desde), iso(x.hasta)])).toEqual([["2026-10-05", "2026-10-05"]]);
  });

  it("un rango al revés no genera ventanas ni se cuelga", () => {
    expect(ventanasDe(dia(2026, 10, 5), dia(2026, 10, 1))).toEqual([]);
  });
});

describe("hayCredencialesLenox", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("es falso sin clave, o con una clave en blanco", () => {
    vi.stubEnv("LENOX_API_KEY", "");
    expect(hayCredencialesLenox()).toBe(false);
    vi.stubEnv("LENOX_API_KEY", "   ");
    expect(hayCredencialesLenox()).toBe(false);
  });

  it("es verdadero con una clave", () => {
    vi.stubEnv("LENOX_API_KEY", "clave-de-prueba");
    expect(hayCredencialesLenox()).toBe(true);
  });
});

function filaFalsa(n: number): Record<string, unknown> {
  return {
    nombre: "A",
    apellido: "B",
    legajo: "PC_001",
    marcacion: `2026-10-01 0${n}:00:00`,
    marcacionFecha: "2026-10-01",
    marcacionHora: `0${n}:00:00`,
    tipoMarcacion: "Por Reloj",
    comentario: null,
    reloj: "porteria",
  };
}

/** Una respuesta 200 con este cuerpo. */
function ok(cuerpo: unknown) {
  return { ok: true, status: 200, json: async () => cuerpo };
}

describe("traerMarcaciones", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("corta con el mensaje 'Se muestran todos los resultados' sin gastar una llamada de más", async () => {
    vi.stubEnv("LENOX_API_KEY", "clave-de-prueba");
    const fetchFalso = vi.fn(async () =>
      ok({ mensaje: "Se muestran todos los resultados", resultado: [filaFalsa(1), filaFalsa(2)] })
    );
    vi.stubGlobal("fetch", fetchFalso);

    const filas = await traerMarcaciones(dia(2026, 10, 1), dia(2026, 10, 1));
    expect(filas).toHaveLength(2);
    expect(fetchFalso).toHaveBeenCalledTimes(1);
  });

  it("si el mensaje no viene, pagina hasta que una página vuelve vacía", async () => {
    vi.stubEnv("LENOX_API_KEY", "clave-de-prueba");
    const paginas = [[filaFalsa(1), filaFalsa(2)], [filaFalsa(3)], []];
    let llamadas = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ok({ mensaje: "ok", resultado: paginas[llamadas++] ?? [] }))
    );

    const filas = await traerMarcaciones(dia(2026, 10, 1), dia(2026, 10, 1));
    expect(filas).toHaveLength(3);
    expect(llamadas).toBe(3);
  });

  it("si la API ignora FilasExcluidas, el bucle se corta y el error lo sospecha", async () => {
    vi.stubEnv("LENOX_API_KEY", "clave-de-prueba");
    const pagina = Array.from({ length: 1000 }, () => filaFalsa(1));
    const fetchFalso = vi.fn(async () => ok({ resultado: pagina }));
    vi.stubGlobal("fetch", fetchFalso);

    await expect(traerMarcaciones(dia(2026, 10, 1), dia(2026, 10, 1))).rejects.toThrow(
      /FilasExcluidas no se está respetando/
    );
    // Se corta por cantidad de pedidos, no de filas: el límite duro de Lenox
    // está en unas doce llamadas y hay que frenar antes.
    expect(fetchFalso).toHaveBeenCalledTimes(10);
  });

  it("un 204 con el cuerpo vacío es cero filas y no lanza", async () => {
    vi.stubEnv("LENOX_API_KEY", "clave-de-prueba");
    // Como la API real: ok es true, y el cuerpo vacío hace lanzar a json().
    const fetchFalso = vi.fn(async () => ({
      ok: true,
      status: 204,
      json: async () => {
        throw new SyntaxError("Unexpected end of JSON input");
      },
      text: async () => "",
    }));
    vi.stubGlobal("fetch", fetchFalso);

    await expect(traerMarcaciones(dia(2026, 10, 3), dia(2026, 10, 5))).resolves.toEqual([]);
    expect(fetchFalso).toHaveBeenCalledTimes(1);
  });

  it("un rango que se parte en ventanas pide cada una con sus fechas", async () => {
    vi.stubEnv("LENOX_API_KEY", "clave-de-prueba");
    const urls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: URL) => {
        urls.push(url.toString());
        return ok({ mensaje: "Se muestran todos los resultados", resultado: [filaFalsa(1)] });
      })
    );

    const filas = await traerMarcaciones(dia(2026, 10, 1), dia(2026, 10, 10));
    expect(filas).toHaveLength(2);
    expect(urls).toHaveLength(2);
    expect(urls[0]).toContain("Desde=2026-10-01");
    expect(urls[0]).toContain("Hasta=2026-10-07");
    expect(urls[1]).toContain("Desde=2026-10-08");
    expect(urls[1]).toContain("Hasta=2026-10-10");
  });

  it("manda la clave en el header y el offset en FilasExcluidas", async () => {
    vi.stubEnv("LENOX_API_KEY", "clave-de-prueba");
    const urls: string[] = [];
    const headers: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: URL, init: RequestInit) => {
        urls.push(url.toString());
        headers.push((init.headers as Record<string, string>)["LenoxBusinessAPI-Key"]);
        return ok({ resultado: urls.length === 1 ? [filaFalsa(1)] : [] });
      })
    );

    await traerMarcaciones(dia(2026, 10, 1), dia(2026, 10, 1));
    expect(headers[0]).toBe("clave-de-prueba");
    expect(urls[0]).toContain("/marcaciones/getmarcaciones");
    expect(urls[0]).toContain("Desde=2026-10-01");
    expect(urls[0]).toContain("Hasta=2026-10-01");
    expect(urls[0]).toContain("FilasExcluidas=0");
    expect(urls[1]).toContain("FilasExcluidas=1");
    // Con `true` las bajas dejan de aparecer y nadie se entera: quien se fue
    // ficha hasta su último día, y esas marcaciones simplemente faltarían.
    expect(urls[0]).toContain("ExcluirDadosDeBaja=false");
  });

  it("una fila sin legajo llega tal cual: filtrarla borraría el aviso que cuenta agrupar", async () => {
    vi.stubEnv("LENOX_API_KEY", "clave-de-prueba");
    const sinLegajo = { ...filaFalsa(1), legajo: "" };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        ok({ mensaje: "Se muestran todos los resultados", resultado: [sinLegajo, filaFalsa(2)] })
      )
    );

    const filas = await traerMarcaciones(dia(2026, 10, 1), dia(2026, 10, 1));
    expect(filas).toHaveLength(2);
    expect(filas[0]).toEqual(sinLegajo);
  });

  it("un 200 sin campo resultado es cero filas y no explota", async () => {
    vi.stubEnv("LENOX_API_KEY", "clave-de-prueba");
    const fetchFalso = vi.fn(async () => ok({ mensaje: "sin datos" }));
    vi.stubGlobal("fetch", fetchFalso);

    await expect(traerMarcaciones(dia(2026, 10, 1), dia(2026, 10, 1))).resolves.toEqual([]);
    expect(fetchFalso).toHaveBeenCalledTimes(1);
  });

  it("manda una señal de timeout en cada pedido", async () => {
    vi.stubEnv("LENOX_API_KEY", "clave-de-prueba");
    const señales: (AbortSignal | null | undefined)[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: URL, init: RequestInit) => {
        señales.push(init.signal);
        return ok({ mensaje: "Se muestran todos los resultados", resultado: [filaFalsa(1)] });
      })
    );

    await traerMarcaciones(dia(2026, 10, 1), dia(2026, 10, 1));
    expect(señales[0]).toBeInstanceOf(AbortSignal);
  });

  it("si Lenox no responde a tiempo, el error lo dice y no es un TimeoutError pelado", async () => {
    vi.stubEnv("LENOX_API_KEY", "clave-de-prueba");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
      })
    );

    await expect(traerMarcaciones(dia(2026, 10, 1), dia(2026, 10, 1))).rejects.toThrow(
      /Lenox no respondió en 60 segundos/
    );
  });

  it("un fallo de red que no es timeout se propaga como vino", async () => {
    vi.stubEnv("LENOX_API_KEY", "clave-de-prueba");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("fetch failed");
      })
    );

    await expect(traerMarcaciones(dia(2026, 10, 1), dia(2026, 10, 1))).rejects.toThrow("fetch failed");
  });

  it("devuelve las filas tal como vienen, sin interpretarlas", async () => {
    vi.stubEnv("LENOX_API_KEY", "clave-de-prueba");
    const cruda = { ...filaFalsa(1), cosaNueva: "x", tipoMarcacion: "GeoCerca", reloj: null };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ok({ mensaje: "Se muestran todos los resultados", resultado: [cruda] }))
    );

    const filas = await traerMarcaciones(dia(2026, 10, 1), dia(2026, 10, 1));
    expect(filas[0]).toEqual(cruda);
  });

  it("un 429 lanza con un texto que dice qué hacer, y no reintenta", async () => {
    vi.stubEnv("LENOX_API_KEY", "clave-de-prueba");
    // Como la API real: sin Retry-After y con el cuerpo vacío.
    const fetchFalso = vi.fn(async () => ({
      ok: false,
      status: 429,
      text: async () => "",
      json: async () => {
        throw new SyntaxError("Unexpected end of JSON input");
      },
    }));
    vi.stubGlobal("fetch", fetchFalso);

    const error = await traerMarcaciones(dia(2026, 10, 1), dia(2026, 10, 1)).catch((e: Error) => e);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toMatch(/429/);
    expect((error as Error).message).toMatch(/15 minutos/);
    expect((error as Error).message).not.toMatch(/medido|Retry-After/i);
    expect(fetchFalso).toHaveBeenCalledTimes(1);
  });

  it("un 429 en la segunda ventana corta el resto: no se sigue pidiendo", async () => {
    vi.stubEnv("LENOX_API_KEY", "clave-de-prueba");
    let n = 0;
    const fetchFalso = vi.fn(async () => {
      n++;
      if (n === 1) return ok({ mensaje: "Se muestran todos los resultados", resultado: [filaFalsa(1)] });
      return { ok: false, status: 429, text: async () => "" };
    });
    vi.stubGlobal("fetch", fetchFalso);

    await expect(traerMarcaciones(dia(2026, 10, 1), dia(2026, 10, 31))).rejects.toThrow(/429/);
    expect(fetchFalso).toHaveBeenCalledTimes(2);
  });

  it("un error de la API se propaga con lo que dijo Lenox, sin traducir", async () => {
    vi.stubEnv("LENOX_API_KEY", "clave-de-prueba");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, status: 401, text: async () => "API Key inválida o inactiva" }))
    );

    await expect(traerMarcaciones(dia(2026, 10, 1), dia(2026, 10, 1))).rejects.toThrow(
      "Lenox respondió 401: API Key inválida o inactiva"
    );
  });

  it("el 400 por pasarse del tope también llega con el mensaje de Lenox", async () => {
    vi.stubEnv("LENOX_API_KEY", "clave-de-prueba");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 400,
        text: async () => "La cantidad de dias entre las fechas desde y hasta no debe superar los 7 días",
      }))
    );

    await expect(traerMarcaciones(dia(2026, 10, 1), dia(2026, 10, 1))).rejects.toThrow(
      /Lenox respondió 400: La cantidad de dias/
    );
  });

  it("sin clave falla antes de llamar a la red", async () => {
    vi.stubEnv("LENOX_API_KEY", "");
    const fetchFalso = vi.fn();
    vi.stubGlobal("fetch", fetchFalso);

    await expect(traerMarcaciones(dia(2026, 10, 1), dia(2026, 10, 1))).rejects.toThrow(
      "Falta LENOX_API_KEY"
    );
    expect(fetchFalso).not.toHaveBeenCalled();
  });
});

describe("traerEmpleados", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("pide el padrón con las bajas incluidas", async () => {
    vi.stubEnv("LENOX_API_KEY", "clave-de-prueba");
    const urls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: URL) => {
        urls.push(url.toString());
        return ok({
          mensaje: "Se muestran todos los resultados",
          resultado: [{ nombre: "A", apellido: "B", legajo: "PC_001", fechaBaja: "2026-09-01" }],
        });
      })
    );

    const empleados = await traerEmpleados();
    expect(empleados).toHaveLength(1);
    expect(urls).toHaveLength(1);
    expect(urls[0]).toContain("/empleados/getempleados");
    expect(urls[0]).toContain("ExcluirBajas=false");
    expect(urls[0]).toContain("FilasExcluidas=0");
  });
});
