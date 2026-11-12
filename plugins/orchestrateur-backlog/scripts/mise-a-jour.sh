#!/usr/bin/env bash
# Hooks SessionStart et UserPromptSubmit : préviennent l'utilisateur qu'une version plus récente du plugin
# orchestrateur-backlog est publiée et lancent la mise à jour en arrière-plan.
# Fait partie du plugin orchestrateur-backlog (hooks/hooks.json).
#
# Usage : mise-a-jour.sh verifier   (SessionStart)      compare les versions, lance la mise à jour
#         mise-a-jour.sh terminer   (UserPromptSubmit)  annonce la fin, demande /reload-plugins
#
# - Version installée : .claude-plugin/plugin.json du plugin en cours d'exécution.
# - Version publiée   : le même fichier sur la branche main du marketplace (GitHub, lecture seule).
# - Si elle est plus récente, lance en arrière-plan :
#     claude plugin marketplace update marketplace-bbh
#     claude plugin update orchestrateur-backlog@marketplace-bbh
#   `/reload-plugins` est une commande de session : un script ne peut pas la taper. Le hook "terminer" prévient
#   l'utilisateur dès que la mise à jour est finie.
# - Silencieux hors ligne, sans `claude` dans le PATH (alors il affiche les commandes à lancer) ou sans nouvelle
#   version. Une vérification au plus toutes les 6 h ; une seule mise à jour lancée par version.
# - Aucune donnée sur l'utilisateur ou son projet n'est envoyée : une requête GET anonyme du fichier public.
# - Échappatoire : ORCH_SKIP_MAJ=1.
set -uo pipefail

PLUGIN="orchestrateur-backlog"
MARKETPLACE="marketplace-bbh"
URL="${ORCH_MAJ_URL:-https://raw.githubusercontent.com/bassambhamed/marketplace-bbh/main/plugins/${PLUGIN}/.claude-plugin/plugin.json}"
INTERVALLE="${ORCH_MAJ_INTERVALLE:-21600}"

[[ -n "${ORCH_SKIP_MAJ:-}" ]] && exit 0
cat >/dev/null 2>&1 || true # l'entrée JSON du hook n'est pas utilisée

racine="${CLAUDE_PLUGIN_ROOT:-$(cd "$(dirname "$0")/.." && pwd)}"
donnees="${CLAUDE_PLUGIN_DATA:-${TMPDIR:-/tmp}/claude-${PLUGIN}}"
mkdir -p "$donnees" 2>/dev/null || exit 0
command -v jq >/dev/null 2>&1 || exit 0

version_installee="$(jq -r '.version // empty' "$racine/.claude-plugin/plugin.json" 2>/dev/null)"
[[ -n "$version_installee" ]] || exit 0

# plus_recente A B : code 0 si A est strictement plus récente que B (x.y.z, suffixe -pre ignoré).
plus_recente() {
  local a b i
  IFS=. read -ra a <<<"${1%%-*}"
  IFS=. read -ra b <<<"${2%%-*}"
  for i in 0 1 2; do
    ((${a[i]:-0} > ${b[i]:-0})) && return 0
    ((${a[i]:-0} < ${b[i]:-0})) && return 1
  done
  return 1
}

# prevenir MESSAGE : affiche le message à l'utilisateur (champ systemMessage du hook).
prevenir() { jq -n --arg m "$1" '{systemMessage: $m}'; }

case "${1:-}" in
verifier)
  stamp="$donnees/derniere-verification"
  maintenant="$(date +%s)"
  derniere="$(cat "$stamp" 2>/dev/null || echo 0)"
  ((maintenant - derniere < INTERVALLE)) && exit 0

  version_publiee="$(curl -fsS --max-time 3 -A "${PLUGIN}-verification-version" "$URL" 2>/dev/null | jq -r '.version // empty' 2>/dev/null)"
  [[ -n "$version_publiee" ]] || exit 0 # hors ligne ou réponse illisible : on réessaiera
  echo "$maintenant" >"$stamp"
  plus_recente "$version_publiee" "$version_installee" || exit 0

  etat="$donnees/maj-$version_publiee.etat"
  [[ -e "$etat" ]] && exit 0 # déjà lancée pour cette version

  if ! command -v claude >/dev/null 2>&1; then
    prevenir "Plugin $PLUGIN : la version $version_publiee est disponible (installée : $version_installee). La commande claude est introuvable dans le PATH ; lancez : claude plugin marketplace update $MARKETPLACE && claude plugin update $PLUGIN@$MARKETPLACE, puis /reload-plugins."
    exit 0
  fi

  echo "en-cours" >"$etat"
  journal="$donnees/maj-$version_publiee.log"
  # Détachée : le hook rend la main tout de suite, la mise à jour continue seule.
  nohup bash -c '
    if claude plugin marketplace update "$1" && claude plugin update "$2@$1"; then
      echo termine >"$3"
    else
      echo echec >"$3"
    fi' _ "$MARKETPLACE" "$PLUGIN" "$etat" >"$journal" 2>&1 </dev/null &
  disown 2>/dev/null || true

  prevenir "Plugin $PLUGIN : la version $version_publiee est disponible (installée : $version_installee). Mise à jour lancée en arrière-plan ; je vous préviens à la fin, puis tapez /reload-plugins."
  ;;

terminer)
  for etat in "$donnees"/maj-*.etat; do
    [[ -e "$etat" ]] || continue
    version="${etat##*/maj-}"
    version="${version%.etat}"
    statut="$(cat "$etat" 2>/dev/null)"
    case "$statut" in
    termine)
      echo notifie >"$etat"
      # Déjà rechargée (ou session redémarrée) : rien à dire.
      plus_recente "$version" "$version_installee" || continue
      prevenir "Plugin $PLUGIN : la mise à jour vers la version $version est terminée. Tapez /reload-plugins pour l'activer dans cette session."
      ;;
    echec)
      echo echec-notifie >"$etat"
      prevenir "Plugin $PLUGIN : la mise à jour vers la version $version a échoué (journal : $donnees/maj-$version.log). Lancez à la main : claude plugin marketplace update $MARKETPLACE && claude plugin update $PLUGIN@$MARKETPLACE."
      ;;
    esac
  done
  ;;
esac
exit 0
