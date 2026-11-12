#!/usr/bin/env bash
# Hook SubagentStop : empêche l'agent codescene-sante de conclure tant qu'il reste des bloqueurs.
# Fait partie du plugin orchestrateur-backlog (hooks/hooks.json).
#
# - N'agit que pour l'agent "codescene-sante" (champ agent_type de l'entrée JSON).
# - Source des bloqueurs : l'analyseur du plugin (scripts/scan.cs), relancé ici
#   (indépendant de ce que l'agent écrit). Repli sur artifacts/codescene/etat.json si l'analyseur échoue.
# - Code 2 : l'agent continue et reçoit stderr comme consigne. Code 0 : il conclut.
# - Bornes : 5 itérations, arrêt si les bloqueurs n'évoluent plus, au plus 6 blocages par exécution.
# - Échappatoire : CLAUDE_SKIP_CODESCENE_LOOP=1.
set -uo pipefail

MAX_ITERATIONS="${CLAUDE_CODESCENE_MAX_ITERATIONS:-5}"
MAX_BLOCAGES=$((MAX_ITERATIONS + 1))

[[ -n "${CLAUDE_SKIP_CODESCENE_LOOP:-}" ]] && exit 0

entree="$(cat)"
agent="$(jq -r '.agent_type // empty' <<<"$entree" 2>/dev/null)"
[[ "$agent" == "codescene-sante" || "$agent" == *":codescene-sante" ]] || exit 0

projet="${CLAUDE_PROJECT_DIR:-$(jq -r '.cwd // empty' <<<"$entree" 2>/dev/null)}"
cd "$projet" 2>/dev/null || exit 0

compteur_dir="${TMPDIR:-/tmp}/claude-codescene-boucle"
mkdir -p "$compteur_dir"

etat_fichier="artifacts/codescene/etat.json"
if [[ ! -r "$etat_fichier" ]] || ! jq -e . "$etat_fichier" >/dev/null 2>&1; then
  # Au plus 2 rappels : un agent qui n'écrit jamais l'état ne doit pas boucler sans fin.
  sans_etat="$compteur_dir/sans-etat-$(jq -r '.session_id // "inconnue"' <<<"$entree" 2>/dev/null)"
  rappels=$(($(cat "$sans_etat" 2>/dev/null || echo 0) + 1))
  echo "$rappels" >"$sans_etat"
  ((rappels > 2)) && exit 0
  echo "Hook CodeScene : $etat_fichier est absent ou n'est pas un JSON valide. Écris l'état de l'itération (étape 6 de ton prompt) avant de conclure." >&2
  exit 2
fi

run="$(jq -r '.run // "inconnu"' "$etat_fichier")"
base="$(jq -r '.base // "main"' "$etat_fichier")"
iteration="$(jq -r '.iteration // 0' "$etat_fichier")"
compteur="$compteur_dir/$run"

# Bloqueurs : analyseur local relancé ici ; repli sur l'état de l'agent.
analyseur="${CLAUDE_PLUGIN_ROOT:-$(cd "$(dirname "$0")/.." && pwd)}/scripts/scan.cs"
regles=".orchestrateur/code-health-rules.json"
source_bloqueurs="etat.json (agent)"
scan=""
code_scan=2
if [[ -f "$analyseur" ]] && command -v dotnet >/dev/null 2>&1; then
  scan="$(dotnet run --no-build "$analyseur" -- --base "$base" --regles "$regles" 2>/dev/null)"
  code_scan=$? # 0 = aucun bloqueur, 1 = bloqueurs, 2 = erreur
fi
if ((code_scan <= 1)) && jq -e '.bloqueurs' >/dev/null 2>&1 <<<"$scan"; then
  bloqueurs="$(jq -r '.bloqueurs[]' <<<"$scan" | sort -u)"
  source_bloqueurs="analyseur local"
else
  bloqueurs="$(jq -r '.bloqueurs[]? // empty' "$etat_fichier" | sort -u)"
fi

terminer() { rm -f "$compteur" "$compteur.precedent"; exit 0; }

[[ -z "$bloqueurs" ]] && terminer
((iteration >= MAX_ITERATIONS)) && terminer

# Pas de progrès : mêmes bloqueurs qu'au blocage précédent.
if [[ -f "$compteur.precedent" && "$(cat "$compteur.precedent")" == "$bloqueurs" ]]; then
  terminer
fi

blocages=$(($(cat "$compteur" 2>/dev/null || echo 0) + 1))
((blocages > MAX_BLOCAGES)) && terminer
echo "$blocages" >"$compteur"
echo "$bloqueurs" >"$compteur.precedent"

{
  echo "Hook CodeScene ($source_bloqueurs, base $base) : itération $iteration sur $MAX_ITERATIONS, bloqueurs restants :"
  sed 's/^/  - /' <<<"$bloqueurs"
  echo "Re-scanne avec l'analyseur local, corrige par petits pas sans changer le comportement, vérifie build et tests, puis écris l'itération suivante."
} >&2
exit 2
