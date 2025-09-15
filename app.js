/* Macro Tracker v1.1.1 */
const APP_VERSION = "v1.1.1";
const STORAGE_KEY = "macro-tracker:data";          // wrapped with schema
const UNDO_STACK_KEY = "macro-tracker:undoStack";  // array
const REDO_STACK_KEY = "macro-tracker:redoStack";
const SETTINGS_KEY = "macro-tracker:settings";
const PRESETS_KEY = "macro-tracker:presets";
const SCHEMA_VERSION = 2; // v1.1.1 schema

const $ = s => document.querySelector(s);
const $$ = s => Array.from(document.querySelectorAll(s));
const todayISO = () => new Date().toISOString().slice(0,10);
const clamp = (n, min, max) => Math.min(Math.max(n, min), max);

// ----- Settings -----
function defaultSettings(){
  return {targets:{cal:2000,p:150,c:200,f:70}, theme:"auto", showRemaining:false};
}
function loadSettings(){
  try { return JSON.parse(localStorage.getItem(SETTINGS_KEY)) || defaultSettings(); }
  catch(e){ return defaultSettings(); }
}
function saveSettings(s){ localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); }
function applyTheme(){
  const s = loadSettings();
  document.documentElement.removeAttribute("data-theme");
  if(s.theme === "light") document.documentElement.setAttribute("data-theme","light");
  else if(s.theme === "dark") document.documentElement.setAttribute("data-theme","dark");
}

// ----- Data layer with schema wrapper -----
function loadRaw(){
  try{
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
  }catch(e){ return null; }
}
function loadMeals(){
  const raw = loadRaw();
  if(!raw){ return []; }
  if(raw.schemaVersion !== SCHEMA_VERSION){
    // migrate if older {meals:[]}|[]
    if(Array.isArray(raw)){ // legacy v1.0.0
      const migrated = { schemaVersion: SCHEMA_VERSION, meals: raw };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(migrated));
      return migrated.meals;
    }
    if(raw.meals){
      raw.schemaVersion = SCHEMA_VERSION;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(raw));
      return raw.meals;
    }
    return [];
  }
  return raw.meals || [];
}
function saveMeals(meals){
  const wrapped = { schemaVersion: SCHEMA_VERSION, meals };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(wrapped));
}

// Undo/Redo stacks
function pushStack(key, action){
  const arr = JSON.parse(localStorage.getItem(key) || "[]");
  arr.unshift(action);
  localStorage.setItem(key, JSON.stringify(arr.slice(0, 20)));
}
function popStack(key){
  const arr = JSON.parse(localStorage.getItem(key) || "[]");
  const item = arr.shift();
  localStorage.setItem(key, JSON.stringify(arr));
  return item;
}
function clearStack(key){ localStorage.removeItem(key); }

// ----- Helpers -----
function computeTotals(mealsForDay){
  return mealsForDay.reduce((acc, m)=>{
    acc.cal+= Number(m.calories)||0;
    acc.p+= Number(m.protein)||0;
    acc.c+= Number(m.carbs)||0;
    acc.f+= Number(m.fat)||0;
    return acc;
  }, {cal:0,p:0,c:0,f:0});
}
function escapeHtml(str){
  return (""+str).replace(/[&<>"']/g, s => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#039;"}[s]));
}
function isoShift(dateISO, days){ const d=new Date(dateISO); d.setDate(d.getDate()+days); return d.toISOString().slice(0,10); }
function kcalFromMacros(m){ return (Number(m.protein)||0)*4 + (Number(m.carbs)||0)*4 + (Number(m.fat)||0)*9; }

// ----- Rendering -----
function render(){
  const meals = loadMeals();
  const filterDate = $("#filterDate").value || todayISO();
  const filtered = meals.filter(m => m.date === filterDate);
  // KPIs + progress
  const t = computeTotals(filtered);
  const s = loadSettings();
  const tgt = s.targets;
  const pairs = [
    ["kpiCal", t.cal, tgt.cal],
    ["kpiP",   t.p,   tgt.p],
    ["kpiC",   t.c,   tgt.c],
    ["kpiF",   t.f,   tgt.f]
  ];
  pairs.forEach(([id,val,target])=>{
    const el = document.getElementById(id);
    const valueToShow = s.showRemaining ? Math.max(target - val, 0) : val;
    el.textContent = (s.showRemaining ? Math.max(target - val, 0) : val).toFixed(0);
    const pct = Math.max(0, Math.min(1, target ? (val/target) : 0));
    el.parentElement.style.setProperty("--pct", pct);
    el.parentElement.classList.toggle("hit", target && val >= target);
  });

  // table
  const tbody = $("#tbody"); tbody.innerHTML = "";
  filtered.forEach(m => {
    const macrosKcal = kcalFromMacros(m);
    const mismatch = m.calories ? Math.abs(m.calories - macrosKcal) : 0;
    const mismatchHint = (mismatch > 30) ? `<div class="hint warn">⚖︎ Macros ≈ ${macrosKcal} kcal</div>` : "";
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>
        <span class="badge">${m.meal || "-"}</span>
        <div class="small">${escapeHtml(m.category||"")} ${escapeHtml(m.time||"")}</div>
        <div class="small">${m.notes?escapeHtml(m.notes):""}</div>
      </td>
      <td>${m.calories ?? ""}${mismatchHint}</td>
      <td>${m.protein ?? ""}</td>
      <td>${m.carbs ?? ""}</td>
      <td>${m.fat ?? ""}</td>
      <td class="actions">
        <button class="btn-secondary" data-edit="${m.id}">Edit</button>
        <button class="btn-danger" data-del="${m.id}">Delete</button>
      </td>
    `;
    tbody.appendChild(tr);
  });
  $$("button[data-del]").forEach(b => b.onclick = onDelete);
  $$("button[data-edit]").forEach(b => b.onclick = onEdit);

  // presets
  renderPresets();
  // redo/undo buttons
  $("#undoBtn").disabled = !(JSON.parse(localStorage.getItem(UNDO_STACK_KEY)||"[]").length);
  $("#redoBtn").disabled = !(JSON.parse(localStorage.getItem(REDO_STACK_KEY)||"[]").length);

  // rollups
  renderRollups();
}

function renderRollups(){
  const meals = loadMeals();
  const date = $("#filterDate").value || todayISO();
  const d7 = [], d30 = [];
  for(let i=0;i<7;i++){ d7.push(isoShift(date, -i)); }
  for(let i=0;i<30;i++){ d30.push(isoShift(date, -i)); }
  const sumOn = (dates) => computeTotals(meals.filter(m => dates.includes(m.date)));
  const t7 = sumOn(d7), t30=sumOn(d30);
  const avg = (t, n) => ({cal:t.cal/n, p:t.p/n, c:t.c/n, f:t.f/n});
  const a7 = avg(t7,7), a30=avg(t30,30);
  $("#roll7").textContent = `7-day Totals: Cal ${t7.cal.toFixed(0)}, P ${t7.p.toFixed(0)}, C ${t7.c.toFixed(0)}, F ${t7.f.toFixed(0)} | Avg/day: Cal ${a7.cal.toFixed(0)}, P ${a7.p.toFixed(0)}, C ${a7.c.toFixed(0)}, F ${a7.f.toFixed(0)}`;
  $("#roll30").textContent = `30-day Totals: Cal ${t30.cal.toFixed(0)}, P ${t30.p.toFixed(0)}, C ${t30.c.toFixed(0)}, F ${t30.f.toFixed(0)} | Avg/day: Cal ${a30.cal.toFixed(0)}, P ${a30.p.toFixed(0)}, C ${a30.c.toFixed(0)}, F ${a30.f.toFixed(0)}`;
}

// ----- CRUD -----
function currentMealFromForm(){
  const date = $("#date").value || todayISO();
  const meal = $("#meal").value.trim();
  const calories = Number($("#calories").value||0);
  const protein = Number($("#protein").value||0);
  const carbs = Number($("#carbs").value||0);
  const fat = Number($("#fat").value||0);
  const notes = $("#notes").value.trim();
  const category = $("#category").value;
  const time = $("#time").value;
  return {date, meal, calories, protein, carbs, fat, notes, category, time};
}
function onSave(e){
  e.preventDefault();
  const form = e.target.closest("form");
  // Validation
  const m = currentMealFromForm();
  const fields = ["calories","protein","carbs","fat"];
  for(const f of fields){
    if(m[f] < 0 || !isFinite(m[f])){
      alert("Please enter only non-negative numeric values."); return;
    }
    if(m[f] > 10000){ if(!confirm("That value seems unusually high. Continue?")) return; }
  }
  // Auto-calc calories if empty
  const macroKcal = kcalFromMacros(m);
  if(m.calories === 0 && macroKcal>0){ m.calories = Math.round(macroKcal); }

  const entry = {
    id: form.dataset.editing || crypto.randomUUID(),
    ...m
  };
  const meals = loadMeals();
  const idx = meals.findIndex(x => x.id === entry.id);
  if(idx>=0){
    const prev = {...meals[idx]};
    meals[idx] = entry;
    pushStack(UNDO_STACK_KEY, {type:"edit", before:prev, after:entry});
    clearStack(REDO_STACK_KEY);
  }else{
    meals.push(entry);
    pushStack(UNDO_STACK_KEY, {type:"add", item:entry});
    clearStack(REDO_STACK_KEY);
  }
  saveMeals(meals);
  form.reset();
  form.dataset.editing = "";
  $("#date").value = $("#filterDate").value;
  render();
}

function onDelete(e){
  const id = e.target.dataset.del;
  const meals = loadMeals();
  const idx = meals.findIndex(m => m.id === id);
  if(idx === -1) return;
  const [removed] = meals.splice(idx,1);
  pushStack(UNDO_STACK_KEY, {type:"delete", item:removed});
  clearStack(REDO_STACK_KEY);
  saveMeals(meals);
  render();
}

function onEdit(e){
  const id = e.target.dataset.edit;
  const item = loadMeals().find(m => m.id === id);
  if(!item) return;
  $("#date").value = item.date;
  $("#meal").value = item.meal;
  $("#calories").value = item.calories;
  $("#protein").value = item.protein;
  $("#carbs").value = item.carbs;
  $("#fat").value = item.fat;
  $("#notes").value = item.notes;
  $("#category").value = item.category || "";
  $("#time").value = item.time || "";
  $("#form").dataset.editing = item.id;
  $("#meal").focus();
}

// Undo/Redo
function applyActionReverse(action){
  const meals = loadMeals();
  if(action.type === "delete"){
    meals.push(action.item);
  }else if(action.type === "add"){
    const idx = meals.findIndex(m => m.id === action.item.id);
    if(idx>=0) meals.splice(idx,1);
  }else if(action.type === "edit"){
    const idx = meals.findIndex(m => m.id === action.after.id);
    if(idx>=0) meals[idx] = action.before;
  }else if(action.type === "bulkAdd"){
    const left = meals.filter(m => !action.items.some(x => x.id===m.id));
    left.length !== meals.length && saveMeals(left);
    if(left.length === meals.length) saveMeals(meals); // no-op
    return;
  }
  saveMeals(meals);
}
function applyActionForward(action){
  const meals = loadMeals();
  if(action.type === "delete"){
    const idx = meals.findIndex(m => m.id === action.item.id);
    if(idx>=0) meals.splice(idx,1);
  }else if(action.type === "add"){
    meals.push(action.item);
  }else if(action.type === "edit"){
    const idx = meals.findIndex(m => m.id === action.before.id);
    if(idx>=0) meals[idx] = action.after;
  }else if(action.type === "bulkAdd"){
    saveMeals(meals.concat(action.items));
    render();
    return;
  }
  saveMeals(meals);
}
function onUndo(){
  const a = popStack(UNDO_STACK_KEY);
  if(!a) return;
  applyActionReverse(a);
  pushStack(REDO_STACK_KEY, a);
  render();
}
function onRedo(){
  const a = popStack(REDO_STACK_KEY);
  if(!a) return;
  applyActionForward(a);
  pushStack(UNDO_STACK_KEY, a);
  render();
}

// Presets
const loadPresets = ()=> JSON.parse(localStorage.getItem(PRESETS_KEY) || "[]");
const savePresets = (p)=> localStorage.setItem(PRESETS_KEY, JSON.stringify(p));
function addPresetFromCurrent(){
  const p = currentMealFromForm();
  const presets = loadPresets(); presets.unshift(p); savePresets(presets.slice(0,25));
  renderPresets();
}
function applyPreset(idx){
  const p = loadPresets()[idx]; if(!p) return;
  $("#meal").value = p.meal; $("#calories").value = p.calories; $("#protein").value = p.protein;
  $("#carbs").value = p.carbs; $("#fat").value = p.fat; $("#notes").value = p.notes;
  $("#category").value = p.category || "";
  $("#time").value = p.time || "";
}
function renderPresets(){
  const sel = $("#presetPicker"); const arr = loadPresets();
  sel.innerHTML = `<option value="">Presets…</option>` + arr.map((p,i)=>`<option value="${i}">${escapeHtml(p.meal||"Preset")}</option>`).join("");
}

// Copy yesterday
function copyYesterday(){
  const target = $("#filterDate").value || todayISO();
  const from = isoShift(target, -1);
  const meals = loadMeals();
  const y = meals.filter(m=>m.date===from).map(m=>({...m, id: crypto.randomUUID(), date: target}));
  if(!y.length){ alert("No meals from yesterday."); return; }
  const merged = meals.concat(y);
  saveMeals(merged);
  pushStack(UNDO_STACK_KEY, {type:"bulkAdd", items:y});
  clearStack(REDO_STACK_KEY);
  render();
}

// ----- Import/Export with preview -----
function download(filename, content, type="application/json"){
  const blob = new Blob([content], {type});
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  setTimeout(()=>URL.revokeObjectURL(url), 5000);
}
function exportJSON(){
  const payload = { meta: { app:"Macro Tracker", version: APP_VERSION, exportedAt: new Date().toISOString(), schemaVersion: SCHEMA_VERSION }, meals: loadMeals() };
  download(`macro-tracker-${new Date().toISOString().slice(0,10)}.json`, JSON.stringify(payload,null,2));
}
function headersCSV(){ return ["id","date","meal","calories","protein","carbs","fat","category","time","notes"]; }
function toCSV(meals){
  const headers = headersCSV();
  const rows = meals.map(m => headers.map(h => {
    let v = m[h] ?? "";
    v = (""+v).replace(/"/g,'""');
    return `"${v}"`;
  }).join(","));
  return headers.join(",") + "\n" + rows.join("\n");
}
function exportCSV(){
  const csv = toCSV(loadMeals());
  download(`macro-tracker-${new Date().toISOString().slice(0,10)}.csv`, csv, "text/csv");
}

function showModal(id){
  $(id).classList.add("open");
}
function closeModal(id){
  $(id).classList.remove("open");
}

function parseCSV(text){
  const lines = text.trim().split(/\r?\n/);
  const headers = lines.shift().split(",").map(h => h.replace(/^"|"$/g,""));
  const idx = (h) => headers.indexOf(h);
  const items = [];
  for(const line of lines){
    if(!line.trim()) continue;
    const cols = line.match(/("(?:[^"]|"")*"|[^,]+)/g).map(c => c.replace(/^"|"$/g,"").replace(/""/g,'"'));
    const obj = {
      id: cols[idx("id")] || crypto.randomUUID(),
      date: cols[idx("date")] || todayISO(),
      meal: cols[idx("meal")] || "",
      calories: Number(cols[idx("calories")]||0),
      protein: Number(cols[idx("protein")]||0),
      carbs: Number(cols[idx("carbs")]||0),
      fat: Number(cols[idx("fat")]||0),
      category: cols[idx("category")]||"",
      time: cols[idx("time")]||"",
      notes: cols[idx("notes")] || ""
    };
    items.push(obj);
  }
  return items;
}

function previewImport(items){
  const meals = loadMeals();
  const ids = new Set(meals.map(m=>m.id));
  let newCount=0, updateCount=0;
  items.forEach(it => ids.has(it.id) ? updateCount++ : newCount++);
  $("#importSummary").innerHTML = `Records: <b>${items.length}</b> | New: <b>${newCount}</b> | Updates: <b>${updateCount}</b>`;
  const sample = items.slice(0,10).map(m => `<li>${escapeHtml(m.date)} — ${escapeHtml(m.meal)} (${m.calories} kcal)</li>`).join("");
  $("#importSample").innerHTML = sample || "<li>No rows</li>";
  showModal("#importModal");
  // store pending preview
  window.__pendingImport = items;
}

function commitImport(strategy){
  const items = window.__pendingImport || [];
  const meals = loadMeals();
  const map = new Map(meals.map(m => [m.id, m]));
  if(strategy === "replaceById"){
    for(const m of items){
      map.set(m.id, m);
    }
  }else if(strategy === "appendNew"){
    for(const m of items){
      if(!map.has(m.id)) map.set(m.id, m);
    }
  }
  saveMeals(Array.from(map.values()));
  delete window.__pendingImport;
  closeModal("#importModal");
  render();
  alert("Import complete.");
}

// File handlers
function importJSONFile(file){
  const reader = new FileReader();
  reader.onload = () => {
    try{
      const obj = JSON.parse(reader.result);
      if(obj && Array.isArray(obj.meals)){
        previewImport(obj.meals.map(m => ({
          id: m.id || crypto.randomUUID(),
          date: m.date, meal: m.meal, calories: Number(m.calories||0),
          protein: Number(m.protein||0), carbs: Number(m.carbs||0), fat: Number(m.fat||0),
          category: m.category || "", time: m.time || "", notes: m.notes || ""
        })));
      }else{
        throw new Error("Not a Macro Tracker JSON payload.");
      }
    }catch(err){
      alert("Import failed: " + err.message);
    }
  };
  reader.readAsText(file);
}
function importCSVFile(file){
  const reader = new FileReader();
  reader.onload = () => {
    try{
      const items = parseCSV(reader.result);
      previewImport(items);
    }catch(err){
      alert("CSV import failed: " + err.message);
    }
  };
  reader.readAsText(file);
}

// ----- Service Worker registration with update toast -----
let swReg = null;
async function registerSW(){
  if("serviceWorker" in navigator){
    try{
      const reg = await navigator.serviceWorker.register("./service-worker.js", {scope:"."});
      swReg = reg;
      if (reg.waiting){ showUpdateToast(); }
      reg.addEventListener("updatefound", () => {
        const newWorker = reg.installing;
        newWorker && newWorker.addEventListener("statechange", () => {
          if (newWorker.state === "installed" && navigator.serviceWorker.controller){
            showUpdateToast();
          }
        });
      });
      navigator.serviceWorker.addEventListener("controllerchange", ()=> window.location.reload());
    }catch(e){ console.warn("SW registration failed", e); }
  }
}
function showUpdateToast(){
  const toast = $("#updateToast");
  toast.classList.add("show");
}
function doUpdateNow(){
  if(swReg && swReg.waiting){
    swReg.waiting.postMessage({type:"SKIP_WAITING"});
  }
}

// ----- Settings modal -----
function openSettings(){
  const s = loadSettings();
  $("#targetCal").value = s.targets.cal;
  $("#targetP").value = s.targets.p;
  $("#targetC").value = s.targets.c;
  $("#targetF").value = s.targets.f;
  $("#themeSel").value = s.theme || "auto";
  $("#showRemaining").checked = !!s.showRemaining;
  showModal("#settingsModal");
}
function saveSettingsFromUI(){
  const s = loadSettings();
  s.targets.cal = clamp(Number($("#targetCal").value||0),0,100000);
  s.targets.p = clamp(Number($("#targetP").value||0),0,10000);
  s.targets.c = clamp(Number($("#targetC").value||0),0,10000);
  s.targets.f = clamp(Number($("#targetF").value||0),0,10000);
  s.theme = $("#themeSel").value;
  s.showRemaining = $("#showRemaining").checked;
  saveSettings(s);
  applyTheme();
  closeModal("#settingsModal");
  render();
}

// ----- Init -----
document.addEventListener("DOMContentLoaded", () => {
  $("#ver").textContent = APP_VERSION;
  applyTheme();
  $("#filterDate").value = todayISO();
  $("#date").value = todayISO();
  $("#filterDate").addEventListener("change", render);
  $("#saveBtn").addEventListener("click", onSave);
  $("#undoBtn").addEventListener("click", onUndo);
  $("#redoBtn").addEventListener("click", onRedo);
  $("#exportJsonBtn").addEventListener("click", exportJSON);
  $("#exportCsvBtn").addEventListener("click", exportCSV);
  $("#importBtn").addEventListener("click", () => $("#fileInput").click());
  $("#fileInput").addEventListener("change", (e)=>{
    const file = e.target.files[0];
    if(!file) return;
    if(file.name.endsWith(".json")) importJSONFile(file);
    else if(file.name.endsWith(".csv")) importCSVFile(file);
    else alert("Unsupported file type. Import a .json or .csv file.");
    e.target.value = "";
  });
  $("#savePresetBtn").addEventListener("click", addPresetFromCurrent);
  $("#presetPicker").addEventListener("change", (e)=>{ if(e.target.value) applyPreset(Number(e.target.value)); e.target.value=""; });
  $("#copyYesterdayBtn").addEventListener("click", copyYesterday);

  // Settings
  $("#openSettingsBtn").addEventListener("click", openSettings);
  $("#settingsCancel").addEventListener("click", ()=>closeModal("#settingsModal"));
  $("#settingsSave").addEventListener("click", saveSettingsFromUI);

  // Import modal controls
  $("#importCancel").addEventListener("click", ()=>{ closeModal("#importModal"); delete window.__pendingImport; });
  $("#importCommit").addEventListener("click", ()=>{
    const strat = $("#mergeStrategy").value;
    commitImport(strat);
  });

  // Update toast button
  $("#updateBtn").addEventListener("click", doUpdateNow);

  render();
  registerSW();
});
