/**
 * Lo que la hoja impresa deja en el papel.
 *
 * **Esto es un test de pantalla y no es una plantilla.** La vara del repo es
 * que una regla se saca a `lib/` y se prueba ahí; lo que se prueba acá no se
 * puede sacar, porque *es* lo que se dibuja: que la leyenda llegue antes que
 * las marcas que explica, que un nombre del taller **no** salga impreso, que
 * una banda que todavía no llegó lo diga en vez de faltar en silencio, y que
 * la rotación que se imprime sea la de esa semana. Son cuatro cosas que sólo
 * existen en el HTML que sale, y las cuatro se pierden sin aviso: ninguna
 * rompe nada, y el síntoma aparece recién en una hoja colgada en la pared,
 * donde ya no hay forma de notarlo.
 *
 * Se dibuja con `renderToStaticMarkup` en el entorno node, sin jsdom y sin
 * tocar la configuración de vitest, como `historialDeLaOT.test.ts`. Sólo se
 * mira el HTML; nunca los clics.
 */
import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { DiaDelCalendario } from "./calendarioDeOT";
import { SIN_FILTROS } from "./filtrosDelCalendario";
import type { PedidoDeHoja } from "./urlDeImpresion";
import type { FranjaDeLaSemana } from "./rotacionDeLaSemana";
import ImprimirClient, {
  tituloDeLaHoja,
} from "@/app/(app)/mantenimiento/ordenes/imprimir/ImprimirClient";

type Orden = DiaDelCalendario["ordenes"][number];

function orden(p: Partial<Orden> & { ot_number: number }): Orden {
  return {
    id: `id-${p.ot_number}`,
    especialidad: "MECÁNICO",
    tipo: "CORRECTIVO",
    quien: "INTERNO",
    descripcion: "Cambio de correas",
    sector_raw: null,
    equipo_raw: "PY-A1-04",
    arrastre: false,
    app_created: null,
    estado: "POR_HACER",
    fecha_ejecucion: null,
    atrasada: false,
    diasDeAtraso: null,
    operario_1: null,
    operario_2: null,
    operario_3: null,
    ...p,
  };
}

function dia(fecha: string, ordenes: Orden[]): DiaDelCalendario {
  return { dia: fecha, ordenes, gente: { sabemos: false } };
}

function franja(lunes: string, nombre: string): FranjaDeLaSemana {
  return {
    lunes,
    porTurno: {
      "4-12": [{ empleadoId: "e1", nombre, oficio: "mecanico", diasQueFalta: [] }],
      "8-16": [],
      "12-20": [],
    },
    sinTurno: [],
    diasConPisada: 0,
  };
}

const SEMANA: PedidoDeHoja = {
  periodo: "semana",
  desde: "2026-11-16",
  hasta: "2026-11-22",
  filtros: SIN_FILTROS,
  taller: true,
};

const UN_DIA = [dia("2026-11-16", [orden({ ot_number: 3098 })])];

function dibujar(props: Parameters<typeof ImprimirClient>[0]): string {
  return renderToStaticMarkup(createElement(ImprimirClient, props));
}

describe("la leyenda", () => {
  it("se imprime ANTES de las marcas que explica", () => {
    const html = dibujar({ pedido: SEMANA, dias: UN_DIA, hoy: "2026-11-16", conFranja: false });
    // «Mecánico» es la leyenda; «3098» es la primera orden de la tabla.
    expect(html).toContain("Mecánico");
    expect(html).toContain("3098");
    expect(html.indexOf("Mecánico")).toBeLessThan(html.indexOf("3098"));
  });
});

describe("la franja del taller en papel", () => {
  it("NO imprime los nombres de la gente del taller", () => {
    const html = dibujar({
      pedido: SEMANA, dias: UN_DIA, hoy: "2026-11-16", conFranja: true,
      franjasDePrueba: [franja("2026-11-16", "ECHEVERRIA")],
    });
    expect(html).not.toContain("ECHEVERRIA");
    // Pero sí dice cuántos hay en cada turno, que es para lo que sirve.
    expect(html).toContain("4-12");
  });

  it("dice que la rotación todavía no llegó, en vez de no dibujar nada", () => {
    const html = dibujar({ pedido: SEMANA, dias: UN_DIA, hoy: "2026-11-16", conFranja: true });
    expect(html).toContain("Trayendo la rotación del taller");
  });

  it("toma la franja por su lunes y no por su posición", () => {
    const html = dibujar({
      pedido: SEMANA, dias: UN_DIA, hoy: "2026-11-16", conFranja: true,
      // La primera del arreglo es de OTRA semana: tomarla por posición
      // imprimiría una rotación que no es la de esta hoja.
      franjasDePrueba: [franja("2026-11-09", "DE_OTRA"), franja("2026-11-16", "DE_ESTA")],
    });
    expect(html).not.toContain("Trayendo la rotación del taller");
    expect(html).not.toContain("DE_OTRA");
  });

  it("no dibuja la rotación en la hoja de un día", () => {
    const html = dibujar({
      pedido: { ...SEMANA, periodo: "dia", hasta: "2026-11-16" },
      dias: UN_DIA, hoy: "2026-11-16", conFranja: true,
    });
    expect(html).not.toContain("Trayendo la rotación del taller");
    expect(html).not.toContain("4-12");
  });
});

describe("tituloDeLaHoja", () => {
  it("usa las etiquetas del catálogo y no el texto crudo de la planilla", () => {
    expect(
      tituloDeLaHoja({
        ...SEMANA,
        filtros: { especialidad: "ELÉCTRICO", tipo: "PROGRAMADO", quien: "CONTRATADO" },
      })
    ).toBe("Eléctrico · Programado · Contratado · semana del 16/11/2026 al 22/11/2026");
  });

  it("un valor que el catálogo no conoce se imprime tal cual, sin romper", () => {
    expect(
      tituloDeLaHoja({ ...SEMANA, filtros: { especialidad: "", tipo: "LO_QUE_SEA", quien: "" } })
    ).toContain("LO_QUE_SEA");
  });
});
