-- ============================================================
-- SdG — Mantenimiento: de dónde vino el enlace entre un aviso y su OT
--
-- El 23/10/2026 un aviso ganó una tercera salida: enlazarle una orden que ya
-- existe, porque el encargado del área se adelantó y la cargó por su lado. Esa
-- salida quedó **sin deshacer**, a diferencia de su hermana «No va», que sí
-- tiene su DELETE desde el 21/10.
--
-- Y hace falta justamente ahí: enlazar se hace **tipeando el número de la OT**.
-- Un número tipeado se equivoca con un dedo, y hoy la 2815 en lugar de la 2814
-- sólo se arregla editando la base a mano — que es el mismo argumento que el
-- docstring de `avisos/desestimar` da para que su deshacer exista.
--
-- ── POR QUÉ NO ALCANZA CON LOS DATOS QUE YA HAY ─────────────────────────────
--
-- Desenlazar limpia `work_order_id`, `ot_asignada` y **vacía la celda de la
-- columna `OT ASIGNADA` de la planilla**. O sea que borra. Y de los avisos que
-- hoy tienen algo en esa columna, casi ninguno lo tiene por el sistema.
--
-- Medido el 26/10/2026 sobre los 196 avisos:
--
--   * 186 tienen texto en `OT ASIGNADA`
--   * **4** tienen `work_order_id` — o sea que el enlace lo hizo la app
--   * **182** tienen el texto y nada más: lo escribió una persona en la
--     planilla. Y no son todos números: «RI 1888», «Revision» (×3), «si»,
--     «-» (×2), «1889 - 1886», «2567-2568».
--   * 0 tienen `work_order_id` sin texto.
--
-- Esos 182 no se tocan nunca: vaciarles la celda es borrar lo que alguien puso
-- en la planilla, que es de donde lee quien no entra al sistema. Eso se
-- distingue solo, sin columna nueva —les falta `work_order_id`—.
--
-- Lo que **no** se distingue son los otros dos, y son los que importan:
--
--   * un enlace hecho con «Ya tiene OT»: la orden existía antes y sigue
--     existiendo. Deshacerlo devuelve exactamente el estado anterior.
--   * un enlace que dejó «Generar OT»: la orden **la creó el sistema desde
--     ese aviso**. Deshacerlo deja una OT que nadie reclama, y el aviso
--     vuelve a la lista de pendientes invitando a que alguien genere una
--     segunda orden para el mismo problema.
--
-- Los dos dejan lo mismo —`work_order_id` y el número en `ot_asignada`—
-- porque los escribe la misma función (`lib/mantenimiento/marcarElAviso.ts`,
-- compartida a propósito para que no se separen). Medido: los 4 enlaces que
-- existen hoy son indistinguibles entre sí. Sin columna, desenlazar tendría
-- que ofrecerse para los dos o para ninguno.
--
-- ── NULL ES LA RESPUESTA SEGURA, Y POR ESO NO HAY BACKFILL ──────────────────
--
-- `ot_enlazada_en` lo escribe **sólo** la ruta de enlazar. Que arranque en
-- null en los 196 avisos que ya existen no es una deuda: es lo correcto. De
-- los 4 enlaces de hoy nadie puede saber de cuál de los dos caminos vinieron,
-- así que ninguno se puede desenlazar — y adivinarlo por la fecha sería
-- enlazar al que se le parece, con un borrado del otro lado.
--
-- ── POR QUÉ ACÁ NO VA UN `CHECK`, Y SU HERMANA SÍ TIENE UNO ─────────────────
--
-- `avisos_desestimado_completo` ata `desestimado_en` con `motivo_desestimado`.
-- La tentación es copiarlo: `ot_enlazada_en is null or work_order_id is not
-- null`. **Rompería el borrado de una OT.** `work_order_id` es
-- `on delete set null`, así que borrar la orden pondría el null y el check
-- fallaría, y con él el DELETE entero — justo el que corre la sincronización
-- desde el 18/10 cuando la planilla deja de traer una OT.
--
-- Lo mismo vale para atar las dos columnas nuevas entre sí: `ot_enlazada_por`
-- referencia `usuarios` con `on delete set null`. Y es el motivo por el que el
-- check del 21/10 deja a `desestimado_por` afuera: **ninguna condición de un
-- check puede nombrar una columna que un `on delete set null` va a mover.**
--
-- Tampoco va índice. El de `desestimado_en` existe porque la pantalla pregunta
-- «cuáles están desestimados»; nadie pregunta cuáles están enlazados, y el
-- dato se mira de a un aviso por su id.
-- ============================================================

alter table public.avisos
  add column if not exists ot_enlazada_en  timestamptz,
  add column if not exists ot_enlazada_por uuid references public.usuarios(id) on delete set null;

comment on column public.avisos.ot_enlazada_en is
  'Cuándo se le enlazó a este aviso una OT que YA EXISTIA, con el botón «Ya tiene OT». NULL es que ese enlace no lo hizo ese botón: o no hay OT, o la generó el sistema desde este aviso, o el número lo escribió alguien a mano en la planilla. Es lo único que habilita a desenlazar, porque es lo único que prueba que la orden existía antes y sigue existiendo sin este aviso.';

comment on column public.avisos.ot_enlazada_por is
  'Quién lo enlazó. Informativo: lo que se mira cuando aparece un número que no cierra, porque el número se tipea y se equivoca con un dedo.';
