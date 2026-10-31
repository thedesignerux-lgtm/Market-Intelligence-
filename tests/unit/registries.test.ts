// Datos de prueba: filas inventadas con el formato de cada registro (no son datos reales).
import { describe, expect, it } from "vitest";
import { buildMunicipalityIndex, municipalityKeys, postalCodeIndex, resolveMunicipality } from "../../src/lib/domain/municipality-match";
import { CYCLING, isCyclingModality, registryRowToRecord } from "../../worker/sources/registries/common";
import { parseCataluna, cataluna } from "../../worker/sources/registries/cataluna";
import { parseEuskadi } from "../../worker/sources/registries/euskadi";
import { parseNavarra } from "../../worker/sources/registries/navarra";
import { parseCanarias } from "../../worker/sources/registries/canarias";
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
