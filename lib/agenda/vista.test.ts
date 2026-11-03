import { describe, it, expect } from "vitest";
import {
  aEventoVista, corteDelHistorial, DIAS_DE_HISTORIAL, horarioDelEvento, leerRespuestaDeEscritura,
  nombreDelDueno, permisosDelEvento, separarProximosYPasados, type EventoVista, type FilaCruda,
} from "./vista";

const sinDirectorio = new Map<string, string>();

function evento(parte: Partial<EventoVista> = {}): EventoVista {
  return {
    id: "e1", titulo: "Reunión", descripcion: null, lugar: null,
    inicio: "2026-11-03T11:00:00+00:00", fin: "2026-11-03T12:30:00+00:00",
    duenoId: "yo", casilla: "yo@polcecal.com", duenoNombre: null,
    divergencia: null, divergenciaVista: false, googlePendiente: null, aviso: null,
    otId: null, turno: null, invitados: [],
    ...parte,
  };
}

describe("aEventoVista: una sola forma para filas de forma distinta", () => {
  const base: FilaCruda = {
    id: "e1", titulo: "T", inicio: "2026-11-03T11:00:00+00:00", fin: "2026-11-03T12:00:00+00:00",
    dueno_id: "d", casilla: "d@polcecal.com",
  };

  it("la fila mínima de la relectura fallida del POST no rompe", () => {
    // Es lo que devuelve el POST cuando la relectura falla: sin dueño, sin
    // invitados, sin nada de Google.
    const v = aEventoVista(base, sinDirectorio);
    expect(v.invitados).toEqual([]);
    expect(v.divergencia).toBeNull();
    expect(v.divergenciaVista).toBe(false);
    expect(v.duenoNombre).toBeNull();
  });

  it("la fila de la lectura de la pantalla trae todo, y la de PATCH no trae divergencia_vista", () => {
    const get = aEventoVista(
      { ...base, divergencia: "movido", divergencia_vista: true, agenda_invitados: [{ email: "A@x.com" }] },
      sinDirectorio
    );
    expect(get.divergenciaVista).toBe(true);
    expect(get.invitados).toEqual(["a@x.com"]);
    const patch = aEventoVista({ ...base, divergencia: "movido" }, sinDirectorio);
    // Sin el dato se asume «no la vio»: la alerta se muestra, que es el lado seguro.
    expect(patch.divergenciaVista).toBe(false);
  });

  it("una divergencia que no es ninguna de las dos se descarta", () => {
    expect(aEventoVista({ ...base, divergencia: "raro" }, sinDirectorio).divergencia).toBeNull();
  });
});

describe("nombreDelDueno", () => {
  it("el embed manda; el embed puede venir como objeto o como lista", () => {
    expect(nombreDelDueno({ nombre: "Ana", apellido: "Paz" }, "d", sinDirectorio)).toBe("Ana Paz");
    expect(nombreDelDueno([{ nombre: "Ana", apellido: "Paz" }], "d", sinDirectorio)).toBe("Ana Paz");
  });
  it("sin embed (un invitado mirando al dueño: RLS) sale del directorio", () => {
    expect(nombreDelDueno(null, "d", new Map([["d", "Mantenimiento"]]))).toBe("Mantenimiento");
  });
  it("sin ninguno es null, y la pantalla muestra la casilla en vez de inventar", () => {
    expect(nombreDelDueno(null, "d", sinDirectorio)).toBeNull();
    expect(nombreDelDueno({ nombre: " ", apellido: null }, "d", sinDirectorio)).toBeNull();
  });
});

describe("la ventana", () => {
  it("el corte es de 30 días atrás, exacto", () => {
    const ahora = new Date("2026-11-03T12:00:00.000Z");
    expect(DIAS_DE_HISTORIAL).toBe(30);
    expect(corteDelHistorial(ahora)).toBe("2026-10-04T12:00:00.000Z");
  });
});

describe("separarProximosYPasados", () => {
  const ahora = Date.parse("2026-11-03T15:00:00Z");
  const e = (id: string, inicio: string, fin: string) => evento({ id, inicio, fin });

  it("los próximos de más cerca a más lejos; los pasados del más reciente al más viejo", () => {
    const r = separarProximosYPasados(
      [
        e("viejo", "2026-10-01T10:00:00Z", "2026-10-01T11:00:00Z"),
        e("lejano", "2026-12-01T10:00:00Z", "2026-12-01T11:00:00Z"),
        e("ayer", "2026-11-02T10:00:00Z", "2026-11-02T11:00:00Z"),
        e("cercano", "2026-11-04T10:00:00Z", "2026-11-04T11:00:00Z"),
      ],
      ahora
    );
    expect(r.proximos.map((x) => x.id)).toEqual(["cercano", "lejano"]);
    expect(r.pasados.map((x) => x.id)).toEqual(["ayer", "viejo"]);
  });

  it("uno en curso sigue siendo próximo: no terminó", () => {
    const r = separarProximosYPasados([e("ahora", "2026-11-03T14:00:00Z", "2026-11-03T16:00:00Z")], ahora);
    expect(r.proximos).toHaveLength(1);
    expect(r.pasados).toHaveLength(0);
  });
});

describe("permisosDelEvento", () => {
  it("el dueño edita y borra un evento propio", () => {
    expect(permisosDelEvento(evento(), "yo").puedeEditarYBorrar).toBe(true);
  });
  it("un invitado no edita ni borra", () => {
    expect(permisosDelEvento(evento(), "otro").puedeEditarYBorrar).toBe(false);
  });
  it("el evento de una OT no se edita ni se borra, ni siquiera siendo el dueño", () => {
    const p = permisosDelEvento(evento({ otId: "ot-1" }), "yo");
    expect(p.puedeEditarYBorrar).toBe(false);
  });

  it("destrabar es del dueño y sólo si hay divergencia", () => {
    expect(permisosDelEvento(evento(), "yo").puedeDestrabar).toBe(false);
    expect(permisosDelEvento(evento({ divergencia: "movido" }), "yo").puedeDestrabar).toBe(true);
    expect(permisosDelEvento(evento({ divergencia: "movido" }), "otro").puedeDestrabar).toBe(false);
  });

  it("aceptar sólo existe para un movido que no sea de una OT", () => {
    expect(permisosDelEvento(evento({ divergencia: "movido" }), "yo").puedeAceptar).toBe(true);
    // Un borrado no tiene horario que aceptar (la ruta contesta 409).
    expect(permisosDelEvento(evento({ divergencia: "borrado" }), "yo").puedeAceptar).toBe(false);
    // Para una OT la verdad es la orden (la ruta contesta 409).
    expect(permisosDelEvento(evento({ divergencia: "movido", otId: "ot-1" }), "yo").puedeAceptar).toBe(false);
  });

  it("reescribir sí vale para una OT: es lo único que resucita uno que borraron", () => {
    const p = permisosDelEvento(evento({ divergencia: "borrado", otId: "ot-1" }), "yo");
    expect(p.puedeReescribir).toBe(true);
    expect(p.puedeAceptar).toBe(false);
  });

  it("«Ya lo vi» es de cualquiera que lo vea, y desaparece una vez dado", () => {
    expect(permisosDelEvento(evento({ divergencia: "movido" }), "otro").puedeDarPorVisto).toBe(true);
    expect(permisosDelEvento(evento({ divergencia: "movido", divergenciaVista: true }), "otro").puedeDarPorVisto).toBe(false);
    expect(permisosDelEvento(evento(), "yo").puedeDarPorVisto).toBe(false);
  });
});

describe("leerRespuestaDeEscritura: las cinco respuestas, una lectura", () => {
  it("un error trae su motivo", () => {
    const r = leerRespuestaDeEscritura(409, { error: "No se puede modificar este evento" });
    expect(r).toEqual({ ok: false, error: "No se puede modificar este evento", advertencia: null });
  });
  it("un error sin cuerpo legible dice el número en vez de nada", () => {
    expect(leerRespuestaDeEscritura(500, null).error).toContain("500");
    expect(leerRespuestaDeEscritura(502, { error: "  " }).error).toContain("502");
  });
  it("un 201 limpio no avisa nada", () => {
    expect(leerRespuestaDeEscritura(201, { data: {}, google: { escrito: true, pendiente: null } }))
      .toEqual({ ok: true, error: null, advertencia: null });
  });
  it("un 201 con advertencia es un éxito que se muestra, no se traga", () => {
    const r = leerRespuestaDeEscritura(201, { data: {}, advertencia: "No llegó a Google" });
    expect(r.ok).toBe(true);
    expect(r.advertencia).toBe("No llegó a Google");
  });
  it("si google.pendiente dice algo y no hay advertencia, igual se avisa con lo que dijo Google", () => {
    const r = leerRespuestaDeEscritura(201, { data: {}, google: { escrito: false, pendiente: "403 forbidden" } });
    expect(r.advertencia).toContain("403 forbidden");
  });
  it("un cambio sobre un evento divergido se guardó pero no se escribió", () => {
    const r = leerRespuestaDeEscritura(200, { data: {}, google: { escrito: false, trabado: true } });
    expect(r.ok).toBe(true);
    expect(r.advertencia).toContain("divergido");
  });
  it("destrabar y visto no traen google", () => {
    expect(leerRespuestaDeEscritura(200, { data: null, advertencia: "Recargá la pantalla." }).advertencia).toBe("Recargá la pantalla.");
    expect(leerRespuestaDeEscritura(200, { data: { vista: true } }).advertencia).toBeNull();
  });
});

describe("horarioDelEvento", () => {
  it("lo muestra en hora de Argentina, no en UTC", () => {
    // 11:00Z son las 08:00 de Argentina.
    expect(horarioDelEvento("2026-11-03T11:00:00+00:00", "2026-11-03T12:30:00+00:00"))
      .toBe("mar 03/11/2026 · 08:00 a 09:30");
  });
  it("un evento que cruza la medianoche dice los dos días", () => {
    expect(horarioDelEvento("2026-11-03T23:00:00Z", "2026-11-04T04:00:00Z"))
      .toBe("mar 03/11/2026 20:00 a mié 04/11/2026 01:00");
  });
});
