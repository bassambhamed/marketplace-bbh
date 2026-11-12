#!/usr/bin/env node
// Rapport HTML de l'orchestrateur du backlog. Sans dépendance.
// Usage : node .claude/tools/orchestrateur/rapport.mjs artifacts/orchestrateur/<RUN>
// Lit <dossier>/resume.json, écrit <dossier>/rapport.html (autonome, clair/sombre).
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";

const dir = process.argv[2];
if (!dir) { console.error("usage: rapport.mjs <dossier du run>"); process.exit(2); }
const src = join(dir, "resume.json");
if (!existsSync(src)) { console.error(`introuvable : ${src}`); process.exit(2); }
const r = JSON.parse(readFileSync(src, "utf8"));

const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const link = (url, text) => url ? `<a href="${esc(url)}">${esc(text ?? url)}</a>` : esc(text ?? "—");
const AGENTS = { "ui-refonte": "blue", "codescene-sante": "green", "orchestrateur-backlog": "purple" };
const statutClass = (s) => /fait|conforme|ok/i.test(s ?? "") ? "ok" : /échec|echec|ko|rouge/i.test(s ?? "") ? "ko" : "warn";
const table = (head, rows) => rows?.length
  ? `<div class="scroll"><table><thead><tr>${head.map((h) => `<th>${esc(h)}</th>`).join("")}</tr></thead><tbody>${
      rows.map((cells) => `<tr>${cells.map((c) => `<td>${c}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`
  : `<p class="muted">Aucune donnée.</p>`;
const list = (items) => items?.length ? `<ul>${items.map((i) => `<li>${esc(i)}</li>`).join("")}</ul>` : `<p class="muted">Aucun.</p>`;

function ticket(t) {
  const color = AGENTS[t.agent] ?? "gray";
  const tests = t.tests ? `${t.tests.reussis ?? "?"} réussis, ${t.tests.echoues ?? "?"} échoués` : "—";
  let detail = "";
  if (t.agent === "ui-refonte") {
    detail = `<h4>Critères implémentés</h4>` + table(["Id", "Implémentation", "Où", "À observer"],
      (t.criteres ?? []).map((c) => [esc(c.id), esc(c.implementation), `<code>${esc(c.ou)}</code>`, esc(c.observer)]));
  } else if (t.agent === "codescene-sante" && t.codescene) {
    const cs = t.codescene;
    detail = `<h4>Santé du code</h4><p>Bloqueurs : <strong>${esc(cs.bloqueursAvant)} → ${esc(cs.bloqueursApres)}</strong>` +
      ` · base <code>${esc(cs.base)}</code> · run <code>${esc(cs.run)}</code>` +
      (cs.rapport ? ` · ${link(cs.rapport, "rapport détaillé")}` : "") + `</p>` +
      table(["Fichier", "Violations avant → après", "Statut"],
        (cs.fichiers ?? []).map((f) => [`<code>${esc(f.chemin)}</code>`, `${esc(f.avant)} → ${esc(f.apres)}`, esc(f.statut)]));
  }
  return `<section class="ticket" style="--agent: var(--${color})">
  <header><span class="badge-agent">${esc(t.agent)}</span>
    <h3>${link(t.url, `#${t.numero} ${t.titre}`)}</h3>
    <span class="statut ${statutClass(t.statut)}">${esc(t.statut)}</span></header>
  <dl>
    <dt>Branche</dt><dd><code>${esc(t.branche)}</code> → <code>${esc(t.base ?? "main")}</code></dd>
    <dt>Commit</dt><dd><code>${esc(t.commit ?? "—")}</code></dd>
    <dt>Pull request</dt><dd>${link(t.pr, t.pr ? t.pr.replace(/.*\/pull\//, "#") : "—")}</dd>
    <dt>Build</dt><dd>${esc(t.build ?? "—")}</dd><dt>Tests</dt><dd>${esc(tests)}</dd>
  </dl>
  ${t.raison ? `<p class="raison">${esc(t.raison)}</p>` : ""}
  ${t.resumeAgent ? `<h4>Résumé de l'agent</h4><p>${esc(t.resumeAgent)}</p>` : ""}
  ${detail}
  <h4>Fichiers modifiés</h4>${list(t.fichiers)}
  <h4>Écarts et limites</h4>${list(t.limites)}
</section>`;
}

const tickets = r.tickets ?? [];
const nOk = tickets.filter((t) => statutClass(t.statut) === "ok").length;
const html = `<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Orchestration du backlog</title>
<style>
:root{--bg:#f7f8fa;--surface:#fff;--text:#1b1f24;--muted:#5b6470;--border:#d8dde3;
--purple:#7c3aed;--blue:#2563eb;--green:#15803d;--gray:#6b7280;--ok:#15803d;--ko:#b91c1c;--warn:#b45309;color-scheme:light dark}
@media (prefers-color-scheme:dark){:root{--bg:#0f1216;--surface:#181c22;--text:#e6e9ee;--muted:#a3acb8;--border:#2c333d;
--purple:#a78bfa;--blue:#60a5fa;--green:#4ade80;--ok:#4ade80;--ko:#f87171;--warn:#fbbf24}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:16px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
main{max-width:72rem;margin-inline:auto;padding:24px 16px}h1{font-size:clamp(1.5rem,3vw,2rem);margin:0 0 4px}
.muted{color:var(--muted)}.summary{display:flex;flex-wrap:wrap;gap:12px;margin:16px 0 24px}
.summary div{background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:10px 14px}
.ticket{background:var(--surface);border:1px solid var(--border);border-left:6px solid var(--agent);border-radius:12px;padding:16px;margin-bottom:20px}
.ticket header{display:flex;flex-wrap:wrap;align-items:center;gap:10px}.ticket h3{margin:0;flex:1;min-width:12rem;font-size:1.15rem}
.badge-agent{background:var(--agent);color:#fff;border-radius:999px;padding:2px 10px;font-size:.85rem;font-weight:600}
@media (prefers-color-scheme:dark){.badge-agent{color:#0f1216}}
.statut{font-weight:600}.ok{color:var(--ok)}.ko{color:var(--ko)}.warn{color:var(--warn)}
dl{display:grid;grid-template-columns:max-content 1fr;gap:4px 16px;margin:12px 0}dt{color:var(--muted)}dd{margin:0;overflow-wrap:anywhere}
h4{margin:16px 0 6px;font-size:1rem}.raison{border-left:3px solid var(--warn);padding-left:10px}
.scroll{overflow-x:auto}table{border-collapse:collapse;width:100%;font-size:.92rem}
th,td{border-bottom:1px solid var(--border);padding:6px 8px;text-align:left;vertical-align:top}
code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.88em;overflow-wrap:anywhere}a{color:var(--blue)}
</style></head><body><main>
<h1>Orchestration du backlog</h1>
<p class="muted">Run <code>${esc(r.run)}</code> · ${esc(r.date)} · branche de départ <code>${esc(r.depart)}</code> · dépôt ${esc(r.depot)}</p>
<div class="summary"><div><strong>${tickets.length}</strong> ticket(s) traité(s)</div><div class="ok"><strong>${nOk}</strong> fait(s) ou conforme(s)</div>
<div><strong>${tickets.filter((t) => t.pr).length}</strong> PR</div><div><strong>${(r.ignores ?? []).length}</strong> ignoré(s)</div></div>
${tickets.map(ticket).join("\n")}
<h2>Tickets ignorés</h2>${table(["Ticket", "Raison"], (r.ignores ?? []).map((i) => [esc(`#${i.numero} ${i.titre}`), esc(i.raison)]))}
<h2>Reste à faire par l'humain</h2>${list(r.resteAFaire)}
</main></body></html>`;
const out = join(dir, "rapport.html");
writeFileSync(out, html);
console.log(resolve(out));
