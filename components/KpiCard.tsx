import Link from "next/link";

/**
 * La tarjeta de KPI del sistema: mismo molde en todos los módulos.
 *
 * Nace de unificar seis copias casi idénticas de una función `Kpi` local
 * (Inventario, Despacho, Producción, Facturación, Remises, Cantera) más las
 * variantes de Mantenimiento, RRHH, Cantera y Calidad, que iban cada una por
 * su lado. El número grande usa tipografía normal (Public Sans), no
 * monoespaciada: `tabular-nums`/`font-mono` quedan para columnas de tabla y
 * montos en línea (como ya hace Compras), no para el número protagonista de
 * una tarjeta — es la inconsistencia que el usuario notó primero en Cantera.
 */
export default function KpiCard({
  color = "var(--text-primary)", label, value, href, onClick, sub,
}: {
  /** Color del punto y la franja superior. Sin especificar, queda neutro. */
  color?: string;
  label: string;
  value: string | number;
  href?: string;
  onClick?: () => void;
  sub?: React.ReactNode;
}) {
  const contenido = (
    <>
      <div className="absolute inset-x-0 top-0 h-1" style={{ background: color }} />
      <div className="mb-1.5 flex items-center gap-2">
        <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: color }} />
        <span className="truncate text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">{label}</span>
      </div>
      <div className="text-2xl font-bold" style={{ color: color === "var(--text-primary)" ? undefined : color }}>
        {typeof value === "number" ? value.toLocaleString("es-AR") : value}
      </div>
      {sub && <div className="mt-0.5 text-xs text-[var(--text-muted)]">{sub}</div>}
    </>
  );
  const clases = "card relative block overflow-hidden p-4 transition hover:-translate-y-0.5 hover:shadow-lg";

  if (href) return <Link href={href} className={clases}>{contenido}</Link>;
  if (onClick) return <button onClick={onClick} className={`${clases} w-full text-left`}>{contenido}</button>;
  return <div className={clases}>{contenido}</div>;
}
