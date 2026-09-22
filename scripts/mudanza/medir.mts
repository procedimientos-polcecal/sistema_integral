/**
 * Medir la latencia contra la app y contra la base.
 *
 * Se corre antes de la mudanza y después. Si el "después" no bajó, la mudanza
 * no sirvió, y eso hay que poder decirlo con un número y no con una sensación
 * —que es como se discute si algo "anda más rápido" cuando nadie midió—.
 *
 *   npx tsx --env-file=.env.local scripts/mudanza/medir.mts
 *
 * Informa la **mediana**, no el promedio: la primera llamada paga el arranque
 * en frío y un promedio de siete la arrastra entera.
 */
const VUELTAS = 7;

async function medir(nombre: string, url: string, headers: Record<string, string> = {}) {
  const tiempos: number[] = [];

  for (let i = 0; i < VUELTAS; i++) {
    const desde = performance.now();
    try {
      await fetch(url, { headers, cache: "no-store" });
      tiempos.push(performance.now() - desde);
    } catch {
      // Una vuelta perdida no invalida la medición; siete perdidas sí, y eso
      // se ve abajo.
    }
  }

  if (!tiempos.length) {
    console.log(`${nombre.padEnd(22)} no contestó`);
    return;
  }

  tiempos.sort((a, b) => a - b);
  const mediana = tiempos[Math.floor(tiempos.length / 2)];
  console.log(
    `${nombre.padEnd(22)} mediana ${mediana.toFixed(0).padStart(4)} ms` +
      `   (min ${tiempos[0].toFixed(0)}, max ${tiempos[tiempos.length - 1].toFixed(0)}` +
      `, ${tiempos.length}/${VUELTAS} vueltas)`,
  );
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const app = process.env.NEXT_PUBLIC_APP_URL ?? "https://sistema-integral-one.vercel.app";

if (!url || !key) {
  console.error("Faltan NEXT_PUBLIC_SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY (usá --env-file=.env.local).");
  process.exit(1);
}

console.log(`${new Date().toISOString()}`);
console.log(`app  ${app}`);
console.log(`base ${url}\n`);

await medir("app", app);
await medir("base (1 fila)", `${url}/rest/v1/usuarios?select=id&limit=1`, {
  apikey: key,
  Authorization: `Bearer ${key}`,
});
