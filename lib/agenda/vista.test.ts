import { describe, it, expect } from "vitest";
import {
  aEventoVista, avisoDelPendiente, consecuenciaDeDestrabar, corteDelHistorial, mientrasEstaDivergido, cruzaLaMedianoche, DIAS_DE_HISTORIAL, horarioDelEvento, horarioParaGuardar,
  leerRespuestaDeEscritura,
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

describe("avisoDelPendiente: sólo promete el reintento que existe", () => {
  it("sin pendiente no dice nada", () => {
    expect(avisoDelPendiente(evento())).toBeNull();
  });
  it("un pendiente sin divergencia se reintenta solo, y dice lo que Google contestó", () => {
    const t = avisoDelPendiente(evento({ googlePendiente: "quota exceeded" }));
    expect(t).toContain("se reintenta solo");
    expect(t).not.toContain("NO se reintenta");
    expect(t).toContain("quota exceeded");
  });
  it("un pendiente en un evento divergido NO se reintenta, y no promete que sí", () => {
    for (const divergencia of ["movido", "borrado"] as const) {
      const t = avisoDelPendiente(evento({ googlePendiente: "quota exceeded", divergencia }));
      expect(t).toContain("NO se reintenta solo");
      expect(t).not.toContain("Queda pendiente y se reintenta solo");
      expect(t).toContain("volver a mandarlo a mano");
      expect(t).toContain("quota exceeded");
    }
  });
  it("dice cómo volver a mandarlo según sea de una OT o propio", () => {
    expect(avisoDelPendiente(evento({ googlePendiente: "x", divergencia: "movido", otId: "ot-1" })))
      .toContain("mandando la orden de nuevo");
    expect(avisoDelPendiente(evento({ googlePendiente: "x", divergencia: "movido" })))
      .toContain("Volver a poner lo del sistema");
  });
});

describe("mientrasEstaDivergido: el panel no promete un movimiento solo que no existe", () => {
  it("el evento de una OT dice que el sistema deja de moverlo solo, y qué pasa con la fecha de la orden", () => {
    const t = mientrasEstaDivergido(evento({ otId: "ot-1" }), "elijas");
    expect(t.negrita).toBe("Hasta que elijas una salida, el sistema deja de mover este evento solo.");
    expect(t.resto).toContain("la fecha de la orden");
  });
  it("uno propio no se mueve solo nunca: dice lo que sí es cierto, que el SdG no lo escribe en Google", () => {
    const t = mientrasEstaDivergido(evento(), "Ana Paz elija");
    expect(t.negrita).toBe("Hasta que Ana Paz elija una salida, el SdG no escribe nada de este evento en Google.");
    expect(t.negrita).not.toContain("mover este evento solo");
    expect(t.resto).not.toContain("orden");
  });
});

describe("consecuenciaDeDestrabar", () => {
  it("el evento de una OT vuelve a moverse solo cuando cambie la fecha de la orden", () => {
    expect(consecuenciaDeDestrabar(evento({ otId: "ot-1" }))).toContain("vuelve a mover este evento solo");
  });
  it("un evento propio no se mueve solo nunca: no se promete", () => {
    expect(consecuenciaDeDestrabar(evento())).toBeNull();
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

describe("horarioParaGuardar: editar el título no toca el horario", () => {
  // 23:00 del 03/11 a 01:00 del 04/11.
  const original = { dia: "2026-11-03", desde: "23:00", hasta: "01:00", diaFin: "2026-11-04" };
  const form = { dia: original.dia, desde: original.desde, hasta: original.hasta };

  it("sin tocar día ni horas no manda ni inicio ni fin", () => {
    // El evento de arriba se acortaría si se mandara reconstruido.
    expect(horarioParaGuardar(original, form)).toEqual({});
  });
  it("tocar sólo la hora de inicio manda sólo el inicio", () => {
    expect(horarioParaGuardar(original, { ...form, desde: "22:00" })).toEqual({ inicio: "2026-11-03T22:00" });
  });
  it("tocar sólo la hora de fin manda sólo el fin, y termina el día en que terminaba", () => {
    expect(horarioParaGuardar(original, { ...form, hasta: "02:00" })).toEqual({ fin: "2026-11-04T02:00" });
  });
  it("cambiar el día corre el fin los mismos días: conserva la duración", () => {
    expect(horarioParaGuardar(original, { ...form, dia: "2026-11-05" })).toEqual({
      inicio: "2026-11-05T23:00",
      fin: "2026-11-06T01:00",
    });
  });
  it("el caso que se perdía: 08:00 a 10:00 del día siguiente, movido un día, sigue durando 26 horas", () => {
    const largo = { dia: "2026-11-03", desde: "08:00", hasta: "10:00", diaFin: "2026-11-04" };
    expect(
      horarioParaGuardar(largo, { dia: "2026-11-10", desde: "08:00", hasta: "10:00" })
    ).toEqual({ inicio: "2026-11-10T08:00", fin: "2026-11-11T10:00" });
  });
  it("mover el día hacia atrás y cruzando un mes corre el fin igual", () => {
    expect(
      horarioParaGuardar(
        { dia: "2026-12-01", desde: "08:00", hasta: "10:00", diaFin: "2026-12-02" },
        { dia: "2026-11-29", desde: "08:00", hasta: "10:00" }
      )
    ).toEqual({ inicio: "2026-11-29T08:00", fin: "2026-11-30T10:00" });
  });
  it("para un evento de un solo día da lo mismo que reconstruirlo sobre el día nuevo", () => {
    expect(
      horarioParaGuardar(
        { dia: "2026-11-03", desde: "09:00", hasta: "10:00", diaFin: "2026-11-03" },
        { dia: "2026-11-04", desde: "09:00", hasta: "10:00" }
      )
    ).toEqual({ inicio: "2026-11-04T09:00", fin: "2026-11-04T10:00" });
  });
  it("un alta manda los dos", () => {
    expect(horarioParaGuardar(null, { dia: "2026-11-03", desde: "09:00", hasta: "10:00" })).toEqual({
      inicio: "2026-11-03T09:00",
      fin: "2026-11-03T10:00",
    });
  });
});

describe("cruzaLaMedianoche", () => {
  it("lo ve en hora de Argentina y no en UTC", () => {
    // 02:00Z a 03:30Z son las 23:00 y las 00:30 de Argentina: cruza, aunque en UTC no.
    expect(cruzaLaMedianoche("2026-11-04T02:00:00Z", "2026-11-04T03:30:00Z")).toBe(true);
    expect(cruzaLaMedianoche("2026-11-03T11:00:00Z", "2026-11-03T12:30:00Z")).toBe(false);
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
