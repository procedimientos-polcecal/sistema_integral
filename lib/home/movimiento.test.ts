import { describe, it, expect } from "vitest";
import { loQueSeMovio, esDiaDeRecordatorio, queMandarHoy } from "./movimiento";
import type { Notificacion } from "./notificaciones";

const aviso = (id: string, cantidad: number): Notificacion => ({
  id,
  titulo: `t-${id}`,
  cantidad,
  href: `/${id}`,
});

describe("loQueSeMovio", () => {
  it("lo que subio sale con cuanto subio, no con el total", () => {
    expect(loQueSeMovio([aviso("ot", 23)], new Map([["ot", 20]]))).toEqual([
      { id: "ot", titulo: "t-ot", cantidad: 3, href: "/ot" },
    ]);
  });

  it("lo que no se movio no sale", () => {
    expect(loQueSeMovio([aviso("ot", 23)], new Map([["ot", 23]]))).toEqual([]);
  });

  // Que una cola baje es una buena noticia y no pide nada. Avisar las bajas
  // duplicaria el volumen para decir cosas que no piden nada.
  it("lo que bajo no sale", () => {
    expect(loQueSeMovio([aviso("ot", 20)], new Map([["ot", 23]]))).toEqual([]);
  });

  it("un aviso que no estaba en la foto sube por su cantidad entera", () => {
    expect(loQueSeMovio([aviso("nuevo", 4)], new Map())[0].cantidad).toBe(4);
  });

  // La foto recuerda avisos que hoy no existen porque su conteo llego a cero.
  // No tienen que aparecer ni romper la comparacion.
  it("un aviso que estaba en la foto y hoy no existe no genera nada", () => {
    expect(loQueSeMovio([], new Map([["se-fue", 5]]))).toEqual([]);
  });

  it("de una lista mezclada salen solo los que subieron", () => {
    const foto = new Map([
      ["sube", 1],
      ["queda", 7],
      ["baja", 9],
    ]);
    expect(
      loQueSeMovio([aviso("sube", 4), aviso("queda", 7), aviso("baja", 2)], foto).map((a) => [
        a.id,
        a.cantidad,
      ])
    ).toEqual([["sube", 3]]);
  });

  /*
   * Sin foto todo cuenta como nuevo. Que eso se mande o no lo decide el cron
   * —el primer dia no se manda nada—, pero la funcion tiene que ser
   * consistente: lo que no esta en la foto subio desde cero.
   */
  it("con la foto vacia todo cuenta como nuevo", () => {
    expect(loQueSeMovio([aviso("a", 2), aviso("b", 5)], new Map())).toHaveLength(2);
  });

  it("conserva titulo y href, que son los que arman la notificacion", () => {
    const [r] = loQueSeMovio(
      [{ id: "x", titulo: "Órdenes de trabajo atrasadas", cantidad: 9, href: "/mantenimiento" }],
      new Map([["x", 6]])
    );
    expect(r).toEqual({
      id: "x",
      titulo: "Órdenes de trabajo atrasadas",
      cantidad: 3,
      href: "/mantenimiento",
    });
  });
});

describe("esDiaDeRecordatorio", () => {
  it("el lunes si", () => {
    expect(esDiaDeRecordatorio("2026-10-19")).toBe(true);
  });

  it("el resto de la semana no", () => {
    for (const d of ["2026-10-18", "2026-10-20", "2026-10-24", "2026-10-25"]) {
      expect(esDiaDeRecordatorio(d)).toBe(false);
    }
  });
});

describe("queMandarHoy", () => {
  /*
   * LA IDEMPOTENCIA DEL CRON VIVE ACA, y no en el upsert.
   *
   * Para el movimiento alcanzaba con el upsert: la segunda corrida compara
   * contra la foto que escribio la primera y da cero. Pero el resumen de los
   * lunes NO mira la foto —son totales— asi que un reintento mandaba el mismo
   * push dos veces. Y el disparo manual de la prueba de produccion es
   * exactamente ese caso.
   */
  it("si la ultima foto es la de hoy, ya corrio: no se manda nada", () => {
    expect(queMandarHoy({ fechaDeLaFoto: "2026-10-19", hoy: "2026-10-19" })).toBe("nada");
  });

  it("y tampoco un lunes, que es cuando el upsert no alcanzaba", () => {
    // 2026-10-19 es lunes.
    expect(queMandarHoy({ fechaDeLaFoto: "2026-10-19", hoy: "2026-10-19" })).toBe("nada");
  });

  it("un dia comun con foto de ayer: movimiento", () => {
    expect(queMandarHoy({ fechaDeLaFoto: "2026-10-19", hoy: "2026-10-20" })).toBe("movimiento");
  });

  it("un lunes con foto de ayer: totales", () => {
    expect(queMandarHoy({ fechaDeLaFoto: "2026-10-18", hoy: "2026-10-19" })).toBe("totales");
  });

  it("el primer dia, sin ninguna foto: nada que comparar, no se manda", () => {
    expect(queMandarHoy({ fechaDeLaFoto: null, hoy: "2026-10-20" })).toBe("nada");
  });

  /*
   * Y la excepcion que importa para este despliegue: los totales NO necesitan
   * foto. Si el primer dia con tabla cae lunes —que es lo mas probable ahora
   * mismo—, cortar por "primer dia" perderia el recordatorio de esa semana
   * entera.
   */
  it("el primer dia, si es lunes: los totales no necesitan foto", () => {
    expect(queMandarHoy({ fechaDeLaFoto: null, hoy: "2026-10-19" })).toBe("totales");
  });

  it("una foto vieja de varios dias sigue sirviendo: movimiento", () => {
    expect(queMandarHoy({ fechaDeLaFoto: "2026-10-14", hoy: "2026-10-20" })).toBe("movimiento");
  });
});
