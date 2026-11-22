// Datos de prueba: filas inventadas con el formato de cada registro (no son datos reales).
import { describe, expect, it } from "vitest";
import { buildMunicipalityIndex, municipalityKeys, postalCodeIndex, resolveMunicipality } from "../../src/lib/domain/municipality-match";
import { CYCLING, isCyclingModality, registryRowToRecord } from "../../worker/sources/registries/common";
import { parseCataluna, cataluna } from "../../worker/sources/registries/cataluna";
import { parseEuskadi } from "../../worker/sources/registries/euskadi";
import { parseNavarra } from "../../worker/sources/registries/navarra";
import { parseCanarias } from "../../worker/sources/registries/canarias";
import { parseCastillaLeon, isCyclingCode } from "../../worker/sources/registries/castilla-leon";
import { parseAndalucia, parseDetail, parseTotal } from "../../worker/sources/registries/andalucia";
import type { CategoryMapping } from "../../src/lib/domain/categories";

describe("emparejar municipios por nombre", () => {
  const index = buildMunicipalityIndex([
    { code: "08101", name: "L'Hospitalet de Llobregat" },
    { code: "31201", name: "Pamplona/Iruña" },
    { code: "35016", name: "Las Palmas de Gran Canaria" },
    { code: "17079", name: "Girona" },
    { code: "31097", name: "Estella-Lizarra" },
    { code: "43054", name: "L'Espluga de Francolí" },
    { code: "99001", name: "Villanueva" },
    { code: "99002", name: "Villanueva" },
  ]);

  it("reconoce el artículo pospuesto y los nombres bilingües", () => {
    expect(resolveMunicipality(index, "Hospitalet de Llobregat, l'")).toBe("08101");
    expect(resolveMunicipality(index, "PAMPLONA")).toBe("31201");
    expect(resolveMunicipality(index, "Iruña")).toBe("31201");
    expect(resolveMunicipality(index, "Palmas de Gran Canaria (Las)")).toBe("35016");
    expect(resolveMunicipality(index, "Gírona")).toBe("17079");
  });

  it("reconoce una parte de un nombre compuesto con guion y el artículo final sin coma", () => {
    expect(resolveMunicipality(index, "ESTELLA")).toBe("31097");
    expect(resolveMunicipality(index, "Espluga de Francolí l'")).toBe("43054");
  });

  it("código postal solo cuando siempre apunta al mismo municipio", () => {
    const idx = postalCodeIndex([
      { postalCode: "31001", code: "31201" },
      { postalCode: "31001", code: "31201" },
      { postalCode: "31620", code: "31086" },
      { postalCode: "31620", code: "31907" },
      { postalCode: null, code: "31201" },
    ]);
    expect(idx.get("31001")).toBe("31201");
    expect(idx.has("31620")).toBe(false);
  });

  it("no adivina: nombres desconocidos o ambiguos quedan sin resolver", () => {
    expect(resolveMunicipality(index, "Villanueva")).toBeNull();
    expect(resolveMunicipality(index, "Ciudad inventada")).toBeNull();
    expect(resolveMunicipality(index, null)).toBeNull();
  });

  it("genera claves con y sin artículo", () => {
    expect(municipalityKeys("Sauzal (El)")).toEqual(expect.arrayContaining(["el sauzal", "sauzal"]));
  });
});

describe("modalidades de ciclismo", () => {
  it("incluye ciclismo, BTT, BMX y cicloturismo; excluye motociclismo", () => {
    for (const m of ["Ciclisme", "BTT (ciclisme en bicicleta tot terreny)", "BMX (Ciclisme)", "Cicloturisme", "CICLISMO", "Ciclismo", "Biketrial"]) {
      expect(isCyclingModality(m)).toBe(true);
    }
    for (const m of ["MOTOCICLISMO", "Motociclisme", "Futbol", "Trial"]) expect(isCyclingModality(m)).toBe(false);
  });
});

describe("adaptadores de registros", () => {
  it("Cataluña: lee el CSV, marca ciclismo y deduce la provincia del código postal", () => {
    const csv = [
      '"Número de registre","Nom entitat","Adreça","Codi postal","Municipi","Comarca","Mòbil / Telèfon","Correu electrònic","Tipus d’entitat","Modalitats"',
      '"00001","CLUB CICLISTA DE PROVA","Carrer Major, 1","17001","Girona","Gironès","972000000","club@example.org","Clubs i Associacions Esportives","Ciclisme, Futbol"',
      '"00002","CLUB MOTOR DE PROVA","Carrer Nou, 2","08001","Barcelona","Barcelonès","","","Clubs i Associacions Esportives","Motociclisme"',
    ].join("\n");
    const rows = parseCataluna(csv);
    expect(rows).toHaveLength(2);
    expect(rows[0]!.modalities).toContain(CYCLING);
    expect(rows[0]!.provinceCode).toBe("17");
    expect(rows[1]!.modalities).not.toContain(CYCLING);
  });

  it("Cataluña: falla de forma explícita si cambian las columnas", () => {
    expect(() => parseCataluna('"Codi","Nom"\n"1","x"')).toThrow(/ha cambiado de formato/);
  });

  it("Euskadi: código INE y coordenadas del propio registro", () => {
    const geo = JSON.stringify({
      features: [
        {
          properties: { idregistro: "CD0000001", nombre: "PRUEBA TXIRRINDULARI", tipo: "CD", modalidadprincipal: "CICLISMO", direccion: "Kalea 1", municipio: "Donostia / San Sebastián", codigomunicipio: "69", codigopostal: "0", provincia: "Gipuzkoa", codigoprovincia: "20" },
          geometry: { type: "Point", coordinates: [-1.97, 43.32] },
        },
      ],
    });
    const [row] = parseEuskadi(geo);
    expect(row!.municipalityCode).toBe("20069");
    expect(row!.location).toEqual({ lon: -1.97, lat: 43.32 });
    expect(row!.postalCode).toBeNull();
    expect(row!.modalities).toContain(CYCLING);
  });

  it("Navarra: cruza el registro con sus actividades (15 = Ciclismo)", () => {
    const reg = '"ID_Registro";"Nombre";"NIF";"ID_Tipo_R";"Registro";"Direccion";"CP";"Localidad";"Comarca";"Web"\n1;"CLUB PRUEBA";"G00000000";1;1;"C/ UNO 1";"31001";"PAMPLONA";"PAMPLONA";';
    const act = '"ID_Registro_R";"ID_Actividad_R"\n1;15\n1;23';
    const cat = '"ID_Actividad";"Actividad"\n15;"Ciclismo"\n23;"Futbol"';
    const tip = '"ID_Tipo";"Tipo";"Descripcion"\n1;"Club";"Clubes Deportivos"';
    const [row] = parseNavarra(reg, act, cat, tip);
    expect(row!.modalities).toEqual([CYCLING, "Ciclismo", "Futbol"]);
    expect(row!.kind).toBe("Clubes Deportivos");
    expect(row!.nif).toBe("G00000000");
  });

  it("Castilla y León: ciclismo solo por código CI (ni motociclismo ni deporte adaptado)", () => {
    const csv = [
      "Nº registro;Nombre;Domicilio;Provincia;Localidad;C.Postal;Teléfono;Fax;Email;Web;F.Fundación;F.Inscripción;Deportes;Column 14",
      'CYA/900001;CLUB CICLISTA DE PRUEBA;C/ Mayor 1;Zamora;ZAMORA;49006;980000000;;club@example.org;;2000-01-01;2000-02-01;CI001 CICLISMO - CARRETERA,CI003 CICLISMO - BICICLETA MONTAÑA (BTT);',
      'CYA/900002;"CLUB ""MOTOR"" DE PRUEBA";C/ Nueva 2;León;LEON;24001;;;;;2000-01-01;2000-02-01;MT001 MOTOCICLISMO - VELOCIDAD;',
      'CYA/900003;CLUB ATLETISMO DE PRUEBA;C/ Sola 3;Burgos;BURGOS;09001;;;;;2000-01-01;2000-02-01;AT001 ATLETISMO - PISTA,DM005 DEPORTE ADAPTADO - CICLISMO (DF);',
      'CYA/900004;CLUB FUERA DE AMBITO;C/ Otra 4;Madrid;MADRID;28001;;;;;2000-01-01;2000-02-01;CI001 CICLISMO - CARRETERA;',
    ].join("\n");
    const rows = parseCastillaLeon(csv);
    expect(rows).toHaveLength(4);
    expect(rows[0]!.modalities).toContain(CYCLING);
    expect(rows[0]!.provinceCode).toBe("49");
    expect(rows[0]!.emails).toEqual(["club@example.org"]);
    expect(rows[1]!.modalities).not.toContain(CYCLING);
    expect(rows[1]!.name).toBe('CLUB "MOTOR" DE PRUEBA');
    expect(rows[2]!.modalities).not.toContain(CYCLING);
    // Un código postal fuera de Castilla y León no asigna provincia.
    expect(rows[3]!.provinceCode).toBeNull();
    expect(isCyclingCode("CI012 CICLISMO - GRAVEL")).toBe(true);
    expect(isCyclingCode("OR003 ORIENTACIÓN - EN BICICLETA DE MONTAÑA")).toBe(false);
  });

  it("Castilla y León: falla de forma explícita si cambian las columnas", () => {
    expect(() => parseCastillaLeon("Codigo;Nombre\n1;x")).toThrow(/ha cambiado de formato/);
  });

  it("Canarias: el código de municipio lleva dígito de control", () => {
    const ent = "CodEntidadDeportiva,NumeroRedc,Denominacion,CodProvincia,Provincia,CodIsla,Isla,CodMunicipio,Municipio,Localidad,FechaRegistro,CodSeccion,Seccion,CodAmbito,Ambito,Federaciones,Modalidades\n7,1/00-C,CLUB PRUEBA,38,Santa Cruz de Tenerife,384,Tenerife,380414,Sauzal (El),EL SAUZAL,2000-01-01,A,Clubes Deportivos - Primera,AUT,Regional,NULL,CICLISMO";
    const mod = 'CodEntidadDeportiva,CodModalidad,Modalidad\n7,1,"CICLISMO"';
    const [row] = parseCanarias(ent, mod);
    expect(row!.municipalityCode).toBe("38041");
    expect(row!.modalities).toContain(CYCLING);
  });

  it("convierte una fila a registro común con categoría, identificador y datos personales marcados", () => {
    const mappings: CategoryMapping[] = [
      { sourceId: "registro_cataluna", match: { modalidad: CYCLING }, categoryId: "club.deportivo.ciclismo", entityType: "club", priority: 200 },
    ];
    const csv = [
      '"Número de registre","Nom entitat","Adreça","Codi postal","Municipi","Comarca","Mòbil / Telèfon","Correu electrònic","Tipus d’entitat","Modalitats"',
      '"00001","CLUB CICLISTA DE PROVA","Carrer Major, 1 2n 1a","17001","Girona","Gironès","600000000","persona@gmail.com","Clubs i Associacions Esportives","Ciclisme"',
      '"00003","CLUB FUTBOL DE PROVA","Carrer Major, 3","17001","Girona","Gironès","","","Clubs i Associacions Esportives","Futbol"',
    ].join("\n");
    const [cycling, football] = parseCataluna(csv);
    const rec = registryRowToRecord(cataluna, cycling!, "17079", mappings)!;
    expect(rec.categories[0]!.categoryId).toBe("club.deportivo.ciclismo");
    expect(rec.identifiers).toContainEqual({ scheme: "registro", value: "registro_cataluna/00001" });
    expect(rec.emails[0]!.isPersonal).toBe(true);
    expect(rec.municipalityCode).toBe("17079");
    expect(registryRowToRecord(cataluna, football!, "17079", mappings)).toBeNull();
  });
});

describe("registro de Andalucía (RAED)", () => {
  // Página de resultados inventada con la estructura del buscador del RAED.
  const page = (filas: string) => `<html><body>
    <table class="table table-striped"><thead><tr><th></th><th>Número inscripción</th><th>Denominación</th><th>Municipio</th></tr></thead>
    <tbody>${filas}</tbody></table>
    <div class="paginado"><p>1 a 3 de 3 resultados</p></div></body></html>`;
  const fila = (num: string, nombre: string, muni: string, detalle: string) =>
    `<tr><td></td><td>${num}</td><td>${nombre}</td><td>${muni}</td></tr><tr><td colspan="4">${detalle}</td></tr>`;

  const html = page(
    fila("000273", "C.D. CICLISTA DE PRUEBA", "ALGECIRAS",
      "Fecha inscripción: 03/02/1986 Dirección: Plaza DE PRUEBA, S/N Provincia: CÁDIZ Municipio: ALGECIRAS C.P.: 11201 Teléfono: 956111111 Fax: ---- Email: prueba@example.org Entidad: Club deportivo Deporte: CICLISMO Fecha modificación estatuto: ---- Otros deportes: [TRIATLON] | Descargar Estatutos") +
    fila("000999", "C.D. DE MOTOS DE PRUEBA", "SEVILLA",
      "Fecha inscripción: 01/01/1990 Dirección: Calle INVENTADA, 1 Provincia: SEVILLA Municipio: SEVILLA C.P.: 41001 Teléfono: ---- Fax: ---- Email: ---- Entidad: Club deportivo Deporte: MOTOCICLISMO Fecha modificación estatuto: ---- Otros deportes: [----] | Descargar Estatutos") +
    fila("001234", "A.D. BTT DE PRUEBA", "PUERTO DE SANTA MARIA (EL)",
      "Fecha inscripción: 05/05/2005 Dirección: Avenida DE PRUEBA, 4 Provincia: CÁDIZ Municipio: PUERTO DE SANTA MARIA (EL) C.P.: 11500 Teléfono: ---- Fax: ---- Email: btt@example.org Entidad: Asociacion Deporte: MOUNTAIN BIKE Fecha modificación estatuto: ---- Otros deportes: [CICLISMO]"),
  );

  it("lee las fichas de ciclismo y descarta el motociclismo", () => {
    const rows = parseAndalucia(html);
    expect(rows.map((r) => r.externalId)).toEqual(["000273", "001234"]);
    const [primera, segunda] = rows;
    expect(primera!.name).toBe("C.D. CICLISTA DE PRUEBA");
    expect(primera!.modalities).toContain(CYCLING);
    expect(primera!.modalities).toContain("TRIATLON");
    expect(primera!.address).toBe("Plaza DE PRUEBA, S/N");
    expect(primera!.postalCode).toBe("11201");
    expect(primera!.provinceCode).toBe("11");
    expect(primera!.phones).toEqual(["956111111"]);
    expect(primera!.emails).toEqual(["prueba@example.org"]);
    expect(primera!.municipalityName).toBe("ALGECIRAS");
    // El artículo final del municipio lo resuelve municipality-match.
    expect(segunda!.municipalityName).toBe("PUERTO DE SANTA MARIA (EL)");
    expect(segunda!.kind).toBe("Asociacion");
    expect(segunda!.modalities).toContain(CYCLING);
  });

  it("no inventa campos cuando el registro escribe guiones", () => {
    const d = parseDetail("Fecha inscripción: 01/01/1990 Dirección: Calle X, 1 Provincia: SEVILLA Municipio: SEVILLA C.P.: 41001 Teléfono: ---- Fax: ---- Email: ---- Entidad: Club deportivo Deporte: CICLISMO Fecha modificación estatuto: ---- Otros deportes: [----] | Descargar Estatutos");
    expect(d["Teléfono"]).toBeUndefined();
    expect(d["Email"]).toBeUndefined();
    expect(d["Otros deportes"]).toBe("[----]");
    expect(d["Entidad"]).toBe("Club deportivo");
  });

  it("lee el total de resultados para detectar cambios de formato", () => {
    expect(parseTotal(html)).toBe(3);
    expect(parseTotal("<p>sin paginación</p>")).toBeNull();
  });
});
