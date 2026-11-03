/**
 * Lo que decide `scripts/revisar-exportaciones.mjs`, con archivos inventados.
 *
 * Vive en `lib/core` y no al lado del script porque vitest recorre `lib`, y
 * porque lo que se prueba es la decisión y no el recorrido del árbol. La
 * corrida de verdad —la que mira el repo entero— es `node
 * scripts/revisar-exportaciones.mjs`.
 */
import { describe, it, expect } from "vitest";
import * as revisor from "@/scripts/revisar-exportaciones.mjs";

type Archivo = { ruta: string; texto: string };
type Hallazgo = { severidad: string; ruta: string; que: string };
type Entrada = { estrategia: string; porque: string };

/*
 * El script es `.mjs` sin tipos, a propósito: es una herramienta y no parte de
 * la app. TypeScript le infiere el tipo del `REGISTRO` real —con sus 45 claves
 * literales— y entonces rechaza cualquier registro inventado, que es justo lo
 * que un test necesita. Se le pone la firma acá, una vez.
 */
const revisarExportaciones = revisor.revisarExportaciones as unknown as (
  archivos: Archivo[], registro: Record<string, Entrada>
) => Hallazgo[];
const quienesEscriben = revisor.quienesEscriben as unknown as (
  archivos: Archivo[], registro: Record<string, Entrada>
) => Set<string>;

/**
 * Arma la línea de import de un archivo inventado, **partida en dos**.
 *
 * No es capricho: `scripts/revisar-arbol-commiteado.mjs` busca `from "…"` con
 * un regex sobre el texto crudo, así que un import de mentira escrito entero
 * acá lo manda a resolver `@/lib/modulo/espejo`, que no existe, y el chequeo
 * que el repo corre antes de cada deploy sale rojo por un fixture. Partida, la
 * cadena se arma igual en tiempo de ejecución —que es cuando el test la
 * necesita— y deja de parecer un import de verdad para quien lee el archivo.
 */
const importa = (nombres: string, modulo: string) =>
  `import { ${nombres} } ` + "from " + `"@/${modulo}";`;

const ESPEJO: Archivo = {
  ruta: "lib/modulo/espejo.ts",
  texto: `
    ${importa("escribirCeldas", "lib/core/sheets")}
    export async function espejarCosa(c) { await escribirCeldas("id", c); }
  `,
};

const REGISTRO_BASE = {
  "lib/modulo/espejo.ts": { estrategia: "delega", porque: "devuelve el resultado" },
};

const rompe = (h: Hallazgo[]) => h.filter((x) => x.severidad === "ROMPE");


describe("revisarExportaciones", () => {
  it("un archivo declarado y en regla no dice nada", () => {
    const ruta: Archivo = {
      ruta: "app/api/modulo/route.ts",
      texto: `
        ${importa("espejarCosa", "lib/modulo/espejo")}
        const r = await espejarCosa(x);
        await admin.update({ sheets_pendiente: r.error });
      `,
    };
    const h = revisarExportaciones([ESPEJO, ruta], {
      ...REGISTRO_BASE,
      "app/api/modulo/route.ts": { estrategia: "cola", porque: "anota" },
    });
    expect(h).toEqual([]);
  });

  it("ATRAPA EL BUG: una ruta nueva que escribe y no declara nada", () => {
    // Éste es el caso entero. El PATCH de OT (26/10/2026) y el de OS eran esto:
    // escribían la planilla por medio de un ayudante, el fallo iba a la
    // pantalla, y nada en el repo lo notaba. Que salga ROMPE acá es lo único
    // que lo vuelve imposible de repetir sin querer.
    const ruta: Archivo = {
      ruta: "app/api/modulo/nueva/route.ts",
      texto: `
        ${importa("espejarCosa", "lib/modulo/espejo")}
        const r = await espejarCosa(x);
        return NextResponse.json({ planilla_error: r.error });
      `,
    };
    const h = rompe(revisarExportaciones([ESPEJO, ruta], REGISTRO_BASE));
    expect(h).toHaveLength(1);
    expect(h[0].ruta).toBe("app/api/modulo/nueva/route.ts");
    expect(h[0].que).toContain("no está declarada");
  });

  it("y también la que llama a la primitiva derecho", () => {
    const suelta: Archivo = {
      ruta: "app/api/otro/route.ts",
      texto: `${importa("escribirCeldas", "lib/core/sheets")} await escribirCeldas("id", []);`,
    };
    const h = rompe(revisarExportaciones([suelta], {}));
    expect(h.map((x) => x.ruta)).toEqual(["app/api/otro/route.ts"]);
  });

  it("un `cola` que dejó de anotar: así se muere una defensa en silencio", () => {
    const ruta: Archivo = {
      ruta: "app/api/modulo/route.ts",
      texto: `
        ${importa("espejarCosa", "lib/modulo/espejo")}
        const r = await espejarCosa(x);
        return NextResponse.json({ planilla_error: r.error });
      `,
    };
    const h = rompe(revisarExportaciones([ESPEJO, ruta], {
      ...REGISTRO_BASE,
      "app/api/modulo/route.ts": { estrategia: "cola", porque: "dice que anota" },
    }));
    expect(h).toHaveLength(1);
    expect(h[0].que).toContain("no nombra ninguna columna de pendiente");
  });

  it("cuenta como anotar nombrar la columna de campos de los avisos", () => {
    // Casi muerde el 29/10/2026: `\bsheets_pendiente\b` no hace borde dentro de
    // `sheets_pendiente_campos` —`_` es carácter de palabra—, así que los dos
    // archivos que sólo nombran esa columna salían como «dice cola y no anota».
    const ruta: Archivo = {
      ruta: "app/api/modulo/route.ts",
      texto: `
        ${importa("espejarCosa", "lib/modulo/espejo")}
        const r = await espejarCosa(x);
        await admin.update({ sheets_pendiente_campos: "ot_asignada" });
      `,
    };
    const h = rompe(revisarExportaciones([ESPEJO, ruta], {
      ...REGISTRO_BASE,
      "app/api/modulo/route.ts": { estrategia: "cola", porque: "anota por campo" },
    }));
    expect(h).toEqual([]);
  });

  it("una entrada sin porqué no alcanza: la excepción hay que explicarla", () => {
    const h = rompe(revisarExportaciones([ESPEJO], {
      "lib/modulo/espejo.ts": { estrategia: "pantalla", porque: "  " },
    }));
    expect(h[0].que).toContain("sin porqué");
  });

  it("una entrada que ya no escribe sale como MIRAR, no como ROMPE", () => {
    const h = revisarExportaciones([{ ruta: "lib/viejo.ts", texto: "export const x = 1;" }], {
      "lib/viejo.ts": { estrategia: "cola", porque: "lo hacía" },
    });
    expect(h).toHaveLength(1);
    expect(h[0].severidad).toBe("MIRAR");
  });
});

describe("quienesEscriben", () => {
  it("no confunde un nombre repetido con una llamada al espejo", () => {
    // `lib/mantenimiento/ordenes.ts` define su propia `fechaParaLaPlanilla`,
    // que se llama igual que la del espejo de Inventario. Marcarlo haría que
    // el chequeo señale archivos que no tienen nada que ver, y un chequeo así
    // se empieza a ignorar.
    const homonimo: Archivo = {
      ruta: "lib/modulo/otro.ts",
      texto: `
        function espejarCosa(x) { return x; }
        export const usar = () => espejarCosa(1);
      `,
    };
    expect([...quienesEscriben([ESPEJO, homonimo], REGISTRO_BASE)]).toEqual([
      "lib/modulo/espejo.ts",
    ]);
  });

  it("no propaga desde un `cola`: ese módulo anota solo y su llamador no se puede olvidar", () => {
    const cola: Archivo = {
      ruta: "lib/modulo/conCola.ts",
      texto: `
        ${importa("escribirCeldas", "lib/core/sheets")}
        export async function exportarCosa(id) {
          await escribirCeldas("id", []);
          await admin.update({ sheets_pendiente: null });
        }
      `,
    };
    const llamador: Archivo = {
      ruta: "app/api/modulo/route.ts",
      texto: `${importa("exportarCosa", "lib/modulo/conCola")} await exportarCosa(1);`,
    };
    const escriben = quienesEscriben([cola, llamador], {
      "lib/modulo/conCola.ts": { estrategia: "cola", porque: "anota ella misma" },
    });
    expect([...escriben]).toEqual(["lib/modulo/conCola.ts"]);
  });
});
