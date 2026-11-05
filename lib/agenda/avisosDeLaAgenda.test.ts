import { describe, it, expect, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  lineasDeSalud,
  divergenciasSinVer,
  leerLaSaludDeLaAgenda,
  HORAS_SIN_CORRER,
  type EventoDivergido,
  type CorridaDeLaAgenda,
} from "./avisosDeLaAgenda";

const ANA = "u-ana";
const BETO = "u-beto";
const CARLA = "u-carla";

const EL = "2026-11-03T12:00:00+00:00";
const OTRO_EL = "2026-11-04T12:00:00+00:00";

function evento(sobre: Partial<EventoDivergido> & { id: string }): EventoDivergido {
  return {
    dueno_id: ANA,
    divergencia_el: EL,
    agenda_invitados: [],
    agenda_divergencias_vistas: [],
    ...sobre,
  };
}

describe("divergenciasSinVer", () => {
  it("cuenta las del dueño", () => {
    expect(divergenciasSinVer([evento({ id: "1" }), evento({ id: "2" })], ANA)).toBe(2);
  });

  it("cuenta las de un invitado que es usuario del SdG, y no las de quien no es ni dueño ni invitado", () => {
    const filas = [evento({ id: "1", agenda_invitados: [{ usuario_id: BETO }, { usuario_id: null }] })];
    expect(divergenciasSinVer(filas, BETO)).toBe(1);
    expect(divergenciasSinVer(filas, CARLA)).toBe(0);
  });

  /*
   * El cron corre con el cliente admin, que saltea RLS y trae los eventos de
   * todos. Sin el filtro por persona, a cada uno le contaría los de los demás.
   */
  it("con todos los eventos a la vista, cada uno cuenta sólo los suyos", () => {
    const filas = [
      evento({ id: "1", dueno_id: ANA }),
      evento({ id: "2", dueno_id: BETO }),
      evento({ id: "3", dueno_id: BETO, agenda_invitados: [{ usuario_id: ANA }] }),
    ];
    expect(divergenciasSinVer(filas, ANA)).toBe(2);
    expect(divergenciasSinVer(filas, BETO)).toBe(2);
    expect(divergenciasSinVer(filas, CARLA)).toBe(0);
  });

  it("no cuenta la que ya dio por vista, y cada uno da por vistas las suyas", () => {
    const filas = [
      evento({
        id: "1",
        agenda_invitados: [{ usuario_id: BETO }],
        agenda_divergencias_vistas: [{ usuario_id: ANA, divergencia_el: EL }],
      }),
    ];
    expect(divergenciasSinVer(filas, ANA)).toBe(0);
    // Ana la vio; Beto no.
    expect(divergenciasSinVer(filas, BETO)).toBe(1);
  });

  it("una divergencia nueva del mismo evento vuelve a contar, aunque se haya visto la anterior", () => {
    const filas = [
      evento({
        id: "1",
        divergencia_el: OTRO_EL,
        agenda_divergencias_vistas: [{ usuario_id: ANA, divergencia_el: EL }],
      }),
    ];
    expect(divergenciasSinVer(filas, ANA)).toBe(1);
  });

  it("compara el instante y no el texto de la fecha", () => {
    const filas = [
      evento({
        id: "1",
        divergencia_el: "2026-11-03T12:00:00+00:00",
        agenda_divergencias_vistas: [{ usuario_id: ANA, divergencia_el: "2026-11-03T09:00:00-03:00" }],
      }),
    ];
    expect(divergenciasSinVer(filas, ANA)).toBe(0);
  });

  it("un evento sin divergencia no cuenta", () => {
    expect(divergenciasSinVer([evento({ id: "1", divergencia_el: null })], ANA)).toBe(0);
  });

  it("los embeds en null (RLS, o una tabla vacía) no rompen", () => {
    const filas = [evento({ id: "1", agenda_invitados: null, agenda_divergencias_vistas: null })];
    expect(divergenciasSinVer(filas, ANA)).toBe(1);
  });
});

/*
 * Esto era `describe("pasosCaidos")`, y los casos son los mismos: lo que se
 * retiró el 05/11/2026 fue el **aviso**, no la comprobación. `lineasDeSalud`
 * sigue usándola para la pantalla de `/agenda`, así que se pregunta por los
 * pasos que no están sanos en vez de por la lista que devolvía `pasosCaidos`.
 */
describe("qué pasos están caídos, que es lo que pinta /agenda", () => {
  const AHORA = new Date("2026-11-03T12:00:00Z");
  const haceHoras = (h: number) => new Date(AHORA.getTime() - h * 3_600_000).toISOString();
  const sana: CorridaDeLaAgenda[] = [
    { recurso: "canales", ok: true, created_at: haceHoras(10) },
    { recurso: "barrido", ok: true, created_at: haceHoras(10) },
  ];
  const caidos = (corridas: CorridaDeLaAgenda[], ahora: Date) =>
    lineasDeSalud(corridas, ahora).filter((l) => l.estado !== "sana").map((l) => l.paso);

  it("con los dos pasos corriendo bien no hay nada caído", () => {
    expect(caidos(sana, AHORA)).toEqual([]);
  });

  it("una última corrida fallida es un paso caído", () => {
    const corridas = [{ ...sana[0], ok: false }, sana[1]];
    expect(caidos(corridas, AHORA)).toEqual(["canales"]);
  });

  /*
   * El que justifica todo esto: si el cron no corre no escribe nada, así que no
   * hay ninguna fila roja. Mirar sólo `ok` lo vería sano para siempre.
   */
  it("un paso que no corre hace más de un día y medio está caído aunque su última fila diga ok", () => {
    const corridas = [{ ...sana[0], created_at: haceHoras(HORAS_SIN_CORRER + 1) }, sana[1]];
    expect(caidos(corridas, AHORA)).toEqual(["canales"]);
  });

  /*
   * Con el cron REAL: corre a las 05:00 UTC (vercel.json). Un día salteado no
   * suena; el segundo seguido sí, y no antes de las 07:00 UTC del segundo día.
   * Con 36 h una sola corrida salteada ya cruzaba el umbral a las 17:00 UTC del
   * día siguiente, doce horas antes de la próxima corrida.
   */
  describe("un día perdido no suena, el segundo seguido sí", () => {
    const ULTIMA = "2026-11-03T05:00:00Z";
    const corridasDesde = (ultima: string) => sana.map((c) => ({ ...c, created_at: ultima }));
    const a = (iso: string) => caidos(corridasDesde(ULTIMA), new Date(iso));

    // 18:00 UTC son 37 h después de la última corrida: pasada la marca de las 36 h
    // —con la que esto SONABA— y a 13 h del umbral de 50. A las 17:00 en punto
    // serían exactamente 36 h y, con `<` estricto, no distinguiría un umbral del otro.
    it("la corrida de mañana no corrió y son las 18:00 UTC: 37 h, que con 36 h sonaba", () => {
      expect(a("2026-11-04T18:00:00Z")).toEqual([]);
    });

    it("sigue sin sonar cuando ya debería haber corrido la de pasado mañana", () => {
      expect(a("2026-11-05T06:00:00Z")).toEqual([]);
    });

    it("suena cuando la segunda seguida tampoco corrió", () => {
      expect(a("2026-11-05T08:00:00Z")).toEqual(["canales", "barrido"]);
    });
  });

  it("un paso que nunca corrió está caído", () => {
    expect(caidos([sana[0]], AHORA)).toEqual(["barrido"]);
    expect(caidos([], AHORA)).toEqual(["canales", "barrido"]);
  });

  it("una fecha ilegible no cuenta como una corrida reciente", () => {
    expect(caidos([{ ...sana[0], created_at: "nunca" }, sana[1]], AHORA)).toEqual(["canales"]);
  });

  // `aviso_de_google` sólo escribe cuando hay algo que decir: una fila roja ahí
  // queda clavada hasta el próximo fallo y sería una alarma que no se apaga.
  it("las corridas de otros recursos no cuentan, ni para bien ni para mal", () => {
    const corridas = [...sana, { recurso: "aviso_de_google", ok: false, created_at: haceHoras(1) }];
    expect(caidos(corridas, AHORA)).toEqual([]);
    expect(caidos([{ recurso: "pendientes", ok: true, created_at: haceHoras(1) }], AHORA)).toEqual(["canales", "barrido"]);
  });
});

describe("leerLaSaludDeLaAgenda", () => {
  const AHORA = new Date("2026-11-03T12:00:00Z");
  const reciente = new Date(AHORA.getTime() - 3_600_000).toISOString();

  /** Un cliente cuya consulta termina en lo que se le diga. */
  function clienteQue(resultado: () => Promise<unknown>): SupabaseClient {
    const b: Record<string, unknown> = {};
    for (const m of ["select", "eq", "in"]) b[m] = () => b;
    b.returns = resultado;
    return { from: () => b } as unknown as SupabaseClient;
  }

  it("devuelve las corridas que leyó, y dice que pudo comprobar", async () => {
    const corridas = [
      { recurso: "canales", ok: true, created_at: reciente },
      { recurso: "barrido", ok: true, created_at: reciente },
    ];
    const c = clienteQue(async () => ({ data: corridas, error: null }));
    expect(await leerLaSaludDeLaAgenda(c)).toEqual({ sinComprobar: false, corridas });
  });

  /*
   * El que importa: una salud que dice «todo bien» cuando no pudo mirar es el
   * fallo silencioso que existe para cerrar. Sin `sinComprobar`, la pantalla
   * pintaría los dos pasos en «nunca corrió», que es otra afirmación falsa.
   */
  it("si la lectura devuelve error NO es una vista vacía: es una comprobación que falló", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const c = clienteQue(async () => ({ data: null, error: { message: "relation does not exist" } }));
    expect(await leerLaSaludDeLaAgenda(c)).toEqual({ sinComprobar: true, corridas: [] });
  });

  it("si la lectura tira una excepción tampoco calla, y no tira", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const c = clienteQue(async () => {
      throw new Error("fetch failed");
    });
    expect(await leerLaSaludDeLaAgenda(c)).toEqual({ sinComprobar: true, corridas: [] });
  });

  /*
   * Sin error y sin datos tampoco es una lectura: de ella no se afirma nada.
   * Era el agujero que quedaba acá —`data ?? []` daba una vista vacía y
   * `sinComprobar: false`— y es justo lo contrario de lo que esto hace.
   */
  it("sin error y sin datos tampoco afirma nada", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const c = clienteQue(async () => ({ data: null, error: null }));
    expect(await leerLaSaludDeLaAgenda(c)).toEqual({ sinComprobar: true, corridas: [] });
  });
});

describe("lineasDeSalud: lo que ve admin_sistema en /agenda", () => {
  const AHORA = new Date("2026-11-03T12:00:00Z");
  const haceHoras = (h: number) => new Date(AHORA.getTime() - h * 3_600_000).toISOString();

  it("dice cuándo corrió cada paso y cuál está caído", () => {
    const lineas = lineasDeSalud(
      [
        { recurso: "canales", ok: false, created_at: haceHoras(7), error: "Se cortó por tiempo: quedaron sin renovar a@x.com" },
        { recurso: "barrido", ok: true, created_at: haceHoras(7) },
      ],
      AHORA
    );
    expect(lineas.map((l) => [l.paso, l.estado])).toEqual([["canales", "fallo"], ["barrido", "sana"]]);
    expect(lineas[0].texto).toBe("Falló la última corrida (hace 7 h): Se cortó por tiempo: quedaron sin renovar a@x.com");
    expect(lineas[1].texto).toBe("Corrió hace 7 h, sin fallos.");
  });

  it("un paso que nunca corrió lo dice, y uno viejo dice desde cuándo", () => {
    const lineas = lineasDeSalud([{ recurso: "barrido", ok: true, created_at: haceHoras(60) }], AHORA);
    expect(lineas[0]).toMatchObject({ paso: "canales", estado: "nunca", texto: "Nunca corrió." });
    expect(lineas[1].estado).toBe("vieja");
    expect(lineas[1].texto).toContain("hace 2 días");
  });

  it("dice cuánto hace en horas, y pasa a días cuando son muchas", () => {
    const lineas = lineasDeSalud(
      [
        { recurso: "canales", ok: true, created_at: haceHoras(5) },
        { recurso: "barrido", ok: true, created_at: haceHoras(72) },
      ],
      AHORA
    );
    expect(lineas[0].texto).toContain("hace 5 h");
    expect(lineas[1].texto).toContain("hace 3 días");
  });
});
