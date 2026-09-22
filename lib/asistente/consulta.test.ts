import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { correrConsulta } from "./consulta";

/**
 * Las credenciales salen de `.env.local` si está, y si no del entorno.
 *
 * El `try` no es decorativo: sin él este `readFileSync` tira `ENOENT` **al
 * cargar el módulo**, o sea antes de que el `describe.skip` de abajo pueda
 * saltear nada — y el archivo no existe en ningún lado que no sea la máquina
 * de quien desarrolla. El guard de abajo ya estaba bien escrito y decía
 * exactamente esta intención; esta línea lo anulaba.
 *
 * Lo encontró el CI en su primera corrida (22/09/2026), que es para lo que
 * está: la suite pasaba local con 2.402 tests y moría en el runner en éste.
 */
try {
  for (const line of readFileSync(".env.local", "utf-8").split("\n")) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
} catch {
  // No hay `.env.local`. Es lo normal en CI y en una máquina recién clonada.
}

const email = process.env.ASISTENTE_TEST_EMAIL;
const password = process.env.ASISTENTE_TEST_PASSWORD;

/**
 * Se saltea si no hay usuario de prueba configurado: el resto de la suite tiene
 * que poder correr en cualquier máquina y en CI sin credenciales.
 */
const cuando = email && password ? describe : describe.skip;

cuando("la consulta contra la base real", () => {
  let db: SupabaseClient;

  beforeAll(async () => {
    db = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    );
    const { error } = await db.auth.signInWithPassword({ email: email!, password: password! });
    // Falla ruidoso y no en silencio: un test que se saltea porque la
    // credencial es mala se ve igual que uno que pasó.
    if (error) throw new Error(`No se pudo entrar con el usuario de prueba: ${error.message}`);
  });

  it("devuelve filas de un select", async () => {
    const r = await correrConsulta(db, "select count(*) as n from empresas");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.filas.length).toBe(1);
  });

  /**
   * El test que justifica todo el diseño — y hay que escribirlo con cuidado,
   * porque la versión obvia no prueba nada.
   *
   * Mandar un `update` NO sirve: lo rechaza el guard de texto antes de salir.
   * Un CTE que escribe (`with x as (update …) select …`) tampoco: lo rechaza el
   * envoltorio `select * from (…) sub` de la función, porque un CTE que
   * modifica tiene que estar en el nivel superior. Las dos cosas dan verde por
   * la razón equivocada.
   *
   * Lo único que mide la barrera de verdad es preguntarle a la transacción en
   * qué modo está. Si este test se pone rojo, alguien le sacó el `stable` a la
   * función y el asistente dejó de ser de sólo lectura sin que nada más lo note.
   */
  it("la consulta corre en una transacción de sólo lectura", async () => {
    const r = await correrConsulta(db, "select current_setting('transaction_read_only') as modo");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.filas[0]).toEqual({ modo: "on" });
  });

  it("el guard de texto rechaza una escritura antes de salir", async () => {
    const r = await correrConsulta(db, "update empresas set nombre = nombre");
    expect(r.ok).toBe(false);
  });

  it("rechaza dos sentencias", async () => {
    const r = await correrConsulta(db, "select 1 as n; update empresas set nombre = nombre");
    expect(r.ok).toBe(false);
  });

  /**
   * RLS en las dos direcciones, que es lo que hace valioso este par: el usuario
   * de prueba tiene Mantenimiento en lectura y nada más. Que vea equipos
   * prueba que el filtro es por módulo; que no vea liquidaciones prueba que
   * filtra. Uno solo de los dos no probaría nada: un "niega todo" pasaría el
   * segundo.
   */
  it("ve las tablas de su módulo", async () => {
    const r = await correrConsulta(db, "select count(*) as n from avisos");
    expect(r.ok).toBe(true);
    if (r.ok) expect(Number(r.filas[0].n)).toBeGreaterThan(0);
  });

  it("una tabla de otro módulo devuelve vacío y no un error: eso es RLS", async () => {
    const r = await correrConsulta(db, "select count(*) as n from liquidaciones");
    expect(r.ok).toBe(true);
    if (r.ok) expect(Number(r.filas[0].n)).toBe(0);
  });

  it("devuelve el error de Postgres sin traducir", async () => {
    const r = await correrConsulta(db, "select columna_que_no_existe from empresas");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/does not exist/i);
  });

  /**
   * El tope corta y no avisa, así que la nota del catálogo le dice al modelo
   * que agregue en vez de traer filas. Si este número cambia, esa nota miente.
   */
  it("corta en 200 filas", async () => {
    const r = await correrConsulta(db, "select generate_series(1, 500) as n");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.filas.length).toBe(200);
  });
});
