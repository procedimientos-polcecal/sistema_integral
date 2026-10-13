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

// Los selectores de la regla de "hoy en UTC". Se definen acá arriba porque el
// bloque de los archivos del stash los repite en `warn`.
//
// `new Date()` SIN argumentos es lo que los distingue del uso legítimo: sin
// argumento es "ahora", y recortar "ahora" en UTC es el bug.
const NUEVA_FECHA_AHORA =
  "callee.object.callee.object.type='NewExpression'][callee.object.callee.object.callee.name='Date'][callee.object.callee.object.arguments.length=0]";
const HOY_EN_UTC_SLICE =
  "CallExpression[callee.property.name='slice'][callee.object.callee.property.name='toISOString'][arguments.0.value=0][arguments.1.value=10][" +
  NUEVA_FECHA_AHORA;
const HOY_EN_UTC_SPLIT =
  "MemberExpression[computed=true][property.value=0][object.callee.property.name='split'][object.arguments.0.value='T'][object.callee.object.callee.property.name='toISOString'][object.callee.object.callee.object.type='NewExpression'][object.callee.object.callee.object.callee.name='Date'][object.callee.object.callee.object.arguments.length=0]";
const HOY_EN_UTC_DE_RRHH =
  "CallExpression[callee.name='utcDateOnlyFrom'][arguments.length=1][arguments.0.type='NewExpression'][arguments.0.callee.name='Date'][arguments.0.arguments.length=0]";
const MENSAJE_HOY_EN_UTC =
  "Esto es 'hoy en UTC', no 'hoy': desde las 21:00 de Argentina ya devuelve el día siguiente (Vercel corre en UTC, y toISOString() convierte a UTC también en el navegador). Usá hoyEnArgentina() de lib/core/fechas.ts (\"YYYY-MM-DD\"), diaEnArgentina(n) para un día relativo, o hoyComoDiaArgentina() de lib/rrhh/dates.ts si necesitás un Date.";

export default [
  {
    ignores: [
      ".next/**",
      "node_modules/**",
      "graphify-out/**",
      "scripts/**/node_modules/**",
      // Los worktrees de Claude Code viven adentro del repo, así que ESLint
      // los recorría como código del proyecto: con uno abierto aparecían seis
      // errores duplicados, los mismos archivos contados dos veces. Es la
      // misma trampa que ya está anotada en `vitest.config.mts` y por la misma
      // razón: el número deja de significar algo, y lo peor no es el ruido
      // sino que un error del worktree de otra sesión se lee como propio —y
      // uno arreglado allá tapa el que sigue roto acá.
      ".claude/**",
      // pdf.js vendorizado y minificado. No es código de este proyecto y no se
      // edita: los seis `no-this-alias` que aporta son del minificador, no de
      // nadie, y no hay nada que arreglar.
      "public/pdfjs/**",
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

      /**
       * "Hoy" no es `new Date().toISOString().slice(0, 10)`: eso es hoy en UTC.
       *
       * Argentina es UTC-3 y Vercel corre en UTC, así que desde las 21:00 de
       * acá ya devuelve el día siguiente. En el navegador pasa igual, porque
       * `toISOString()` convierte a UTC venga de donde venga: no es un problema
       * de dónde corre sino de la función. Costó 68 filas de `calculos_diarios`
       * marcando ausente a toda la planta para un día que no había empezado, y
       * fechas guardadas con un día de adelanto (francos, requerimientos,
       * avisos y órdenes de mantenimiento). Se barrieron 38 sitios el 13/10/2026.
       *
       * Qué usar: `hoyEnArgentina()` de `lib/core/fechas.ts` ("YYYY-MM-DD"; sirve
       * igual en servidor y navegador), `diaEnArgentina(n)` para un día
       * relativo, y `hoyComoDiaArgentina()` de `lib/rrhh/dates.ts` si el código
       * trabaja con `Date`.
       *
       * Sólo caza "hoy": `new Date(x).toISOString().slice(0, 10)` sobre una fecha
       * que ya se tiene en la mano no se toca, y las dos implementaciones
       * correctas (`lib/core/fechas.ts`, `lib/rrhh/dates.ts`) quedan afuera más
       * abajo. Si alguna vez el UTC es lo que se quiere —un cron a las 10:30 UTC,
       * por ejemplo—, va un `eslint-disable-next-line` con el motivo al lado.
       */
      "no-restricted-syntax": [
        "error",
        {
          selector: HOY_EN_UTC_SLICE,
          message: MENSAJE_HOY_EN_UTC,
        },
        {
          selector: HOY_EN_UTC_SPLIT,
          message: MENSAJE_HOY_EN_UTC,
        },
        {
          selector: HOY_EN_UTC_DE_RRHH,
          message: MENSAJE_HOY_EN_UTC,
        },
      ],
    },
  },
  // Dónde vive la implementación correcta: ahí `toISOString()` es la mitad de
  // la cuenta, después de restar el offset, y no es el bug.
  {
    files: ["lib/core/fechas.ts", "lib/rrhh/dates.ts"],
    rules: { "no-restricted-syntax": "off" },
  },
  // Tres archivos con el patrón que siguen abiertos porque están en un stash
  // de Cantera (`stash@{0}`) que modifica esas mismas líneas: arreglarlos acá
  // sería un conflicto el día que lo recuperen. En `warn` y no en `error` para
  // que el lint no se ponga rojo por archivos que nadie puede tocar todavía.
  // Cuando se recupere el stash y se arreglen, borrar este bloque.
  {
    files: [
      "app/(app)/cantera/destape/cargar/CargarDestapeClient.tsx",
      "app/(app)/cantera/destape/cargar/page.tsx",
      "app/(app)/trituracion/partes/PartesClient.tsx",
    ],
    rules: {
      "no-restricted-syntax": [
        "warn",
        { selector: HOY_EN_UTC_SLICE, message: MENSAJE_HOY_EN_UTC },
        { selector: HOY_EN_UTC_SPLIT, message: MENSAJE_HOY_EN_UTC },
        { selector: HOY_EN_UTC_DE_RRHH, message: MENSAJE_HOY_EN_UTC },
      ],
    },
  },
];
