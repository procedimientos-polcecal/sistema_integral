/**
 * Si una consulta del asistente tiene forma de lectura.
 *
 * **Esto no es la defensa.** La defensa es que la consulta se manda por GET y
 * PostgREST corre los GET en una transacción de sólo lectura: un UPDATE lo
 * rechaza Postgres, no esto. Un guard por expresión regular sobre SQL siempre
 * se puede esquivar, y creer lo contrario es peor que no tenerlo.
 *
 * Está por dos razones prácticas: evita un viaje de red cuando el modelo se
 * equivoca feo, y le devuelve un motivo en castellano que puede usar para
 * corregir en el intento siguiente.
 *
 * Es espejo del chequeo de `asistente_consulta()` en la base. Si cambia uno,
 * cambia el otro.
 */
export type Veredicto = { ok: true } | { ok: false; motivo: string };

/**
 * Saca el prólogo: espacios de cualquier tipo y comentarios **del principio**.
 *
 * Sólo del principio, y es la decisión que importa acá. La versión anterior
 * pelaba todos los comentarios del texto, y eso abría un falso permiso: en
 * `select '--' ; delete from empresas`, el `--` que está adentro del literal
 * se comía el resto de la línea —el `;` y el `delete` incluidos— y lo que
 * quedaba, `select '`, pasaba el chequeo. Distinguir un comentario de verdad
 * de uno que vive adentro de una comilla pide un parser de SQL; no mirar más
 * allá del prólogo no pide nada y cierra el agujero.
 *
 * Espejo exacto del mismo pelado en `asistente_consulta()`. Si cambia uno,
 * cambia el otro: dos guardas que deciden distinto sobre la misma consulta son
 * peores que uno solo, porque el rechazo llega de un lugar que el otro no supo
 * anticipar. Se midieron contra la base y divergían en los cuatro casos
 * probados.
 */
function sinPrologo(sql: string): string {
  let resto = sql;
  for (;;) {
    resto = resto.replace(/^\s+/, "");
    if (resto.startsWith("--")) {
      resto = resto.replace(/^--[^\n]*(\n|$)/, "");
    } else if (resto.startsWith("/*")) {
      const fin = resto.indexOf("*/");
      resto = fin === -1 ? "" : resto.slice(fin + 2);
    } else {
      return resto.trim();
    }
  }
}

export function validarConsulta(sql: string): Veredicto {
  const desnudo = sinPrologo(sql);

  if (!desnudo) {
    return { ok: false, motivo: "La consulta está vacía." };
  }

  if (!/^(select|with)\s/i.test(desnudo)) {
    return {
      ok: false,
      motivo: "El asistente sólo puede leer: la consulta tiene que empezar con SELECT o WITH.",
    };
  }

  // Un punto y coma al final es normal; uno en el medio son dos sentencias.
  if (desnudo.replace(/[\s;]+$/, "").includes(";")) {
    return { ok: false, motivo: "Una consulta por vez: sacá el punto y coma del medio." };
  }

  return { ok: true };
}
