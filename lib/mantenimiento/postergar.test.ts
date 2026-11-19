import { describe, it, expect } from "vitest";
import {
  laNuevaFecha, laRazonQueSeGuarda, loQueFaltaParaPostergar, MAXIMO_DE_DIAS,
  porQueElEstadoNoDejaPostergar,
} from "./postergar";
import { porQueNoSePuedeMover } from "./moverLaOT";

describe("laNuevaFecha", () => {
  it("corre la fecha los días que se le pidan", () => {
    expect(laNuevaFecha("2026-11-02", 3)).toBe("2026-11-05");
  });

  it("cruza el fin de mes sin despeinarse", () => {
    expect(laNuevaFecha("2026-10-30", 3)).toBe("2026-11-02");
  });

  /**
   * Sin fecha de la que partir no hay a dónde correrla. Devuelve `null` y la
   * ruta lo rechaza: una OT sin fecha de ejecución no se posterga, se le pone
   * una.
   */
  it("sin fecha no hay fecha nueva", () => {
    expect(laNuevaFecha(null, 3)).toBeNull();
    expect(laNuevaFecha("", 3)).toBeNull();
  });
});

describe("loQueFaltaParaPostergar", () => {
  const completo = { razon: "falta_repuesto", dias: 3, justificacion: "No llegó el retén." };

  it("con todo cargado no falta nada", () => {
    expect(loQueFaltaParaPostergar(completo)).toEqual([]);
  });

  /**
   * Los problemas se informan **juntos**, no de a uno. Es la vara de
   * `lib/core/validar.ts`: quien lo lee quiere saber qué hay que arreglar, no
   * descubrirlo de a una corrida por vez.
   */
  it("informa todo lo que falta de una vez", () => {
    expect(loQueFaltaParaPostergar({ razon: "", dias: 0, justificacion: "  " }))
      .toEqual(["la razón", "cuántos días", "la justificación"]);
  });

  it("la justificación es obligatoria, y en blanco no cuenta", () => {
    expect(loQueFaltaParaPostergar({ ...completo, justificacion: "   " }))
      .toEqual(["la justificación"]);
  });

  it("los días tienen que ser un entero positivo", () => {
    for (const dias of [0, -3, 1.5, NaN]) {
      expect(loQueFaltaParaPostergar({ ...completo, dias })).toEqual(["cuántos días"]);
    }
  });

  /**
   * Un tope, y no por capricho: postergar es escribir en la planilla que mira
   * la planta. Un dedo de más en el campo de días —300 en vez de 3— manda la
   * orden a 2027 y eso no se deshace desde el sistema, porque la fecha que
   * quedó en «Altas del sistema» hay que volver a escribirla.
   */
  it("no acepta una cantidad de días absurda", () => {
    expect(loQueFaltaParaPostergar({ ...completo, dias: MAXIMO_DE_DIAS + 1 }))
      .toEqual(["cuántos días"]);
    expect(loQueFaltaParaPostergar({ ...completo, dias: MAXIMO_DE_DIAS })).toEqual([]);
  });
});

describe("laRazonQueSeGuarda", () => {
  // La razón y los días vienen puestos desde la configuración, que llega
  // después de montar el modal: por eso el borrador usa `null` para decir
  // «todavía no lo tocó nadie» y el valor por omisión se deriva al pintar.
  it("elegir la razón que ya estaba mostrada no cuenta como tocar nada", () => {
    expect(laRazonQueSeGuarda("FALTA_REPUESTO", "FALTA_REPUESTO")).toBeNull();
  });

  it("elegir otra sí se guarda", () => {
    expect(laRazonQueSeGuarda("FALTA_PERSONAL", "FALTA_REPUESTO")).toBe("FALTA_PERSONAL");
  });

  it("sin configuración todavía, cualquier elección cuenta", () => {
    expect(laRazonQueSeGuarda("FALTA_REPUESTO", undefined)).toBe("FALTA_REPUESTO");
  });
});

/**
 * La regla que faltaba del lado del servidor hasta el 19/11/2026: la ruta traía
 * `estado` en su `select` y no lo miraba, así que lo único que impedía
 * postergar una orden ya hecha eran las dos pantallas.
 */
describe("porQueElEstadoNoDejaPostergar", () => {
  it("una realizada no se posterga, y lo dice", () => {
    expect(porQueElEstadoNoDejaPostergar("REALIZADO")).toContain("ya está realizada");
  });

  it("no le importan los espacios ni las mayúsculas, que la planilla mezcla", () => {
    expect(porQueElEstadoNoDejaPostergar("  realizado ")).not.toBeNull();
  });

  it("todo lo que sigue abierto se posterga", () => {
    for (const estado of ["POR_HACER", "ATRASADO", "EN_PROCESO", "SUSPENDIDA"]) {
      expect(porQueElEstadoNoDejaPostergar(estado)).toBeNull();
    }
  });

  /**
   * Un texto que nadie reconoce no prueba que la orden esté hecha, y en esa
   * columna la planilla escribe lo que quiere.
   */
  it("un estado desconocido o vacío no traba", () => {
    expect(porQueElEstadoNoDejaPostergar("LO_QUE_SEA")).toBeNull();
    expect(porQueElEstadoNoDejaPostergar(null)).toBeNull();
    expect(porQueElEstadoNoDejaPostergar(undefined)).toBeNull();
    expect(porQueElEstadoNoDejaPostergar("")).toBeNull();
  });

  /**
   * Las dos puntas no dicen lo mismo y este test lo FIJA en vez de taparlo: el
   * servidor arbitra sólo `REALIZADO`, donde las dos coinciden, y la `SUSPENDIDA`
   * queda como una decisión de la pantalla del calendario. El día que alguien
   * unifique, este test es el que tiene que cambiar a propósito.
   */
  it("la SUSPENDIDA la frena el calendario y no el servidor, y es deliberado", () => {
    const suspendida = { app_created: true, estado: "SUSPENDIDA", fecha_ejecucion: "2026-11-10" };
    expect(porQueNoSePuedeMover(suspendida)).toContain("cerrada");
    expect(porQueElEstadoNoDejaPostergar("SUSPENDIDA")).toBeNull();
  });
});
