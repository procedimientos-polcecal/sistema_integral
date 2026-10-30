import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import HistorialDeLaOT, {
  type NotaDelHistorial,
} from "@/app/(app)/mantenimiento/ordenes/HistorialDeLaOT";

/**
 * La lista del historial de una OT, dibujada.
 *
 * **No es una plantilla para probar componentes**, y no se lo debería usar como tal: la
 * lógica sigue sacándose a `consultaDeRepuesto.ts` y probándose ahí. Este archivo
 * existe para una sola regla que ningún test de `lib/` puede ver porque vive en el
 * *cableado* de la pantalla: **a qué entradas se les ofrece «Ya llegó»**.
 *
 * La regla es pertenecer a `preguntasAbiertas`, y está bien escrita; el problema es
 * cómo falla cuando se rompe. Cambiarla a «una PREGUNTA que no tiene RESPUESTA» —lo
 * primero que se le ocurre a quien la lee de nuevo— deja toda la suite en verde, y
 * es un error que no avisa: una pregunta superada por un seguimiento tampoco tiene
 * respuesta, así que le ofrece un «Ya llegó» que escribiría una RESPUESTA sobre una
 * pregunta que ya no es la del hilo y no cerraría nada. El hilo sigue abierto en la
 * última y el que lo cerró cree que terminó.
 *
 * Se dibuja con `renderToStaticMarkup` en el entorno node: sin jsdom, sin
 * navegador y sin tocar la configuración de vitest. Sólo se mira el HTML que sale
 * —qué entradas llevan el botón, qué dicen—, no los clics: de esos, lo que importa
 * (qué se manda) lo cubre la ruta.
 */

/*
 * «Ahora» es una fecha lejana a propósito. Si `ahora` no llegara a `haceCuanto`, el
 * texto saldría de leer el reloj de verdad, y con una fecha de hoy el test seguiría
 * pasando durante horas —«hace 3 días» sigue siendo «hace 3 días» hasta que se corre
 * un día entero— y dejaría de caer justo cuando alguien lo prueba. Con ésta, «hace 3
 * días» saldría «hace 9 meses» o más, y cae siempre.
 */
const AHORA = new Date("2026-01-15T15:00:00Z");
const hace = (dias: number) => new Date(AHORA.getTime() - dias * 24 * 3600 * 1000).toISOString();

/** Lo que dibuja el botón: lo que va entre `>` y `<`, así no se confunde con un texto que lo contenga. */
const YA_LLEGO = ">Ya llegó<";
/** El atributo, y no la palabra: las clases de Tailwind (`disabled:opacity-50`) también la llevan. */
const APAGADO = 'disabled=""';

const nota = (p: Partial<NotaDelHistorial> & { id: string }): NotaDelHistorial => ({
  tipo: "JUSTIFICACION", texto: `texto de ${p.id}`, creado_en: hace(1), creado_por: "u1",
  repuesto_id: null, responde_a: null, autor: { nombre: "Ana Pérez" }, ...p,
});
const pregunta = (p: Partial<NotaDelHistorial> & { id: string }) =>
  nota({ tipo: "PREGUNTA", repuesto_id: "r1", ...p });
/** Como la escribe Compras: de otra persona y sin repuesto. */
const respuesta = (p: Partial<NotaDelHistorial> & { id: string }) =>
  nota({ tipo: "RESPUESTA", creado_por: "u2", autor: { nombre: "Facundo Ortiz" }, ...p });

function dibujar(
  notas: NotaDelHistorial[],
  opciones: { estado?: string | null; puedeEditar?: boolean; cerrando?: string | null } = {}
): string {
  return renderToStaticMarkup(
    createElement(HistorialDeLaOT, {
      notas,
      estado: opciones.estado === undefined ? "POR_HACER" : opciones.estado,
      puedeEditar: opciones.puedeEditar ?? true,
      cerrando: opciones.cerrando ?? null,
      onYaLlego: () => {},
      onBorrar: () => {},
      ahora: AHORA,
    })
  );
}

/** Lo que dibuja una entrada, buscada por su texto: de un `<li` al siguiente. */
function entrada(html: string, texto: string): string {
  const bloque = html.split("<li").find((b) => b.includes(texto));
  if (!bloque) throw new Error(`no hay una entrada con «${texto}»`);
  return bloque;
}

const cuantas = (html: string, aguja: string) => html.split(aguja).length - 1;

describe("a qué entradas se les ofrece «Ya llegó»", () => {
  it("a una pregunta abierta: dice hace cuánto, sin respuesta, y ofrece cerrarla", () => {
    const html = dibujar([pregunta({ id: "q1", creado_en: hace(3) })]);
    const q1 = entrada(html, "texto de q1");

    expect(q1).toContain("Preguntado hace 3 días, sin respuesta");
    expect(q1).toContain(YA_LLEGO);
  });

  // Es la rotura que ninguna otra prueba veía. En un hilo, cada seguimiento apunta a
  // la pregunta que estaba abierta, así que las anteriores están superadas: tampoco
  // tienen respuesta, y por eso «no tiene respuesta» no es lo mismo que «está
  // abierta». Con tres en el hilo, sólo la última se ofrece.
  it("a una pregunta superada por un seguimiento no, aunque tampoco tenga respuesta", () => {
    const html = dibujar([
      pregunta({ id: "q3", responde_a: "q2", creado_en: hace(1) }),
      pregunta({ id: "q2", responde_a: "q1", creado_en: hace(2) }),
      pregunta({ id: "q1", creado_en: hace(5) }),
    ]);

    expect(entrada(html, "texto de q3")).toContain(YA_LLEGO);
    expect(entrada(html, "texto de q3")).toContain("sin respuesta");

    for (const superada of ["q2", "q1"]) {
      const bloque = entrada(html, `texto de ${superada}`);
      expect(bloque, superada).not.toContain(YA_LLEGO);
      expect(bloque, superada).not.toContain("sin respuesta");
    }
    expect(cuantas(html, YA_LLEGO)).toBe(1);
  });

  it("a una pregunta contestada no, sea la respuesta de Compras o el «ya llegó» de quien preguntó", () => {
    for (const autor of [{ id: "u2", nombre: "Facundo Ortiz" }, { id: "u1", nombre: "Ana Pérez" }]) {
      const html = dibujar([
        respuesta({ id: "r1", responde_a: "q1", creado_por: autor.id, autor: { nombre: autor.nombre } }),
        pregunta({ id: "q1" }),
      ]);
      expect(cuantas(html, YA_LLEGO), autor.nombre).toBe(0);
      expect(html, autor.nombre).not.toContain("sin respuesta");
    }
  });

  // La respuesta cierra su pregunta, no el hilo: el seguimiento sigue abierto y es el
  // único que se ofrece.
  it("a una pregunta de otro repuesto sí: cada una se cierra por su cuenta", () => {
    const html = dibujar([
      pregunta({ id: "q2", repuesto_id: "r2" }),
      respuesta({ id: "r1", responde_a: "q1" }),
      pregunta({ id: "q1", repuesto_id: "r1" }),
    ]);

    expect(entrada(html, "texto de q2")).toContain(YA_LLEGO);
    expect(entrada(html, "texto de q1")).not.toContain(YA_LLEGO);
    expect(cuantas(html, YA_LLEGO)).toBe(1);
  });

  // Una orden suspendida no espera el repuesto de nadie, así que ahí no hay nada que
  // cerrar. Sin el estado, la pantalla seguiría ofreciendo «Ya llegó» sobre algo
  // que ya está cerrado.
  it("a ninguna, en una orden que ya no espera nada", () => {
    for (const estado of ["SUSPENDIDA", "REALIZADO"]) {
      const html = dibujar([pregunta({ id: "q1" })], { estado });
      expect(cuantas(html, YA_LLEGO), estado).toBe(0);
      expect(html, estado).not.toContain("sin respuesta");
    }
  });

  // `EN_PROCESO` no cierra preguntas: la que ya estaba abierta se puede seguir
  // cerrando, aunque el botón de preguntar no se ofrezca ahí.
  it("a la abierta de una orden en proceso sí", () => {
    expect(cuantas(dibujar([pregunta({ id: "q1" })], { estado: "EN_PROCESO" }), YA_LLEGO)).toBe(1);
  });

  it("a una justificación no, ni a una respuesta", () => {
    const html = dibujar([
      respuesta({ id: "r1", responde_a: "q1" }),
      pregunta({ id: "q1" }),
      nota({ id: "j1" }),
    ]);
    expect(entrada(html, "texto de j1")).not.toContain(YA_LLEGO);
    expect(entrada(html, "texto de r1")).not.toContain(YA_LLEGO);
  });

  it("a una pregunta sin estado de la orden tampoco la esconde", () => {
    expect(cuantas(dibujar([pregunta({ id: "q1" })], { estado: null }), YA_LLEGO)).toBe(1);
  });
});

describe("quién puede cerrar y borrar", () => {
  it("sin permiso de edición se ve que espera, pero no hay botones", () => {
    const html = dibujar([pregunta({ id: "q1" }), nota({ id: "j1" })], { puedeEditar: false });

    expect(html).toContain("sin respuesta");
    expect(cuantas(html, YA_LLEGO)).toBe(0);
    expect(html).not.toContain("Borrar");
  });

  it("con permiso, «Borrar» va en todas y el servidor decide de quién es cada una", () => {
    const html = dibujar([pregunta({ id: "q1" }), respuesta({ id: "r9", responde_a: "x" }), nota({ id: "j1" })]);
    expect(cuantas(html, "Borrar")).toBe(3);
  });

  // Una pregunta se cierra de a una: mientras la anterior viaja, el resto no se puede
  // apretar, y la que viaja lo dice.
  it("mientras una se cierra, ésa lo dice y las demás no se pueden apretar", () => {
    const html = dibujar(
      [pregunta({ id: "q2", repuesto_id: "r2" }), pregunta({ id: "q1", repuesto_id: "r1" })],
      { cerrando: "q1" }
    );

    expect(entrada(html, "texto de q1")).toContain("Cerrando…");
    expect(entrada(html, "texto de q1")).not.toContain(YA_LLEGO);
    expect(entrada(html, "texto de q2")).toContain(APAGADO);
    expect(entrada(html, "texto de q1")).toContain(APAGADO);
  });

  it("sin ninguna cerrándose, ningún botón está apagado", () => {
    const html = dibujar([pregunta({ id: "q1" })]);
    expect(html).not.toContain(APAGADO);
  });
});

describe("las que quedaron sin responder", () => {
  // Cuando sacan el repuesto de la lista, la pregunta se queda con `repuesto_id` en
  // null: ya no espera nada, y el diseño pide que no desaparezca sino que diga qué pasó.
  it("a la que le sacaron el repuesto la rotula, y no ofrece cerrarla", () => {
    const html = dibujar([pregunta({ id: "q1", repuesto_id: null })]);
    const q1 = entrada(html, "texto de q1");

    expect(q1).toContain("Quedó sin responder: se sacó el repuesto de la lista");
    expect(q1).not.toContain(YA_LLEGO);
    expect(q1).not.toContain("sin respuesta");
  });

  it("a la de una orden suspendida la rotula, y dice que es por la orden", () => {
    const html = dibujar([pregunta({ id: "q1" })], { estado: "SUSPENDIDA" });
    expect(entrada(html, "texto de q1")).toContain("Quedó sin responder: la orden ya no espera nada");
  });

  // Marcar las dos diría dos veces lo mismo sobre una sola conversación.
  it("en un hilo que terminó así, sólo la última", () => {
    const html = dibujar([
      pregunta({ id: "q2", responde_a: "q1", repuesto_id: null }),
      pregunta({ id: "q1", repuesto_id: null }),
    ]);

    expect(entrada(html, "texto de q2")).toContain("Quedó sin responder");
    expect(entrada(html, "texto de q1")).not.toContain("Quedó sin responder");
    expect(cuantas(html, "Quedó sin responder")).toBe(1);
  });

  it("no a una abierta, ni a una contestada", () => {
    const html = dibujar([
      respuesta({ id: "r1", responde_a: "q1" }),
      pregunta({ id: "q1", repuesto_id: null }),
      pregunta({ id: "q2", repuesto_id: "r2" }),
    ]);
    expect(html).not.toContain("Quedó sin responder");
  });
});

describe("lo que dice cada entrada", () => {
  it("rotula el tipo de cada una", () => {
    const html = dibujar([
      respuesta({ id: "r1", responde_a: "q1" }),
      pregunta({ id: "q1" }),
      nota({ id: "j1" }),
    ]);

    expect(entrada(html, "texto de r1")).toContain("Respuesta");
    expect(entrada(html, "texto de q1")).toContain("Pregunta a Compras");
    expect(entrada(html, "texto de j1")).toContain("Justificación");
  });

  // Una fila de un tipo que no conocemos se lee como lo que eran todas hasta ahora.
  it("un tipo que no conoce se lee como una justificación", () => {
    const html = dibujar([nota({ id: "x1", tipo: "OTRA" as never })]);
    expect(entrada(html, "texto de x1")).toContain("Justificación");
  });

  it("dice quién la escribió, y hace cuánto", () => {
    const html = dibujar([respuesta({ id: "r1", responde_a: "q1", creado_en: hace(2) })]);
    expect(html).toContain("Facundo Ortiz");
    expect(html).toContain("hace 2 días");
  });

  it("una entrada de un autor borrado dice «—» y no se rompe", () => {
    const html = dibujar([nota({ id: "j1", autor: null, creado_por: null })]);
    expect(entrada(html, "texto de j1")).toContain("—");
  });

  it("conserva los saltos de línea de lo que se escribió", () => {
    expect(dibujar([nota({ id: "j1" })])).toContain("whitespace-pre-wrap");
  });

  it("sin entradas no dibuja nada", () => {
    expect(dibujar([])).toBe("");
  });
});
