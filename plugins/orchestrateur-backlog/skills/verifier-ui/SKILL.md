---
name: verifier-ui
description: Vérifie une page de l'interface dans un vrai navigateur à partir d'un fichier de critères, en déléguant chaque phase au sous-agent ui-verifier (serveur MCP Playwright). Demande à l'humain les actions sur les services entre deux phases, puis écrit un rapport avec une capture par état. À lancer après une modification de l'interface, application démarrée.
argument-hint: "<fichier de critères>"
disable-model-invocation: true
allowed-tools: Read, Edit(preuves/**), Bash(curl -sk *), Bash(git rev-parse *), Bash(git status *), Bash(mkdir -p preuves/*)
---
# Vérifier une interface dans le navigateur

Fichier de critères demandé : $ARGUMENTS
(obligatoire : s'il est vide, arrête-toi et demande-le).

Tu es le chef d'orchestre : tu ne pilotes **pas** le navigateur toi-même. Chaque phase est
vérifiée par le sous-agent `orchestrateur-backlog:ui-verifier`, dans son propre contexte : les captures y restent,
seul son tableau te revient.

## 1. Préparer
1. Lis le fichier de critères. Repère la page (ligne `Page :`), le dossier des captures
   (ligne `Captures :`, par défaut un dossier `captures/` à côté du fichier de critères) et les phases (titres
   `## Phase N · …`, chacune avec sa ligne `Avant :` et son tableau de critères).
   Si le fichier n'existe pas, arrête-toi et dis comment le créer.
2. Crée le dossier des captures (`mkdir -p`).
3. Vérifie que la page répond : `curl -sk -o /dev/null -w '%{http_code}\n' <page>`.
   Autre chose que 200 : arrête-toi et demande de démarrer l'application dans un autre
   terminal (par exemple `dotnet run --project <AppHost>`). Ne la démarre pas toi-même.

## 2. Pour chaque phase, dans l'ordre
1. **Avant** : si la ligne `Avant :` demande une action (arrêter ou redémarrer un service…),
   affiche-la telle quelle, puis **arrête-toi** et attends que l'utilisateur confirme qu'elle
   est faite. Ne fais jamais cette action toi-même : ni `kill`, ni `dotnet`, ni tableau de bord.
2. **Déléguer** : lance le sous-agent `orchestrateur-backlog:ui-verifier` avec une consigne autonome (il ne voit pas
   cette conversation) qui contient :
   - l'URL de la page et le nom de la phase ;
   - les critères de la phase, recopiés **mot pour mot** avec leurs identifiants ;
   - le dossier des captures et le préfixe `p<N>` (phase N) ;
   - les données attendues, si le fichier en décrit.
3. **Recevoir** : garde son tableau tel quel. Ne revérifie pas toi-même et n'ouvre pas les
   captures : elles coûtent cher en contexte, le tableau suffit.
4. **Consigner** : ajoute la phase au rapport (voir 3), puis passe à la phase suivante.

Si le sous-agent signale que les outils `mcp__plugin_orchestrateur-backlog_playwright__*` sont absents, arrête-toi :
le serveur MCP `plugin:orchestrateur-backlog:playwright` n'est pas connecté (`/mcp` pour le vérifier).

## 3. Le rapport
Écris `verification-ui.md` dans le dossier du fichier de critères. En tête : la date, la
page, le commit (`git rev-parse --short HEAD`) et la mention « modifications non commitées »
si `git status --short` en montre hors du dossier des preuves. Puis, pour chaque phase vérifiée,
son titre et le tableau du sous-agent avec ses constats hors critères. En fin de rapport : le
nombre de critères OK, KO et non vérifiés, et le verdict global.

## Restitution
Le verdict global, puis les critères KO ou non vérifiés avec ce qu'a observé le sous-agent.
Propose une piste de correction pour chaque KO, mais ne modifie pas le code : c'est une
vérification, la décision revient à l'humain.
