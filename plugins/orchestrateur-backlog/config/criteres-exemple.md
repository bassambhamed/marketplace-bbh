# Exemple de critères (projet ECommerce, habillage CSS) — modèle à copier et adapter

Page : https://localhost:7218/
Pages concernées : `/` (Home), `/products` (Catalog), `/orders` (Orders), menu latéral et barre du haut.
Captures : preuves/ui-moderne/captures/

Périmètre (fichiers modifiables) :
- `src/ECommerce.Web/wwwroot/app.css`
- `src/ECommerce.Web/Components/Layout/MainLayout.razor`, `MainLayout.razor.css`
- `src/ECommerce.Web/Components/Layout/NavMenu.razor`, `NavMenu.razor.css`
- `src/ECommerce.Web/Components/Pages/Home.razor`, `Products.razor`, `Orders.razor` et leurs `.razor.css` (à créer si besoin)
- `src/ECommerce.Web/README.md`

Hors périmètre : `App.razor`, `ReconnectModal.*`, `Error.razor`, `NotFound.razor`, `Services/**`, `Program.cs`,
`wwwroot/lib/**` (Bootstrap reste chargé tel quel), toute API. Aucun CDN, aucune police téléchargée, aucun JavaScript.

Contrainte de non-régression : **tous les critères de `preuves/lab5/criteres.md` restent vrais** sur `/orders`
(mêmes textes, rôles `status`/`alert`, noms accessibles, ordre de tabulation, focus après Échap et Clear filter).
Ne change ni la logique C# ni les textes visibles, seulement le balisage de présentation et le CSS.

## Phase 1 · Habillage

Avant : rien (l'application tourne).

| Id | Critère |
|---|---|
| M1 | **Jetons de design** : couleurs, rayons, ombres, espacements et typographie sont définis une seule fois en propriétés personnalisées CSS (`--…`) sur `:root` dans `app.css`, et réutilisés par les autres feuilles ; aucune couleur codée en dur hors de ces jetons (sauf `transparent`/`currentColor`). |
| M2 | **Thème sombre** : avec `prefers-color-scheme: dark`, fond, texte, cartes, menu et champs passent en sombre via la redéfinition des jetons ; le contraste texte/fond reste ≥ 4,5:1 dans les deux thèmes. |
| M3 | **Typographie** : pile de polices système (`system-ui, -apple-system, "Segoe UI", Roboto, …`), tailles de titres fluides avec `clamp()`, interlignage confortable (≈ 1,5 pour le texte). |
| M4 | **Menu latéral** : le dégradé violet par défaut du gabarit est remplacé par une surface sobre issue des jetons ; le lien actif est nettement distinct (fond ou barre d'accent) ; les icônes restent alignées. |
| M5 | **Mise en page** : contenu centré avec une largeur de lecture maximale ; les cartes de Home, la grille des produits et la liste des commandes utilisent CSS Grid (`repeat(auto-fill, minmax(…))`) au lieu de colonnes fixes. |
| M6 | **Cartes** : coins arrondis, ombre légère, bordure discrète ; au survol (souris) une élévation douce ; les badges de statut de commande ont une couleur sémantique lisible dans les deux thèmes. |
| M7 | **Interaction** : transitions courtes (≤ 200 ms) sur survol et focus, désactivées sous `prefers-reduced-motion: reduce` ; `:focus-visible` donne un anneau de focus net sur liens, boutons et champs, dans les deux thèmes. |
| M8 | **Responsive** : à 320 px de large, aucun défilement horizontal ; le menu se replie comme avant ; les boutons restent atteignables. |
| M9 | **Non-régression** : les critères F, K, V, E, R du lab 5 restent vrais ; le build et les tests existants passent ; aucun texte visible n'a changé. |
