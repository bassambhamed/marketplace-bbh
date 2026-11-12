---
description: Scan local en lecture seule (référentiel .orchestrateur/code-health-rules.json) des fichiers C# modifiés par la branche, sans aucune correction
argument-hint: "[base, défaut main]"
allowed-tools: Bash(git diff *), Bash(git status *), Bash(git log *), Bash(git branch *), Bash(dotnet build ${CLAUDE_PLUGIN_ROOT}/scripts/scan.cs*), Bash(dotnet run --no-build ${CLAUDE_PLUGIN_ROOT}/scripts/scan.cs *)
---
## Contexte
- Branche : !`git branch --show-current`
- Fichiers C# modifiés vs main : !`git diff --name-only main...HEAD -- '*.cs'`
- Non commités : !`git status --short -- '*.cs'`
- Base demandée : $ARGUMENTS (vide = `main`)

## Mission
Diagnostic **lecture seule** : tu ne modifies aucun fichier.

1. `dotnet build ${CLAUDE_PLUGIN_ROOT}/scripts/scan.cs` (analyseur local, hors ligne).
2. `dotnet run --no-build ${CLAUDE_PLUGIN_ROOT}/scripts/scan.cs -- --base <base>` : JSON avec `bloqueurs[]` et, par
   fichier, le rule set appliqué et le détail des violations (`methode`, `ligne`, `regle`, `valeur`, `seuil`,
   `valeurBase`, `bloquant`). Code 0 = aucun bloqueur, 1 = bloqueurs, 2 = erreur.
3. Pour chaque violation bloquante, lire la méthode (`fichier:ligne`) et proposer une correction sans changement de
   comportement.

## Format de sortie
Un tableau `gravité | fichier:ligne | méthode | règle | valeur / seuil (base) | correction proposée`, trié par
gravité : **bloqueur** (violation nouvelle ou aggravée), **dette** (violation déjà présente sur la base, inchangée).
Termine par un verdict en une ligne : « aucun bloqueur » ou « N bloqueurs », et propose `/codescene-sante <base>`
s'il y en a. Signale si la base choisie fait entrer dans le périmètre du travail d'une branche parente non fusionnée.
