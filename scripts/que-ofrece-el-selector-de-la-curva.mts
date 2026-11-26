/**
 * Qué ofrece el selector de `/calidad/ensayos/curva` para cada producto: sus
 * muestras, y cuáles suma la casilla «mismo juego de tamices».
 *
 * Existe porque esa pantalla está detrás del login y no se puede abrir desde
 * acá, y porque lo que decide el grupo es el juego **declarado** del producto
 * (`calidad_ensayos_productos.mallas`) y no el que midió cada muestra: las dos
 * columnas de abajo —declarado contra medido— son justamente la diferencia que
 * hay que mirar antes de dudar del criterio.
 *
 *   npx tsx scripts/que-ofrece-el-selector-de-la-curva.mts
 */
import { readFileSync } from "node:fs";

const env = readFileSync(new URL("../../../../.env.local", import.meta.url), "utf8");
for (const linea of env.split(/\r?\n/)) {
  const m = /^([A-Z0-9_]+)=(.*)$/.exec(linea);
  if (m) process.env[m[1]] ??= m[2].replace(/^"|"$/g, "");
}

const { createAdminClient } = await import("../lib/supabase/admin.ts");
const { traerTodo } = await import("../lib/core/paginado.ts");
const { claveDelJuego, losQueComparten } = await import("../lib/calidad/ensayos/juegoDeTamices.ts");

const supabase = createAdminClient();

const productos = await traerTodo<{ id: string; nombre: string; mallas: number[] }>((d, h) =>
  supabase
    .from("calidad_ensayos_productos")
    .select("id, nombre, mallas")
    .order("orden")
    .range(d, h)
);

const muestras = await traerTodo<{ id: string; producto_id: string }>((d, h) =>
  supabase.from("calidad_ensayos_muestras").select("id, producto_id").range(d, h)
);

const retenidos = await traerTodo<{ muestra_id: string; malla: number }>((d, h) =>
  supabase
    .from("calidad_ensayos_retenidos")
    .select("muestra_id, malla")
    .order("muestra_id")
    .order("malla")
    .range(d, h)
);

const medidoPorMuestra = new Map<string, number[]>();
for (const r of retenidos) {
  medidoPorMuestra.set(r.muestra_id, [...(medidoPorMuestra.get(r.muestra_id) ?? []), r.malla]);
}

/** Cuántas muestras con granulometría tiene un producto. */
const cuantas = (id: string) =>
  muestras.filter((m) => m.producto_id === id && medidoPorMuestra.has(m.id)).length;

/** Los juegos que midieron de verdad las muestras de un producto. */
const juegosMedidos = (id: string) => {
  const vistos = new Map<string, number>();
  for (const m of muestras) {
    if (m.producto_id !== id) continue;
    const mallas = medidoPorMuestra.get(m.id);
    if (!mallas) continue;
    const clave = claveDelJuego(mallas);
    vistos.set(clave, (vistos.get(clave) ?? 0) + 1);
  }
  return vistos;
};

console.log(`${productos.length} productos · ${medidoPorMuestra.size} muestras con granulometría\n`);

for (const p of productos) {
  const propias = cuantas(p.id);
  const grupo = losQueComparten(productos, p.id).filter((o) => cuantas(o.id) > 0);
  const suma = grupo.reduce((n, o) => n + cuantas(o.id), 0);

  if (propias === 0 && suma === 0) continue;

  console.log(`${p.nombre}  —  ${propias} muestra(s) propias`);
  console.log(`   declara: ${p.mallas.length > 0 ? p.mallas.join(" · ") : "(nada: no comparte con nadie)"}`);

  const medidos = juegosMedidos(p.id);
  if (medidos.size > 1) {
    console.log(
      `   midió ${medidos.size} juegos distintos: ${[...medidos]
        .map(([clave, n]) => `${clave} ×${n}`)
        .join("  |  ")}`
    );
  }

  console.log(
    grupo.length === 0
      ? "   la casilla no aparece"
      : `   la casilla suma ${suma} muestra(s) de ${grupo.length}: ${grupo
          .map((o) => `${o.nombre} (${cuantas(o.id)})`)
          .join(", ")}`
  );
  console.log("");
}
