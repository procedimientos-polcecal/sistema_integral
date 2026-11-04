"use client";

import { useState } from "react";
import { useCargar } from "@/lib/core/useCargar";
import { comoSeLee, diaDeLaSemana, hoyEnArgentina, semanaDe, sumarDias } from "@/lib/core/fechas";
import Select from "@/components/Select";
import Reportes from "./Reportes";
import CargarAusencia, { type EmpleadoParaCargar } from "./CargarAusencia";
import {
  entraLaGrilla,
  filasDeLaGrilla,
  resumenDeDisponibilidad,
  totalesPorDia,
} from "@/lib/rrhh/ausentismo/resumenDeDisponibilidad";

/** Lo que devuelve `GET /api/disponibilidad`. El motivo no viene y no se pide. */
interface Ausente {
  empleadoId: string;
  nombre: string;
  sector: string | null;
  dia: string;
}
interface Respuesta {
  dias: string[];
  ausentes: Ausente[];
}

const DIAS_DE_LA_SEMANA = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
const SIN_SECTOR = "Sin sector";

type Vista = "quien" | "ausentismo";

/**
 * Disponibilidad: quién no viene y qué día, para cualquiera que entre al
 * sistema, y —en la otra pestaña— el ausentismo del mes.
 *
 * **ACÁ NO HAY MOTIVO, Y NO SE PIDE POR OTRO LADO.** El punto de esta sección es
 * que todos vean *quién no viene* sin enterarse de *por qué*: de las 218
 * novedades que RRHH llevaba, 74 son enfermedad y 3 son ART. La respuesta de la
 * ruta no lo trae a propósito, y si algún día esta pantalla parece necesitarlo
 * para ser útil, la respuesta es no agregarlo y decirlo — no pedírselo a otra
 * ruta.
 *
 * Sin parámetros la ruta da la semana de hoy, pero acá se piden siempre los dos
 * extremos: la pantalla tiene que saber qué rango está mostrando para poder
 * moverlo. Un solo extremo es un 400, y el tope es de 93 días.
 */
export default function DisponibilidadClient({
  puedeCargar,
  empleados,
  personalPorSector,
}: {
  /** Si tiene edición en RRHH. Decide si se dibuja el alta, no si puede hacerla. */
  puedeCargar: boolean;
  empleados: EmpleadoParaCargar[];
  /** Cuánta gente activa tiene cada sector, para el «3 de sus 11» del resumen. */
  personalPorSector: Record<string, number>;
}) {
  const [vista, setVista] = useState<Vista>("quien");

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold text-slate-900">Disponibilidad</h1>
        <p className="text-sm text-slate-500">
          {vista === "quien"
            ? "Quién no viene y qué día."
            : "Cuánto se faltó en el mes, por sector."}
        </p>
      </div>

      <div className="flex w-fit overflow-hidden rounded-lg border border-slate-300">
        {([["quien", "Quién no viene"], ["ausentismo", "Ausentismo del mes"]] as const).map(([v, texto]) => (
          <button
            key={v}
            onClick={() => setVista(v)}
            aria-pressed={vista === v}
            className={`px-3 py-1.5 text-sm font-medium ${
              vista === v ? "bg-slate-900 text-white" : "bg-white text-slate-600 hover:bg-slate-50"
            }`}
          >
            {texto}
          </button>
        ))}
      </div>

      {vista === "quien" ? (
        <QuienNoViene
          puedeCargar={puedeCargar}
          empleados={empleados}
          personalPorSector={personalPorSector}
        />
      ) : (
        <Reportes personalPorSector={personalPorSector} />
      )}
    </div>
  );
}

function QuienNoViene({
  puedeCargar,
  empleados,
  personalPorSector,
}: {
  puedeCargar: boolean;
  empleados: EmpleadoParaCargar[];
  personalPorSector: Record<string, number>;
}) {
  // La semana de hoy, de lunes a domingo: es lo que mira quien dirige un área.
  const [desde, setDesde] = useState(() => semanaDe(hoyEnArgentina())[0]);
  const [hasta, setHasta] = useState(() => semanaDe(hoyEnArgentina())[6]);
  const [sector, setSector] = useState("");

  const [datos, setDatos] = useState<Respuesta | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState("");

  // `useCargar` y no un efecto que llama y listo: cambiar una fecha con el
  // teclado dispara un pedido por cada una, y sin descartar el que llega tarde
  // la pantalla queda mostrando el rango anterior sin ningún indicio. Hay que
  // consultar `vigente()` después de cada `await`. Ver `lib/core/useCargar.ts`.
  // Se queda con `recargar` para poder volver a pedir la semana después de un
  // alta: sin eso, cargar una ausencia del rango que está en pantalla no se
  // vería hasta recargar la página, y parecería que no se guardó.
  const recargar = useCargar(async (vigente) => {
    if (!desde || !hasta) {
      // Un campo de fecha vaciado a medio escribir: no se pide nada, y la
      // pantalla no se queda cargando.
      setCargando(false);
      setError("Elegí las dos fechas.");
      return;
    }
    setCargando(true);
    setError("");
    try {
      const r = await fetch(`/api/disponibilidad?desde=${desde}&hasta=${hasta}`);
      const cuerpo = await r.json().catch(() => null);
      if (!vigente()) return;
      if (!r.ok) {
        setError(cuerpo?.error ?? "No se pudo traer la disponibilidad.");
        setDatos(null);
      } else {
        setDatos(cuerpo as Respuesta);
      }
    } catch {
      if (!vigente()) return;
      setError("No se pudo traer la disponibilidad. Revisá la conexión y volvé a probar.");
      setDatos(null);
    }
    setCargando(false);
  }, [desde, hasta]);

  const mover = (dias: number) => {
    if (!desde || !hasta) return;
    setDesde(sumarDias(desde, dias));
    setHasta(sumarDias(hasta, dias));
  };
  const estaSemana = () => {
    const s = semanaDe(hoyEnArgentina());
    setDesde(s[0]);
    setHasta(s[6]);
  };

  const todos = datos?.ausentes ?? [];
  // El filtro de sector sale de los datos que llegaron, y conserva el elegido
  // aunque en este rango no tenga a nadie: si no, el desplegable se quedaría sin
  // la opción que muestra.
  const sectores = [...new Set([...todos.map((a) => a.sector ?? SIN_SECTOR), ...(sector ? [sector] : [])])]
    .sort((a, b) => a.localeCompare(b, "es"));
  const visibles = sector ? todos.filter((a) => (a.sector ?? SIN_SECTOR) === sector) : todos;

  return (
    <div className="space-y-4">
      {puedeCargar ? <CargarAusencia empleados={empleados} alGuardar={recargar} /> : null}

      <div className="flex flex-wrap items-end gap-2">
        <div className="flex overflow-hidden rounded-lg border border-slate-300">
          <button
            onClick={() => mover(-7)}
            className="bg-white px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-50"
          >
            ‹ Semana anterior
          </button>
          <button
            onClick={estaSemana}
            className="border-x border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-50"
          >
            Esta semana
          </button>
          <button
            onClick={() => mover(7)}
            className="bg-white px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-50"
          >
            Semana siguiente ›
          </button>
        </div>

        <label className="text-xs text-slate-500">
          Desde
          <input
            type="date"
            value={desde}
            onChange={(e) => setDesde(e.target.value)}
            className="mt-0.5 block rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-900"
          />
        </label>
        <label className="text-xs text-slate-500">
          Hasta
          <input
            type="date"
            value={hasta}
            onChange={(e) => setHasta(e.target.value)}
            className="mt-0.5 block rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-900"
          />
        </label>

        <label className="text-xs text-slate-500">
          Sector
          <Select
            value={sector}
            onChange={(e) => setSector(e.target.value)}
            className="mt-0.5 block rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-900"
          >
            <option value="">Todos</option>
            {sectores.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </Select>
        </label>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
      )}

      {cargando && !datos && <p className="text-sm text-slate-500">Cargando…</p>}

      {datos && (
        <div className={cargando ? "space-y-4 opacity-60" : "space-y-4"}>
          <Resumen
            ausentes={visibles}
            dias={datos.dias}
            personalPorSector={personalPorSector}
            sectorFiltrado={sector}
          />

          {entraLaGrilla(datos.dias.length) ? (
            <Grilla ausentes={visibles} dias={datos.dias} />
          ) : (
            <PorDia ausentes={visibles} dias={datos.dias} />
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Los tres números de arriba. Son los que contestan, sin leer nada más, las
 * preguntas con las que se abre esta pantalla: cuánta gente falta, qué día está
 * peor y qué sector quedó corto.
 *
 * Con un sector filtrado, la tarjeta del sector no tiene nada que decir —sería
 * siempre el mismo— y se reemplaza por los días-persona de ese filtro.
 */
function Resumen({
  ausentes,
  dias,
  personalPorSector,
  sectorFiltrado,
}: {
  ausentes: Ausente[];
  dias: string[];
  personalPorSector: Record<string, number>;
  sectorFiltrado: string;
}) {
  const { personas, diaMasFlojo, sectorMasGolpeado } = resumenDeDisponibilidad(
    ausentes,
    dias,
    personalPorSector
  );
  const diasPersona = totalesPorDia(ausentes, dias).reduce((s, n) => s + n, 0);

  if (personas === 0) {
    return (
      <p className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600">
        Nadie falta entre el {comoSeLee(dias[0])} y el {comoSeLee(dias[dias.length - 1])}.
        {sectorFiltrado && <span className="text-slate-400"> · sólo {sectorFiltrado}</span>}
      </p>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
        <div className="text-3xl font-bold leading-none text-slate-900">{personas}</div>
        <p className="mt-1 text-xs text-slate-500">
          {personas === 1 ? "persona falta" : "personas faltan"} algún día
          <br />
          {sectorFiltrado ? `en ${sectorFiltrado}` : "del período"}
        </p>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
        <div className="text-3xl font-bold capitalize leading-none text-amber-700">
          {diaMasFlojo ? DIAS_DE_LA_SEMANA[diaDeLaSemana(diaMasFlojo.dia)].slice(0, 3) : "—"}
        </div>
        <p className="mt-1 text-xs text-slate-500">
          el día más flojo
          <br />
          {diaMasFlojo
            ? `${comoSeLee(diaMasFlojo.dia).slice(0, 5)} · ${diaMasFlojo.cantidad} ${
                diaMasFlojo.cantidad === 1 ? "persona" : "personas"
              }`
            : "sin ausencias"}
        </p>
      </div>

      {sectorFiltrado ? (
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
          <div className="text-3xl font-bold leading-none text-slate-900">{diasPersona}</div>
          <p className="mt-1 text-xs text-slate-500">
            días-persona
            <br />
            en el período
          </p>
        </div>
      ) : (
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
          <div className="mt-1 text-base font-bold leading-tight text-slate-900">
            {sectorMasGolpeado?.sector ?? "—"}
          </div>
          <p className="mt-1 text-xs text-slate-500">
            el sector más golpeado
            <br />
            {sectorMasGolpeado
              ? sectorMasGolpeado.personal !== null
                ? `${sectorMasGolpeado.cantidad} de sus ${sectorMasGolpeado.personal}`
                : `${sectorMasGolpeado.cantidad} ${sectorMasGolpeado.cantidad === 1 ? "persona" : "personas"}`
              : "sin ausencias"}
          </p>
        </div>
      )}
    </div>
  );
}

/**
 * Una fila por persona y una columna por día.
 *
 * Es lo que la lista por día no podía mostrar: quién falta la semana entera y
 * quién un día suelto. El orden —el que más falta primero— y la aritmética
 * viven en `lib/rrhh/ausentismo/resumenDeDisponibilidad.ts`, con sus tests.
 *
 * La tabla va adentro de un contenedor con scroll porque en un teléfono de
 * 375 px no entra ni con una semana, y ésa es la regla del proyecto.
 */
function Grilla({ ausentes, dias }: { ausentes: Ausente[]; dias: string[] }) {
  const filas = filasDeLaGrilla(ausentes, dias);
  const porDia = totalesPorDia(ausentes, dias);
  const hoy = hoyEnArgentina();
  const maximo = Math.max(...porDia);

  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="bg-slate-50">
            <th className="sticky left-0 bg-slate-50 px-3 py-2 text-left text-xs font-semibold text-slate-500">
              Persona
            </th>
            {dias.map((dia) => {
              const dow = diaDeLaSemana(dia);
              const finDeSemana = dow === 0 || dow === 6;
              return (
                <th
                  key={dia}
                  className={`px-1 py-2 text-center text-xs font-semibold ${
                    dia === hoy
                      ? "bg-slate-200 text-slate-900"
                      : finDeSemana
                        ? "text-slate-300"
                        : "text-slate-500"
                  }`}
                >
                  {DIAS_DE_LA_SEMANA[dow].charAt(0).toUpperCase()}
                  <span className="block text-[10px] font-normal">{dia.slice(8)}</span>
                </th>
              );
            })}
            <th className="px-2 py-2 text-center text-xs font-semibold text-slate-400">días</th>
          </tr>
        </thead>
        <tbody>
          {filas.map((f) => (
            <tr key={f.empleadoId} className="border-t border-slate-100">
              <td className="sticky left-0 bg-white px-3 py-1.5">
                <span className="block whitespace-nowrap text-slate-900">{f.nombre}</span>
                <span className="block text-[10px] text-slate-400">{f.sector ?? SIN_SECTOR}</span>
              </td>
              {f.falta.map((falta, i) => (
                <td
                  key={dias[i]}
                  className={`text-center ${falta ? "bg-slate-700 text-white" : ""}`}
                  title={falta ? `${f.nombre} · ${comoSeLee(dias[i])}` : undefined}
                >
                  {falta ? "●" : ""}
                </td>
              ))}
              <td className="px-2 text-center font-medium text-slate-700">{f.total}</td>
            </tr>
          ))}
          <tr className="border-t border-slate-200 bg-slate-50">
            <td className="sticky left-0 bg-slate-50 px-3 py-1.5 text-xs text-slate-500">Por día</td>
            {porDia.map((n, i) => (
              <td
                key={dias[i]}
                className={`px-1 text-center text-xs ${
                  n === 0 ? "text-slate-300" : n === maximo ? "font-bold text-amber-700" : "text-slate-600"
                }`}
              >
                {n === 0 ? "—" : n}
              </td>
            ))}
            <td className="px-2 text-center text-xs font-semibold text-slate-500">
              {porDia.reduce((s, n) => s + n, 0)}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

/**
 * La lista por día, para los rangos largos.
 *
 * La grilla pone una columna por día y la ruta acepta hasta 93: no entra en
 * ninguna pantalla. Pasado el mes —`LIMITE_DE_LA_GRILLA`— se muestra esto, que
 * es un renglón por día con su gente.
 */
function PorDia({ ausentes, dias }: { ausentes: Ausente[]; dias: string[] }) {
  const porDia = totalesPorDia(ausentes, dias);
  const maximo = Math.max(...porDia);
  const hoy = hoyEnArgentina();

  return (
    <div className="space-y-2">
      <p className="text-xs text-slate-500">
        Son {dias.length} días: para un rango así la grilla no entra en pantalla, y se muestra día por día.
      </p>
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        {dias.map((dia, i) => {
          const deEseDia = ausentes.filter((a) => a.dia === dia);
          return (
            <div key={dia} className="border-b border-slate-100 px-3 py-2 last:border-b-0">
              <div className="flex items-baseline justify-between gap-2">
                <span
                  className={`text-sm capitalize ${
                    dia === hoy
                      ? "font-bold text-slate-900"
                      : porDia[i] === 0
                        ? "text-slate-400"
                        : "text-slate-800"
                  }`}
                >
                  {DIAS_DE_LA_SEMANA[diaDeLaSemana(dia)]} {comoSeLee(dia).slice(0, 5)}
                  {dia === hoy && <span className="ml-1 text-xs font-normal text-slate-500">· hoy</span>}
                </span>
                <span
                  className={`text-xs ${
                    porDia[i] === 0
                      ? "text-slate-300"
                      : porDia[i] === maximo
                        ? "font-bold text-amber-700"
                        : "font-medium text-slate-600"
                  }`}
                >
                  {porDia[i] === 0 ? "—" : porDia[i]}
                </span>
              </div>
              {deEseDia.length > 0 && (
                <p className="mt-0.5 text-xs text-slate-500">{deEseDia.map((a) => a.nombre).join(" · ")}</p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
