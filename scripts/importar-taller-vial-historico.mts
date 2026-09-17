/**
 * Envoltorio de línea de comandos de `sincronizarCargasDesdeSheets`
 * (`lib/tallerVial/importar.ts`) — mismo patrón que
 * `scripts/importar-acarreo-2026.mts` con `lib/cantera/importarAcarreo.ts`.
 * El cron (`/api/cron/taller-vial-sync`) llama a la misma función.
 *
 *   npx tsx --env-file=.env.local scripts/importar-taller-vial-historico.mts
 */
import { sincronizarCargasDesdeSheets } from "../lib/tallerVial/importar";

async function main() {
  const resultado = await sincronizarCargasDesdeSheets(true);
  console.log(resultado);
}

main();
