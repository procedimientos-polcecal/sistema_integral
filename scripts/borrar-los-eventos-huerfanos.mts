// Los eventos de calendario que dejó huérfanos el loop de PO-C1-04.
//
//   npx tsx scripts/borrar-los-eventos-huerfanos.mts              ← sólo dice qué haría
//   npx tsx scripts/borrar-los-eventos-huerfanos.mts --ejecutar   ← los borra
//
// ── POR QUÉ HAY QUE BUSCARLOS EN GOOGLE Y NO EN LA BASE ─────────────────────
//
// `agenda_eventos.ot_id` es `on delete cascade`: al borrar las 425 OT del loop
// se fueron también sus filas, y con ellas los `google_event_id`. Los eventos
// quedaron vivos en el calendario sin que nada del sistema los nombre. Así que
// se los busca por el título, que es `OT <número> · <equipo>`.
//
// **Se borra con `sendUpdates=none`**, que es lo mismo con lo que se crearon:
// un evento de OT no avisa a los invitados (`avisaALosInvitados`). Con `all`
// serían 376 cancelaciones por correo a cinco personas.
//
// El motivo de que esto exista: el primer intento llamó a `borrarEvento` con
// dos argumentos y el tercero —`AvisoAInvitados`— es obligatorio justamente
// para que nadie lo herede sin elegirlo. Google rechazó los 376, enteros.

import { readFileSync, existsSync } from "node:fs";
const env = process.env.ENV_PATH ?? new URL("../.env.local", import.meta.url).pathname;
if (existsSync(env)) {
  for (const line of readFileSync(env, "utf-8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
}

const { obtenerToken, SCOPE_CALENDAR } = await import("../lib/core/google.ts");

const EJECUTAR = process.argv.includes("--ejecutar");

// ── LAS QUE NO SON BASURA, Y POR QUÉ SE PREGUNTA EN VEZ DE LISTARLAS ────────
//
// El rango 3167–3594 tiene adentro órdenes legítimas de otros equipos: son la
// 3172 y la 3176, el mismo caso que obligó a borrar la planilla fila por fila
// y no por tramo. En vez de escribirlas a mano, se pregunta: **toda OT de ese
// rango que todavía exista en la base es legítima**, porque las del loop ya se
// borraron. Así la lista no puede quedarse corta.
const U = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const K = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
if (!U || !K) throw new Error("Falta la URL de Supabase o la service role key");
const CASILLAS = ["mantenimiento@polcecal.com", "soporte.mantenimiento@polcecal.com"];
const DESDE = "2026-11-01T00:00:00Z";
const HASTA = "2027-06-30T00:00:00Z";
const PRIMERA = 3167, ULTIMA = 3594;
const EVENTOS = "https://www.googleapis.com/calendar/v3/calendars/primary/events";

type EventoDeGoogle = { id: string; summary?: string; start?: { dateTime?: string; date?: string } };

const vivas = await (async () => {
  const res = await fetch(
    `${U}/rest/v1/ordenes_trabajo?select=ot_number&ot_number=gte.${PRIMERA}&ot_number=lte.${ULTIMA}&limit=2000`,
    { headers: { apikey: K, Authorization: `Bearer ${K}` } }
  );
  const body = (await res.json()) as Array<{ ot_number: number }>;
  if (!res.ok) throw new Error(`no se pudo leer qué OT siguen vivas: ${JSON.stringify(body)}`);
  return new Set(body.map((o) => o.ot_number));
})();
console.log(`OT del rango ${PRIMERA}–${ULTIMA} que SIGUEN EN LA BASE y no se tocan: ` +
  `${vivas.size} (${[...vivas].sort((a, b) => a - b).join(", ") || "ninguna"})`);

const delLoop = (summary: string | undefined): number | null => {
  const m = /^OT\s+(\d+)\s*[·.]/.exec(String(summary ?? "").trim());
  if (!m) return null;
  const n = Number(m[1]);
  if (n < PRIMERA || n > ULTIMA) return null;
  if (vivas.has(n)) return null;
  return n;
};

let totalBorrados = 0, totalFallados = 0;
const erroresVistos: string[] = [];

for (const casilla of CASILLAS) {
  const token = await obtenerToken([SCOPE_CALENDAR], casilla);
  const encontrados: EventoDeGoogle[] = [];
  let pageToken: string | undefined;

  do {
    const url = new URL(EVENTOS);
    url.searchParams.set("timeMin", DESDE);
    url.searchParams.set("timeMax", HASTA);
    url.searchParams.set("maxResults", "2500");
    url.searchParams.set("singleEvents", "true");
    url.searchParams.set("showDeleted", "false");
    if (pageToken) url.searchParams.set("pageToken", pageToken);

    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) throw new Error(`listar ${casilla}: ${res.status} ${(await res.text()).slice(0, 200)}`);
    const body = (await res.json()) as { items?: EventoDeGoogle[]; nextPageToken?: string };
    for (const e of body.items ?? []) if (delLoop(e.summary) !== null) encontrados.push(e);
    pageToken = body.nextPageToken;
  } while (pageToken);

  console.log(`\n${casilla}: ${encontrados.length} eventos del loop (OT ${PRIMERA}–${ULTIMA})`);
  if (encontrados[0]) {
    const dias: Record<string, number> = {};
    for (const e of encontrados) {
      const d = (e.start?.dateTime ?? e.start?.date ?? "?").slice(0, 10);
      dias[d] = (dias[d] ?? 0) + 1;
    }
    console.log("  por día:", dias);
    console.log("  muestra:", encontrados[0].summary);
  }

  if (!EJECUTAR) continue;

  for (const e of encontrados) {
    const res = await fetch(
      `${EVENTOS}/${encodeURIComponent(e.id)}?sendUpdates=none`,
      { method: "DELETE", headers: { Authorization: `Bearer ${token}` } }
    );
    if (res.ok || res.status === 404 || res.status === 410) { totalBorrados++; continue; }
    totalFallados++;
    if (erroresVistos.length < 5) erroresVistos.push(`${res.status}: ${(await res.text()).slice(0, 160)}`);
  }
  console.log(`  ✓ borrados hasta acá: ${totalBorrados}`);
}

if (!EJECUTAR) {
  console.log("\n── Sólo el plan. Para borrarlos: --ejecutar ──");
} else {
  console.log(`\n✓ ${totalBorrados} eventos borrados · ${totalFallados} fallaron.`);
  if (erroresVistos.length) console.log("primeros errores:\n  " + erroresVistos.join("\n  "));
}
