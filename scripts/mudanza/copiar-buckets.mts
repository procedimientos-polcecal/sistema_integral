/**
 * Copiar los objetos de Storage de un proyecto a otro.
 *
 * Hace falta porque **`pg_dump` no se lleva los archivos**: la base queda
 * perfecta y las fotos de mantenimiento y los PDF de facturas apuntan a un
 * bucket vacío. Es el agujero clásico de esta migración, y no se nota hasta que
 * alguien abre una orden de trabajo vieja — que puede ser meses después.
 *
 *   # sólo mirar, no escribe nada:
 *   ORIGEN_URL=... ORIGEN_KEY=... npx tsx scripts/mudanza/copiar-buckets.mts --listar
 *
 *   # copiar de verdad:
 *   ORIGEN_URL=... ORIGEN_KEY=... DESTINO_URL=... DESTINO_KEY=... \
 *     npx tsx scripts/mudanza/copiar-buckets.mts
 *
 * Con `--listar` sirve para medir antes de la ventana: dice cuántos objetos y
 * cuántos MB hay que mover, que es lo que dice cuánto va a tardar.
 */
import {
  listarBuckets, listarObjetos, bajarObjeto, subirObjeto, crearBucket,
} from "./supabase";

const soloListar = process.argv.includes("--listar");

const origen = { url: process.env.ORIGEN_URL ?? "", serviceKey: process.env.ORIGEN_KEY ?? "" };
if (!origen.url || !origen.serviceKey) {
  console.error("Faltan ORIGEN_URL y ORIGEN_KEY.");
  process.exit(1);
}

const destino = { url: process.env.DESTINO_URL ?? "", serviceKey: process.env.DESTINO_KEY ?? "" };
if (!soloListar && (!destino.url || !destino.serviceKey)) {
  console.error("Faltan DESTINO_URL y DESTINO_KEY. Para sólo mirar, corré con --listar.");
  process.exit(1);
}

console.log(`Origen : ${origen.url}`);
console.log(soloListar ? "Destino: (ninguno, sólo listar)" : `Destino: ${destino.url}`);

for (const bucket of await listarBuckets(origen)) {
  const objetos = await listarObjetos(origen, bucket.id);
  const mb = (objetos.reduce((total, o) => total + o.bytes, 0) / 1024 / 1024).toFixed(1);

  console.log(
    `\n${bucket.id}: ${objetos.length} objetos, ${mb} MB` +
      (bucket.public ? " (público)" : " (privado)"),
  );

  if (soloListar) continue;

  await crearBucket(destino, bucket);

  let copiados = 0;
  const fallados: { ruta: string; error: string }[] = [];

  for (const objeto of objetos) {
    try {
      await subirObjeto(destino, bucket.id, objeto.ruta, await bajarObjeto(origen, bucket.id, objeto.ruta));
      copiados++;
      if (copiados % 25 === 0) console.log(`  ${copiados}/${objetos.length}`);
    } catch (e) {
      // Se anota y se sigue. Un archivo roto no puede dejar sin copiar a los
      // otros trescientos, y la lista del final es lo que se mira: un fallo por
      // archivo es accionable, un corte en el archivo 12 no dice nada de los
      // que venían después.
      fallados.push({ ruta: objeto.ruta, error: e instanceof Error ? e.message : String(e) });
    }
  }

  console.log(`  copiados ${copiados}/${objetos.length}`);
  if (fallados.length) {
    console.log(`  FALLARON ${fallados.length}:`);
    for (const f of fallados) console.log(`    ${f.ruta}: ${f.error}`);
    process.exitCode = 1;
  }
}

if (process.exitCode) {
  console.log("\nQuedaron archivos sin copiar. Se puede volver a correr: sube con upsert.");
}
