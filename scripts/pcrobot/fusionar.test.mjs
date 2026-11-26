import { describe, expect, it } from "vitest";
import { fusionarLineas } from "./fusionar.mjs";

/**
 * Los casos salen de lo que se midió el 25/11/2026 contra las dos puntas
 * reales, no de lo que la función "debería" hacer. El que más importa es el
 * primero: es exactamente lo que había pasado con la balanza.
 */
describe("fusionarLineas", () => {
  it("junta las dos mitades cuando no se pisan, que es el caso de la balanza", () => {
    // Drive tenía del 31/8 al 18/11; el servidor, del 20/11 al 24/11.
    const viejo = "31/8/2026;7:8;21500\r\n18/11/2026;11:15;21000\r\n";
    const nuevo = "20/11/2026;9:57;20720\r\n24/11/2026;11:12;21720\r\n";

    const r = fusionarLineas(viejo, nuevo);

    expect(r.agregadas).toBe(2);
    expect(r.repetidas).toBe(0);
    expect(r.texto).toBe(
      "31/8/2026;7:8;21500\r\n18/11/2026;11:15;21000\r\n20/11/2026;9:57;20720\r\n24/11/2026;11:12;21720\r\n"
    );
  });

  it("no pierde ni una fila de las que ya estaban en Drive", () => {
    const viejo = "a;1\r\nb;2\r\nc;3\r\n";
    const r = fusionarLineas(viejo, "z;9\r\n");
    expect(r.texto.startsWith(viejo)).toBe(true);
  });

  it("no repite la fila que ya está, y la cuenta", () => {
    const r = fusionarLineas("a;1\r\nb;2\r\n", "b;2\r\nc;3\r\n");
    expect(r.agregadas).toBe(1);
    expect(r.repetidas).toBe(1);
    expect(r.texto).toBe("a;1\r\nb;2\r\nc;3\r\n");
  });

  it("avisa que no hay nada que hacer cuando el origen no trae nada nuevo", () => {
    const viejo = "a;1\r\nb;2\r\n";
    const r = fusionarLineas(viejo, "a;1\r\nb;2\r\n");
    expect(r.sinCambios).toBe(true);
    expect(r.agregadas).toBe(0);
    expect(r.texto).toBe(viejo);
  });

  it("ignora las líneas en blanco que el origen intercala", () => {
    // DAT00000010 del servidor trae una línea vacía después de cada fila.
    const r = fusionarLineas("a;1\r\n", "b;2\r\n\r\nc;3\r\n\r\n");
    expect(r.agregadas).toBe(2);
    expect(r.texto).toBe("a;1\r\nb;2\r\nc;3\r\n");
  });

  it("sube el origen tal cual cuando en Drive todavía no hay nada", () => {
    const nuevo = "b;2\r\n\r\nc;3\r\n";
    const r = fusionarLineas("", nuevo);
    expect(r.texto).toBe(nuevo);
    expect(r.agregadas).toBe(2);
  });

  it("cierra el archivo viejo que no termina en corte antes de agregarle", () => {
    const r = fusionarLineas("a;1", "b;2\r\n");
    expect(r.texto).toBe("a;1\r\nb;2\r\n");
  });

  it("no agrega dos veces la fila que el propio origen trae repetida", () => {
    const r = fusionarLineas("a;1\r\n", "b;2\r\nb;2\r\n");
    expect(r.agregadas).toBe(1);
    expect(r.repetidas).toBe(1);
  });
});
