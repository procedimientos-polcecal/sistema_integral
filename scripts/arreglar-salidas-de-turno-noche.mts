// Corrige las fichadas cuya SALIDA quedó guardada antes que su entrada.
//
// QUÉ PASÓ
//
// El modal de corrección tiene un campo de fecha para la entrada y otro para
// la salida, y el de la salida arrancaba igual al de la entrada. En el turno
// de 20 a 4 eso es siempre lo contrario de lo correcto: se escribe 03:45 en la
// hora, nadie mira la fecha, y queda una salida dieciséis horas ANTES de la
// entrada. Nada lo impedía. El modal se arregló el 30/10/2026 (`ea8130b1`,
// `lib/rrhh/fichadas/turnoDeNoche.ts`); esto repara lo que ya quedó escrito.
//
// LA REGLA, Y POR QUÉ NO ADIVINA NADA
//
// Un turno no termina antes de empezar, así que una salida anterior a su
// entrada sólo puede ser del día siguiente: se le suma un día y nada más. Las
// HORAS no se tocan — son marcas reales del reloj—, sólo el día al que se
// imputa la salida. Los días vecinos lo confirman: PC_002 tiene el 06/10
// `19:34 -> 04:00` en medio de una racha de `19:xx -> +1d 0x:xx`.
//
// FRENOS
//
// Aborta si encuentra una fila que no cumple el patrón esperado: que corrida
// un día la salida quede DESPUÉS de la entrada y el turno dure a lo sumo 14
// horas (el mismo tope que usa la reconciliación para un cruce de medianoche).
// Si alguna no pasa, no se escribe ninguna — es un caso que hay que mirar a
// mano, no un caso para un script.
//
// Uso:
//   npx tsx scripts/arreglar-salidas-de-turno-noche.mts            (sólo informa)
//   npx tsx scripts/arreglar-salidas-de-turno-noche.mts --aplicar  (escribe)
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { recalcularEmpleadoPeriodo } from "../lib/rrhh/engine/recalcular.ts";

for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf-8").split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false },
});

const aplicar = process.argv.includes("--aplicar");
const DESDE = process.argv.find((a) => /^\d{4}-\d{2}-\d{2}$/.test(a)) ?? "2026-10-01";
const MAX_HORAS = 14;
const UN_DIA = 24 * 60 * 60 * 1000;

const hhmm = (iso: string) =>
  new Date(iso).toLocaleTimeString("es-AR", {
    timeZone: "America/Argentina/Buenos_Aires", hour12: false, hour: "2-digit", minute: "2-digit",
  });

interface Fila {
  id: string;
  empleado_id: string;
  fecha: string;
  hora_entrada: string;
  hora_salida: string;
}

async function main() {
  const { data: emps } = await sb.from("empleados").select("id, legajo").limit(2000);
  const leg = new Map((emps ?? []).map((e) => [e.id as string, (e.legajo as string) ?? "?"]));

  // Sin paginar no alcanza: PostgREST corta en 1000 y no avisa.
  const filas: Fila[] = [];
  for (let desde = 0; ; desde += 1000) {
    const { data, error } = await sb
      .from("fichadas")
      .select("id, empleado_id, fecha, hora_entrada, hora_salida")
      .gte("fecha", DESDE)
      .not("hora_salida", "is", null)
      .order("fecha")
      .order("id")
      .range(desde, desde + 999);
    if (error) throw new Error(error.message);
    filas.push(...((data ?? []) as Fila[]));
    if ((data ?? []).length < 1000) break;
  }

  const rotas = filas.filter((f) => new Date(f.hora_salida).getTime() <= new Date(f.hora_entrada).getTime());
  console.log(`Fichadas con salida desde ${DESDE}: ${filas.length}`);
  console.log(`Con la salida anterior o igual a la entrada: ${rotas.length}\n`);
  if (rotas.length === 0) return;

  const arreglos = rotas.map((f) => {
    const entrada = new Date(f.hora_entrada);
    const salidaVieja = new Date(f.hora_salida);
    const salidaNueva = new Date(salidaVieja.getTime() + UN_DIA);
    const horas = (salidaNueva.getTime() - entrada.getTime()) / 3_600_000;
    return { f, salidaNueva, horas, antes: (salidaVieja.getTime() - entrada.getTime()) / 3_600_000 };
  });

  for (const a of arreglos) {
    console.log(
      `  ${leg.get(a.f.empleado_id)}  ${a.f.fecha}  ${hhmm(a.f.hora_entrada)} -> ${hhmm(a.f.hora_salida)}` +
        `   ${a.antes.toFixed(1)}h  =>  +1 día: ${a.horas.toFixed(1)}h`
    );
  }

  const sospechosas = arreglos.filter((a) => a.horas <= 0 || a.horas > MAX_HORAS);
  if (sospechosas.length > 0) {
    console.error(
      `\nABORTA: ${sospechosas.length} fila(s) no quedan bien con un día más (0 < horas <= ${MAX_HORAS}).` +
        " Hay que mirarlas a mano; no se escribió nada."
    );
    process.exitCode = 1;
    return;
  }

  if (!aplicar) {
    console.log(`\n(sólo informe) ${arreglos.length} fichadas listas para corregir. Correr con --aplicar para escribir.`);
    return;
  }

  let escritas = 0;
  for (const a of arreglos) {
    const { error } = await sb
      .from("fichadas")
      .update({ hora_salida: a.salidaNueva.toISOString() })
      .eq("id", a.f.id)
      .eq("hora_salida", a.f.hora_salida); // nadie la tocó entre la lectura y ahora
    if (error) {
      console.error(`  FALLO ${a.f.id}: ${error.message}`);
      continue;
    }
    escritas++;
  }
  console.log(`\nFichadas corregidas: ${escritas} de ${arreglos.length}`);

  // El recálculo NO es opcional: sin él `calculos_diarios` conserva las horas
  // viejas y la pantalla sigue mostrando lo de antes. Se recalcula el día de
  // la fichada y el siguiente, porque la salida se mudó ahí.
  const dias = new Map<string, { empleadoId: string; fecha: string }>();
  for (const a of arreglos) {
    const base = new Date(a.f.fecha);
    for (const d of [base, new Date(base.getTime() + UN_DIA)]) {
      const fecha = d.toISOString().slice(0, 10);
      dias.set(`${a.f.empleado_id}|${fecha}`, { empleadoId: a.f.empleado_id, fecha });
    }
  }
  let recalculados = 0;
  for (const { empleadoId, fecha } of dias.values()) {
    try {
      await recalcularEmpleadoPeriodo(sb, empleadoId, new Date(fecha), new Date(fecha));
      recalculados++;
    } catch (e) {
      console.error(`  recálculo falló para ${leg.get(empleadoId)} ${fecha}: ${e instanceof Error ? e.message : e}`);
    }
  }
  console.log(`Días recalculados: ${recalculados} de ${dias.size}`);
}

await main();
