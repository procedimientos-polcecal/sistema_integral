// ESLint 9 ya no lee `.eslintrc.*` y acá no había ningún archivo de config:
// `npm run lint` moría con "couldn't find an eslint.config file" en vez de
// revisar nada. Un lint que no corre es peor que no tenerlo, porque el script
// existe y da la impresión de que algo se está mirando.
//
// `eslint-config-next` 16 ya exporta config plana, así que no hace falta
// `FlatCompat` —que además revienta con un "circular structure to JSON" al
// intentar extender `next/core-web-vitals` por el camino viejo—.
import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

export default [
  {
    ignores: [
      ".next/**",
      "node_modules/**",
      "graphify-out/**",
      "scripts/**/node_modules/**",
      // Corren en Apps Script, no en este runtime: otro dialecto y otros
      // globales. Se validan con `node --check` sobre una copia .js.
      "docs/**",
    ],
  },
  ...nextCoreWebVitals,
  ...nextTypescript,
  {
    rules: {
      // El proyecto usa `any` a propósito en los bordes: lo que llega de Sheets,
      // de Odoo y de PostgREST no tiene forma conocida hasta que se valida. Que
      // avise, sin frenar.
      "@typescript-eslint/no-explicit-any": "warn",

      /**
       * Aviso y no error, con los 35 casos revisados de a uno.
       *
       * La regla es de la época del React Compiler y su ideal es que el estado
       * se derive o venga de Suspense, no que se setee dentro de un efecto. El
       * reparto real en este repo, mirado caso por caso:
       *
       *   - ~30 son `useEffect(() => cargar(), [filtros])`, donde `cargar` pone
       *     "cargando", pide a la API y guarda. Es el patrón normal de traer
       *     datos con `fetch` y no hay nada roto en él.
       *   - 5 son limpiar lo viejo al cambiar la entrada —`setPagina(0)`,
       *     `setDetalleHoy(null)`— para no mostrar los resultados del filtro
       *     anterior mientras llega el nuevo. Es deliberado y es lo correcto.
       *   - 2 sincronizan con algo de afuera que en el servidor no existe: el
       *     `localStorage` del panel lateral y la detección de push. Ahí el
       *     efecto es la única fase posible.
       *   - 2 (`Sidebar` y `SemanaClient`) sí se podrían derivar en el render,
       *     pero necesitan además un estado de "la persona eligió otra cosa"
       *     para que su elección no se pierda al re-renderizar. Vale hacerlo;
       *     no vale hacerlo de apuro.
       *
       * De los 36 que había, uno era un bug de verdad —el panel lateral
       * escribía la preferencia en `localStorage` desde un efecto y en el primer
       * commit pisaba con el valor viejo lo que acababa de leer— y está
       * corregido: ahora se guarda en el handler del botón, que es donde pasa la
       * intención de la persona.
       *
       * Queda en `warn` porque en `error` el lint nunca puede pasar, y un lint
       * que siempre falla es un lint que se ignora: es exactamente cómo este
       * repo llegó a no tener configuración de ESLint. Los 34 restantes siguen
       * saliendo en la salida y en el conteo.
       */
      "react-hooks/set-state-in-effect": "warn",
    },
  },
];
