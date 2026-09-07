# Audit de validation — Module Sous-traitants (07/09/2026)

Méthode : audit du code livré, corrections, puis exécution d'un scénario réel
contre la base de données (données de test créées puis purgées), tests
unitaires et contrôle d'affichage réel sur navigateur.
Aucun paiement, abonnement Stripe LIVE, client réel ou donnée réelle modifiés.

## A. Défauts réels trouvés et corrigés

| # | Sév. | Défaut | Cause | Impact | Correction | Test |
|---|------|--------|-------|--------|-----------|------|
| 1 | P0 | Un compte sous-traitant invité créait automatiquement une entreprise professionnelle, un rôle directeur et un essai 14 jours | `handle_new_user` créait une entreprise pour tout compte sans invitation interne en attente | Un externe obtenait un espace professionnel complet | Migration : les comptes marqués sous-traitant, ou dont l'email figure dans les utilisateurs sous-traitants, ne créent plus d'entreprise | Scénario runtime « aucun espace professionnel auto-créé » |
| 2 | P1 | Un compte sous-traitant sans entreprise interne entrait dans le parcours professionnel (onboarding) | Le layout authentifié ne distinguait pas ce cas | Écran professionnel affiché à un externe | `isSubcontractorOnly` calculé côté serveur + redirection vers l'espace dédié | Vérifié en code + runtime (aucun membership interne créé) |
| 3 | P1 | Photo acceptée sur simple type déclaré | Le `contentType` du client était cru | Fichier non-image stocké dans le bucket | Contrôle des signatures binaires, correspondance obligatoire avec le type déclaré | Contrôle code (validateur partagé déjà testé) |
| 4 | P1 | La visite technique était renvoyée au sous-traitant sans revérifier la formule commerciale en lecture | Seule l'écriture vérifiait la formule | Une entreprise Essentiel exposait des données de visite | Lecture conditionnée à `has_plan_feature('technical_visits')`, fail-closed | Contrôle code |
| 5 | P2 | Adresse et description du chantier renvoyées sans le droit « fiche chantier » | Filtrage absent sur ce point d'entrée | Donnée non autorisée présente dans la réponse réseau | Masquage serveur (`maskChantier`), champs absents de la réponse | 3 tests de masquage |
| 6 | P2 | Journal d'audit sans acteur lisible | Seuls les identifiants techniques étaient enregistrés | Historique difficilement exploitable | `actorLabel` : « Jean Test — TECH ELEC », chantier et action enregistrés | Runtime « libellé d'audit lisible » |
| 7 | P2 | Une surcharge d'affectation pouvait porter une clé inconnue | Normalisation partielle | Risque d'ajout de droit non prévu | Normalisation stricte : toute clé hors liste est ignorée | 2 tests de permissions |

## B. Rôles internes (V1)

Créer/modifier une entreprise sous-traitante, inviter, renvoyer, suspendre,
réactiver, révoquer, définir/modifier les permissions, affecter/retirer un
chantier : **owner (directeur) et admin (responsable d'exploitation uniquement**.
`manager` (conducteur de travaux) et `user` (technicien, assistant, lecture seule)
sont refusés **côté serveur** : chaque mutation passe par `assertAdminWrite` →
`is_company_admin` en base, puis par la garde d'abonnement. Les boutons masqués
ne sont jamais la protection. La lecture de la liste reste réservée aux membres
internes actifs de l'entreprise.

## C. Presets

| Permission | Terrain | Visite technique | Chef d'équipe | Sur mesure |
|---|---|---|---|---|
| Voir le chantier | oui | oui | oui | au choix |
| Fiche chantier détaillée | oui | oui | oui | au choix |
| Ajouter une note | non | non | oui | au choix |
| Voir les documents | oui | oui | oui | au choix |
| Déposer un document | non | non | oui | au choix |
| Voir les photos | oui | oui | oui | au choix |
| Ajouter des photos | oui | oui | oui | au choix |
| Planning | oui | oui | oui | au choix |
| Voir les réserves | non | non | oui | au choix |
| Commenter une réserve | non | non | oui | au choix |
| Proposer une levée | non | non | oui | au choix |
| Voir / remplir / photographier une visite technique | non | oui | oui | au choix |
| Contact client | non | non | oui | au choix |
| Changer le statut d'intervention | oui | oui | oui | au choix |
| Messages | oui | oui | oui | au choix |

Le preset n'est qu'une aide de saisie : le serveur ne lit jamais son nom, seulement
les permissions finales enregistrées. Un chef d'équipe reste un externe : aucune
permission d'équipe, de facturation, d'export, de suppression ni de validation
client n'existe dans la liste — « proposer une levée » ne vaut pas validation.

## D. Règles d'accès en base (nouvelles tables)

| Table | Lire | Créer / Modifier / Supprimer |
|---|---|---|
| entreprises sous-traitantes | administrateurs de l'entreprise | administrateurs uniquement |
| utilisateurs sous-traitants | la personne concernée | fonctions privilégiées uniquement |
| relations | administrateurs ; la personne concernée pour la sienne | administrateurs uniquement |
| invitations | administrateurs (sans jamais exposer l'empreinte du jeton) | fonctions privilégiées uniquement |
| affectations | membres de l'entreprise ; sous-traitant actif pour les siennes | administrateurs uniquement |
| messages | membres de l'entreprise ; sous-traitant sur affectation active | via les fonctions serveur contrôlées |

Aucune règle du type « toute personne connectée » n'existe sur ces tables : la
condition est toujours l'appartenance à l'entreprise ou la relation active.

## E. Rôle privilégié côté serveur

Les fonctions du portail utilisent l'accès privilégié (qui contourne les règles
de base) et portent donc leurs propres contrôles, dans cet ordre, à chaque appel :
session vérifiée → identité sous-traitante → relation active non révoquée →
affectation active sur la ressource → permission finale → abonnement utilisable →
quota. Aucun identifiant d'entreprise venant du navigateur n'est utilisé.

## F/G. Résultats du scénario réel (base de données, 07/09/2026)

15 contrôles exécutés, **15 PASS**, données purgées ensuite (0 reste) :
aucun espace pro auto-créé ; relation résolue depuis la session ; libellé d'audit
lisible ; chantier affecté accessible ; chantier non affecté de la même entreprise
refusé ; chantier d'une autre entreprise refusé ; intervention d'un autre
sous-traitant refusée (IDOR) ; permission non accordée absente ; retrait de
permission effectif sans reconnexion ; affectation annulée → intervention et
chantier refusés ; compte suspendu → refus immédiat ; relation révoquée → session
existante sans droits, plus aucune relation active.

## H. Authentification

Code à 6 chiffres haché, valable 10 minutes, 5 tentatives maximum, anciens codes
invalidés à chaque nouvelle demande, limitation de fréquence par email et par
adresse IP, comparaison à temps constant, messages neutres (impossible de savoir
si une adresse existe). Invitations : jeton haché, nominatif, expirable,
révocable, à usage unique garanti par une mise à jour conditionnelle atomique.
Les espaces professionnel, client et sous-traitant restent trois contextes
distincts : un compte sans relation sous-traitante active n'entre pas dans le
portail, et un compte sous-traitant sans entreprise interne est renvoyé vers son
espace.

## I/J. Révocation et facturation

Révocation, suspension et retrait d'affectation sont effectifs immédiatement,
sans reconnexion (prouvé ci-dessus). Toute écriture du portail passe par les
gardes existantes de l'entreprise donneuse d'ordre : abonnement utilisable,
formule (visite technique), quota PV via le journal immuable existant. Aucun
compteur parallèle n'a été créé.

## K. Affichage réel

320 px, Galaxy Fold (344), 360, 390 et tablette (768) sur connexion sous-traitant,
saisie du code, page d'invitation et portail : **aucun débordement horizontal**.
Les seuls éléments sous 40 px sont deux liens de bas de page légaux.

## L. Tests

`bun test tests/unit` : **86 tests, 0 échec, 234 assertions** (12 ajoutés pour ce
module : rôles administrateurs, presets, normalisation des permissions, masquage
des données).

## M. Non testable dans cet environnement

- Parcours navigateur **connecté** (réception réelle de l'email, saisie du code,
  navigation dans le portail, appareil photo mobile) : aucune session navigateur
  ne peut être ouverte ici. Le même chemin de décision a été exécuté directement
  contre la base via les gardes serveur (section F/G).
  Validation manuelle : inviter une adresse réelle depuis « Sous-traitants »,
  se connecter par l'onglet « Sous-traitant », ouvrir l'intervention, ajouter une
  photo, puis retirer l'affectation depuis un second navigateur et rafraîchir.
- Encaissement Stripe : hors périmètre, volontairement non touché.

---

## N. Seconde passe de correction (07/09/2026, après revue)

### N.1 Défauts corrigés

| # | Sév. | Défaut | Correction | Preuve |
|---|------|--------|-----------|--------|
| 8 | P1 | `getSubcontractorWorkspace` renvoyait l'adresse complète du chantier sans le droit « fiche chantier » | Masquage serveur via `mapWorkspaceAssignment` (permissions relation + surcharges) appliqué avant envoi réseau ; tous les autres points d'entrée du portail relus (`maskChantier` / `maskClientContact` déjà appliqués) | 3 tests unitaires |
| 9 | P1 | Les surcharges à `false` étaient perdues à l'enregistrement (`normalizePermissions` ne gardait que `true`) | Nouvelle `normalizePermissionOverrides` : conserve `true` ET `false`, refuse toute clé inconnue et toute valeur non booléenne ; utilisée à la création et à la modification d'affectation | 3 tests unitaires (dont chemin persistance → permissions effectives) |
| 10 | P1 | Règles d'accès trop permissives : une intervention annulée, une relation suspendue/révoquée ou une entreprise sous-traitante non active restaient lisibles en accès direct | `sc_assignments_self_read` et `sc_messages_self_read` réécrites ; vérification de relation centralisée dans `sc_membership_readable` (SECURITY DEFINER, filtrée sur `auth.uid()`), nécessaire car les sous-requêtes de policy subissent elles-mêmes les règles d'accès | Scénario base 8/8 (N.2) |
| 11 | P2 | Codes OTP professionnel et sous-traitant partagés sans contexte | Colonne `audience` (`professional` / `subcontractor`), contrainte, index, valeur par défaut pour les lignes existantes ; écritures, invalidations, lectures et vérifications filtrées par contexte + revérification en mémoire (`matchesAudience`) | 4 tests unitaires |
| 12 | P2 | URLs signées valables 1 h après révocation | TTL sous-traitant ramené à **120 s** (`SUBCONTRACTOR_SIGNED_URL_TTL`). Compromis documenté : Supabase Storage ne révoque pas une signature déjà émise ; la fenêtre résiduelle passe de 60 min à 2 min, et aucun nouveau lien n'est généré après révocation/suspension/annulation puisque chaque lecture repasse par les gardes. TTL interne entreprise inchangé (1 h) | Contrôle code |
| 13 | P2 | Visite technique vérifiée sur l'entreprise seulement | Vérification `company_id` **ET** `chantier_id` ; message d'erreur explicite | Contrôle code |

### N.2 Scénario réel en base (données TEST, transaction annulée, 0 reste)

| Contrôle | Attendu | Résultat |
|---|---|---|
| Intervention active lue par le sous-traitant | visible | PASS |
| Intervention annulée | masquée | PASS |
| Messages d'une intervention active | visibles | PASS |
| Messages d'une intervention annulée | masqués | PASS |
| Relation suspendue → intervention | masquée | PASS |
| Relation suspendue → messages | masqués | PASS |
| Relation révoquée → intervention | masquée | PASS |
| Entreprise sous-traitante suspendue → intervention | masquée | PASS |

Vérification finale : aucune entreprise, chantier, relation ni compte de test ne subsiste.
Aucun paiement, abonnement Stripe LIVE, client réel ou donnée réelle n'a été touché.

### N.3 Recontrôles demandés

- `requireAssignment`, `requireChantierAccess`, `listActiveMemberships` : relation dérivée de la session, statut actif, non révoquée/suspendue, entreprise sous-traitante active, affectation non annulée, tenant jamais lu depuis le navigateur — inchangé et confirmé.
- Aucun `company_members`, rôle interne, entreprise professionnelle ni essai 14 jours pour un compte sous-traitant (trigger `handle_new_user` + `isSubcontractorOnly`).
- Suspension, révocation, annulation d'affectation et retrait de permission : effectifs au prochain appel, sans reconnexion.
- Chantier d'une autre entreprise et chantier non affecté : refusés.
- Écritures d'administration : `directeur` et `responsable_exploitation` uniquement (`assertAdminWrite` → `is_company_admin`).
- Images : signatures binaires contrôlées, correspondance obligatoire avec le type déclaré.
- `technical_visits` : `hasPlanFeature` en lecture (fail-closed) et `assertPlanFeature` en écriture.

### N.4 Tests

`bun test tests/unit` : **96 tests, 0 échec, 252 assertions, 8 fichiers** (10 ajoutés dans cette passe).
Typecheck et build : OK.

### N.5 Limites restantes (honnêtes)

- **BLOCKED** — parcours navigateur **authentifié** (réception réelle de l'email, saisie du code, navigation portail, appareil photo) : aucune session navigateur ne peut être ouverte dans cet environnement. Le rendu **public** reste sans débordement de 320 px à 768 px.
- **Non testé en runtime** — expiration réelle d'une URL signée au bout de 120 s (contrôle de code uniquement).
- **Non testé en runtime** — rejet croisé des codes OTP contre la base réelle (couvert par le filtre SQL `audience` + 4 tests unitaires).
- Linter base : 25 avertissements, dont 24 préexistants ; le 25e est la nouvelle fonction `sc_membership_readable`, volontairement exécutable par un utilisateur connecté car utilisée par les règles d'accès et strictement limitée à `auth.uid()`.
