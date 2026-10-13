import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { usuarioActual } from "@/lib/core/sesion";
import { nivelCalidadDe } from "@/lib/calidad/auth";
import { diaEnArgentina, hoyEnArgentina } from "@/lib/core/fechas";
import KpiCard from "@/components/KpiCard";

/**
 * El tablero de Calidad: la puerta del módulo.
 *
 * Calidad son **tres frentes que no se parecen** —el stock de carbonilla, el de
 * envases y los ensayos del laboratorio—, y hasta acá la raíz del módulo era
 * directamente uno de ellos. Quien entraba por el menú caía en el stock de
 * carbonilla y los otros dos sólo existían si se desplegaba el submenú.
 *
 * Por eso el stock de carbonilla se mudó a `/calidad/carbonilla` y esta
 * pantalla ocupa la raíz, con las pestañas como tarjetas — el mismo molde que
 * el tablero de Compras.
 *
 * **Todos los números salen de consultas de conteo**, con `head: true`: cuentan
 * en la base y no traen una sola fila. Entrar al módulo no puede costar leer el
 * libro de carbonilla entero, que arranca con veinte meses importados y es
 * justamente lo que hace la pantalla del stock.
 */

/**
 * Cuenta filas sin traerlas: recibe la consulta ya armada, con su `select`
 * literal.
 *
 * Un error devuelve `null` y no cero. Un cero en una tarjeta se lee como "no
 * hay ninguno", y "no se pudo contar" es otra cosa — la misma distinción que el
 * guión del reporte.
 */
async function contar(
  consulta: PromiseLike<{ count: number | null; error: unknown }>
): Promise<number | null> {
  const { count, error } = await consulta;
  return error ? null : (count ?? 0);
}

/** Lo que va en cada consulta de conteo. */
const SOLO_CONTAR = { count: "exact", head: true } as const;

function comoSeLee(iso: string): string {
  const [a, m, d] = iso.split("-");
  return `${d}/${m}/${a.slice(2)}`;
}

/** Cuántos días pasaron desde esa fecha hasta hoy. */
function diasDesde(iso: string, hoy: string): number {
  const ms = Date.parse(`${hoy}T00:00:00Z`) - Date.parse(`${iso}T00:00:00Z`);
  return Math.max(0, Math.round(ms / 86_400_000));
}

/**
 * Un ícono por frente, al molde de los del inicio y el menú lateral: SVG en
 * línea de 20×20, `currentColor` y trazo 1,8. Van repetidos en cada tarjeta del
 * frente y no una sola vez en el título de la sección, porque lo que se mira de
 * un tablero es la tarjeta suelta: al volver de una pantalla uno busca la que
 * tocó, no la sección que la contiene.
 */

/** Carbonilla: una llama. Es combustible, y lo que se carga a diario es cuánto se quemó. */
function IconLlama() {
  return (
    <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24">
      <path
        d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.4-.5-2-1-3-1.1-2.1-.2-4.1 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.2.4-2.3 1-3a2.5 2.5 0 0 0 2.5 2.5Z"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Envases: un saco con el cuello atado, que es lo que se cuenta — bolsas y bolsones. */
function IconBolsa() {
  return (
    <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24">
      <path d="M7 10h10a1 1 0 0 1 1 1.1l-1 7.4a2 2 0 0 1-2 1.7H9a2 2 0 0 1-2-1.7l-1-7.4A1 1 0 0 1 7 10Z" strokeLinejoin="round" />
      <path d="M9.6 10 10 6h4l.4 4" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M9.2 6h5.6" strokeLinecap="round" />
    </svg>
  );
}

/** Ensayos: un tamiz de costado, con la malla colgando del aro. La granulometría es el corazón del frente. */
function IconTamiz() {
  return (
    <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24">
      <path d="M3 9h18" strokeLinecap="round" />
      <path d="M5 9c0 4.2 3.1 7.5 7 7.5S19 13.2 19 9" strokeLinecap="round" />
      <path d="M8 9.5v2.5M12 9.5v3.6M16 9.5v2.5" strokeLinecap="round" />
    </svg>
  );
}

const CARBONILLA = "#B45309";
const ENVASES = "#0891B2";
const ENSAYOS = "#BE185D";

export default async function CalidadPage() {
  const supabase = await createClient();

  const user = await usuarioActual();
  if (!user) redirect("/login");

  const nivel = await nivelCalidadDe(supabase, user.id);
  if (!nivel) redirect("/");

  const esAdmin = nivel === "admin";
  const hoy = hoyEnArgentina();
  const hace30 = diaEnArgentina(-30);

  const [
    ultimoConsumo,
    movimientosCarbonilla,
    carbonilleros,
    productosOdoo,
    envasesActivos,
    envasesFaltantes,
    movimientosEnvases,
    proveedoresEnvases,
    muestras30,
    muestrasHoy,
    ultimoDia,
    productosEnsayo,
    limites,
  ] = await Promise.all([
    supabase
      .from("calidad_movimientos")
      .select("fecha")
      .eq("tipo", "consumo")
      .order("fecha", { ascending: false })
      .limit(1)
      .maybeSingle(),
    contar(supabase.from("calidad_movimientos").select("id", SOLO_CONTAR)),
    contar(supabase.from("calidad_carbonilleros").select("id", SOLO_CONTAR).eq("activo", true)),
    contar(supabase.from("calidad_productos_odoo").select("odoo_product_id", SOLO_CONTAR).eq("cuenta", true)),
    contar(supabase.from("calidad_envases_articulos").select("id", SOLO_CONTAR).eq("activo", true)),
    // `faltante` es una columna generada numérica —cuánto falta para el
    // mínimo—, no un booleano: bajo el mínimo es > 0.
    contar(
      supabase.from("calidad_envases_articulos").select("id", SOLO_CONTAR).eq("activo", true).gt("faltante", 0)
    ),
    contar(supabase.from("calidad_envases_movimientos").select("id", SOLO_CONTAR)),
    contar(supabase.from("calidad_envases_proveedores").select("id", SOLO_CONTAR)),
    contar(supabase.from("calidad_ensayos_muestras").select("id", SOLO_CONTAR).gte("fecha", hace30)),
    contar(supabase.from("calidad_ensayos_muestras").select("id", SOLO_CONTAR).eq("fecha", hoy)),
    supabase
      .from("calidad_ensayos_muestras")
      .select("fecha")
      .order("fecha", { ascending: false })
      .limit(1)
      .maybeSingle(),
    contar(supabase.from("calidad_ensayos_productos").select("id", SOLO_CONTAR).eq("activo", true)),
    contar(supabase.from("calidad_ensayos_limites").select("id", SOLO_CONTAR)),
  ]);

  const fechaUltimoConsumo = ultimoConsumo.data?.fecha ?? null;
  const fechaUltimoEnsayo = ultimoDia.data?.fecha ?? null;

  /** Un número que no se pudo contar se dice, no se muestra como cero. */
  const n = (v: number | null) => (v === null ? "—" : v);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-slate-900">Calidad</h1>
        <p className="text-sm text-slate-500">
          Los tres frentes del sector. Tocá una tarjeta para trabajarla.
        </p>
      </div>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--text-muted)]">
          Carbonilla
        </h2>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <KpiCard
            color={CARBONILLA}
            icon={<IconLlama />}
            label="El stock"
            // El número que dice si hay trabajo: el consumo se carga a la tarde
            // 224 de 256 días, así que dos días sin cargar es la señal.
            value={fechaUltimoConsumo ? diasDesde(fechaUltimoConsumo, hoy) : "—"}
            sub={
              fechaUltimoConsumo
                ? `días desde el último consumo (${comoSeLee(fechaUltimoConsumo)})`
                : "todavía no se cargó ningún consumo"
            }
            href="/calidad/carbonilla"
          />
          <KpiCard
            color={CARBONILLA}
            icon={<IconLlama />}
            label="Movimientos"
            value={n(movimientosCarbonilla)}
            sub="el libro entero"
            href="/calidad/movimientos"
          />
          {esAdmin && (
            <KpiCard
              color={CARBONILLA}
            icon={<IconLlama />}
              label="Carbonilleros"
              value={n(carbonilleros)}
              sub="activos"
              href="/calidad/carbonilleros"
            />
          )}
          {esAdmin && (
            <KpiCard
              color={CARBONILLA}
            icon={<IconLlama />}
              label="Productos"
              value={n(productosOdoo)}
              sub="de Odoo que cuentan"
              href="/calidad/productos"
            />
          )}
        </div>
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--text-muted)]">
          Envases
        </h2>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <KpiCard
            color={envasesFaltantes ? "#B91C1C" : ENVASES}
            icon={<IconBolsa />}
            label="Stock"
            value={n(envasesFaltantes)}
            sub={`bajo el mínimo, de ${n(envasesActivos)} artículos`}
            href="/calidad/envases"
          />
          <KpiCard
            color={ENVASES}
            icon={<IconBolsa />}
            label="Movimientos"
            value={n(movimientosEnvases)}
            sub="el kardex entero"
            href="/calidad/envases/movimientos"
          />
          <KpiCard
            color={ENVASES}
            icon={<IconBolsa />}
            label="Por período"
            value={n(envasesActivos)}
            sub="artículos a resumir"
            href="/calidad/envases/periodo"
          />
          <KpiCard
            color={ENVASES}
            icon={<IconBolsa />}
            label="Proveedores"
            value={n(proveedoresEnvases)}
            sub="de la planilla"
            href="/calidad/envases/proveedores"
          />
        </div>
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--text-muted)]">
          Ensayos
        </h2>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <KpiCard
            color={ENSAYOS}
            icon={<IconTamiz />}
            label="Las muestras"
            value={n(muestras30)}
            sub="en los últimos 30 días"
            href="/calidad/ensayos"
          />
          <KpiCard
            color={ENSAYOS}
            icon={<IconTamiz />}
            label="Cargar muestra"
            value={n(muestrasHoy)}
            sub="cargadas hoy"
            href="/calidad/ensayos/nueva"
          />
          <KpiCard
            color={ENSAYOS}
            icon={<IconTamiz />}
            label="Reporte del día"
            value={fechaUltimoEnsayo ? comoSeLee(fechaUltimoEnsayo) : "—"}
            sub={fechaUltimoEnsayo ? "último día con muestras" : "todavía no hay muestras"}
            href="/calidad/ensayos/reporte"
          />
          <KpiCard
            color={ENSAYOS}
            icon={<IconTamiz />}
            label="Indicadores"
            value={n(muestras30)}
            sub="muestras del período corto"
            href="/calidad/ensayos/indicadores"
          />
          {esAdmin && (
            <KpiCard
              color={ENSAYOS}
            icon={<IconTamiz />}
              label="Productos"
              value={n(productosEnsayo)}
              sub="que se muestrean"
              href="/calidad/ensayos/productos"
            />
          )}
          {esAdmin && (
            <KpiCard
              color={limites === 0 ? "#B45309" : ENSAYOS}
              icon={<IconTamiz />}
              label="Límites"
              value={n(limites)}
              // Cero límites no es un error pero tampoco es neutro: significa
              // que ninguna muestra se va a marcar, y eso tiene que decirse.
              sub={limites === 0 ? "ninguno: nada se marca" : "cargados"}
              href="/calidad/ensayos/limites"
            />
          )}
        </div>
      </section>
    </div>
  );
}
