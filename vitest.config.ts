import { defineConfig, configDefaults } from "vitest/config";
import path from "node:path";

export default defineConfig({
  // Mismo alias que tsconfig: sin esto, cualquier test que alcance un módulo
  // que importe con "@/..." falla al resolver, y termina obligando a mover
  // código sólo para poder testearlo.
  resolve: {
    alias: { "@": path.resolve(__dirname, ".") },
  },
  test: {
    environment: "node",
    include: ["**/*.test.ts"],
    /*
     * Sin esto, los tests de los worktrees de los agentes corren también.
     *
     * `.claude/worktrees/` son copias del repo que crean las sesiones que
     * trabajan aisladas, y con el `include` de arriba vitest levanta sus
     * archivos igual que los propios: la suite pasó de 95 archivos a 287 y de
     * 1.357 tests a 4.070, corriendo tres veces lo mismo. Peor que la lentitud
     * es la señal: un test roto en el worktree de otra sesión aparece como una
     * falla propia, y uno arreglado allá tapa el que está roto acá.
     *
     * Se agrega a los `exclude` que vitest ya trae —node_modules, dist— en vez
     * de reemplazarlos, que es lo que pasa si uno escribe la lista a mano.
     */
    exclude: [...configDefaults.exclude, ".claude/**"],
  },
});
