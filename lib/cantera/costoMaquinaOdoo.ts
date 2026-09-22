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

interface FilaCostoMaquinaCacheada {
  equipo_codigo: string;
  costo_hora: number | null;
  gasto_odoo: number;
  precio_implicito_litro: number | null;
  estimado_combustible: number;
  horas_del_mes: number | null;
}

/** Lo que ya esté cacheado de `cantera_costo_maquina_mensual` para ese mes, de los equipos pedidos — un fallo de lectura no rompe la página, sólo hace que se recalcule contra Odoo como si no hubiera caché. */
async function traerCostoMaquinaCacheado(
  supabase: SupabaseClient,
  mes: string,
  codigos: string[]
): Promise<Record<string, CostoMaquinaDelMes>> {
  const { data, error } = await supabase
    .from("cantera_costo_maquina_mensual")
    .select("equipo_codigo, costo_hora, gasto_odoo, precio_implicito_litro, estimado_combustible, horas_del_mes")
    .eq("mes", `${mes}-01`)
    .in("equipo_codigo", codigos);
  if (error) {
    console.error("traerCostoMaquinaCacheado: no se pudo leer el caché, se recalcula contra Odoo", error);
    return {};
  }

  const resultado: Record<string, CostoMaquinaDelMes> = {};
  for (const fila of (data ?? []) as FilaCostoMaquinaCacheada[]) {
    resultado[fila.equipo_codigo] = {
      costoHora: fila.costo_hora,
      gastoOdoo: fila.gasto_odoo,
      precioImplicitoLitro: fila.precio_implicito_litro,
      estimadoCombustible: fila.estimado_combustible,
      horasDelMes: fila.horas_del_mes,
    };
  }
  return resultado;
}

/** Guarda lo recién calculado para que la próxima visita a ese mes no vuelva a pedírselo a Odoo — sólo se llama con meses ya cerrados. Si falla, no rompe la página: la próxima visita simplemente vuelve a calcular. */
async function guardarCostoMaquinaCacheado(
  supabase: SupabaseClient,
  mes: string,
  resultados: Record<string, CostoMaquinaDelMes>
): Promise<void> {
  const filas = Object.entries(resultados).map(([equipo_codigo, c]) => ({
    mes: `${mes}-01`,
    equipo_codigo,
    costo_hora: c.costoHora,
    gasto_odoo: c.gastoOdoo,
    precio_implicito_litro: c.precioImplicitoLitro,
    estimado_combustible: c.estimadoCombustible,
    horas_del_mes: c.horasDelMes,
  }));
  if (filas.length === 0) return;

  const { error } = await supabase
    .from("cantera_costo_maquina_mensual")
    .upsert(filas, { onConflict: "mes,equipo_codigo", ignoreDuplicates: true });
  if (error) {
    console.error("guardarCostoMaquinaCacheado: no se pudo guardar el caché, se va a recalcular la próxima vez", error);
  }
}

function rangoDelMes(mes: string): { desde: string; hasta: string } {
  const [anio, m] = mes.split("-").map(Number);
  return { desde: `${mes}-01`, hasta: new Date(Date.UTC(anio, m, 0)).toISOString().slice(0, 10) };
}

export interface OpcionesCostoMaquina {
  /**
   * Un mes cerrado (anterior al actual — `esMesCerrado()` en
   * `./costoMaquinaDestape.ts`) se resuelve contra `cantera_costo_maquina_mensual`
   * en vez de contra Odoo, y lo que falte del caché se calcula una sola vez
   * y se guarda ahí para la próxima visita. El mes en curso (`false`,
   * default) nunca se cachea: puede seguir sumando facturas.
   */
  mesCerrado?: boolean;
}

/**
 * El costo $/h de cada equipo pedido, para ese mes. Sin credenciales de
 * Odoo, o si Odoo falla o tarda de más, devuelve un mapa vacío (el tablero
 * muestra $0 con aviso, igual que si faltara una tarifa) en vez de romper
 * la página entera de Destape — un hipo de Odoo Online no tiene por qué
 * dejar a alguien sin poder ver el mes. Ese vacío nunca se cachea: un hipo
 * puntual no tiene que quedar grabado como "sin costo" para siempre.
 */
export async function costoHoraDeMaquinasDelMes(
  supabase: SupabaseClient,
  codigosDeEquipo: string[],
  mes: string,
  opciones: OpcionesCostoMaquina = {}
): Promise<Record<string, CostoMaquinaDelMes>> {
  const codigos = [...new Set(codigosDeEquipo)];
  if (codigos.length === 0 || !hayCredencialesOdoo()) return {};

  if (opciones.mesCerrado) {
    const cacheado = await traerCostoMaquinaCacheado(supabase, mes, codigos);
    const faltantes = codigos.filter((c) => !(c in cacheado));
    if (faltantes.length === 0) return cacheado;

    const nuevos = await calcularCostoHoraDesdeOdoo(supabase, faltantes, mes);
    await guardarCostoMaquinaCacheado(supabase, mes, nuevos);
    return { ...cacheado, ...nuevos };
  }

  return calcularCostoHoraDesdeOdoo(supabase, codigos, mes);
}

async function calcularCostoHoraDesdeOdoo(
  supabase: SupabaseClient,
  codigos: string[],
  mes: string
): Promise<Record<string, CostoMaquinaDelMes>> {
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
