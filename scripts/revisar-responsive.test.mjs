import { describe, expect, it } from "vitest";
import { CALENDARIOS, TABLAS_CON_SCROLL_HEREDADO, revisarResponsive } from "./revisar-responsive.mjs";

/** Un archivo armado a mano: los tests no miran el árbol real, que cambia. */
const archivo = (texto, ruta = "app/(app)/prueba/PruebaClient.tsx") => ({ ruta, texto });

const revisar = (texto, ruta) => revisarResponsive([archivo(texto, ruta)]);

const RUTA_RESUMENES = "app/(app)/produccion/resumenes/ResumenesClient.tsx";

/** Quince líneas de comentario: alejan la tabla más de las 12 que mira el script. */
const relleno = (n) => Array.from({ length: n }, (_, i) => `      {/* relleno ${i} */}`).join("\n");

const tablaVacia = `        <table className="w-full text-sm" />`;

/** El componente de resúmenes: pone el scroll una vez y sus hijos van adentro. */
const ENVOLTORIO = [
  "function Envoltorio({ children }) {",
  '  return <div className="overflow-hidden card">',
  '    <div className="overflow-x-auto">{children}</div>',
  "  </div>;",
  "}",
].join("\n");

/** La pantalla con `tablas` tablas, cada una lejos del contenedor de arriba. */
const pantallaConTablas = (tablas) =>
  [ENVOLTORIO, ...Array.from({ length: tablas }, () => `${relleno(15)}\n${tablaVacia}`)].join("\n");

describe("revisarResponsive", () => {
  it("una tabla sin contenedor con scroll sale como MIRAR", () => {
    const hallazgos = revisar(`
      <div className="card">
        <table className="w-full">
          <tbody />
        </table>
      </div>
    `);
    expect(hallazgos).toHaveLength(1);
    expect(hallazgos[0].severidad).toBe("MIRAR");
    expect(hallazgos[0].linea).toBe(3);
  });

  it("una tabla con overflow-x-auto arriba no sale", () => {
    // El contenedor puede estar varias líneas antes de la tabla (hasta 12).
    const relleno = Array.from({ length: 10 }, (_, i) => `        {/* línea ${i} */}`).join("\n");
    const hallazgos = revisar(
      `<div className="overflow-x-auto">\n${relleno}\n        <table className="w-full" />`
    );
    expect(hallazgos).toEqual([]);
  });

  it("un overflow-x-auto demasiado lejos ya no cubre la tabla", () => {
    const relleno = Array.from({ length: 20 }, (_, i) => `{/* línea ${i} */}`).join("\n");
    const hallazgos = revisar(
      `<div className="overflow-x-auto">\n${relleno}\n<table className="w-full" />`
    );
    expect(hallazgos.map((h) => h.severidad)).toEqual(["MIRAR"]);
  });

  it("grid-cols-3 sin breakpoint sale como APRETADO", () => {
    const hallazgos = revisar(`<div className="grid grid-cols-3 gap-3">`);
    expect(hallazgos).toHaveLength(1);
    expect(hallazgos[0].severidad).toBe("APRETADO");
    expect(hallazgos[0].linea).toBe(1);
  });

  it("sm:grid-cols-3 no sale", () => {
    expect(revisar(`<div className="grid grid-cols-1 sm:grid-cols-3 gap-3">`)).toEqual([]);
  });

  it("grid-cols-12 sale como ROMPE", () => {
    const hallazgos = revisar(`<div className="grid grid-cols-12 gap-2">`);
    expect(hallazgos).toHaveLength(1);
    expect(hallazgos[0].severidad).toBe("ROMPE");
  });

  it("grid-cols-2 no sale", () => {
    // 165 px por columna entran de sobra.
    expect(revisar(`<div className="grid grid-cols-2 gap-3">`)).toEqual([]);
  });

  it("w-[400px] sale como ROMPE y w-[300px] no", () => {
    // El corte es 343: 375 del teléfono menos los 32 de padding del layout.
    const roto = revisar(`<div className="w-[400px]">`);
    expect(roto).toHaveLength(1);
    expect(roto[0].severidad).toBe("ROMPE");
    expect(revisar(`<div className="w-[300px]">`)).toEqual([]);
  });

  it("w-[400px] con prefijo de breakpoint no sale, ni max-w-[400px]", () => {
    expect(revisar(`<div className="sm:w-[400px] max-w-[400px]">`)).toEqual([]);
  });

  it("min-w-[480px] sale como ROMPE y min-w-[220px] no", () => {
    // El cuarto patrón del spec. Un `min-width` mayor que el ancho útil es peor
    // que un `width`: la caja no se puede achicar, así que estira la página.
    const roto = revisar(`<div className="min-w-[480px]">`);
    expect(roto).toHaveLength(1);
    expect(roto[0].severidad).toBe("ROMPE");
    expect(roto[0].que).toContain("min-w-[480px]");
    // El más ancho de los cinco que hay hoy en el árbol.
    expect(revisar(`<div className="min-w-[220px]">`)).toEqual([]);
  });

  it("min-w-[480px] se cuenta una sola vez, no también como w-[480px]", () => {
    // Las dos regex podrían pisarse: la de `w-` descarta `min-w-` porque el
    // lookbehind rechaza el `-` que la precede, y es lo que hay que conservar.
    expect(revisar(`<div className="min-w-[480px]">`)).toHaveLength(1);
  });

  it("min-w-[480px] con prefijo de breakpoint no sale, ni en rem", () => {
    // `sm:` lo excluye el mismo lookbehind; `rem` no se convierte a propósito,
    // porque el script mira texto y no mide.
    expect(revisar(`<div className="sm:min-w-[480px] min-w-[16rem]">`)).toEqual([]);
  });

  it("los calendarios de la lista de excepciones no salen", () => {
    // Las cinco entradas reales: un calendario del mes tiene siete columnas por
    // definición, y 49 px por celda es lo que mide un día en cualquier teléfono.
    const rutas = [
      ["app/(app)/remises/semana/SemanaClient.tsx", 1],
      ["app/(app)/cantera/destape/DestapeClient.tsx", 2],
      ["app/(app)/trituracion/partes/PartesClient.tsx", 2],
    ];
    let total = 0;
    for (const [ruta, veces] of rutas) {
      const texto = Array.from({ length: veces }, () => `<div className="grid grid-cols-7 gap-1">`).join("\n");
      expect(revisar(texto, ruta)).toEqual([]);
      total += veces;
    }
    expect(total).toBe(5);
    expect(CALENDARIOS.reduce((suma, c) => suma + c.cantidad, 0)).toBe(5);
  });

  it("la misma grilla de 7 columnas en cualquier otra pantalla sí sale", () => {
    const hallazgos = revisar(`<div className="grid grid-cols-7 gap-1">`);
    expect(hallazgos.map((h) => h.severidad)).toEqual(["APRETADO"]);
  });

  it("una grilla de 7 de más en un archivo con calendario no queda tapada", () => {
    // La excepción cuenta ocurrencias: un tercer grid-cols-7 en DestapeClient
    // no es el calendario, y no tiene por qué heredar el permiso.
    const texto = Array.from({ length: 3 }, () => `<div className="grid grid-cols-7">`).join("\n");
    const hallazgos = revisar(texto, "app/(app)/cantera/destape/DestapeClient.tsx");
    expect(hallazgos).toHaveLength(1);
    expect(hallazgos[0].linea).toBe(3);
  });

  it("una pantalla de imprimir no sale", () => {
    // Se imprime en A4: el ancho del teléfono no le corresponde.
    const texto = `<table className="w-full"><div className="grid grid-cols-12 w-[900px]">`;
    expect(revisar(texto, "app/(app)/rrhh/imprimir/[id]/page.tsx")).toEqual([]);
    expect(revisar(texto, "app\\(app)\\rrhh\\imprimir\\[id]\\page.tsx")).toEqual([]);
  });

  it("las tres tablas de /produccion/resumenes no salen: ya tienen scroll heredado", () => {
    // Están a 15 líneas del overflow-x-auto de Envoltorio, así que el script no lo
    // ve. Es el caso real que motivó la lista de excepciones.
    expect(revisar(pantallaConTablas(3), RUTA_RESUMENES)).toEqual([]);
  });

  it("una cuarta tabla sin contenedor en esa pantalla sí sale", () => {
    // La excepción cuenta tres: la cuarta no tiene a qué acogerse.
    const hallazgos = revisar(pantallaConTablas(4), RUTA_RESUMENES);
    expect(hallazgos.map((h) => h.severidad)).toEqual(["MIRAR"]);
  });

  it("la excepción es por archivo: las mismas tres tablas en otra pantalla sí salen", () => {
    const hallazgos = revisar(pantallaConTablas(3));
    expect(hallazgos.map((h) => h.severidad)).toEqual(["MIRAR", "MIRAR", "MIRAR"]);
  });

  it("una tabla que sí tiene scroll no gasta la excepción", () => {
    // La primera va bajo un overflow-x-auto propio: no se cuenta. Quedan cuatro
    // sin contenedor y sólo tres se perdonan, así que sale una.
    const conScroll = `<div className="overflow-x-auto">\n${tablaVacia}`;
    const texto = [
      conScroll,
      ...Array.from({ length: 4 }, () => `${relleno(15)}\n${tablaVacia}`),
    ].join("\n");
    const hallazgos = revisar(texto, RUTA_RESUMENES);
    expect(hallazgos.map((h) => h.severidad)).toEqual(["MIRAR"]);
  });

  it("la lista de excepciones de tablas tiene las tres de resúmenes", () => {
    expect(TABLAS_CON_SCROLL_HEREDADO).toEqual([{ ruta: RUTA_RESUMENES, cantidad: 3 }]);
  });
});
