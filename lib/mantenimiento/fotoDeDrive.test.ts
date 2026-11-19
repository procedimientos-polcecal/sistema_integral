import { describe, it, expect } from "vitest";
import { idDeDrive } from "./fotoDeDrive";

describe("idDeDrive", () => {
  it("lo saca de la forma que escribe el formulario", () => {
    expect(idDeDrive("https://drive.google.com/open?id=1IZS7xcwoEgR4hX9colEC4J_uPPbR6v6z")).toBe(
      "1IZS7xcwoEgR4hX9colEC4J_uPPbR6v6z"
    );
  });

  it("y de las otras tres formas que junta la planilla", () => {
    expect(idDeDrive("https://drive.google.com/file/d/1IZS7xcwoEgR4hX/view?usp=drivesdk")).toBe(
      "1IZS7xcwoEgR4hX"
    );
    expect(idDeDrive("https://drive.google.com/uc?export=download&id=1IZS7xcwoEgR4hX")).toBe(
      "1IZS7xcwoEgR4hX"
    );
    expect(idDeDrive("https://lh3.googleusercontent.com/d/1IZS7xcwoEgR4hX")).toBe(
      "1IZS7xcwoEgR4hX"
    );
  });

  it("lo que no es de Drive no tiene id", () => {
    expect(idDeDrive(null)).toBeNull();
    expect(idDeDrive("")).toBeNull();
    expect(idDeDrive("   ")).toBeNull();
    expect(idDeDrive("no es un link")).toBeNull();
    expect(idDeDrive("https://ejemplo.com/open?id=1IZS7xcwoEgR4hX")).toBeNull();
    expect(
      idDeDrive("https://abcd.supabase.co/storage/v1/object/public/execution-photos/a/1.jpg")
    ).toBeNull();
  });

  it("no se deja colar una barra ni un .. en el id", () => {
    // El id termina pegado a una URL de la API de Drive, y la credencial que
    // la firma ve todas las planillas del grupo: acá no entra nada raro.
    expect(idDeDrive("https://drive.google.com/open?id=../../otra/cosa")).toBeNull();
    expect(idDeDrive("https://drive.google.com/open?id=abc/def")).toBeNull();
    expect(idDeDrive("https://drive.google.com/open?id=corto")).toBeNull();
    expect(idDeDrive(`https://drive.google.com/open?id=${"a".repeat(201)}`)).toBeNull();
  });

  it("un `javascript:` no llega ni a mirarse el id", () => {
    expect(idDeDrive("javascript:fetch('//drive.google.com/open?id=1IZS7xcwoEgR4hX')")).toBeNull();
  });

  it("un subdominio parecido no es Drive", () => {
    // `drive.google.com.malo.com` termina en `.com` y contiene el nombre: el
    // chequeo es sobre el host entero, no sobre un `includes`.
    expect(idDeDrive("https://drive.google.com.malo.com/open?id=1IZS7xcwoEgR4hX")).toBeNull();
    // Y éste es el que se cuela si el `$` va suelto: termina igual y es de otro.
    expect(idDeDrive("https://evilgoogleusercontent.com/d/1IZS7xcwoEgR4hX")).toBeNull();
    expect(idDeDrive("https://lh3.googleusercontent.com/d/1IZS7xcwoEgR4hX")).not.toBeNull();
  });
});
