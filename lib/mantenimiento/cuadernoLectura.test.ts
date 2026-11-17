import { describe, it, expect } from "vitest";
import {
  esquemaDeLaLectura, normalizarRenglones, PROMPT_DEL_CUADERNO, rescatarDelTexto,
} from "./cuadernoLectura";

/**
 * Los valores salen de la hoja real del 21 y 22 de septiembre de 2026, no de
 * números inventados: «= 920000» son pesos, «= 4» no dice qué es, y la llave
 * del 22 junta tres renglones bajo un solo «= 46 Hs».
 */
describe("el numero de la derecha", () => {
  it("un numero sin unidad son horas, y queda dudoso", () => {
    // «Tensar y alinear la misma = 4» — sin Hs y sin $.
    const { renglones } = normalizarRenglones(
      { renglones: [{ fecha: "2026-09-22", tarea: "Tensar y alinear la misma", valor: 4, unidad: null, linea: 11 }] },
      "2026-09"
    );
    expect(renglones[0].horas).toBe(4);
    expect(renglones[0].costo).toBeNull();
    expect(renglones[0].dudoso).toBe(true);
    expect(renglones[0].motivo_dudoso).toBeTruthy();
  });

  it("los pesos van al costo y no a las horas", () => {
    // «1 Empalme cinta 5 P/Trit N°1 = 920000»
    const { renglones } = normalizarRenglones(
      { renglones: [{ fecha: "2026-09-22", tarea: "1 Empalme cinta 5 P/Trit N°1", valor: 920000, unidad: "pesos", linea: 12 }] },
      "2026-09"
    );
    expect(renglones[0].costo).toBe(920000);
    expect(renglones[0].horas).toBeNull();
    expect(renglones[0].dudoso).toBe(false);
  });

  it("las horas con su unidad no son dudosas", () => {
    const { renglones } = normalizarRenglones(
      { renglones: [{ fecha: "2026-09-21", tarea: "Tranqueras D6", valor: 2, unidad: "horas", linea: 5 }] },
      "2026-09"
    );
    expect(renglones[0].horas).toBe(2);
    expect(renglones[0].costo).toBeNull();
    expect(renglones[0].dudoso).toBe(false);
    expect(renglones[0].motivo_dudoso).toBeNull();
  });

  it("el esquema no deja pasar horas ni costo sueltos: el contrato es valor y unidad", () => {
    // generateObject parsea con este esquema, y zod descarta las claves que no
    // declara: horas y costo no pueden llegar nunca a normalizarRenglones.
    const r = esquemaDeLaLectura.parse({
      renglones: [{ tarea: "Empalme", valor: 8, unidad: "horas", horas: 8, costo: 920000 }],
    });
    expect(r.renglones[0]).not.toHaveProperty("horas");
    expect(r.renglones[0]).not.toHaveProperty("costo");
    expect(r.renglones[0].valor).toBe(8);
  });

  it("un numero negativo no se toma como horas ni como costo, y queda dudoso", () => {
    const { renglones } = normalizarRenglones(
      { renglones: [{ fecha: "2026-09-21", tarea: "Tranqueras D6", valor: -2, unidad: "horas", linea: 5 }] },
      "2026-09"
    );
    expect(renglones[0].horas).toBeNull();
    expect(renglones[0].costo).toBeNull();
    expect(renglones[0].dudoso).toBe(true);
    expect(renglones[0].motivo_dudoso).toContain("negativo");
  });

  it("un renglon sin numero y fuera de una llave queda dudoso", () => {
    const { renglones } = normalizarRenglones(
      { renglones: [{ fecha: "2026-09-22", tarea: "Horno 4 Rastro", valor: null, unidad: null, linea: 13 }] },
      "2026-09"
    );
    expect(renglones[0].horas).toBeNull();
    expect(renglones[0].costo).toBeNull();
    expect(renglones[0].dudoso).toBe(true);
  });

  it("una llave deja las horas donde estan escritas y no las reparte", () => {
    // Los tres renglones del 22-09 con «} = 46 Hs».
    const { renglones } = normalizarRenglones({ renglones: [
      { fecha: "2026-09-22", tarea: "Trabajos en cinta 5 Reparación", valor: 46, unidad: "horas", en_llave: true, linea: 8 },
      { fecha: "2026-09-22", tarea: "Limpieza P/Trit N°1", valor: null, unidad: null, en_llave: true, linea: 9 },
      { fecha: "2026-09-22", tarea: "1 Parche metálico en descarga cono", valor: null, unidad: null, en_llave: true, linea: 10 },
    ] }, "2026-09");
    expect(renglones.map((r) => r.horas)).toEqual([46, null, null]);
    expect(renglones.every((r) => r.en_llave)).toBe(true);
    // Y no las marca dudosas: en una llave, el blanco es lo correcto.
    expect(renglones.map((r) => r.dudoso)).toEqual([false, false, false]);
  });
});

describe("la fecha", () => {
  it("una fecha imposible deja el renglon sin fecha y dudoso", () => {
    const { renglones } = normalizarRenglones(
      { renglones: [{ fecha: "2026-13-45", tarea: "Tranqueras D6", valor: 2, unidad: "horas", linea: 5 }] },
      "2026-09"
    );
    expect(renglones[0].fecha).toBeNull();
    expect(renglones[0].dudoso).toBe(true);
  });

  it("el 31 de un mes de treinta dias tampoco existe", () => {
    const { renglones } = normalizarRenglones(
      { renglones: [{ fecha: "2026-09-31", tarea: "Tranqueras D6", valor: 2, unidad: "horas" }] },
      "2026-09"
    );
    expect(renglones[0].fecha).toBeNull();
    expect(renglones[0].dudoso).toBe(true);
  });

  it("el ano de dos digitos se resuelve con el mes de la carga", () => {
    const { renglones } = normalizarRenglones(
      { renglones: [{ fecha: "21-09-26", tarea: "Colocar cartelería P/Trit N°1", valor: 8, unidad: "horas", linea: 2 }] },
      "2026-09"
    );
    expect(renglones[0].fecha).toBe("2026-09-21");
    expect(renglones[0].dudoso).toBe(false);
  });

  it("el siglo sale del mes de la carga y no esta fijo", () => {
    // Con un 2000 + yy fijo, la primera daria 2026 y la segunda 2126.
    const una = (fecha: string, mes: string) => normalizarRenglones(
      { renglones: [{ fecha, tarea: "Tranqueras D6", valor: 2, unidad: "horas" }] }, mes
    ).renglones[0];
    expect(una("21-09-26", "2126-09").fecha).toBe("2126-09-21");
    expect(una("21/09/26", "2026-09").fecha).toBe("2026-09-21");
    // Y un ano de cuatro digitos se respeta tal cual venga.
    expect(una("21-09-2026", "2026-09").fecha).toBe("2026-09-21");
  });

  it("una fecha que el modelo no pudo leer queda en null y dudosa", () => {
    const { renglones } = normalizarRenglones(
      { renglones: [{ fecha: null, tarea: "Tranqueras D6", valor: 2, unidad: "horas" }] },
      "2026-09"
    );
    expect(renglones[0].fecha).toBeNull();
    expect(renglones[0].dudoso).toBe(true);
  });

  it("una fecha fuera del mes de la carga se conserva pero se marca", () => {
    // No se tira un dato que puede ser cierto: se muestra para que alguien lo mire.
    const { renglones } = normalizarRenglones(
      { renglones: [{ fecha: "2026-10-02", tarea: "Tranqueras D6", valor: 2, unidad: "horas" }] },
      "2026-09"
    );
    expect(renglones[0].fecha).toBe("2026-10-02");
    expect(renglones[0].dudoso).toBe(true);
  });
});

describe("lo que no es una lista de renglones", () => {
  it("una respuesta que no es la lista esperada se denuncia entera", () => {
    const r = normalizarRenglones("no entendí la foto", "2026-09");
    expect(r.renglones).toHaveLength(0);
    expect(r.problemas[0]).toContain("no entendí la foto");
  });

  it("un objeto sin la lista se denuncia con lo que dijo", () => {
    const r = normalizarRenglones({ error: "la imagen esta borrosa" }, "2026-09");
    expect(r.renglones).toHaveLength(0);
    expect(r.problemas[0]).toContain("la imagen esta borrosa");
  });

  it("una lista vacia no es un problema: la hoja puede no tener renglones", () => {
    const r = normalizarRenglones({ renglones: [] }, "2026-09");
    expect(r.renglones).toHaveLength(0);
    expect(r.problemas).toHaveLength(0);
  });
});

describe("lo que no se entiende no se tira en silencio", () => {
  it("un renglon sin tarea no entra, y queda dicho", () => {
    const r = normalizarRenglones(
      { renglones: [
        { fecha: "2026-09-21", tarea: "   ", valor: 2, unidad: "horas", linea: 4 },
        { fecha: "2026-09-21", tarea: "Tranqueras D6", valor: 2, unidad: "horas", linea: 5 },
      ] },
      "2026-09"
    );
    expect(r.renglones.map((x) => x.tarea)).toEqual(["Tranqueras D6"]);
    expect(r.problemas).toHaveLength(1);
    expect(r.problemas[0]).toContain("la línea 4");
  });

  it("un renglon mal formado pero con tarea entra dudoso con lo que dijo el esquema", () => {
    const r = normalizarRenglones(
      { renglones: [{ fecha: "2026-09-21", tarea: "Tranqueras D6", valor: "dos horas", unidad: "horas", linea: 5 }] },
      "2026-09"
    );
    expect(r.renglones).toHaveLength(1);
    expect(r.renglones[0].tarea).toBe("Tranqueras D6");
    expect(r.renglones[0].dudoso).toBe(true);
    expect(r.renglones[0].motivo_dudoso).toContain("valor");
    expect(r.problemas[0]).toContain("valor");
  });

  it("un renglon con un campo mal formado conserva los que si validan y dice lo que dijo el modelo", () => {
    // `linea` llega como texto: no debe llevarse con ella la fecha ni las horas.
    const r = normalizarRenglones(
      { renglones: [{ fecha: "2026-09-21", tarea: "Tranqueras D6", lugar: "D6", valor: 2, unidad: "horas", linea: "11" }] },
      "2026-09"
    );
    expect(r.renglones).toHaveLength(1);
    expect(r.renglones[0]).toMatchObject({
      fecha: "2026-09-21", lugar_raw: "D6", horas: 2, costo: null, linea: null, dudoso: true,
    });
    expect(r.renglones[0].motivo_dudoso).toContain("linea");
    // Con lo que dijo el modelo, sin traducir: el "11" que no se pudo leer como numero.
    expect(r.renglones[0].motivo_dudoso).toContain('"linea":"11"');
    expect(r.problemas[0]).toContain('"linea":"11"');
  });

  it("una unidad ilegible se lleva el numero: un importe no puede entrar como horas", () => {
    const r = normalizarRenglones(
      { renglones: [{ fecha: "2026-09-22", tarea: "1 Empalme cinta 5 P/Trit N°1", valor: 920000, unidad: "pesos argentinos", linea: 12 }] },
      "2026-09"
    );
    expect(r.renglones).toHaveLength(1);
    expect(r.renglones[0].horas).toBeNull();
    expect(r.renglones[0].costo).toBeNull();
    expect(r.renglones[0].dudoso).toBe(true);
    expect(r.renglones[0].motivo_dudoso).toContain("unidad");
    expect(r.renglones[0].motivo_dudoso).toContain("pesos argentinos");
    // El resto de lo leido se conserva.
    expect(r.renglones[0]).toMatchObject({ fecha: "2026-09-22", linea: 12 });
  });

  it("un renglon que el modelo marco como dudoso lo sigue estando, con su motivo", () => {
    const { renglones } = normalizarRenglones(
      { renglones: [{ fecha: "2026-09-21", tarea: "Rep. ??? de cinta", valor: 6, unidad: "horas",
        dudoso: true, motivo_dudoso: "la palabra esta tachada" }] },
      "2026-09"
    );
    expect(renglones[0].dudoso).toBe(true);
    expect(renglones[0].motivo_dudoso).toContain("la palabra esta tachada");
  });
});

describe("lo que se copia tal cual", () => {
  it("las comillas que heredan vienen marcadas", () => {
    // `"  "  5 P/ " " 1` es «reparar rodillos 2/cinta 5 P/Trit N°1»
    const { renglones } = normalizarRenglones(
      { renglones: [{ fecha: "2026-09-21", tarea: "Reparar rodillos 2/cinta 5", lugar: "P/Trit N°1",
        valor: 6, unidad: "horas", heredado: true, linea: 4 }] },
      "2026-09"
    );
    expect(renglones[0].heredado).toBe(true);
    expect(renglones[0].dudoso).toBe(false);
  });

  it("el lugar va como esta escrito, sin interpretar", () => {
    const { renglones } = normalizarRenglones(
      { renglones: [
        { fecha: "2026-09-21", tarea: "Tranqueras D6", lugar: "  D6 ", valor: 2, unidad: "horas" },
        { fecha: "2026-09-22", tarea: "Horno 4 Rastro", lugar: "Molino cal", valor: 8, unidad: "horas" },
      ] },
      "2026-09"
    );
    expect(renglones.map((r) => r.lugar_raw)).toEqual(["D6", "Molino cal"]);
  });

  it("sin lugar el renglon no es dudoso: el enganche dira sin sector", () => {
    const { renglones } = normalizarRenglones(
      { renglones: [{ fecha: "2026-09-21", tarea: "Tranqueras", valor: 2, unidad: "horas" }] },
      "2026-09"
    );
    expect(renglones[0].lugar_raw).toBe("");
    expect(renglones[0].dudoso).toBe(false);
  });

  it("el numero de linea que no es un entero positivo se descarta", () => {
    const { renglones } = normalizarRenglones(
      { renglones: [
        { fecha: "2026-09-21", tarea: "A", valor: 1, unidad: "horas", linea: 3 },
        { fecha: "2026-09-21", tarea: "B", valor: 1, unidad: "horas", linea: 2.5 },
        { fecha: "2026-09-21", tarea: "C", valor: 1, unidad: "horas" },
      ] },
      "2026-09"
    );
    expect(renglones.map((r) => r.linea)).toEqual([3, null, null]);
  });
});

describe("el contrato con el modelo", () => {
  it("el esquema pide un valor y una unidad, y no horas y costo por separado", () => {
    const campos = Object.keys(esquemaDeLaLectura.shape.renglones.element.shape);
    expect(campos).toContain("valor");
    expect(campos).toContain("unidad");
    expect(campos).not.toContain("horas");
    expect(campos).not.toContain("costo");
  });

  it("el prompt nombra las rarezas del papel", () => {
    const p = PROMPT_DEL_CUADERNO.toLowerCase();
    expect(p).toContain("son pesos");                  // «= 920000» no son horas
    expect(p).toContain("reúne varios renglones");     // la llave
    expect(p).toContain("repiten lo del renglón de arriba"); // las comillas
    expect(p).toContain("sin traducir ni interpretar"); // el lugar va como está
    expect(p).toContain("pedí el número de línea");    // para volver al papel
    expect(p).toContain("trae varios días");           // el día es un encabezado
    expect(p).toContain("cualquiera de ellos");        // la llave no promete posición
  });
});

describe("rescatarDelTexto", () => {
  it("una lista con un renglon raro rescata los renglones y marca el raro dudoso", () => {
    // El texto que `generateObject` deja en el error cuando un renglon no valida.
    const texto = JSON.stringify({ renglones: [
      { fecha: "2026-09-21", tarea: "Tranqueras", lugar: "D6", valor: 2, unidad: "horas", linea: 5 },
      { fecha: "2026-09-22", tarea: "Tensar y alinear la misma", valor: "4", unidad: "horas", linea: "11" },
    ] });
    const r = rescatarDelTexto(texto, "2026-09");
    expect(r.esJson).toBe(true);
    expect(r.renglones).toHaveLength(2);
    expect(r.renglones[0].dudoso).toBe(false);
    expect(r.renglones[1].dudoso).toBe(true);
    expect(r.renglones[1].motivo_dudoso).toContain("formato inesperado");
    expect(r.problemas).toHaveLength(1);
  });

  it("la prosa no se rescata y el mensaje dice que no era JSON, con lo que dijo el modelo", () => {
    const r = rescatarDelTexto("Lo siento, no puedo leer la foto.", "2026-09");
    expect(r.esJson).toBe(false);
    expect(r.renglones).toEqual([]);
    expect(r.problemas[0]).toContain("no devolvió una lista en JSON");
    expect(r.problemas[0]).toContain("Lo siento, no puedo leer la foto.");
    expect(r.crudo).toEqual({ texto_sin_validar: "Lo siento, no puedo leer la foto." });
  });

  it("un JSON cortado a la mitad cuenta como no-JSON", () => {
    const r = rescatarDelTexto('{"renglones":[{"tarea":"Tensar"', "2026-09");
    expect(r.esJson).toBe(false);
    expect(r.renglones).toEqual([]);
  });

  it("un JSON que no es la lista esperada es JSON, pero se denuncia entero", () => {
    const r = rescatarDelTexto('{"hojas": []}', "2026-09");
    expect(r.esJson).toBe(true);
    expect(r.renglones).toEqual([]);
    expect(r.problemas[0]).toContain("no es la lista de renglones esperada");
  });

  it("tolera la valla de codigo que algunos modelos agregan", () => {
    const r = rescatarDelTexto("```json\n" + JSON.stringify({ renglones: [{ tarea: "Tranqueras", valor: 2, unidad: "horas", fecha: "2026-09-21" }] }) + "\n```", "2026-09");
    expect(r.esJson).toBe(true);
    expect(r.renglones).toHaveLength(1);
  });
});

/**
 * El tope de horas. Medido el 02/11/2026 sobre las diez páginas reales: «= 18 Hs»
 * salió como 1845 horas porque el modelo pegó la unidad al número, y entró sin
 * ninguna marca. El valor legítimo más grande del cuaderno es 46 h (una llave de
 * tres tareas); 200 deja pasar cualquier llave y atrapa un dígito pegado.
 */
describe("un número de horas que no puede ser", () => {
  const una = (valor: number, unidad: "horas" | "pesos" | null) =>
    normalizarRenglones(
      { renglones: [{ fecha: "2026-09-15", tarea: "Cartelería P/Trit N°3", valor, unidad, linea: 5 }] },
      "2026-09"
    ).renglones[0];

  it("1845 horas entra igual, dudoso, y el motivo nombra el número", () => {
    const r = una(1845, "horas");
    expect(r.horas).toBe(1845); // no se descarta ni se redondea
    expect(r.dudoso).toBe(true);
    expect(r.motivo_dudoso).toContain("1845");
  });

  it("46 horas —el máximo real, una llave— no levanta la mano", () => {
    const r = una(46, "horas");
    expect(r.horas).toBe(46);
    expect(r.dudoso).toBe(false);
  });

  it("200 horas pasa y 201 no: el tope es inclusivo", () => {
    expect(una(200, "horas").dudoso).toBe(false);
    expect(una(201, "horas").dudoso).toBe(true);
  });

  it("un importe grande es normal: 920000 pesos no es dudoso por grande", () => {
    const r = una(920000, "pesos");
    expect(r.costo).toBe(920000);
    expect(r.dudoso).toBe(false);
  });

  it("un número grande sin unidad se toma como horas y suma los dos motivos", () => {
    const r = una(1845, null);
    expect(r.horas).toBe(1845);
    expect(r.motivo_dudoso).toContain("no trae unidad");
    expect(r.motivo_dudoso).toContain("1845");
  });
});

/**
 * Medido contra el papel real: el encabezado del 21/09 está pisado a mano y el
 * modelo lo leyó 24 las dos corridas, sin marcar nada. Un 24 dentro de
 * septiembre pasa todas las demás validaciones; lo que lo delata es que la
 * hoja corre hacia adelante y el día siguiente aparece «antes».
 */
describe("un día fuera de orden", () => {
  const reng = (fecha: string, linea: number, tarea = `Tarea ${linea}`) =>
    ({ fecha, tarea, valor: 2, unidad: "horas" as const, linea });

  it("el día que vuelve para atrás queda dudoso, y el motivo nombra las dos fechas", () => {
    const { renglones } = normalizarRenglones(
      { renglones: [reng("2026-09-24", 1), reng("2026-09-24", 2), reng("2026-09-22", 3)] },
      "2026-09"
    );
    expect(renglones[0].dudoso).toBe(false);
    expect(renglones[1].dudoso).toBe(false);
    expect(renglones[2].dudoso).toBe(true);
    expect(renglones[2].motivo_dudoso).toContain("2026-09-22");
    expect(renglones[2].motivo_dudoso).toContain("2026-09-24");
  });

  it("los días que avanzan, o se repiten, no levantan la mano", () => {
    const { renglones } = normalizarRenglones(
      { renglones: [reng("2026-09-21", 1), reng("2026-09-21", 2), reng("2026-09-22", 3), reng("2026-09-22", 4)] },
      "2026-09"
    );
    expect(renglones.map((r) => r.dudoso)).toEqual([false, false, false, false]);
  });

  it("sólo marca el renglón donde el día vuelve para atrás, no todos los que siguen", () => {
    const { renglones } = normalizarRenglones(
      { renglones: [reng("2026-09-24", 1), reng("2026-09-22", 2), reng("2026-09-22", 3), reng("2026-09-23", 4)] },
      "2026-09"
    );
    expect(renglones.map((r) => r.dudoso)).toEqual([false, true, false, false]);
  });

  it("un renglón sin fecha legible no cuenta como el de arriba: se compara con el último que sí tiene", () => {
    const { renglones } = normalizarRenglones(
      {
        renglones: [
          reng("2026-09-24", 1),
          { fecha: null, tarea: "Ilegible", valor: 2, unidad: "horas", linea: 2 },
          reng("2026-09-22", 3),
        ],
      },
      "2026-09"
    );
    expect(renglones[2].dudoso).toBe(true);
    expect(renglones[2].motivo_dudoso).toContain("2026-09-24");
  });

  it("suma el motivo a los que ya tenía el renglón", () => {
    const { renglones } = normalizarRenglones(
      { renglones: [reng("2026-09-24", 1), { ...reng("2026-09-22", 2), valor: 4, unidad: null }] },
      "2026-09"
    );
    expect(renglones[1].motivo_dudoso).toContain("no trae unidad");
    expect(renglones[1].motivo_dudoso).toContain("2026-09-24");
  });
});
