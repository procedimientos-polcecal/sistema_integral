// Lo que muestra /compras/comparativas, contra la base real. SÓLO LEE.
//
// POR QUÉ EXISTE
//
// La pantalla está detrás del login, como casi todo el sistema, así que no se
// puede abrir en un navegador desde acá. Lo que sí se puede es correr **la
// misma consulta y las mismas funciones** que usa: el `select` está copiado de
// `app/(app)/compras/comparativas/page.tsx` y el mapeo también, así que una
// columna que cambie de nombre o un embebido que deje de resolver salen acá y
// no en producción.
//
// Los tests de `lib/compras/buscadorDeComparativas.test.ts` prueban las
// decisiones con fixtures; esto prueba que los datos de verdad tienen la forma
// que esas decisiones suponen. Son dos preguntas distintas y las dos hacen
// falta: el primer recorrido contra la base fue el que mostró que el artículo
// más cotizado tiene sus 9 cotizaciones en un solo pedido, que es lo que
// separó `veces` de `pedidos`.
//
// Uso:
//   npx tsx scripts/probar-buscador-de-comparativas.mts
//
// Necesita las claves de Supabase en `.env.local`. No escribe nada.
import { readFileSync, existsSync } from "node:fs";

const env = new URL("../.env.local", import.meta.url);
if (existsSync(env)) {
  for (const line of readFileSync(env, "utf-8").split("\n")) {
    const m = line.match(/^([A-Z_0-9]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
}

const { createAdminClient } = await import("../lib/supabase/admin.ts");
const { agruparPorArticulo, buscarEnComparativas } = await import(
  "../lib/compras/buscadorDeComparativas.ts"
);
type CotizacionHistorica = Awaited<
  ReturnType<typeof import("../lib/compras/buscadorDeComparativas.ts")["buscarEnComparativas"]>
>[number];

const db = createAdminClient();
const titulo = (t: string) => console.log(`\n── ${t} ${"─".repeat(Math.max(0, 68 - t.length))}`);

// Copiado de la página. Si esto deja de resolver, la pantalla también.
const SELECT =
  "id, precio_unitario, precio_total, cantidad, unidad_medida, marca, moneda, condiciones_pago, disponibilidad, proveedores(id, nombre), compras_requerimientos(id, nro_ri, descripcion, clave_articulo, fecha, comparativa_drive_id, comparativa_nombre)";

const crudas: Record<string, unknown>[] = [];
for (let desde = 0; ; desde += 1000) {
  const { data, error } = await db
    .from("compras_cotizaciones")
    .select(SELECT)
    .range(desde, desde + 999);
  if (error) {
    console.error("La consulta de la pantalla falló:", error.message);
    process.exit(1);
  }
  crudas.push(...(data as Record<string, unknown>[]));
  if (data.length < 1000) break;
}

titulo("lo que trae la consulta");
console.log(`  ${crudas.length} cotizaciones`);

const cotizaciones: CotizacionHistorica[] = crudas
  .filter((f) => f.compras_requerimientos && f.proveedores)
  .map((f) => {
    const ri = f.compras_requerimientos as Record<string, never>;
    const prov = f.proveedores as Record<string, never>;
    return {
      id: f.id as string,
      requerimientoId: ri.id as string,
      nroRi: ri.nro_ri as number | null,
      descripcion: (ri.descripcion as string) ?? "(sin descripción)",
      claveArticulo: (ri.clave_articulo as string) ?? (ri.descripcion as string) ?? "",
      fecha: ri.fecha as string | null,
      proveedorId: prov.id as string,
      proveedor: prov.nombre as string,
      marca: f.marca as string | null,
      moneda: (f.moneda as string) ?? "ARS",
      precioUnitario: f.precio_unitario as number | null,
      precioTotal: f.precio_total as number | null,
      cantidad: f.cantidad as number | null,
      unidadMedida: f.unidad_medida as string | null,
      condicionesPago: f.condiciones_pago as string | null,
      disponibilidad: f.disponibilidad as string | null,
      planillaId: ri.comparativa_drive_id as string | null,
      planillaNombre: ri.comparativa_nombre as string | null,
    };
  });

const descartadas = crudas.length - cotizaciones.length;
console.log(`  ${descartadas} descartadas por venir sin pedido o sin proveedor`);

const grupos = agruparPorArticulo(cotizaciones);
const repetidos = grupos.filter((g) => g.pedidos > 1);
const comparativas = grupos.filter((g) => g.veces > 1 && g.pedidos === 1);

titulo("cómo queda agrupado");
console.log(`  ${grupos.length} artículos`);
console.log(`  ${repetidos.length} pedidos más de una vez — los que tienen historial de precio`);
console.log(`  ${comparativas.length} con varios presupuestos de un solo pedido — comparativas`);
console.log(`  ${grupos.filter((g) => !g.rango).length} sin rango de precio`);

titulo("los cinco artículos con más historial");
for (const g of [...repetidos].sort((a, b) => b.pedidos - a.pedidos).slice(0, 5)) {
  const r = g.rango
    ? `${g.rango.moneda} ${g.rango.minimo.toLocaleString("es-AR")} – ${g.rango.maximo.toLocaleString("es-AR")}`
    : "sin rango";
  console.log(
    `  ${String(g.pedidos).padStart(2)} pedidos · ${String(g.veces).padStart(2)} cot. · ` +
      `${g.proveedores} prov. · ${r.padEnd(34)} ${g.descripcion.slice(0, 44)}`
  );
}

titulo("los filtros contestan");
for (const texto of ["filtro aceite", "guantes", "correa", "SKF"]) {
  const encontradas = buscarEnComparativas(cotizaciones, { texto });
  console.log(
    `  «${texto}» → ${encontradas.length} cotizaciones en ${agruparPorArticulo(encontradas).length} artículos`
  );
}
const unProveedor = cotizaciones[0];
if (unProveedor) {
  const suyas = buscarEnComparativas(cotizaciones, { proveedorId: unProveedor.proveedorId });
  console.log(`  proveedor «${unProveedor.proveedor}» → ${suyas.length} cotizaciones`);
}
console.log(`  sin filtros → ${buscarEnComparativas(cotizaciones, {}).length} cotizaciones`);

// Lo que la pantalla tiene que poder decir sin mentir: un artículo cotizado en
// dos monedas no lleva rango. Si esto deja de aparecer no es un error —puede no
// haber ninguno—, pero deja de estar ejercitado el camino.
const mezcla = grupos.find((g) => !g.rango && g.cotizaciones.some((c) => c.precioUnitario !== null));
titulo("artículos cotizados en más de una moneda");
console.log(
  mezcla
    ? `  ${mezcla.descripcion.slice(0, 50)} → ${[...new Set(mezcla.cotizaciones.map((c) => c.moneda))].join(", ")}`
    : "  ninguno hoy"
);

const sinPrecio = cotizaciones.filter((c) => c.precioUnitario === null).length;
const marcaLarga = cotizaciones.filter((c) => (c.marca ?? "").length > 60).length;
titulo("lo que la pantalla tiene que aguantar");
console.log(`  ${sinPrecio} cotizaciones sin precio unitario`);
console.log(`  ${marcaLarga} con la marca de más de 60 caracteres (se recortan en la fila)`);
