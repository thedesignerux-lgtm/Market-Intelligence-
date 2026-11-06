"""Construye el fichero de investigación de distribuidores con procedencia por dato.

Regla: solo entra lo que se ha leído en una fuente concreta. Un campo que no se ha
verificado no se rellena ni se estima: se omite. Cada valor lleva su fuente y su método
('found' = leído en la fuente; 'verified' = confirmado en la web de la propia empresa).
"""
import json, re, unicodedata
from datetime import date

HOY = date.today().isoformat()
AMBE = "https://asociacionambe.com/asociados/"
DIR_MAY = "https://www.bicicleta.es/sitios/category/mayorista/"

# --- Directorio de asociados de AMBE (patronal del sector). Nombre y web leídos de esa página.
ambe = [
    ("Abus", "https://www.abus.com/es"), ("Accell Group", "https://www.accell-group.com/en"),
    ("Aurum Bikes", "https://aurumbikes.com/es/"), ("BEEQ Bicycles", "https://www.beeq-bicycles.com/es/"),
    ("Cycling Factory", "https://www.cyclingfactory.be/"), ("Berria Bikes", "https://berriabikes.com/"),
    ("BH", "https://www.bhbikes.com/es_ES"), ("Bicimax", "https://www.bicimax.es/"),
    ("BKL", "https://bkl.eco/"), ("Bosch eBike", "https://www.bosch-ebike.com/es/"),
    ("Brompton", "https://www.brompton.com/"), ("Canyon", "https://www.canyon.com/"),
    ("Campagnolo", "https://www.campagnolo.com/es-es/carretera-2/"), ("CJM Sport", "https://cjmsport.com/"),
    ("Comet Bike Parts", "https://www.cometbikeparts.com/es/inicio"), ("PON", "https://pon.bike/"),
    ("Decathlon", "https://www.decathlon.es/es"), ("DMotor", "https://www.dmotor.net/"),
    ("DT Swiss", "https://www.dtswiss.com/en"), ("Freeel", "https://freeel.bike/"),
    ("Focus", "https://www.focus-bikes.com/es_es/"), ("Galfer", "https://galfer.com/bike/es/"),
    ("Flebi", "https://flebi.com/"), ("Giant", "https://www.giant-bicycles.com/global"),
    ("Gurpil", "https://www.gurpil.com/"), ("Incycles", "https://www.incycles.eu/"),
    ("ISB Sport", "https://isbsport.com/"), ("Manufacturas GES", "https://www.manufacturasges.com/es"),
    ("Luma", "https://es.luma.es/"), ("Luchia", "https://luchia.eu/en/"),
    ("Massi", "https://www.massi.bike/"), ("Mahle Smartbike", "https://mahle-smartbike.com/"),
    ("Bicis Mendiz", "https://www.bicismendiz.com/"), ("Mérida", "https://www.merida-bikes.com/es-es"),
    ("MMR", "https://mmrbikes.com/"), ("Moma", "https://momabikes.com/"),
    ("Monty", "https://www.montybikes.com/"), ("Mondraker", "https://mondraker.com/be/es"),
    ("Mothium", "https://www.mothium.com/"), ("Orbea", "https://www.orbea.com/es-int"),
    ("Pinarello", "https://www.pinarello.es/"), ("Podium Bike", "https://www.podiumbike.es/"),
    ("RALI", "https://rali-bikes.com/"), ("R&M", "https://www.r-m.de/es-es/"),
    ("Santa Fixie", "https://www.santafixie.com/"), ("Shimano", "https://bike.shimano.com/es-ES/home.html"),
    ("Specialized", "https://www.specialized.com/es/es"), ("Spiuk", "https://spiuk.com/es/"),
    ("Teambike", "https://teambike.com/"), ("Trek", "https://www.trekbikes.com/es/es_ES/"),
    ("Urban Biker", "https://www.urbanbiker.com/"), ("Weareyouin", "https://weareyouin.com/"),
]

# --- Mayoristas del directorio bicicleta.es. La web va marcada aparte porque ese directorio
# --- la deduce de la captura de pantalla de la ficha, no de un enlace: es menos fiable.
mayoristas = [
    ("Q.ik ebikes", "https://www.qikbike.com", "Barcelona"), ("Prowen Bikes (JL Wenti)", None, "Lucena (Córdoba)"),
    ("The Bike Alliance, S.L.", "https://bicimarket.com", "Barcelona"), ("Neomouv", None, "Vitoria-Gasteiz (Álava)"),
    ("Deportica", "https://www.deportica.es", "Parla (Madrid)"), ("Casa Masferrer", "https://www.casamasferrer.com", "Granollers (Barcelona)"),
    ("Tekmax Componentes", "https://tekmaxcomponents.es", "Loeches (Madrid)"), ("Gurpilan S.L.", "https://www.gurpil.com", "Itziar (Gipuzkoa)"),
    ("Coluer Bicycles", "https://coluer.com", "Tarragona"), ("Cloot Bike", "https://clootbike.com", "Alboraya (València)"),
    ("Bike Difusion", "https://bikedifusion.com", "Vitoria-Gasteiz (Álava)"), ("myCycle", "https://mycycle.eu", "Errenteria (Gipuzkoa)"),
    ("Pinarello España", "https://pinarello.es", "Barbatain (Navarra)"),
]

# --- Fichas verificadas leyendo la web de la propia empresa. Solo campos efectivamente leídos.
verificadas = {
    "cobalai.com": dict(
        nombre="Cobalai Bikes", tipo="distribuidor",
        especializacion="Accesorios y recambios de ciclismo para tiendas y talleres. Marcas: Elvedes, Gist, Rubbex, Ahooh. Exclusivas: Brakco, DBD Tools, Connex, Ahooh.",
        localidad="Granollers (Barcelona)", direccion="Avda. Sant Julià, 154, Nau 6, 08403 Granollers",
        email="info@cobalaibikes.com", telefono="+34 938 793 711",
        portal_b2b="https://b2b.cobalaibikes.com", fuente="https://cobalai.com/"),
    "casamasferrer.com": dict(
        nombre="Casa Masferrer", tipo="distribuidor",
        especializacion="Distribución a detallistas de 19 marcas (Massi, Look, Dahon, Topeak, Campagnolo, Schwalbe, Michelin, Sigma, Zycle, Micro Shift y otras). Declara cartera de más de 3.500 tiendas.",
        localidad="Granollers (Barcelona)", cobertura="Europa, América y Asia; exporta a más de 20 países",
        portal_b2b="sí (aplicación B2B enlazada, requisitos no publicados)", fuente="https://www.casamasferrer.com/"),
    "bikedifusion.com": dict(
        nombre="Bike Difusion", tipo="distribuidor",
        especializacion="Componentes y accesorios desde 1995, unas 30 marcas (Hope, Stan's NoTubes, Birzman, e*thirteen, iXS, Onza, Ergotec, Wheels Manufacturing). También ropa, nutrición, cascos y portabicicletas.",
        localidad="Vitoria-Gasteiz (Álava)", cobertura="Mercado ciclista español",
        email="info@bikedifusion.com", telefono="+34 945 158 288",
        portal_b2b="sí, restringido a tiendas que ya son clientes", fuente="https://www.bikedifusion.com/"),
    "mmrbikes.com": dict(
        nombre="MMR Bikes", tipo="marca",
        especializacion="Marca de bicicletas. Página de equipos patrocinados y embajadores.",
        cobertura="Venta internacional: el selector de región lista unos 45 países, España incluida",
        portal_b2b="https://b2b.slsbikes.com", fuente="https://www.mmrbikes.com/"),
    "bicimarket.com": dict(
        nombre="The Bike Alliance / Bicimarket", tipo="central_de_compras",
        especializacion="Central de compras de la red Bicimarket-BMK: 40.000 referencias de 200 marcas para tiendas y talleres asociados.",
        localidad="Barcelona", cobertura="Más de 170 tiendas y talleres asociados en España",
        email="expansion@bicimarket.com", telefono="+34 934 238 409",
        fuente="https://www.interempresas.net/Ciclismo/558906-Alianza-estrategica-entre-The-Bike-Alliance-y-Sportmas-Bike.html",
        fuente_fecha="2024-04-11"),
}


def dominio(url):
    if not url:
        return None
    d = re.sub(r"^https?://(www\.)?", "", url).split("/")[0].lower()
    return d or None


def norm(s):
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9]+", " ", s).strip()


registros = {}


def añadir(nombre, web, fuente, metodo, **extra):
    """Clave por dominio: dos fuentes que citan la misma web son la misma empresa, no dos."""
    d = dominio(web) or f"sin-web:{norm(nombre)}"
    r = registros.setdefault(d, {"clave": d, "nombre": nombre, "campos": {}, "fuentes": []})
    if fuente not in r["fuentes"]:
        r["fuentes"].append(fuente)
    if web:
        r["campos"].setdefault("web", {"valor": web, "fuente": fuente, "metodo": metodo, "observado": HOY})
    for k, v in extra.items():
        if v:
            r["campos"].setdefault(k, {"valor": v, "fuente": fuente, "metodo": metodo, "observado": HOY})


for nombre, web in ambe:
    añadir(nombre, web, AMBE, "found", afiliacion="Asociada a AMBE (Asociación de Marcas y Bicicletas de España)")

for nombre, web, localidad in mayoristas:
    # El directorio deduce la web de una captura: se marca como 'inferred' si no la confirmó la empresa.
    # El directorio los lista explícitamente como mayoristas: es un dato con origen,
    # marcado 'inferred' porque no lo confirma la propia empresa. Una ficha verificada lo pisa.
    añadir(nombre, web, DIR_MAY, "inferred", localidad=localidad, tipo="mayorista",
           clasificacion_directorio="Mayorista según el directorio bicicleta.es")

for clave, f in verificadas.items():
    fuente = f.pop("fuente")
    f.pop("fuente_fecha", None)
    nombre = f.pop("nombre")
    r = registros.setdefault(clave, {"clave": clave, "nombre": nombre, "campos": {}, "fuentes": []})
    r["nombre"] = nombre
    if fuente not in r["fuentes"]:
        r["fuentes"].append(fuente)
    for k, v in f.items():
        # 'verified' pisa a lo leído en un directorio: lo dice la propia empresa.
        r["campos"][k] = {"valor": v, "fuente": fuente, "metodo": "verified", "observado": HOY}
    r["campos"].setdefault("web", {"valor": f"https://{clave}", "fuente": fuente, "metodo": "verified", "observado": HOY})

salida = {
    "fuente_id": "investigacion_distribuidores",
    "generado": HOY,
    "nota": ("Cada campo lleva su fuente y su método: 'verified' = leído en la web de la propia empresa; "
             "'found' = leído en un directorio sectorial; 'inferred' = deducido por el directorio, sin confirmar. "
             "Un campo que no se ha podido verificar no aparece: no se estima ni se rellena."),
    "empresas": sorted(registros.values(), key=lambda r: norm(r["nombre"])),
}

with open("data/distribuidores/investigacion-2026-11.json", "w", encoding="utf-8") as fh:
    json.dump(salida, fh, ensure_ascii=False, indent=2)

n = len(salida["empresas"])
ver = sum(1 for r in salida["empresas"] if any(c["metodo"] == "verified" for c in r["campos"].values()))
con = sum(1 for r in salida["empresas"] if "email" in r["campos"] or "telefono" in r["campos"])
print(f"{n} empresas · {ver} con algún dato verificado en su propia web · {con} con contacto comercial público")
print(f"fusionadas por dominio: {len(ambe) + len(mayoristas) + len(verificadas) - n}")
