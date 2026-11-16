import { cuitEsValido, normalizarCuit } from "@/lib/core/cuit";

/**
 * Leer un Excel de clientes y decir **qué pasaría** antes de que pase.
 *
 * ── LAS COLUMNAS SE BUSCAN POR EL NOMBRE DEL ENCABEZADO, NUNCA POR LA LETRA ──
 *
 * Es la lección que ya costó en este repo: el Excel del cuaderno de un
 * contratista mudó el mismo contenido de `K:O` a `A:E` **en un día**, y un
 * lector atado a la letra habría leído otra cosa sin fallar. Acá el orden de
 * las columnas no importa, las de más se ignoran y las que faltan se nombran.
 *
 * El nombre se compara **sin acentos, sin mayúsculas y sin espacios de más**,
 * porque quien arma la planilla escribe «Razón Social», «RAZON SOCIAL» o
 * «razon social» y las tres son la misma columna. Eso no es «enlazar al que se
 * le parece»: un encabezado es una etiqueta que el formato define, no un dato
 * de la empresa. Los nombres de empresa y de vendedor, que sí son datos, se
 * cruzan exacto o quedan vacíos.
 *
 * ── ESTO NO ESCRIBE NADA, Y ÉSE ES EL PUNTO ─────────────────
 *
 * `planDeImportacion` arma la lista de qué se crearía, qué ya está y qué tiene
 * un problema. La pantalla la muestra y recién entonces alguien confirma. Una
 * importación que escribe 300 filas en el primer clic es cómo se termina con un
 * padrón duplicado que después hay que limpiar a mano.
 *
 * ── LA IMPORTACIÓN NO PISA NADA ─────────────────────────────
 *
 * Un cliente que ya está **no se actualiza**: se informa y se saltea. El Excel
 * es una carga puntual y no un espejo —es la misma distinción que CLAUDE.md
 * hace con RRHH frente a las planillas de Sheets—, así que no tiene autoridad
 * para corregir lo que alguien ya cargó o corrigió en el sistema. Si hay que
 * cambiar un dato, se cambia en la ficha.
 *
 * Eso además la vuelve **idempotente**: volver a subir el mismo archivo no crea
 * nada.
 */

/** Un campo del cliente que el Excel puede traer. */
export type CampoImportable =
  | "razon_social"
  | "nombre_fantasia"
  | "cuit"
  | "estado"
  | "localidad"
  | "provincia"
  | "rubro"
  | "telefono"
  | "email"
  | "sitio_web"
  | "origen"
  | "vendedor"
  | "notas";

export interface ColumnaEsperada {
  campo: CampoImportable;
  /** Cómo se llama en la plantilla. Es el que se escribe en el archivo de ejemplo. */
  nombre: string;
  /** Otras formas de escribirlo que se aceptan, ya que la planilla la arma una persona. */
  alias: string[];
  obligatoria: boolean;
  /** Qué se hace con lo que venga. Se muestra en la pantalla y en el documento. */
  acepta: string;
}

/**
 * El formato del archivo.
 *
 * **Sólo la razón social es obligatoria**, igual que en el alta a mano, y por
 * el mismo motivo: un prospecto nace de un llamado donde lo único claro es el
 * nombre de la empresa. Pedirle más a quien está armando la lista termina en
 * que la lista no se arma.
 */
export const COLUMNAS: ColumnaEsperada[] = [
  {
    campo: "razon_social",
    nombre: "Razón social",
    alias: ["razon social", "cliente", "empresa", "nombre"],
    obligatoria: true,
    acepta: "El nombre de la empresa. Es lo único que no puede faltar.",
  },
  {
    campo: "nombre_fantasia",
    nombre: "Nombre de fantasía",
    alias: ["nombre fantasia", "fantasia"],
    obligatoria: false,
    acepta: "Cómo se la conoce, si es distinto de la razón social.",
  },
  {
    campo: "cuit",
    nombre: "CUIT",
    alias: ["cuit/cuil", "c.u.i.t."],
    obligatoria: false,
    acepta: "Con guiones o sin ellos. Si no cierra, se guarda igual y se avisa.",
  },
  {
    campo: "estado",
    nombre: "Estado",
    alias: ["situacion"],
    obligatoria: false,
    acepta: "Prospecto, Activo o Inactivo. Vacío es Prospecto.",
  },
  {
    campo: "localidad",
    nombre: "Localidad",
    alias: ["ciudad", "localidad/ciudad"],
    obligatoria: false,
    acepta: "Texto libre.",
  },
  { campo: "provincia", nombre: "Provincia", alias: [], obligatoria: false, acepta: "Texto libre." },
  {
    campo: "rubro",
    nombre: "Rubro",
    alias: ["actividad"],
    obligatoria: false,
    acepta: "A qué se dedica. Texto libre.",
  },
  {
    campo: "telefono",
    nombre: "Teléfono",
    alias: ["telefono", "tel", "celular"],
    obligatoria: false,
    acepta: "Texto libre: entra como está escrito.",
  },
  {
    campo: "email",
    nombre: "Correo",
    alias: ["email", "e-mail", "mail", "correo electronico"],
    obligatoria: false,
    acepta: "Si no parece un correo, la fila entra igual con el campo vacío y se avisa.",
  },
  {
    campo: "sitio_web",
    nombre: "Sitio web",
    alias: ["web", "pagina web", "sitio"],
    obligatoria: false,
    acepta: "Texto libre.",
  },
  {
    campo: "origen",
    nombre: "Origen",
    alias: ["de donde salio", "procedencia"],
    obligatoria: false,
    acepta: "Referido, feria, llamó… Texto libre.",
  },
  {
    campo: "vendedor",
    nombre: "Vendedor",
    alias: ["quien lo atiende", "responsable", "atiende"],
    obligatoria: false,
    acepta:
      "Nombre y apellido de un usuario del SdG, escrito igual. Si no se reconoce, queda sin asignar y se avisa.",
  },
  { campo: "notas", nombre: "Notas", alias: ["observaciones", "comentarios"], obligatoria: false, acepta: "Texto libre." },
];

/**
 * Un encabezado llevado a su forma comparable: sin acentos, en minúsculas y
 * con los espacios colapsados.
 *
 * La ñ **no se descompone**: `NFD` la parte en `n` + tilde y el filtro de
 * diacríticos se la comería, así que «Año» y «Ano» pasarían a ser la misma
 * columna. Se la protege antes de normalizar y se la repone después. Es la
 * misma trampa que ya mordió en las búsquedas de este repo.
 */
export function normalizarEncabezado(texto: unknown): string {
  return String(texto ?? "")
    .replace(/ñ/gi, "\u0001")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\u0001/g, "n")
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export interface MapaDeColumnas {
  /** Para cada campo reconocido, con qué clave del encabezado viene. */
  porCampo: Partial<Record<CampoImportable, string>>;
  /** Las obligatorias que no aparecieron, por su nombre de plantilla. */
  faltan: string[];
  /** Encabezados del archivo que no corresponden a ninguna columna conocida. */
  ignoradas: string[];
}

/**
 * Qué columna del archivo es cada campo.
 *
 * Una columna que aparece **dos veces** se toma de la primera y la segunda cae
 * en `ignoradas`: elegir la última dejaría que una columna vacía pegada al
 * final tape a la que tiene los datos.
 */
export function mapearColumnas(encabezados: unknown[]): MapaDeColumnas {
  const porCampo: Partial<Record<CampoImportable, string>> = {};
  const ignoradas: string[] = [];

  for (const crudo of encabezados) {
    const clave = String(crudo ?? "");
    const normalizado = normalizarEncabezado(clave);
    if (!normalizado || normalizado === "empty") continue;

    const columna = COLUMNAS.find(
      (c) =>
        normalizarEncabezado(c.nombre) === normalizado ||
        c.alias.some((a) => normalizarEncabezado(a) === normalizado)
    );

    if (!columna) {
      ignoradas.push(clave);
    } else if (porCampo[columna.campo] === undefined) {
      porCampo[columna.campo] = clave;
    } else {
      ignoradas.push(clave);
    }
  }

  const faltan = COLUMNAS.filter((c) => c.obligatoria && porCampo[c.campo] === undefined).map(
    (c) => c.nombre
  );

  return { porCampo, faltan, ignoradas };
}

/** El cliente tal como va a entrar, ya limpio. */
export interface ClienteDelExcel {
  razon_social: string;
  nombre_fantasia: string | null;
  cuit: string | null;
  estado: "prospecto" | "activo" | "inactivo";
  localidad: string | null;
  provincia: string | null;
  rubro: string | null;
  telefono: string | null;
  email: string | null;
  sitio_web: string | null;
  origen: string | null;
  vendedor_id: string | null;
  notas: string | null;
}

export type EstadoDeLaFila = "nueva" | "ya_existe" | "repetida" | "con_problema";

export interface FilaDelPlan {
  /** El número de fila **del Excel**, con el encabezado como 1: es lo que se ve en la pantalla de alguien. */
  fila: number;
  estado: EstadoDeLaFila;
  /** Lo que se crearía. Null cuando la fila no se puede crear. */
  cliente: ClienteDelExcel | null;
  /** Por qué no entra. Sólo en `con_problema`, `ya_existe` y `repetida`. */
  problemas: string[];
  /** Entra igual, pero algo no se pudo usar tal cual. */
  avisos: string[];
}

export interface PlanDeImportacion {
  columnas: MapaDeColumnas;
  filas: FilaDelPlan[];
  resumen: { nuevas: number; yaExisten: number; repetidas: number; conProblema: number };
}

/** Lo que hay que saber del sistema para decidir qué es nuevo. */
export interface ContextoDeImportacion {
  /** CUITs ya cargados, normalizados a once dígitos. */
  cuitsExistentes: Set<string>;
  /** Razones sociales ya cargadas, normalizadas. Sólo se usan para las filas sin CUIT. */
  razonesExistentes: Set<string>;
  /** Usuarios activos por su nombre completo normalizado, para resolver el vendedor. */
  usuariosPorNombre: Map<string, string>;
}

const ESTADOS: Record<string, ClienteDelExcel["estado"]> = {
  prospecto: "prospecto",
  activo: "activo",
  inactivo: "inactivo",
  // Lo que suele escribir alguien que arma la lista a mano.
  cliente: "activo",
  "ex cliente": "inactivo",
  baja: "inactivo",
};

function texto(valor: unknown): string {
  if (valor === null || valor === undefined) return "";
  if (valor instanceof Date) return valor.toISOString().slice(0, 10);
  return String(valor).trim();
}

function oNull(valor: string): string | null {
  return valor.length > 0 ? valor : null;
}

/**
 * Parece un correo.
 *
 * Deliberadamente laxo —algo, arroba, algo, punto, algo—: lo que se quiere
 * atrapar es la celda que dice «no tiene» o un teléfono, no validar el RFC. Un
 * correo raro pero real que entre es mucho mejor que uno bueno que se pierda.
 */
function pareceCorreo(valor: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(valor);
}

/**
 * Una fila del Excel llevada a un cliente, con lo que no se pudo usar.
 *
 * Nunca descarta un dato en silencio: lo que no entra como vino sale en
 * `avisos` diciendo qué decía la celda. Es la misma regla que el CUIT de la
 * ruta de alta — un dato que desaparece sin que nadie se entere es el peor de
 * los resultados.
 */
export function leerFilaDeCliente(
  cruda: Record<string, unknown>,
  mapa: MapaDeColumnas,
  usuariosPorNombre: Map<string, string>
): { cliente: ClienteDelExcel | null; problemas: string[]; avisos: string[] } {
  const problemas: string[] = [];
  const avisos: string[] = [];

  const dato = (campo: CampoImportable): string => {
    const clave = mapa.porCampo[campo];
    return clave === undefined ? "" : texto(cruda[clave]);
  };

  const razonSocial = dato("razon_social");
  if (!razonSocial) {
    problemas.push("Falta la razón social.");
    return { cliente: null, problemas, avisos };
  }

  // El CUIT nunca frena la fila: lo que no cierra entra y se avisa.
  const cuitCrudo = dato("cuit");
  let cuit: string | null = null;
  if (cuitCrudo) {
    const normalizado = normalizarCuit(cuitCrudo);
    if (!normalizado) {
      cuit = cuitCrudo;
      avisos.push(`El CUIT «${cuitCrudo}» no tiene once dígitos: se guarda como está.`);
    } else if (!cuitEsValido(normalizado)) {
      cuit = normalizado;
      avisos.push(`El dígito verificador de ${normalizado} no cierra: se guarda igual.`);
    } else {
      cuit = normalizado;
    }
  }

  const estadoCrudo = dato("estado");
  let estado: ClienteDelExcel["estado"] = "prospecto";
  if (estadoCrudo) {
    const reconocido = ESTADOS[normalizarEncabezado(estadoCrudo)];
    if (reconocido) {
      estado = reconocido;
    } else {
      avisos.push(`No se reconoce el estado «${estadoCrudo}»: entra como Prospecto.`);
    }
  }

  const correoCrudo = dato("email");
  let email: string | null = null;
  if (correoCrudo) {
    if (pareceCorreo(correoCrudo)) {
      email = correoCrudo;
    } else {
      avisos.push(`«${correoCrudo}» no parece un correo: la fila entra sin correo.`);
    }
  }

  // El vendedor se cruza **exacto o queda vacío**. Enlazar al que se le parece
  // es peor que dejar en null: un cliente asignado a quien no es no se nota
  // nunca, y el que sí tenía que atenderlo no lo ve.
  const vendedorCrudo = dato("vendedor");
  let vendedorId: string | null = null;
  if (vendedorCrudo) {
    const encontrado = usuariosPorNombre.get(normalizarEncabezado(vendedorCrudo));
    if (encontrado) {
      vendedorId = encontrado;
    } else {
      avisos.push(`No se reconoce al vendedor «${vendedorCrudo}»: queda sin asignar.`);
    }
  }

  return {
    cliente: {
      razon_social: razonSocial,
      nombre_fantasia: oNull(dato("nombre_fantasia")),
      cuit,
      estado,
      localidad: oNull(dato("localidad")),
      provincia: oNull(dato("provincia")),
      rubro: oNull(dato("rubro")),
      telefono: oNull(dato("telefono")),
      email,
      sitio_web: oNull(dato("sitio_web")),
      origen: oNull(dato("origen")),
      vendedor_id: vendedorId,
      notas: oNull(dato("notas")),
    },
    problemas,
    avisos,
  };
}

/**
 * El plan completo: qué se crearía y qué no.
 *
 * ── CÓMO SE DECIDE QUE UN CLIENTE «YA ESTÁ» ─────────────────
 *
 * **Por CUIT cuando lo hay**, que es la identidad de verdad. Cuando no lo hay,
 * por razón social normalizada, que es lo único que queda — y tiene un límite
 * que conviene saber: dos empresas distintas con el mismo nombre y sin CUIT se
 * leen como la misma, y la segunda se informa como repetida en vez de entrar.
 * Es el lado seguro del error: una fila que no entró se ve en la pantalla y se
 * carga a mano; dos fichas del mismo cliente no se ven nunca, y a partir de ahí
 * las actividades de uno no aparecen en el otro.
 *
 * Una fila sin razón social no se compara con nada: ya es `con_problema`.
 */
export function planDeImportacion(
  filas: Record<string, unknown>[],
  encabezados: unknown[],
  contexto: ContextoDeImportacion
): PlanDeImportacion {
  const columnas = mapearColumnas(encabezados);

  // Sin la columna obligatoria no hay plan que armar: todas las filas serían
  // «falta la razón social», que diría algo falso sobre el contenido cuando lo
  // que pasa es que el encabezado no se reconoció.
  if (columnas.faltan.length > 0) {
    return {
      columnas,
      filas: [],
      resumen: { nuevas: 0, yaExisten: 0, repetidas: 0, conProblema: 0 },
    };
  }

  const cuitsDelArchivo = new Set<string>();
  const razonesDelArchivo = new Set<string>();
  const resultado: FilaDelPlan[] = [];

  filas.forEach((cruda, i) => {
    // +2: el encabezado es la fila 1 del Excel y los datos arrancan en la 2.
    const numeroDeFila = i + 2;
    const { cliente, problemas, avisos } = leerFilaDeCliente(
      cruda,
      columnas,
      contexto.usuariosPorNombre
    );

    if (!cliente) {
      resultado.push({ fila: numeroDeFila, estado: "con_problema", cliente: null, problemas, avisos });
      return;
    }

    const cuitNormalizado = normalizarCuit(cliente.cuit);
    const razonNormalizada = normalizarEncabezado(cliente.razon_social);

    if (cuitNormalizado) {
      if (cuitsDelArchivo.has(cuitNormalizado)) {
        resultado.push({
          fila: numeroDeFila,
          estado: "repetida",
          cliente,
          problemas: [`El CUIT ${cuitNormalizado} ya aparece más arriba en el mismo archivo.`],
          avisos,
        });
        return;
      }
      if (contexto.cuitsExistentes.has(cuitNormalizado)) {
        resultado.push({
          fila: numeroDeFila,
          estado: "ya_existe",
          cliente,
          problemas: [`Ya hay un cliente cargado con el CUIT ${cuitNormalizado}.`],
          avisos,
        });
        return;
      }
      cuitsDelArchivo.add(cuitNormalizado);
    } else {
      if (razonesDelArchivo.has(razonNormalizada)) {
        resultado.push({
          fila: numeroDeFila,
          estado: "repetida",
          cliente,
          problemas: [`«${cliente.razon_social}» ya aparece más arriba en el mismo archivo.`],
          avisos,
        });
        return;
      }
      if (contexto.razonesExistentes.has(razonNormalizada)) {
        resultado.push({
          fila: numeroDeFila,
          estado: "ya_existe",
          cliente,
          problemas: [`Ya hay un cliente cargado como «${cliente.razon_social}».`],
          avisos,
        });
        return;
      }
    }

    razonesDelArchivo.add(razonNormalizada);
    resultado.push({ fila: numeroDeFila, estado: "nueva", cliente, problemas: [], avisos });
  });

  return {
    columnas,
    filas: resultado,
    resumen: {
      nuevas: resultado.filter((f) => f.estado === "nueva").length,
      yaExisten: resultado.filter((f) => f.estado === "ya_existe").length,
      repetidas: resultado.filter((f) => f.estado === "repetida").length,
      conProblema: resultado.filter((f) => f.estado === "con_problema").length,
    },
  };
}

/** Los encabezados de la plantilla, en el orden en que conviene leerlos. */
export function encabezadosDeLaPlantilla(): string[] {
  return COLUMNAS.map((c) => c.nombre);
}
