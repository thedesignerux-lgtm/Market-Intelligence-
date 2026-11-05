"""Mide cuántos vendedores reales hay en los extractos de OSM y cuántos descarta hoy el importador."""
import json, sys, collections

# Reglas actuales (tabla category_mappings, fuente osm). Primer par = filtro osmium; todos deben cumplirse.
MAPPINGS = [
    ({"shop": "wholesale", "wholesale": "bicycle"}, "distribuidor.ciclismo", "distribuidor"),
    ({"service:bicycle:repair": "yes"}, "servicio.ciclismo.taller", "comercio"),
    ({"service:bicycle:retail": "yes"}, "comercio.deporte.ciclismo", "comercio"),
    ({"craft": "bicycle"}, "servicio.ciclismo.taller", "comercio"),
    ({"shop": "sports", "sport": "cycling"}, "comercio.deporte.ciclismo", "comercio"),
    ({"club": "sport", "sport": "cycling"}, "club.deportivo.ciclismo", "club"),
    ({"shop": "bicycle"}, "comercio.deporte.ciclismo", "comercio"),
]
# Lo que hoy entra al filtro osmium (solo el primer par de cada regla).
CURRENT_FILTER = {("shop", "wholesale"), ("service:bicycle:repair", "yes"), ("service:bicycle:retail", "yes"),
                  ("craft", "bicycle"), ("shop", "sports"), ("club", "sport"), ("shop", "bicycle")}


def matches(tags, rule):
    return all(tags.get(k) == v for k, v in rule.items())


def in_current_filter(tags):
    return any(tags.get(k) == v for k, v in CURRENT_FILTER)


def analyse(path, label):
    kept, skipped, outside = [], [], []
    for line in open(path, encoding="utf-8"):
        line = line.lstrip("\x1e").strip()
        if not line:
            continue
        f = json.loads(line)
        tags = f.get("properties", {})
        if not tags.get("name"):
            continue  # el importador descarta lo que no tiene nombre
        if any(matches(tags, r) for r, _, _ in MAPPINGS):
            kept.append(tags)
        elif in_current_filter(tags):
            skipped.append(tags)   # entra al filtro pero ninguna regla lo clasifica → "skipped_no_category"
        else:
            outside.append(tags)   # ni siquiera entra al filtro actual

    print(f"\n{'='*64}\n{label}\n{'='*64}")
    print(f"Se incorporan hoy          : {len(kept)}")
    print(f"Descartados sin categoría  : {len(skipped)}")
    print(f"Fuera del filtro actual    : {len(outside)}")

    print(f"\n-- Qué se incorpora hoy, por etiqueta --")
    for tag, n in collections.Counter(
        f"shop={t.get('shop')}" if t.get("shop") else
        f"craft={t.get('craft')}" if t.get("craft") else
        f"club={t.get('club')}" if t.get("club") else "otro" for t in kept
    ).most_common():
        print(f"   {tag:<34} {n}")

    print(f"\n-- Descartados sin categoría, por etiqueta --")
    for tag, n in collections.Counter(
        f"shop={t.get('shop')}" + (f" + sport={t['sport']}" if t.get("sport") else "") if t.get("shop") else
        f"club={t.get('club')}" + (f" + sport={t['sport']}" if t.get("sport") else "") if t.get("club") else "otro"
        for t in skipped
    ).most_common(12):
        print(f"   {tag:<34} {n}")

    # ¿Cuántos de los descartados venden bici de verdad, según otras etiquetas?
    señales = [t for t in skipped if any(k.startswith("service:bicycle") for k in t)
               or t.get("sport") in ("cycling", "bicycle") or "bicycle" in (t.get("shop") or "")]
    print(f"\n   de los cuales con señal explícita de bicicleta: {len(señales)}")
    for t in señales[:8]:
        sig = ", ".join(f"{k}={v}" for k, v in t.items() if k.startswith("service:bicycle") or k in ("shop", "sport"))
        print(f"     · {t['name'][:42]:<42} {sig[:70]}")

    # Contactabilidad de lo que se incorpora: es el cuello de botella comercial.
    con_tel = sum(1 for t in kept if t.get("phone") or t.get("contact:phone"))
    con_web = sum(1 for t in kept if t.get("website") or t.get("contact:website"))
    con_mail = sum(1 for t in kept if t.get("email") or t.get("contact:email"))
    con_algo = sum(1 for t in kept if any(t.get(k) for k in
                   ("phone", "contact:phone", "website", "contact:website", "email", "contact:email")))
    print(f"\n-- Contactabilidad de lo que se incorpora ({len(kept)}) --")
    print(f"   teléfono {con_tel} · web {con_web} · email {con_mail} · con algún canal {con_algo}"
          f" ({round(100*con_algo/max(len(kept),1))}%)")
    return kept, skipped, outside


total = {}
for path, label in [("/tmp/osm-analisis/comunidad_de_madrid.geojsonseq", "MADRID"),
                    ("/tmp/osm-analisis/barcelona.geojsonseq", "BARCELONA")]:
    total[label] = analyse(path, label)

k = sum(len(v[0]) for v in total.values())
s = sum(len(v[1]) for v in total.values())
print(f"\n{'='*64}\nTOTAL Madrid + Barcelona: {k} entidades nuevas con las reglas actuales, {s} descartadas\n{'='*64}")
