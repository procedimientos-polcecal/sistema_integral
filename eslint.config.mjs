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
    },
  },
];
