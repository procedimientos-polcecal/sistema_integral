import { NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import { streamText, tool, stepCountIs, convertToModelMessages, type UIMessage } from "ai";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { modulosVisibles, puedeUsarAsistente } from "@/lib/core/access";
import { cuerpoJson } from "@/lib/core/cuerpo";
import type { Modulo, Rol, UsuarioModulo } from "@/lib/core/types";
import { catalogoPara } from "@/lib/asistente/catalogo";
import { systemPrompt } from "@/lib/asistente/prompt";
import { correrConsulta } from "@/lib/asistente/consulta";
import { documentosPara, rutaDelDocumento } from "@/lib/asistente/documentos";
import { urlDeCarga, type TipoDeCarga } from "@/lib/asistente/urlDeCarga";

/**
 * Cuántas preguntas por día y por persona.
 *
 * El freno es de gasto, no de uso: cada pregunta son dos o tres llamadas al
 * modelo, con el catálogo entero de entrada cada vez. Se cuenta con la sesión
 * del usuario, y la policy de `asistente_consultas` ya lo limita a sus filas.
 */
const TOPE_DIARIO = 50;

export async function POST(request: Request) {
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const { data: usuario } = await supabase
    .from("usuarios")
    .select("rol, activo, puede_usar_asistente")
    .eq("id", user.id)
    .single();

  if (!usuario?.activo) return NextResponse.json({ error: "Cuenta inactiva" }, { status: 403 });

  // `usuario.rol` viene sin tipar de Supabase: el cast es el mismo que hace el
  // layout y las demás rutas del núcleo.
  const rol = usuario.rol as Rol;
  if (!puedeUsarAsistente({ rol, puede_usar_asistente: usuario.puede_usar_asistente })) {
    return NextResponse.json(
      { error: "Todavía no tenés habilitado el asistente. Pedíselo a un administrador." },
      { status: 403 }
    );
  }

  const desdeMedianoche = new Date();
  desdeMedianoche.setHours(0, 0, 0, 0);
  const { count } = await supabase
    .from("asistente_consultas")
    .select("id", { count: "exact", head: true })
    .eq("usuario_id", user.id)
    .gte("creado_en", desdeMedianoche.toISOString());

  if ((count ?? 0) >= TOPE_DIARIO) {
    return NextResponse.json(
      { error: `Llegaste a las ${TOPE_DIARIO} preguntas de hoy. Mañana se renueva.` },
      { status: 429 }
    );
  }

  const body = await cuerpoJson(request);
  const mensajes = (body.messages ?? []) as UIMessage[];
  const pantalla = typeof body.pantalla === "string" ? body.pantalla : null;

  const { data: grants } = await supabase
    .from("usuario_modulos")
    .select("id, usuario_id, modulo, nivel")
    .eq("usuario_id", user.id);

  const modulos: Modulo[] = modulosVisibles(rol, (grants ?? []) as UsuarioModulo[]);

  // Lo que se guarda en la bitácora al terminar. Se va llenando en las tools.
  let ultimoSql: string | null = null;
  let ultimasFilas: number | null = null;
  let ultimoError: string | null = null;

  const resultado = streamText({
    model: "anthropic/claude-sonnet-5",
    system: systemPrompt({
      catalogo: catalogoPara(modulos),
      pantalla,
      hoy: new Date().toISOString().slice(0, 10),
    }),
    // En esta versión de `ai` (v7), `convertToModelMessages` es async: en v6
    // devolvía el arreglo directo.
    messages: await convertToModelMessages(mensajes),
    // Tres intentos de consulta más la respuesta final. Sin techo, un modelo
    // que se traba reintenta hasta agotar el presupuesto.
    stopWhen: stepCountIs(6),
    tools: {
      consultar: tool({
        description:
          "Corre un SELECT de PostgreSQL contra el sistema y devuelve las filas. " +
          "Sólo lectura. Si falla, devuelve el error de Postgres para que lo corrijas.",
        inputSchema: z.object({
          sql: z.string().describe("La consulta. Sólo SELECT o WITH, una sola sentencia."),
        }),
        execute: async ({ sql }) => {
          ultimoSql = sql;
          const r = await correrConsulta(supabase, sql);
          if (!r.ok) {
            ultimoError = r.error;
            return { error: r.error };
          }
          ultimasFilas = r.filas.length;
          return { filas: r.filas, cuantas: r.filas.length };
        },
      }),

      leer_documento: tool({
        description:
          `Lee un documento técnico del sistema. Disponibles: ${documentosPara(modulos).join(", ")}`,
        inputSchema: z.object({ nombre: z.string() }),
        execute: async ({ nombre }) => {
          const ruta = rutaDelDocumento(nombre, modulos);
          if (!ruta) return { error: `No tenés acceso a "${nombre}" o no existe.` };
          try {
            return { contenido: await readFile(ruta, "utf-8") };
          } catch (e) {
            // Sin traducir, igual que el resto de los errores del sistema.
            return { error: e instanceof Error ? e.message : String(e) };
          }
        },
      }),

      armar_carga: tool({
        description:
          "Devuelve el enlace al formulario del sistema con los campos puestos, para que " +
          "una persona lo confirme. No guarda nada.",
        inputSchema: z.object({
          tipo: z.enum(["requerimiento", "movimiento", "aviso", "parte"]),
          campos: z.record(z.string(), z.string()),
        }),
        execute: async ({ tipo, campos }) => {
          const r = urlDeCarga(tipo as TipoDeCarga, campos);
          return r.ok ? { url: r.url } : { error: r.motivo };
        },
      }),
    },

    onFinish: async ({ usage }) => {
      // La bitácora corta el gasto y dice qué se pregunta de verdad. Si falla,
      // no se rompe la respuesta: ya se la llevó quien preguntó.
      const pregunta = mensajes[mensajes.length - 1];
      await supabase.from("asistente_consultas").insert({
        usuario_id: user.id,
        pregunta: JSON.stringify(pregunta?.parts ?? pregunta ?? "").slice(0, 2000),
        sql_corrido: ultimoSql,
        filas: ultimasFilas,
        tokens_entrada: usage?.inputTokens ?? null,
        tokens_salida: usage?.outputTokens ?? null,
        error: ultimoError,
      });
    },
  });

  return resultado.toUIMessageStreamResponse();
}
