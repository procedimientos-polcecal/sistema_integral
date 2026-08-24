-- ============================================================
-- SdG — Compras: la sincronización dejaba de mirar la planilla
--
-- `editado_en_app` existe para que la planilla no pise lo que se gestionó desde
-- el sistema. Pero el trigger marcaba la fila cada vez que cambiaba el estado,
-- el proveedor o los costos, **sin importar quién la cambió** — y la
-- sincronización escribe esos mismos campos con el mismo cliente admin.
--
-- Efecto: la primera vez que la sincronización le cambiaba el estado a un RI,
-- ese RI se congelaba solo y no volvía a mirar la planilla nunca más. Así
-- quedaron 1368 de 1858 marcados sin que nadie los tocara desde la app, y por
-- eso un RI como el 1258 figura acá en un estado y en la planilla en otro.
--
-- Se distinguen por `sheets_sincronizado_en`: la sincronización lo escribe en
-- cada fila que trae, y la app no lo toca al gestionar una compra.
-- ============================================================

create or replace function public.compras_marcar_editado_en_app()
returns trigger
language plpgsql
as $$
begin
  -- Si esta misma escritura actualizó la marca de sincronización, viene de la
  -- planilla: no es una edición en la app.
  if new.sheets_sincronizado_en is distinct from old.sheets_sincronizado_en then
    return new;
  end if;

  if new.estado_aprobacion is distinct from old.estado_aprobacion
     or new.estado_compra   is distinct from old.estado_compra
     or new.proveedor_id    is distinct from old.proveedor_id
     or new.costo_iva       is distinct from old.costo_iva
     or new.costo_envio     is distinct from old.costo_envio
     or new.comparativa_url is distinct from old.comparativa_url
  then
    new.editado_en_app = true;
  end if;

  return new;
end;
$$;

comment on function public.compras_marcar_editado_en_app() is
  'Marca el RI como gestionado en la app. No marca cuando la escritura viene de la sincronización, que se reconoce porque actualiza sheets_sincronizado_en.';

-- ── Los que se marcaron solos ────────────────────────────────
-- Un RI que nunca se gestionó desde la app no tiene por qué estar congelado.
--
-- Para saber cuáles se gestionaron de verdad no sirve mirar el proveedor o el
-- costo: eso también lo carga la sincronización desde la planilla, así que casi
-- todos lo tienen. El marcador que sólo puede poner la app es el `usuario_id`
-- del historial, que las rutas estampan y la sincronización deja en NULL.
--
-- Con ese criterio son 8 de 1368. El resto se marcó solo y vuelve a mirar la
-- planilla. Se conservan además los que tienen algo que sólo existe en la app:
-- comparativa adjunta, compra asignada o compra aprobada.
update compras_requerimientos r
set editado_en_app = false
where r.editado_en_app = true
  and r.comparativa_drive_id is null
  and r.compra_asignada_a is null
  and r.compra_aprobada_por is null
  and not exists (
    select 1
    from compras_historial h
    where h.requerimiento_id = r.id
      and h.usuario_id is not null
  );
