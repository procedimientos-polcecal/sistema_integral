import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import {
  selectsDeLasNotas, loQueLeFalta, NO_VA_LITERAL,
  COLUMNAS_DE_LA_CONVERSACION,
} from "./selectsDeLasNotas";

/**
 * Dos cosas: que el lector del texto lea bien, y la pasada de verdad sobre el repo.
 *
 * La segunda es la que reemplaza a las listas de columnas que hasta el 31/10/2026
 * cada test de ruta mantenía a mano —y a la que le faltó `creado_en`—. El porqué
 * está en el encabezado de `selectsDeLasNotas.ts`.
 */

const TODAS = [...COLUMNAS_DE_LA_CONVERSACION];

/** Una cadena como la escribe una ruta, para probar el lector sin tocar el disco. */
const cadena = (columnas: string, extra = "") => `
  const { data } = await admin
    .from("ordenes_trabajo_notas")
    .select("${columnas}")${extra};
`;

describe("leer los select del texto", () => {
  it("saca las columnas, la línea y si está acotado a una orden", () => {
    const [s] = selectsDeLasNotas("x.ts", cadena("id, tipo", '\n    .eq("orden_id", id)'));

    expect(s.columnas).toEqual(["id", "tipo"]);
    expect(s.linea).toBe(3);
    expect(s.acotadoAUnaOrden).toBe(true);
    expect(s.esInsert).toBe(false);
  });

  // Un embed lleva comas adentro del paréntesis y no son columnas.
  it("un embed no se parte en pedazos", () => {
    const [s] = selectsDeLasNotas("x.ts", cadena("id, tipo, autor:usuarios(nombre)"));
    expect(s.columnas).toEqual(["id", "tipo", "autor:usuarios(nombre)"]);
  });

  /*
   * Dos consultas hermanas de un `Promise.all` comparten el `;` final. Sin cortar en
   * el `.from(` siguiente, el `.eq("orden_id")` de la de al lado haría pasar por
   * acotada a una que no lo está.
   */
  it("no se lleva puesta la consulta de al lado", () => {
    const [s] = selectsDeLasNotas("x.ts", `
      await Promise.all([
        admin.from("ordenes_trabajo_notas").select("id, tipo"),
        admin.from("ordenes_trabajo_repuestos").select("id").eq("orden_id", id),
      ]);
    `);

    expect(s.columnas).toEqual(["id", "tipo"]);
    expect(s.acotadoAUnaOrden).toBe(false);
  });

  it("una cadena sin select no se reporta", () => {
    const fuente = `await admin.from("ordenes_trabajo_notas").delete().eq("id", n);`;
    expect(selectsDeLasNotas("x.ts", fuente)).toEqual([]);
  });

  it("encuentra todas las cadenas del archivo", () => {
    const fuente = cadena("id, tipo") + cadena("id, texto");
    expect(selectsDeLasNotas("x.ts", fuente).map((s) => s.columnas)).toEqual([
      ["id", "tipo"], ["id", "texto"],
    ]);
  });
});

describe("qué le falta a un select", () => {
  const leer = (columnas: string, extra = "") =>
    loQueLeFalta(selectsDeLasNotas("x.ts", cadena(columnas, extra))[0]);

  it("el que trae todo lo de la conversación, y está acotado, pasa", () => {
    expect(leer(`id, ${TODAS.join(", ")}`, '\n    .eq("orden_id", id)')).toEqual([]);
  });

  // La que se escapó: con `tipo` presente, faltar `creado_en` tiene que doler.
  for (const columna of TODAS) {
    it(`sin ${columna} no pasa`, () => {
      const resto = TODAS.filter((c) => c !== columna);
      // Queda al menos un disparador, que es lo que hace que la regla aplique.
      expect(leer(`id, ${resto.join(", ")}`, '\n    .eq("orden_id", id)')).toContain(columna);
    });
  }

  it("si cruza órdenes y no trae orden_id, no pasa", () => {
    expect(leer(`id, ${TODAS.join(", ")}`)).toEqual(["orden_id"]);
  });

  it("un insert no necesita orden_id: la fila la escribe la ruta", () => {
    const insert = selectsDeLasNotas(
      "x.ts",
      `await admin.from("ordenes_trabajo_notas").insert({ orden_id: id }).select("${TODAS.join(", ")}").single();`
    )[0];
    expect(loQueLeFalta(insert)).toEqual([]);
  });

  /*
   * Los dos usos legítimos que no leen la conversación. Exigirles las cinco columnas
   * dejaría el chequeo rojo desde el primer día, y un chequeo siempre rojo no lo
   * mira nadie.
   */
  it("el select que no nombra la conversación no se le exige nada", () => {
    expect(leer("id")).toEqual([]);
    expect(leer("id, texto, creado_en", '\n    .eq("orden_id", id)')).toEqual([]);
  });

  it("un select(*) trae todo y pasa", () => {
    expect(leer("*")).toEqual([]);
  });

  it("un select que no va literal se reporta", () => {
    const fuente = `await admin.from("ordenes_trabajo_notas").select(COLUMNAS).eq("orden_id", id);`;
    expect(loQueLeFalta(selectsDeLasNotas("x.ts", fuente)[0])).toEqual([NO_VA_LITERAL]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

const RAIZ = join(import.meta.dirname, "..", "..");
/** Dónde vive el código que habla con la base. Los tests no cuentan. */
const CARPETAS = ["app", "lib", "components", "scripts"];

function archivosDeCodigo(carpeta: string): string[] {
  const salida: string[] = [];
  for (const entrada of readdirSync(carpeta, { withFileTypes: true })) {
    const ruta = join(carpeta, entrada.name);
    if (entrada.isDirectory()) {
      // `.claude/worktrees/` son copias del repo: mirarlas sería revisar el trabajo
      // a medio hacer de otra sesión, igual que ya se excluyen de vitest.
      if (entrada.name === "node_modules" || entrada.name.startsWith(".")) continue;
      salida.push(...archivosDeCodigo(ruta));
    } else if (/\.(ts|tsx|mts|mjs)$/.test(entrada.name) && !/\.test\.\w+$/.test(entrada.name)) {
      salida.push(ruta);
    }
  }
  return salida;
}

const encontrados = CARPETAS.flatMap((c) => archivosDeCodigo(join(RAIZ, c)))
  .flatMap((ruta) =>
    selectsDeLasNotas(relative(RAIZ, ruta).replace(/\\/g, "/"), readFileSync(ruta, "utf8"))
  );

describe("todos los select sobre ordenes_trabajo_notas del repo", () => {
  /*
   * Un barrido que no encuentra nada pasa igual, y eso lo vuelve inútil sin avisar
   * —un `include` mal escrito, una carpeta que se movió—. Las dos rutas que hoy leen
   * la conversación tienen que aparecer.
   */
  it("el barrido efectivamente llega a las rutas que leen notas", () => {
    const archivos = new Set(encontrados.map((s) => s.archivo));

    expect(archivos).toContain("app/api/mantenimiento/ordenes/[id]/notas/route.ts");
    expect(archivos).toContain("app/api/compras/consultas/route.ts");
    expect(encontrados.length).toBeGreaterThanOrEqual(8);
  });

  it("ninguno se olvida una columna de la conversación", () => {
    const rotos = encontrados
      .map((s) => ({ s, faltan: loQueLeFalta(s) }))
      .filter(({ faltan }) => faltan.length > 0)
      .map(({ s, faltan }) => `${s.archivo}:${s.linea} le falta ${faltan.join(", ")}`);

    expect(rotos).toEqual([]);
  });
});
