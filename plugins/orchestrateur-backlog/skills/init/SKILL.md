---
description: Prépare le dépôt courant pour le plugin orchestrateur-backlog — crée .orchestrateur/config.json (routes ticket → agent) et .orchestrateur/code-health-rules.json à partir des modèles du plugin, vérifie les prérequis et propose les permissions à ajouter. N'écrase rien d'existant.
argument-hint: "[--force pour remplacer les fichiers existants]"
disable-model-invocation: true
allowed-tools: Bash(mkdir -p .orchestrateur), Bash(cp ${CLAUDE_PLUGIN_ROOT}/config/* .orchestrateur/*), Bash(git rev-parse *), Bash(gh auth status*), Bash(gh repo view *), Bash(command -v *), Bash(dotnet --version), Bash(node --version), Read
---
# Initialiser l'orchestrateur dans ce dépôt

Arguments : $ARGUMENTS

1. Vérifie qu'on est à la racine d'un dépôt git (`git rev-parse --show-toplevel`) ; sinon arrête-toi.
2. `mkdir -p .orchestrateur`, puis copie **sans écraser** (sauf `--force`) :
   - `${CLAUDE_PLUGIN_ROOT}/config/orchestrateur.json` → `.orchestrateur/config.json`
   - `${CLAUDE_PLUGIN_ROOT}/config/code-health-rules.json` → `.orchestrateur/code-health-rules.json`
   Un fichier déjà présent est conservé : dis-le.
3. Prérequis (rends un tableau outil | état) : `gh auth status`, `gh repo view --json nameWithOwner`,
   `command -v jq git node dotnet`, `dotnet --version`, `node --version`.
4. Montre `.orchestrateur/config.json` et explique en 5 lignes comment adapter `routes[]` (mots-clés, branche,
   `basePR`, `criteres`, `baseAnalyse`) et les commandes `build` / `tests`. Modèle de critères :
   `${CLAUDE_PLUGIN_ROOT}/config/criteres-exemple.md` (le fichier de critères doit contenir une section
   `Périmètre`).
5. Propose (sans les écrire) les permissions à ajouter dans `.claude/settings.local.json` pour éviter les
   confirmations répétées : celles listées dans le README du plugin, section « Permissions conseillées ».
6. Termine par : « Lancez `claude --agent orchestrateur-backlog:orchestrateur` ».
