import { describe, it, expect, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  divergenciasSinVer,
  pasosCaidos,
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

describe("pasosCaidos", () => {
  const AHORA = new Date("2026-11-03T12:00:00Z");
  const haceHoras = (h: number) => new Date(AHORA.getTime() - h * 3_600_000).toISOString();
  const sana: CorridaDeLaAgenda[] = [
    { recurso: "canales", ok: true, created_at: haceHoras(10) },
    { recurso: "barrido", ok: true, created_at: haceHoras(10) },
  ];

  it("con los dos pasos corriendo bien no hay nada caído", () => {
    expect(pasosCaidos(sana, AHORA)).toEqual([]);
  });

  it("una última corrida fallida es un paso caído", () => {
    const corridas = [{ ...sana[0], ok: false }, sana[1]];
    expect(pasosCaidos(corridas, AHORA)).toEqual(["canales"]);
  });

  /*
   * El que justifica el aviso: si el cron no corre no escribe nada, así que no
   * hay ninguna fila roja. Mirar sólo `ok` lo vería sano para siempre.
   */
  it("un paso que no corre hace más de un día y medio está caído aunque su última fila diga ok", () => {
    const corridas = [{ ...sana[0], created_at: haceHoras(HORAS_SIN_CORRER + 1) }, sana[1]];
    expect(pasosCaidos(corridas, AHORA)).toEqual(["canales"]);
  });

  it("un día perdido no suena", () => {
    const corridas = sana.map((c) => ({ ...c, created_at: haceHoras(30) }));
    expect(pasosCaidos(corridas, AHORA)).toEqual([]);
  });

  it("un paso que nunca corrió está caído", () => {
    expect(pasosCaidos([sana[0]], AHORA)).toEqual(["barrido"]);
    expect(pasosCaidos([], AHORA)).toEqual(["canales", "barrido"]);
  });

  it("una fecha ilegible no cuenta como una corrida reciente", () => {
    expect(pasosCaidos([{ ...sana[0], created_at: "nunca" }, sana[1]], AHORA)).toEqual(["canales"]);
  });

  // `aviso_de_google` sólo escribe cuando hay algo que decir: una fila roja ahí
  // queda clavada hasta el próximo fallo y sería una alarma que no se apaga.
  it("las corridas de otros recursos no cuentan, ni para bien ni para mal", () => {
    const corridas = [...sana, { recurso: "aviso_de_google", ok: false, created_at: haceHoras(1) }];
    expect(pasosCaidos(corridas, AHORA)).toEqual([]);
    expect(pasosCaidos([{ recurso: "pendientes", ok: true, created_at: haceHoras(1) }], AHORA)).toEqual(["canales", "barrido"]);
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

  it("con los dos pasos sanos: nada caído y comprobado", async () => {
    const c = clienteQue(async () => ({
      data: [
        { recurso: "canales", ok: true, created_at: reciente },
        { recurso: "barrido", ok: true, created_at: reciente },
      ],
      error: null,
    }));
    expect(await leerLaSaludDeLaAgenda(c, AHORA)).toEqual({ caidos: 0, sinComprobar: false });
  });

  it("con un paso caído lo cuenta", async () => {
    const c = clienteQue(async () => ({
      data: [{ recurso: "canales", ok: false, created_at: reciente }, { recurso: "barrido", ok: true, created_at: reciente }],
      error: null,
    }));
    expect(await leerLaSaludDeLaAgenda(c, AHORA)).toEqual({ caidos: 1, sinComprobar: false });
  });

  /*
   * El que importa: un aviso de salud que dice «todo bien» cuando no pudo mirar
   * es el fallo silencioso que existe para cerrar.
   */
  it("si la lectura devuelve error NO es un cero: es una comprobación que falló", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const c = clienteQue(async () => ({ data: null, error: { message: "relation does not exist" } }));
    expect(await leerLaSaludDeLaAgenda(c, AHORA)).toEqual({ caidos: 0, sinComprobar: true });
  });

  it("si la lectura tira una excepción tampoco calla, y no tira", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const c = clienteQue(async () => {
      throw new Error("fetch failed");
    });
    expect(await leerLaSaludDeLaAgenda(c, AHORA)).toEqual({ caidos: 0, sinComprobar: true });
  });
});
