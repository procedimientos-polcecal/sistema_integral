/**
 * Junta lo que hace falta de Odoo y de Taller Vial para calcular el costo
 * $/h de las máquinas de destape del mes — impuro (habla con Odoo y con la
 * base), a diferencia de `lib/cantera/costoMaquinaDestape.ts`, que sólo
 * combina los números ya resueltos.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { hayCredencialesOdoo } from "@/lib/odoo/client";
import { gastoAnaliticoDeEquipos, gastoDeCombustible } from "@/lib/odoo/costoDelEquipoMovil";
import { traerCargas, traerEquiposTallerVial } from "@/lib/tallerVial/consultas";
import { calcularTrabajoEntreCargas, resumenMensualPorEquipo } from "@/lib/tallerVial/combustible";
import { tipoDeCombustible, type TipoDeCombustible } from "@/lib/tallerVial/equipos";
import { costoHoraDeMaquina, PRODUCTO_ODOO_DE_COMBUSTIBLE, type CostoMaquinaDelMes } from "./costoMaquinaDestape";

function rangoDelMes(mes: string): { desde: string; hasta: string } {
  const [anio, m] = mes.split("-").map(Number);
  return { desde: `${mes}-01`, hasta: new Date(Date.UTC(anio, m, 0)).toISOString().slice(0, 10) };
}

/**
 * El costo $/h de cada equipo pedido, para ese mes. Sin credenciales de
 * Odoo, o si Odoo falla o tarda de más, devuelve un mapa vacío (el tablero
 * muestra $0 con aviso, igual que si faltara una tarifa) en vez de romper
 * la página entera de Destape — un hipo de Odoo Online no tiene por qué
 * dejar a alguien sin poder ver el mes.
 *
 * Los litros y el gasto de combustible por tipo se calculan sobre TODA la
 * flota de Taller Vial, no sólo los equipos pedidos: es el denominador del
 * precio implícito, y hace falta la flota completa para que sea
 * representativo de lo que realmente costó ese mes el diesel/la nafta.
 */
export async function costoHoraDeMaquinasDelMes(
  supabase: SupabaseClient,
  codigosDeEquipo: string[],
  mes: string
): Promise<Record<string, CostoMaquinaDelMes>> {
  const codigos = [...new Set(codigosDeEquipo)];
  if (codigos.length === 0 || !hayCredencialesOdoo()) return {};

  try {
    const { desde, hasta } = rangoDelMes(mes);

    const [equiposTallerVial, todasLasCargas] = await Promise.all([
      traerEquiposTallerVial(supabase),
      traerCargas(supabase),
    ]);
    const codigoPorEquipoId = new Map(equiposTallerVial.map((e) => [e.id, e.code]));
    const equipoIdPorCodigo = new Map(equiposTallerVial.map((e) => [e.code, e.id]));

    const cargasConTrabajo = calcularTrabajoEntreCargas(
      todasLasCargas.map((c) => ({ id: c.id, equipoId: c.equipo_id ?? "", fecha: c.fecha, litros: c.litros, lectura: c.lectura }))
    );
    const resumenDelMes = resumenMensualPorEquipo(cargasConTrabajo, mes);
    const resumenPorEquipoId = new Map(resumenDelMes.map((r) => [r.equipoId, r]));

    const litrosPorTipo: Record<TipoDeCombustible, number> = { DIESEL_500: 0, INFINIA: 0 };
    for (const r of resumenDelMes) {
      const codigo = codigoPorEquipoId.get(r.equipoId);
      if (!codigo) continue; // carga sin equipo resuelto: no aporta a ningún tipo, no se adivina
      litrosPorTipo[tipoDeCombustible(codigo)] += r.litrosTotal;
    }

    const [gastoDiesel, gastoInfinia, gastoAnaliticoPorEquipo] = await Promise.all([
      gastoDeCombustible(PRODUCTO_ODOO_DE_COMBUSTIBLE.DIESEL_500, desde, hasta),
      gastoDeCombustible(PRODUCTO_ODOO_DE_COMBUSTIBLE.INFINIA, desde, hasta),
      gastoAnaliticoDeEquipos(codigos, desde, hasta),
    ]);
    const gastoCombustiblePorTipo: Record<TipoDeCombustible, number> = { DIESEL_500: gastoDiesel, INFINIA: gastoInfinia };

    const resultado: Record<string, CostoMaquinaDelMes> = {};
    for (const codigo of codigos) {
      const equipoId = equipoIdPorCodigo.get(codigo);
      const resumenEquipo = equipoId ? resumenPorEquipoId.get(equipoId) : undefined;
      const tipo = tipoDeCombustible(codigo);

      resultado[codigo] = costoHoraDeMaquina({
        gastoAnaliticoOdoo: gastoAnaliticoPorEquipo[codigo]?.gasto ?? 0,
        litrosDelMes: resumenEquipo?.litrosTotal ?? 0,
        gastoCombustibleDelTipo: gastoCombustiblePorTipo[tipo],
        litrosDelTipo: litrosPorTipo[tipo],
        horasDelMes: resumenEquipo?.trabajadoTotal ?? null,
      });
    }
    return resultado;
  } catch (error) {
    console.error("costoHoraDeMaquinasDelMes: no se pudo calcular, sigue con $0 en vez de romper la página", error);
    return {};
  }
}
