import { describe, it, expect } from "vitest";
import {
  fusionarConLoQueYaHabia, type DeLaPlanilla, type LoQueYaHabia,
} from "./fusionDeLaPlanilla";

/** La planilla no dijo nada de nada: todas las celdas vacías. */
const NADA: DeLaPlanilla = {
  prioridad: null,
  estado_aprobacion: null,
  estado_compra: null,
  solicitante_nombre: null,
  compra_asignada_a: null,
  comparativa_drive_id: null,
  paga: null,
};

/**
 * Un pedido cargado en el sistema, con todo lo que el sistema sabe de el.
 *
 * `estado_aprobacion` y `estado_compra` van en un valor DISTINTO del default
 * ("APROBADA" y "PEDIDO", no "PENDIENTE" y "SIN_INICIAR") a propósito: si el
 * test usara el mismo valor que el default, una función que ignorara `previo`
 * por completo pasaría igual. PEDIDO → SIN_INICIAR es, además, el caso
 * histórico: 15 RI volvieron a foja cero en una sola corrida.
 */
const DEL_SISTEMA: LoQueYaHabia = {
  prioridad: "1 SEMANA",
  estado_aprobacion: "APROBADA",
  estado_compra: "PEDIDO",
  solicitante_nombre: "Admin SdG",
  compra_asignada_a: null,
  comparativa_drive_id: null,
  empresa_id: null,
  paga_ambas: true,
  origen: "app",
};

describe("lo que se conserva cuando la planilla vuelve a traer un RI", () => {
  it("un pedido cargado en el sistema sigue diciendo que entro por el sistema", () => {
    // El indicador de /compras/configuracion mide por aca por donde entran los
    // pedidos nuevos, y es el que decide cuando apagar el formulario. Si la
    // sincronizacion lo pisa con "sheets", mide siempre cero.
    expect(fusionarConLoQueYaHabia(NADA, DEL_SISTEMA).origen).toBe("app");
  });

  it("el que no existia entra como de la planilla", () => {
    expect(fusionarConLoQueYaHabia(NADA, undefined).origen).toBe("sheets");
  });

  it("una celda vacia no borra la prioridad ni quien paga", () => {
    // Las dos las elige quien pide, en el alta. En la planilla son columnas a
    // mano que recien se llenan al aprobar: vacias significan "todavia no",
    // no "borralo".
    const r = fusionarConLoQueYaHabia(NADA, DEL_SISTEMA);
    expect(r.prioridad).toBe("1 SEMANA");
    expect(r.paga_ambas).toBe(true);
  });

  it("una celda vacia no revierte el estado de aprobacion ni el de compra", () => {
    // Es la regresion que origino la regla: no se pudo leer la celda no es lo
    // mismo que "sin aprobar" o "sin iniciar". DEL_SISTEMA fija APROBADA y
    // PEDIDO -que no son los defaults- para que este test falle si la funcion
    // ignorara `previo` y cayera siempre al valor por defecto.
    const r = fusionarConLoQueYaHabia(NADA, DEL_SISTEMA);
    expect(r.estado_aprobacion).toBe("APROBADA");
    expect(r.estado_compra).toBe("PEDIDO");
  });

  it("una celda vacia no borra el nombre de quien pidio", () => {
    // Sin esto, un RI cargado en la app -que si sabe quien lo pidio- perdia
    // el nombre en la primera sincronizacion que releyera su fila, y su autor
    // dejaba de verlo entre los suyos.
    expect(fusionarConLoQueYaHabia(NADA, DEL_SISTEMA).solicitante_nombre).toBe("Admin SdG");
  });

  it("si el alias de esta vez no se pudo resolver, se conserva quien tenia la compra asignada", () => {
    // "PARA COMPRAR (NICO)" que no matchea ningun alias registrado en
    // /compras/configuracion llega con compra_asignada_a en null: no es que
    // la planilla haya dicho "sin asignar", es que no se pudo resolver quien
    // es NICO. Sin esto nadie podia aprobar la compra.
    const conAsignado = { ...DEL_SISTEMA, compra_asignada_a: "usr-nico" };
    expect(fusionarConLoQueYaHabia(NADA, conAsignado).compra_asignada_a).toBe("usr-nico");
  });

  it("pero lo que la planilla SI dice, manda", () => {
    const r = fusionarConLoQueYaHabia(
      {
        ...NADA,
        prioridad: "URGENTE",
        compra_asignada_a: "usr-maxi",
        paga: { empresa_id: "e-polcecal", ambas: false },
      },
      DEL_SISTEMA
    );
    expect(r.prioridad).toBe("URGENTE");
    expect(r.compra_asignada_a).toBe("usr-maxi");
    expect(r.empresa_id).toBe("e-polcecal");
    expect(r.paga_ambas).toBe(false);
  });

  it("sin planilla y sin previo, los estados caen al valor de un RI nuevo", () => {
    const r = fusionarConLoQueYaHabia(NADA, undefined);
    expect(r.estado_aprobacion).toBe("PENDIENTE");
    expect(r.estado_compra).toBe("SIN_INICIAR");
    expect(r.prioridad).toBeNull();
    expect(r.empresa_id).toBeNull();
    expect(r.paga_ambas).toBe(false);
  });

  it("el estado que trae la planilla no se pierde", () => {
    // Es el otro lado de la regla: 15 RI pasaron de PEDIDO a SIN_INICIAR en una
    // sola corrida cuando el default gano sobre lo que habia.
    const r = fusionarConLoQueYaHabia({ ...NADA, estado_compra: "RECIBIDO" }, DEL_SISTEMA);
    expect(r.estado_compra).toBe("RECIBIDO");
  });

  it("la comparativa enlazada no se pierde si esta vez no se pudo leer el link", () => {
    const conComparativa = { ...DEL_SISTEMA, comparativa_drive_id: "drive-1" };
    expect(fusionarConLoQueYaHabia(NADA, conComparativa).comparativa_drive_id).toBe("drive-1");
  });

  it("una celda vacia conserva la empresa que ya estaba, no solo el 'ambas'", () => {
    // El fixture DEL_SISTEMA tiene empresa_id en null y paga_ambas en true, asi
    // que sin este caso la conservacion de empresa_id no la muerde ningun test:
    // cambiarla por `: null` dejaba la suite entera en verde.
    const conEmpresa = { ...DEL_SISTEMA, empresa_id: "e-polysan", paga_ambas: false };
    const r = fusionarConLoQueYaHabia(NADA, conEmpresa);
    expect(r.empresa_id).toBe("e-polysan");
    expect(r.paga_ambas).toBe(false);
  });

  it("una decision explicita de 'ninguna de las dos' SI limpia la empresa que habia", () => {
    // `{empresa_id: null, ambas: false}` no es lo mismo que no traer `paga`:
    // es un objeto, y sigue siendo una decision. Este es el unico caso donde
    // "ninguna de las dos" sigue siendo posible, y depende de que la fusion
    // chequee el objeto completo (`dePlanilla.paga ? ... : ...`) y no cada campo
    // con `??`: un `??` tomaria el `null` de adentro como "no vino nada" y
    // conservaria la empresa vieja en vez de borrarla.
    const conEmpresa = { ...DEL_SISTEMA, empresa_id: "e-polcecal", paga_ambas: false };
    const r = fusionarConLoQueYaHabia(
      { ...NADA, paga: { empresa_id: null, ambas: false } },
      conEmpresa
    );
    expect(r.empresa_id).toBeNull();
    expect(r.paga_ambas).toBe(false);
  });
});
