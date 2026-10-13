import { describe, it, expect } from "vitest";
import { faltantesPorGrupo } from "./seguridad";

// Los tres bloques de la planilla real, medidos el 13/10/2026. Los números de
// `stock_actual` y de `stock_seguridad` son los de ese día, y los faltantes que
// se esperan son los que muestra la planilla en sus celdas combinadas.
const DE_LA_PLANILLA = [
  // G19:G25 — bolsones 1,20 + 1,40. Suma 1192 contra 1500 → falta 308.
  { codigo: "00013", grupo_seguridad: "00013", stock_actual: 0, stock_seguridad: 1500 },
  { codigo: "00014", grupo_seguridad: "00013", stock_actual: 322, stock_seguridad: 1500 },
  { codigo: "00015", grupo_seguridad: "00013", stock_actual: 0, stock_seguridad: 1500 },
  { codigo: "00016", grupo_seguridad: "00013", stock_actual: 0, stock_seguridad: 1500 },
  { codigo: "00020", grupo_seguridad: "00013", stock_actual: 120, stock_seguridad: 1500 },
  { codigo: "00021", grupo_seguridad: "00013", stock_actual: 0, stock_seguridad: 1500 },
  { codigo: "00022", grupo_seguridad: "00013", stock_actual: 750, stock_seguridad: 1500 },
  // G26:G27 — los nuevos. Suma 600 contra 500 → sobra, no falta.
  { codigo: "00024", grupo_seguridad: "00024", stock_actual: 0, stock_seguridad: 500 },
  { codigo: "00025", grupo_seguridad: "00024", stock_actual: 600, stock_seguridad: 500 },
  // Una bolsa, que NO está combinada: grupo de uno. 4455 contra 5000 → 545.
  { codigo: "00002", grupo_seguridad: "00002", stock_actual: 4455, stock_seguridad: 5000 },
];

describe("faltantesPorGrupo", () => {
  it("compara contra la suma del grupo y no contra cada artículo", () => {
    const r = faltantesPorGrupo(DE_LA_PLANILLA);
    const bolsones = r.get("00013")!;

    expect(bolsones.stock).toBe(1192);
    expect(bolsones.stock_seguridad).toBe(1500);
    // El número que muestra la planilla en su celda combinada. Antes el SdG
    // decía 1500 para el 00013 —su mínimo contra su stock de cero— y 0 para
    // todos los demás, porque medía cada fila por separado.
    expect(bolsones.faltante).toBe(308);
    expect(bolsones.articulos).toBe(7);
  });

  it("sobrar no es faltar: el faltante nunca es negativo", () => {
    const nuevos = faltantesPorGrupo(DE_LA_PLANILLA).get("00024")!;
    expect(nuevos.stock).toBe(600);
    expect(nuevos.faltante).toBe(0);
  });

  it("un artículo sin combinar es un grupo de uno", () => {
    const bolsa = faltantesPorGrupo(DE_LA_PLANILLA).get("00002")!;
    expect(bolsa.articulos).toBe(1);
    expect(bolsa.faltante).toBe(545);
  });

  it("sin grupo_seguridad se cae a grupo de uno, sin romperse", () => {
    // Pasa entre que esto se despliega y que alguien aprieta "Traer de la
    // planilla": la columna existe pero todavía está en null.
    const r = faltantesPorGrupo([
      { codigo: "00009", grupo_seguridad: null, stock_actual: 303, stock_seguridad: 2000 },
    ]);
    expect(r.get("00009")!.faltante).toBe(1697);
  });

  it("toma el mayor mínimo del grupo, no el de la primera fila que llegue", () => {
    // Si una fila quedó en cero por una lectura vieja, quedarse con ese cero
    // apagaría la alarma sin avisar — y acá eso es no comprar algo que falta.
    const r = faltantesPorGrupo([
      { codigo: "a", grupo_seguridad: "a", stock_actual: 10, stock_seguridad: 0 },
      { codigo: "b", grupo_seguridad: "a", stock_actual: 10, stock_seguridad: 100 },
    ]);
    expect(r.get("a")!.stock_seguridad).toBe(100);
    expect(r.get("a")!.faltante).toBe(80);
  });
});
