// Downloads every fuel station in the Republic of Ireland from OpenStreetMap
// (via the Overpass API) and writes them to stations.json.
// Run with Node 18 or newer:  node scripts/fetch-stations.mjs
import { writeFile } from "node:fs/promises";

const ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter"
];
const QUERY = `[out:json][timeout:120];
area["ISO3166-1"="IE"][admin_level=2]->.ie;
(node["amenity"="fuel"](area.ie);way["amenity"="fuel"](area.ie););
out center tags;`;

export function normalise(el) {
  const t = el.tags || {};
  const lat = el.lat ?? el.center?.lat;
  const lng = el.lon ?? el.center?.lon;
  if (lat == null || lng == null) return null;
  // Skip stations that only sell things a car driver can't use.
  if (t["fuel:diesel"] === "no" && t["fuel:octane_95"] === "no") return null;
  if (t.access === "private") return null;
  const brand = t.brand || t.operator || "";
  return {
    id: el.type[0] + el.id,
    name: t.name || brand || "Fuel station",
    brand,
    lat: +lat.toFixed(6),
    lng: +lng.toFixed(6),
    street: [t["addr:housenumber"], t["addr:street"]].filter(Boolean).join(" "),
    town: t["addr:city"] || t["addr:town"] || t["addr:village"] || t["addr:place"] || t["addr:suburb"] || "",
    county: t["addr:county"] || ""
  };
}

async function fetchFrom(url) {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": "PumpWatch-Ireland station list updater"
    },
    body: "data=" + encodeURIComponent(QUERY)
  });
  if (!res.ok) throw new Error(`${url} answered ${res.status}`);
  return res.json();
}

async function main() {
  let data, lastErr;
  for (const url of ENDPOINTS) {
    try { data = await fetchFrom(url); break; }
    catch (e) { lastErr = e; console.warn(e.message); }
  }
  if (!data) throw lastErr;

  const stations = data.elements.map(normalise).filter(Boolean)
    .sort((a, b) => a.id.localeCompare(b.id));
  if (stations.length < 200) {
    throw new Error(`Only ${stations.length} stations came back, which looks wrong. Keeping the old file.`);
  }
  const out = {
    updated: new Date().toISOString(),
    source: "© OpenStreetMap contributors, ODbL. https://www.openstreetmap.org/copyright",
    count: stations.length,
    stations
  };
  await writeFile(new URL("../stations.json", import.meta.url), JSON.stringify(out) + "\n");
  console.log(`Saved ${stations.length} stations to stations.json`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(e => { console.error(e.message); process.exit(1); });
}
