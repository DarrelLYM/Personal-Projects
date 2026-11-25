#!/usr/bin/env python3
"""Builds data/foods.json for the calorie tracker from the source snapshots in scripts/foods/sources/.

Sources (each food keeps a tier and a source label):
  hpb.json            HPB Singapore Food Insights Database (SG FoodID). Official ("o").
  mcdonalds-sg.json   McDonald's Singapore nutrition facts (mcdonalds.com.sg). Official ("o").
  yakun-drinks.json   Ya Kun Nutrition Information Panel (per 100ml). Official ("o").
  estimates.json      Chains with no published data. Estimate ("e").

Run:  python3 scripts/foods/build.py
"""
import json, os, re, datetime

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, "sources")
OUT = os.path.join(HERE, "..", "..", "data", "foods.json")

def load(name):
    with open(os.path.join(SRC, name), encoding="utf-8") as f:
        return json.load(f)

def num(v):
    if v is None or v == -1 or v == "":
        return None
    try:
        v = float(v)
    except (TypeError, ValueError):
        return None
    return None if v < 0 else v

def r0(v): return None if v is None else int(round(v))
def r1(v): return None if v is None else round(v, 1)

CATEGORY = {
    "Grains and staples": "Rice, noodles & bread", "Meat and alternatives": "Meat", "Poultry": "Poultry",
    "Fish and seafood": "Seafood", "Dairy and eggs": "Dairy & eggs", "Nuts and legumes": "Nuts & beans",
    "Vegetables": "Vegetables", "Fruit": "Fruit", "Oils, seasonings and condiments": "Sauces & oils",
    "Snacks": "Snacks", "Desserts": "Desserts", "Sugar and confectionery": "Sweets", "Miscellaneous": "Others",
    "Mixed": "Mixed dishes", "Beverages": "Drinks",
}
ORDER = ["Restaurants", "Rice, noodles & bread", "Mixed dishes", "Poultry", "Meat", "Seafood", "Vegetables", "Drinks",
         "Snacks", "Desserts", "Fruit", "Dairy & eggs", "Nuts & beans", "Sweets", "Sauces & oils", "Others"]
BREAKFAST = re.compile(r"prata|thosai|dosa|porridge|congee|chee cheong|chwee|kaya|toast|you tiao|carrot cake|lor mee|"
                       r"bee hoon|nasi lemak|mee siam|mee rebus|popiah|soon kueh|png kueh|bread|bun\b|muffin|hotcake|"
                       r"pancake|egg|oat|cereal|idli|appam|putu|breakfast|bagel|croissant|hash ?brown", re.I)
RAW = re.compile(r"\b(uncooked|raw|flour|dried|powder|concentrate)\b", re.I)

PORTION = re.compile(r"([\d.]+)\s*([A-Za-z][A-Za-z ]*?)\(s\)\s*=\s*([\d.]+)\s*(g|ml)", re.I)

def portion_label(qty, unit, amount, u):
    q = float(qty)
    qs = ("%g" % q)
    word = unit.strip()
    if q != 1 and not word.endswith("s"):
        word += "s"
    return f"{qs} {word} ({'%g' % float(amount)}{u.lower()})"

def parse_portions(text):
    return [(portion_label(*m.groups()), float(m.group(3))) for m in PORTION.finditer(text or "")]

items = []
counts = {}

# ---------- HPB SG FoodID ----------
hpb = load("hpb.json")
for d in hpb["foods"]:
    n = d.get("calc") or {}
    kcal = num(n.get("energy"))
    if kcal is None or not d.get("name"):
        continue
    l1 = d.get("l1Category") or ""
    cat = CATEGORY.get(l1, "Others")
    l2 = d.get("l2Category") or ""
    portions = parse_portions(d.get("defaultPortion"))
    serving = portions[0][0] if portions else (f"{'%g' % d['defaultWeight']}g" if d.get("defaultWeight") else "1 serving")
    grams = d.get("defaultWeight") or (portions[0][1] if portions else 0)
    alt = [[lbl, g] for lbl, g in parse_portions(d.get("alternativePortions")) if lbl != serving]
    name = d["name"].strip()
    name = name[0].upper() + name[1:]
    if cat == "Drinks":
        kind = "alcohol" if d.get("groupName", "").startswith("Alcoholic") or re.search(r"beer|wine|spirit|liqueur|soju|sake|whisk|vodka|gin\b|rum\b", name, re.I) else "drink"
    elif RAW.search(name):
        kind = ""
    elif "dishes" in l2.lower() or cat == "Mixed dishes" or "dish" in l2.lower():
        kind = "meal"
    elif cat in ("Snacks", "Desserts"):
        kind = "snack"
    else:
        kind = ""
    how = {"Lab Analysis": "Lab analysis", "NIP": "Nutrition label", "Borrowed": "From another food database", "Derived": "Calculated from recipe"}.get(d.get("sourceOfData"), d.get("sourceOfData") or "")
    note = ", ".join(x for x in [how, str(d.get("yearOfData") or "")] if x)
    rec = {"i": "hpb-" + d["crId"], "n": name, "c": cat, "g": l2, "d": d.get("description") or "", "s": serving, "w": r1(num(grams)),
           "k": r0(kcal), "p": r1(num(n.get("protein"))), "cb": r1(num(n.get("carbohydrate"))), "f": r1(num(n.get("fat"))),
           "su": r1(num(n.get("sugar"))), "na": r0(num(n.get("sodium"))), "t": "o", "src": "hpb", "sn": note, "kd": kind}
    if kind == "meal" and BREAKFAST.search(name):
        rec["bf"] = 1
    if alt:
        rec["alt"] = alt
    items.append(rec)
counts["hpb"] = len(items)

# ---------- McDonald's Singapore ----------
mcd = load("mcdonalds-sg.json")
seen = set()
for x in mcd["items"]:
    nu = x["nutrients"]
    if "kcal" not in nu or x["name"] in seen:
        continue
    seen.add(x["name"])
    name = re.sub(r"[®™]", "", x["name"]).strip()
    low = name.lower()
    if re.search(r"sauce|dip|ketchup|dressing|syrup|sugar|creamer|butter|jam", low):
        kind = ""
    elif re.search(r"coke|sprite|fanta|frapp|coffee|latte|cappuccino|mocha|americano|tea|milo|juice|water|float|chocolate drink|milk", low) and "shake" not in low:
        kind = "drink"
    elif re.search(r"sundae|mcflurry|cone|pie|cookie|muffin \(|cake|brownie", low):
        kind = "snack"
    else:
        kind = "meal"
    slug = re.sub(r"[^a-z0-9]+", "-", low).strip("-")
    rec = {"i": "mcd-" + slug, "n": name, "b": "McDonald's", "c": "Restaurants", "g": "McDonald's", "s": "1 serving",
           "k": r0(nu.get("kcal")), "p": r1(nu.get("protein")), "cb": r1(nu.get("carbs")), "f": r1(nu.get("fat")),
           "su": r1(nu.get("sugar")), "na": r0(nu.get("sodium")), "t": "o", "src": "mcd", "sn": "As of " + (x.get("asOf") or "Dec 2023"), "kd": kind}
    if kind == "meal" and re.search(r"muffin|hotcake|breakfast|hash ?brown|scrambled|egg", low):
        rec["bf"] = 1
    items.append(rec)
counts["mcd"] = len(seen)

# ---------- Ya Kun drinks ----------
OZ_ML = {"6oz": 177, "8oz": 237, "12oz": 355, "16oz": 473, "22oz": 650}
WORDS = {"Coffee": "kopi", "Tea": "teh", "Yuan Yang": "cham kopi teh", "Ginger": "halia", "Barley": "barley", "Milo": "milo", "Horlicks": "horlicks"}
yk = load("yakun-drinks.json")
n_yk = 0
for x in yk["items"]:
    ml = OZ_ML.get(x.get("size") or "")
    if not ml:
        continue
    f = ml / 100.0
    name = x["name"].strip()
    temp = (x.get("temp") or "").lower()
    desc = " ".join(v for k, v in WORDS.items() if k in name)
    if re.search(r"\bC$", name): desc += " evaporated milk"
    if re.search(r"\bO$", name): desc += " black"
    rec = {"i": f"yk-{re.sub(r'[^a-z0-9]+', '-', name.lower())}-{x['size']}-{temp}-{x['sugarPct']}", "n": f"{name} ({x['size']}, {temp})", "b": "Ya Kun",
           "c": "Drinks", "g": "Ya Kun", "d": (desc + f" sugar % {x['sugarPct']}").strip(), "s": f"1 cup ({x['size']}, {ml}ml)", "w": ml,
           "k": r0(x["kcal"] * f), "p": r1(x.get("protein", 0) * f), "cb": r1(x.get("carbs", 0) * f), "f": r1(x.get("fat", 0) * f),
           "su": r1(x["sugar"] * f) if x.get("sugar") is not None else None, "na": None, "t": "o", "src": "yakun",
           "sn": f"Sugar {x['sugarPct']}% (Nutri-Grade {x.get('grade', '?')})", "kd": "drink"}
    items.append(rec); n_yk += 1
counts["yakun"] = n_yk

# ---------- Estimates ----------
est = load("estimates.json")
for x in est:
    name = x["name"]
    low = name.lower()
    kind = "drink" if re.search(r"tea|coffee|latte|cappuccino|americano|frappuccino|macchiato|milk", low) else "meal"
    items.append({"i": "est-" + re.sub(r"[^a-z0-9]+", "-", (x["brand"] + " " + name).lower()).strip("-"), "n": name, "b": x["brand"],
                  "c": "Restaurants", "g": x["brand"], "s": x["serving"], "k": r0(x["kcal"]), "p": r1(x.get("protein")),
                  "cb": r1(x.get("carbs")), "f": r1(x.get("fat")), "su": r1(x.get("sugar")), "na": r0(x.get("sodium")),
                  "t": "e", "src": "est", "sn": x.get("note", ""), "kd": kind})
counts["est"] = len(est)

# Drop empty fields to keep the file small.
for it in items:
    for k in [k for k, v in it.items() if v is None or v == "" or v == []]:
        del it[k]

cats = [c for c in ORDER if any(it["c"] == c for it in items)]
out = {
    "info": {"built": datetime.date.today().isoformat(), "hpbAccessed": hpb.get("accessed", ""), "mcdAsOf": mcd.get("asOf", "Dec 2023"),
             "counts": counts, "categories": cats},
    "sources": {
        "hpb": {"label": "HPB SG FoodID", "url": "https://pphtpc.hpb.gov.sg/web/sgfoodid"},
        "mcd": {"label": "McDonald's Singapore", "url": "https://www.mcdonalds.com.sg/nutrition-calculator"},
        "yakun": {"label": "Ya Kun nutrition panel", "url": "https://app.yakun.com/nutritional-information"},
        "est": {"label": "Estimate", "note": "No official data published"},
    },
    "items": items,
}
os.makedirs(os.path.dirname(OUT), exist_ok=True)
with open(OUT, "w", encoding="utf-8") as f:
    json.dump(out, f, ensure_ascii=False, separators=(",", ":"))
print("wrote", len(items), "foods", counts, "->", os.path.relpath(OUT))
