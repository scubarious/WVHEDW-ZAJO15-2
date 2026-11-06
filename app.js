(function () {
"use strict";
const CFG = window.APP_CONFIG || {};
const POS = [["LBU","SP","RBU"],["LM","CM","RM"],["LB","LCV","RCV","RB"],["K"]];
const ALLPOS = POS.flat();
const VOORKEUR = ["Keeper","Verdediging","Middenveld","Aanval"];
const S = { players:{}, matches:[], sel:null, pin:null, canEdit:false, sb:null, loaded:false };

const $ = id => document.getElementById(id);
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const slug = s => s.toLowerCase().normalize("NFD").replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"") || ("p"+Date.now());
const fmtDate = d => { if(!d) return ""; const [y,m,dd] = d.split("-"); return `${dd}-${m}-${y}`; };
const ls = { get(k){ try{return localStorage.getItem(k)}catch(e){return null} }, set(k,v){ try{ v==null?localStorage.removeItem(k):localStorage.setItem(k,v) }catch(e){} } };
const cur = () => S.matches.find(m => m.id === S.sel) || S.matches[0];
const pname = id => S.players[id]?.name || id;
const sortedPlayers = () => Object.entries(S.players).sort((a,b) => a[1].name.localeCompare(b[1].name,"nl"));
const parsePos = v => v.toUpperCase().split(/[\s,;/]+/).filter(x => ALLPOS.includes(x));
const status = t => { $("status").textContent = t; };

S.sel = ls.get("sel");
if (CFG.TEAM_NAAM) { $("app-title").textContent = CFG.TEAM_NAAM; document.title = CFG.TEAM_NAAM; }

/* ---------- Tabs & bewerkmodus ---------- */
$("tab-w").onclick = () => { $("view-w").hidden=false; $("view-s").hidden=true; $("tab-w").setAttribute("aria-pressed","true"); $("tab-s").setAttribute("aria-pressed","false"); };
$("tab-s").onclick = () => { $("view-w").hidden=true; $("view-s").hidden=false; $("tab-s").setAttribute("aria-pressed","true"); $("tab-w").setAttribute("aria-pressed","false"); };

function setEdit(on, pin){
  S.canEdit = on; S.pin = on ? pin : null;
  ls.set("pin", on ? pin : null);
  document.body.classList.toggle("readonly", !on);
  $("edit-btn").textContent = on ? "Vergrendel" : "Bewerken";
  $("edit-btn").setAttribute("aria-pressed", on ? "true" : "false");
  if (S.loaded) status(on ? "Bewerkmodus · wijzigingen worden direct opgeslagen." : "Alleen bekijken · tik op Bewerken om aan te passen.");
  render();
}
$("edit-btn").onclick = () => {
  if (S.canEdit) { setEdit(false); return; }
  $("pin-form").hidden = false; $("pin-err").textContent = ""; $("pin-input").value = ""; $("pin-input").focus();
};
$("pin-cancel").onclick = () => { $("pin-form").hidden = true; };
$("pin-form").onsubmit = async e => {
  e.preventDefault();
  if (!S.sb) return;
  const pin = $("pin-input").value.trim();
  const { data, error } = await S.sb.rpc("check_pin", { p_pin: pin });
  if (error) { $("pin-err").textContent = "Controle mislukt: " + error.message; return; }
  if (!data) { $("pin-err").textContent = "Onjuiste pincode. Probeer het opnieuw."; return; }
  $("pin-form").hidden = true; setEdit(true, pin);
};

/* ---------- Opslaan via beveiligde functies ---------- */
const queues = {};
function write(key, fn){
  queues[key] = (queues[key] || Promise.resolve()).then(async () => {
    const { error } = await fn();
    if (error) {
      if (/pincode/i.test(error.message)) { setEdit(false); status("Pincode klopt niet meer. Ontgrendel opnieuw om te bewerken."); }
      else status("Opslaan mislukt: " + error.message + ". Probeer het opnieuw.");
      await loadAll();
    }
  }).catch(e => status("Opslaan mislukt: " + (e.message || e)));
  return queues[key];
}
function saveMatch(m){
  S.matches = S.matches.map(x => x.id === m.id ? m : x); render();
  const blokken = JSON.parse(JSON.stringify(m.blokken));
  write("m:"+m.id, () => S.sb.rpc("save_match", { p_pin:S.pin, p_id:m.id, p_datum:m.datum, p_tegenstander:m.tegenstander||"", p_blokken:blokken, p_afgemeld:m.afgemeld||[] }));
}
function deleteMatch(id){ write("m:"+id, () => S.sb.rpc("delete_match", { p_pin:S.pin, p_id:id })); }
function savePlayer(id, p){ write("p:"+id, () => S.sb.rpc("save_player", { p_pin:S.pin, p_id:id, p_name:p.name, p_voorkeur:p.voorkeur, p_posities:p.posities||[] })); }
function deletePlayer(id){ write("p:"+id, () => S.sb.rpc("delete_player", { p_pin:S.pin, p_id:id })); }

/* ---------- Wissels berekenen ---------- */
function wissels(prev, next){
  const posOf = (o,id) => Object.keys(o).find(k => o[k] === id);
  const pv = new Set(Object.values(prev)), nx = new Set(Object.values(next));
  const ins = ALLPOS.filter(p => next[p] && !pv.has(next[p])).map(p => next[p]);
  let outs = ALLPOS.filter(p => prev[p] && !nx.has(prev[p])).map(p => prev[p]);
  const pairs = [], rest = [];
  ins.forEach(id => { const P = posOf(next,id), h = prev[P];
    if (h && outs.includes(h)) { pairs.push({in:id,inPos:P,out:h,outPos:P}); outs = outs.filter(x => x !== h); } else rest.push(id); });
  rest.forEach(id => { const o = outs.shift(); pairs.push({in:id,inPos:posOf(next,id),out:o||null,outPos:o?posOf(prev,o):null}); });
  outs.forEach(o => pairs.push({in:null,inPos:null,out:o,outPos:posOf(prev,o)}));
  const moves = Object.values(next).filter(id => pv.has(id) && posOf(prev,id) !== posOf(next,id)).map(id => ({p:id,from:posOf(prev,id),to:posOf(next,id)}));
  return { pairs, moves };
}

/* ---------- Weergave ---------- */
function renderMatches(){
  const box = $("matches"), m = cur();
  box.innerHTML = S.matches.map(x => `<button class="mcard" data-id="${esc(x.id)}" aria-current="${!!(m && x.id===m.id)}"><b>${fmtDate(x.datum)}</b><span>${esc(x.tegenstander||"Tegenstander onbekend")}</span></button>`).join("");
  box.querySelectorAll(".mcard").forEach(b => b.onclick = () => { S.sel = b.dataset.id; ls.set("sel", S.sel); render(); });
}

function renderMatch(){
  const box = $("match"), m = cur(), ro = S.canEdit ? "" : "disabled";
  if (!S.loaded) { box.innerHTML = ""; return; }
  if (!m) { box.innerHTML = `<div class="panel empty-state"><h2>Nog geen wedstrijden</h2><p>${S.canEdit ? "Voeg je eerste wedstrijd toe met <b>Nieuwe wedstrijd</b>." : "Tik op <b>Bewerken</b> en voer de pincode in om een wedstrijd toe te voegen."}</p></div>`; return; }
  const off = new Set(m.afgemeld || []);
  const present = sortedPlayers().filter(([id]) => !off.has(id));
  const playedIn = id => m.blokken.map(b => Object.keys(b.opstelling||{}).find(k => b.opstelling[k] === id) || null);

  let h = `<div class="stack"><div class="panel">
    <div class="row" style="justify-content:space-between">
      <div class="row">
        <label class="row" style="gap:6px"><span class="label">Datum</span><input type="date" id="m-date" value="${esc(m.datum)}" ${ro}></label>
        <label class="row" style="gap:6px"><span class="label">Tegenstander</span><input type="text" id="m-opp" value="${esc(m.tegenstander)}" placeholder="optioneel" ${ro}></label>
      </div>
      <div class="row edit-only"><span id="vs-wrap"><button class="btn" id="m-vs">Opstelling voorstellen</button></span><span id="del-wrap"><button class="btn danger" id="m-del">Wedstrijd verwijderen</button></span></div>
    </div>
    ${S.uitleg && S.uitleg.id === m.id ? `<div class="advies"><div class="label">Voorstel gemaakt</div>${S.uitleg.lines.length ? `<ul>${S.uitleg.lines.map(l => `<li>${esc(l)}</li>`).join("")}</ul>` : "<p>Iedereen speelt even veel en staat op een voorkeurspositie.</p>"}<p class="status">Controleer de opstelling en pas aan waar nodig.</p></div>` : ""}
    <div><div class="label" style="margin-bottom:6px">Aanwezig${S.canEdit?" · tik om af te melden":""} (${present.length} van ${Object.keys(S.players).length})</div>
    <div class="chips">${sortedPlayers().map(([id,p]) => `<button class="chip ${off.has(id)?"off":""}" data-pid="${esc(id)}" aria-pressed="${!off.has(id)}" ${ro}>${esc(p.name)}</button>`).join("")}</div></div>
  </div><div class="blocks">`;

  m.blokken.forEach((b, bi) => {
    const op = b.opstelling || {}, used = new Set(Object.values(op));
    const empty = ALLPOS.filter(p => !op[p]).length;
    const bench = present.filter(([id]) => !used.has(id));
    h += `<div class="block"><div class="bhead"><h2>Blok ${bi+1}</h2>
      <div class="time"><input type="number" min="0" id="t-${bi}-s" data-b="${bi}" data-k="start" value="${b.start}" ${ro}> – <input type="number" min="0" id="t-${bi}-e" data-b="${bi}" data-k="end" value="${b.end}" ${ro}> min <span>(${Math.max(0,b.end-b.start)} min)</span></div></div>
      <div class="pitch">`;
    POS.forEach(line => {
      h += `<div class="line l${line.length}">`;
      line.forEach(pos => {
        const val = op[pos] || "";
        const opts = present.filter(([id]) => id === val || !used.has(id));
        const pref = opts.filter(([,p]) => (p.posities||[]).includes(pos)), rest = opts.filter(([,p]) => !(p.posities||[]).includes(pos));
        const o = ([id,p]) => { const n = playedIn(id).filter((x,i) => x && i !== bi).length; return `<option value="${esc(id)}" ${id===val?"selected":""}>${esc(p.name)}${id===val?"":" · "+n}</option>`; };
        const ghost = val && !S.players[val] ? `<option value="${esc(val)}" selected>${esc(val)}</option>` : "";
        h += `<div class="slot"><span class="pos">${pos}</span><select id="s-${bi}-${pos}" data-b="${bi}" data-pos="${pos}" class="${val?"":"empty"}" aria-label="Blok ${bi+1} ${pos}" ${ro}><option value="">—</option>${ghost}${pref.length?`<optgroup label="Voorkeur ${pos}">${pref.map(o).join("")}</optgroup>`:""}${rest.length?`<optgroup label="Overig">${rest.map(o).join("")}</optgroup>`:""}</select></div>`;
      });
      h += `</div>`;
    });
    h += `</div>`;
    if (bi > 0) {
      const w = wissels(m.blokken[bi-1].opstelling || {}, op);
      h += `<div><div class="label">Wissels bij ${b.start} min</div><div class="subs">${w.pairs.length ? w.pairs.map(x => `<div class="sub"><span class="in">▲ ${x.in?esc(pname(x.in)):"—"}${x.inPos?` <i>${x.inPos}</i>`:""}</span><span class="for">voor</span><span class="out">▼ ${x.out?esc(pname(x.out)):"—"}${x.outPos?` <i>${x.outPos}</i>`:""}</span></div>`).join("") : '<span class="status">Geen wissels</span>'}</div>
        ${w.moves.length ? `<div class="moves">Omzetten: ${w.moves.map(x => `${esc(pname(x.p))} ${x.from} → ${x.to}`).join(" · ")}</div>` : ""}</div>`;
    }
    h += `<div><div class="label">Bank (${bench.length})</div><div class="bench">${bench.map(([,p]) => `<span class="p">${esc(p.name)}</span>`).join("") || '<span class="status">Niemand</span>'}</div></div>
      ${empty ? `<div class="note">${empty} ${empty===1?"positie":"posities"} nog leeg</div>` : ""}</div>`;
  });

  h += `</div><div class="panel"><h2>Speeltijd</h2><div class="status">Elke speler speelt 2 blokken en zit 1 blok op de bank. Het getal achter een naam in de keuzelijst is het aantal blokken dat die speler al speelt.</div>
    <div class="tablewrap"><table><thead><tr><th>Speler</th>${m.blokken.map((b,i) => `<th>Blok ${i+1}</th>`).join("")}<th>Gespeeld</th><th>Minuten</th><th>Status</th></tr></thead><tbody>`;
  present.forEach(([id,p]) => {
    const bl = playedIn(id), n = bl.filter(Boolean).length;
    const mins = bl.reduce((s,x,i) => s + (x ? Math.max(0, m.blokken[i].end - m.blokken[i].start) : 0), 0);
    const gk = bl.every(x => x === "K");
    const pill = gk ? `<span class="pill gk">Keeper</span>` : n === 2 ? `<span class="pill ok">Goed</span>` : `<span class="pill warn">${n===0?"Speelt niet":n===1?"1× te weinig":n+"× gespeeld"}</span>`;
    h += `<tr><td>${esc(p.name)}</td>${bl.map(x => x ? `<td class="play">${x}</td>` : `<td class="b">bank</td>`).join("")}<td>${n}</td><td>${mins}</td><td>${pill}</td></tr>`;
  });
  sortedPlayers().filter(([id]) => off.has(id)).forEach(([,p]) => { h += `<tr><td style="color:var(--off)">${esc(p.name)}</td>${m.blokken.map(() => `<td class="b">–</td>`).join("")}<td>–</td><td>–</td><td><span class="pill gk">Afgemeld</span></td></tr>`; });
  h += `</tbody></table></div></div></div>`;
  box.innerHTML = h;

  if (!S.canEdit) return;
  box.querySelectorAll(".chip[data-pid]").forEach(c => c.onclick = () => {
    const id = c.dataset.pid, set = new Set(m.afgemeld || []);
    if (set.has(id)) set.delete(id);
    else { set.add(id); m.blokken.forEach(b => { for (const k in b.opstelling) if (b.opstelling[k] === id) delete b.opstelling[k]; }); }
    m.afgemeld = [...set]; saveMatch(m);
  });
  box.querySelectorAll(".slot select").forEach(s => s.onchange = () => {
    const b = m.blokken[+s.dataset.b]; b.opstelling = b.opstelling || {};
    if (s.value) b.opstelling[s.dataset.pos] = s.value; else delete b.opstelling[s.dataset.pos];
    saveMatch(m);
  });
  box.querySelectorAll(".time input").forEach(i => i.onchange = () => { const v = parseInt(i.value,10); if (isNaN(v)) return; m.blokken[+i.dataset.b][i.dataset.k] = v; saveMatch(m); });
  $("m-date").onchange = e => { if (e.target.value) { m.datum = e.target.value; saveMatch(m); } };
  $("m-opp").onchange = e => { m.tegenstander = e.target.value.trim(); saveMatch(m); };
  $("m-vs").onclick = () => {
    $("vs-wrap").innerHTML = `<span class="confirm"><span>Huidige blokken overschrijven?</span><button class="btn primary" id="m-vs-yes">Ja, voorstel maken</button><button class="btn" id="m-vs-no">Nee</button></span>`;
    $("m-vs-no").onclick = renderMatch;
    $("m-vs-yes").onclick = () => {
      const r = window.Voorstel.maak({ players:S.players, matches:S.matches, datum:m.datum, afgemeld:m.afgemeld, blokken:m.blokken });
      m.blokken = r.blokken; S.uitleg = { id:m.id, lines:r.uitleg }; saveMatch(m);
    };
  };
  $("m-del").onclick = () => {
    $("del-wrap").innerHTML = `<span class="confirm"><span>Weet je het zeker?</span><button class="btn danger" id="m-del-yes">Ja, verwijder</button><button class="btn" id="m-del-no">Nee</button></span>`;
    $("m-del-no").onclick = renderMatch;
    $("m-del-yes").onclick = () => { const id = m.id; S.matches = S.matches.filter(x => x.id !== id); S.sel = null; render(); deleteMatch(id); };
  };
}

function renderStats(){
  const tb = $("stbody"); if (!S.loaded) { tb.innerHTML = ""; return; }
  const morgen = new Date(Date.now() + 864e5).toISOString().slice(0,10);
  const st = window.Voorstel.statistiek(S.players, S.matches, morgen);
  const rows = sortedPlayers().map(([id,p]) => [p.name, st[id]]).sort((x,y) => (x[1].aandeel ?? 1) - (y[1].aandeel ?? 1));
  tb.innerHTML = rows.map(([n,s]) => `<tr><td>${esc(n)}</td><td>${s.wedstrijden}</td><td>${s.minuten}</td><td>${s.aandeel == null ? "–" : Math.round(s.aandeel*100) + "%"}</td><td>${s.blokken}</td><td>${s.bank}</td><td>${s.basis}</td><td>${s.afgemeld}</td></tr>`).join("") || `<tr><td colspan="8" class="status">Nog geen gegevens.</td></tr>`;
}

function renderPlayers(){
  const tb = $("ptbody"), ro = S.canEdit ? "" : "disabled";
  if (!S.loaded) { tb.innerHTML = ""; return; }
  const list = sortedPlayers();
  if (!list.length) { tb.innerHTML = `<tr><td colspan="4" class="status">Nog geen spelers.</td></tr>`; return; }
  tb.innerHTML = list.map(([id,p]) => `<tr data-id="${esc(id)}">
    <td><input type="text" id="pn-${esc(id)}" data-f="name" value="${esc(p.name)}" ${ro}></td>
    <td><select id="pv-${esc(id)}" data-f="voorkeur" ${ro}>${VOORKEUR.map(v => `<option ${v===p.voorkeur?"selected":""}>${v}</option>`).join("")}</select></td>
    <td><input type="text" id="pp-${esc(id)}" data-f="posities" value="${esc((p.posities||[]).join(", "))}" ${ro}></td>
    <td class="pdel">${S.canEdit ? `<button class="btn danger" data-del="1">Verwijderen</button>` : ""}</td></tr>`).join("");
  if (!S.canEdit) return;
  tb.querySelectorAll("tr[data-id]").forEach(tr => {
    const id = tr.dataset.id;
    tr.querySelectorAll("[data-f]").forEach(el => el.onchange = () => {
      const p = { ...S.players[id] }, f = el.dataset.f;
      if (f === "posities") p.posities = parsePos(el.value);
      else if (f === "name") { if (!el.value.trim()) return; p.name = el.value.trim(); }
      else p[f] = el.value;
      S.players[id] = p; render(); savePlayer(id, p);
    });
    tr.querySelector("[data-del]").onclick = () => {
      const td = tr.querySelector(".pdel");
      td.innerHTML = `<span class="confirm"><button class="btn danger" data-y>Ja, verwijder</button><button class="btn" data-n>Nee</button></span>`;
      td.querySelector("[data-n]").onclick = renderPlayers;
      td.querySelector("[data-y]").onclick = () => { delete S.players[id]; render(); deletePlayer(id); };
    };
  });
}

$("add-player").onsubmit = e => {
  e.preventDefault();
  const name = $("ap-name").value.trim(); if (!name || !S.canEdit) return;
  let id = slug(name); while (S.players[id]) id += "-2";
  const p = { name, voorkeur:$("ap-pref").value, posities:parsePos($("ap-pos").value) };
  S.players[id] = p; $("ap-name").value = ""; $("ap-pos").value = ""; render(); savePlayer(id, p);
};

$("new-btn").onclick = () => { $("new-form").hidden = false; $("new-date").value = new Date().toISOString().slice(0,10); $("new-err").textContent = ""; $("new-date").focus(); };
$("new-cancel").onclick = () => { $("new-form").hidden = true; };
$("new-form").onsubmit = e => {
  e.preventDefault();
  const d = $("new-date").value; if (!d) { $("new-err").textContent = "Kies een datum."; return; }
  const src = cur(), mode = $("new-mode").value;
  const tijden = src ? src.blokken.map(b => ({ start:b.start, end:b.end })) : [{start:0,end:25},{start:25,end:50},{start:50,end:65}];
  let blokken;
  if (mode === "kopie" && src) blokken = src.blokken.map(b => ({ start:b.start, end:b.end, opstelling:{ ...b.opstelling } }));
  else if (mode === "voorstel") { const r = window.Voorstel.maak({ players:S.players, matches:S.matches, datum:d, afgemeld:[], blokken:tijden }); blokken = r.blokken; S.uitleg = { id:null, lines:r.uitleg }; }
  else blokken = tijden.map(t => ({ ...t, opstelling:{} }));
  const m = { id:"w-"+d+"-"+Math.random().toString(36).slice(2,6), datum:d, tegenstander:$("new-opp").value.trim(), blokken, afgemeld:[] };
  if (S.uitleg && S.uitleg.id === null) S.uitleg.id = m.id;
  S.matches.push(m); S.matches.sort((a,b) => b.datum.localeCompare(a.datum)); S.sel = m.id; ls.set("sel", m.id);
  $("new-form").hidden = true; $("new-opp").value = ""; saveMatch(m);
};

function render(){
  const aid = document.activeElement && document.activeElement.id;
  renderMatches(); renderMatch(); renderPlayers(); renderStats();
  if (aid && $(aid) && aid !== "m-del" && aid !== "m-vs") try { $(aid).focus(); } catch(e) {}
}

/* ---------- Laden & live bijwerken ---------- */
async function loadAll(){
  const [p, m] = await Promise.all([
    S.sb.from("players").select("id,name,voorkeur,posities"),
    S.sb.from("matches").select("id,datum,tegenstander,blokken,afgemeld")
  ]);
  if (p.error || m.error) { status("Laden mislukt: " + (p.error || m.error).message); return; }
  S.players = {}; p.data.forEach(r => { S.players[r.id] = { name:r.name, voorkeur:r.voorkeur, posities:r.posities || [] }; });
  S.matches = m.data.map(r => ({ id:r.id, datum:r.datum, tegenstander:r.tegenstander || "", blokken:r.blokken || [], afgemeld:r.afgemeld || [] }))
    .sort((a,b) => b.datum.localeCompare(a.datum));
  S.loaded = true;
  status(S.canEdit ? "Bewerkmodus · wijzigingen worden direct opgeslagen." : "Alleen bekijken · tik op Bewerken om aan te passen.");
  render();
}

async function start(){
  document.body.classList.add("readonly");
  if (!CFG.SUPABASE_URL || /JOUW-PROJECT/.test(CFG.SUPABASE_URL) || !window.supabase) {
    status(window.supabase ? "Nog niet ingesteld: vul je Supabase-gegevens in config.js in (zie LEESMIJ.txt)." : "De database-bibliotheek kon niet laden. Controleer je internetverbinding.");
    return;
  }
  S.sb = window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY);
  await loadAll();
  const saved = ls.get("pin");
  if (saved) {
    const { data } = await S.sb.rpc("check_pin", { p_pin: saved });
    if (data) setEdit(true, saved); else ls.set("pin", null);
  }
  let t = null;
  const refresh = () => { clearTimeout(t); t = setTimeout(loadAll, 300); };
  S.sb.channel("opstellingen")
    .on("postgres_changes", { event:"*", schema:"public", table:"players" }, refresh)
    .on("postgres_changes", { event:"*", schema:"public", table:"matches" }, refresh)
    .subscribe();
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") refresh(); });
}

if ("serviceWorker" in navigator) window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
start();
})();
