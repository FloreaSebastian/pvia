# Visite Technique — Architecture proposée

## 1. Audit de l'existant (réutilisable tel quel)

| Brique PVIA | État | Réutilisation |
|---|---|---|
| `chantiers` | statut texte, 7 valeurs (`preparation`…`archive`), `type` **texte libre** (aucune taxonomie), référence auto `CH0001AB`, verrouillage auto si `termine`/`archive` | on rattache la visite ; statut initial = `preparation` (pas de nouveau statut) |
| `clients` | `createClient` server fn complète (particulier/pro, SIRET) | création client inline dans le wizard |
| `chantier_events` | `event_type` inclut **déjà `visite_technique`** (couleur jaune, libellé posé) | la visite génère 1 événement calendrier — pas de doublon |
| Photos | bucket privé unique **`pv-assets`**, upload direct navigateur + insert métadonnées par server fn, EXIF/GPS, compression 1600px, hash SHA-256, URL signées | pattern `ChantierPhotosTab` copié tel quel |
| RLS | `is_company_member` (SELECT) / `can_manage_company` (écritures) + GRANT `authenticated`/`service_role` | pattern `chantier_photos` répliqué à l'identique |
| Audit | `writeAuditLog` (best-effort, jamais throw), union `AuditAction` fermée | on étend l'union avec `visite.*` |
| PDF | `pdf-lib`, pipeline monolithique couplé au PV | **nouveau** `visite-pdf.server.ts` (mêmes primitives, pas de refonte du PV) |
| Offline | SW = coquille HTML/assets seulement. Pas d'IndexedDB, pas de sync queue. Brouillon PV = `localStorage` + autosave debounce | même approche (localStorage + file d'attente photos) — **pas de fausse promesse de sync** |
| Navigation | desktop `mainNav` extensible ; **BottomNav mobile figé à 5 items** | entrée desktop dédiée + accès mobile via Chantiers et un item remplaçable |

## 2. Architecture de données

5 tables, génériques par `visit_type` (extensible plomberie/IRVE/… sans migration de structure) :

```
technical_visits            (company_id, chantier_id, client_id, visit_type, status,
                             assigned_to, scheduled_at, started_at, completed_at,
                             validated_at/by, site_contact_name/phone, prep_notes,
                             reference, completion_percent, created_by, idempotency_key)
technical_visit_answers     (visit_id, section_key, field_key, value jsonb)
technical_visit_photos      (visit_id, slot_key, section_key, storage_path, caption,
                             comment, gps, exif, taken_at, uploaded_by, file_hash)
technical_visit_photo_skips (visit_id, slot_key, reason, justification)
technical_visit_constraints (visit_id, section_key, category, level, title,
                             description, recommendation)
```

- `visit_type` : `photovoltaique | pac_air_air | pac_air_eau` (CHECK, extensible).
- `status` : `a_planifier | planifiee | en_cours | a_completer | terminee | validee | archivee`.
- Le **catalogue des étapes/champs/photos vit dans le code** (`src/lib/visites/templates/*.ts`), pas en base : versionnable, typé, zéro requête pour afficher un formulaire. Les réponses sont stockées en clé/valeur → un nouveau métier = un nouveau fichier template.
- Photos : même bucket `pv-assets`, chemin `${companyId}/visites/${visitId}/${slotKey}/…`.
- RLS : SELECT membres, INSERT/UPDATE `can_manage_company` **ou** technicien assigné (pour qu'un technicien puisse réaliser sa visite), DELETE/validation réservés aux rôles manage/admin. GRANT explicites sur les 5 tables.

## 3. Parcours utilisateur

**Desktop (exploitation)** — `/visites-techniques` liste + KPI + filtres (type, statut, technicien, période, client) et recherche (client/chantier/adresse) ; `/visites-techniques/:id` dossier lisible ; `/visites-techniques/:id/rapport` synthèse + galerie par catégorie + PDF.

**Mobile (terrain)** — `/visites-techniques/:id/modifier` = mode terrain plein écran : « Étape 3 sur 8 — Installation électrique », barre de progression, barre d'actions fixe (Précédent / Enregistrer / Suivant), champs tactiles 44px, autosave debounce + brouillon local, indicateur hors-ligne + compteur de photos en attente.

**Photos** — chaque slot est une carte contextualisée (titre + consigne + Prendre la photo / Galerie), aperçu → Utiliser / Reprendre / Ajouter une autre, plus « Impossible à photographier » avec motif obligatoire (inaccessible / absent / client absent / danger / autre).

**Contrôle final** — écran de vérification section par section (✓ complet / ⚠ à vérifier / ● manquant) puis « Terminer la visite ».

## 4/5/6. Structures métier (résumé)

- **Photovoltaïque** — 7 étapes : Informations générales · Toiture (type, pans répétables, orientation, inclinaison, dimensions, obstacles) · Accès & levage (échelle/échafaudage/nacelle → alerte auto si nacelle ou accès difficile) · Installation électrique (mono/tri, compteur, disjoncteur, tableau, terre, onduleur, batterie conditionnelle) · Cheminements (segments répétables longueur + type + photos) · Contraintes · Vérification. Catégories photo : Bâtiment, Toiture, Accès, Électricité, Onduleur/Batterie, Cheminements, Contraintes.
- **PAC Air/Air** — 6 étapes : Configuration (mono/multisplit, nb UI) · Pièces (bloc répétable par pièce) · Unité extérieure (emplacement, support, condensats, nuisance) · Liaisons (bloc répétable par UI : longueur, dénivelé, percement, pompe de relevage) · Électricité · Vérification. Catégories : Pièces, Unités intérieures, Groupe extérieur, Liaisons, Condensats, Électricité.
- **PAC Air/Eau** — 8 étapes : Installation existante (générateur, plaque signalétique) · Émetteurs · Caractéristiques logement · Emplacement PAC · Hydraulique · ECS (conditionnelle) · Électricité · Vérification. Catégories : Installation existante, Chaufferie, Émetteurs, Hydraulique, ECS, Unité extérieure, Électricité.

Conditionnalité gérée par le moteur de template (`visibleIf`) : batterie, ECS, multisplit, nacelle, ballon tampon, triphasé, pans multiples.

## 5. Chantier automatique (une seule opération métier)

Wizard : Client (existant ou nouveau) → Type de visite → Chantier → Technicien/date/notes.

- Chantier existant du client → proposé en liste, la visite s'y rattache.
- Sinon **création automatique** dans la même server fn : nom `Photovoltaïque — M. Dupont`, `type` = `Photovoltaïque` / `Climatisation / PAC Air-Air` / `Pompe à chaleur Air-Eau` (champ texte libre aujourd'hui, on pose la convention), statut `preparation`, client + adresse + `company_id`.
- **Anti-doublon** : détection client + adresse normalisée + type proche sur chantier actif → écran « Un chantier semble déjà exister » (Utiliser ce chantier / Créer quand même). Jamais de fusion automatique.
- **Anti-double-clic** : `idempotency_key` unique par tentative → la même soumission ne crée jamais deux chantiers.
- Depuis une fiche chantier, « Nouvelle visite » ne crée **jamais** de chantier.
- Un `chantier_events` `visite_technique` est créé si date/heure fournies (aucun trigger existant ne le fait déjà).

## 6. Intégration chantier (bidirectionnelle)

Nouvel onglet **Visites techniques** dans `/chantiers/:id` (à côté de Vue / Dossier / Photos) : type, statut, date, technicien, progression, actions Ouvrir / Photos / Rapport PDF / Nouvelle visite. Plusieurs visites par chantier (contre-visite, complémentaire). Sur la fiche visite : bloc « Chantier associé → Voir le chantier ».

## 7. Points de vigilance

- **Sécurité** : `company_id` vérifié serveur sur chaque fn, jamais depuis le client ; technicien assigné = lecture/saisie de sa visite uniquement en écriture des réponses, pas de validation ; URLs de photos toujours signées, jamais publiques.
- **Offline** : on réutilise l'existant (localStorage + queue photos) et l'UI distingue explicitement « en attente d'envoi » de « synchronisé ». Pas de faux offline-first.
- **Performances** : réponses en clé/valeur → une seule requête par visite ; galerie en URLs signées par lot ; liste paginée.
- **PDF** : module séparé, photos injectées dans leur section (pas en vrac en fin de document), plafonné pour éviter les timeouts.
- **Audit** : `visite.create/update/photo_added/photo_skipped/constraint_added/completed/validated/archived/report_generated`.
- **Non-régression** : aucune modification des tables existantes hors ajout de relations ; aucun trigger PV/chantier touché.

## 8. Plan d'implémentation (par lots vérifiés en runtime)

1. Migration (5 tables + GRANT + RLS + index) et types.
2. Moteur de template + fichier Photovoltaïque.
3. Server fns : création atomique visite+chantier (anti-doublon, idempotence), réponses, photos, contraintes, statuts.
4. Liste `/visites-techniques` + wizard de création.
5. Mode terrain mobile (étapes, photos, autosave, hors-ligne) + écran de vérification.
6. Fiche visite + rapport structuré + galerie par catégories.
7. Templates PAC Air/Air puis PAC Air/Eau.
8. Onglet Visites techniques dans la fiche chantier + événement calendrier.
9. Rapport PDF.
10. Passe finale : permissions par rôle, responsive 320px→1440px, audit logs.
