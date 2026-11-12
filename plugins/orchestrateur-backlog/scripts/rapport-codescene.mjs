#!/usr/bin/env node
// Rapport HTML autonome d'une exécution de l'agent codescene-sante.
// Usage : node rapport.mjs artifacts/codescene/<run>
// Lit iteration-*.json (écrits par l'agent) et final.json (scan final de la skill, facultatif),
// écrit <run>/rapport.html. Aucune dépendance, aucun CDN.
// Conception : codescene/agent-codescene.md, §5.4.
import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

const dossier = process.argv[2];
if (!dossier || !existsSync(dossier)) {
  console.error('Usage : node rapport.mjs artifacts/codescene/<run> (dossier existant)');
  process.exit(2);
}

const lireJson = (f) => {
  try { return JSON.parse(readFileSync(f, 'utf8')); }
  catch (e) { console.error(`JSON illisible : ${f} (${e.message})`); process.exit(1); }
};

const iterations = readdirSync(dossier)
  .filter((f) => /^iteration-\d+\.json$/.test(f))
  .map((f) => lireJson(join(dossier, f)))
  .sort((a, b) => (a.iteration ?? 0) - (b.iteration ?? 0));
if (iterations.length === 0) {
  console.error(`Aucun iteration-*.json dans ${dossier}`);
  process.exit(1);
}
const final = existsSync(join(dossier, 'final.json')) ? lireJson(join(dossier, 'final.json')) : null;
const derniere = iterations.at(-1);
const premiere = iterations[0];

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const nombre = (n) => (typeof n === 'number' ? String(n) : '—');
const classeNombre = (n) => (typeof n !== 'number' ? '' : n === 0 ? 'vert' : 'rouge');
const liste = (a) => (Array.isArray(a) && a.length ? a.map(esc).join('<br>') : '—');

// Verdict : le scan final de la skill fait foi ; à défaut, la dernière itération de l'agent.
const bloqueursFinaux = final?.bloqueurs ?? derniere.bloqueurs ?? [];
const sourceVerdict = final ? 'scan final indépendant' : "dernière itération de l'agent (pas de scan final)";
const ok = bloqueursFinaux.length === 0;
const raisons = { 'zero-bloqueur': 'zéro bloqueur', 'max-iterations': 'nombre maximal d’itérations atteint', 'pas-de-progres': 'pas de progrès entre deux itérations' };

// Fichiers : premier nombre de violations connu et dernier état connu, toutes itérations confondues.
const fichiers = new Map();
for (const it of iterations) {
  for (const f of it.fichiers ?? []) {
    const prec = fichiers.get(f.chemin);
    fichiers.set(f.chemin, { ...f, violationsAvant: prec?.violationsAvant ?? f.violationsAvant,
      corrigees: [...new Set([...(prec?.corrigees ?? []), ...(f.corrigees ?? [])])] });
  }
}

const lignesFichiers = [...fichiers.values()].map((f) => `
      <tr>
        <td class="chemin">${esc(f.chemin)}</td>
        <td class="num"><span class="score ${classeNombre(f.violationsAvant)}">${nombre(f.violationsAvant)}</span> → <span class="score ${classeNombre(f.violationsApres)}">${nombre(f.violationsApres)}</span></td>
        <td>${liste(f.corrigees)}</td>
        <td>${liste(f.restantes)}</td>
        <td>${esc(f.statut)}</td>
      </tr>`).join('') || '<tr><td colspan="5">Aucun fichier traité.</td></tr>';

const lignesIterations = iterations.map((it) => `
      <tr>
        <td class="num">${esc(it.iteration)}</td>
        <td class="num">${(it.bloqueurs ?? []).length}</td>
        <td>${liste(it.bloqueurs)}</td>
        <td>${esc(it.tests?.build ?? '—')} · ${esc(it.tests?.reussis ?? '?')} réussis · ${esc(it.tests?.echoues ?? '?')} échoués</td>
        <td>${esc(raisons[it.arret] ?? (it.arret ? it.arret : 'continue'))}</td>
      </tr>`).join('');

const html = `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Santé du code ${esc(derniere.run)}</title>
<style>
  :root { --fond:#f7f7f5; --carte:#ffffff; --texte:#1d1d1b; --doux:#5f5f5a; --bord:#dcdcd6;
          --ok:#1f7a3d; --ko:#b3261e; --vert:#1f7a3d; --jaune:#8a6400; --rouge:#b3261e; }
  @media (prefers-color-scheme: dark) {
    :root { --fond:#151513; --carte:#1f1f1c; --texte:#ecece8; --doux:#a3a39c; --bord:#3a3a35;
            --ok:#5cc27f; --ko:#f2857c; --vert:#5cc27f; --jaune:#e0b44c; --rouge:#f2857c; }
  }
  * { box-sizing: border-box; }
  body { margin:0; padding:24px 16px; background:var(--fond); color:var(--texte);
         font:15px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; }
  main { max-width: 1000px; margin: 0 auto; }
  h1 { font-size: 22px; margin: 0 0 4px; }
  h2 { font-size: 16px; margin: 28px 0 8px; }
  .meta { color: var(--doux); margin: 0 0 16px; }
  .verdict { background: var(--carte); border: 1px solid var(--bord); border-left: 6px solid ${ok ? 'var(--ok)' : 'var(--ko)'};
             border-radius: 8px; padding: 14px 16px; }
  .verdict strong { font-size: 18px; color: ${ok ? 'var(--ok)' : 'var(--ko)'}; }
  .tableau { overflow-x: auto; background: var(--carte); border: 1px solid var(--bord); border-radius: 8px; }
  table { border-collapse: collapse; width: 100%; min-width: 640px; }
  th, td { text-align: left; padding: 8px 10px; border-bottom: 1px solid var(--bord); vertical-align: top; }
  th { color: var(--doux); font-weight: 600; font-size: 13px; }
  tr:last-child td { border-bottom: 0; }
  .num { white-space: nowrap; font-variant-numeric: tabular-nums; }
  .chemin { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 13px; word-break: break-all; }
  .score { font-weight: 600; } .vert { color: var(--vert); } .jaune { color: var(--jaune); } .rouge { color: var(--rouge); }
  ul { margin: 6px 0 0; padding-left: 20px; }
  footer { color: var(--doux); font-size: 13px; margin-top: 28px; }
</style>
</head>
<body>
<main>
  <h1>Santé du code — exécution ${esc(derniere.run)}</h1>
  <p class="meta">Base ${esc(derniere.base ?? 'main')} · ${iterations.length} itération(s) · du ${esc(premiere.date ?? '?')} au ${esc(final?.date ?? derniere.date ?? '?')}</p>

  <div class="verdict">
    <strong>${ok ? '0 bloqueur' : `${bloqueursFinaux.length} bloqueur(s) restant(s)`}</strong>
    <div>Source du verdict : ${esc(sourceVerdict)}. Arrêt de l'agent : ${esc(raisons[derniere.arret] ?? derniere.arret ?? 'non indiqué')}.</div>
    ${ok ? '' : `<ul>${bloqueursFinaux.map((b) => `<li class="chemin">${esc(b)}</li>`).join('')}</ul>`}
  </div>

  <h2>Fichiers</h2>
  <div class="tableau"><table>
    <thead><tr><th>Fichier</th><th>Violations bloquantes</th><th>Corrigées</th><th>Restantes</th><th>Statut</th></tr></thead>
    <tbody>${lignesFichiers}</tbody>
  </table></div>

  <h2>Itérations</h2>
  <div class="tableau"><table>
    <thead><tr><th>#</th><th>Bloqueurs</th><th>Fichiers bloquants</th><th>Build / tests</th><th>Suite</th></tr></thead>
    <tbody>${lignesIterations}</tbody>
  </table></div>

  <footer>Analyse locale (.claude/tools/sante-locale/scan.cs) selon le référentiel codescene/code-health-rules.json :
    lignes, complexité cyclomatique, imbrication et conditions complexes par méthode. Une violation est bloquante si elle
    n'existe pas sur la base ou si elle a empiré. Généré par .claude/skills/codescene-sante/rapport.mjs.</footer>
</main>
</body>
</html>
`;

const sortie = join(dossier, 'rapport.html');
writeFileSync(sortie, html);
console.log(resolve(sortie));
