import { describe, expect, it } from "vitest";
import { avisosDeConteos } from "@/lib/home/avisos";
import {
  escribirFiltrosDeGestion,
  leerFiltrosDeGestion,
} from "./filtrosUrl";
import { SIN_FILTROS } from "./gestion";

const LUGARES = { sectores: ["sec-1", "sec-2"], equipos: ["eq-1"] };
const leer = (query: string) => leerFiltrosDeGestion(new URLSearchParams(query), LUGARES);

describe("leerFiltrosDeGestion", () => {
  it("lee los cuatro filtros", () => {
    expect(leer("estado=Vencida&falta=sin_asignar&lugar=s:sec-1&clasificacion=NS")).toEqual({
      estado: "Vencida",
      falta: "sin_asignar",
      lugar: "s:sec-1",
      clasificacion: "NS",
    });
  });

  it("una URL sin nada no filtra nada", () => {
    expect(leer("")).toEqual(SIN_FILTROS);
  });

  it("acepta los valores que no son un estado ni una falta de verdad", () => {
    expect(leer("estado=abierta&falta=alguna&clasificacion=sin_clasificar")).toEqual({
      ...SIN_FILTROS,
      estado: "abierta",
      falta: "alguna",
      clasificacion: "sin_clasificar",
    });
  });

  /*
   * Un valor que no está en la lista se descarta en vez de filtrar por él: un
   * filtro que el desplegable no puede mostrar deja una tabla vacía que se lee
   * como «no hay nada». Es lo que le pasaba a los avisos con «vencida» en
   * minúscula y «cualquiera», que no existen.
   */
  it("descarta lo que no existe en vez de filtrar por ello", () => {
    expect(leer("estado=vencida").estado).toBe("");
    expect(leer("falta=cualquiera").falta).toBe("");
    expect(leer("clasificacion=XX").clasificacion).toBe("");
    expect(leer("lugar=s:otro").lugar).toBe("");
    expect(leer("lugar=e:sec-1").lugar).toBe("");
    expect(leer("lugar=sec-1").lugar).toBe("");
  });

  it("el lugar acepta un sector o un equipo que existe", () => {
    expect(leer("lugar=e:eq-1").lugar).toBe("e:eq-1");
    expect(leer("lugar=s:sec-2").lugar).toBe("s:sec-2");
  });
});

describe("escribirFiltrosDeGestion", () => {
  it("ida y vuelta: lo que se escribe se vuelve a leer igual", () => {
    const f = leer("estado=abierta&falta=alguna&lugar=e:eq-1&clasificacion=I");
    expect(leer(escribirFiltrosDeGestion(f))).toEqual(f);
  });

  it("sin filtros no ensucia la URL", () => {
    expect(escribirFiltrosDeGestion(SIN_FILTROS)).toBe("");
  });
});

/*
 * El enlace es la mitad del aviso: el resumen llega al teléfono diciendo «3 más
 * · Condiciones inseguras vencidas» y quien lo toca tiene que aterrizar en esas
 * tres. Esto ata el href de cada aviso a lo que la pantalla de verdad filtra, y
 * a lo que hacen los botones del encabezado de esa misma pantalla.
 */
describe("los enlaces de los avisos de Seguridad e Higiene", () => {
  const avisos = avisosDeConteos({ syhVencidas: 1, syhSinCompletar: 1 });
  const filtrosDe = (id: string) => {
    const href = avisos.find((a) => a.id === id)!.href;
    expect(href.startsWith("/seguridad-higiene/condiciones?")).toBe(true);
    return leer(href.split("?")[1]);
  };

  it("«vencidas» abre la lista filtrada por las vencidas", () => {
    expect(filtrosDe("syh-vencidas")).toEqual({ ...SIN_FILTROS, estado: "Vencida" });
  });

  it("«sin completar» abre las abiertas a las que les falta algo", () => {
    expect(filtrosDe("syh-sin-completar")).toEqual({ ...SIN_FILTROS, estado: "abierta", falta: "alguna" });
  });
});
