"use client";

import { useState } from "react";
import { useCargar } from "@/lib/core/useCargar";
import { comoSeLee, diaDeLaSemana, hoyEnArgentina, semanaDe, sumarDias } from "@/lib/core/fechas";
import Select from "@/components/Select";
import Reportes from "./Reportes";

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
export default function DisponibilidadClient() {
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

      {vista === "quien" ? <QuienNoViene /> : <Reportes />}
    </div>
  );
}

function QuienNoViene() {
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
  useCargar(async (vigente) => {
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
  const personas = new Set(visibles.map((a) => a.empleadoId)).size;

  return (
    <div className="space-y-4">
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
        <div className={cargando ? "space-y-3 opacity-60" : "space-y-3"}>
          <p className="text-sm text-slate-600">
            {personas === 0
              ? "Nadie falta en este período."
              : `${personas} ${personas === 1 ? "persona falta" : "personas faltan"} algún día entre el ${comoSeLee(datos.dias[0])} y el ${comoSeLee(datos.dias[datos.dias.length - 1])}.`}
            {sector && <span className="text-slate-400"> · sólo {sector}</span>}
          </p>

          {datos.dias.map((dia) => {
            const deEseDia = visibles.filter((a) => a.dia === dia);
            const dow = diaDeLaSemana(dia);
            return (
              <article key={dia} className="rounded-xl border border-slate-200 bg-white">
                <header className="flex items-center justify-between gap-2 px-3 py-2">
                  <h2 className="text-sm font-semibold capitalize text-slate-900">
                    {DIAS_DE_LA_SEMANA[dow]} {comoSeLee(dia).slice(0, 5)}
                  </h2>
                  <span className={`text-xs ${deEseDia.length > 0 ? "font-semibold text-slate-700" : "text-slate-400"}`}>
                    {deEseDia.length === 0
                      ? "Nadie falta"
                      : `${deEseDia.length} ${deEseDia.length === 1 ? "persona" : "personas"}`}
                  </span>
                </header>
                {deEseDia.length > 0 && (
                  <ul className="grid grid-cols-1 gap-x-4 gap-y-1 border-t border-slate-100 px-3 py-2 text-sm sm:grid-cols-2 lg:grid-cols-3">
                    {deEseDia.map((a) => (
                      <li key={a.empleadoId} className="flex flex-wrap items-baseline justify-between gap-x-2">
                        <span className="text-slate-900">{a.nombre}</span>
                        <span className="text-xs text-slate-500">{a.sector ?? SIN_SECTOR}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
