import { describe, it, expect } from "vitest";
import { celdaDeUnRango, etiquetaSegunLaProteccion, type ProteccionDeSheets } from "./sheets";

/**
 * Los casos de acá son protecciones REALES de "PEDIDOS DE COMPRA", copiadas de
 * la respuesta de la API el 11/09/2026. Es la diferencia que trabó al RI 1952:
 * la protección de `P947` y la de `P167` se ven igual desde la app —las dos
 * hacen que Google conteste "You are trying to edit a protected cell"— y son
 * problemas distintos.
 */

const CUENTA = "sheets-reader@mantenimientopp.iam.gserviceaccount.com";

/** La que trabó al RI 1952: creada por el script de la planilla, sin editores. */
const P947: ProteccionDeSheets = {
  description: "Protección automática RI MANTENIMIENTO!P947",
  range: { sheetId: 352154649, startRowIndex: 946, endRowIndex: 947, startColumnIndex: 15, endColumnIndex: 16 },
};

/** Una de las 904 que sí están bien. Google manda los editores porque podemos. */
const P167: ProteccionDeSheets = {
  description: "Protección automática RI MANTENIMIENTO!P167 por APROBADA (NICO)",
  range: { sheetId: 352154649, startRowIndex: 166, endRowIndex: 167, startColumnIndex: 15, endColumnIndex: 16 },
  requestingUserCanEdit: true,
  editors: { users: [CUENTA, "nicolaslenzetti@polcecal.com", "procedimientos@polcecal.com"] },
};

describe("por qué una celda protegida no deja escribir", () => {
  it("la protección que no incluye a la cuenta manda a la planilla, y dice quién", () => {
    const etiqueta = etiquetaSegunLaProteccion([P947, P167], 947, 15, CUENTA);
    expect(etiqueta).toMatch(/no incluye a la cuenta de servicio/);
    expect(etiqueta).toMatch(/dueño de la planilla/);
  });

  /**
   * El caso del 27/08/2026, que costó una tarde: la cuenta estaba en las 946
   * protecciones y el rechazo venía por cuota. El cartel tiene que decir que el
   * permiso NO es el problema, o se vuelve a revisar lo que ya está bien.
   */
  it("si la cuenta figura entre los editores, lo dice en vez de acusar al permiso", () => {
    const etiqueta = etiquetaSegunLaProteccion([P947, P167], 167, 15, CUENTA);
    expect(etiqueta).toMatch(/figura entre sus editores/);
    expect(etiqueta).not.toMatch(/no incluye/);
  });

  it("una celda que ninguna protección toca no se atribuye a un permiso", () => {
    // Misma fila, otra columna: las protecciones automáticas son sólo de la P.
    const etiqueta = etiquetaSegunLaProteccion([P947, P167], 947, 14, CUENTA);
    expect(etiqueta).toMatch(/ninguna protección/);
  });

  /**
   * `requestingUserCanEdit` es lo que distingue los dos casos, porque Google no
   * manda `editors` a quien no puede editar. Si algún día dejara de venir, el
   * respaldo es la lista: mejor el diagnóstico vago que uno falso.
   */
  it("la lista de editores alcanza si no viene requestingUserCanEdit", () => {
    const sinElCampo: ProteccionDeSheets = { ...P167, requestingUserCanEdit: undefined };
    expect(etiquetaSegunLaProteccion([sinElCampo], 167, 15, CUENTA)).toMatch(/figura entre sus editores/);
  });

  it("las de sólo advertencia no frenan nada, así que no son la causa", () => {
    const aviso: ProteccionDeSheets = { ...P947, warningOnly: true };
    expect(etiquetaSegunLaProteccion([aviso], 947, 15, CUENTA)).toMatch(/ninguna protección/);
  });

  it("una hoja entera protegida cubre cualquier celda", () => {
    const hojaEntera: ProteccionDeSheets = { description: "APROB MAXI", range: { sheetId: 123317443 } };
    expect(etiquetaSegunLaProteccion([hojaEntera], 5000, 3, CUENTA)).toMatch(/no incluye a la cuenta/);
  });

  /**
   * Una hoja protegida "menos estos rangos" deja escribir en los agujeros. Sin
   * esto el cartel mandaría a dar un permiso que no falta.
   */
  it("los rangos libres de una hoja protegida no cuentan como protegidos", () => {
    const conAgujero: ProteccionDeSheets = {
      range: { sheetId: 1 },
      unprotectedRanges: [{ sheetId: 1, startColumnIndex: 13, endColumnIndex: 18 }],
    };
    expect(etiquetaSegunLaProteccion([conAgujero], 947, 15, CUENTA)).toMatch(/ninguna protección/);
    expect(etiquetaSegunLaProteccion([conAgujero], 947, 2, CUENTA)).toMatch(/no incluye a la cuenta/);
  });
});

describe("celdaDeUnRango", () => {
  it("saca la hoja y la celda del rango que se le mandó a Google", () => {
    expect(celdaDeUnRango("RI MANTENIMIENTO!P947")).toEqual({
      hoja: "RI MANTENIMIENTO",
      fila: 947,
      columna: 15,
    });
  });

  /** El nombre del master tiene espacios y no viene entrecomillado. */
  it("aguanta un nombre de pestaña con espacios", () => {
    expect(celdaDeUnRango("Requerimientos internos!M1885")?.hoja).toBe("Requerimientos internos");
  });

  it("las columnas de dos letras vuelven bien", () => {
    expect(celdaDeUnRango("RI ALMACÉN!AA10")?.columna).toBe(26);
  });

  it("lo que no es una celda suelta devuelve null, y no una fila 0", () => {
    expect(celdaDeUnRango("RI MANTENIMIENTO!P947:P950")).toBeNull();
    expect(celdaDeUnRango("RI MANTENIMIENTO")).toBeNull();
    expect(celdaDeUnRango("!P947")).toBeNull();
  });
});
