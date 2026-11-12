"use client";

import { useEffect, useId, useRef, useState } from "react";
import Select from "@/components/Select";
import type { TipoDeEntidad } from "@/lib/core/mensajes";
import { haceCuanto } from "@/lib/core/haceCuanto";
import { useCargar } from "@/lib/core/useCargar";
import type { MensajeParaLaPantalla } from "@/lib/mensajes/forma";
import { MAXIMO_DE_MENCIONES, MAXIMO_DEL_TEXTO } from "@/lib/mensajes/limites";

/**
 * El hilo de mensajes pegado a un registro: lo que se habló sobre una orden de
 * trabajo, un requerimiento o una condición insegura, y a quién se le avisó por
 * correo.
 *
 * Diseño y motivos: `docs/superpowers/specs/2026-11-11-mensajeria-interna-design.md`.
 * Se pone en una pantalla con una línea, `<HiloDeMensajes tipo=… id=… />`: lo
 * demás —quién puede ver, a quién se puede mencionar, si el correo está
 * configurado— lo contestan las rutas de `app/api/mensajes`.
 *
 * ## Lo que esta pantalla no puede permitir
 *
 * **Que alguien escriba creyendo que le avisó a otro y no le haya llegado.** Es
 * el anti-objetivo número uno del diseño, y de ahí salen casi todas las
 * decisiones de abajo:
 *
 * - **Dice a quién le va a llegar antes de enviar**, no después: la línea que
 *   está arriba del botón se rearma con cada mención que se agrega o se saca.
 * - **Si el correo no está configurado en el servidor, la mención queda
 *   deshabilitada con el motivo a la vista.** `enviarCorreo()` contesta
 *   `sin-configurar` en silencio, así que sin este cartel no sale ni un correo y
 *   no se entera nadie. Se puede escribir igual: el mensaje se guarda.
 * - **Después de enviar, lo que se muestra sale de la respuesta** y no de lo que
 *   se pidió: si el servidor dejó a alguien sin aviso, se dice con su motivo.
 * - **`pendiente` se escribe «sin confirmar» y no «no se envió».** El correo sale
 *   en un `after()`, después de la respuesta, así que al enviar todavía no se
 *   sabe si llegó; y si el `after()` nunca anotó el resultado, tampoco se sabrá.
 *   Decir «no se envió» sería afirmar lo que el dato no dice.
 *
 * ## El hilo no es privado, y la pantalla lo dice
 *
 * Lo ve cualquiera que pueda ver el registro. Es una limitación a propósito y el
 * diseño pide que esté escrita donde se escribe, no sólo en el documento; por eso
 * es un renglón fijo arriba del campo y no un tooltip. Y la lista de a quién se
 * puede mencionar es **más corta que el padrón** por lo mismo —el correo lleva el
 * texto del mensaje— y se explica, para que nadie busque un nombre que no está.
 *
 * ## No es una nota de la orden de trabajo
 *
 * En la pantalla de la OT conviven con `JustificacionOT`, que dice «por qué esta
 * orden todavía no se hizo» y alimenta una columna de la planilla de Google. Un
 * mensaje no va a ninguna planilla. La pantalla que lo monta aclara cuál es cuál
 * con `aclaracion`.
 *
 * ## Una barra que se despliega
 *
 * Sin mensajes, el hilo entero ocupaba medio metro entre la información del
 * registro. Por eso arranca plegado en una sola barra que dice si vale la pena
 * abrirla: cuántos mensajes hay, si el registro que los sostiene ya no está, si
 * hay menciones propias sin leer y si hay un borrador sin enviar. Abierto
 * muestra todo lo de siempre. Plegar **no tira el borrador**: el contenido sigue
 * montado, sólo oculto, y la barra lo avisa.
 *
 * Plegado, **la barra es lo único que se ve**, así que lo que el hilo abierto
 * dice en un cartel tiene que caber ahí o no se dice: por eso el «ya no está»
 * sale también cuando hay mensajes, que es cuando pasa de verdad.
 *
 * ## Orden y lectura
 *
 * Se muestran del más viejo al más nuevo, con el campo para escribir debajo: es
 * como se lee una conversación, y lo que uno acaba de enviar queda pegado al
 * campo. La ruta los devuelve al revés y acá se dan vuelta.
 *
 * Mostrar el hilo marca como leídas las menciones propias —**mostrarlo es
 * abrirlo, no cargarlo**: el componente arranca plegado en una barra y lee el
 * hilo igual, para poder decir cuántos mensajes hay— (`PATCH
 * /api/mensajes/mios`). Va acá y no en el GET porque un GET que escribe se dispara
 * con cualquier precarga y marcaría como visto lo que nadie vio. Si el PATCH falla
 * no se le avisa a nadie: lo único que pasa es que la mención sigue en la bandeja
 * de quien la tenía, que es el lado seguro del error.
 */

interface Destinatario {
  id: string;
  nombre: string;
  tiene_correo: boolean;
}

/** Lo que dice la respuesta del POST sobre a quién se le va a avisar. */
interface ResumenDelEnvio {
  correoConfigurado: boolean;
  seIntentan: number;
  sinAviso: { nombre: string | null; motivo: string }[];
}

/** Cuánto se espera antes de volver a leer el hilo para ver cómo salieron los correos. */
const ESPERAS_PARA_RELEER = [6000, 20000];

/**
 * Lo que pueden traer las tres rutas, todo opcional: una respuesta de error trae
 * sólo `error`, y una caída del servidor puede no traer JSON.
 */
interface CuerpoDeLaRuta {
  error?: string;
  data?: unknown;
  titulo?: string;
  existe_el_registro?: boolean;
  /** Sólo en el GET del hilo: cuántas menciones de quien pregunta siguen sin leer acá. */
  mis_menciones_sin_leer?: number;
  correo_configurado?: boolean;
  /** Sólo en el 500 que deja el mensaje escrito y las menciones no. */
  mensaje_guardado?: boolean;
  avisos?: {
    se_intentan?: number;
    sin_aviso?: { nombre: string | null; motivo: string }[];
  };
}

async function leerJson(res: Response): Promise<CuerpoDeLaRuta> {
  return res.json().catch(() => ({}));
}

export default function HiloDeMensajes({
  tipo, id, aclaracion, alCambiarElBorrador, abiertoAlMontar = false,
}: {
  tipo: TipoDeEntidad;
  id: string;
  /**
   * Lo que este hilo **no** es en la pantalla donde se monta: la OT tiene una
   * justificación que va a la planilla y un mensaje no. Lo escribe quien monta el
   * componente porque sólo él sabe qué tiene al lado.
   */
  aclaracion?: string;
  /**
   * Avisa cuando hay algo escrito sin enviar —texto o menciones elegidas— y
   * cuando deja de haberlo. Lo usa quien monta el hilo dentro de algo que se
   * puede cerrar (un diálogo), para no tirar el borrador sin avisar: el estado
   * del campo vive acá y desde afuera no se ve. Debe ser una función estable.
   */
  alCambiarElBorrador?: (hayBorrador: boolean) => void;
  /**
   * Si el hilo arranca desplegado. Por defecto **no**: en una OT, un requerimiento
   * o una condición el hilo es un agregado entre la información del registro, y
   * abierto ocupaba medio metro que nadie pidió.
   *
   * **Lo que decide es cómo se llegó, no la pantalla.** Se abre sólo cuando el
   * hilo es el motivo de estar ahí: el diálogo de «Mis pedidos», que se abre
   * porque alguien apretó «Mensajes», y la ficha de una condición insegura
   * **abierta por el `?condicion=` del correo de una mención** —quien llega por
   * ese enlace viene por la conversación—. La misma ficha abierta desde la lista
   * arranca plegada, como en todas partes.
   *
   * No es cosmético: abrir es lo que marca las menciones propias como leídas
   * (ver abajo), así que esto decide también si el enlace del correo las marca
   * solo o si hay que apretar «Marcar como leído» en la bandeja.
   *
   * Se lee una sola vez, al montar.
   */
  abiertoAlMontar?: boolean;
}) {
  // ── El hilo ────────────────────────────────────────────────────────────────
  const [mensajes, setMensajes] = useState<MensajeParaLaPantalla[]>([]);
  const [titulo, setTitulo] = useState("");
  const [existe, setExiste] = useState(true);
  const [cargando, setCargando] = useState(true);
  const [errorDelHilo, setErrorDelHilo] = useState("");
  const yaMarque = useRef("");

  // Cuántas menciones mías sin leer hay en este hilo, para decirlo en la barra.
  // `null` es «no se sabe» (todavía no contestó, o falló): en ese caso la barra
  // no dice nada, y no afirma que no hay.
  //
  // **Lo cuenta el GET del hilo**, que es el único que sabe quién pregunta: acá
  // llegan `usuario_id` y `leido` de cada mención, pero la pantalla no conoce su
  // propio id. Antes salía de un `GET /api/mensajes/mios` aparte —la bandeja
  // entera, con el texto de todas las menciones del sistema, para contar las de
  // un hilo, en cada montaje y encima de la que ya pide la campana—, y como era
  // una carga suelta se quedaba con el número del montaje: «Volver a leer» y
  // enviar un mensaje no lo movían. Ahora se refresca con cada lectura del hilo.
  const [sinLeerMias, setSinLeerMias] = useState<number | null>(null);

  const recargarElHilo = useCargar(async (vigente) => {
    let res: Response;
    try {
      res = await fetch(`/api/mensajes?tipo=${tipo}&id=${id}`);
    } catch {
      if (!vigente()) return;
      setErrorDelHilo("No se pudo leer el hilo: no hay conexión con el servidor.");
      setCargando(false);
      return;
    }
    const cuerpo = await leerJson(res);
    if (!vigente()) return;

    if (!res.ok) {
      setErrorDelHilo(`No se pudo leer el hilo. ${cuerpo.error ?? ""}`.trim());
      setCargando(false);
      return;
    }

    const data = (cuerpo.data ?? []) as MensajeParaLaPantalla[];
    // La ruta los manda del más nuevo al más viejo; acá se leen al derecho.
    setMensajes([...data].reverse());
    setTitulo(cuerpo.titulo ?? "");
    setExiste(cuerpo.existe_el_registro !== false);
    // Si este hilo ya se marcó, el número es 0 aunque el servidor todavía
    // conteste otra cosa: el PATCH marca el hilo entero y puede no haber
    // terminado, y volver a subirlo sería desmentir lo que la barra ya dijo.
    setSinLeerMias(
      yaMarque.current === `${tipo}:${id}`
        ? 0
        : typeof cuerpo.mis_menciones_sin_leer === "number"
          ? cuerpo.mis_menciones_sin_leer
          : null
    );
    setErrorDelHilo("");
    setCargando(false);
  }, [tipo, id]);

  // ── Plegado o abierto ──────────────────────────────────────────────────────
  // Arranca plegado salvo que `abiertoAlMontar` diga otra cosa: un hilo vacío ocupaba medio metro entre la
  // información del registro. El contenido **no se desmonta al plegar**, sólo se
  // oculta con `hidden`: lo que se estaba escribiendo vive en el estado de acá y
  // desmontarlo lo tiraba sin avisar.
  const [abierto, setAbierto] = useState(abiertoAlMontar);
  const idDelContenido = useId();

  // Abrir el hilo es lo que lo marca como leído, y no cargarlo: plegado, nadie vio
  // los mensajes, y marcarlos sería decirle al autor «ya lo vio» sin que sea
  // cierto (es lo que dice `PATCH /api/mensajes/mios`). Una vez por hilo, y sólo
  // si hay algo que pudiera mencionarme.
  useEffect(() => {
    if (!abierto || cargando || errorDelHilo || mensajes.length === 0) return;
    const clave = `${tipo}:${id}`;
    if (yaMarque.current === clave) return;
    yaMarque.current = clave;
    setSinLeerMias(0);
    void fetch("/api/mensajes/mios", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tipo, id }),
    }).catch(() => {});
  }, [abierto, cargando, errorDelHilo, mensajes.length, tipo, id]);

  // ── A quién se puede mencionar ─────────────────────────────────────────────
  const [destinatarios, setDestinatarios] = useState<Destinatario[]>([]);
  // `null` es «todavía no se sabe»: hasta que conteste, la mención no se ofrece.
  const [correoConfigurado, setCorreoConfigurado] = useState<boolean | null>(null);
  const [errorDeLaLista, setErrorDeLaLista] = useState("");

  const recargarLaLista = useCargar(async (vigente) => {
    let res: Response;
    try {
      res = await fetch(`/api/mensajes/destinatarios?tipo=${tipo}`);
    } catch {
      if (!vigente()) return;
      setErrorDeLaLista("no hay conexión con el servidor");
      return;
    }
    const cuerpo = await leerJson(res);
    if (!vigente()) return;
    if (!res.ok) {
      setErrorDeLaLista(cuerpo.error ?? "el servidor no contestó bien");
      return;
    }
    setDestinatarios((cuerpo.data ?? []) as Destinatario[]);
    setCorreoConfigurado(cuerpo.correo_configurado === true);
    setErrorDeLaLista("");
  }, [tipo]);

  // ── Lo que se está escribiendo ─────────────────────────────────────────────
  const [texto, setTexto] = useState("");
  const [mencionados, setMencionados] = useState<string[]>([]);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState("");
  const [resumen, setResumen] = useState<ResumenDelEnvio | null>(null);

  // Los correos salen después de la respuesta: al enviar no se sabe si llegaron.
  // Se vuelve a leer el hilo un rato después para que `pendiente` se resuelva.
  const temporizadores = useRef<ReturnType<typeof setTimeout>[]>([]);
  useEffect(() => {
    const vivos = temporizadores.current;
    return () => vivos.forEach(clearTimeout);
  }, []);

  function releerMasTarde() {
    for (const espera of ESPERAS_PARA_RELEER) {
      temporizadores.current.push(setTimeout(recargarElHilo, espera));
    }
  }

  // **`elegidos` es lo único que se muestra y lo único que se manda**: los chips,
  // la línea de a quién le llega, el botón y el cuerpo del POST salen de acá. Si
  // el POST mandara `mencionados` entero, una persona que ya no está en la lista
  // (el servidor contestó 400 y se volvió a pedir) viajaría sin que haya un chip
  // para sacarla, y la pantalla afirmaría a quién se avisa mientras el pedido
  // lleva a otra persona. Y si el correo no está configurado no hay a quién
  // avisar, así que las menciones ya elegidas se dejan de contar —el cartel de
  // arriba dice por qué— en vez de seguir prometiendo un correo que no sale.
  const porId = new Map(destinatarios.map((d) => [d.id, d]));
  const elegidos =
    correoConfigurado === false
      ? []
      : mencionados
          .map((m) => porId.get(m))
          .filter((d): d is Destinatario => d !== undefined);
  const sinElegir = destinatarios.filter((d) => !mencionados.includes(d.id));
  const aQuienLeLlega = elegidos.filter((d) => d.tiene_correo);
  const aQuienNo = elegidos.filter((d) => !d.tiene_correo);

  // **El borrador se mide sobre `elegidos` y no sobre `mencionados`**, y va acá
  // abajo por eso: es la misma familia que el resto del comentario de arriba. Un
  // id que `elegidos` filtra —la lista llegó vieja, o el correo no está
  // configurado— no se ve en ningún chip, así que con el campo vacío el diálogo
  // que monta este hilo decía «Descartar y cerrar» y Escape quedaba inerte, sin
  // que hubiera nada escrito a la vista que justificara ninguna de las dos cosas.
  // Lo que cuenta como borrador es lo que la pantalla muestra.
  const hayBorrador = texto.trim() !== "" || elegidos.length > 0;
  useEffect(() => {
    alCambiarElBorrador?.(hayBorrador);
  }, [hayBorrador, alCambiarElBorrador]);

  function mencionar(idDelUsuario: string) {
    if (!idDelUsuario) return;
    setMencionados((actuales) =>
      actuales.includes(idDelUsuario) || actuales.length >= MAXIMO_DE_MENCIONES
        ? actuales
        : [...actuales, idDelUsuario]
    );
    setError("");
  }

  async function enviar() {
    const limpio = texto.trim();
    if (!limpio) {
      setError("Escribí el mensaje.");
      return;
    }
    setEnviando(true);
    setError("");
    setResumen(null);

    let res: Response;
    try {
      res = await fetch("/api/mensajes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tipo, id, texto: limpio, menciones: elegidos.map((d) => d.id) }),
      });
    } catch {
      setEnviando(false);
      setError("No se pudo enviar: no hay conexión con el servidor. El mensaje no se guardó.");
      return;
    }
    const cuerpo = await leerJson(res);
    setEnviando(false);

    if (!res.ok) {
      setError(cuerpo.error ?? "No se pudo enviar el mensaje.");
      if (cuerpo.mensaje_guardado) {
        // El único error que dejó el mensaje escrito: se vacía el campo para no
        // duplicarlo si lo reintentan, y el hilo se relee para que se vea.
        setTexto("");
        setMencionados([]);
        recargarElHilo();
      } else if (res.status === 400) {
        // Lo más probable es que la lista estuviera vieja: se vuelve a pedir.
        recargarLaLista();
      }
      return;
    }

    // Lo que se muestra sale de la respuesta: el mensaje tal como quedó
    // guardado y a quiénes el servidor decidió no mandarles el correo.
    setMensajes((actuales) => [...actuales, cuerpo.data as MensajeParaLaPantalla]);
    setResumen({
      correoConfigurado: cuerpo.correo_configurado === true,
      seIntentan: cuerpo.avisos?.se_intentan ?? 0,
      sinAviso: (cuerpo.avisos?.sin_aviso ?? []).map(
        (s: { nombre: string | null; motivo: string }) => ({ nombre: s.nombre, motivo: s.motivo })
      ),
    });
    setTexto("");
    setMencionados([]);
    if ((cuerpo.avisos?.se_intentan ?? 0) > 0) releerMasTarde();
  }

  // ── Qué se puede hacer con la mención ──────────────────────────────────────
  // Una sola causa por vez, la que importa más: la que quien escribe puede ir a
  // arreglar. El texto va a la vista y no en un `title`, que en el teléfono no existe.
  const dequeHablamos = titulo || "este registro";
  let motivoSinMencion = "";
  if (errorDeLaLista) {
    motivoSinMencion =
      `No se pudo traer la lista de a quién mencionar (${errorDeLaLista}). ` +
      "Podés escribir igual, pero no se va a avisar a nadie.";
  } else if (correoConfigurado === false) {
    motivoSinMencion =
      "El correo no está configurado en el servidor, así que por ahora no se puede avisar a " +
      "nadie. Podés escribir igual: el mensaje queda en el hilo, pero a nadie le va a llegar un correo.";
  } else if (correoConfigurado === true && destinatarios.length === 0) {
    motivoSinMencion = `No hay a quién mencionar: nadie más puede ver ${dequeHablamos}.`;
  }
  const puedeMencionar =
    correoConfigurado === true && !errorDeLaLista && destinatarios.length > 0;
  const alLimite = elegidos.length >= MAXIMO_DE_MENCIONES;

  // Lo que dice la barra de cuánto hay adentro, para que nadie abra un hilo al pepe.
  // Sólo afirma lo que se sabe: con error o cargando no inventa un conteo.
  let estadoDeLaBarra: string;
  if (cargando) estadoDeLaBarra = "buscando…";
  else if (errorDelHilo) estadoDeLaBarra = "no se pudo leer (abrilo para ver el motivo)";
  else if (mensajes.length === 0) {
    estadoDeLaBarra = existe ? "todavía nadie escribió" : "el registro ya no está";
  } else {
    const cuantos = mensajes.length === 1 ? "1 mensaje" : `${mensajes.length} mensajes`;
    // El «ya no está» también cuando hay mensajes, y ése es el caso realista: un
    // hilo queda huérfano **porque alguien borró el registro**, y para eso tuvo
    // que haber habido conversación. El cartel de adentro sólo lo ve quien abre;
    // plegado, la barra es lo único que hay, y callar ahí la dejaba diciendo «3
    // mensajes» sobre un registro que no existe.
    estadoDeLaBarra = existe ? cuantos : `${cuantos} · el registro ya no está`;
  }

  return (
    <div className="border-t border-slate-200 pt-3">
      <button
        type="button"
        onClick={() => setAbierto((a) => !a)}
        aria-expanded={abierto}
        aria-controls={idDelContenido}
        className="flex w-full items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-left hover:bg-slate-50"
      >
        <span className="min-w-0 text-sm text-slate-700">
          <span className="font-medium">Mensajes</span>
          <span className="text-slate-500"> · {estadoDeLaBarra}</span>
          {sinLeerMias !== null && sinLeerMias > 0 && (
            <span className="font-medium text-amber-700">
              {" · "}
              {sinLeerMias === 1 ? "1 mención tuya sin leer" : `${sinLeerMias} menciones tuyas sin leer`}
            </span>
          )}
          {hayBorrador && (
            <span className="font-medium text-amber-700"> · borrador sin enviar</span>
          )}
        </span>
        <span aria-hidden className="shrink-0 text-xs text-slate-400">{abierto ? "▲" : "▼"}</span>
      </button>

      <div id={idDelContenido} hidden={!abierto} className="mt-3 space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <p className="text-xs font-medium text-slate-500">
            Mensajes{titulo ? ` · ${titulo}` : ""}
          </p>
          <button
            type="button"
            onClick={recargarElHilo}
            className="text-xs text-slate-400 underline hover:text-slate-700"
          >
            Volver a leer
          </button>
        </div>

        {aclaracion && <p className="text-xs text-slate-500">{aclaracion}</p>}

        {cargando && <p className="text-xs text-slate-400">Buscando…</p>}
        {errorDelHilo && <p className="text-sm text-red-600">{errorDelHilo}</p>}

        {!cargando && !errorDelHilo && !existe && (
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">
            Este registro ya no está. Lo que se habló queda acá, pero no se puede escribir más.
          </p>
        )}

        {!cargando && !errorDelHilo && mensajes.length === 0 && (
          <p className="text-xs text-slate-400">Todavía nadie escribió nada acá.</p>
        )}

        {mensajes.length > 0 && (
          <ul className="space-y-1.5">
            {mensajes.map((m) => (
              <li key={m.id} className="rounded-lg border border-slate-200 bg-white px-3 py-2">
                <p className="text-sm text-slate-800 whitespace-pre-wrap break-words">{m.texto}</p>
                <p className="mt-0.5 text-xs text-slate-400">
                  {m.autor ?? "—"} ·{" "}
                  <span title={new Date(m.creado_en).toLocaleString("es-AR")}>
                    {haceCuanto(m.creado_en)}
                  </span>
                </p>
                {m.menciones.length > 0 && (
                  <ul className="mt-1.5 space-y-0.5">
                    {m.menciones.map((x) => (
                      <li key={x.usuario_id} className="text-xs text-slate-500">
                        Para <span className="font-medium text-slate-700">{x.nombre ?? "—"}</span>
                        {" · "}
                        <EstadoDelCorreo aviso={x.aviso} motivo={x.aviso_fallo} />
                        {" · "}
                        <span className={x.leido ? "text-slate-500" : "text-slate-400"}>
                          {x.leido ? "ya lo vio" : "todavía no lo vio"}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        )}

        {/* Lo que dice el servidor del mensaje que se acaba de enviar. */}
        {resumen && <ResumenDeAvisos resumen={resumen} />}

        {existe && (
          <div className="space-y-2">
            <p className="rounded-lg bg-slate-100 px-3 py-2 text-xs text-slate-600">
              <span className="font-medium">Esto no es privado.</span> El hilo lo ve cualquiera que
              pueda ver {dequeHablamos}, y no se edita ni se borra. Si la conversación no tiene que
              verla todo ese grupo, no va acá. Los correos no se contestan: se responde acá.
            </p>

            <textarea
              value={texto}
              onChange={(e) => { setTexto(e.target.value); setError(""); setResumen(null); }}
              maxLength={MAXIMO_DEL_TEXTO}
              rows={3}
              placeholder="Escribí un mensaje…"
              aria-label="Mensaje"
              className="input"
            />

            <div className="space-y-1.5">
              <p className="text-xs font-medium text-slate-500">
                Avisar a (le llega un correo y le queda marcado en el sistema)
              </p>

              <div className="w-full sm:w-72">
                <Select
                  className="input"
                  aria-label="Mencionar a alguien"
                  value=""
                  disabled={!puedeMencionar || alLimite}
                  onChange={(e) => mencionar(e.target.value)}
                >
                  <option value="" disabled>
                    {correoConfigurado === null && !errorDeLaLista
                      ? "Cargando…"
                      : alLimite
                        ? `Ya son ${MAXIMO_DE_MENCIONES}, el máximo`
                        : "Mencionar a alguien…"}
                  </option>
                  {sinElegir.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.nombre}{d.tiene_correo ? "" : " (sin correo)"}
                    </option>
                  ))}
                </Select>
              </div>

              {motivoSinMencion && (
                <p role="status" className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">
                  {motivoSinMencion}
                </p>
              )}

              {puedeMencionar && (
                <p className="text-xs text-slate-400">
                  Sólo se puede mencionar a quien pueda ver {dequeHablamos}: el correo lleva el texto
                  del mensaje, y a quien no tiene acceso ni le serviría el enlace. Si no encontrás a
                  alguien en la lista, puede ser que no tenga acceso o que ya no esté activo.
                </p>
              )}

              {elegidos.length > 0 && (
                <ul className="flex flex-wrap gap-1.5">
                  {elegidos.map((d) => (
                    <li
                      key={d.id}
                      className="inline-flex items-center gap-1 rounded-full border border-slate-300 bg-white py-0.5 pl-2.5 pr-1 text-xs text-slate-700"
                    >
                      {d.nombre}
                      <button
                        type="button"
                        aria-label={`Sacar a ${d.nombre}`}
                        onClick={() => setMencionados((a) => a.filter((m) => m !== d.id))}
                        className="rounded-full px-1.5 text-slate-400 hover:text-red-600"
                      >
                        ×
                      </button>
                    </li>
                  ))}
                </ul>
              )}

              {/* A quién le va a llegar, antes de enviar y no después. */}
              <p className="text-xs text-slate-600">
                {elegidos.length === 0 ? (
                  <>No vas a avisar a nadie: ni correo ni marca en el sistema. El mensaje queda en el hilo y lo ve quien lo abra.</>
                ) : (
                  <>
                    {aQuienLeLlega.length > 0 && (
                      <>
                        Correo para{" "}
                        <span className="font-medium">
                          {aQuienLeLlega.map((d) => d.nombre).join(", ")}
                        </span>
                        , y le queda marcado en el sistema. Que el correo llegue se confirma recién
                        después de enviar.{" "}
                      </>
                    )}
                    {aQuienNo.length > 0 && (
                      <span className="text-amber-700">
                        Sin correo cargado, el correo no sale, pero le queda marcado en el sistema:{" "}
                        {aQuienNo.map((d) => d.nombre).join(", ")}.
                      </span>
                    )}
                  </>
                )}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={enviar}
                disabled={enviando}
                className="btn-primary"
              >
                {/*
                  Cuenta `aQuienLeLlega` y no `elegidos`: a quien no tiene correo
                  cargado no se le avisa, y el botón no puede prometer un aviso
                  que no sale —es el anti-objetivo número uno—. Con todos los
                  elegidos sin correo dice «Enviar» a secas, que es lo que va a
                  pasar; el renglón de arriba ya dice a quién no le llega y por qué.
                */}
                {enviando
                  ? "Enviando…"
                  : aQuienLeLlega.length > 0
                    ? `Enviar y avisar a ${aQuienLeLlega.length}`
                    : "Enviar"}
              </button>
            </div>

            {error && <p className="text-sm text-red-600">{error}</p>}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Cómo salió el correo de una mención.
 *
 * Los tres textos dicen **lo que el dato dice y nada más**: `enviado` es que el
 * servicio de correo lo aceptó (no que la persona lo abrió), `fallo` es que se
 * sabe que no salió, y `pendiente` es «no se sabe» —puede estar saliendo todavía
 * o el servidor nunca llegó a anotar el resultado—.
 *
 * `motivo` sólo llega para quien escribió el mensaje: lo que dijo el servicio de
 * correo, sin traducir, que es lo que distingue un dominio rechazado de un cupo
 * agotado. Para el resto queda en null y se dice sólo que no salió.
 */
function EstadoDelCorreo({
  aviso, motivo,
}: {
  aviso: MensajeParaLaPantalla["menciones"][number]["aviso"];
  motivo: string | null;
}) {
  if (aviso === "enviado") {
    return <span className="text-emerald-700">correo enviado</span>;
  }
  if (aviso === "fallo") {
    return (
      <span className="text-red-600">
        el correo no salió{motivo ? `: ${motivo}` : ""}
      </span>
    );
  }
  return (
    <span className="text-amber-700">
      correo sin confirmar (puede estar saliendo todavía, o no haber salido)
    </span>
  );
}

/** Lo que dijo el servidor, justo después de enviar, sobre a quiénes se les avisa. */
function ResumenDeAvisos({ resumen }: { resumen: ResumenDelEnvio }) {
  const { correoConfigurado, seIntentan, sinAviso } = resumen;

  // Sin correo configurado todos quedan con el mismo motivo: se dice una vez.
  const lineasSinAviso = correoConfigurado
    ? sinAviso.map((s) => `A ${s.nombre ?? "alguien"} no se le mandó el correo: ${s.motivo}`)
    : sinAviso.length > 0
      ? [sinAviso[0].motivo]
      : [];

  const hayAlgoQueDecir = seIntentan > 0 || lineasSinAviso.length > 0;

  return (
    <div role="status" className="space-y-1 rounded-lg bg-slate-100 px-3 py-2 text-xs text-slate-700">
      <p className="font-medium">El mensaje quedó guardado.</p>
      {!hayAlgoQueDecir && <p>No mencionaste a nadie, así que no se mandó ningún correo.</p>}
      {seIntentan > 0 && (
        <p>
          Se está mandando el correo a {seIntentan} {seIntentan === 1 ? "persona" : "personas"}.
          Todavía no se sabe si llegó: junto a cada nombre, en el mensaje, va a aparecer cómo salió.
        </p>
      )}
      {lineasSinAviso.map((l, i) => (
        <p key={i} className="text-amber-700">{l}</p>
      ))}
    </div>
  );
}
