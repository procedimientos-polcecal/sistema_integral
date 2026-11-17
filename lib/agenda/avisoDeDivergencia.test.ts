/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { enviarPush } from "@/lib/core/webpush";
import {
  avisarDeLasDivergencias,
  eventosPorPersona,
  textoDeLaDivergencia,
  type EventoConGente,
} from "./avisoDeDivergencia";

// El envío real necesita las claves VAPID y sale a internet. Lo que se prueba
// acá es a quién se le manda, cuántas veces y qué dice, no `web-push`.
vi.mock("@/lib/core/webpush", () => ({ enviarPush: vi.fn() }));

const ANA = "u-ana";
const BETO = "u-beto";
const CARLA = "u-carla";
const DE_DIA = new Date("2026-11-03T15:00:00Z"); // 12:00 en Argentina
const DE_NOCHE = new Date("2026-11-04T02:00:00Z"); // 23:00 en Argentina

type Fila = Record<string, any>;

/** Un cliente mínimo: select / in / eq / range / returns / delete sobre tablas en memoria. */
function baseDeJuguete(tablas: Record<string, Fila[]>) {
  const consultas: string[] = [];
  const borradas: Fila[] = [];
  const cliente = {
    from(tabla: string) {
      consultas.push(tabla);
      const filtros: ((f: Fila) => boolean)[] = [];
      let borrar = false;
      let desde = 0;
      let hasta = Infinity;
      const b: any = {
        select: () => b,
        returns: () => b,
        delete: () => ((borrar = true), b),
        in: (c: string, v: unknown[]) => (filtros.push((f) => v.includes(f[c])), b),
        eq: (c: string, v: unknown) => (filtros.push((f) => f[c] === v), b),
        range: (a: number, z: number) => ((desde = a), (hasta = z), b),
        then: (ok: (r: unknown) => unknown) => {
          const filas = (tablas[tabla] ?? []).filter((f) => filtros.every((p) => p(f)));
          if (borrar) borradas.push(...filas);
          return Promise.resolve({ data: filas.slice(desde, hasta + 1), error: null }).then(ok);
        },
      };
      return b;
    },
  };
  return { cliente: cliente as unknown as SupabaseClient, consultas, borradas };
}

const aparato = (usuario_id: string, n = 1) => ({
  usuario_id,
  endpoint: `https://push/${usuario_id}/${n}`,
  p256dh: "k",
  auth: "a",
});

/** Dos usuarios activos con un aparato cada uno, más una cuenta dada de baja. */
function escenario(eventos: Fila[]) {
  return baseDeJuguete({
    agenda_eventos: eventos,
    usuarios: [
      { id: ANA, activo: true },
      { id: BETO, activo: true },
      { id: CARLA, activo: false },
    ],
    push_suscripciones: [aparato(ANA), aparato(BETO), aparato(CARLA)],
  });
}

const evento = (id: string, dueno_id: string, invitados: (string | null)[] = []): Fila => ({
  id,
  titulo: `Evento ${id}`,
  dueno_id,
  agenda_invitados: invitados.map((usuario_id) => ({ usuario_id })),
});

const movido = (evento_id: string) => ({ evento_id, divergencia: "movido" as const });

beforeEach(() => {
  vi.mocked(enviarPush).mockReset();
  vi.mocked(enviarPush).mockResolvedValue("enviada");
});

describe("textoDeLaDivergencia", () => {
  it("sin eventos no hay nada que decir", () => {
    expect(textoDeLaDivergencia([])).toBeNull();
  });

  it("uno solo dice qué le pasó y cómo se llama", () => {
    expect(textoDeLaDivergencia([{ titulo: "OT 2901", divergencia: "borrado" }])).toEqual({
      title: "Borraron en Google un evento de la Agenda",
      body: "OT 2901",
      url: "/agenda",
    });
    expect(textoDeLaDivergencia([{ titulo: "OT 2901", divergencia: "movido" }])?.title).toBe(
      "Movieron en Google un evento de la Agenda"
    );
  });

  it("varios dicen cuántos son y nombran los primeros", () => {
    const eventos = ["A", "B", "C", "D", "E"].map((titulo) => ({ titulo, divergencia: "borrado" as const }));
    expect(textoDeLaDivergencia(eventos)).toEqual({
      title: "5 eventos de la Agenda cambiaron en Google",
      body: "A, B, C y 2 más",
      url: "/agenda",
    });
    expect(textoDeLaDivergencia(eventos.slice(0, 3))?.body).toBe("A, B y C");
  });

  // El payload es el `Aviso` plano: la `url` en el primer nivel, y nada más.
  it("el payload es plano: title, body y url en el primer nivel", () => {
    for (const eventos of [
      [{ titulo: "uno", divergencia: "movido" as const }],
      [{ titulo: "uno", divergencia: "movido" as const }, { titulo: "dos", divergencia: "borrado" as const }],
    ]) {
      const aviso = textoDeLaDivergencia(eventos)!;
      expect(Object.keys(aviso).sort()).toEqual(["body", "title", "url"]);
      expect(typeof aviso.url).toBe("string");
    }
  });

  it("un título larguísimo se recorta y uno vacío no deja el cuerpo en blanco", () => {
    expect(textoDeLaDivergencia([{ titulo: "x".repeat(200), divergencia: "movido" }])!.body.length).toBeLessThan(70);
    expect(textoDeLaDivergencia([{ titulo: "  ", divergencia: "movido" }])!.body).toBe("(sin título)");
  });
});

describe("eventosPorPersona", () => {
  it("le toca al dueño y a los invitados que son usuarios, y a nadie más", () => {
    const eventos = [evento("1", ANA, [BETO, null])] as EventoConGente[];
    const r = eventosPorPersona(eventos, [movido("1")]);
    expect([...r.keys()].sort()).toEqual([ANA, BETO]);
  });

  it("cada persona recibe sólo sus eventos", () => {
    const eventos = [evento("1", ANA), evento("2", ANA, [BETO]), evento("3", CARLA)] as EventoConGente[];
    const r = eventosPorPersona(eventos, [movido("1"), movido("2"), movido("3")]);
    expect(r.get(ANA)?.map((e) => e.titulo)).toEqual(["Evento 1", "Evento 2"]);
    expect(r.get(BETO)?.map((e) => e.titulo)).toEqual(["Evento 2"]);
    expect(r.get(CARLA)?.map((e) => e.titulo)).toEqual(["Evento 3"]);
  });

  it("un evento que no divergió en esta corrida no entra", () => {
    const r = eventosPorPersona([evento("1", ANA)] as EventoConGente[], []);
    expect(r.size).toBe(0);
  });
});

describe("avisarDeLasDivergencias", () => {
  it("avisa al dueño y a los invitados que son usuarios del SdG", async () => {
    const { cliente } = escenario([evento("1", ANA, [BETO])]);
    const r = await avisarDeLasDivergencias(cliente, [movido("1")], DE_DIA);
    expect(r).toEqual({ enviadas: 2, personas: 2 });
    const aQuien = vi.mocked(enviarPush).mock.calls.map(([sub]) => sub.endpoint).sort();
    expect(aQuien).toEqual(["https://push/u-ana/1", "https://push/u-beto/1"]);
  });

  it("un invitado externo no recibe push", async () => {
    // Un externo no tiene `usuario_id`: ni siquiera tiene suscripción.
    const { cliente } = escenario([evento("1", ANA, [null, null])]);
    const r = await avisarDeLasDivergencias(cliente, [movido("1")], DE_DIA);
    expect(r.personas).toBe(1);
    expect(vi.mocked(enviarPush)).toHaveBeenCalledTimes(1);
  });

  it("diez eventos tocados de una vez son una notificación por persona, no diez", async () => {
    const diez = Array.from({ length: 10 }, (_, i) => evento(String(i), ANA, [BETO]));
    const { cliente } = escenario(diez);
    const r = await avisarDeLasDivergencias(cliente, diez.map((e) => movido(e.id)), DE_DIA);
    expect(r).toEqual({ enviadas: 2, personas: 2 });
    expect(vi.mocked(enviarPush)).toHaveBeenCalledTimes(2);
    expect(vi.mocked(enviarPush).mock.calls[0][1].title).toBe("10 eventos de la Agenda cambiaron en Google");
  });

  it("a cada persona le llega lo suyo y no lo de los demás", async () => {
    const { cliente } = escenario([evento("1", ANA), evento("2", BETO)]);
    await avisarDeLasDivergencias(cliente, [movido("1"), movido("2")], DE_DIA);
    const porEndpoint = new Map(vi.mocked(enviarPush).mock.calls.map(([sub, aviso]) => [sub.endpoint, aviso]));
    expect(porEndpoint.get("https://push/u-ana/1")?.body).toBe("Evento 1");
    expect(porEndpoint.get("https://push/u-beto/1")?.body).toBe("Evento 2");
  });

  it("alguien con dos aparatos recibe en los dos", async () => {
    const { cliente } = baseDeJuguete({
      agenda_eventos: [evento("1", ANA)],
      usuarios: [{ id: ANA, activo: true }],
      push_suscripciones: [aparato(ANA, 1), aparato(ANA, 2)],
    });
    const r = await avisarDeLasDivergencias(cliente, [movido("1")], DE_DIA);
    expect(r).toEqual({ enviadas: 2, personas: 1 });
  });

  it("una cuenta dada de baja no recibe", async () => {
    const { cliente } = escenario([evento("1", CARLA)]);
    const r = await avisarDeLasDivergencias(cliente, [movido("1")], DE_DIA);
    expect(r.enviadas).toBe(0);
    expect(vi.mocked(enviarPush)).not.toHaveBeenCalled();
  });

  it("fuera de 7:00–21:00 no se manda y ni se toca la base: no se encola nada", async () => {
    const { cliente, consultas } = escenario([evento("1", ANA)]);
    const r = await avisarDeLasDivergencias(cliente, [movido("1")], DE_NOCHE);
    expect(r).toEqual({ enviadas: 0, personas: 0, motivo: "fuera de hora" });
    expect(vi.mocked(enviarPush)).not.toHaveBeenCalled();
    expect(consultas).toEqual([]);
  });

  it("sin divergencias no se manda ni se consulta nada", async () => {
    const { cliente, consultas } = escenario([evento("1", ANA)]);
    const r = await avisarDeLasDivergencias(cliente, [], DE_DIA);
    expect(r.motivo).toBe("nada que avisar");
    expect(consultas).toEqual([]);
  });

  it("un aparato vencido se borra, y sólo ése", async () => {
    vi.mocked(enviarPush).mockResolvedValueOnce("vencida");
    const { cliente, borradas } = escenario([evento("1", ANA)]);
    const r = await avisarDeLasDivergencias(cliente, [movido("1")], DE_DIA);
    expect(r.enviadas).toBe(0);
    expect(borradas.map((b) => b.endpoint)).toEqual(["https://push/u-ana/1"]);
  });

  it("un aparato que falla no calla a los que vienen después", async () => {
    vi.mocked(enviarPush).mockResolvedValueOnce("fallo");
    const { cliente, borradas } = escenario([evento("1", ANA, [BETO])]);
    const r = await avisarDeLasDivergencias(cliente, [movido("1")], DE_DIA);
    expect(r).toEqual({ enviadas: 1, personas: 1 });
    expect(borradas).toEqual([]);
  });

  it("nunca tira: si la base falla devuelve el motivo", async () => {
    const roto = {
      from: () => {
        throw new Error("la base se cayó");
      },
    } as unknown as SupabaseClient;
    const r = await avisarDeLasDivergencias(roto, [movido("1")], DE_DIA);
    expect(r).toEqual({ enviadas: 0, personas: 0, motivo: "la base se cayó", error: "la base se cayó" });
    // Y las decisiones no son errores.
    expect((await avisarDeLasDivergencias(roto, [], DE_DIA)).error).toBeUndefined();
  });
});
