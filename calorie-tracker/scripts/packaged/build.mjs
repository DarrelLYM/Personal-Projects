// Builds data/packaged.json: packaged foods sold in Singapore from Open Food Facts
// (https://world.openfoodfacts.org, data licence ODbL: https://opendatacommons.org/licenses/odbl/1-0/).
// Run weekly by .github/workflows/packaged-foods.yml. No dependencies (Node 18+).
// Keeps products with a name and energy, protein, carbs and fat values (sugar and sodium may be missing).
// If the download is cut short, it keeps the previous file unless the new one is at least 70% as big.
import { writeFileSync, readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const OUT = fileURLToPath(new URL("../../data/packaged.json", import.meta.url));
const UA = "GracesCalorieTracker/1.0 (personal app; https://github.com/DarrelLYM/Personal-Projects)";
const FIELDS = "code,product_name,product_name_en,brands,serving_size,serving_quantity,nutriments,last_modified_t";
const PAGE_SIZE = 1000;
const PAUSE_MS = 7000; // Open Food Facts asks for at most ~10 search requests a minute
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const n = (v) => (v === undefined || v === null || v === "" || Number.isNaN(Number(v)) ? null : Number(v));
const r1 = (v) => Math.round(v * 10) / 10;

async function page(p) {
  const url = `https://world.openfoodfacts.org/api/v2/search?countries_tags_en=singapore&fields=${FIELDS}&page_size=${PAGE_SIZE}&page=${p}`;
  for (let i = 0; i < 4; i++) {
    try {
      const res = await fetch(url, { headers: { "User-Agent": UA } });
      if (res.ok) return await res.json();
      console.warn(`page ${p}: HTTP ${res.status}`);
    } catch (e) { console.warn(`page ${p}: ${e.message}`); }
    await sleep(20000 * (i + 1));
  }
  return null;
}

const items = [];
const seen = new Set();
let p = 1, total = Infinity;
while ((p - 1) * PAGE_SIZE < total) {
  const d = await page(p);
  if (!d) { console.warn(`Stopping early: page ${p} kept failing.`); break; }
  total = d.count ?? 0;
  for (const x of d.products || []) {
    const nm = x.nutriments || {};
    let kcal = n(nm["energy-kcal_100g"]);
    if (kcal == null && n(nm["energy_100g"]) != null) kcal = n(nm["energy_100g"]) / 4.184;
    const protein = n(nm.proteins_100g), carbs = n(nm.carbohydrates_100g), fat = n(nm.fat_100g), sugar = n(nm.sugars_100g);
    const name = String(x.product_name_en || x.product_name || "").trim();
    if (!name || !x.code || seen.has(x.code)) continue;
    if ([kcal, protein, carbs, fat].some((v) => v == null || v < 0) || (sugar != null && (sugar < 0 || sugar > carbs + 0.5)) || kcal > 950 || protein + carbs + fat > 105) continue;
    seen.add(x.code);
    const sodium = n(nm.sodium_100g);
    const sq = n(x.serving_quantity);
    items.push([
      String(x.code),
      name.slice(0, 90),
      String(x.brands || "").split(",")[0].trim().slice(0, 40),
      sq && sq > 0 && sq < 2000 ? String(x.serving_size || `${sq} g`).slice(0, 40) : "",
      sq && sq > 0 && sq < 2000 ? r1(sq) : 0,
      Math.round(kcal), r1(protein), r1(carbs), r1(fat), sugar == null ? null : r1(sugar), sodium == null ? null : Math.round(sodium * 1000),
    ]);
  }
  console.log(`page ${p}: kept ${items.length} of ~${Math.min(p * PAGE_SIZE, total)} scanned (total ${total})`);
  p++;
  if ((p - 1) * PAGE_SIZE < total) await sleep(PAUSE_MS);
}
items.sort((a, b) => a[1].localeCompare(b[1]));
if (existsSync(OUT)) {
  const prev = JSON.parse(readFileSync(OUT, "utf8")).items?.length || 0;
  if (items.length < prev * 0.7) { console.log(`Only got ${items.length} products (previously ${prev}); keeping the previous file.`); process.exit(0); }
}
if (!items.length) { console.log("Nothing downloaded; not writing."); process.exit(0); }
writeFileSync(OUT, JSON.stringify({
  source: "Open Food Facts (openfoodfacts.org), products sold in Singapore. Licence: ODbL.",
  fields: ["barcode", "name", "brand", "serving", "servingGrams", "kcal100", "protein100", "carbs100", "fat100", "sugar100", "sodiumMg100"],
  updated: new Date().toISOString().slice(0, 10),
  items,
}));
console.log(`Wrote ${items.length} products to data/packaged.json`);
