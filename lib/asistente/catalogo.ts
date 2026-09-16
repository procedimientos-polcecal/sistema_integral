import type { Modulo } from "@/lib/core/types";
import { MODULO_DE_TABLA, tablasVisibles, type Ambito } from "./modulos";
import { NOTAS, NOTAS_GENERALES } from "./notas";
import crudo from "./catalogo.generado.json";

export interface ColumnaCruda {
  columna: string;
  tipo: string;
  nuleable: boolean;
}

export interface EsquemaCrudo {
  tablas: Record<string, ColumnaCruda[]>;
  enums: Record<string, string[]>;
}

/**
 * El esquema que se le muestra a un usuario, en texto.
 *
 * Puro y con todo por parámetro, para poder testearlo con un esquema de
 * juguete: si dependiera del JSON generado, el test cambiaría cada vez que
 * alguien agrega una columna, y un test que se rompe solo deja de leerse.
 *
 * Lo que decide qué entra es `tablasVisibles`: los módulos del usuario más el
 * núcleo, y nada sin mapear. Recordar que **esto no es la barrera** — la
 * barrera es que la consulta corre con la sesión del usuario y RLS.
 */
export function armarCatalogo(
  esquema: EsquemaCrudo,
  mapa: Record<string, Ambito>,
  notas: Record<string, string>,
  modulos: Modulo[]
): string {
  // El filtro vive en `tablasVisibles` y no acá: dos copias de "qué ve quién"
  // es una que va a quedar vieja.
  const tablas = tablasVisibles(modulos, mapa).filter((t) => esquema.tablas[t]);

  const bloques = tablas.map((t) => {
    const columnas = esquema.tablas[t]
      .map((c) => `  ${c.columna} ${c.tipo}${c.nuleable ? " null" : ""}`)
      .join("\n");
    const nota = notas[t] ? `\n  -- ${notas[t].replace(/\n/g, "\n  -- ")}` : "";
    return `${t}:\n${columnas}${nota}`;
  });

  // Sólo los enums que alguna columna visible usa: el resto es ruido, ocupa
  // prompt y no ayuda a escribir ninguna consulta que este usuario pueda hacer.
  const tiposUsados = new Set(
    tablas.flatMap((t) => esquema.tablas[t].map((c) => c.tipo.replace(/\[\]$/, "")))
  );
  const enums = Object.entries(esquema.enums)
    .filter(([nombre]) => tiposUsados.has(nombre))
    .map(([nombre, valores]) => `${nombre}: ${valores.join(" | ")}`);

  return [
    NOTAS_GENERALES,
    "",
    "TABLAS",
    bloques.join("\n\n"),
    enums.length ? `\nENUMS\n${enums.join("\n")}` : "",
  ].join("\n");
}

/** El catálogo real, con los datos generados. */
export function catalogoPara(modulos: Modulo[]): string {
  return armarCatalogo(crudo as EsquemaCrudo, MODULO_DE_TABLA, NOTAS, modulos);
}
