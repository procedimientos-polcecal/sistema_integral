import { describe, it, expect } from "vitest";
import {
  indiceDeColumnas, laSerieEstaCongelada, maximoDeLaSerie, celdasDelAlta,
  loQueSigueEnLaSerie,
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
   * Las columnas que no son nuestras quedan vacias: poner algo en el mail o el
   * nombre seria decir que alguien contesto el formulario.
   */
  it("no toca las columnas del formulario que no le corresponden", () => {
    const r = celdasDelAlta(ENCABEZADO, datos);
    if (!r.ok) throw new Error("no armó");
    for (const ajena of [2, 3, 4, 27]) {
      expect(r.celdas.some((c) => c.columna === ajena)).toBe(false);
    }
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
  const congelada = [["N° OT"], ["622"], ["2794"], ["2795"]];

  it("el numero y la fila salen de la misma lectura", () => {
    const r = loQueSigueEnLaSerie(congelada);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.ot_number).toBe(2796);
    expect(r.fila).toBe(5);
  });

  /** Con una formula viva no se da numero: darlo es lo que lo quemaba. */
  it("si la serie no esta congelada no hay numero, y dice por que", () => {
    const r = loQueSigueEnLaSerie([["N° OT"], ["622"], ['=A2+1']]);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toContain("fórmula");
  });

  /** Una pestana con solo el encabezado: la serie arranca y la fila es la 2. */
  it("una hoja recien hecha empieza en 1", () => {
    const r = loQueSigueEnLaSerie([["N° OT"]]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.ot_number).toBe(1);
    expect(r.fila).toBe(2);
  });

  /**
   * Los huecos del medio no corren la fila ni saltean el numero: la fila es la
   * siguiente a la ultima con algo, y el numero el maximo mas uno.
   */
  it("un hueco en el medio no desacomoda ninguna de las dos", () => {
    const r = loQueSigueEnLaSerie([["N° OT"], ["622"], [], ["2795"]]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.ot_number).toBe(2796);
    expect(r.fila).toBe(5);
  });
});
