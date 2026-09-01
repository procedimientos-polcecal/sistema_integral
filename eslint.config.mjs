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
       * Vuelve a `error`: los 35 que habia estan convertidos y queda uno solo,
       * con su disable y el motivo escrito al lado.
       *
       * Lo que se hizo, por si vuelve a aparecer alguno:
       *
       *   - Traer datos -> `useCargar` de `lib/core/useCargar.ts`. Ademas de
       *     dejar conforme a la regla, arregla un bug que estaba en las 27
       *     pantallas: ninguna descartaba la respuesta vieja, asi que cambiar
       *     un filtro dos veces seguidas podia pintar el resultado del filtro
       *     anterior.
       *   - "Cuando cambia esta entrada, volve este estado al principio"
       *     —`setPagina(0)`, cerrar el cajon al navegar— se ajusta DURANTE el
       *     render comparando contra el valor previo, que es lo que recomienda
       *     la doc de React. Encima saca un commit intermedio en el que la
       *     pantalla ya era la nueva y el estado todavia el viejo.
       *   - Sincronizar con un almacen externo que en el servidor no existe
       *     —el `localStorage` del panel lateral— se queda en un efecto, que es
       *     el caso para el que el efecto sigue siendo lo correcto. Ese es el
       *     unico disable.
       */
      "react-hooks/set-state-in-effect": "error",
    },
  },
];
