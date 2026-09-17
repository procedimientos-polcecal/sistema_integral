/**
 * Envoltorio de línea de comandos de `sincronizarCargasDesdeSheets` y
 * `sincronizarEstadosDesdeSheets` (`lib/tallerVial/importar.ts`) — mismo
 * patrón que `scripts/importar-acarreo-2026.mts` con
 * `lib/cantera/importarAcarreo.ts`. El cron (`/api/cron/taller-vial-sync`)
 * llama a las mismas funciones.
 *
 *   npx tsx --env-file=.env.local scripts/importar-taller-vial-historico.mts
 */
import { sincronizarCargasDesdeSheets, sincronizarEstadosDesdeSheets } from "../lib/tallerVial/importar";

async function main() {
  console.log("Cargas:", await sincronizarCargasDesdeSheets(true));
  const estados = await sincronizarEstadosDesdeSheets(true);
  console.log("Estados:", { ...estados, codigosSinMapear: [...estados.codigosSinMapear] });
}

main();
