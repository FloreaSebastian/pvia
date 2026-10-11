# Statistiques PVIA — bilan de vérification

## Changements

- `src/lib/stats-core.ts` : contrat partagé, validation des dates/types/UUID, journées Paris et changements d’heure, comparaison adjacente, cohorte des PV créés, filtres parent indépendants de la date du parent, journal par auteur, encours actuel avec statuts/cutoff du dashboard. Absence de signature/date : valeur indisponible plutôt que zéro fictif. États de réserves inconnus : erreur explicite.
- `src/lib/stats.functions.ts` : membre actif et advanced_stats conservés, export SIGN seulement, lectures minimales paginées ordonnées par id avec compte exact, contrôle du membre sélectionné dans l’entreprise, identités en groupes de 200. Lectures privilégiées uniquement après autorisation, toujours limitées à l’entreprise ; aucune modification RLS ou migration.
- `src/lib/stats-export.ts` : mêmes définitions, bornes, filtres et calculs CSV/PDF. CSV BOM, point-virgule, nombres français et protection formule. PDF paginé, ponctuation compatible Helvetica, chemins UUID uniques, erreurs stockage/lien propagées. compare=false respecté.
- `src/lib/stats-scope.ts` : invalidation des réponses d’export lors d’un changement de contexte, filtres ou démontage.
- `src/components/stats/StatisticsView.tsx` : en-tête, filtres accessibles, dates saisies puis appliquées, quatre indicateurs, encours hors période, graphique avec tableau, réserves par état/gravité, documents et journal secondaires, explications de calcul, états vide/chargement/erreur/actualisation.
- `src/routes/_authenticated/statistiques.tsx` : clés Query entreprise/utilisateur/rôle/feature/filtres, aucun placeholder cross-entreprise, export fermé si état inconnu/non chargé/erreur, retry, actualisation et métadonnées spécifiques.
- `tests/unit/stats-core.test.ts` : 25 nouveaux tests ; `AGENTS.md` et `roadmap.md` documentent le contrat et la vérification.

## Commandes exécutées

- `bun test tests/unit` : **850 pass, 0 fail**, 51 fichiers, exit 0 après dernières modifications.
- `bunx eslint src/lib/stats-core.ts src/lib/stats-export.ts src/lib/stats.functions.ts src/lib/stats-scope.ts src/components/stats/StatisticsView.tsx src/routes/_authenticated/statistiques.tsx tests/unit/stats-core.test.ts` : exit 0, aucun avertissement.
- Prettier sur les fichiers touchés : exit 0.
- Vérification automatique types/build du projet : dernier diagnostic **build OK, 2026-10-11 18:48:48 UTC** après dernières modifications de code. Aucun build ni typecheck manuel lancé, conformément aux contraintes de l’environnement ; pas de prétention à une commande indépendante tsgo/vite.

## QA réellement exécutée

Harness HTML temporaire intercepté uniquement par Playwright sur localhost, important les **vrais composants**, leurs styles et le moteur réel. Aucune route/fichier de fixture dans le projet, aucune connexion ni requête de données métier.

- Rempli avec noms longs : 320/375/768/1440 px et 640 px pour équivalent reflow d’un viewport 1280 à zoom 200 % (pas un test du zoom natif).
- Vide, erreur puis Réessayer, chargement, dates personnalisées invalides puis valides, sélection membre, tableau et accordéons, menu export et parcours clavier Actualiser → Exporter.
- Six rôles : export actif pour Directeur/Responsable/Conducteur ; inactif pour Assistant/Technicien/Lecture seule. Ce n’est pas un parcours authentifié six rôles.
- Zéro débordement horizontal et zéro erreur navigateur dans les scénarios finaux. Captures inspectées.
- Défaut visuel trouvé : actions comprimant le titre et le nom entreprise en colonne sur mobile. Corrigé en plaçant l’en-tête pleine largeur avant les actions. Message d’erreur mobile également réorganisé. Le texte corrompu du harness a été corrigé par charset UTF-8 (hors application).
- PDF réel synthétique : génération avec/sans comparaison ; rendu Poppler et inspection des trois pages finales, accents, longues identités, marges et pagination. Pas de chevauchement ni texte coupé observé. Ponctuation flèche/tirets normalisée ; caractères hors WinAnsi remplacés par `?` (limite explicite).
- CSV synthétique analysé avec csv Python : BOM/point-virgule, formule neutralisée, comparaison absente lorsque désactivée. Tests de stockage simulés : échec upload ne signe pas, échec signed URL ne retourne pas de succès.

## Limites

- Aucun parcours connecté ni appel aux exports serveur réels : pas de stockage, email, audit d’export ou données métier modifiés pendant les tests. Contrôle schéma uniquement en lecture seule ; aucun SQL fixture requis.
- Les lectures paginées ne sont pas un snapshot transactionnel. Changement de compte ou doublon de page détecté : erreur ; une modification concurrente conservant le même nombre de lignes peut nécessiter Actualiser.
- Plafond explicite de sécurité de lecture : 50 000 lignes par ressource. Au-delà, erreur utile, jamais total tronqué. PV et réserves sont lus sur l’historique pour garantir parents anciens et encours ; une petite période ne réduit donc pas ces deux lectures. Une agrégation SQL dédiée serait nécessaire pour très grandes entreprises, non ajoutée ici.
- Les liens de l’encours ouvrent tous les dossiers de l’entreprise, annoncé explicitement ; ils ne promettent pas de conserver les filtres type/membre. À valider ouvre la liste générale des réserves, faute de groupe URL identique sans modifier une autre page.
- Les PDF/envois comptent la dernière date enregistrée sur chaque PV, pas les événements historiques de régénération/renvoi.
- Aucun audit automatisé complet de contraste ni zoom natif ; clavier et reflow contrôlés avec les tokens existants.

Ni publication, ni compte, invitation, changement de rôle, paiement, email ou appel IA effectué. Dashboard/Équipe/PV/Visites/Réserves et modules cachés inchangés.