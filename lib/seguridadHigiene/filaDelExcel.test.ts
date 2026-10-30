import { describe, it, expect } from "vitest";
import {
  sectorDe,
  personaDe,
  condicionDeLaFila,
  type FilaDelExcel,
  type Sector,
  type Persona,
} from "./filaDelExcel";

// Los nombres de los sectores son los del catálogo real (medido el 30/10/2026),
// no inventados: el riesgo de este archivo es justamente que el enlace funcione
// con los nombres de juguete y se equivoque con los de verdad.
const CATALOGO: Sector[] = [
  { id: "taller", nombre: "Taller", activo: true },
  { id: "filler1", nombre: "Planta filler 1", activo: true },
  { id: "filler2", nombre: "Planta filler 2", activo: true },
  { id: "p02mm", nombre: "Planta 0-2 mm", activo: true },
  { id: "trit2", nombre: "Planta de trituración 2", activo: true },
  { id: "trit3", nombre: "Planta de trituración 3", activo: true },
  { id: "molienda", nombre: "Molienda de cal", activo: true },
  { id: "calcinacion", nombre: "Calcinación", activo: true },
  // Hay tres «Administración» en el catálogo y dos están dadas de baja.
  { id: "adm-vieja", nombre: "Administración", activo: false },
  { id: "adm-vieja-2", nombre: "Administración", activo: false },
  { id: "adm", nombre: "Administración", activo: true },
];

describe("sectorDe", () => {
  it("enlaza cuando el nombre coincide, ignorando mayúsculas, acentos y espacios de más", () => {
    expect(sectorDe("Taller", CATALOGO)).toBe("taller");
    expect(sectorDe("Taller  ", CATALOGO)).toBe("taller");
    expect(sectorDe("calcinacion", CATALOGO)).toBe("calcinacion");
    expect(sectorDe("  CALCINACIÓN ", CATALOGO)).toBe("calcinacion");
  });

  it("ignora los ceros a la izquierda de un número: Planta 02 y Planta 2 son el mismo nombre", () => {
    const catalogo: Sector[] = [{ id: "p2", nombre: "Planta 2", activo: true }];
    expect(sectorDe("Planta 02", catalogo)).toBe("p2");
    expect(sectorDe("Planta 2", catalogo)).toBe("p2");
    expect(sectorDe("planta 002", catalogo)).toBe("p2");
  });

  it("no deja que quitar ceros convierta 0-2 o 10 en otra cosa", () => {
    const catalogo: Sector[] = [
      { id: "p02mm", nombre: "Planta 0-2 mm", activo: true },
      { id: "p10", nombre: "Planta 10", activo: true },
    ];
    expect(sectorDe("Planta 0-2 mm", catalogo)).toBe("p02mm");
    expect(sectorDe("Planta 10", catalogo)).toBe("p10");
    expect(sectorDe("Planta 1", catalogo)).toBeNull();
    // Un cero en el medio de un número no es «a la izquierda»: 100 no es 10.
    expect(sectorDe("Planta 100", catalogo)).toBeNull();
  });

  // Enlazar al que se le parece es peor que dejar en null: un enlace equivocado
  // no se nota nunca, porque el dato aparece en el lugar que no es.
  it("deja en null lo que no reconoce con certeza", () => {
    expect(sectorDe("Deposito abierto", CATALOGO)).toBeNull();
    expect(sectorDe("Cal", CATALOGO)).toBeNull();
    expect(sectorDe("Depositode aceites", CATALOGO)).toBeNull();
  });

  it("no enlaza por contener o parecerse: «Molienda» no es «Molienda de cal»", () => {
    expect(sectorDe("Molienda", CATALOGO)).toBeNull();
    expect(sectorDe("Molino de cal", CATALOGO)).toBeNull();
    expect(sectorDe("Planta 3", CATALOGO)).toBeNull();
  });

  it("un lugar compuesto no es ninguno de los dos sectores que nombra", () => {
    expect(sectorDe("Taller equipos moviles", CATALOGO)).toBeNull();
  });

  // La trampa que tiene el catálogo real: «Planta 02» fue hasta el 19/10/2026 el
  // nombre de lo que hoy se llama «Planta 0-2 mm». La planilla habla de «Planta
  // 2», «Planta 02» y «Planta 3»: es la serie de las plantas de trituración. Un
  // alias por nombre viejo la habría mandado a la planta equivocada, y en
  // silencio.
  it("«Planta 02» no se enlaza con «Planta 0-2 mm» aunque ése haya sido su nombre", () => {
    expect(sectorDe("Planta 02", CATALOGO)).toBeNull();
    expect(sectorDe("Planta 2", CATALOGO)).toBeNull();
  });

  it("Filler 1, 2 y 3 son los nombres viejos documentados de las plantas filler", () => {
    expect(sectorDe("Filler 1", CATALOGO)).toBe("filler1");
    expect(sectorDe("Filler 2", CATALOGO)).toBe("filler2");
    // Filler 3 no está en este catálogo de prueba: el alias no inventa el destino.
    expect(sectorDe("Filler 3", CATALOGO)).toBeNull();
  });

  it("no mira los sectores dados de baja, y con dos activos del mismo nombre no elige", () => {
    expect(sectorDe("Administración", CATALOGO)).toBe("adm");

    const repetido: Sector[] = [
      { id: "a", nombre: "Calidad", activo: true },
      { id: "b", nombre: "Calidad", activo: true },
    ];
    expect(sectorDe("Calidad", repetido)).toBeNull();
  });

  it("un texto vacío no enlaza nada", () => {
    expect(sectorDe("", CATALOGO)).toBeNull();
    expect(sectorDe("   ", CATALOGO)).toBeNull();
  });
});

const USUARIOS: Persona[] = [
  { id: "francisco", nombre: "Francisco Varela" },
  { id: "maximiliano", nombre: "Maximiliano Lenzetti" },
  { id: "nicolas-l", nombre: "Nicolas Lenzetti" },
  { id: "nicolas-r", nombre: "Nicolas Rossi" },
];

describe("personaDe", () => {
  it("enlaza con el nombre y el apellido completos, ignorando acentos y mayúsculas", () => {
    expect(personaDe("Francisco Varela", USUARIOS)).toBe("francisco");
    expect(personaDe("  francisco   varela ", USUARIOS)).toBe("francisco");
    expect(personaDe("Nicolás Rossi", USUARIOS)).toBe("nicolas-r");
  });

  it("no enlaza por el nombre de pila ni por el apellido solos", () => {
    expect(personaDe("Francisco", USUARIOS)).toBeNull();
    expect(personaDe("Lenzetti", USUARIOS)).toBeNull();
    expect(personaDe("Nicolas", USUARIOS)).toBeNull();
  });

  it("una persona que no es usuaria queda sin enlazar", () => {
    expect(personaDe("Pedro Arias", USUARIOS)).toBeNull();
  });

  // Revisado a mano, uno por uno: «Maxi» es el diminutivo, el apellido es el
  // mismo, y el correo de la cuenta es maximilianolenzetti@. Hay otro Lenzetti
  // —Nicolas— y por eso el apellido solo no alcanza.
  it("Maxi Lenzetti es Maximiliano Lenzetti, y no Nicolas", () => {
    expect(personaDe("Maxi Lenzetti", USUARIOS)).toBe("maximiliano");
  });

  it("el alias revisado no inventa al destino si la cuenta no existe", () => {
    expect(personaDe("Maxi Lenzetti", [{ id: "x", nombre: "Nicolas Lenzetti" }])).toBeNull();
  });

  it("dos usuarios con el mismo nombre completo no se resuelven", () => {
    expect(
      personaDe("Ana Perez", [
        { id: "1", nombre: "Ana Perez" },
        { id: "2", nombre: "Ana Perez" },
      ])
    ).toBeNull();
  });

  it("un texto vacío no enlaza nada", () => {
    expect(personaDe("", USUARIOS)).toBeNull();
  });
});

const FILA: FilaDelExcel = {
  fila: 10,
  numero: 1,
  lugar: "Taller",
  detectada: "2026-10-10",
  descripcion: "Cargador de baterias, correas sin protección. Riesgo de atrapamiento",
  detecto: "Pedro Arias",
  accion: "Colocar protección ",
  responsable: "Maxi Lenzetti",
  fecha_maxima: "2026-10-30",
  fecha_ejecucion: null,
  prioridad: 1,
  estado: "Pendiente",
  requiere_inversion: null,
  observaciones: null,
  frecuencia: null,
  antecedentes: null,
  controles: null,
  magnitud_dano: null,
  legislacion: null,
  nivel: null,
  fotos: ["Fotos\\IMG_1.jpg"],
};

const ENLACES = { sectores: CATALOGO, usuarios: USUARIOS, hoy: "2026-10-30" };

function ok(fila: FilaDelExcel) {
  const r = condicionDeLaFila(fila, ENLACES);
  if (!r.ok) throw new Error(`esperaba ok y vino: ${r.motivo}`);
  return r;
}

describe("condicionDeLaFila", () => {
  it("conserva el N° de la planilla y arma una clave que hace idempotente la corrida", () => {
    const { condicion } = ok(FILA);
    expect(condicion.numero).toBe(1);
    expect(condicion.clave).toBe("excel-21-10-26-1");
  });

  it("enlaza lo reconocido y deja en null lo que no, informándolo", () => {
    const a = ok(FILA);
    expect(a.condicion.sector_id).toBe("taller");
    expect(a.condicion.responsable_id).toBe("maximiliano");
    expect(a.lugarSinEnlazar).toBeNull();
    expect(a.responsableSinEnlazar).toBeNull();

    const b = ok({ ...FILA, lugar: "Deposito abierto", responsable: "Alguien Raro" });
    expect(b.condicion.sector_id).toBeNull();
    expect(b.condicion.responsable_id).toBeNull();
    expect(b.lugarSinEnlazar).toBe("Deposito abierto");
    expect(b.responsableSinEnlazar).toBe("Alguien Raro");
  });

  it("el equipo, el peligro y quién detectó quedan en null: la planilla no los trae como dato", () => {
    const { condicion } = ok(FILA);
    expect(condicion.equipo_id).toBeNull();
    expect(condicion.peligro_id).toBeNull();
    expect(condicion.detectada_por).toBeNull();
  });

  it("no pierde quién detectó: queda escrito en las observaciones", () => {
    expect(ok(FILA).condicion.observaciones).toBe("Detectó: Pedro Arias (planilla 21-10-26).");
    expect(ok({ ...FILA, observaciones: "Se evalua otra alternativa" }).condicion.observaciones).toBe(
      "Se evalua otra alternativa\nDetectó: Pedro Arias (planilla 21-10-26)."
    );
    expect(ok({ ...FILA, detecto: null }).condicion.observaciones).toBeNull();
  });

  it("si quien detectó es un usuario reconocido, queda como detectada_por y no se repite en las observaciones", () => {
    const { condicion } = ok({ ...FILA, detecto: "Francisco Varela" });
    expect(condicion.detectada_por).toBe("francisco");
    expect(condicion.observaciones).toBeNull();
  });

  it("recorta los espacios de los textos y no los corrige: la ortografía es de quien la escribió", () => {
    const { condicion } = ok({ ...FILA, accion: "  Colocar proteccion ", descripcion: " Motor conpartes moviles " });
    expect(condicion.accion_propuesta).toBe("Colocar proteccion");
    expect(condicion.descripcion).toBe("Motor conpartes moviles");
  });

  it("sin los cinco puntajes no manda ninguno: la condición entra sin evaluar", () => {
    const { condicion } = ok(FILA);
    expect(condicion.frecuencia).toBeNull();
    expect(condicion.magnitud_dano).toBeNull();
    // Y no manda las columnas generadas, que Postgres no deja escribir.
    expect(condicion).not.toHaveProperty("nivel_riesgo");
    expect(condicion).not.toHaveProperty("probabilidad");
    expect(condicion).not.toHaveProperty("gravedad");
  });

  it("con los cinco puntajes los conserva", () => {
    const { condicion } = ok({
      ...FILA,
      frecuencia: 3,
      antecedentes: 1,
      controles: 3,
      magnitud_dano: 9,
      legislacion: 3,
      nivel: 84,
    });
    expect([
      condicion.frecuencia,
      condicion.antecedentes,
      condicion.controles,
      condicion.magnitud_dano,
      condicion.legislacion,
    ]).toEqual([3, 1, 3, 9, 3]);
  });

  it("rechaza una fila con un puntaje fuera de la escala, en vez de dejar que la base rebote todo el lote", () => {
    const r = condicionDeLaFila({ ...FILA, frecuencia: 3, antecedentes: 1, controles: 2, magnitud_dano: 9, legislacion: 3 }, ENLACES);
    expect(r.ok).toBe(false);
  });

  it("rechaza una evaluación a medias: cuatro de cinco es lo mismo que ninguno y no se inventa el quinto", () => {
    const r = condicionDeLaFila({ ...FILA, frecuencia: 3, antecedentes: 1, controles: 3, magnitud_dano: 9, legislacion: null }, ENLACES);
    expect(r.ok).toBe(false);
  });

  it("rechaza una fila sin descripción, sin número o sin fecha de detección", () => {
    expect(condicionDeLaFila({ ...FILA, descripcion: "  " }, ENLACES).ok).toBe(false);
    expect(condicionDeLaFila({ ...FILA, numero: null }, ENLACES).ok).toBe(false);
    expect(condicionDeLaFila({ ...FILA, detectada: null }, ENLACES).ok).toBe(false);
    expect(condicionDeLaFila({ ...FILA, detectada: "10/10/2026" }, ENLACES).ok).toBe(false);
  });

  it("rechaza una prioridad fuera de 1 a 3", () => {
    expect(condicionDeLaFila({ ...FILA, prioridad: 4 }, ENLACES).ok).toBe(false);
    expect(ok({ ...FILA, prioridad: null }).condicion.prioridad).toBeNull();
  });

  it("avisa de las fechas que no cierran, pero las importa tal cual: corregirlas sería inventar", () => {
    const futura = ok({ ...FILA, detectada: "2026-11-13" });
    expect(futura.condicion.detectada_el).toBe("2026-11-13");
    expect(futura.avisos.join(" ")).toMatch(/futura/i);

    const maximaAntes = ok({ ...FILA, detectada: "2026-11-13", fecha_maxima: "2026-11-03" });
    expect(maximaAntes.avisos.join(" ")).toMatch(/máxima/i);

    const ejecutadaAntes = ok({ ...FILA, fecha_ejecucion: "2026-10-08", estado: "Cerrado" });
    expect(ejecutadaAntes.condicion.fecha_ejecucion).toBe("2026-10-08");
    expect(ejecutadaAntes.avisos.join(" ")).toMatch(/ejecución/i);

    expect(ok(FILA).avisos).toEqual([]);
  });

  it("avisa cuando el estado de la planilla contradice a la fecha de ejecución", () => {
    expect(ok({ ...FILA, fecha_ejecucion: "2026-10-16", estado: "Pendiente" }).avisos.join(" ")).toMatch(/estado/i);
    expect(ok({ ...FILA, fecha_ejecucion: null, estado: "Cerrado" }).avisos.join(" ")).toMatch(/estado/i);
    // «Vencida» es una fórmula sobre la fecha máxima, no un estado que se cargue: no contradice nada.
    expect(ok({ ...FILA, estado: "Vencida" }).avisos).toEqual([]);
  });

  it("requiere_inversion se importa sólo si la planilla lo dice con todas las letras", () => {
    expect(ok(FILA).condicion.requiere_inversion).toBeNull();
    expect(ok({ ...FILA, requiere_inversion: "Si" }).condicion.requiere_inversion).toBe(true);
    expect(ok({ ...FILA, requiere_inversion: "no" }).condicion.requiere_inversion).toBe(false);
    expect(ok({ ...FILA, requiere_inversion: "Tal vez" }).condicion.requiere_inversion).toBeNull();
  });
});
