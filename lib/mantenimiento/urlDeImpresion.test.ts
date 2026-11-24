import { describe, it, expect } from "vitest";
import { SIN_FILTROS, type Filtros } from "./filtrosDelCalendario";
import { armarUrlDeImpresion, leerParametros } from "./urlDeImpresion";
import { DIAS_DEL_RANGO_MAS_LARGO } from "./rangoDelCalendario";

function filtros(p: Partial<Filtros> = {}): Filtros {
  return { ...SIN_FILTROS, ...p };
}

function paramsDe(url: string): URLSearchParams {
  return new URLSearchParams(url.slice(url.indexOf("?") + 1));
}

describe("armarUrlDeImpresion", () => {
  it("escribe periodo, desde y hasta", () => {
    const url = armarUrlDeImpresion({
      periodo: "mes", desde: "2026-11-01", hasta: "2026-11-30",
      filtros: SIN_FILTROS, taller: false,
    });
    expect(url.startsWith("/mantenimiento/ordenes/imprimir?")).toBe(true);
    const p = paramsDe(url);
    expect(p.get("periodo")).toBe("mes");
    expect(p.get("desde")).toBe("2026-11-01");
    expect(p.get("hasta")).toBe("2026-11-30");
  });

  it("no escribe los filtros vacíos", () => {
    const url = armarUrlDeImpresion({
      periodo: "dia", desde: "2026-11-10", hasta: "2026-11-10",
      filtros: SIN_FILTROS, taller: false,
    });
    const p = paramsDe(url);
    expect(p.has("especialidad")).toBe(false);
    expect(p.has("tipo")).toBe(false);
    expect(p.has("quien")).toBe(false);
    expect(p.has("taller")).toBe(false);
  });

  it("escribe especialidad, tipo y quien cuando están puestos", () => {
    const url = armarUrlDeImpresion({
      periodo: "semana", desde: "2026-11-09", hasta: "2026-11-15",
      filtros: filtros({ especialidad: "ELÉCTRICO", tipo: "CORRECTIVO", quien: "TALLER" }),
      taller: false,
    });
    const p = paramsDe(url);
    expect(p.get("especialidad")).toBe("ELÉCTRICO");
    expect(p.get("tipo")).toBe("CORRECTIVO");
    expect(p.get("quien")).toBe("TALLER");
  });

  it("escribe taller=1 sólo cuando taller es true", () => {
    const con = armarUrlDeImpresion({
      periodo: "mes", desde: "2026-11-01", hasta: "2026-11-30",
      filtros: SIN_FILTROS, taller: true,
    });
    expect(paramsDe(con).get("taller")).toBe("1");
  });
});

describe("leerParametros", () => {
  it("vuelve a armar lo mismo que armarUrlDeImpresion escribió (ida y vuelta)", () => {
    const original = {
      periodo: "semana" as const, desde: "2026-11-09", hasta: "2026-11-15",
      filtros: filtros({ especialidad: "LUBRICACIÓN", quien: "CONTRATISTA" }),
      taller: true,
    };
    const leido = leerParametros(paramsDe(armarUrlDeImpresion(original)));
    expect(leido).toEqual(original);
  });

  it("da error si falta desde o hasta", () => {
    expect(leerParametros(new URLSearchParams("periodo=mes&hasta=2026-11-30")))
      .toEqual({ error: expect.stringContaining("AAAA-MM-DD") });
    expect(leerParametros(new URLSearchParams("periodo=mes&desde=2026-11-01")))
      .toEqual({ error: expect.stringContaining("AAAA-MM-DD") });
  });

  it("da error si desde o hasta no son AAAA-MM-DD", () => {
    const r = leerParametros(new URLSearchParams("periodo=mes&desde=01/11/2026&hasta=2026-11-30"));
    expect(r).toEqual({ error: expect.stringContaining("AAAA-MM-DD") });
  });

  it("da error si desde es posterior a hasta", () => {
    const r = leerParametros(new URLSearchParams("periodo=mes&desde=2026-11-30&hasta=2026-11-01"));
    expect(r).toEqual({ error: expect.stringContaining("posterior") });
  });

  it("da error con un rango de 64 días, nombrando el máximo", () => {
    // 2026-11-01 … 2027-01-03 son 64 contando los dos extremos: uno más del tope.
    const r = leerParametros(new URLSearchParams("periodo=mes&desde=2026-11-01&hasta=2027-01-03"));
    expect(r).toEqual({ error: expect.stringContaining(String(DIAS_DEL_RANGO_MAS_LARGO)) });
  });

  it("acepta un rango de exactamente 63 días", () => {
    // Los dos extremos contados: desde + 62 días.
    const r = leerParametros(new URLSearchParams("periodo=mes&desde=2026-11-01&hasta=2027-01-02"));
    expect("error" in r).toBe(false);
  });

  it("el mensaje del tope nombra los días que de verdad entran", () => {
    /*
     * El número del mensaje es lo único que ve quien abrió la hoja, así que
     * tiene que ser el mismo que la comprobación acepta. El desplazamiento que
     * se le suma a `desde` es uno menos —62 contra 63— y nombrarlo a él deja un
     * mensaje que contradice al rango de al lado, que sí entró.
     */
    const acepta = (hasta: string) =>
      !("error" in leerParametros(
        new URLSearchParams(`periodo=mes&desde=2026-11-01&hasta=${hasta}`)
      ));

    // 63 días contando los dos extremos; el 64º ya no entra.
    expect(acepta("2027-01-02")).toBe(true);
    expect(acepta("2027-01-03")).toBe(false);

    const r = leerParametros(new URLSearchParams("periodo=mes&desde=2026-11-01&hasta=2027-01-03"));
    const mensaje = "error" in r ? r.error : "";
    expect(mensaje).toContain("63");
    expect(mensaje).not.toContain("62");
  });

  it("da error si periodo no es mes, semana ni dia", () => {
    const r = leerParametros(new URLSearchParams("periodo=trimestre&desde=2026-11-01&hasta=2026-11-30"));
    expect(r).toEqual({ error: expect.stringContaining("período") });
  });

  it("taller=1 da taller true; sin el parámetro da false", () => {
    const con = leerParametros(new URLSearchParams("periodo=mes&desde=2026-11-01&hasta=2026-11-30&taller=1"));
    const sin = leerParametros(new URLSearchParams("periodo=mes&desde=2026-11-01&hasta=2026-11-30"));
    expect("error" in con ? null : con.taller).toBe(true);
    expect("error" in sin ? null : sin.taller).toBe(false);
  });

  it("sin filtros en la URL los deja vacíos, no en undefined", () => {
    const r = leerParametros(new URLSearchParams("periodo=dia&desde=2026-11-10&hasta=2026-11-10"));
    expect("error" in r ? null : r.filtros).toEqual(SIN_FILTROS);
  });
});
