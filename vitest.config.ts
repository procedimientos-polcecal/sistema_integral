import { defineConfig } from "vitest/config";
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
  },
});
