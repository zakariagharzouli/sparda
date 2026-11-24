# SPARDA visual guide

[Project README](../../README.md) · [Guide en français](../../docs/SPARDA-EXPLIQUE.md) · [Benchmark data](../../bench/route-proof.json)

Ten illustrations from Residual Labs cover the compiler, the behavior graph and the checks that use it. The captions are bilingual. The artwork is in English.

| Illustration | Illustration |
| --- | --- |
| ![SPARDA overview showing compilation, proof obligations and regression checks / Présentation de la compilation, des obligations de preuve et du contrôle des régressions](01-overview.png) | ![Illustrative authorization regression that can still compile / Exemple de régression d’autorisation qui peut passer la compilation](02-problem.png) |
| ![Supported source and contract inputs compiled into a behavior graph / Compilation des sources et contrats pris en charge en graphe de comportement](03-compiler.png) | ![Illustrative behavior graph with entry point, guard, logic, effect and state nodes / Graphe illustratif à cinq types de nœuds](04-ubg.png) |
| ![Comparison of a reference graph with the graph after a code edit / Comparaison du graphe de référence avec celui du code modifié](05-agent-gate.png) | ![Five static proof obligations checked by Apocalypse / Cinq obligations de preuve statiques vérifiées par Apocalypse](06-apocalypse.png) |
| ![Proof verdicts and how coverage limits their scope / Verdicts et limites de leur périmètre de couverture](07-verdicts.png) | ![Recorded request effects used to replay a failure and evaluate a fix / Relecture des effets d’une requête pour évaluer un correctif](08-timeless-heal.png) |
| ![One behavior graph with prover, mirror and optional MCP runtime outputs / Un graphe pour le moteur de preuve, le miroir et le runtime MCP facultatif](09-runtime.png) | ![The recorded benchmark compiled 579 Dub routes, 281 Immich routes and 477 Medusa routes / Le banc publié a compilé 579 routes Dub, 281 Immich et 477 Medusa](10-benchmark.png) |

The route counts describe compiler coverage in the recorded benchmark. Proof verdicts are reported separately for each repository. See the [benchmark protocol](../../bench/README.md) and [recorded results](../../bench/route-proof.json).

Les nombres de routes décrivent la couverture du compilateur dans ce banc. Le verdict de preuve est indiqué séparément pour chaque dépôt. [Protocole](../../bench/README.md) · [Résultats enregistrés](../../bench/route-proof.json)
