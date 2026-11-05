import { describe, expect, it } from "vitest";
import {
  filtrarDescartadas,
  suNumeroSeMuestra,
  totalDeLaCampana,
  type Notificacion,
} from "./notificaciones";

describe("filtrarDescartadas", () => {
  it("deja pasar una notificación sin descarte previo", () => {
    const resultado = filtrarDescartadas(
      [{ id: "rrhh-sin-clasificar", titulo: "x", cantidad: 3, href: "/x" }],
      []
    );
    expect(resultado).toHaveLength(1);
  });

  it("saca una notificación descartada si la cantidad no creció", () => {
    const resultado = filtrarDescartadas(
      [{ id: "rrhh-sin-clasificar", titulo: "x", cantidad: 3, href: "/x" }],
      [{ notificacion_id: "rrhh-sin-clasificar", cantidad_vista: 3 }]
    );
    expect(resultado).toHaveLength(0);
  });

  it("saca una notificación descartada aunque la cantidad haya bajado", () => {
    const resultado = filtrarDescartadas(
      [{ id: "rrhh-sin-clasificar", titulo: "x", cantidad: 1, href: "/x" }],
      [{ notificacion_id: "rrhh-sin-clasificar", cantidad_vista: 3 }]
    );
    expect(resultado).toHaveLength(0);
  });

  it("vuelve a mostrar la notificación si la cantidad creció desde el descarte", () => {
    const resultado = filtrarDescartadas(
      [{ id: "rrhh-sin-clasificar", titulo: "x", cantidad: 5, href: "/x" }],
      [{ notificacion_id: "rrhh-sin-clasificar", cantidad_vista: 3 }]
    );
    expect(resultado).toHaveLength(1);
    expect(resultado[0].cantidad).toBe(5);
  });

  it("no toca las notificaciones que no tienen descarte, aunque otras sí", () => {
    const resultado = filtrarDescartadas(
      [
        { id: "a", titulo: "a", cantidad: 2, href: "/a" },
        { id: "b", titulo: "b", cantidad: 2, href: "/b" },
      ],
      [{ notificacion_id: "a", cantidad_vista: 2 }]
    );
    expect(resultado.map((n) => n.id)).toEqual(["b"]);
  });
});

/*
 * ── UN RELOJ NO SE MUESTRA NI SE SUMA ───────────────────────────────────────
 *
 * La `cantidad` de `salud-sin-comprobar` es el día de la época —hoy 20.763— y
 * existe sólo para que descartarlo dure una jornada. El push ya sabía no
 * imprimirla, pero **la campana es la otra superficie que come lo mismo** y la
 * mostraba como insignia de la fila y la sumaba al total del ícono: un «20763»
 * al lado de la campanita.
 *
 * Por eso el predicado vive acá, en el único módulo de avisos que es puro y lo
 * puede importar también un componente de cliente, y no en `resumenDeAvisos.ts`
 * —que es del lado del push—: el criterio se escribe una vez y lo usan las dos
 * puntas.
 */
describe("suNumeroSeMuestra", () => {
  const aviso = (id: string, cantidad: number): Notificacion => ({ id, titulo: id, cantidad, href: "/x" });

  it("el del vigilante ciego no muestra su número, porque es un reloj", () => {
    expect(suNumeroSeMuestra(aviso("salud-sin-comprobar", 20_763))).toBe(false);
  });

  it("un conteo de verdad sí, y también los demás de salud", () => {
    expect(suNumeroSeMuestra(aviso("mant-atrasadas", 23))).toBe(true);
    expect(suNumeroSeMuestra(aviso("salud-agenda/canales", 2))).toBe(true);
  });
});

describe("totalDeLaCampana", () => {
  const aviso = (id: string, cantidad: number): Notificacion => ({ id, titulo: id, cantidad, href: "/x" });

  it("suma las cantidades de los avisos", () => {
    expect(totalDeLaCampana([aviso("a", 3), aviso("b", 4)])).toBe(7);
  });

  /*
   * El que importa: sin esto el total de la campanita de un `admin_sistema`
   * quedaba inflado en veinte mil el día que no se pudiera leer la salud.
   * **Cuenta como 1 y no como 0**: lo que no se suma es su número, pero el
   * aviso existe y tiene que empujar la insignia.
   */
  it("un reloj cuenta como uno, no como veinte mil", () => {
    expect(totalDeLaCampana([aviso("mant-atrasadas", 23), aviso("salud-sin-comprobar", 20_763)])).toBe(24);
  });

  /*
   * Y tampoco como 0, que es el error de enfrente: con el total en cero la
   * campana no dibuja ninguna insignia —`total > 0`—, así que el aviso de que
   * **el vigilante quedó ciego** quedaría invisible salvo que alguien abra el
   * panel. Entre un número feo y uno que no se ve, esto no elige ninguno.
   */
  it("un reloj solo igual enciende la campana", () => {
    expect(totalDeLaCampana([aviso("salud-sin-comprobar", 20_763)])).toBe(1);
  });
});
