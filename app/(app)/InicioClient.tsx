"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { Modulo } from "@/lib/core/types";
import type { Ritmo } from "@/lib/home/ritmo";
import { armarTarjetaRrhh, type ResumenRrhh } from "@/lib/home/tarjetaRrhh";

/**
 * La forma exacta de `/api/home/resumen`. Se escribe a mano y **el compilador no
 * la contrasta con la ruta**: por eso la pantalla puede mostrar `undefined` sin
 * que nada falle —pasó con `presentesHoy`, `ordenesDeHoy` y cuatro campos más—.
 * Tocar la ruta obliga a volver acá.
 *
 * `Ritmo` y `ResumenRrhh` sí vienen importados de `lib/home`, que es de donde
 * salen: esos pedazos del contrato los revisa el compilador.
 */
interface Resumen {
  rrhh: ResumenRrhh | null;
  remises: { vehiculosActivos: number } | null;
  mantenimiento: { atrasadas: number; otPendientes: number; avisosSinOrden: number } | null;
  compras: { enCurso: number; esperandoAprobacion: number; paraComprar: number } | null;
  inventario: { faltantes: number; movimientosHoy: number } | null;
  produccion: { partesFaltantes: number } | null;
  despacho: { abiertasDeDiasAnteriores: number; sinLlegarALaPlanilla: number } | null;
  facturacion: { sinVincular: number; sinProveedor: number } | null;
  cantera: { sinConciliar: number } | null;
  calidad: { envasesBajoMinimo: number; sinLlegarALaPlanilla: number } | null;
  tallerVial: { sinEquipoReconocido: number; equiposSinService: number; equiposTotal: number } | null;
  trituracion: { sinLlegarALaPlanilla: number; partesDelMes: number } | null;
  ritmo: Partial<Record<Modulo, Ritmo>>;
}

const VACIO: Resumen = {
  rrhh: null, remises: null, mantenimiento: null, compras: null, inventario: null,
  produccion: null, despacho: null, facturacion: null, cantera: null, calidad: null,
  tallerVial: null, trituracion: null, ritmo: {},
};

/**
 * El inicio: qué está pasando hoy en cada módulo **al que se tiene acceso**.
 *
 * Qué tarjetas van lo decide `modulos`, que viene resuelto del servidor, y no
 * el resumen: los números llegan por fetch y hasta que contestaban se mostraban
 * las cuatro tarjetas a todo el mundo. Ahora aparecen las que corresponden
 * desde el primer pintado y los números se completan cuando llegan.
 */
export default function InicioClient({
  nombreUsuario, modulos,
}: {
  nombreUsuario: string;
  /** Los mismos que filtran el menú. Vacío es una cuenta sin habilitar. */
  modulos: Modulo[];
}) {
  const [resumen, setResumen] = useState<Resumen | null>(null);

  useEffect(() => {
    // Un 401 o un 403 contestan `{ error }`, que no tiene `ritmo`: leerlo
    // ahí adentro tiraba la pantalla entera. Un cuerpo que no es un resumen se
    // trata como ninguno.
    fetch("/api/home/resumen")
      .then((r) => (r.ok ? r.json() : VACIO))
      .then(setResumen)
      .catch(() => setResumen(VACIO));
  }, []);

  const tiene = (m: Modulo) => modulos.includes(m);
  const sinModulos = modulos.length === 0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Hola, {nombreUsuario || "de nuevo"}</h1>
        <p className="text-slate-600">Esto es lo que está pasando hoy en cada módulo.</p>
      </div>

      {sinModulos && (
        <div className="empty-state">Todavía no tenés acceso a ningún módulo. Pedile a un administrador que te lo habilite.</div>
      )}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {tiene("rrhh") && (
          <ModuloCard
            titulo="RRHH"
            href="/rrhh"
            color="#1E7D34"
            icon={<IconUsers />}
            ritmo={resumen?.ritmo.rrhh}
            // El titular es adaptativo: con marcaciones de hoy son los presentes
            // ("42 de 68", un conteo que crece desde la primera marca); sin
            // ninguna, vuelve a ser "Ausentes el <día>", que mira un día ya
            // cerrado. El rótulo nombra el día, porque no siempre es ayer: se
            // retrocede hasta el último día hábil con fichadas. Sin eso, el 06/10
            // la tarjeta mostraba 1 mientras el día anterior había 66 de 68. Por
            // qué cada uno: `armarTarjetaRrhh` y `resumenRrhh`.
            hero={resumen?.rrhh ? armarTarjetaRrhh(resumen.rrhh).hero : null}
            secundarias={resumen?.rrhh ? armarTarjetaRrhh(resumen.rrhh).secundarias : null}
          />
        )}

        {/* Remises no tiene cola de trabajo: lo único accionable es que se
            cargue, y de eso avisa la línea de ritmo. La última asistencia
            cargada es del 28/07. */}
        {tiene("remises") && (
          <ModuloCard
            titulo="Remises"
            href="/remises"
            color="#2563EB"
            icon={<IconCar />}
            ritmo={resumen?.ritmo.remises}
            hero={resumen?.remises ? { label: "Vehículos activos", valor: resumen.remises.vehiculosActivos } : null}
            secundarias={resumen?.remises ? [] : null}
          />
        )}

        {tiene("mantenimiento") && (
          <ModuloCard
            titulo="Mantenimiento"
            href="/mantenimiento"
            color="#D97706"
            icon={<IconWrench />}
            ritmo={resumen?.ritmo.mantenimiento}
            // Lo que falta hacer, no lo que está bien. "Equipos operativos"
            // decía 237/239 y se movía una vez por mes; el titular anterior
            // salía de una tabla con una sola fila cargada.
            hero={resumen?.mantenimiento ? { label: "Órdenes atrasadas", valor: resumen.mantenimiento.atrasadas } : null}
            secundarias={
              resumen?.mantenimiento
                ? [
                    { label: "Órdenes pendientes", valor: resumen.mantenimiento.otPendientes },
                    { label: "Avisos sin orden", valor: resumen.mantenimiento.avisosSinOrden },
                  ]
                : null
            }
          />
        )}

        {tiene("compras") && (
          <ModuloCard
            titulo="Compras"
            href="/compras"
            color="#1E7D34"
            icon={<IconCarrito />}
            ritmo={resumen?.ritmo.compras}
            // Lo que hay que hacer, no lo que ya se hizo: el histórico de
            // pedidos cerrados es enorme y no dice nada acá.
            hero={
              resumen?.compras
                ? { label: "Requerimientos en curso", valor: resumen.compras.enCurso }
                : null
            }
            secundarias={
              resumen?.compras
                ? [
                    { label: "Esperando aprobación", valor: resumen.compras.esperandoAprobacion },
                    { label: "Para comprar", valor: resumen.compras.paraComprar },
                  ]
                : null
            }
          />
        )}

        {/* Inventario no tenía tarjeta: quien sólo tiene ese módulo entraba al
            inicio y leía "no tenés acceso a ningún módulo". Lo que pide hacer
            algo es lo que está bajo el stock de seguridad.

            El color era #7C3AED, a un paso del #7E22CE de Trituración, y en la
            grilla de tres columnas Inventario cae justo debajo de Remises, que
            es azul. Ese violeta no salía de ningún lado —`app/(app)/inventario`
            no tiene un solo hex propio—, así que se movió éste y no el de
            Trituración, que sí es el color del módulo. */}
        {tiene("inventario") && (
          <ModuloCard
            titulo="Inventario"
            href="/inventario"
            color="#334155"
            icon={<IconCajas />}
            ritmo={resumen?.ritmo.inventario}
            hero={resumen?.inventario ? { label: "Artículos bajo el mínimo", valor: resumen.inventario.faltantes } : null}
            secundarias={resumen?.inventario ? [{ label: "Movimientos hoy", valor: resumen.inventario.movimientosHoy }] : null}
          />
        )}

        {/* Lo que pide hacer algo es un parte que falta: la producción del turno
            siguiente no se puede calcular hasta que esté. */}
        {tiene("produccion") && (
          <ModuloCard
            titulo="Producción"
            href="/produccion"
            color="#0E7490"
            icon={<IconFabrica />}
            ritmo={resumen?.ritmo.produccion}
            hero={resumen?.produccion ? { label: "Partes sin cargar (7 días)", valor: resumen.produccion.partesFaltantes } : null}
            secundarias={resumen?.produccion ? [] : null}
          />
        )}

        {/* El titular era "órdenes de carga hoy" y marcaba 0 en el módulo más
            vivo del sistema, porque la carga va a ráfagas. Lo que queda son las
            dos alarmas de planilla. */}
        {tiene("despacho") && (
          <ModuloCard
            titulo="Despacho"
            href="/despacho"
            color="#B45309"
            icon={<IconCamion />}
            ritmo={resumen?.ritmo.despacho}
            hero={resumen?.despacho ? { label: "Órdenes sin cerrar", valor: resumen.despacho.abiertasDeDiasAnteriores } : null}
            secundarias={resumen?.despacho ? [{ label: "Sin llegar a la planilla", valor: resumen.despacho.sinLlegarALaPlanilla }] : null}
          />
        )}

        {/* La alarma son las que quedaron sin vincular: una factura en el buzón
            que nadie enganchó a una compra es la que después aparece en Odoo sin
            que nadie sepa de qué era. */}
        {tiene("facturacion") && (
          <ModuloCard
            titulo="Facturación"
            href="/facturacion"
            color="#0F766E"
            icon={<IconComprobante />}
            ritmo={resumen?.ritmo.facturacion}
            hero={resumen?.facturacion ? { label: "Sin vincular a una compra", valor: resumen.facturacion.sinVincular } : null}
            secundarias={resumen?.facturacion ? [{ label: "Con un CUIT que no está en el padrón", valor: resumen.facturacion.sinProveedor }] : null}
          />
        )}

        {/* El titular es la alarma, igual que Mantenimiento e Inventario: una
            factura sin conciliar o a revisar es lo único que pide hacer algo
            hoy. Las toneladas voladas y el acarreo a pagar del mes se fueron:
            obligaban a traer tres tablas enteras para calcular en memoria dos
            números que ya están en la página del módulo, a un clic. */}
        {tiene("cantera") && (
          <ModuloCard
            titulo="Cantera"
            href="/cantera"
            color="#78716C"
            icon={<IconMountain />}
            ritmo={resumen?.ritmo.cantera}
            hero={resumen?.cantera ? { label: "Facturas a conciliar o revisar", valor: resumen.cantera.sinConciliar } : null}
            secundarias={resumen?.cantera ? [] : null}
          />
        )}

        {/* El titular es lo que pide atención: una carga sin equipo reconocido
            no entra en ningún resumen hasta que alguien la corrija. La
            secundaria era el estado del service de 250 hs, en dos números que
            sólo podían decir 0 o 1 porque hay **un** service cargado en todo el
            sistema; lo que quedaba tapado es que a 15 de los 16 equipos nunca
            se les anotó ninguno, y eso sí es una cola que alguien puede bajar. */}
        {tiene("taller_vial") && (
          <ModuloCard
            titulo="Taller Vial"
            href="/taller-vial"
            color="#0891B2"
            icon={<IconGauge />}
            ritmo={resumen?.ritmo.taller_vial}
            hero={resumen?.tallerVial ? { label: "Cargas sin equipo reconocido", valor: resumen.tallerVial.sinEquipoReconocido } : null}
            secundarias={
              resumen?.tallerVial
                ? [
                    { label: "Equipos sin service registrado", valor: `${resumen.tallerVial.equiposSinService} de ${resumen.tallerVial.equiposTotal}` },
                  ]
                : null
            }
          />
        )}

        {/* Calidad y Trituración no tenían tarjeta: quien sólo tenía esos
            módulos entraba y veía una grilla vacía, sin siquiera el cartel de
            "no tenés acceso" —`modulos.length` no es 0—. */}
        {tiene("calidad") && (
          <ModuloCard
            titulo="Calidad"
            href="/calidad"
            color="#BE185D"
            icon={<IconMatraz />}
            ritmo={resumen?.ritmo.calidad}
            hero={resumen?.calidad ? { label: "Envases bajo el mínimo", valor: resumen.calidad.envasesBajoMinimo } : null}
            secundarias={resumen?.calidad ? [{ label: "Sin llegar a la planilla", valor: resumen.calidad.sinLlegarALaPlanilla }] : null}
          />
        )}

        {tiene("trituracion") && (
          <ModuloCard
            titulo="Trituración"
            href="/trituracion"
            color="#7E22CE"
            icon={<IconTrituradora />}
            ritmo={resumen?.ritmo.trituracion}
            hero={resumen?.trituracion ? { label: "Partes sin exportar", valor: resumen.trituracion.sinLlegarALaPlanilla } : null}
            secundarias={resumen?.trituracion ? [{ label: "Partes este mes", valor: resumen.trituracion.partesDelMes }] : null}
          />
        )}
      </div>
    </div>
  );
}

function IconComprobante() {
  return (
    <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24">
      <path d="M6 3h12v18l-3-2-3 2-3-2-3 2V3Z" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M9 8h6M9 12h6" strokeLinecap="round" />
    </svg>
  );
}

function IconCamion() {
  return (
    <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24">
      <path d="M3 6h10v9H3z" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M13 9h4l3 3v3h-7z" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="7" cy="17.5" r="1.8" />
      <circle cx="17" cy="17.5" r="1.8" />
    </svg>
  );
}

function IconCajas() {
  return (
    <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24">
      <path d="M3 8.5 12 4l9 4.5-9 4.5-9-4.5Z" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M3 8.5V16l9 4.5V13" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M21 8.5V16l-9 4.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function IconCarrito() {
  return (
    <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24">
      <path d="M3 3h2l2.4 11.4a1 1 0 0 0 1 .8h8.2a1 1 0 0 0 1-.8L20 7H6" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="9.5" cy="19" r="1.3" />
      <circle cx="17" cy="19" r="1.3" />
    </svg>
  );
}

function ModuloCard({
  titulo,
  href,
  color,
  icon,
  hero,
  secundarias,
  ritmo,
}: {
  titulo: string;
  href: string;
  color: string;
  icon: React.ReactNode;
  hero: { label: string; valor: string | number } | null;
  /**
   * `null` es "todavía no llegó" y pinta el esqueleto; `[]` es "esta tarjeta no
   * tiene secundarias" y no pinta nada. La diferencia importa: con un solo
   * valor para las dos, las tarjetas sin secundarias —Remises, Producción,
   * Cantera— quedarían con el esqueleto latiendo para siempre.
   */
  secundarias: { label: string; valor: string | number }[] | null;
  ritmo?: Ritmo;
}) {
  return (
    <Link
      href={href}
      className="card group flex flex-col overflow-hidden transition hover:-translate-y-0.5 hover:shadow-lg"
      style={{ borderTop: `3px solid ${color}` }}
    >
      <div className="flex items-center gap-3 p-5 pb-4">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-white" style={{ background: color }}>
          {icon}
        </span>
        <h2 className="flex-1 font-semibold text-slate-900">{titulo}</h2>
        <span className="text-slate-300 transition group-hover:translate-x-0.5 group-hover:text-slate-400">→</span>
      </div>

      <div className="px-5 pb-3">
        {hero === null ? (
          <div className="h-10 w-24 animate-pulse rounded bg-slate-100" />
        ) : (
          <>
            <div className="text-4xl font-bold" style={{ color }}>
              {hero.valor}
            </div>
            <div className="mt-0.5 text-sm text-slate-500">{hero.label}</div>
          </>
        )}
      </div>

      <LineaDeRitmo ritmo={ritmo} />

      {secundarias === null ? (
        <div className="mt-auto flex divide-x border-t" style={{ borderColor: "var(--border)" }}>
          {[0, 1].map((i) => (
            <div key={i} className="flex-1 px-5 py-3">
              <div className="h-3 w-16 animate-pulse rounded bg-slate-100" />
            </div>
          ))}
        </div>
      ) : secundarias.length > 0 ? (
        <div className="mt-auto flex divide-x border-t" style={{ borderColor: "var(--border)" }}>
          {secundarias.map((s) => (
            <div key={s.label} className="flex-1 px-5 py-3">
              <div className="text-base font-semibold text-slate-900">{s.valor}</div>
              <div className="text-xs text-slate-500">{s.label}</div>
            </div>
          ))}
        </div>
      ) : null}
    </Link>
  );
}

/**
 * La línea que dice cuánto hace que no se carga el módulo.
 *
 * Aparece apenas se pasa el umbral del propio módulo; en la campana recién al
 * doble. Medido el 06/10/2026, ocho de trece fuentes estaban paradas y el Inicio
 * no lo decía en ningún lado — mostraba "Órdenes de carga hoy: 0" para Despacho,
 * que es el mismo 0 que si estuviera todo bien.
 */
function LineaDeRitmo({ ritmo }: { ritmo: Ritmo | undefined }) {
  if (!ritmo || !ritmo.atrasado) return null;
  const texto =
    ritmo.diasSinCargar === null
      ? "Nunca se cargó nada"
      : `Hace ${ritmo.diasSinCargar} ${ritmo.diasSinCargar === 1 ? "día" : "días"} que no se carga`;
  return (
    <div className="flex items-center gap-1.5 px-5 pb-3 text-xs font-medium text-amber-700">
      <svg width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" className="shrink-0">
        <path d="M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      {texto}
    </div>
  );
}

function IconUsers() {
  return (
    <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
      <path d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function IconCar() {
  return (
    <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
      <path d="M5 17h14M5 17a2 2 0 01-2-2v-2l2-5a2 2 0 012-2h6a2 2 0 012 2l2 5v2a2 2 0 01-2 2M5 17a2 2 0 002 2h0a2 2 0 002-2m8 0a2 2 0 002 2h0a2 2 0 002-2M7 13h10" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function IconWrench() {
  return (
    <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
      <path d="M14.7 6.3a4 4 0 10-5.4 5.4L3 18v3h3l6.3-6.3a4 4 0 005.4-5.4l-2.83 2.83a2 2 0 01-2.83-2.83L14.7 6.3z" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function IconMountain() {
  return (
    <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24">
      <path d="M3 20 9.5 8l4 6.5L16 11l5 9H3Z" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function IconGauge() {
  return (
    <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24">
      <path d="M12 21a9 9 0 1 0-9-9c0 2.1.72 4.03 1.93 5.56" strokeLinecap="round" />
      <path d="M12 12 16 8" strokeLinecap="round" />
      <circle cx="12" cy="12" r="1" fill="currentColor" stroke="none" />
    </svg>
  );
}
function IconFabrica() {
  return (
    <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24">
      <path d="M3 21V11l5 3.5V11l5 3.5V11l5 3.5V21H3Z" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M17 11V6l2 2V6l2 2v3" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M3 21h18" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function IconMatraz() {
  return (
    <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24">
      <path d="M9 3v6.5L3.8 18A2 2 0 0 0 5.5 21h13a2 2 0 0 0 1.7-3L15 9.5V3" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M8 3h8M6.8 15h10.4" strokeLinecap="round" />
    </svg>
  );
}

function IconTrituradora() {
  return (
    <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24">
      <path d="M4 4h16l-3 6H7L4 4Z" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M8 14h8M9.5 18h5" strokeLinecap="round" />
      <path d="M12 10v2" strokeLinecap="round" />
    </svg>
  );
}
