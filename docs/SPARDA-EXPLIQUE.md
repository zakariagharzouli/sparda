# SPARDA expliqué simplement

**L'IA écrit. SPARDA prouve.**

SPARDA est un outil local et déterministe qui transforme le comportement visible d'un backend
en un graphe vérifiable. Il ne demande ni compte cloud, ni clé d'API, ni modèle de langage pour
produire son verdict.

## Le problème

Un changement peut continuer à compiler et à répondre `200` tout en ayant supprimé une garde,
exposé une route ou cassé un invariant. Une revue textuelle voit des lignes. SPARDA compare des
faits de comportement reliés entre eux.

## Ce que SPARDA fait

- il découvre les routes que ses analyseurs savent lire sans deviner ;
- il construit un Unified Behavior Graph (UBG) déterministe ;
- il relie, quand les preuves existent, routes, entrées, gardes et effets ;
- il compare un état de référence avec le changement courant ;
- il bloque une régression prouvée et rend les zones non démontrées visibles.

Commandes principales :

```bash
npx sparda-mcp ubg
npx sparda-mcp prove
npx sparda-mcp apocalypse
npx sparda-mcp gate --arm
npx sparda-mcp gate --hook
```

## La règle la plus importante

SPARDA ne transforme pas une absence de preuve en preuve d'absence. Si une construction est
dynamique, ambiguë ou hors du périmètre mesuré, elle reste partielle ou inconnue. Une preuve
positive doit conserver sa provenance ; sinon elle n'est pas émise.

## Couverture réelle

Les analyseurs couvrent plusieurs formes Express, FastAPI, Flask, Next.js, NestJS et Medusa,
ainsi que les contrats OpenAPI. Cela ne signifie pas que toute application utilisant ces
frameworks est comprise à 100 %. Le rapport produit pour chaque dépôt reste l'autorité.

Le benchmark reproductible compile actuellement 579 routes sur Dub, 281 sur Immich et 477 sur
Medusa. Ces nombres mesurent la compilation de routes, pas une garantie globale de sécurité.

```bash
node bench/repro.mjs
```

## Sécurité et fonctionnement

- exécution locale, sans télémétrie obligatoire ;
- écritures désactivées par défaut dans le runtime optionnel ;
- résultats sérialisables et comparables ;
- quatre dépendances d'exécution épinglées exactement ;
- limites documentées au lieu d'être masquées.

Pour les détails, consultez [l'architecture](ARCHITECTURE.md),
[le modèle de sécurité](SECURITY.md), [les tests](TESTING.md) et
[la spécification SBIR](SBIR_SPEC_V1.1.md).

## En une phrase

SPARDA ne remplace pas les tests ni la revue humaine : il ajoute une couche de preuve mécanique
qui sait aussi dire clairement « je ne sais pas ».
