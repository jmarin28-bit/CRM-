/**
 * Pruebas de la extracción del NIT del RUT.
 *
 *   npm run test:rut
 *
 * Vale la pena mantenerlas: el extractor puntúa candidatos, y un cambio de
 * puntaje puede hacer que gane un número equivocado sin que nada falle a la
 * vista. Un NIT incorrecto es peor que un NIT vacío, porque se guarda en la
 * cuenta sin que nadie lo note.
 *
 * Los textos de abajo son la salida real de pdf-parse (espacios ya
 * colapsados) para las distintas maquetaciones del formulario 001 de la DIAN.
 */
import { extractNitFromText, normalizeNit, computeNitDV } from "./rutNit.ts";

interface Caso {
  nombre: string;
  texto: string;
  esperado: string;
}

const casos: Caso[] = [
  {
    nombre: "RUT real: etiquetas primero, valores al final",
    // Recorte del RUT de ANALTEC LABORATORIOS. Es el caso que rompía la
    // versión anterior: "3 141165540998 9006664149" son tres valores
    // distintos (folios, número de formulario y NIT+DV). Al unirlos se
    // formaba "3141165540", que tiene DV 9 válido por casualidad y le ganaba
    // al NIT verdadero.
    texto:
      "5. Número de Identificación Tributaria (NIT)6. DV 984. Nombre 51. Código 4. Número de formulario " +
      "36. Nombre comercial37. Sigla 60. No. de Folios: 123456789101112131415161718 35. Razón social " +
      "40. Ciudad/Municipio 41. Dirección principal 3 141165540998 9006664149 Impuestos de Medellín 11 " +
      "Persona jurídica 1 ANALTEC LABORATORIOS S.A.S COLOMBIA 169 Antioquia 05 Medellín 001 CL 33 CR 74 B 146",
    esperado: "900666414-9",
  },
  {
    nombre: "etiqueta seguida del valor",
    texto:
      "IDENTIFICACION 5. Número de Identificación Tributaria (NIT) 900745087 6. DV 2 " +
      "35. Razón social ACME SAS 40. Ciudad Bogotá D.C. 41. Dirección principal CR 15 93 60",
    esperado: "900745087-2",
  },
  {
    nombre: "NIT y DV impresos juntos",
    texto: "5. Número de Identificación Tributaria (NIT) 9007450872 35. Razón social ACME SAS",
    esperado: "900745087-2",
  },
  {
    nombre: "NIT ya formateado con guión",
    texto: "5. Número de Identificación Tributaria (NIT) 900745087-2 35. Razón social ACME SAS",
    esperado: "900745087-2",
  },
  {
    nombre: "persona natural con cédula de 10 dígitos",
    texto: "5. Número de Identificación Tributaria (NIT) 1020304050 6. DV 8 31. Primer apellido PEREZ",
    esperado: "1020304050-8",
  },
  {
    nombre: "número de formulario justo antes del NIT",
    texto:
      "Espacio reservado para la DIAN 4. Número de formulario 14733374942 " +
      "5. Número de Identificación Tributaria (NIT) 830001338 6. DV 1 35. Razón social COMERCIAL LTDA",
    esperado: "830001338-1",
  },
  {
    nombre: "un dígito por celda",
    texto: "5. Número de Identificación Tributaria (NIT) 8 0 0 1 9 7 2 6 8 6. DV 4 35. Razón social INDUSTRIAS SA",
    esperado: "800197268-4",
  },
  {
    nombre: "número de casilla pegado al valor",
    texto: "5. Número de Identificación Tributaria (NIT) 901234567 6. DV 7 7. Primer apellido 35. Razón social TECH SAS",
    esperado: "901234567-7",
  },
  {
    nombre: "NIT de 8 dígitos",
    texto: "5. Número de Identificación Tributaria (NIT) 79876543 6. DV 4 35. Razón social ANTIGUA EU",
    esperado: "79876543-4",
  },
  {
    nombre: "encabezado abreviado NIT:",
    texto: "Hoja principal NIT: 860002964 DV 4 Razón social BANCO SA 41. Dirección AV 68 25 47",
    esperado: "860002964-4",
  },
  {
    nombre: "documento sin NIT",
    texto: "35. Razón social ACME SAS 40. Ciudad Bogotá 41. Dirección CR 15 93 60",
    esperado: "",
  },
];

const normalizaciones: Array<[string, string]> = [
  ["900745087-2", "900745087-2"],
  ["9007450872", "900745087-2"],
  ["900745087", "900745087-2"],
  ["900.745.087", "900745087-2"],
  ["", ""],
  ["abc", ""],
];

// El ejemplo oficial de la DIAN: 900745087 tiene DV 2.
const dvs: Array<[string, string]> = [
  ["900745087", "2"],
  ["900666414", "9"],
  ["830001338", "1"],
];

let ok = 0;
let malas = 0;

function comprobar(nombre: string, obtenido: string, esperado: string) {
  if (obtenido === esperado) {
    ok++;
  } else {
    malas++;
    console.error(`FALLA  ${nombre}\n       esperado "${esperado}" / obtenido "${obtenido}"`);
  }
}

for (const c of casos) comprobar(c.nombre, extractNitFromText(c.texto).nit, c.esperado);
for (const [entrada, esperado] of normalizaciones) comprobar(`normalizeNit("${entrada}")`, normalizeNit(entrada), esperado);
for (const [base, esperado] of dvs) comprobar(`computeNitDV("${base}")`, computeNitDV(base), esperado);

console.log(`\nNIT del RUT: ${ok} pruebas pasaron, ${malas} fallaron`);
if (malas > 0) process.exit(1);
