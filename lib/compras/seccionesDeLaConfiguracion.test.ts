import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Que cada sección de Compras → Configuración le hable a **su** lista.
 *
 * La pantalla tiene tres listas de personas, una abajo de la otra, y cada una con
 * el mismo par de componentes: `Sumar<X>` para el alta y `Fila<X>` para la baja.
 * Son tres copias de las mismas treinta líneas, y están duplicadas a propósito
 * —lo dice el encabezado de `SumarAprobadorOS`— porque un componente compartido
 * con el endpoint por parámetro es justamente lo que después hace que alguien
 * cambie una lista creyendo que toca la otra.
 *
 * El costo de esa decisión es este test. Copiar un par y olvidarse de cambiar la
 * URL **no rompe nada**: `tsc` pasa, el build pasa, la pantalla se ve idéntica
 * —la lista que muestra la arma el servidor, no el componente—, y lo que pasa es
 * que administrar una lista agrega o saca gente de otra. Medido el 31/10/2026: con
 * el `fetch` de `FilaConsultado` apuntando a `/api/compras/aprobadores-os`, los
 * 4.591 tests seguían en verde.
 *
 * **No hay una lista de pares escrita a mano acá, y es deliberado.** Cuatro
 * commits antes de esto, `9d6f0a57` sacó del repo una guarda con esa forma —una
 * lista por ruta, en un test— porque se había quedado vieja y le faltaba un
 * elemento, y la reemplazó por un escaneo del texto. Esto es lo mismo: los pares
 * salen del archivo. La cuarta lista que alguien agregue queda cubierta sin tocar
 * este archivo, que es la única manera de que una guarda así siga valiendo algo
 * dentro de un año.
 *
 * El endpoint se compara **entero y por igualdad**, nunca con `includes`:
 * `/api/compras/aprobadores` es prefijo de `/api/compras/aprobadores-os`, así que
 * una comparación por subcadena daría por buena justamente la confusión que esto
 * viene a atrapar.
 */

const PANTALLA = join(
  import.meta.dirname, "..", "..",
  "app", "(app)", "compras", "configuracion", "ConfiguracionClient.tsx"
);

/** El cuerpo de cada componente de primer nivel, por nombre. */
function componentes(fuente: string): Map<string, string> {
  const encabezado = /^function (\w+)\(/gm;
  const marcas = [...fuente.matchAll(encabezado)];

  return new Map(
    marcas.map((m, i) => [
      m[1],
      fuente.slice(m.index, marcas[i + 1]?.index ?? fuente.length),
    ])
  );
}

/** Las rutas de API de Compras que nombra un pedazo de código, sin repetir. */
function endpoints(cuerpo: string): string[] {
  return [...new Set(cuerpo.match(/\/api\/compras\/[a-z0-9/-]+/g) ?? [])];
}

const fuente = readFileSync(PANTALLA, "utf8");
const porNombre = componentes(fuente);

/** `SumarConsultado` → `Consultado`. Lo que empareja el alta con la baja. */
const familiaDe = (nombre: string) => nombre.match(/^(?:Sumar|Fila)(.+)$/)?.[1] ?? null;

/** La lista a la que escribe cada familia sale de su `Sumar<X>`. */
const laListaDe = new Map<string, string[]>();
for (const [nombre, cuerpo] of porNombre) {
  if (!nombre.startsWith("Sumar")) continue;
  laListaDe.set(familiaDe(nombre)!, endpoints(cuerpo));
}

describe("cada sección le habla a su propia lista", () => {
  /*
   * Un escaneo que no encuentra nada pasa todos los tests de abajo en verde, que
   * es la forma más cara de tener una guarda. El piso no es una lista de las que
   * hay: es un mínimo, y agregar una cuarta sección no lo deja viejo.
   */
  it("el escaneo encuentra las secciones que hay", () => {
    expect(laListaDe.size).toBeGreaterThanOrEqual(3);
    for (const [familia, urls] of laListaDe) {
      expect(urls, `Sumar${familia} tiene que escribir a una sola lista`).toHaveLength(1);
    }
  });

  it("dos secciones no comparten lista", () => {
    const listas = [...laListaDe.values()].flat();
    expect(new Set(listas).size).toBe(listas.length);
  });

  /*
   * La que atrapa el copiar-y-pegar. Se miran sólo las URL que alguna sección usa
   * como su lista: `FilaAprobador` también le pide a `/api/compras/sheets/opciones`
   * los alias del desplegable, y eso no es la lista de nadie.
   */
  it("el alta y la baja de una sección van a la misma lista", () => {
    const todasLasListas = new Set([...laListaDe.values()].flat());

    for (const [nombre, cuerpo] of porNombre) {
      if (!nombre.startsWith("Fila")) continue;
      const familia = familiaDe(nombre)!;
      const suya = laListaDe.get(familia);
      expect(suya, `${nombre} no tiene un Sumar${familia} que diga a qué lista va`).toBeDefined();

      const usa = endpoints(cuerpo).filter((u) => todasLasListas.has(u));
      expect(usa, `${nombre} tiene que dar de baja de la lista de Sumar${familia}`).toEqual(suya);
    }
  });
});
