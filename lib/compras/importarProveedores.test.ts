import { describe, it, expect } from "vitest";
import {
  decidirImportacion, nucleoDeProveedor, plazoDePago, camposParaGuardar,
  urlParaBajar, MIME_PLANILLA_GOOGLE, type ProveedorDelExcel,
} from "./importarProveedores";

const vacio: ProveedorDelExcel = {
  nombre: "", rubro: null, contacto: null, telefono: null, telefono_alt: null,
  direccion: null, sitio_web: null, notas: null, cuit: null,
  plazo_pago_dias: null, forma_pago: null, condicion_pago: null,
  cbu: null, alias_bancario: null, comentario: null,
};
const fila = (nombre: string, extra: Partial<ProveedorDelExcel> = {}) =>
  ({ ...vacio, nombre, ...extra });
const enBase = (id: string, nombre: string) => ({ id, nombre });

/**
 * Lo que decide si una compra vieja sigue apuntando al proveedor correcto.
 *
 * Insertar un duplicado no rompe nada visible el primer dia: rompe cuando
 * alguien mira cuanto le compramos a Ancoil y le faltan las de "ANCOIL".
 */
describe("a quien le corresponde cada fila del Excel", () => {
  it("mismo nombre: actualiza, no da de alta", () => {
    const r = decidirImportacion([fila("Morini S.R.L.")], [enBase("1", "Morini S.R.L.")]);
    expect(r.actualizar).toHaveLength(1);
    expect(r.actualizar[0].id).toBe("1");
    expect(r.actualizar[0].erraNombre).toBeNull();
    expect(r.insertar).toHaveLength(0);
  });

  it("no le molestan mayusculas ni acentos", () => {
    const r = decidirImportacion([fila("Ferretería Victor")], [enBase("1", "FERRETERIA VICTOR")]);
    expect(r.actualizar).toHaveLength(1);
  });

  it("une el mismo nombre con y sin el sufijo societario", () => {
    // El que tiene las compras colgando es "ANCOIL": hay que actualizarlo, no
    // duplicarlo, y de paso queda con el nombre bueno.
    const r = decidirImportacion([fila("Ancoil S.A.")], [enBase("1", "ANCOIL")]);
    expect(r.actualizar).toHaveLength(1);
    expect(r.actualizar[0].erraNombre).toBe("ANCOIL");
    expect(r.insertar).toHaveLength(0);
  });

  it("un nombre que no esta se da de alta", () => {
    const r = decidirImportacion([fila("Ferretería La Herradura")], [enBase("1", "ANCOIL")]);
    expect(r.insertar).toHaveLength(1);
    expect(r.actualizar).toHaveLength(0);
  });

  it("si se parece a alguno, no decide solo", () => {
    // "Papelera Ciuffo" probablemente sea "CIUFFO", pero "Frenos Norte" no es
    // "NORTE". Como la regla no distingue los dos casos, no elige ninguno.
    const r = decidirImportacion([fila("Papelera Ciuffo")], [enBase("1", "CIUFFO")]);
    expect(r.aRevisar).toHaveLength(1);
    expect(r.actualizar).toHaveLength(0);
    expect(r.insertar).toHaveLength(0);
  });

  it("si se parece a varios, tampoco", () => {
    const r = decidirImportacion(
      [fila("Berner (Shell)")],
      [enBase("1", "SHELL"), enBase("2", "BERNER")]
    );
    expect(r.aRevisar).toHaveLength(1);
    expect(r.aRevisar[0].candidatos).toHaveLength(2);
  });

  it("nada se pierde: cada fila termina en un solo lado", () => {
    const filas = [fila("Ancoil S.A."), fila("Nuevo Proveedor"), fila("Papelera Ciuffo")];
    const r = decidirImportacion(filas, [enBase("1", "ANCOIL"), enBase("2", "CIUFFO")]);
    expect(r.actualizar.length + r.insertar.length + r.aRevisar.length).toBe(filas.length);
  });

  it("correrlo de nuevo sin cambios no da de alta nada", () => {
    // Es lo que hace que se pueda apretar el boton cuantas veces haga falta.
    const filas = [fila("Ancoil S.A."), fila("Morini S.R.L.")];
    const base = [enBase("1", "Ancoil S.A."), enBase("2", "Morini S.R.L.")];
    const r = decidirImportacion(filas, base);
    expect(r.insertar).toHaveLength(0);
    expect(r.actualizar).toHaveLength(2);
  });
});

describe("el nucleo del nombre", () => {
  it("saca los sufijos societarios", () => {
    expect(nucleoDeProveedor("Morini S.R.L.")).toBe("morini");
    expect(nucleoDeProveedor("Cowdin Sa")).toBe("cowdin");
    expect(nucleoDeProveedor("Martinez Escalada S.A")).toBe("martinez escalada");
  });

  it("no se come palabras del nombre", () => {
    expect(nucleoDeProveedor("Casa Blanco")).toBe("casa blanco");
  });
});

describe("el plazo de pago", () => {
  it("lee los dias", () => {
    expect(plazoDePago("30")).toBe(30);
    expect(plazoDePago("60 dias")).toBe(60);
  });

  it("lo que no es un numero de dias queda nulo", () => {
    expect(plazoDePago("CONTADO")).toBeNull();
    expect(plazoDePago(null)).toBeNull();
    expect(plazoDePago("")).toBeNull();
  });
});

describe("que se guarda de cada fila", () => {
  it("un campo vacio en el Excel no borra lo que ya estaba", () => {
    const campos = camposParaGuardar(fila("Ancoil S.A.", { cuit: "30-1-1" }));
    expect(campos).toEqual({ nombre: "Ancoil S.A.", cuit: "30-1-1" });
    expect("telefono" in campos).toBe(false);
  });
});

/**
 * De que forma se baja el archivo. Elegir mal devuelve algo que no se puede
 * parsear, y el error recien aparece al leerlo.
 */
describe("bajar el archivo de Drive", () => {
  it("una planilla de Google se exporta a xlsx", () => {
    const url = urlParaBajar("abc123", MIME_PLANILLA_GOOGLE);
    expect(url).toContain("/export?");
    expect(url).toContain("spreadsheetml.sheet");
  });

  it("un .xlsx subido se baja tal cual", () => {
    const url = urlParaBajar(
      "abc123",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    expect(url).toContain("alt=media");
    expect(url).not.toContain("/export");
  });

  it("cualquier otra cosa tambien se baja directo", () => {
    expect(urlParaBajar("abc123", "application/octet-stream")).toContain("alt=media");
  });
});
