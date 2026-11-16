import { describe, it, expect } from "vitest";
import {
  COLUMNAS,
  encabezadosDeLaPlantilla,
  leerFilaDeCliente,
  mapearColumnas,
  normalizarEncabezado,
  planDeImportacion,
  type ContextoDeImportacion,
} from "./importarClientes";

const VACIO: ContextoDeImportacion = {
  cuitsExistentes: new Set(),
  razonesExistentes: new Set(),
  usuariosPorNombre: new Map(),
};

const ctx = (parcial: Partial<ContextoDeImportacion>): ContextoDeImportacion => ({
  ...VACIO,
  ...parcial,
});

describe("normalizarEncabezado", () => {
  it("saca acentos, mayúsculas y espacios de más", () => {
    expect(normalizarEncabezado("  Razón   SOCIAL ")).toBe("razon social");
    expect(normalizarEncabezado("Teléfono")).toBe("telefono");
  });

  /**
   * La ñ no se descompone. `NFD` la parte en n + tilde y el filtro de
   * diacríticos se la comería, así que «Año» y «Ano» serían la misma columna.
   * Es una trampa que ya mordió en las búsquedas de este repo.
   */
  it("la ñ sobrevive como n y no se pierde la palabra", () => {
    expect(normalizarEncabezado("Año")).toBe("ano");
    expect(normalizarEncabezado("CAÑADA")).toBe("canada");
  });

  it("lo vacío y lo que no es texto no explotan", () => {
    expect(normalizarEncabezado(null)).toBe("");
    expect(normalizarEncabezado(undefined)).toBe("");
    expect(normalizarEncabezado(2026)).toBe("2026");
  });
});

describe("mapearColumnas", () => {
  it("reconoce los nombres de la plantilla", () => {
    const mapa = mapearColumnas(encabezadosDeLaPlantilla());
    expect(mapa.faltan).toEqual([]);
    expect(mapa.ignoradas).toEqual([]);
    expect(Object.keys(mapa.porCampo).length).toBe(COLUMNAS.length);
  });

  /**
   * El orden no importa y las de más se ignoran: es lo que evita que el mismo
   * contenido mudado de columna se lea como otra cosa, que es exactamente lo
   * que pasó con el Excel del cuaderno al mudarse de K:O a A:E en un día.
   */
  it("no le importa el orden, y las columnas de más caen en ignoradas", () => {
    const mapa = mapearColumnas(["CUIT", "Vendedor", "Razon Social", "Saldo", "Zona"]);
    expect(mapa.faltan).toEqual([]);
    expect(mapa.porCampo.razon_social).toBe("Razon Social");
    expect(mapa.porCampo.cuit).toBe("CUIT");
    expect(mapa.ignoradas).toEqual(["Saldo", "Zona"]);
  });

  it("acepta los alias", () => {
    const mapa = mapearColumnas(["Empresa", "e-mail", "Celular", "Observaciones"]);
    expect(mapa.porCampo.razon_social).toBe("Empresa");
    expect(mapa.porCampo.email).toBe("e-mail");
    expect(mapa.porCampo.telefono).toBe("Celular");
    expect(mapa.porCampo.notas).toBe("Observaciones");
  });

  it("dice cuál obligatoria falta, por su nombre de plantilla", () => {
    expect(mapearColumnas(["CUIT", "Localidad"]).faltan).toEqual(["Razón social"]);
  });

  /**
   * Gana la primera. Con la última, una columna vacía pegada al final taparía
   * a la que tiene los datos.
   */
  it("una columna repetida se toma de la primera y la otra se ignora", () => {
    const mapa = mapearColumnas(["Razón social", "Cliente"]);
    expect(mapa.porCampo.razon_social).toBe("Razón social");
    expect(mapa.ignoradas).toEqual(["Cliente"]);
  });

  it("las columnas sin encabezado no cuentan como ignoradas", () => {
    const mapa = mapearColumnas(["Razón social", "", null, "__EMPTY"]);
    expect(mapa.ignoradas).toEqual([]);
    expect(mapa.faltan).toEqual([]);
  });
});

describe("leerFilaDeCliente", () => {
  const mapa = mapearColumnas(encabezadosDeLaPlantilla());

  it("lee una fila completa", () => {
    const r = leerFilaDeCliente(
      {
        "Razón social": " Cal del Valle SRL ",
        CUIT: "30-71044963-1",
        Estado: "Activo",
        Localidad: "Olavarría",
        Correo: "compras@caldelvalle.com",
      },
      mapa,
      new Map()
    );
    expect(r.problemas).toEqual([]);
    expect(r.avisos).toEqual([]);
    expect(r.cliente).toMatchObject({
      razon_social: "Cal del Valle SRL",
      cuit: "30710449631",
      estado: "activo",
      localidad: "Olavarría",
      email: "compras@caldelvalle.com",
    });
  });

  it("sin razón social no hay cliente, y lo dice", () => {
    const r = leerFilaDeCliente({ CUIT: "30710449631" }, mapa, new Map());
    expect(r.cliente).toBeNull();
    expect(r.problemas[0]).toMatch(/razón social/i);
  });

  it("lo que no viene queda en null y no en texto vacío", () => {
    const r = leerFilaDeCliente({ "Razón social": "X", Localidad: "   " }, mapa, new Map());
    expect(r.cliente!.localidad).toBeNull();
    expect(r.cliente!.rubro).toBeNull();
  });

  it("sin columna de estado, entra como prospecto", () => {
    expect(leerFilaDeCliente({ "Razón social": "X" }, mapa, new Map()).cliente!.estado).toBe(
      "prospecto"
    );
  });

  /**
   * Nada se descarta en silencio: lo que no entra como vino sale en `avisos`
   * diciendo qué decía la celda.
   */
  it("un CUIT que no cierra entra igual, con aviso", () => {
    const corto = leerFilaDeCliente({ "Razón social": "X", CUIT: "3071044" }, mapa, new Map());
    expect(corto.cliente!.cuit).toBe("3071044");
    expect(corto.avisos[0]).toMatch(/once dígitos/);

    const malDigito = leerFilaDeCliente(
      { "Razón social": "X", CUIT: "30-71044963-9" },
      mapa,
      new Map()
    );
    expect(malDigito.cliente!.cuit).toBe("30710449639");
    expect(malDigito.avisos[0]).toMatch(/dígito verificador/);
  });

  it("un correo que no es correo deja el campo vacío y lo avisa", () => {
    const r = leerFilaDeCliente({ "Razón social": "X", Correo: "no tiene" }, mapa, new Map());
    expect(r.cliente!.email).toBeNull();
    expect(r.avisos[0]).toMatch(/no parece un correo/);
  });

  it("un estado que no se reconoce cae en prospecto y lo avisa", () => {
    const r = leerFilaDeCliente({ "Razón social": "X", Estado: "moroso" }, mapa, new Map());
    expect(r.cliente!.estado).toBe("prospecto");
    expect(r.avisos[0]).toMatch(/no se reconoce el estado/i);
  });

  it("reconoce las formas que suele escribir alguien a mano", () => {
    const leer = (estado: string) =>
      leerFilaDeCliente({ "Razón social": "X", Estado: estado }, mapa, new Map()).cliente!.estado;
    expect(leer("Cliente")).toBe("activo");
    expect(leer("EX CLIENTE")).toBe("inactivo");
    expect(leer("Baja")).toBe("inactivo");
  });

  /**
   * Enlazar al que se le parece es peor que dejar en null: un cliente asignado
   * a quien no es no se nota nunca, y el que tenía que atenderlo no lo ve.
   */
  it("el vendedor se cruza exacto, y si no, queda sin asignar con aviso", () => {
    const usuarios = new Map([["juan perez", "uuid-juan"]]);

    const exacto = leerFilaDeCliente(
      { "Razón social": "X", Vendedor: "  Juan  PÉREZ " },
      mapa,
      usuarios
    );
    expect(exacto.cliente!.vendedor_id).toBe("uuid-juan");
    expect(exacto.avisos).toEqual([]);

    const parecido = leerFilaDeCliente({ "Razón social": "X", Vendedor: "J. Perez" }, mapa, usuarios);
    expect(parecido.cliente!.vendedor_id).toBeNull();
    expect(parecido.avisos[0]).toMatch(/no se reconoce al vendedor/i);
  });

  it("un número de teléfono entra como texto y no como número", () => {
    const r = leerFilaDeCliente({ "Razón social": "X", Teléfono: 2954112233 }, mapa, new Map());
    expect(r.cliente!.telefono).toBe("2954112233");
  });
});

describe("planDeImportacion", () => {
  const ENC = encabezadosDeLaPlantilla();

  it("marca como nuevas las filas que se pueden crear", () => {
    const plan = planDeImportacion(
      [{ "Razón social": "Uno" }, { "Razón social": "Dos" }],
      ENC,
      VACIO
    );
    expect(plan.resumen).toEqual({ nuevas: 2, yaExisten: 0, repetidas: 0, conProblema: 0 });
    expect(plan.filas.map((f) => f.estado)).toEqual(["nueva", "nueva"]);
  });

  /** El encabezado es la fila 1 del Excel: los datos arrancan en la 2. */
  it("el número de fila es el del Excel, contando el encabezado", () => {
    const plan = planDeImportacion([{ "Razón social": "Uno" }, {}], ENC, VACIO);
    expect(plan.filas.map((f) => f.fila)).toEqual([2, 3]);
  });

  it("un cliente con el mismo CUIT que uno cargado no entra", () => {
    const plan = planDeImportacion(
      [{ "Razón social": "Otro nombre", CUIT: "30-71044963-1" }],
      ENC,
      ctx({ cuitsExistentes: new Set(["30710449631"]) })
    );
    expect(plan.filas[0].estado).toBe("ya_existe");
    expect(plan.resumen.nuevas).toBe(0);
  });

  it("sin CUIT, se compara por razón social normalizada", () => {
    const plan = planDeImportacion(
      [{ "Razón social": "  cal del VALLE srl " }],
      ENC,
      ctx({ razonesExistentes: new Set(["cal del valle srl"]) })
    );
    expect(plan.filas[0].estado).toBe("ya_existe");
  });

  /**
   * Con CUIT manda el CUIT: dos razones sociales distintas del mismo CUIT son
   * la misma empresa, y la misma razón social con CUITs distintos son dos.
   */
  it("teniendo CUIT, la razón social repetida no lo convierte en existente", () => {
    const plan = planDeImportacion(
      [{ "Razón social": "Cal del Valle SRL", CUIT: "30-71044963-1" }],
      ENC,
      ctx({ razonesExistentes: new Set(["cal del valle srl"]) })
    );
    expect(plan.filas[0].estado).toBe("nueva");
  });

  it("detecta el repetido dentro del mismo archivo, por CUIT y por nombre", () => {
    const porCuit = planDeImportacion(
      [
        { "Razón social": "Uno", CUIT: "30-71044963-1" },
        { "Razón social": "Uno bis", CUIT: "30710449631" },
      ],
      ENC,
      VACIO
    );
    expect(porCuit.filas.map((f) => f.estado)).toEqual(["nueva", "repetida"]);

    const porNombre = planDeImportacion(
      [{ "Razón social": "Dos" }, { "Razón social": "  DOS  " }],
      ENC,
      VACIO
    );
    expect(porNombre.filas.map((f) => f.estado)).toEqual(["nueva", "repetida"]);
  });

  it("una fila sin razón social es un problema y no se compara con nada", () => {
    const plan = planDeImportacion([{ CUIT: "30710449631" }], ENC, VACIO);
    expect(plan.filas[0].estado).toBe("con_problema");
    expect(plan.filas[0].cliente).toBeNull();
    expect(plan.resumen.conProblema).toBe(1);
  });

  /**
   * Sin la columna obligatoria no hay plan: decir «falta la razón social» en
   * cada fila diría algo falso sobre el contenido cuando lo que pasa es que el
   * encabezado no se reconoció.
   */
  it("si falta la columna obligatoria, no se arma ningún plan", () => {
    const plan = planDeImportacion([{ CUIT: "1" }, { CUIT: "2" }], ["CUIT"], VACIO);
    expect(plan.columnas.faltan).toEqual(["Razón social"]);
    expect(plan.filas).toEqual([]);
    expect(plan.resumen).toEqual({ nuevas: 0, yaExisten: 0, repetidas: 0, conProblema: 0 });
  });

  it("los avisos viajan aunque la fila no entre", () => {
    const plan = planDeImportacion(
      [{ "Razón social": "Uno", CUIT: "30-71044963-1", Correo: "nada" }],
      ENC,
      ctx({ cuitsExistentes: new Set(["30710449631"]) })
    );
    expect(plan.filas[0].estado).toBe("ya_existe");
    expect(plan.filas[0].avisos[0]).toMatch(/no parece un correo/);
  });

  /**
   * Volver a subir el mismo archivo no crea nada: es lo que hace que
   * reintentar después de un corte sea seguro.
   */
  it("es idempotente: el mismo archivo una segunda vez no crea nada", () => {
    const filas = [
      { "Razón social": "Uno", CUIT: "30-71044963-1" },
      { "Razón social": "Dos" },
    ];
    const primera = planDeImportacion(filas, ENC, VACIO);
    expect(primera.resumen.nuevas).toBe(2);

    const despues = ctx({
      cuitsExistentes: new Set(["30710449631"]),
      razonesExistentes: new Set(["dos"]),
    });
    const segunda = planDeImportacion(filas, ENC, despues);
    expect(segunda.resumen).toEqual({ nuevas: 0, yaExisten: 2, repetidas: 0, conProblema: 0 });
  });

  it("un archivo sin filas da un plan vacío y no un error", () => {
    const plan = planDeImportacion([], ENC, VACIO);
    expect(plan.filas).toEqual([]);
    expect(plan.columnas.faltan).toEqual([]);
  });
});
