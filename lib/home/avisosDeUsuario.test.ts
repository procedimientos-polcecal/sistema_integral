import { describe, it, expect } from "vitest";
import { sinLoQueNoPuedeAtender } from "./avisosDeUsuario";
import { avisosDeConteos, type ConteosParaAvisos } from "./avisos";
import type { Notificacion } from "./notificaciones";

/**
 * Los avisos salen de `avisosDeConteos` y **no de una lista de ids escrita
 * acá**, y ése es el punto de este archivo.
 *
 * Con los ids literales, alguien podía renombrar un id en `avisos.ts` y
 * olvidarse de `DE_UNA_LISTA`: el filtro dejaba de reconocerlo, el aviso
 * empezaba a llegarle a todos los que ven el módulo —y por push— y estos
 * tests seguían verdes, porque probaban el id viejo contra el mapa viejo.
 * Pidiéndoselos a la función que los arma, las dos puntas quedan atadas: un id
 * renombrado sólo de un lado pone esto en rojo.
 */
function avisoDe(clave: keyof ConteosParaAvisos): Notificacion {
  const [aviso] = avisosDeConteos({ [clave]: 1 });
  if (!aviso) throw new Error(`\`${clave}\` no genera ningún aviso en avisos.ts`);
  return aviso;
}

/** Nadie puede nada: el corte más duro. */
const NADA = { apruebaCompras: false, evaluaSyh: false, administraElSistema: false };

const COMPRAS = avisoDe("comprasEsperandoAprobacion");
const ATRASADAS = avisoDe("mantenimientoAtrasadas");
const avisos: Notificacion[] = [COMPRAS, ATRASADAS];

describe("sinLoQueNoPuedeAtender", () => {
  /*
   * Medido el 18/10/2026: "Requerimientos esperando aprobacion" le llegaba a 6
   * personas y 3 no estaban en `compras_aprobadores`. Pedirle a alguien algo
   * que no puede hacer enseña que un aviso tuyo puede no ser tuyo.
   */
  it("quien no aprueba no recibe el aviso de aprobacion", () => {
    expect(sinLoQueNoPuedeAtender(avisos, NADA).map((a) => a.id)).toEqual([ATRASADAS.id]);
  });

  it("quien aprueba lo recibe", () => {
    expect(
      sinLoQueNoPuedeAtender(avisos, { ...NADA, apruebaCompras: true }).map((a) => a.id)
    ).toEqual([COMPRAS.id, ATRASADAS.id]);
  });

  /*
   * El filtro mira la LISTA, no el rol ni el nivel. Los administradores siguen
   * recibiendo todo lo demas, decidido a pedido el 18/10/2026: esto no es
   * repartir por permiso, es respetar una lista de responsables que ya existe.
   */
  it("no toca ningun otro aviso", () => {
    const otros: Notificacion[] = [
      { id: "ritmo-remises", titulo: "Remises: hace 82 días que no se carga", cantidad: 1, href: "/c" },
      avisoDe("tallerVialSinService"),
    ];
    expect(sinLoQueNoPuedeAtender(otros, NADA)).toEqual(otros);
  });

  it("sin avisos no devuelve nada y no rompe", () => {
    expect(sinLoQueNoPuedeAtender([], { ...NADA, apruebaCompras: true })).toEqual([]);
  });
});

describe("sinLoQueNoPuedeAtender — Seguridad e Higiene", () => {
  const VENCIDAS = avisoDe("syhVencidas");
  const SIN_COMPLETAR = avisoDe("syhSinCompletar");
  const deLosQueEvalua = [VENCIDAS, SIN_COMPLETAR];

  it("los dos de gestión van sólo a quien puede evaluar y cerrar", () => {
    expect(sinLoQueNoPuedeAtender(deLosQueEvalua, { ...NADA, apruebaCompras: true })).toEqual([]);
    expect(sinLoQueNoPuedeAtender(deLosQueEvalua, { ...NADA, evaluaSyh: true })).toHaveLength(2);
  });

  it("evaluar condiciones no habilita los avisos de aprobación, ni al revés", () => {
    const todos = [...avisos, ...deLosQueEvalua];
    expect(
      sinLoQueNoPuedeAtender(todos, { ...NADA, evaluaSyh: true }).map((a) => a.id)
    ).toEqual([ATRASADAS.id, VENCIDAS.id, SIN_COMPLETAR.id]);
    expect(
      sinLoQueNoPuedeAtender(todos, { ...NADA, apruebaCompras: true }).map((a) => a.id)
    ).toEqual([COMPRAS.id, ATRASADAS.id]);
  });

  /*
   * EL DEL RESPALDO NO ES DEL ADMIN DEL MÓDULO, Y ÉSA ES LA DIFERENCIA.
   *
   * Lo que ese aviso pide —crear la carpeta en una unidad compartida de Drive
   * y poner `GOOGLE_DRIVE_SYH_FOTOS_FOLDER_ID`— no lo puede hacer nadie desde
   * el SdG: es `admin_sistema`. Mandado al admin del módulo repetía el patrón
   * de `compras-por-aprobar` que este repo ya midió, y peor: si la carpeta no
   * existe al estrenar el módulo, suena todas las mañanas desde el cuarto día.
   */
  it("el del respaldo va a admin_sistema y no a quien evalúa condiciones", () => {
    const respaldo = [avisoDe("syhFotosSinRespaldar")];
    expect(sinLoQueNoPuedeAtender(respaldo, { ...NADA, evaluaSyh: true })).toEqual([]);
    expect(sinLoQueNoPuedeAtender(respaldo, { ...NADA, administraElSistema: true })).toEqual(
      respaldo
    );
  });
});

describe("los avisos de la Agenda", () => {
  it("el de salud va sólo a admin_sistema: nadie más puede arreglar un canal de Google", () => {
    const salud = [avisoDe("agendaPasosCaidos")];
    expect(sinLoQueNoPuedeAtender(salud, { ...NADA, evaluaSyh: true, apruebaCompras: true })).toEqual([]);
    expect(sinLoQueNoPuedeAtender(salud, { ...NADA, administraElSistema: true })).toEqual(salud);
  });

  it("el de «no se pudo comprobar» también va sólo a admin_sistema", () => {
    const sin = [avisoDe("agendaSaludSinComprobar")];
    expect(sinLoQueNoPuedeAtender(sin, NADA)).toEqual([]);
    expect(sinLoQueNoPuedeAtender(sin, { ...NADA, administraElSistema: true })).toEqual(sin);
  });

  // El de divergencias es de cada uno y lo decide su propio conteo: filtrarlo
  // por rol le sacaría el aviso al dueño de un evento que sólo usa la Agenda.
  it("el de divergencias le llega a cualquiera que tenga alguna", () => {
    const propias = [avisoDe("agendaDivergencias")];
    expect(sinLoQueNoPuedeAtender(propias, NADA)).toEqual(propias);
  });
});
