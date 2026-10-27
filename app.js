/* PumpWatch Ireland: stations from OpenStreetMap, prices from Supabase (or this browser in demo mode). */
(function(){
"use strict";

const CFG = Object.assign({staleAfterDays:3}, window.PUMPWATCH_CONFIG || {});
const STALE_MS = CFG.staleAfterDays * 864e5;
const FUELS = [
  {k:"petrol",      label:"Petrol"},
  {k:"petrol_plus", label:"Petrol Plus"},
  {k:"diesel",      label:"Diesel"},
  {k:"diesel_plus", label:"Diesel Plus"}];
const FUEL = Object.fromEntries(FUELS.map(f=>[f.k,f]));
const OVERPASS = ["https://overpass-api.de/api/interpreter","https://overpass.kumi.systems/api/interpreter"];
const OVERPASS_QUERY = `[out:json][timeout:120];
area["ISO3166-1"="IE"][admin_level=2]->.ie;
(node["amenity"="fuel"](area.ie);way["amenity"="fuel"](area.ie););
out center tags;`;

const $ = id => document.getElementById(id);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const ls = {
  get(k,d){ try{ const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; }catch(e){ return d; } },
  set(k,v){ try{ localStorage.setItem(k, JSON.stringify(v)); }catch(e){} }
};

const state = {
  fuel: FUEL[ls.get("pw.fuel")] ? ls.get("pw.fuel") : "petrol",
  stations: new Map(),   // id -> {id,name,brand,lat,lng,street,town,county,custom}
  latest: {},            // id -> fuel -> {price,source,at}
  recent: [],
  sel: null,
  view: "list",          // list | station | add
  pick: null,
  placing: false,
  q: ""
};

/* ---------------- price store ---------------- */
function supabaseStore(){
  const sb = window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseAnonKey);
  const row = r => ({station_id:r.station_id, fuel:r.fuel, price:Number(r.price), source:r.source, at:Date.parse(r.created_at)});
  return {
    shared: true,
    async latest(){
      const out = []; const size = 1000;
      for(let from = 0; ; from += size){
        const {data, error} = await sb.from("latest_prices").select("*").range(from, from + size - 1);
        if(error) throw error;
        out.push(...data.map(row));
        if(data.length < size) break;
      }
      return out;
    },
    async recent(n){
      const {data, error} = await sb.from("reports").select("*").order("created_at",{ascending:false}).limit(n);
      if(error) throw error; return data.map(row);
    },
    async report(rows){
      const {error} = await sb.from("reports").insert(rows.map(r => ({station_id:r.station_id, fuel:r.fuel, price:r.price, source:r.source})));
      if(error) throw error;
    },
    async customStations(){
      const {data, error} = await sb.from("custom_stations").select("*").limit(5000);
      if(error) throw error;
      return data.map(s => ({id:"c-"+s.id, name:s.name, town:s.town, lat:s.lat, lng:s.lng, custom:true}));
    },
    async addStation(s){
      const {data, error} = await sb.from("custom_stations").insert({name:s.name, town:s.town, lat:s.lat, lng:s.lng}).select().single();
      if(error) throw error;
      return {id:"c-"+data.id, name:data.name, town:data.town, lat:data.lat, lng:data.lng, custom:true};
    },
    subscribe(onReport, onStation){
      sb.channel("pumpwatch")
        .on("postgres_changes",{event:"INSERT",schema:"public",table:"reports"}, p => onReport(row(p.new)))
        .on("postgres_changes",{event:"INSERT",schema:"public",table:"custom_stations"}, p => onStation({id:"c-"+p.new.id, name:p.new.name, town:p.new.town, lat:p.new.lat, lng:p.new.lng, custom:true}))
        .subscribe();
    }
  };
}
function localStore(){
  const all = () => ls.get("pw.reports", []);
  return {
    shared: false,
    async latest(){
      const m = {};
      for(const r of all()){ const k = r.station_id+"|"+r.fuel; if(!m[k] || m[k].at < r.at) m[k] = r; }
      return Object.values(m);
    },
    async recent(n){ return all().sort((a,b)=>b.at-a.at).slice(0,n); },
    async report(rows){ const a = all(); const at = Date.now(); rows.forEach(r => a.push({...r, at})); ls.set("pw.reports", a.slice(-2000)); },
    async customStations(){ return ls.get("pw.custom", []); },
    async addStation(s){ const a = ls.get("pw.custom", []); const st = {...s, id:"c-"+Date.now().toString(36), custom:true}; a.push(st); ls.set("pw.custom", a); return st; },
    subscribe(){}
  };
}
const store = (CFG.supabaseUrl && CFG.supabaseAnonKey && window.supabase) ? supabaseStore() : localStore();
$("demoNotice").hidden = store.shared;

/* ---------------- stations from OpenStreetMap ---------------- */
function normalise(el){
  const t = el.tags || {};
  const lat = el.lat ?? el.center?.lat, lng = el.lon ?? el.center?.lon;
  if(lat == null || lng == null) return null;
  if(t["fuel:diesel"] === "no" && t["fuel:octane_95"] === "no") return null;
  if(t.access === "private") return null;
  const brand = t.brand || t.operator || "";
  return {
    id: el.type[0] + el.id,
    name: t.name || brand || "Fuel station",
    brand,
    lat: +lat.toFixed(6), lng: +lng.toFixed(6),
    street: [t["addr:housenumber"], t["addr:street"]].filter(Boolean).join(" "),
    town: t["addr:city"] || t["addr:town"] || t["addr:village"] || t["addr:place"] || t["addr:suburb"] || "",
    county: t["addr:county"] || ""
  };
}
async function loadOsmStations(){
  // 1. stations.json in the repo (kept fresh by the GitHub Action)
  try{
    const r = await fetch("stations.json", {cache:"no-cache"});
    if(r.ok){ const j = await r.json(); if(j.stations && j.stations.length) return {list:j.stations, updated:j.updated, from:"file"}; }
  }catch(e){}
  // 2. a copy saved in this browser in the last 7 days
  const cached = ls.get("pw.osm", null);
  if(cached && Date.now() - cached.at < 7*864e5 && cached.list?.length) return {list:cached.list, updated:new Date(cached.at).toISOString(), from:"cache"};
  // 3. ask OpenStreetMap's Overpass API directly
  for(const url of OVERPASS){
    try{
      const r = await fetch(url, {method:"POST", body:"data="+encodeURIComponent(OVERPASS_QUERY), headers:{"Content-Type":"application/x-www-form-urlencoded"}});
      if(!r.ok) continue;
      const j = await r.json();
      const list = j.elements.map(normalise).filter(Boolean);
      ls.set("pw.osm", {at:Date.now(), list});
      return {list, updated:new Date().toISOString(), from:"live"};
    }catch(e){}
  }
  return {list:cached?.list || [], updated:null, from:"none"};
}

/* ---------------- formatting ---------------- */
const MON = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
function when(ts){
  const d = new Date(ts), diff = Date.now() - ts;
  const hm = String(d.getHours()).padStart(2,"0") + ":" + String(d.getMinutes()).padStart(2,"0");
  let rel;
  if(diff < 6e4) rel = "just now";
  else if(diff < 36e5) rel = Math.round(diff/6e4) + " min ago";
  else if(diff < 864e5) rel = Math.round(diff/36e5) + " h ago";
  else { const n = Math.round(diff/864e5); rel = n === 1 ? "1 day ago" : n + " days ago"; }
  return {abs:`${d.getDate()} ${MON[d.getMonth()]} ${d.getFullYear()}, ${hm}`, rel, stale: diff > STALE_MS};
}
const fmt = p => Number(p).toFixed(1);
function parsePrice(v){
  v = String(v).trim().replace(",",".").replace(/[€c\s]/gi,"");
  if(!v) return null;
  let n = Number(v);
  if(!isFinite(n)) return NaN;
  if(n > 0.5 && n < 5) n *= 100;     // typed as euro per litre, e.g. 1.749
  n = Math.round(n*10)/10;
  return (n >= 80 && n <= 350) ? n : NaN;
}
const place = s => [s.street, s.town, s.county && !String(s.town).includes(s.county) ? "Co. "+s.county.replace(/^(County|Co\.?)\s+/i,"") : ""].filter(Boolean).join(", ");
const priceOf = (id, k = state.fuel) => state.latest[id]?.[k];

let bandFn = () => "mid";
function computeBands(){
  const vals = [];
  for(const id in state.latest){ const r = state.latest[id][state.fuel]; if(r && state.stations.has(id)) vals.push(r.price); }
  vals.sort((a,b)=>a-b);
  if(vals.length < 3){ bandFn = () => "mid"; return; }
  const lo = vals[Math.floor((vals.length-1)/3)], hi = vals[Math.ceil((vals.length-1)*2/3)];
  bandFn = p => p <= lo ? "cheap" : (p >= hi && hi > lo) ? "dear" : "mid";
}

/* ---------------- map ---------------- */
const map = L.map("map", {zoomControl:true, minZoom:6, maxBounds:[[50.8,-12.5],[56.2,-4.5]]}).setView([53.4,-7.9], 7);
L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
}).addTo(map);

const cluster = L.markerClusterGroup({
  maxClusterRadius: z => z < 9 ? 60 : 40,
  disableClusteringAtZoom: 13,
  showCoverageOnHover: false,
  chunkedLoading: true,
  iconCreateFunction(c){
    let best = null;
    for(const m of c.getAllChildMarkers()){ const r = priceOf(m.options.sid); if(r && (best === null || r.price < best)) best = r.price; }
    return L.divIcon({className:"clwrap", iconSize:[0,0],
      html:`<div class="cl"><b>${c.getChildCount()}</b>${best !== null ? `<span>from ${fmt(best)}</span>` : `<span style="color:var(--muted)">stations</span>`}</div>`});
  }
});
map.addLayer(cluster);
const markers = new Map();

function iconFor(id){
  const r = priceOf(id), sel = id === state.sel ? " sel" : "";
  if(!r) return L.divIcon({className:"tagwrap", iconSize:[0,0], html:`<div class="dot${sel}"></div>`});
  const old = Date.now() - r.at > STALE_MS ? " old" : "";
  return L.divIcon({className:"tagwrap", iconSize:[0,0], html:`<div class="tag ${bandFn(r.price)}${old}${sel}">${fmt(r.price)}</div>`});
}
function markerFor(s){
  const m = L.marker([s.lat, s.lng], {icon:iconFor(s.id), sid:s.id, title:s.name, keyboard:true});
  m.on("click", () => select(s.id));
  markers.set(s.id, m);
  return m;
}
function rebuildMarkers(){
  computeBands();
  cluster.clearLayers(); markers.clear();
  cluster.addLayers([...state.stations.values()].map(markerFor));
}
function refreshMarker(id){
  const m = markers.get(id); if(!m) return;
  m.setIcon(iconFor(id)); cluster.refreshClusters(m);
}

let pickMarker = null;
map.on("click", e => {
  if(!state.placing) return;
  state.pick = {lat:+e.latlng.lat.toFixed(6), lng:+e.latlng.lng.toFixed(6)};
  state.placing = false;
  document.querySelector(".map-wrap").classList.remove("placing");
  $("placeHint").hidden = true;
  if(pickMarker) pickMarker.remove();
  pickMarker = L.marker(e.latlng, {icon:L.divIcon({className:"tagwrap", iconSize:[0,0], html:'<div class="pick"></div>'})}).addTo(map);
  const spot = $("aSpot"); if(spot) spot.textContent = "Location set. Tap “Pick on map” again to move it.";
});
map.on("moveend", () => { if(state.view === "list" && !state.q) renderList(); });

/* ---------------- fuel switch ---------------- */
function renderFuels(){
  $("fuels").innerHTML = FUELS.map(f => `<button class="fuel-btn" type="button" data-k="${f.k}" aria-pressed="${f.k===state.fuel}">${f.label}</button>`).join("");
}
$("fuels").addEventListener("click", e => {
  const b = e.target.closest(".fuel-btn"); if(!b) return;
  state.fuel = b.dataset.k; ls.set("pw.fuel", state.fuel);
  renderFuels(); rebuildMarkers(); render();
});

/* ---------------- side panel ---------------- */
function render(){
  if(state.view === "station") renderStation();
  else if(state.view === "add") renderAdd();
  else renderList();
}

function renderList(){
  const v = $("view");
  if(!v.querySelector("#listCard")){
    v.innerHTML = `<section class="card" id="listCard">
      <div class="row"><div><div class="eyebrow" id="lEye"></div><h2 id="lTitle"></h2></div>
        <button class="btn primary" type="button" id="addBtn">Add a missing station</button></div>
      <div class="search"><input type="search" id="q" placeholder="Search station, brand or town" aria-label="Search stations">
        <button class="btn" type="button" id="nearBtn">Near me</button></div>
      <ul class="list" id="list"></ul></section>`;
    $("q").value = state.q;
    $("q").addEventListener("input", e => { state.q = e.target.value; renderList(); });
    $("addBtn").onclick = () => { state.view = "add"; state.pick = null; render(); };
    $("nearBtn").onclick = nearMe;
    $("list").addEventListener("click", e => { const b = e.target.closest(".st"); if(b) select(b.dataset.id, true); });
  }
  const q = state.q.trim().toLowerCase();
  let rows, title, eye;
  if(q){
    rows = [...state.stations.values()].filter(s => (s.name+" "+s.brand+" "+s.town+" "+s.county+" "+s.street).toLowerCase().includes(q));
    eye = `${rows.length} match${rows.length===1?"":"es"}`; title = `Search results`;
  } else {
    const b = map.getBounds();
    rows = [...state.stations.values()].filter(s => b.contains([s.lat, s.lng]));
    eye = `${rows.length} station${rows.length===1?"":"s"} on the map`;
    title = `Cheapest ${FUEL[state.fuel].label.toLowerCase()} in view`;
  }
  rows.sort((a,b) => (priceOf(a.id)?.price ?? 1e9) - (priceOf(b.id)?.price ?? 1e9) || a.name.localeCompare(b.name));
  $("lEye").textContent = eye; $("lTitle").textContent = title;
  const priced = rows.filter(s => priceOf(s.id)).length;
  const shown = rows.slice(0, 40);
  if(!state.stations.size){ $("list").innerHTML = `<li class="muted" style="padding:10px 2px">Loading stations from OpenStreetMap…</li>`; return; }
  if(!rows.length){ $("list").innerHTML = `<li class="muted" style="padding:10px 2px">${q ? "No stations match that search." : "No stations in this part of the map. Zoom out or move the map."}</li>`; return; }
  $("list").innerHTML = shown.map(s => {
    const r = priceOf(s.id), w = r ? when(r.at) : null;
    return `<li><button class="st" type="button" data-id="${esc(s.id)}">
      <span style="min-width:0"><span class="st-name">${esc(s.name)}</span>
      <span class="st-meta">${esc(place(s) || "Location on map")}${w ? ` · updated ${w.rel}${w.stale ? " (may be out of date)" : ""}` : ""}</span></span>
      <span class="chip ${r ? bandFn(r.price) : "none"}">${r ? fmt(r.price) : "No price yet"}</span></button></li>`;
  }).join("") + (rows.length > shown.length ? `<li class="muted" style="padding:9px 2px;font-size:.85rem">${rows.length - shown.length} more. Zoom in or search to narrow down.</li>` : "")
    + (!q && priced === 0 ? `<li class="muted" style="padding:9px 2px;font-size:.85rem">No prices posted around here yet. Tap a station to post today's price.</li>` : "");
}

function select(id, fly){
  const prev = state.sel; state.sel = id; state.view = "station";
  if(prev) refreshMarker(prev);
  refreshMarker(id);
  const s = state.stations.get(id);
  if(s && fly) map.setView([s.lat, s.lng], Math.max(map.getZoom(), 14));
  renderStation();
  if(window.innerWidth <= 860) $("view").scrollIntoView({behavior:"smooth", block:"start"});
}

function renderStation(){
  const s = state.stations.get(state.sel), v = $("view");
  if(!s){ state.view = "list"; v.innerHTML = ""; renderList(); return; }
  const keep = {}; FUELS.forEach(f => { const i = $("u_"+f.k); if(i) keep[f.k] = i.value; });
  const keepSrc = document.querySelector('input[name="uSrc"]:checked')?.value;
  const same = v.dataset.sid === s.id; v.dataset.sid = s.id;
  const grades = FUELS.map(f => {
    const r = priceOf(s.id, f.k), w = r ? when(r.at) : null;
    return `<div class="grade"><div class="gname">${f.label}</div>
      <div class="led${r ? "" : " empty"}">${r ? fmt(r.price)+"<sup>c/L</sup>" : "---.-"}</div>
      <div class="gwhen${w && w.stale ? " stale" : ""}">${w ? `Updated ${w.abs} · ${w.rel}<span class="src ${r.source}">${r.source === "owner" ? "Station" : "Driver"}</span>` : "No price posted yet"}</div></div>`;
  }).join("");
  const osm = s.custom ? `https://www.openstreetmap.org/?mlat=${s.lat}&mlon=${s.lng}#map=18/${s.lat}/${s.lng}`
    : `https://www.openstreetmap.org/${({n:"node",w:"way",r:"relation"})[s.id[0]]}/${s.id.slice(1)}`;
  v.innerHTML = `<div class="board">
      <div class="row" style="align-items:flex-start"><div style="min-width:0">
        <div class="bname">${esc(s.name)}</div><div class="baddr">${esc(place(s) || (s.brand ? s.brand : ""))}</div></div>
        <button class="btn" type="button" id="back">Back to list</button></div>
      <div class="grades">${grades}</div>
      <a class="osm-link" href="${osm}" target="_blank" rel="noopener">View on OpenStreetMap ↗</a>
    </div>
    <section class="card">
      <h3>Post today's prices</h3>
      <form id="uForm" novalidate>
        <div class="fgrid">${FUELS.map(f => `<label>${f.label}<input type="text" inputmode="decimal" id="u_${f.k}" autocomplete="off" placeholder="${priceOf(s.id,f.k) ? fmt(priceOf(s.id,f.k).price) : "e.g. 174.9"}"></label>`).join("")}</div>
        <div class="muted" style="font-size:.8rem">Cent per litre, as shown on the forecourt sign. Leave a grade blank if you didn't see it.</div>
        <div class="seg" role="radiogroup" aria-label="Who is posting">
          <label><input type="radio" name="uSrc" value="driver" checked> I'm a driver</label>
          <label><input type="radio" name="uSrc" value="owner"> I run this station</label></div>
        <div class="err" id="uErr" role="alert"></div>
        <button class="btn primary" type="submit" id="uSave">Post prices</button>
      </form>
    </section>`;
  if(same){ FUELS.forEach(f => { const i = $("u_"+f.k); if(i && keep[f.k]) i.value = keep[f.k]; });
    if(keepSrc){ const r = document.querySelector(`input[name="uSrc"][value="${keepSrc}"]`); if(r) r.checked = true; } }
  $("back").onclick = () => { const id = state.sel; state.sel = null; state.view = "list"; refreshMarker(id); $("view").innerHTML = ""; delete $("view").dataset.sid; renderList(); };
  $("uForm").addEventListener("submit", e => { e.preventDefault(); postPrices(s); });
}

const lastPost = {};
async function postPrices(s){
  const err = $("uErr"); err.textContent = "";
  const src = document.querySelector('input[name="uSrc"]:checked').value;
  const rows = [];
  for(const f of FUELS){
    const p = parsePrice($("u_"+f.k).value);
    if(p === null) continue;
    if(Number.isNaN(p)){ err.textContent = `${f.label}: enter cent per litre, like 174.9 (or 1.749).`; return; }
    rows.push({station_id:s.id, fuel:f.k, price:p, source:src});
  }
  if(!rows.length){ err.textContent = "Enter at least one price."; return; }
  if(lastPost[s.id] && Date.now() - lastPost[s.id] < 60e3){ err.textContent = "You just posted here. Wait a minute before posting again."; return; }
  $("uSave").disabled = true;
  try{
    await store.report(rows);
    lastPost[s.id] = Date.now();
    const at = Date.now();
    rows.forEach(r => applyReport({...r, at}));
    state.recent.unshift(...rows.map(r => ({...r, at})));
    FUELS.forEach(f => { const i = $("u_"+f.k); if(i) i.value = ""; });
    toast("Prices posted. Thanks!");
    renderStation(); renderFeed();
  }catch(e){
    err.textContent = "Couldn't save the prices. Check your connection and try again.";
    console.error(e);
  }finally{ const b = $("uSave"); if(b) b.disabled = false; }
}
function applyReport(r){
  const cur = state.latest[r.station_id]?.[r.fuel];
  if(cur && cur.at > r.at) return false;
  (state.latest[r.station_id] ||= {})[r.fuel] = {price:r.price, source:r.source, at:r.at};
  if(r.fuel === state.fuel){ computeBands(); refreshMarker(r.station_id); }
  return true;
}

function renderAdd(){
  const v = $("view"); delete v.dataset.sid;
  v.innerHTML = `<section class="card">
    <div class="row"><h2>Add a missing station</h2><button class="btn link" type="button" id="aCancel">Cancel</button></div>
    <p class="muted" style="margin:6px 0 0;font-size:.88rem">Most stations come from OpenStreetMap already. Search first, then add one here only if it's missing.</p>
    <form id="aForm" novalidate>
      <label>Station name<input type="text" id="aName" maxlength="80" placeholder="e.g. Main Street Service Station"></label>
      <label>Town<input type="text" id="aTown" maxlength="60" placeholder="e.g. Naas"></label>
      <div><button class="btn" type="button" id="aPick">Pick on map</button>
        <div class="muted" id="aSpot" style="font-size:.82rem;margin-top:6px">${state.pick ? "Location set." : "Zoom in close, then tap the station's spot on the map."}</div></div>
      <div class="err" id="aErr" role="alert"></div>
      <button class="btn primary" type="submit" id="aSave">Add station</button>
    </form></section>`;
  $("aCancel").onclick = () => { endPlacing(); state.view = "list"; v.innerHTML = ""; renderList(); };
  $("aPick").onclick = () => {
    state.placing = true; document.querySelector(".map-wrap").classList.add("placing"); $("placeHint").hidden = false;
    if(window.innerWidth <= 860) $("map").scrollIntoView({behavior:"smooth", block:"start"});
  };
  $("aForm").addEventListener("submit", async e => {
    e.preventDefault(); const err = $("aErr"); err.textContent = "";
    const name = $("aName").value.trim(), town = $("aTown").value.trim();
    if(!name){ err.textContent = "Give the station a name."; return; }
    if(!town){ err.textContent = "Add the town it's in."; return; }
    if(!state.pick){ err.textContent = "Tap “Pick on map” and mark where the station is."; return; }
    $("aSave").disabled = true;
    try{
      const s = await store.addStation({name, town, lat:state.pick.lat, lng:state.pick.lng});
      addStation(s); endPlacing(); toast("Station added"); select(s.id);
    }catch(e2){ err.textContent = "Couldn't add the station. Check your connection and try again."; console.error(e2); }
    finally{ const b = $("aSave"); if(b) b.disabled = false; }
  });
}
function endPlacing(){
  state.placing = false; state.pick = null; $("placeHint").hidden = true;
  document.querySelector(".map-wrap").classList.remove("placing");
  if(pickMarker){ pickMarker.remove(); pickMarker = null; }
}
function addStation(s){
  if(state.stations.has(s.id)) return;
  s = {brand:"", street:"", county:"", ...s};
  state.stations.set(s.id, s);
  cluster.addLayer(markerFor(s));
}

function nearMe(){
  if(!navigator.geolocation){ toast("Your browser can't share your location."); return; }
  navigator.geolocation.getCurrentPosition(
    p => { map.setView([p.coords.latitude, p.coords.longitude], 12); if(window.innerWidth <= 860) $("map").scrollIntoView({behavior:"smooth"}); },
    () => toast("Location is turned off. Search for your town instead."),
    {timeout:10000, maximumAge:300000});
}

function renderFeed(){
  const ul = $("feed");
  // group reports posted together into one line
  const groups = [];
  for(const r of state.recent.slice(0, 60)){
    const g = groups[groups.length-1];
    if(g && g.station_id === r.station_id && Math.abs(g.at - r.at) < 120e3 && g.source === r.source) g.prices[r.fuel] = r.price;
    else groups.push({station_id:r.station_id, at:r.at, source:r.source, prices:{[r.fuel]:r.price}});
  }
  const shown = groups.filter(g => state.stations.has(g.station_id)).slice(0, 10);
  if(!shown.length){ ul.innerHTML = `<li class="muted" style="display:block">Price updates will appear here as people post them.</li>`; return; }
  ul.innerHTML = shown.map(g => {
    const s = state.stations.get(g.station_id), w = when(g.at);
    const ps = FUELS.filter(f => g.prices[f.k] != null).map(f => `${f.label} ${fmt(g.prices[f.k])}`).join(" · ");
    return `<li><span><a href="#" data-id="${esc(s.id)}"><strong>${esc(s.name)}</strong></a>${s.town ? ", "+esc(s.town) : ""}<span class="src ${g.source}">${g.source === "owner" ? "Station" : "Driver"}</span></span>
      <span class="when">${w.rel}</span><span class="what">${esc(ps)}</span></li>`;
  }).join("");
}
$("feed").addEventListener("click", e => { const a = e.target.closest("a[data-id]"); if(a){ e.preventDefault(); select(a.dataset.id, true); } });

let tt;
function toast(m){ const t = $("toast"); t.textContent = m; t.hidden = false; clearTimeout(tt); tt = setTimeout(() => t.hidden = true, 2800); }

/* ---------------- start ---------------- */
async function start(){
  renderFuels(); render(); renderFeed();
  const [osm, custom, latest, recent] = await Promise.all([
    loadOsmStations(),
    store.customStations().catch(e => { console.error(e); return []; }),
    store.latest().catch(e => { console.error(e); toast("Couldn't load prices. Showing stations only."); return []; }),
    store.recent(60).catch(() => [])
  ]);
  for(const s of osm.list) state.stations.set(s.id, s);
  for(const s of custom) state.stations.set(s.id, {brand:"", street:"", county:"", ...s});
  for(const r of latest) (state.latest[r.station_id] ||= {})[r.fuel] = {price:r.price, source:r.source, at:r.at};
  state.recent = recent;
  rebuildMarkers(); render(); renderFeed();

  const status = $("mapStatus");
  if(osm.from === "none" && !osm.list.length){
    status.textContent = "Couldn't reach OpenStreetMap to load stations. Refresh to try again.";
  } else {
    const d = osm.updated ? new Date(osm.updated) : null;
    status.textContent = `${state.stations.size.toLocaleString("en-IE")} stations` + (d ? ` · station list updated ${d.getDate()} ${MON[d.getMonth()]} ${d.getFullYear()}` : "");
  }

  store.subscribe(
    r => {
      const dup = state.recent.some(x => x.station_id === r.station_id && x.fuel === r.fuel && x.price === r.price && x.source === r.source && Math.abs(x.at - r.at) < 120e3);
      if(applyReport(r) && !dup){ state.recent.unshift(r); renderFeed(); if(state.view === "station" && state.sel === r.station_id) renderStation(); else if(state.view === "list") renderList(); } },
    s => { addStation(s); }
  );
  setInterval(() => { if(!document.hidden){ renderFeed(); if(state.view === "list") renderList(); } }, 60000);
}
start();
})();
