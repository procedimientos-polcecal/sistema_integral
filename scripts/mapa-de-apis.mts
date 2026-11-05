// Escribe `docs/API-MAPA.generado.md` leyendo las 282 rutas de `app/api`.
//
//   npm run mapa-de-apis
//
// POR QUÉ SE GENERA Y NO SE ESCRIBE A MANO
//
// Son 282 rutas y 436 handlers. Una lista hecha a mano queda desactualizada la
// semana que viene, y entonces pasa lo peor: alguien la lee y le cree. Esto se
// vuelve a correr y por eso no puede mentir — es la misma forma que ya tienen
// `generar-catalogo-asistente.mts` y el registro de `revisar-exportaciones`.
//
// Lo que **no** se genera vive en `docs/API.md`, escrito a mano: para qué
// sirven las APIs de cada módulo, cómo está armada una ruta acá y las trampas.
// El corte entre los dos documentos es quién puede saberlo: lo que sale del
// código va acá, lo que hay que haber vivido va allá.
//
// LO QUE ESTE MAPA NO VE, Y HAY QUE SABERLO ANTES DE CONFIAR EN UN NÚMERO
//
// Lee texto con expresiones regulares; no ejecuta nada ni entiende el código.
// Entonces: una tabla que se toca a través de una función de `lib/` no aparece
// en su columna (por eso se listan las dependencias), un `.from(variable)` no
// se cuenta, y **`sin guarda` no quiere decir abierta**: quiere decir que en
// ese archivo no hay ninguna de las cuatro. El permiso puede estar en el proxy
// o en RLS. Esa distinción es el motivo de que la columna diga lo que vio y no
// lo que supone.
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import {
  dependenciasDe,
  exentasDeSesion,
  guardaDe,
  guardaEfectiva,
  metodosDe,
  rasgosDe,
  rutaDeLaUrl,
  tablasDe,
  type ClaseDeGuarda,
} from "../lib/core/mapaDeApis.ts";

// `fileURLToPath` y no `.pathname`: el repo vive en «SdG PP», con un espacio,
// y una URL lo escribe `%20`. Leerlo así busca una carpeta que no existe.
const RAIZ = fileURLToPath(new URL("..", import.meta.url));
const BASE = join(RAIZ, "app", "api");

function rutasDeArchivo(dir: string): string[] {
  const salida: string[] = [];
  for (const entrada of readdirSync(dir, { withFileTypes: true })) {
    const completo = join(dir, entrada.name);
    if (entrada.isDirectory()) salida.push(...rutasDeArchivo(completo));
    else if (entrada.name === "route.ts") salida.push(completo);
  }
  return salida;
}

type Efectiva = ClaseDeGuarda | "el proxy" | "ABIERTA";

const COMO_SE_LLAMA: Record<Efectiva, string> = {
  "secreto-de-cron": "secreto del cron",
  "secreto-propio": "secreto propio",
  "secreto-en-base": "token contra la base",
  permiso: "permiso de módulo",
  sesion: "sesión",
  "sin-guarda": "**sin guarda en el archivo**",
  "el proxy": "el proxy",
  ABIERTA: "**ABIERTA**",
};

/**
 * De la guarda más fuerte a la más débil. **Tiene que estar completo**: el
 * recuento se hace recorriéndolo, así que una clase que falte deja rutas sin
 * contar, y una tabla que suma 281 de 282 es más peligrosa que no tener tabla.
 * Por eso abajo se comprueba la suma.
 */
const ORDEN: Efectiva[] = [
  "secreto-de-cron",
  "secreto-propio",
  "secreto-en-base",
  "permiso",
  "sesion",
  "el proxy",
  "ABIERTA",
];

// La lista de exentas sale del middleware que la aplica, no de una copia acá.
const EXENTAS = exentasDeSesion(
  readFileSync(join(RAIZ, "lib", "supabase", "middleware.ts"), "utf8"),
);

const archivos = rutasDeArchivo(BASE).sort();

const fichas = archivos.map((archivo) => {
  const fuente = readFileSync(archivo, "utf8");
  const relativo = relative(RAIZ, archivo).replace(/\\/g, "/");
  const guarda = guardaDe(fuente);
  const url = rutaDeLaUrl(relativo);
  return {
    url,
    efectiva: guardaEfectiva(guarda.clase, url, EXENTAS),
    archivo: relativo,
    modulo: url.split("/")[2] ?? "(raíz)",
    metodos: metodosDe(fuente),
    guarda,
    tablas: tablasDe(fuente),
    dependencias: dependenciasDe(fuente),
    rasgos: rasgosDe(fuente),
    /** La primera línea del comentario de cabecera, si la tiene. */
    resumen:
      fuente
        .match(/^\/\*\*\s*\n\s*\*\s*(.+)$/m)?.[1]
        ?.replace(/\s*\*\/\s*$/, "")
        .trim() ?? "",
  };
});

/** Los rasgos de una ficha, como una ristra corta de marcas. */
function marcas(ficha: (typeof fichas)[number]): string {
  const r = ficha.rasgos;
  const puestas = [
    r.clienteAdmin && "admin",
    r.escribeEnPlanilla && "planilla",
    r.audita && "audita",
    r.paginado && "paginado",
    r.zod && "zod",
    r.maxDuration && `${r.maxDuration}s`,
  ].filter(Boolean);
  return puestas.length ? puestas.join(" · ") : "—";
}

const modulos = [...new Set(fichas.map((f) => f.modulo))].sort();

const lineas: string[] = [
  "# Mapa de las APIs del SdG",
  "",
  "> **Generado por `npm run mapa-de-apis`. No se edita a mano.**",
  "> Lo escrito a mano —para qué sirve cada módulo, cómo está armada una ruta y",
  "> las trampas— está en [API.md](API.md). Acá sólo hay lo que sale del código.",
  "",
  `Al ${new Date().toISOString().slice(0, 10)}: **${fichas.length} rutas** y ` +
    `**${fichas.reduce((n, f) => n + f.metodos.length, 0)} handlers** en ${modulos.length} carpetas.`,
  "",
  "## Cómo leer la columna «guarda»",
  "",
  "Dice **qué hay que pasar para que esa ruta te conteste**. Cinco salen del",
  "propio archivo; la sexta no, y es la que más rutas tiene:",
  "",
  "| | |",
  "|---|---|",
  "| secreto del cron | `revisarElSecreto`: la llama Vercel, no una persona |",
  "| secreto propio | un webhook, con su variable de entorno |",
  "| token contra la base | el `X-Goog-Channel-Token` que Google manda y que se guardó al abrir el canal |",
  "| permiso de módulo | pide sesión **y** nivel en el módulo |",
  "| sesión | pide estar logueado, y nada más |",
  "| el proxy | **el archivo no valida nada**, y no hace falta: `proxy.ts` redirige al login todo lo que no tenga sesión, salvo la lista corta de exentos que se lee de `lib/supabase/middleware.ts` |",
  "| **ABIERTA** | el proxy la deja pasar **y** el archivo no valida nada. Hoy no hay ninguna, y si aparece una el script sale 1 |",
  "",
  "**«El proxy» no es lo mismo que «abierta», y la diferencia es el motivo de",
  "que esto se genere.** Que una ruta no escriba su guarda no dice nada malo;",
  "lo que diría algo malo es que además estuviera exenta, y eso se comprueba",
  "cruzando las dos cosas, no leyendo el archivo.",
  "",
  "Una advertencia que el mapa no puede darte solo: el proxy **redirige**, no",
  "devuelve 401. Un POST sin sesión sigue el 307 y termina con el HTML del",
  "login y un 200 — eso ya costó una pérdida de datos en la carga sin señal.",
  "",
  "Y las marcas: `admin` es que usa el cliente de servicio, **así que RLS no",
  "corre y el permiso lo pone la ruta**; `planilla` es que escribe en Sheets;",
  "`audita` es que deja rastro en `auditoria`; `paginado` es que previó el corte",
  "de PostgREST en 1000 filas; `zod` es que valida el cuerpo con el helper.",
  "",
];

const cuenta = (clase: Efectiva) => fichas.filter((f) => f.efectiva === clase).length;

// La suma tiene que dar el total. Si no da, hay una clase que `ORDEN` no
// nombra y el recuento está dejando rutas afuera en silencio — que es
// exactamente lo que este documento no puede hacer.
const sumadas = ORDEN.reduce((n, c) => n + cuenta(c), 0);
if (sumadas !== fichas.length) {
  console.error(
    `El recuento suma ${sumadas} de ${fichas.length}: falta una clase en ORDEN.`,
  );
  process.exit(1);
}

lineas.push(
  "## Cuántas hay de cada una",
  "",
  "| Guarda | Rutas |",
  "|---|---|",
  ...ORDEN.map((c) => `| ${COMO_SE_LLAMA[c]} | ${cuenta(c)} |`),
  "",
);

for (const modulo of modulos) {
  const delModulo = fichas.filter((f) => f.modulo === modulo);
  lineas.push(
    `## ${modulo} (${delModulo.length})`,
    "",
    "| Ruta | Métodos | Guarda | Tablas | Marcas |",
    "|---|---|---|---|---|",
    ...delModulo.map((f) => {
      const guarda = COMO_SE_LLAMA[f.efectiva] + (f.guarda.detalle ? ` · \`${f.guarda.detalle}\`` : "");
      const tablas = f.tablas.length ? f.tablas.map((t) => `\`${t}\``).join(", ") : "—";
      return `| \`${f.url}\` | ${f.metodos.join(", ") || "—"} | ${guarda} | ${tablas} | ${marcas(f)} |`;
    }),
    "",
  );
}

lineas.push(
  "## De qué módulos de `lib/` depende cada ruta",
  "",
  "La otra mitad de «con qué está conectada»: una ruta que no nombra ninguna",
  "tabla puede tocar seis a través de un módulo compartido.",
  "",
  "| Ruta | Depende de |",
  "|---|---|",
  ...fichas
    .filter((f) => f.dependencias.length)
    .map((f) => `| \`${f.url}\` | ${f.dependencias.map((d) => `\`${d}\``).join(", ")} |`),
  "",
);

const destino = join(RAIZ, "docs", "API-MAPA.generado.md");
writeFileSync(destino, lineas.join("\n"), "utf8");

console.log(`Escrito docs/API-MAPA.generado.md — ${fichas.length} rutas, ${modulos.length} carpetas.`);
for (const clase of ORDEN) {
  console.log(`  ${COMO_SE_LLAMA[clase].replace(/\*/g, "").padEnd(26)} ${cuenta(clase)}`);
}

// Las `ABIERTA` se imprimen enteras y el script sale 1 si hay alguna: es el
// único resultado que no tiene explicación —el proxy la deja pasar sin sesión
// y el archivo no escribe ninguna guarda—. Hoy no hay ninguna; la gracia es
// que el día que aparezca, aparezca sola.
const abiertas = fichas.filter((f) => f.efectiva === "ABIERTA");
if (abiertas.length) {
  console.log(`
ABIERTAS — el proxy las deja pasar y no validan nada (${abiertas.length}):`);
  for (const f of abiertas) console.log(`  ${f.url}`);
  process.exit(1);
}
