import { describe, it, expect } from "vitest";
import { idDeDrive, sePuedeServir } from "./fotoDeDrive";

const MB = 1024 * 1024;

describe("sePuedeServir", () => {
  it("una foto y un video sí", () => {
    expect(sePuedeServir("image/jpeg", 6 * MB)).toBeNull();
    expect(sePuedeServir("image/png", 1)).toBeNull();
    expect(sePuedeServir("image/heic", 1)).toBeNull();
    // Los dos que hay de verdad, medidos el 23/11/2026.
    expect(sePuedeServir("video/mp4", Math.round(0.9 * MB))).toBeNull();
    expect(sePuedeServir("video/mp4", Math.round(3.2 * MB))).toBeNull();
    expect(sePuedeServir("video/quicktime", 10 * MB)).toBeNull();
  });

  it("un documento no, y no es una omisión", () => {
    // Del otro lado hay una credencial que ve todas las planillas del grupo:
    // servir cualquier tipo volvería legible para cualquiera con sesión un
    // documento que esa persona no tiene permiso de abrir.
    for (const tipo of [
      "application/pdf",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "application/vnd.google-apps.spreadsheet",
      "text/plain",
      "",
    ]) {
      expect(sePuedeServir(tipo, 1)).toMatch(/no es una foto ni un video/);
    }
  });

  it("cada uno tiene su propio tope", () => {
    expect(sePuedeServir("image/jpeg", 10 * MB)).toBeNull();
    expect(sePuedeServir("image/jpeg", 10 * MB + 1)).toMatch(/La foto pesa 10 MB/);
    // 11 MB es una foto demasiado grande y un video perfectamente normal.
    expect(sePuedeServir("image/jpeg", 11 * MB)).toMatch(/máximo desde acá son 10/);
    expect(sePuedeServir("video/mp4", 11 * MB)).toBeNull();
    expect(sePuedeServir("video/mp4", 25 * MB)).toBeNull();
    expect(sePuedeServir("video/mp4", 26 * MB)).toMatch(/El video pesa 26 MB.*son 25/);
  });
});

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
