import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import { moduloDelAviso, soloDeSusModulos, PREFIJOS_DECLARADOS } from "./moduloDelAviso";
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

  /*
   * EL OTRO CONTRATO, Y EL QUE FALTABA.
   *
   * `MODULO_POR_AVISO` sólo tiene las entradas de la tabla `AVISOS`, y hay
   * avisos cuyo id se arma en el momento: el ritmo, la salud y las sospechas
   * de ciclo. El contrato de arriba es ciego a esos, y por esa ceguera
   * `mant-ciclo-sospechoso-*` -- que es de Mantenimiento -- salia sin modulo y
   * `soloDeSusModulos` lo dejaba pasar a TODO EL MUNDO: un push diciendo que
   * se cambiaron rodamientos de un equipo a alguien que solo tiene Remises.
   *
   * Asi que este test lee el archivo, como `sw.test.ts` lee `public/sw.js`:
   * saca los prefijos de los ids armados a mano y exige que cada uno este
   * declarado. Un productor dinamico nuevo se pone en rojo solo, que es lo que
   * una lista escrita a mano no puede hacer.
   */
  it("todo id armado en el momento tiene su prefijo declarado", () => {
    const fuente = readFileSync(new URL("./avisos.ts", import.meta.url), "utf8");
    const prefijos = [...fuente.matchAll(/id: `([^$`]*)\$\{/g)].map((m) => m[1]);

    expect(prefijos.length, "ningun id dinamico: ¿cambio la forma de escribirlos?").toBeGreaterThan(2);
    for (const prefijo of prefijos) {
      expect(
        PREFIJOS_DECLARADOS.includes(prefijo),
        `el prefijo "${prefijo}" no esta declarado en moduloDelAviso.ts`
      ).toBe(true);
    }
  });

  /*
   * La sospecha de ciclo es de Mantenimiento y nada en su id lo dice: el
   * prefijo es `mant-` como el de los conteos, pero el id completo no esta en
   * ninguna tabla porque lleva el equipo adentro.
   */
  it("una sospecha de ciclo es de mantenimiento", () => {
    expect(moduloDelAviso("mant-ciclo-sospechoso-EM-12")).toBe("mantenimiento");
    expect(moduloDelAviso("mant-ciclo-sospechoso-Pala CAT 950")).toBe("mantenimiento");
  });
});

describe("soloDeSusModulos", () => {
  const avisos = [aviso("mant-atrasadas"), aviso("ritmo-trituracion"), aviso("salud-x/y")];

  /*
   * EL BUG QUE ESTE TEST CIERRA, y la razon por la que `PREFIJOS_DECLARADOS`
   * existe. Hasta que se declaro el prefijo, una sospecha de ciclo no tenia
   * modulo, y lo que no tiene modulo pasa siempre: el push le llegaba a
   * cualquiera con suscripcion, tuviera o no Mantenimiento.
   */
  it("una sospecha de ciclo no le llega a quien no tiene mantenimiento", () => {
    const sospecha = [aviso("mant-ciclo-sospechoso-EM-12")];
    expect(soloDeSusModulos(sospecha, ["remises"])).toEqual([]);
    expect(soloDeSusModulos(sospecha, ["mantenimiento"])).toHaveLength(1);
  });

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
