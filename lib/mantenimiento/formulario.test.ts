import { describe, it, expect } from "vitest";
import {
  indiceDeColumnas, laSerieEstaCongelada, maximoDeLaSerie, celdasDelAlta,
  loQueSigueEnLaSerie, laFilaEstaLibre,
} from "./formulario";

/**
 * El encabezado real de «Respuestas de formulario», leido con la cuenta de
 * servicio el 14/10/2026. Las catorce "EQUIPO QUE SOLICITA" son una por sector
 * y «DÓNDE SE SOLICITA» esta en el medio de ellas: asi es la hoja.
 */
const ENCABEZADO = [
  "N° OT", "Marca temporal", "Dirección de correo electrónico", "NOMBRE", "APELLIDO",
  "SECTOR QUE SOLICITA",
  "EQUIPO QUE SOLICITA", "EQUIPO QUE SOLICITA", "EQUIPO QUE SOLICITA",
  "EQUIPO QUE SOLICITA", "EQUIPO QUE SOLICITA", "EQUIPO QUE SOLICITA",
  "EQUIPO QUE SOLICITA", "EQUIPO QUE SOLICITA", "EQUIPO QUE SOLICITA",
  "EQUIPO QUE SOLICITA", "EQUIPO QUE SOLICITA", "EQUIPO QUE SOLICITA",
  "DÓNDE SE SOLICITA",
  "EQUIPO QUE SOLICITA", "EQUIPO QUE SOLICITA",
  "ESPECIALIDAD", "TIPO DE TRABAJO", "QUIÉN LO REALIZA",
  "DESCRIPCIÓN DEL TRABAJO", "REPUESTO UTILIZADO", "FECHA COMPROMETIDA",
  "Puntuación", "PRIORIDAD",
];

const datos = {
  ot_number: 2786,
  email: "rocco@polcecal.com",
  nombre: "Rocco",
  apellido: "Gimenez",
  creado: new Date("2026-10-14T12:30:00Z"),
  sector: "Planta filler 1",
  equipo: "PY-A1-05 – Rompedora a martillos",
  especialidad: "MECÁNICO",
  tipo: "PROGRAMADO",
  quien: "INTERNO",
  descripcion: "Reemplazo de grillas",
  repuesto: null,
  fecha_ejecucion: "2026-10-20",
  prioridad: "🟠 Alta",
};

const valorDe = (celdas: { columna: number; valor: string | number }[], col: number) =>
  celdas.find((c) => c.columna === col)?.valor;

describe("en que columna esta cada cosa", () => {
  it("las ubica por el nombre del encabezado", () => {
    const i = indiceDeColumnas(ENCABEZADO);
    expect(i.nro).toBe(0);           // A
    expect(i.marca).toBe(1);         // B
    expect(i.sector).toBe(5);        // F
    expect(i.especialidad).toBe(21); // V
    expect(i.descripcion).toBe(24);  // Y
    expect(i.fecha).toBe(26);        // AA
    expect(i.prioridad).toBe(28);    // AC
  });

  /** Catorce columnas iguales; al master llegan aplanadas, asi que da igual. */
  it("el equipo va a la primera de las catorce", () => {
    expect(indiceDeColumnas(ENCABEZADO).equipo).toBe(6); // G
  });

  /**
   * Una pregunta nueva corre todo lo que esta a su derecha. Por eso se busca
   * por nombre y no por posicion.
   */
  it("una pregunta nueva adelante no desacomoda nada", () => {
    const conUnaMas = ["N° OT", "Marca temporal", "TURNO", ...ENCABEZADO.slice(2)];
    const i = indiceDeColumnas(conUnaMas);
    expect(i.descripcion).toBe(25);
    expect(i.prioridad).toBe(29);
  });

  it("lo que no esta da -1 y no cero", () => {
    expect(indiceDeColumnas(["N° OT"]).descripcion).toBe(-1);
  });
});

/**
 * La precondicion. Con una sola formula viva, la cadena es relativa y renumera
 * todo lo de abajo en cuanto Forms inserte una fila en el medio.
 */
describe("si la serie esta congelada", () => {
  it("todos literales: si", () => {
    expect(laSerieEstaCongelada([["622"], ["623"], ["624"]])).toBe(true);
  });

  it("una sola formula alcanza para que no", () => {
    expect(laSerieEstaCongelada([["622"], ['=IF(B3:B<>"",A2+1,"")'], ["624"]])).toBe(false);
  });

  it("las vacias no opinan", () => {
    expect(laSerieEstaCongelada([["622"], [], [""]])).toBe(true);
    expect(laSerieEstaCongelada([])).toBe(true);
  });
});

describe("el maximo de la serie", () => {
  it("es de donde sale el siguiente numero", () => {
    expect(maximoDeLaSerie([["N° OT"], ["622"], ["2783"], ["2785"]])).toBe(2785);
  });

  it("no se deja confundir por el encabezado ni por los huecos", () => {
    expect(maximoDeLaSerie([["N° OT"], [], ["7"], [""]])).toBe(7);
  });

  it("sin nada da cero", () => {
    expect(maximoDeLaSerie([])).toBe(0);
  });
});

describe("las celdas del alta", () => {
  it("escribe cada dato en su columna", () => {
    const r = celdasDelAlta(ENCABEZADO, datos);
    if (!r.ok) throw new Error(r.motivos.join(" · "));

    expect(valorDe(r.celdas, 0)).toBe(2786);
    expect(valorDe(r.celdas, 5)).toBe("Planta filler 1");
    expect(valorDe(r.celdas, 6)).toBe("PY-A1-05 – Rompedora a martillos");
    expect(valorDe(r.celdas, 24)).toBe("Reemplazo de grillas");
    expect(valorDe(r.celdas, 28)).toBe("🟠 Alta");
  });

  /** Un "20/10/2026" lo interpreta la planilla segun su locale. */
  it("las fechas van como serial, no como texto", () => {
    const r = celdasDelAlta(ENCABEZADO, datos);
    if (!r.ok) throw new Error("no armó");
    expect(typeof valorDe(r.celdas, 1)).toBe("number");  // marca temporal
    expect(typeof valorDe(r.celdas, 26)).toBe("number"); // fecha comprometida
  });

  /**
   * QUIEN LA PIDIO, desde el 18/10/2026.
   *
   * Estas tres columnas quedaban vacias a proposito, con esta razon escrita:
   * "poner algo en el mail o el nombre seria decir que alguien contesto el
   * formulario". Esa razon se murio cuando el alta se mudo a su propia
   * pestana: una fila en «Altas del sistema» no dice que nadie contesto nada,
   * dice que el sistema la creo, y ahi saber quien fue es informacion.
   */
  it("escribe quien la pidio en el correo, el nombre y el apellido", () => {
    const r = celdasDelAlta(ENCABEZADO, datos);
    if (!r.ok) throw new Error(r.motivos.join(" · "));
    expect(valorDe(r.celdas, 2)).toBe("rocco@polcecal.com");
    expect(valorDe(r.celdas, 3)).toBe("Rocco");
    expect(valorDe(r.celdas, 4)).toBe("Gimenez");
  });

  /** La puntuacion sigue siendo del formulario: esa no se toca. */
  it("no toca la puntuacion, que no es nuestra", () => {
    const r = celdasDelAlta(ENCABEZADO, datos);
    if (!r.ok) throw new Error("no armó");
    expect(r.celdas.some((c) => c.columna === 27)).toBe(false);
  });

  /**
   * Un usuario sin apellido cargado existe. No se escribe nada en esa celda,
   * que es la misma convencion que el repuesto y la fecha: en una fila nueva
   * no escribir y escribir "" son lo mismo, y lo que importa es que no entre
   * un "undefined" en una planilla que mira gente.
   */
  it("lo que el usuario no tenga cargado no se escribe", () => {
    const r = celdasDelAlta(ENCABEZADO, { ...datos, apellido: null, nombre: null });
    if (!r.ok) throw new Error("no armó");
    expect(r.celdas.some((c) => c.columna === 3)).toBe(false);
    expect(r.celdas.some((c) => c.columna === 4)).toBe(false);
  });

  it("un campo vacio no se escribe", () => {
    const r = celdasDelAlta(ENCABEZADO, { ...datos, repuesto: null, fecha_ejecucion: null });
    if (!r.ok) throw new Error("no armó");
    expect(r.celdas.some((c) => c.columna === 25)).toBe(false);
    expect(r.celdas.some((c) => c.columna === 26)).toBe(false);
  });

  it("sin las columnas imprescindibles se niega, y dice cuales", () => {
    const r = celdasDelAlta(["N° OT", "Marca temporal"], datos);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.motivos[0]).toContain("descripcion");
  });

  /** NaN escrito es "NaN", y queda para siempre en una fila que no se
   * distingue de una respuesta de verdad. */
  it("una fecha de creacion invalida se niega en vez de escribir NaN", () => {
    const r = celdasDelAlta(ENCABEZADO, { ...datos, creado: new Date("no es una fecha") });
    expect(r.ok).toBe(false);
  });
});

/**
 * EL INCIDENTE DEL 16/10/2026, y por qué esta funcion existe.
 *
 * La OT 2796 se creo desde el sistema y no llego a la planilla. La serie
 * seguia sin congelar, asi que la guarda se nego a escribir —bien— pero el
 * numero ya se habia tomado: la OT quedo en la base con el 2796 y la hoja de
 * respuestas segui­a con 2795 arriba de todo. La siguiente respuesta del
 * formulario iba a numerarse 2796 tambien (el Apps Script cuenta max(A)+1), y
 * el upsert por `ot_number` de la sincronizacion habria pisado la de la app
 * con la del formulario, sin avisar.
 *
 * La raiz no era la guarda: era que el numero salia de una lectura y la fila
 * de otra, con una escritura en el medio que podia no pasar. Acá salen las
 * dos de la misma, y si no se puede escribir no se consume nada.
 */
describe("lo que sigue en la serie", () => {
  const form = [["N° OT"], ["622"], ["2794"], ["2795"]];
  const sinAltas = [["N° OT"]];

  it("el numero y la fila salen de la misma lectura", () => {
    const r = loQueSigueEnLaSerie(form, sinAltas);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.ot_number).toBe(2796);
    expect(r.fila).toBe(2);
  });

  /**
   * La serie quedo repartida entre dos hojas el 16/10/2026, asi que contar una
   * sola es repartir un numero que la otra ya uso.
   */
  it("el maximo sale de las dos pestanas, no de una", () => {
    const r = loQueSigueEnLaSerie([["N° OT"], ["2795"]], [["N° OT"], ["2796"], ["2797"]]);
    expect(r.ok && r.ot_number).toBe(2798);
  });

  it("si el maximo esta en el formulario, tambien", () => {
    const r = loQueSigueEnLaSerie([["N° OT"], ["2799"]], [["N° OT"], ["2796"]]);
    expect(r.ok && r.ot_number).toBe(2800);
  });

  /** Se escribe en las altas, asi que la fila es de esa hoja y no del formulario. */
  it("la fila es la de las altas, no la del formulario", () => {
    const largo = Array.from({ length: 2175 }, (_, i) => [String(600 + i)]);
    const r = loQueSigueEnLaSerie(largo, [["N° OT"], ["2796"], ["2797"]]);
    expect(r.ok && r.fila).toBe(4);
  });

  it("con las altas vacias se empieza en la fila 2", () => {
    const r = loQueSigueEnLaSerie([["N° OT"], ["2795"]], sinAltas);
    expect(r.ok && r.fila).toBe(2);
    expect(r.ok && r.ot_number).toBe(2796);
  });

  /**
   * La cadena de formulas vive en el formulario; la hoja de altas la escribe el
   * sistema con literales. El mensaje tiene que mandar a la que hay que tocar.
   */
  it("una formula viva en el formulario frena, y nombra esa pestana", () => {
    const r = loQueSigueEnLaSerie([["N° OT"], ["622"], ['=A2+1']], sinAltas);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toContain("Respuestas de formulario");
    expect(r.error).not.toContain("Altas del sistema");
  });

  it("una hoja recien hecha empieza en 1", () => {
    const r = loQueSigueEnLaSerie([["N° OT"]], sinAltas);
    expect(r.ok && r.ot_number).toBe(1);
    expect(r.ok && r.fila).toBe(2);
  });

  /** Un hueco no corre la fila ni saltea el numero. */
  it("un hueco en el medio no desacomoda ninguna de las dos", () => {
    const r = loQueSigueEnLaSerie(form, [["N° OT"], ["2796"], [], ["2797"]]);
    expect(r.ok && r.ot_number).toBe(2798);
    expect(r.ok && r.fila).toBe(5);
  });
});

/**
 * La guarda de concurrencia. Dos altas al mismo tiempo leen la misma columna y
 * calculan la misma fila libre; sin esto, la segunda pisa a la primera y la OT
 * que se perdio no deja rastro en ningun lado.
 */
describe("la fila donde va el alta tiene que estar libre", () => {
  it("una fila con algo no esta libre", () => {
    expect(laFilaEstaLibre([["2798"]])).toBe(false);
  });

  it("vacia, sin celdas o con espacios, si", () => {
    expect(laFilaEstaLibre([[""]])).toBe(true);
    expect(laFilaEstaLibre([])).toBe(true);
    expect(laFilaEstaLibre([["   "]])).toBe(true);
    expect(laFilaEstaLibre([[]])).toBe(true);
  });
});

/**
 * Sin encabezado no se escribe. La pestana "Altas del sistema" la crea una
 * persona a mano, asi que existir sin encabezado es un estado real y no una
 * hipotesis: escribir ahi dejaria una fila con los datos en cualquier columna.
 */
describe("si la pestana de altas esta sin encabezado", () => {
  it("se niega y dice que columnas faltan", () => {
    const r = celdasDelAlta([], datos);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.motivos.join(" ")).toContain("descripcion");
  });
});
