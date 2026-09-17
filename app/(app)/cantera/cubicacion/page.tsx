import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { permisosCanteraDe } from "@/lib/cantera/auth";
import { traerCubicaciones, traerPesadas, traerVoladuras, traerYacimientos } from "@/lib/cantera/consultas";
import { toneladasPorYacimientoDesdePesadas } from "@/lib/cantera/pesadas";
import { metrosYPozos } from "@/lib/cantera/tramos";
import { toneladasEstimadas } from "@/lib/cantera/toneladas";
import { armarCierresCubicacion, type AcarreoPorYacimiento, type CierreCargado, type VoladuraParaCubicacion } from "@/lib/cantera/cubicacion";
import CubicacionClient from "./CubicacionClient";

/** Los cuatro yacimientos que la planilla real "CUBICACIÓN CANTERA" cierra. */
const YACIMIENTOS_CUBICADOS = ["D1", "D6", "C1", "C3"];

/**
 * El cierre mensual de cubicación: existencia inicial + voladuras − acarreo
 * = stock teórico, contra la existencia final medida en el yacimiento.
 * Reproduce "CIERRE CANTERAS" de la planilla real
 * (17yui8Gpp_BRuwRXyavepFScID_jvqguPSL6vsAjXxKc), con la única diferencia de
 * que la existencia final SÍ se carga en el SdG en vez de a mano en Sheets —
 * es el único dato de las cuatro cantidades del balance que nadie puede
 * calcular.
 *
 * Trae el historial completo de cierres (`traerCubicaciones`, sin filtro de
 * mes): `armarCierresCubicacion` necesita encadenar la existencia inicial de
 * cada mes con la final del anterior, no sólo con el mes que se está
 * mirando.
 */
export default async function CubicacionPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const permisos = await permisosCanteraDe(supabase, user.id);
  if (!permisos.tieneAcceso) redirect("/");

  const [yacimientos, voladuras, pesadas, cubicaciones] = await Promise.all([
    traerYacimientos(supabase, true),
    traerVoladuras(supabase, {}),
    traerPesadas(supabase, {}),
    traerCubicaciones(supabase),
  ]);

  const idPorCodigo = new Map(yacimientos.map((y) => [y.id, y.codigo]));
  const porId = new Map(yacimientos.map((y) => [y.id, y]));

  const voladurasParaCubicacion: VoladuraParaCubicacion[] = voladuras
    .map((v): VoladuraParaCubicacion | null => {
      const codigo = idPorCodigo.get(v.yacimiento_id);
      if (!codigo || !YACIMIENTOS_CUBICADOS.includes(codigo)) return null;
      const yac = porId.get(v.yacimiento_id) ?? null;
      const perf = metrosYPozos(v.perf_tramos, v.pozos, v.metros_por_pozo);
      const vol = metrosYPozos(v.vol_tramos, v.vol_pozos, v.vol_metros_por_pozo);
      const metros = vol.metros ?? perf.metros;
      const toneladas = toneladasEstimadas({
        metros,
        densidad: v.densidad_t_m3 ?? yac?.densidad_t_m3 ?? null,
        burden: v.vol_burden_m ?? v.burden_m ?? yac?.burden_m ?? null,
        espaciamiento: v.vol_espaciamiento_m ?? v.espaciamiento_m ?? yac?.espaciamiento_m ?? null,
      });
      return { yacimiento: codigo, perfFin: v.perf_fin, toneladas, metros };
    })
    .filter((v): v is VoladuraParaCubicacion => v !== null);

  // Por origen real de la pesada, no por nombre de material — ver el
  // comentario grande en `toneladasPorYacimientoDesdePesadas`.
  const acarreos: AcarreoPorYacimiento[] = toneladasPorYacimientoDesdePesadas(pesadas).map((a) => ({
    yacimientoCodigo: a.yacimientoCodigo,
    mes: a.mes,
    toneladas: a.toneladas,
  }));

  const cierresCargados: CierreCargado[] = cubicaciones
    .map((c): CierreCargado | null => {
      const codigo = idPorCodigo.get(c.yacimiento_id);
      if (!codigo) return null;
      return {
        yacimientoCodigo: codigo,
        mes: c.mes.slice(0, 7),
        existenciaFinal: c.existencia_final,
        observaciones: c.observaciones,
      };
    })
    .filter((c): c is CierreCargado => c !== null);

  const filas = armarCierresCubicacion(YACIMIENTOS_CUBICADOS, voladurasParaCubicacion, acarreos, cierresCargados);

  const yacimientosCubicados = YACIMIENTOS_CUBICADOS
    .map((codigo) => yacimientos.find((y) => y.codigo === codigo))
    .filter((y): y is NonNullable<typeof y> => y !== undefined);

  return (
    <CubicacionClient
      yacimientos={yacimientosCubicados.map((y) => ({ id: y.id, codigo: y.codigo, nombre: y.nombre }))}
      filas={filas}
      puedeEditar={permisos.puedeEditar}
    />
  );
}
