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
| `orchestrateur-backlog:kubernetes` | Cluster k3d d'un environnement (dev ou prod) : création, vérification des manifests, déploiement | orange |

Tous les agents utilisent le modèle `claude-opus-5-5`.

## Contenu

```
orchestrateur-backlog/
├── .claude-plugin/plugin.json
├── agents/          orchestrateur, ui-refonte, codescene-sante, ui-verifier, kubernetes
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
- Pour l'agent `kubernetes` : Docker, `k3d` et `kubectl` (`kubeconform` est optionnel : sans lui, l'étape de
  validation de schéma est signalée comme non faite).

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

Vérification : `claude plugin list` doit montrer `orchestrateur-backlog`, `/agents` les cinq agents et `/mcp`
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

### 4. Déployer sur un cluster k3d (agent `kubernetes`)

L'agent `kubernetes` ne passe pas par l'orchestrateur : on le lance directement, en **nommant
l'environnement** (`dev` ou `prod`). Sans environnement, il pose la question au lieu de deviner.

```text
Utilise l'agent orchestrateur-backlog:kubernetes sur l'environnement dev.
```

Il crée (ou réutilise) le cluster `ecommerce-<env>`, écrit ou relit les manifests Kustomize
(`k8s/base`, `k8s/overlays/<env>`), les vérifie (rendu, `--dry-run` client puis serveur, critères de
sécurité), importe les images locales `ecommerce/<service>:1.0`, déploie, attend les rollouts et prouve le
résultat par un test de fumée. Il rend un tableau de vérification des manifests et les adresses d'accès.

| | dev | prod |
|---|---|---|
| Cluster / namespace | `ecommerce-dev` | `ecommerce-prod` |
| Nœuds | 1 server, 1 agent | 1 server, 2 agents |
| Entrée | `http://localhost:8081` | `http://localhost:8082` |
| Réplicas | 1 | 2 |
| Sondes | HTTP `/alive`, `/health` (Development) | TCP sur 8080 |
| Ressources, durcissement | requests | requests et limits, `drop ALL`, seccomp |

Il ne travaille que sur les contextes `k3d-ecommerce-*` : les autres clusters du kubeconfig ne sont jamais
touchés, et le contexte courant de l'utilisateur ne change pas. La suppression d'un cluster n'a lieu que sur
demande explicite. Il suppose la structure du dépôt ECommerce (services `catalog`, `ordering`, `gateway`,
`web`, Dockerfile par service, port 8080).

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

Pour l'agent `kubernetes`, ajoutez (adaptez) :

```json
{
  "permissions": {
    "allow": [
      "Bash(docker build *)", "Bash(docker image inspect *)", "Bash(k3d version)", "Bash(k3d cluster list *)",
      "Bash(k3d image import *)", "Bash(kubectl get *)", "Bash(kubectl describe *)", "Bash(kubectl logs *)",
      "Bash(kubectl kustomize *)", "Bash(kubectl diff *)", "Bash(kubectl apply *--dry-run*)",
      "Bash(kubectl rollout status *)", "Bash(kubectl apply -k * --context k3d-ecommerce-*)",
      "Bash(kubectl rollout restart * --context k3d-ecommerce-*)"
    ],
    "ask": ["Bash(k3d cluster create *)", "Bash(k3d cluster delete *)", "Bash(kubectl delete *)"],
    "deny": [
      "Bash(kubectl get secret*)", "Bash(kubectl config view *)", "Bash(kubectl config use-context *)",
      "Bash(k3d kubeconfig *)", "Bash(k3d cluster delete --all*)", "Read(~/.kube/**)"
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
- `kubernetes` n'écrit que dans les contextes `k3d-ecommerce-*`, ne lit jamais un Secret ni le kubeconfig, ne
  commite ni ne pousse rien, et ne supprime un cluster que sur demande explicite.

## Limites connues

- L'analyseur de santé du code ne mesure que le C# (taille, complexité, imbrication, conditions complexes).
- Le serveur Playwright démarre dès que le plugin est activé ; désactivez-le dans `/mcp` si vous n'en avez pas
  besoin.
- `ui-verifier` n'est pas lancé par l'orchestrateur : la recette demande des actions humaines (arrêter un
  service, etc.).
- `kubernetes` n'est pas non plus routé par l'orchestrateur : il a besoin de l'environnement (dev ou prod) et de
  confirmations humaines (création et suppression de cluster).
