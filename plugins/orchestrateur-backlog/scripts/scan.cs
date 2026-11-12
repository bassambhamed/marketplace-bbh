#:package Microsoft.CodeAnalysis.CSharp@5.0.0
#:property PublishAot=false
// Analyseur local de santé du code, piloté par le référentiel .orchestrateur/code-health-rules.json.
// Remplace le moteur CodeScene (qui exige une licence) : aucun compte, aucun réseau.
//
// Usage (depuis la racine du dépôt) :
//   dotnet run <plugin>/scripts/scan.cs -- [--base main] [--fichier <chemin>] [--regles <json>]
// Sortie : JSON sur stdout. Code 0 = aucun bloqueur, 1 = bloqueurs, 2 = erreur.
//
// Règles appliquées, par méthode (méthodes, constructeurs, fonctions locales, accesseurs) :
//   lignes          function_lines_of_code_warning           (règle « Large Method »)
//   complexité      function_cyclomatic_complexity_warning   (règle « Complex Method »)
//   imbrication     function_nesting_depth_warning           (règle « Deep, Nested Complexity »)
//   condition       function_complex_conditional_branches_warning (règle « Complex Conditional »)
// Premier rule set dont matching_content_path correspond = seul appliqué ; seuils absents = défauts C# de CodeScene.
// Une règle de poids 0 désactive le contrôle correspondant.
//
// Bloqueur (gate du diff) : violation absente de la version de base (merge-base avec --base),
// ou dont la valeur a empiré. La dette déjà présente sur la base n'est pas un bloqueur.
// Conception : codescene/agent-codescene.md.
using System.Diagnostics;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp;
using Microsoft.CodeAnalysis.CSharp.Syntax;

var options = ParseArgs(args);
var racine = Git("rev-parse --show-toplevel")?.Trim();
if (string.IsNullOrEmpty(racine)) { Console.Error.WriteLine("Pas un dépôt Git."); return 2; }
Directory.SetCurrentDirectory(racine);

var cheminRegles = options.GetValueOrDefault("regles", ".orchestrateur/code-health-rules.json");
if (!File.Exists(cheminRegles)) { Console.Error.WriteLine($"Référentiel introuvable : {cheminRegles}"); return 2; }
var referentiel = Referentiel.Charger(cheminRegles);

var baseRef = options.GetValueOrDefault("base", "main");
var mergeBase = Git($"merge-base {baseRef} HEAD")?.Trim();
if (string.IsNullOrEmpty(mergeBase)) { Console.Error.WriteLine($"Base introuvable : {baseRef}"); return 2; }

List<string> fichiers;
if (options.TryGetValue("fichier", out var unFichier))
{
    fichiers = [Path.GetRelativePath(racine, Path.GetFullPath(unFichier)).Replace('\\', '/')];
}
else
{
    // Committé depuis la base + modifié non committé + nouveau non suivi.
    var noms = (Git($"diff --name-only {mergeBase}") ?? "").Split('\n')
        .Concat((Git("ls-files --others --exclude-standard") ?? "").Split('\n'));
    // Outillage local (dossiers cachés : .claude/, .codescene/…) hors périmètre : seul le code du projet compte.
    fichiers = noms.Select(n => n.Trim())
        .Where(n => n.EndsWith(".cs") && !n.StartsWith('.') && File.Exists(n))
        .Distinct().Order().ToList();
}

var resultats = new JsonArray();
var bloqueurs = new SortedSet<string>();
foreach (var chemin in fichiers)
{
    var regles = referentiel.Pour(chemin);
    var actuelles = Analyser(File.ReadAllText(chemin), regles);
    var source = Git($"show {mergeBase}:{chemin}", silencieux: true);
    var deBase = source is null ? null : Analyser(source, regles);

    var violations = new JsonArray();
    var bloquant = false;
    foreach (var v in actuelles)
    {
        var avant = deBase?.FirstOrDefault(b => b.Methode == v.Methode && b.Regle == v.Regle);
        var estBloquant = avant is null || v.Valeur > avant.Valeur;
        bloquant |= estBloquant;
        violations.Add(new JsonObject
        {
            ["methode"] = v.Methode,
            ["ligne"] = v.Ligne,
            ["regle"] = v.Regle,
            ["valeur"] = v.Valeur,
            ["seuil"] = v.Seuil,
            ["valeurBase"] = avant?.Valeur,
            ["bloquant"] = estBloquant,
        });
    }
    if (bloquant) bloqueurs.Add(chemin);
    resultats.Add(new JsonObject
    {
        ["chemin"] = chemin,
        ["ruleSet"] = regles.Motif,
        ["nouveau"] = source is null,
        ["violations"] = violations.Count,
        ["violationsBase"] = deBase?.Count ?? 0,
        ["bloquant"] = bloquant,
        ["details"] = violations,
    });
}

var sortie = new JsonObject
{
    ["outil"] = "sante-locale",
    ["referentiel"] = cheminRegles,
    ["base"] = baseRef,
    ["mergeBase"] = mergeBase,
    ["date"] = DateTimeOffset.UtcNow.ToString("o"),
    ["bloqueurs"] = new JsonArray(bloqueurs.Select(b => (JsonNode)JsonValue.Create(b)!).ToArray()),
    ["fichiers"] = resultats,
};
Console.WriteLine(sortie.ToJsonString(new JsonSerializerOptions { WriteIndented = true, Encoder = System.Text.Encodings.Web.JavaScriptEncoder.UnsafeRelaxedJsonEscaping }));
return bloqueurs.Count == 0 ? 0 : 1;

// ---------------------------------------------------------------------------------------------

static List<Violation> Analyser(string code, ReglesFichier regles)
{
    var resultat = new List<Violation>();
    if (regles.Ignore) return resultat;
    var arbre = CSharpSyntaxTree.ParseText(code);
    foreach (var noeud in arbre.GetRoot().DescendantNodes())
    {
        var (nom, corps) = noeud switch
        {
            MethodDeclarationSyntax m => (m.Identifier.Text, (SyntaxNode?)m.Body ?? m.ExpressionBody),
            ConstructorDeclarationSyntax c => (c.Identifier.Text + ".ctor", (SyntaxNode?)c.Body ?? c.ExpressionBody),
            LocalFunctionStatementSyntax l => (l.Identifier.Text, (SyntaxNode?)l.Body ?? l.ExpressionBody),
            AccessorDeclarationSyntax a when a.Parent?.Parent is BasePropertyDeclarationSyntax p =>
                ($"{(p as PropertyDeclarationSyntax)?.Identifier.Text ?? "this"}.{a.Keyword.Text}", (SyntaxNode?)a.Body ?? a.ExpressionBody),
            _ => (null, null),
        };
        if (nom is null || corps is null) continue;

        var type = noeud.Ancestors().OfType<BaseTypeDeclarationSyntax>().FirstOrDefault()?.Identifier.Text ?? "";
        var methode = string.IsNullOrEmpty(type) ? nom : $"{type}.{nom}";
        var ligne = noeud.GetLocation().GetLineSpan().StartLinePosition.Line + 1;

        var span = noeud.GetLocation().GetLineSpan();
        var lignes = span.EndLinePosition.Line - span.StartLinePosition.Line + 1;
        var complexite = Complexite(corps);
        var imbrication = Imbrication(corps, 0);
        var condition = corps.DescendantNodesAndSelf().Where(EstCondition)
            .Select(c => c.DescendantNodesAndSelf().Count(n => n.IsKind(SyntaxKind.LogicalAndExpression) || n.IsKind(SyntaxKind.LogicalOrExpression)))
            .DefaultIfEmpty(0).Max();

        void Verifier(string regle, int valeur, int? seuil, bool depasse)
        {
            if (seuil is int s && depasse) resultat.Add(new Violation(methode, ligne, regle, valeur, s));
        }
        Verifier("Large Method", lignes, regles.Lignes, lignes > regles.Lignes);
        Verifier("Complex Method", complexite, regles.Complexite, complexite > regles.Complexite);
        Verifier("Deep, Nested Complexity", imbrication, regles.Imbrication, imbrication > regles.Imbrication);
        Verifier("Complex Conditional", condition, regles.Condition, condition >= regles.Condition);
    }
    return resultat;
}

// Expressions de décision : conditions de if/while/do/for/?: et clauses when.
static bool EstCondition(SyntaxNode n) => n.Parent switch
{
    IfStatementSyntax s => s.Condition == n,
    WhileStatementSyntax s => s.Condition == n,
    DoStatementSyntax s => s.Condition == n,
    ForStatementSyntax s => s.Condition == n,
    ConditionalExpressionSyntax s => s.Condition == n,
    WhenClauseSyntax s => s.Condition == n,
    _ => false,
};

static int Complexite(SyntaxNode corps) => 1 + corps.DescendantNodesAndSelf().Count(n => n.Kind() switch
{
    SyntaxKind.IfStatement or SyntaxKind.WhileStatement or SyntaxKind.DoStatement or SyntaxKind.ForStatement
        or SyntaxKind.ForEachStatement or SyntaxKind.ForEachVariableStatement or SyntaxKind.CatchClause
        or SyntaxKind.ConditionalExpression or SyntaxKind.CaseSwitchLabel or SyntaxKind.CasePatternSwitchLabel
        or SyntaxKind.SwitchExpressionArm or SyntaxKind.LogicalAndExpression or SyntaxKind.LogicalOrExpression
        or SyntaxKind.CoalesceExpression or SyntaxKind.CoalesceAssignmentExpression => true,
    _ => false,
});

// Profondeur maximale de structures de contrôle imbriquées ; un « else if » reste au même niveau.
static int Imbrication(SyntaxNode noeud, int profondeur)
{
    var max = profondeur;
    foreach (var enfant in noeud.ChildNodes())
    {
        var ouvre = enfant switch
        {
            IfStatementSyntax i => i.Parent is not ElseClauseSyntax,
            WhileStatementSyntax or DoStatementSyntax or ForStatementSyntax or ForEachStatementSyntax
                or ForEachVariableStatementSyntax or SwitchStatementSyntax or TryStatementSyntax => true,
            _ => false,
        };
        // Les lambdas et fonctions locales repartent de zéro : elles sont mesurées à part (ou dans leur méthode).
        if (enfant is LocalFunctionStatementSyntax) continue;
        max = Math.Max(max, Imbrication(enfant, ouvre ? profondeur + 1 : profondeur));
    }
    return max;
}

static string? Git(string arguments, bool silencieux = false)
{
    var psi = new ProcessStartInfo("git", arguments) { RedirectStandardOutput = true, RedirectStandardError = true };
    using var p = Process.Start(psi)!;
    var sortie = p.StandardOutput.ReadToEnd();
    var erreur = p.StandardError.ReadToEnd();
    p.WaitForExit();
    if (p.ExitCode != 0) { if (!silencieux) Console.Error.WriteLine(erreur.Trim()); return null; }
    return sortie;
}

static Dictionary<string, string> ParseArgs(string[] args)
{
    var d = new Dictionary<string, string>();
    for (var i = 0; i < args.Length - 1; i++)
        if (args[i].StartsWith("--")) d[args[i][2..]] = args[++i];
    return d;
}

record Violation(string Methode, int Ligne, string Regle, int Valeur, int Seuil);

record ReglesFichier(string Motif, bool Ignore, int? Lignes, int? Complexite, int? Imbrication, int? Condition);

class Referentiel
{
    // Défauts C# de CodeScene (rules_config_list_thresholds "C#", relevés le 2026-11-11).
    const int DefautLignes = 70, DefautComplexite = 10, DefautImbrication = 4, DefautCondition = 2;
    readonly List<(Regex Motif, string Brut, JsonObject Jeu)> _jeux = [];

    public static Referentiel Charger(string chemin)
    {
        var r = new Referentiel();
        var racine = JsonNode.Parse(File.ReadAllText(chemin))!.AsObject();
        foreach (var jeu in racine["rule_sets"]!.AsArray())
        {
            var motif = jeu!["matching_content_path"]!.GetValue<string>();
            r._jeux.Add((GlobVersRegex(motif), motif, jeu.AsObject()));
        }
        return r;
    }

    public ReglesFichier Pour(string chemin)
    {
        var trouve = _jeux.FirstOrDefault(j => j.Motif.IsMatch(chemin));
        if (trouve.Jeu is null) return new("(défaut)", false, DefautLignes, DefautComplexite, DefautImbrication, DefautCondition);

        double Poids(string regle) => trouve.Jeu["rules"]?.AsArray()
            .FirstOrDefault(x => x?["name"]?.GetValue<string>() == regle)?["weight"]?.GetValue<double>() ?? 1.0;
        int Seuil(string nom, int defaut) => trouve.Jeu["thresholds"]?.AsArray()
            .FirstOrDefault(x => x?["name"]?.GetValue<string>() == nom)?["value"]?.GetValue<int>() ?? defaut;
        int? Actif(string regle, string seuil, int defaut) => Poids(regle) == 0 ? null : Seuil(seuil, defaut);

        var lignes = Actif("Large Method", "function_lines_of_code_warning", DefautLignes);
        var complexite = Actif("Complex Method", "function_cyclomatic_complexity_warning", DefautComplexite);
        var imbrication = Actif("Deep, Nested Complexity", "function_nesting_depth_warning", DefautImbrication);
        var condition = Actif("Complex Conditional", "function_complex_conditional_branches_warning", DefautCondition);
        // Code généré : taille et complexité neutralisées → fichier ignoré.
        var ignore = lignes is null && complexite is null;
        return new(trouve.Brut, ignore, lignes, complexite, imbrication, condition);
    }

    static Regex GlobVersRegex(string glob)
    {
        var s = Regex.Escape(glob)
            .Replace(@"\*\*/", "(?:.*/)?")
            .Replace(@"/\*\*", "(?:/.*)?")
            .Replace(@"\*\*", ".*")
            .Replace(@"\*", "[^/]*")
            .Replace(@"\?", "[^/]");
        return new Regex($"^{s}$");
    }
}
