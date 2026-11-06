"use client";

import { useState } from "react";
import Select from "@/components/Select";
import { esCorreo } from "@/lib/agenda/evento";
import { hoyEnArgentina } from "@/lib/core/fechas";
import {
  cruzaLaMedianoche, diaYHoraDe, horarioDelEvento, horarioParaGuardar, leerRespuestaDeEscritura,
  unaHoraDespues, type EventoVista, type HorarioOriginal,
} from "@/lib/agenda/vista";

export interface UsuarioInvitable {
  email: string;
  /** «Nombre Apellido», o vacío si el usuario no tiene. */
  nombre: string;
}

/**
 * Alta y edición de un evento: título, día, hora de inicio, hora de fin, lugar,
 * descripción e invitados.
 *
 * Los invitados salen de los usuarios del SdG **y además** se puede escribir un
 * correo cualquiera —un proveedor, un contratista—: Google le manda la
 * invitación igual.
 *
 * El evento es de **un solo día**: una fecha y dos horas. La ruta acepta
 * cualquier par de instantes, pero la pantalla no ofrece lo que nadie pidió, y
 * es lo que evita armar un evento que termina antes de empezar al tocar sólo
 * una hora. Las horas son de pared de Argentina y viajan sin zona, que la ruta
 * lee así.
 *
 * Lo que la ruta contesta se lee con `leerRespuestaDeEscritura`, que es el
 * único lugar que conoce las formas de respuesta. Un 201 con advertencia es un
 * evento guardado cuyo espejo en Google tuvo un problema: se cierra el modal y
 * se le pasa la advertencia a la pantalla, que no la puede perder.
 */
export default function EventoModal({
  evento, arranque, usuarios, onCerrar, onGuardado, onFallo,
}: {
  /** Sin evento es un alta. */
  evento: EventoVista | null;
  /**
   * Con qué día y hora arranca un **alta**, cuando la persona hizo clic en un
   * hueco de la grilla: reemplaza al hoy y las 09:00 de siempre. El «hasta» sale
   * de sumarle una hora. En una edición no se mira: manda el evento.
   */
  arranque?: { dia: string; desde: string };
  usuarios: UsuarioInvitable[];
  onCerrar: () => void;
  /** Guardó. `advertencia` es lo que Google dijo, si algo; la pantalla recarga sola. */
  onGuardado: (advertencia: string | null) => void;
  /**
   * La ruta contestó que no. Puede haber fallado a la mitad —guardó el cambio y
   * no los invitados—, así que la pantalla de atrás tiene que releer aunque
   * este modal siga abierto con el error.
   */
  onFallo: () => void;
}) {
  const inicial = evento ? { i: diaYHoraDe(evento.inicio), f: diaYHoraDe(evento.fin) } : null;
  // Lo que el formulario cargó, para mandar al guardar sólo lo que se cambió.
  const [original] = useState<HorarioOriginal | null>(
    inicial ? { dia: inicial.i.dia, desde: inicial.i.hora, hasta: inicial.f.hora, diaFin: inicial.f.dia } : null
  );
  const cruza = evento ? cruzaLaMedianoche(evento.inicio, evento.fin) : false;

  const [titulo, setTitulo] = useState(evento?.titulo ?? "");
  const [dia, setDia] = useState(inicial?.i.dia ?? arranque?.dia ?? hoyEnArgentina());
  const [desde, setDesde] = useState(inicial?.i.hora ?? arranque?.desde ?? "09:00");
  const [hasta, setHasta] = useState(inicial?.f.hora ?? (arranque ? unaHoraDespues(arranque.desde) : "10:00"));
  const [lugar, setLugar] = useState(evento?.lugar ?? "");
  const [descripcion, setDescripcion] = useState(evento?.descripcion ?? "");
  const [invitados, setInvitados] = useState<string[]>(evento?.invitados ?? []);
  const [correoSuelto, setCorreoSuelto] = useState("");
  const [errorDelCorreo, setErrorDelCorreo] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");

  const nombreDe = (c: string) => usuarios.find((u) => u.email === c)?.nombre || "";
  const elegibles = usuarios.filter((u) => !invitados.includes(u.email));

  function sumar(correo: string) {
    const c = correo.trim().toLowerCase();
    if (c === "") return false;
    if (!esCorreo(c)) {
      setErrorDelCorreo(`«${c}» no es un correo válido.`);
      return false;
    }
    setErrorDelCorreo("");
    setInvitados((actuales) => (actuales.includes(c) ? actuales : [...actuales, c]));
    return true;
  }

  async function guardar(ev: React.FormEvent) {
    ev.preventDefault();
    // Un correo escrito y sin «Sumar» se suma solo: es lo que la persona quiso, y
    // perderlo en silencio es un invitado que nunca recibe la invitación.
    if (correoSuelto.trim() !== "" && !sumar(correoSuelto)) return;

    const sumados = correoSuelto.trim() !== "" ? [...new Set([...invitados, correoSuelto.trim().toLowerCase()])] : invitados;

    setGuardando(true);
    setError("");
    try {
      const res = await fetch(evento ? `/api/agenda/eventos/${evento.id}` : "/api/agenda/eventos", {
        method: evento ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          titulo,
          descripcion,
          lugar,
          // Sólo el horario que se tocó: ver `horarioParaGuardar`.
          ...horarioParaGuardar(original, { dia, desde, hasta }),
          invitados: sumados,
        }),
      });
      const cuerpo = await res.json().catch(() => null);
      const r = leerRespuestaDeEscritura(res.status, cuerpo);
      if (!r.ok) {
        setError(r.error ?? "No se pudo guardar.");
        onFallo();
        return;
      }
      onGuardado(r.advertencia);
    } catch (e) {
      setError(`No se pudo guardar: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <form
        onSubmit={guardar}
        className="max-h-[90dvh] w-full max-w-lg space-y-4 overflow-y-auto rounded-2xl bg-white p-6 shadow-xl"
      >
        <h2 className="text-base font-bold text-slate-900">{evento ? "Editar el evento" : "Nuevo evento"}</h2>

        {evento?.divergencia && (
          <p className="rounded-lg border px-3 py-2 text-sm text-slate-800" style={{ background: "#FFFBEB", borderColor: "#FCD34D" }}>
            Este evento está divergido: lo cambiaron desde Google. Lo que guardes se guarda en el SdG pero{" "}
            <strong>no se escribe en Google</strong> hasta que lo destrabes.
          </p>
        )}

        {cruza && evento && (
          <p className="rounded-lg border px-3 py-2 text-sm text-slate-800" style={{ background: "#FFFBEB", borderColor: "#FCD34D" }}>
            Este evento cruza la medianoche ({horarioDelEvento(evento.inicio, evento.fin)}) y el formulario es de un
            solo día, así que no se puede elegir otro día de fin. Mientras no toques el día ni las horas, el horario
            se queda como está; si cambiás el día, el fin se corre los mismos días y el evento dura lo mismo; si
            cambiás la hora de fin, termina el mismo día en que terminaba.
          </p>
        )}

        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600">
            Título <span className="text-red-600">*</span>
          </label>
          <input className="input" value={titulo} maxLength={200} onChange={(e) => setTitulo(e.target.value)} autoFocus />
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600">Día</label>
            <input type="date" className="input" value={dia} onChange={(e) => setDia(e.target.value)} />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600">Desde</label>
            <input type="time" className="input" value={desde} onChange={(e) => setDesde(e.target.value)} />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600">Hasta</label>
            <input type="time" className="input" value={hasta} onChange={(e) => setHasta(e.target.value)} />
          </div>
        </div>
        <p className="-mt-2 text-xs text-slate-400">Hora de Argentina.</p>

        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600">Lugar</label>
          <input className="input" value={lugar} maxLength={300} onChange={(e) => setLugar(e.target.value)} />
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600">Descripción</label>
          <textarea className="input min-h-20" value={descripcion} maxLength={5000} onChange={(e) => setDescripcion(e.target.value)} />
        </div>

        <div className="space-y-2">
          <label className="block text-xs font-medium text-slate-600">Invitados</label>

          {invitados.length > 0 && (
            <ul className="flex flex-wrap gap-1.5">
              {invitados.map((c) => (
                <li
                  key={c}
                  className="inline-flex max-w-full items-center gap-1 rounded-full bg-slate-100 py-0.5 pl-2.5 pr-1 text-xs text-slate-700"
                >
                  <span className="truncate">{nombreDe(c) ? `${nombreDe(c)} (${c})` : c}</span>
                  <button
                    type="button"
                    aria-label={`Sacar a ${c}`}
                    className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-slate-500 hover:bg-slate-200"
                    onClick={() => setInvitados((a) => a.filter((x) => x !== c))}
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          )}

          {elegibles.length > 0 && (
            <Select
              className="input"
              value=""
              onChange={(e) => { if (e.target.value) sumar(e.target.value); }}
            >
              <option value="">Sumar un usuario del SdG…</option>
              {elegibles.map((u) => (
                <option key={u.email} value={u.email}>{u.nombre ? `${u.nombre} · ${u.email}` : u.email}</option>
              ))}
            </Select>
          )}

          <div className="flex gap-2">
            {/* `type="text"` y no `email`: con `email` el navegador frena el submit
                del formulario entero por un correo a medio escribir, con su
                globito en inglés. Acá se valida con `esCorreo` y se dice en castellano. */}
            <input
              type="text"
              inputMode="email"
              className="input flex-1"
              placeholder="O escribí un correo (puede ser de afuera)"
              value={correoSuelto}
              onChange={(e) => { setCorreoSuelto(e.target.value); setErrorDelCorreo(""); }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  // Enter acá suma el correo; si dejara pasar el submit guardaría el evento a medias.
                  e.preventDefault();
                  if (sumar(correoSuelto)) setCorreoSuelto("");
                }
              }}
            />
            <button
              type="button"
              className="btn-secondary shrink-0"
              onClick={() => { if (sumar(correoSuelto)) setCorreoSuelto(""); }}
            >
              Sumar
            </button>
          </div>
          {errorDelCorreo && <p className="text-xs text-red-600">{errorDelCorreo}</p>}
        </div>

        {error && (
          <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">{error}</p>
        )}

        <div className="flex justify-end gap-2 pt-1">
          <button type="button" className="btn-secondary" onClick={onCerrar} disabled={guardando}>Cancelar</button>
          <button type="submit" className="btn-primary" disabled={guardando || titulo.trim() === ""}>
            {guardando ? "Guardando…" : evento ? "Guardar los cambios" : "Crear el evento"}
          </button>
        </div>
      </form>
    </div>
  );
}
