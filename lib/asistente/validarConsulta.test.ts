import { describe, it, expect } from "vitest";
import { validarConsulta } from "./validarConsulta";

describe("lo que el asistente puede consultar", () => {
  it("deja pasar un select", () => {
    expect(validarConsulta("select count(*) from empresas")).toEqual({ ok: true });
  });

  it("deja pasar un with", () => {
    expect(validarConsulta("with x as (select 1 as n) select * from x")).toEqual({ ok: true });
  });

  it("deja pasar un punto y coma final, que es lo normal al copiar", () => {
    expect(validarConsulta("select 1;")).toEqual({ ok: true });
    expect(validarConsulta("select 1;  ")).toEqual({ ok: true });
  });

  it("rechaza una escritura", () => {
    const r = validarConsulta("update empresas set nombre = 'x'");
    expect(r.ok).toBe(false);
  });

  it("rechaza dos sentencias", () => {
    const r = validarConsulta("select 1; drop table empresas");
    expect(r.ok).toBe(false);
  });

  // El caso que un prefijo ingenuo deja pasar: el select está adentro de un
  // comentario y la sentencia real es otra.
  it("rechaza una escritura escondida detrás de un comentario", () => {
    expect(validarConsulta("/* select */ delete from empresas").ok).toBe(false);
    expect(validarConsulta("-- select\ndelete from empresas").ok).toBe(false);
  });

  it("acepta un comentario delante de un select de verdad", () => {
    expect(validarConsulta("-- cuántas empresas hay\nselect count(*) from empresas")).toEqual({ ok: true });
  });

  it("rechaza el vacío", () => {
    expect(validarConsulta("   ").ok).toBe(false);
  });
});

/**
 * Los cuatro casos donde el espejo y la función de la base decidían distinto,
 * medidos contra la base el 16/09/2026. Están acá con ese nombre para que, si
 * alguien vuelve a tocar el pelado, sepa que hay algo del otro lado que tiene
 * que cambiar igual.
 */
describe("el espejo dice lo mismo que la base", () => {
  it("acepta un salto de línea al principio (el caso que más iba a doler)", () => {
    // Un modelo que formatea el SQL en varias líneas arranca con \n casi
    // siempre. `btrim` de Postgres con un argumento no lo sacaba.
    expect(validarConsulta("\n  select count(*) from empresas")).toEqual({ ok: true });
    expect(validarConsulta("\t select 1")).toEqual({ ok: true });
  });

  it("acepta un comentario de bloque delante de un select de verdad", () => {
    expect(validarConsulta("/* cuántas hay */ select count(*) from empresas")).toEqual({ ok: true });
  });

  it("acepta varios comentarios encadenados delante", () => {
    expect(validarConsulta("-- uno\n/* dos */\n-- tres\nselect 1")).toEqual({ ok: true });
  });

  /**
   * El falso permiso que tenía la versión que pelaba todos los comentarios: el
   * `--` de adentro del literal se comía el `; delete` que venía detrás.
   */
  it("rechaza un `--` dentro de un literal que esconde una segunda sentencia", () => {
    expect(validarConsulta("select '--' ; delete from empresas").ok).toBe(false);
    expect(validarConsulta("select 'a--b' ; drop table empresas").ok).toBe(false);
  });

  it("no se cuelga con un comentario de bloque sin cerrar", () => {
    expect(validarConsulta("/* sin cerrar select 1").ok).toBe(false);
  });
});
