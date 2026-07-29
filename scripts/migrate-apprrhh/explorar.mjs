// Reconocimiento de la base real de APPRRHH (Neon) antes de migrar.
// Uso: DATABASE_URL="postgresql://..." node explorar.mjs
import pg from "pg";

const client = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await client.connect();

async function contar(tabla) {
  const { rows } = await client.query(`select count(*)::int as n from "${tabla}"`);
  return rows[0].n;
}

async function rango(tabla, columna) {
  const { rows } = await client.query(`select min("${columna}") as min, max("${columna}") as max from "${tabla}"`);
  return rows[0];
}

const tablas = [
  "User", "Employee", "Empresa", "Sector", "UserSector", "Jornada",
  "TimeRecord", "ImportBatch", "Holiday", "PayrollConfig",
  "DailyCalculation", "Absence", "VacationPeriod", "FrancoCompensatorio", "PayrollPeriod",
];

for (const t of tablas) {
  try {
    const n = await contar(t);
    console.log(`${t.padEnd(22)} ${n}`);
  } catch (e) {
    console.log(`${t.padEnd(22)} ERROR: ${e.message}`);
  }
}

console.log("\n--- rango de fechas ---");
console.log("TimeRecord.fecha:", await rango("TimeRecord", "fecha"));
console.log("DailyCalculation.fecha:", await rango("DailyCalculation", "fecha"));
console.log("Absence.fechaDesde:", await rango("Absence", "fechaDesde"));

console.log("\n--- horasManual=true (overrides manuales de Karen) ---");
const { rows: manual } = await client.query(`select count(*)::int as n from "DailyCalculation" where "horasManual" = true`);
console.log("DailyCalculation con horasManual=true:", manual[0].n);

console.log("\n--- últimas fichadas cargadas (por createdAt si existe, si no por fecha) ---");
const cols = await client.query(`select column_name from information_schema.columns where table_name='TimeRecord'`);
console.log("Columnas de TimeRecord:", cols.rows.map(r => r.column_name).join(", "));

await client.end();
