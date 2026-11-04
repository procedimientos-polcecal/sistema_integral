import { describe, it, expect } from "vitest";
import type { EventoVista } from "./vista";
import { MINUTOS_MINIMOS, acomodar, partirPorDia, type PedazoDelDia } from "./grilla";

const ev = (id: string, inicio: string, fin: string): EventoVista => ({
  id,
  titulo: `Evento ${id}`,
  descripcion: null,
  lugar: null,
  inicio,
  fin,
  duenoId: "u1",
  casilla: "u1@polcecal.com",
  duenoNombre: null,
  divergencia: null,
  divergenciaVista: false,
  googlePendiente: null,
  aviso: null,
  otId: null,
  turno: null,
  invitados: [],
});

/** Un pedazo ya cortado, para probar `acomodar` sin pasar por `partirPorDia`. */
const pedazo = (id: string, dia: string, desdeMin: number, hastaMin: number): PedazoDelDia => ({
  evento: ev(id, `${dia}T00:00:00-03:00`, `${dia}T00:00:00-03:00`),
  dia,
  desdeMin,
  hastaMin,
  vieneDeAntes: false,
  sigueDespues: false,
});

const h = (hora: number, min = 0) => hora * 60 + min;

describe("partirPorDia", () => {
  it("un evento de un día es un pedazo con sus minutos", () => {
    const p = partirPorDia([ev("a", "2026-11-04T08:00:00-03:00", "2026-11-04T09:30:00-03:00")], ["2026-11-04"]);
    expect(p).toHaveLength(1);
    expect(p[0]).toMatchObject({ dia: "2026-11-04", desdeMin: 480, hastaMin: 570, vieneDeAntes: false, sigueDespues: false });
  });

  it("un evento fuera de los días pedidos no da ningún pedazo", () => {
    expect(partirPorDia([ev("a", "2026-11-20T08:00:00-03:00", "2026-11-20T09:00:00-03:00")], ["2026-11-04"])).toEqual([]);
  });

  // Los minutos son hora de pared de Argentina: un instante en UTC que ya es el
  // día siguiente allá todavía es el día anterior acá.
  it("los minutos son de Argentina aunque el instante venga en UTC", () => {
    const p = partirPorDia([ev("a", "2026-11-05T01:30:00Z", "2026-11-05T02:30:00Z")], ["2026-11-04", "2026-11-05"]);
    expect(p).toHaveLength(1);
    expect(p[0]).toMatchObject({ dia: "2026-11-04", desdeMin: h(22, 30), hastaMin: h(23, 30) });
  });

  // Review Focus 1: cruza la medianoche. Google lo permite y «aceptar» lo trae.
  it("un evento que cruza la medianoche da un pedazo por día, marcados", () => {
    const p = partirPorDia(
      [ev("a", "2026-11-08T23:00:00-03:00", "2026-11-09T01:00:00-03:00")],
      ["2026-11-08", "2026-11-09"]
    );
    expect(p).toHaveLength(2);
    expect(p[0]).toMatchObject({ dia: "2026-11-08", desdeMin: 1380, hastaMin: 1440, vieneDeAntes: false, sigueDespues: true });
    expect(p[1]).toMatchObject({ dia: "2026-11-09", desdeMin: 0, hastaMin: 60, vieneDeAntes: true, sigueDespues: false });
  });

  it("si sólo se mira el día de llegada, el pedazo igual sale, marcado como que viene de antes", () => {
    const p = partirPorDia([ev("a", "2026-11-08T23:00:00-03:00", "2026-11-09T01:00:00-03:00")], ["2026-11-09"]);
    expect(p).toHaveLength(1);
    expect(p[0]).toMatchObject({ dia: "2026-11-09", desdeMin: 0, vieneDeAntes: true });
  });

  it("si sólo se mira el día de salida, el pedazo igual sale, marcado como que sigue después", () => {
    const p = partirPorDia([ev("a", "2026-11-08T23:00:00-03:00", "2026-11-09T01:00:00-03:00")], ["2026-11-08"]);
    expect(p).toHaveLength(1);
    expect(p[0]).toMatchObject({ dia: "2026-11-08", desdeMin: 1380, hastaMin: 1440, sigueDespues: true, vieneDeAntes: false });
  });

  it("un evento de varios días ocupa entero los días del medio, marcado en los dos sentidos", () => {
    const dias = ["2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05"];
    const p = partirPorDia([ev("a", "2026-11-02T10:00:00-03:00", "2026-11-05T12:00:00-03:00")], dias);
    expect(p.map((x) => [x.dia, x.desdeMin, x.hastaMin, x.vieneDeAntes, x.sigueDespues])).toEqual([
      ["2026-11-02", h(10), 1440, false, true],
      ["2026-11-03", 0, 1440, true, true],
      ["2026-11-04", 0, 1440, true, true],
      ["2026-11-05", 0, h(12), true, false],
    ]);
  });

  // Un evento que termina a las 00:00 en punto termina el día anterior: si no,
  // dejaría un pedazo fantasma de nada en el día siguiente.
  it("un evento que termina justo a medianoche no deja un pedazo en el día siguiente", () => {
    const p = partirPorDia(
      [ev("a", "2026-11-08T22:00:00-03:00", "2026-11-09T00:00:00-03:00")],
      ["2026-11-08", "2026-11-09"]
    );
    expect(p).toHaveLength(1);
    expect(p[0]).toMatchObject({ dia: "2026-11-08", desdeMin: h(22), hastaMin: 1440, sigueDespues: false });
  });

  it("devuelve un pedazo por cada evento que toca el día, y todos los que se pidieron", () => {
    const p = partirPorDia(
      [
        ev("a", "2026-11-04T08:00:00-03:00", "2026-11-04T09:00:00-03:00"),
        ev("b", "2026-11-05T08:00:00-03:00", "2026-11-05T09:00:00-03:00"),
        ev("c", "2026-11-04T08:00:00-03:00", "2026-11-04T09:00:00-03:00"),
      ],
      ["2026-11-04", "2026-11-05"]
    );
    expect(p.map((x) => [x.dia, x.evento.id])).toEqual([
      ["2026-11-04", "a"],
      ["2026-11-04", "c"],
      ["2026-11-05", "b"],
    ]);
  });

  // Review Focus 3: un bloque de alto cero es un evento que existe y no se ve.
  it("un evento de duración cero ocupa el mínimo visible", () => {
    const p = partirPorDia([ev("a", "2026-11-04T08:00:00-03:00", "2026-11-04T08:00:00-03:00")], ["2026-11-04"]);
    expect(p[0].hastaMin - p[0].desdeMin).toBe(MINUTOS_MINIMOS);
    expect(p[0].desdeMin).toBe(h(8));
  });

  it("un evento de cinco minutos también", () => {
    const p = partirPorDia([ev("a", "2026-11-04T08:00:00-03:00", "2026-11-04T08:05:00-03:00")], ["2026-11-04"]);
    expect(p[0].hastaMin - p[0].desdeMin).toBe(MINUTOS_MINIMOS);
  });

  it("un evento que ya dura el mínimo o más no se estira", () => {
    const p = partirPorDia([ev("a", "2026-11-04T08:00:00-03:00", "2026-11-04T08:20:00-03:00")], ["2026-11-04"]);
    expect(p[0]).toMatchObject({ desdeMin: h(8), hastaMin: h(8, 20) });
  });

  it("el mínimo no empuja un evento del final del día fuera de la grilla", () => {
    const p = partirPorDia([ev("a", "2026-11-04T23:55:00-03:00", "2026-11-04T23:57:00-03:00")], ["2026-11-04"]);
    expect(p[0].hastaMin).toBeLessThanOrEqual(1440);
    expect(p[0].hastaMin - p[0].desdeMin).toBe(MINUTOS_MINIMOS);
    expect(p[0].desdeMin).toBeGreaterThanOrEqual(0);
  });

  // Un fin anterior al inicio es un dato roto, pero un dato roto no puede ser
  // un evento que desaparece de la agenda.
  it("un evento con el fin antes del inicio igual se dibuja, como uno de duración cero", () => {
    const p = partirPorDia([ev("a", "2026-11-04T10:00:00-03:00", "2026-11-04T09:00:00-03:00")], ["2026-11-04"]);
    expect(p).toHaveLength(1);
    expect(p[0]).toMatchObject({ desdeMin: h(10), hastaMin: h(10) + MINUTOS_MINIMOS, vieneDeAntes: false, sigueDespues: false });
  });

  it("el fin antes del inicio en otro día tampoco lo hace desaparecer", () => {
    const p = partirPorDia([ev("a", "2026-11-05T10:00:00-03:00", "2026-11-04T09:00:00-03:00")], ["2026-11-04", "2026-11-05"]);
    expect(p).toHaveLength(1);
    expect(p[0].dia).toBe("2026-11-05");
  });

  it("el mínimo vale también para el pedazo que llega del día anterior", () => {
    const p = partirPorDia([ev("a", "2026-11-04T23:00:00-03:00", "2026-11-05T00:05:00-03:00")], ["2026-11-05"]);
    expect(p).toHaveLength(1);
    expect(p[0]).toMatchObject({ desdeMin: 0, hastaMin: MINUTOS_MINIMOS, vieneDeAntes: true });
  });
});

describe("acomodar", () => {
  const dia = "2026-11-04";

  it("sin pedazos no hay nada", () => {
    expect(acomodar([])).toEqual([]);
  });

  it("dos eventos que no se tocan ocupan cada uno todo el ancho", () => {
    const u = acomodar([pedazo("a", dia, h(8), h(9)), pedazo("b", dia, h(10), h(11))]);
    expect(u.map((x) => [x.columna, x.columnas])).toEqual([[0, 1], [0, 1]]);
  });

  // Que uno termine justo cuando empieza el otro no es superponerse.
  it("dos eventos que se tocan en el borde no se parten el ancho", () => {
    const u = acomodar([pedazo("a", dia, h(8), h(9)), pedazo("b", dia, h(9), h(10))]);
    expect(u.map((x) => [x.columna, x.columnas])).toEqual([[0, 1], [0, 1]]);
  });

  // El que empieza cuando el racimo anterior termina es un racimo nuevo: si se
  // pegara al anterior heredaría su ancho y quedaría angosto sin motivo.
  it("el que empieza justo cuando termina un racimo apretado vuelve a tener todo el ancho", () => {
    const u = acomodar([pedazo("a", dia, h(8), h(9)), pedazo("b", dia, h(8), h(9)), pedazo("c", dia, h(9), h(10))]);
    expect(u.map((x) => [x.evento.id, x.columna, x.columnas])).toEqual([
      ["a", 0, 2],
      ["b", 1, 2],
      ["c", 0, 1],
    ]);
  });

  it("dos superpuestos se parten el ancho", () => {
    const u = acomodar([pedazo("a", dia, h(8), h(9, 30)), pedazo("b", dia, h(9), h(10))]);
    expect(u.map((x) => [x.columna, x.columnas])).toEqual([[0, 2], [1, 2]]);
  });

  it("uno que termina antes de que empiece el tercero libera su columna", () => {
    const u = acomodar([
      pedazo("a", dia, h(8), h(9)),
      pedazo("b", dia, h(8, 30), h(10)),
      pedazo("c", dia, h(9, 15), h(10)),
    ]);
    expect(u[2].columna).toBe(0);
    expect(u[2].evento.id).toBe("c");
  });

  it("los de un mismo racimo comparten el ancho aunque no todos se toquen entre sí", () => {
    // a y c no se tocan, pero los dos tocan a b: el racimo es de dos columnas para los tres.
    const u = acomodar([
      pedazo("a", dia, h(8), h(9)),
      pedazo("b", dia, h(8, 30), h(10)),
      pedazo("c", dia, h(9, 15), h(10)),
    ]);
    expect(u.map((x) => x.columnas)).toEqual([2, 2, 2]);
  });

  it("un racimo no le quita ancho al siguiente", () => {
    const u = acomodar([
      pedazo("a", dia, h(8), h(9)),
      pedazo("b", dia, h(8), h(9)),
      pedazo("c", dia, h(11), h(12)),
    ]);
    expect(u.map((x) => [x.evento.id, x.columna, x.columnas])).toEqual([
      ["a", 0, 2],
      ["b", 1, 2],
      ["c", 0, 1],
    ]);
  });

  // Review Focus 4: ninguno puede desaparecer.
  it("seis superpuestos salen los seis, en seis columnas", () => {
    const u = acomodar(["a", "b", "c", "d", "e", "f"].map((id) => pedazo(id, dia, h(8), h(9))));
    expect(u).toHaveLength(6);
    expect(new Set(u.map((x) => x.columna)).size).toBe(6);
    expect(u.every((x) => x.columnas === 6)).toBe(true);
  });

  it("pedazos de días distintos no se superponen entre sí", () => {
    const u = acomodar([pedazo("a", "2026-11-04", h(8), h(9)), pedazo("b", "2026-11-05", h(8), h(9))]);
    expect(u.every((x) => x.columnas === 1 && x.columna === 0)).toBe(true);
  });

  it("los dos pedazos de un evento que cruza la medianoche no se estorban entre sí", () => {
    const p = partirPorDia(
      [
        ev("a", "2026-11-08T23:00:00-03:00", "2026-11-09T01:00:00-03:00"),
        ev("b", "2026-11-09T00:30:00-03:00", "2026-11-09T02:00:00-03:00"),
      ],
      ["2026-11-08", "2026-11-09"]
    );
    const u = acomodar(p);
    // el 08 sólo tiene el pedazo de "a" (todo el ancho); el 09 tiene el resto de "a" y "b" (a medias)
    expect(u.map((x) => [x.dia, x.evento.id, x.columna, x.columnas])).toEqual([
      ["2026-11-08", "a", 0, 1],
      ["2026-11-09", "a", 0, 2],
      ["2026-11-09", "b", 1, 2],
    ]);
  });

  it("el orden de entrada no cambia el resultado", () => {
    const fixture = [
      pedazo("a", dia, h(8), h(9, 30)),
      pedazo("b", dia, h(9), h(10)),
      pedazo("c", dia, h(9, 45), h(11)),
    ];
    const porId = (ps: PedazoDelDia[]) =>
      Object.fromEntries(acomodar(ps).map((x) => [x.evento.id, [x.columna, x.columnas]]));
    expect(porId([...fixture].reverse())).toEqual(porId(fixture));
  });

  // Con horarios idénticos lo único que decide quién queda a la izquierda es el
  // desempate por id: sin él, dos renders de la misma semana barajan las columnas.
  it("con horarios idénticos, quien queda en cada columna lo decide el id y no el orden de entrada", () => {
    const ps = [pedazo("c", dia, h(8), h(9)), pedazo("a", dia, h(8), h(9)), pedazo("b", dia, h(8), h(9))];
    const idsPorColumna = (entrada: PedazoDelDia[]) =>
      acomodar(entrada)
        .sort((x, y) => x.columna - y.columna)
        .map((x) => x.evento.id);
    expect(idsPorColumna(ps)).toEqual(["a", "b", "c"]);
    expect(idsPorColumna([...ps].reverse())).toEqual(["a", "b", "c"]);
  });

  it("todas las permutaciones de una semana apretada dan exactamente lo mismo", () => {
    const base = [
      pedazo("a", "2026-11-04", h(8), h(10)),
      pedazo("b", "2026-11-04", h(8), h(9)),
      pedazo("c", "2026-11-04", h(9), h(11)),
      pedazo("d", "2026-11-05", h(8), h(9)),
      pedazo("e", "2026-11-05", h(8), h(9)),
    ];
    const permutaciones = (xs: PedazoDelDia[]): PedazoDelDia[][] =>
      xs.length <= 1
        ? [xs]
        : xs.flatMap((x, i) => permutaciones([...xs.slice(0, i), ...xs.slice(i + 1)]).map((r) => [x, ...r]));
    const resumen = (ps: PedazoDelDia[]) => acomodar(ps).map((x) => [x.dia, x.evento.id, x.columna, x.columnas]);
    const esperado = resumen(base);
    for (const perm of permutaciones(base)) expect(resumen(perm)).toEqual(esperado);
  });

  it("no modifica lo que recibe", () => {
    const ps = [pedazo("b", dia, h(9), h(10)), pedazo("a", dia, h(8), h(9))];
    const copia = ps.map((p) => p.evento.id);
    acomodar(ps);
    expect(ps.map((p) => p.evento.id)).toEqual(copia);
  });

  it("conserva todos los datos del pedazo, no sólo la posición", () => {
    const entrada: PedazoDelDia = { ...pedazo("a", dia, 0, 30), vieneDeAntes: true, sigueDespues: true };
    const [u] = acomodar([entrada]);
    expect(u).toMatchObject({ evento: entrada.evento, dia, desdeMin: 0, hastaMin: 30, vieneDeAntes: true, sigueDespues: true });
  });

  // Los casos de arriba son los que se me ocurrieron; esto es para los que no.
  // Generador determinista (no Math.random: un test que falla distinto cada
  // corrida no se puede depurar).
  it("en cualquier semana, nadie desaparece, nadie se pisa y cada uno cabe en su racimo", () => {
    let semilla = 12345;
    const azar = (n: number) => {
      semilla = (semilla * 1103515245 + 12345) & 0x7fffffff;
      return semilla % n;
    };
    const dias = ["2026-11-02", "2026-11-03", "2026-11-04"];
    for (let ronda = 0; ronda < 200; ronda++) {
      const cuantos = 1 + azar(25);
      const ps: PedazoDelDia[] = Array.from({ length: cuantos }, (_, i) => {
        const desde = azar(1400);
        return pedazo(`e${i}`, dias[azar(dias.length)], desde, Math.min(1440, desde + MINUTOS_MINIMOS + azar(240)));
      });
      const u = acomodar(ps);

      expect(u).toHaveLength(ps.length);
      expect(new Set(u.map((x) => x.evento.id)).size).toBe(ps.length);
      for (const x of u) {
        expect(x.columna).toBeGreaterThanOrEqual(0);
        expect(x.columna).toBeLessThan(x.columnas);
      }
      for (let i = 0; i < u.length; i++) {
        for (let j = i + 1; j < u.length; j++) {
          const a = u[i];
          const b = u[j];
          const seSuperponen = a.dia === b.dia && a.desdeMin < b.hastaMin && b.desdeMin < a.hastaMin;
          if (seSuperponen) expect(a.columna).not.toBe(b.columna);
        }
      }
    }
  });
});
