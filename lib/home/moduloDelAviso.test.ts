import { describe, it, expect } from "vitest";
import { moduloDelAviso, soloDeSusModulos } from "./moduloDelAviso";
import { MODULO_POR_AVISO, ES_POR_PERSONA } from "./avisos";
import type { Notificacion } from "./notificaciones";

const aviso = (id: string): Notificacion => ({ id, titulo: id, cantidad: 1, href: "/" });

describe("moduloDelAviso", () => {
  it("un aviso de conteo sale de su definicion", () => {
    expect(moduloDelAviso("mant-atrasadas")).toBe("mantenimiento");
    expect(moduloDelAviso("compras-por-aprobar")).toBe("compras");
    expect(moduloDelAviso("syh-vencidas")).toBe("seguridad_higiene");
    expect(moduloDelAviso("calidad-carbonilla-bandeja")).toBe("calidad");
  });

  it("uno de ritmo lleva su modulo en el id", () => {
    expect(moduloDelAviso("ritmo-trituracion")).toBe("trituracion");
    expect(moduloDelAviso("ritmo-taller_vial")).toBe("taller_vial");
  });

  /*
   * La salud es del sistema: no es de ningun modulo, y quien la frena es
   * `sinLoQueNoPuedeAtender`, que por el prefijo la manda solo a
   * admin_sistema. Darle un modulo la dejaria fuera para todos los demas por
   * dos motivos distintos, y el segundo taparia al primero.
   */
  it("la salud no es de ningun modulo", () => {
    expect(moduloDelAviso("salud-produccion/molinos")).toBeNull();
    expect(moduloDelAviso("salud-sin-declarar")).toBeNull();
    expect(moduloDelAviso("salud-sin-comprobar")).toBeNull();
  });

  // La Agenda y la mensajeria son transversales: CLAUDE.md lo dice y no estan
  // en MODULOS_ORDEN. No tienen modulo y no es un olvido.
  it("los dos transversales no son de ningun modulo", () => {
    expect(moduloDelAviso("agenda-divergencias")).toBeNull();
    expect(moduloDelAviso("mensajes-menciones-sin-leer")).toBeNull();
  });

  it("un id que no existe no revienta", () => {
    expect(moduloDelAviso("inventado")).toBeNull();
  });

  /*
   * EL CONTRATO CON `avisos.ts`, y es el test que importa de este archivo.
   *
   * Un aviso sin modulo no le llega a nadie por el camino instantaneo: el
   * filtro por modulo lo deja pasar a todos o a ninguno segun la rama, y en
   * los dos casos es por accidente. Las unicas entradas a las que les
   * corresponde no tener modulo son las transversales, que son exactamente
   * las que el instantaneo saltea por `ES_POR_PERSONA`.
   *
   * Si alguien agrega un aviso de un modulo y se olvida el `modulo`, esto se
   * pone en rojo. Si agrega uno transversal, tiene que decidir a proposito
   * ponerlo en `ES_POR_PERSONA`.
   */
  it("toda entrada declara su modulo, salvo las que son de una persona", () => {
    for (const [id, modulo] of MODULO_POR_AVISO) {
      if (modulo === null) {
        expect(ES_POR_PERSONA.has(id), `${id} no tiene modulo y no es de una persona`).toBe(true);
      } else {
        expect(moduloDelAviso(id), id).toBe(modulo);
      }
    }
  });

  it("el contrato mira todas las entradas y no una lista escrita a mano", () => {
    expect(MODULO_POR_AVISO.size).toBeGreaterThan(15);
  });
});

describe("soloDeSusModulos", () => {
  const avisos = [aviso("mant-atrasadas"), aviso("ritmo-trituracion"), aviso("salud-x/y")];

  it("deja solo los de sus modulos", () => {
    expect(soloDeSusModulos(avisos, ["mantenimiento"]).map((a) => a.id)).toEqual([
      "mant-atrasadas",
      "salud-x/y",
    ]);
  });

  /*
   * El que no es de ningun modulo pasa siempre. Si se filtrara acá, la salud
   * no le llegaria a nadie —ni siquiera a admin_sistema— y el motivo seria
   * invisible: el filtro de verdad es `sinLoQueNoPuedeAtender`.
   */
  it("la del sistema pasa aunque la persona no tenga ningun modulo", () => {
    expect(soloDeSusModulos(avisos, []).map((a) => a.id)).toEqual(["salud-x/y"]);
  });

  it("con todos los modulos pasa todo", () => {
    expect(soloDeSusModulos(avisos, ["mantenimiento", "trituracion"])).toHaveLength(3);
  });

  it("sin avisos no devuelve nada y no rompe", () => {
    expect(soloDeSusModulos([], ["mantenimiento"])).toEqual([]);
  });
});
