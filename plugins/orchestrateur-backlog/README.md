# Plugin `orchestrateur-backlog`

Orchestrateur de backlog pour Claude Code. Il lit les issues GitHub ouvertes du dépôt, confie chaque ticket au bon
sous-agent, vérifie le build et les tests, commite, ouvre **une pull request par issue** (`Closes #n`) et produit un
**rapport HTML** du travail de chaque sous-agent.

| Agent | Rôle | Couleur |
|---|---|---|
| `orchestrateur-backlog:orchestrateur` | Lit les issues, route, contrôle, commite, ouvre les PR, rapport | violet |
| `orchestrateur-backlog:ui-refonte` | Refonte frontend à partir d'un fichier de critères observables | bleu |
| `orchestrateur-backlog:codescene-sante` | Santé du code : scan local → refactorings → re-scan jusqu'à zéro bloqueur | vert |
| `orchestrateur-backlog:ui-verifier` | Recette dans un vrai navigateur (Playwright), sans modifier le code | cyan |

Tous les agents utilisent le modèle `claude-opus-5-5`.

## Contenu

```
orchestrateur-backlog/
├── .claude-plugin/plugin.json
├── agents/          orchestrateur, ui-refonte, codescene-sante, ui-verifier
├── skills/          init, codescene-sante, codescene-scan, verifier-ui
├── hooks/hooks.json SubagentStop : relance codescene-sante tant qu'il reste des bloqueurs
├── scripts/         scan.cs (analyseur Roslyn hors ligne), codescene-boucle.sh,
│                    rapport-codescene.mjs, rapport-orchestrateur.mjs
├── config/          modèles : orchestrateur.json, code-health-rules.json, criteres-exemple.md, modele-pr.md
└── .mcp.json        serveur Playwright (pour ui-verifier)
```

## Prérequis sur le poste du collaborateur

- Claude Code à jour, connecté.
- `git`, `jq`, Node.js 20 ou plus, et la CLI GitHub `gh` authentifiée (`gh auth login`) avec le droit d'écrire
  sur le dépôt (push, PR).
- Pour la santé du code : SDK .NET 10 (`dotnet`). Au premier lancement, l'analyseur télécharge le paquet NuGet
  `Microsoft.CodeAnalysis.CSharp` (une seule fois, ensuite hors ligne).
- Pour la recette navigateur : Google Chrome (utilisé par Playwright).
- Docker si les tests du projet utilisent Testcontainers.

## Installation

Dans Claude Code :

```text
/plugin marketplace add bassambhamed/marketplace-bbh
/plugin install orchestrateur-backlog@marketplace-bbh
/reload-plugins
```

Ou depuis un terminal :

```bash
claude plugin marketplace add bassambhamed/marketplace-bbh
claude plugin install orchestrateur-backlog@marketplace-bbh            # pour soi (scope user)
claude plugin install orchestrateur-backlog@marketplace-bbh --scope project   # pour tout le dépôt
```

Vérification : `claude plugin list` doit montrer `orchestrateur-backlog`, `/agents` les quatre agents et `/mcp`
le serveur `plugin:orchestrateur-backlog:playwright`.

### Pour toute une équipe

Commitez dans le `.claude/settings.json` du projet :

```json
{
  "extraKnownMarketplaces": {
    "marketplace-bbh": { "source": { "source": "github", "repo": "bassambhamed/marketplace-bbh" } }
  },
  "enabledPlugins": { "orchestrateur-backlog@marketplace-bbh": true }
}
```

Chaque collaborateur fait ensuite une fois, dans sa copie du dépôt :
`claude plugin install orchestrateur-backlog@marketplace-bbh --scope project`.

### Mettre à jour

```bash
claude plugin marketplace update marketplace-bbh
claude plugin update orchestrateur-backlog@marketplace-bbh
```

## Utilisation

### 1. Préparer le dépôt (une fois)

Dans Claude Code, à la racine du dépôt : `/orchestrateur-backlog:init`. Cela crée :

- `.orchestrateur/config.json` : les **routes** ticket → agent ;
- `.orchestrateur/code-health-rules.json` : le référentiel de santé du code (seuils par dossier).

Adaptez `config.json` :

```json
{
  "depot": "",                       // vide = dépôt courant (gh repo view)
  "brancheParDefaut": "main",
  "regles": ".orchestrateur/code-health-rules.json",
  "build": "dotnet build",
  "tests": "dotnet test",
  "routes": [
    { "agent": "ui-refonte", "motsCles": ["frontend", "UI", "CSS"], "branche": "feat/frontend",
      "basePR": "main", "criteres": ["preuves/ui/criteres.md"] },
    { "agent": "codescene-sante", "motsCles": ["santé du code", "CodeScene"], "branche": "chore/code-health",
      "basePR": "main", "baseAnalyse": "main" }
  ]
}
```

(Les commentaires `//` ci-dessus sont explicatifs : le vrai fichier est du JSON pur.)

Pour le frontend, écrivez un **fichier de critères** observables (modèle : `config/criteres-exemple.md`). Il doit
contenir une ligne `Page :`, une section `Périmètre` (fichiers que l'agent a le droit de modifier) et des tableaux
de critères identifiés (`M1`, `F2`…).

### 2. Écrire les tickets

Une issue GitHub par sujet. L'orchestrateur choisit l'agent d'après les mots-clés des routes (titre, description,
labels). Dans la description, vous pouvez imposer la branche (`Branche : \`feat/frontend\``) et citer les fichiers
de critères (`preuves/ui/criteres.md`).

### 3. Lancer l'orchestrateur

L'orchestrateur doit être l'**agent principal** de la session (un sous-agent ne peut pas en lancer d'autres) :

```bash
claude --agent orchestrateur-backlog:orchestrateur
```

puis : `Traite les issues ouvertes du backlog.` (ou `Traite seulement #3`).

Vous verrez l'orchestrateur en violet annoncer son plan, puis les sous-agents en bleu et en vert, l'un après
l'autre. Chaque `git push` et chaque `gh pr create` peut vous demander une confirmation. À la fin :

- une PR par issue traitée (`Closes #n`) ;
- `artifacts/orchestrateur/<RUN>/rapport.html` : une section par ticket, à la couleur de son agent (statut,
  commit, PR, build, tests, critères implémentés ou bloqueurs avant → après, fichiers, écarts) ;
- pour la santé du code : `artifacts/codescene/<RUN>/rapport.html`.

Ajoutez `artifacts/` à votre `.gitignore`.

### Commandes utiles hors orchestrateur

| Commande | Effet |
|---|---|
| `/orchestrateur-backlog:codescene-scan [base]` | Diagnostic santé du code en lecture seule |
| `/orchestrateur-backlog:codescene-sante [base]` | Boucle de correction sur la branche courante, avec rapport |
| `/orchestrateur-backlog:verifier-ui <critères>` | Recette navigateur en phases avec `ui-verifier` (application démarrée) |

## Permissions conseillées

Un plugin ne peut pas fournir de règles de permission. Pour éviter les confirmations répétées, ajoutez dans
`.claude/settings.local.json` du projet (adaptez) :

```json
{
  "permissions": {
    "allow": [
      "Bash(gh issue list *)", "Bash(gh issue view *)", "Bash(gh pr list *)", "Bash(gh repo view *)",
      "Bash(git status *)", "Bash(git switch *)", "Bash(git add *)", "Bash(git commit *)",
      "Bash(dotnet build *)", "Bash(dotnet test *)", "Bash(dotnet run --no-build *)", "Bash(node *)",
      "Bash(mkdir -p artifacts/*)", "Bash(date *)"
    ],
    "ask": ["Bash(git push *)", "Bash(gh pr create *)"],
    "deny": [
      "Bash(git push --force *)", "Bash(git push -f *)", "Bash(gh pr merge *)",
      "Edit(./.orchestrateur/**)", "Write(./.orchestrateur/**)",
      "mcp__plugin_orchestrateur-backlog_playwright__browser_evaluate",
      "mcp__plugin_orchestrateur-backlog_playwright__browser_run_code_unsafe"
    ]
  }
}
```

## Garde-fous

- Les tickets sont traités **un par un** ; l'orchestrateur s'arrête si l'arbre de travail n'est pas propre.
- Pas de commit ni de PR si le build ou les tests sont rouges.
- Jamais de force push, de fusion de PR ni de modification d'issue.
- `codescene-sante` ne touche ni aux tests, ni aux migrations, ni au référentiel ; le hook borne la boucle à
  5 itérations (`CLAUDE_SKIP_CODESCENE_LOOP=1` pour la couper).
- `ui-refonte` ne modifie que les fichiers listés dans la section `Périmètre` des critères.

## Limites connues

- L'analyseur de santé du code ne mesure que le C# (taille, complexité, imbrication, conditions complexes).
- Le serveur Playwright démarre dès que le plugin est activé ; désactivez-le dans `/mcp` si vous n'en avez pas
  besoin.
- `ui-verifier` n'est pas lancé par l'orchestrateur : la recette demande des actions humaines (arrêter un
  service, etc.).
