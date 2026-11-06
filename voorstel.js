/* Opstellingsvoorstel
 * Verdeelt de blokken eerlijk op basis van eerdere wedstrijden (speelminuten,
 * bankbeurten, basisplaatsen) en zet spelers zo goed mogelijk op hun voorkeursposities.
 * Werkt los van de rest van de app: window.Voorstel.maak(...) en window.Voorstel.statistiek(...).
 */
(function () {
"use strict";
const LINES = { Verdediging:["LB","LCV","RCV","RB"], Middenveld:["LM","CM","RM"], Aanval:["LBU","SP","RBU"], Keeper:["K"] };
const VELD = ["LBU","SP","RBU","LM","CM","RM","LB","LCV","RCV","RB"];

/* Statistiek over alle wedstrijden vóór `totDatum` (exclusief). */
function statistiek(players, matches, totDatum){
  const st = {};
  Object.keys(players).forEach(id => st[id] = { wedstrijden:0, minuten:0, mogelijk:0, blokken:0, bank:0, basis:0, afgemeld:0 });
  matches.filter(m => !totDatum || m.datum < totDatum).forEach(m => {
    const off = new Set(m.afgemeld || []);
    Object.keys(st).forEach(id => {
      if (off.has(id)) { st[id].afgemeld++; return; }
      const s = st[id]; let speelde = false;
      m.blokken.forEach((b, bi) => {
        const dur = Math.max(0, (b.end||0) - (b.start||0));
        const opgesteld = Object.values(b.opstelling || {}).includes(id);
        s.mogelijk += dur;
        if (opgesteld) { s.minuten += dur; s.blokken++; speelde = true; if (bi === 0) s.basis++; }
        else s.bank++;
      });
      if (speelde || m.blokken.some(b => Object.keys(b.opstelling||{}).length)) s.wedstrijden++;
    });
  });
  Object.values(st).forEach(s => { s.aandeel = s.mogelijk ? s.minuten / s.mogelijk : null; s.basisAandeel = s.wedstrijden ? s.basis / s.wedstrijden : null; });
  return st;
}

/* Hongaarse methode: minimale kosten-toewijzing voor een vierkante matrix. */
function hungarian(c){
  const n = c.length, INF = 1e9, u = Array(n+1).fill(0), v = Array(n+1).fill(0), p = Array(n+1).fill(0), way = Array(n+1).fill(0);
  for (let i = 1; i <= n; i++) {
    p[0] = i; let j0 = 0; const minv = Array(n+1).fill(INF), used = Array(n+1).fill(false);
    do {
      used[j0] = true; const i0 = p[j0]; let d = INF, j1 = 0;
      for (let j = 1; j <= n; j++) if (!used[j]) {
        const cur = c[i0-1][j-1] - u[i0] - v[j];
        if (cur < minv[j]) { minv[j] = cur; way[j] = j0; }
        if (minv[j] < d) { d = minv[j]; j1 = j; }
      }
      for (let j = 0; j <= n; j++) { if (used[j]) { u[p[j]] += d; v[j] -= d; } else minv[j] -= d; }
      j0 = j1;
    } while (p[j0] !== 0);
    do { const j1 = way[j0]; p[j0] = p[j1]; j0 = j1; } while (j0);
  }
  const ans = Array(n); for (let j = 1; j <= n; j++) if (p[j]) ans[p[j]-1] = j-1;
  return ans;
}

function posKosten(p, pos){
  const lijst = p.posities || [];
  const i = lijst.indexOf(pos);
  if (i === 0) return 0;
  if (i > 0) return 1 + i;
  if ((LINES[p.voorkeur] || []).includes(pos)) return 5;
  return 10;
}

/* Rangschik spelers: wie het minst gespeeld heeft (aandeel minuten), krijgt voorrang. */
function voorrang(st, id){
  const s = st[id] || {};
  const a = s.aandeel == null ? 0.5 : s.aandeel;
  return a + (s.bank || 0) * -0.001;
}

/**
 * maak({players, matches, datum, afgemeld, blokken}) -> {blokken, uitleg}
 * blokken: [{start,end}] (tijden blijven behouden). Geeft nieuwe opstelling per blok terug.
 */
function maak(opts){
  const { players, matches, datum } = opts;
  const off = new Set(opts.afgemeld || []);
  const tijden = (opts.blokken && opts.blokken.length ? opts.blokken : [{start:0,end:25},{start:25,end:50},{start:50,end:65}]).map(b => ({ start:b.start, end:b.end }));
  const nb = tijden.length;
  const st = statistiek(players, matches, datum);
  const aanwezig = Object.keys(players).filter(id => !off.has(id));
  const uitleg = [];

  // Keeper: aanwezige speler met voorkeur Keeper (minste keepersblokken eerst), anders wie K als positie heeft.
  let keepers = aanwezig.filter(id => players[id].voorkeur === "Keeper");
  if (!keepers.length) keepers = aanwezig.filter(id => (players[id].posities || []).includes("K"));
  const keeper = keepers.sort((a,b) => voorrang(st,a) - voorrang(st,b))[0] || null;
  if (!keeper) uitleg.push("Geen keeper aanwezig: de K-positie blijft leeg.");
  const veld = aanwezig.filter(id => id !== keeper && players[id].voorkeur !== "Keeper");
  const extraKeepers = aanwezig.filter(id => id !== keeper && players[id].voorkeur === "Keeper");
  veld.push(...extraKeepers); // reservekeepers doen mee als veldspeler

  const N = veld.length, slots = VELD.length;
  if (N < slots) uitleg.push(`Er zijn maar ${N} veldspelers aanwezig voor ${slots} posities: iedereen speelt alles en er blijven posities leeg.`);

  // Aantal blokken per speler: zo gelijk mogelijk; wie historisch het minst speelde, krijgt de extra blokken.
  const totaal = Math.min(slots, N) * nb;
  const basis = N ? Math.floor(totaal / N) : 0, rest = N ? totaal - basis * N : 0;
  const opVolgorde = veld.slice().sort((a,b) => voorrang(st,a) - voorrang(st,b));
  const aantal = {}; opVolgorde.forEach((id, i) => aantal[id] = Math.min(nb, basis + (i < rest ? 1 : 0)));
  if (N > slots && rest) {
    const meer = opVolgorde.slice(0, rest).map(id => players[id].name), minder = opVolgorde.slice(rest).map(id => players[id].name);
    if (basis + 1 >= nb) uitleg.push(`${meer.length === 1 ? "Speelt" : "Spelen"} alle ${nb} blokken (minste speeltijd tot nu toe): ${meer.join(", ")}.`);
    else uitleg.push(`Te veel spelers voor ${basis + 1} blokken per speler. ${minder.length === 1 ? "Speelt" : "Spelen"} ${basis} ${basis === 1 ? "blok" : "blokken"} (meeste speeltijd tot nu toe): ${minder.join(", ")}.`);
  } else if (N > slots && basis < nb - 1) uitleg.push(`Iedereen speelt ${basis} ${basis === 1 ? "blok" : "blokken"}, door het grote aantal spelers.`);
  // Zoek het beste bankschema met willekeurige pogingen.
  const speelKans = id => Math.min(1, aantal[id] / nb);
  let best = null;
  const pogingen = 400;
  for (let t = 0; t < pogingen; t++) {
    // Kies per speler in welke blokken hij speelt.
    const inBlok = Array.from({length:nb}, () => []);
    const vrij = Array(nb).fill(Math.min(slots, N));
    const volgorde = veld.slice().sort(() => Math.random() - 0.5).sort((a,b) => aantal[b] - aantal[a]);
    let ok = true;
    for (const id of volgorde) {
      // Wie zelden in de basis stond, liever in blok 1.
      const s = st[id] || {}; const ba = s.basisAandeel == null ? 0.5 : s.basisAandeel;
      const kandidaten = [...Array(nb).keys()].filter(b => vrij[b] > 0)
        .map(b => ({ b, w: Math.random() + (b === 0 ? (0.5 - ba) * 1.5 : 0) + vrij[b] * 0.05 }))
        .sort((x,y) => y.w - x.w).slice(0, aantal[id]);
      if (kandidaten.length < aantal[id]) { ok = false; break; }
      kandidaten.forEach(k => { inBlok[k.b].push(id); vrij[k.b]--; });
    }
    if (!ok) continue;

    // Posities per blok via optimale toewijzing; gelijk blijven van positie levert bonus op.
    let kosten = 0; const ops = [];
    for (let b = 0; b < nb; b++) {
      const sp = inBlok[b], n = Math.max(sp.length, slots);
      const m = Array.from({length:n}, (_, i) => Array.from({length:n}, (_, j) => {
        if (i >= sp.length || j >= slots) return 0;
        let c = posKosten(players[sp[i]], VELD[j]);
        if (b > 0) { const vorige = Object.keys(ops[b-1]).find(k => ops[b-1][k] === sp[i]); if (vorige && vorige !== VELD[j]) c += 0.6; }
        return c;
      }));
      const toe = hungarian(m); const op = {};
      sp.forEach((id, i) => { const j = toe[i]; if (j < slots) { op[VELD[j]] = id; kosten += m[i][j]; } });
      if (keeper) op.K = keeper;
      ops.push(op);
    }
    // Kleine voorkeur voor een basisplaats voor wie zelden begon.
    inBlok[0].forEach(id => { const s = st[id] || {}; const ba = s.basisAandeel == null ? 0.5 : s.basisAandeel; kosten += ba * 0.8; });
    if (!best || kosten < best.kosten) best = { kosten, ops };
  }
  if (!best) return { blokken: tijden.map(t => ({ ...t, opstelling: keeper ? { K:keeper } : {} })), uitleg: uitleg.concat("Er kon geen voorstel worden gemaakt.") };

  const nietOpVoorkeur = [];
  best.ops.forEach((op, b) => Object.entries(op).forEach(([pos, id]) => { if (pos !== "K" && posKosten(players[id], pos) >= 5) nietOpVoorkeur.push(`${players[id].name} (${pos}, blok ${b+1})`); }));
  if (nietOpVoorkeur.length) uitleg.push("Buiten de opgegeven posities: " + nietOpVoorkeur.join(", ") + ".");
  return { blokken: tijden.map((t, b) => ({ ...t, opstelling: best.ops[b] })), uitleg };
}

window.Voorstel = { maak, statistiek };
})();
