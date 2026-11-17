/**
 * La sincronización completa de los molinos: listar Drive, importar cada
 * molino y dejar anotado cómo salió. La comparten el cron y el botón a mano,
 * para que los dos digan lo mismo.
 *
 * Un molino que falla no frena al otro: Filler 2 con el zip roto no tiene por
 * qué dejar a Filler 1 sin su día.
 */

import type { createAdminClient } from "@/lib/supabase/admin";
import { registrarSincronizacion } from "@/lib/core/sincronizaciones";
import { listarArchivos, bajarYDescomprimir, estaObsoleto } from "./drive";
import { importarMolino, type MolinoACargar, type ResultadoDeMolino } from "./importar";

type Admin = ReturnType<typeof createAdminClient>;

export interface ResultadoSincronizacion {
  ok: boolean;
  /** Los molinos que se importaron. */
  molinos: { clave: string; archivo: string; modificado: string; obsoleto: boolean; resultado: ResultadoDeMolino }[];
  /** Todo lo que merece que alguien lo mire, ya redactado. */
  avisos: string[];
  /** Lo que impidió importar algo: un zip que falta, que se encogió o que no se pudo leer. */
  errores: string[];
}

export async function sincronizarMolinos(admin: Admin, ahora = new Date()): Promise<ResultadoSincronizacion> {
  const resultado: ResultadoSincronizacion = { ok: true, molinos: [], avisos: [], errores: [] };

  try {
    const { data: catalogo, error } = await admin
      .from("produccion_molinos")
      .select("id, clave, nombre, formato, prefijo_archivo")
      .eq("activo", true)
      .order("clave");
    if (error) throw new Error(`No se pudo leer el catálogo de molinos: ${error.message}`);
    const molinos = (catalogo ?? []) as (MolinoACargar & { prefijo_archivo: string })[];

    const { archivos, sinMolino } = await listarArchivos(molinos);
    for (const nombre of sinMolino) {
      resultado.avisos.push(`"${nombre}" está en la carpeta y no es de ningún molino: no se importó.`);
    }

    for (const molino of molinos) {
      const archivo = archivos.find((a) => a.molinoClave === molino.clave);
      if (!archivo) {
        resultado.errores.push(`${molino.nombre}: no hay ningún zip "${molino.prefijo_archivo} ..." en la carpeta.`);
        continue;
      }
      try {
        const csvs = await bajarYDescomprimir(archivo.id);
        const r = await importarMolino(admin, molino, csvs);
        // Un archivo de ayer significa que la tarea del robot dejó de subir:
        // lo que se importó es correcto y es viejo, y las dos cosas se dicen.
        const obsoleto = estaObsoleto(archivo.modificado, ahora);
        if (obsoleto) {
          resultado.errores.push(
            `${molino.nombre}: el zip "${archivo.nombre}" se subió el ${archivo.modificado}, hace más de un día. ` +
              `La tarea del robot no subió el de hoy.`,
          );
        }
        for (const a of r.avisos) resultado.avisos.push(`${molino.nombre}: ${a}`);
        resultado.molinos.push({
          clave: molino.clave, archivo: archivo.nombre, modificado: archivo.modificado, obsoleto, resultado: r,
        });
      } catch (e) {
        resultado.errores.push(`${molino.nombre}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  } catch (e) {
    resultado.errores.push(e instanceof Error ? e.message : String(e));
  }

  resultado.ok = resultado.errores.length === 0;

  // Se anota también cuando falla. Los avisos del parseo van en el mismo campo
  // `error` con `ok: true` —la importación sí se hizo—: es el único lugar que
  // alguien ya mira para saber si una sincronización está al día.
  const texto = [...resultado.errores, ...resultado.avisos].join(" · ");
  await registrarSincronizacion({
    modulo: "produccion",
    recurso: "molinos",
    ok: resultado.ok,
    error: texto || null,
    filas: resultado.molinos.reduce((s, m) => s + m.resultado.turnos, 0),
  });

  return resultado;
}
