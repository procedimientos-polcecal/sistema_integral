import { describe, it, expect } from "vitest";
import { novedadesAlInstante } from "./novedadAlInstante";
import type { Foto } from "./movimiento";
import type { Notificacion } from "./notificaciones";

const aviso = (id: string, cantidad: number): Notificacion => ({
  id,
  titulo: `t-${id}`,
  cantidad,
  href: `/${id}`,
});

describe("novedadesAlInstante", () => {
  it("lo que subio sale con cuanto subio, no con el total", () => {
    expect(
      novedadesAlInstante([aviso("mant-atrasadas", 24)], new Map([["mant-atrasadas", 21]]))
    ).toEqual([aviso("mant-atrasadas", 3)]);
  });

  it("lo que no se movio no sale", () => {
    expect(
      novedadesAlInstante([aviso("mant-atrasadas", 24)], new Map([["mant-atrasadas", 24]]))
    ).toEqual([]);
  });

  it("lo que bajo no sale", () => {
    expect(
      novedadesAlInstante([aviso("mant-atrasadas", 20)], new Map([["mant-atrasadas", 24]]))
    ).toEqual([]);
  });

  it("un aviso que no estaba sube desde cero", () => {
    expect(novedadesAlInstante([aviso("mant-atrasadas", 4)], new Map([["otro", 9]]))[0].cantidad).toBe(4);
  });

  /*
   * EL FLANCO DE LA SALUD, que es la razon por la que esta funcion existe
   * aparte de `loQueSeMovio`.
   *
   * La `cantidad` de un `salud-*` es la racha de corridas fallidas y no una
   * cantidad de cosas. Con diez sincronizaciones corriendo seis veces por hora,
   * esa racha sube unas seis veces por hora mientras el recurso siga roto:
   * tratarla como un conteo son hasta 56 pushes en un dia por un solo sync
   * caido, que es el anti-goal del diseño.
   */
  describe("la familia salud- avisa por el flanco y no por el numero", () => {
    it("un recurso que se acaba de romper avisa una vez, con cantidad 1", () => {
      expect(novedadesAlInstante([aviso("salud-rrhh/lenox", 1)], new Map())).toEqual([
        aviso("salud-rrhh/lenox", 1),
      ]);
    });

    it("su racha no se escribe como si fueran cosas", () => {
      // Recien roto pero con la racha ya en 7: igual dice 1.
      expect(novedadesAlInstante([aviso("salud-rrhh/lenox", 7)], new Map())[0].cantidad).toBe(1);
    });

    it("un recurso que sigue roto no vuelve a avisar, aunque su racha suba", () => {
      expect(
        novedadesAlInstante([aviso("salud-rrhh/lenox", 7)], new Map([["salud-rrhh/lenox", 1]]))
      ).toEqual([]);
    });

    /*
     * Se arreglo y se volvio a romper: entre medio dejo de estar en los avisos,
     * asi que `guardarElVistazo` lo saco de la tabla. Por eso el vistazo
     * REEMPLAZA y no acumula — si quedara, esta rotura no se veria.
     */
    it("uno que se arreglo y se volvio a romper avisa de nuevo", () => {
      expect(novedadesAlInstante([aviso("salud-rrhh/lenox", 1)], new Map([["otro", 1]]))).toHaveLength(1);
    });

    it("los tres de la familia se tratan igual", () => {
      const vistos: Foto = new Map([["salud-sin-declarar", 2]]);
      expect(
        novedadesAlInstante(
          [aviso("salud-sin-declarar", 5), aviso("salud-produccion/molinos", 3)],
          vistos
        ).map((a) => a.id)
      ).toEqual(["salud-produccion/molinos"]);
    });
  });

  // Su cantidad es el dia como numero: comparar un reloj contra lo anterior da
  // novedad todas las mañanas a las 7:00.
  it("salud-sin-comprobar nunca es novedad", () => {
    for (const vistos of [new Map(), new Map([["salud-sin-comprobar", 20261115]])]) {
      expect(novedadesAlInstante([aviso("salud-sin-comprobar", 20261116)], vistos as Foto)).toEqual([]);
    }
  });

  // Su numero depende de quien mira y este calculo es global: compararlos
  // contra una cuenta de todos inventaria una novedad en cada pasada.
  it("los que son de una persona no salen nunca", () => {
    expect(
      novedadesAlInstante(
        [aviso("agenda-divergencias", 3), aviso("mensajes-menciones-sin-leer", 2)],
        new Map()
      )
    ).toEqual([]);
  });

  /*
   * Con el vistazo vacio da todo por nuevo, y eso es correcto: el freno de la
   * primera corrida es `queMandarAhora`, no esta funcion. Se fija para que las
   * dos mitades no se contradigan sin que nada lo note.
   */
  it("con el vistazo vacio da todo por nuevo: el freno es de quien la llama", () => {
    expect(novedadesAlInstante([aviso("mant-atrasadas", 24)], new Map())).toHaveLength(1);
  });

  it("de una lista mezclada salen solo los que corresponden", () => {
    const vistos: Foto = new Map([
      ["mant-atrasadas", 20],
      ["salud-x/y", 3],
      ["rrhh-sin-clasificar", 2],
    ]);
    expect(
      novedadesAlInstante(
        [
          aviso("mant-atrasadas", 23),
          aviso("salud-x/y", 9),
          aviso("rrhh-sin-clasificar", 2),
          aviso("agenda-divergencias", 5),
        ],
        vistos
      ).map((a) => [a.id, a.cantidad])
    ).toEqual([["mant-atrasadas", 3]]);
  });

  it("sin avisos no devuelve nada y no rompe", () => {
    expect(novedadesAlInstante([], new Map([["mant-atrasadas", 4]]))).toEqual([]);
  });
});
