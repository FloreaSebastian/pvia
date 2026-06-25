
## Périmètre

Trois chantiers UI/UX cohérents, sans changement du modèle de données :

1. **Étape 2 — Client** (dans `src/routes/_authenticated/pv.new.tsx`)
2. **Étape 3 — Chantier** (dans `src/routes/_authenticated/pv.new.tsx`)
3. **Fiche chantier** — bouton « Modifier » + bottom sheet d'édition (`src/routes/_authenticated/chantiers.$id.tsx`)

Aucune migration DB : les server functions `updateChantier`, `createClient`, `createChantier`, et l'audit `chantier.update` existent déjà.

---

## 1. Étape 2 — Client (refonte)

**État cible** :
- En-tête compact « Étape 2/7 · Client » + titre court.
- Carte « Client sélectionné » premium (icône 👤 ou 🏢, nom, type, SIRET/contact, email).
- Carte vide premium si rien de sélectionné.
- Barre de recherche sticky avec icône loupe, placeholder enrichi (nom, société, email, téléphone, ville, SIRET, SIREN, contact).
- Recherche déclenchée dès 2 caractères, debounce 250 ms, requête Supabase `clients` filtrée par `company_id` avec `or(name.ilike,company_name.ilike,email.ilike,phone.ilike,city.ilike,siret.ilike,siren.ilike,primary_contact_name.ilike)`.
- Résultats sous forme de cartes compactes différenciées Particulier / Entreprise, animation `motion` au pick, toast « Client sélectionné ».
- Bouton plein largeur `+ Créer un nouveau client` ouvrant le bloc création (réutilise `ClientTypeSelector` + `ClientFormFields` existants).
- Après création : sélection auto, fermeture du formulaire, toast « Client créé ».
- Si `signature_mode === "remote"` : badge « Email requis pour signature à distance » ; si client sélectionné sans email, alerte + bouton « Ajouter un email ».

---

## 2. Étape 3 — Chantier (refonte)

**État cible** :
- En-tête « Étape 3/7 · Chantier » + sous-titre.
- Carte « Chantier sélectionné » avec réf. `CH####XX` en mono, nom, badge statut, adresse, client, dates, avancement.
- Recherche sticky « par référence, nom, adresse, client... », dès 2 caractères, sur `reference, name, address, city, status` + jointure client.
- Cartes résultats compactes : réf mono, nom, badge statut, ville, client, dates.
- Bouton `+ Créer un chantier` : formulaire compact (nom, client lié pré-rempli si étape 2 OK avec badge « Client lié », type, adresse via `AddressAutocomplete`, dates, statut initial).
- Après création : sélection auto + toast « Chantier créé CH#### ».
- Bloc « Adresse de réception utilisée dans ce PV » (modifiable sans toucher au chantier) + bouton secondaire « Mettre à jour la fiche chantier » qui appelle `updateChantier` (uniquement si l'utilisateur clique).
- Validation Suivant : (chantier OU adresse complète) + date réception + CP valide ; messages d'erreur sous footer.

---

## 3. Fiche chantier — bouton Modifier

**Dans le header de `chantiers.$id.tsx`** :
- Icône crayon (mobile) / bouton « Modifier le chantier » (desktop) à côté de la référence.
- Désactivé si statut `termine` / `archive` avec tooltip « Chantier verrouillé. Réouvrir pour modifier. ».
- Si rôle `directeur` / `responsable_exploitation` : bouton « Réouvrir » (appelle `reopenChantier` existant).

**Bottom sheet d'édition** :
- Champs : nom, type, statut, client lié (select), adresse, CP, ville, dates début/fin, description.
- Référence affichée en lecture seule (immuable).
- Sauvegarde via `updateChantier` (audit `chantier.update` déjà géré côté server).
- Après save : `queryClient.invalidateQueries` + toast « Chantier mis à jour ».

---

## Fichiers modifiés

- `src/routes/_authenticated/pv.new.tsx` — refonte étapes Client (ID_CLIENT) et Chantier (ID_CHANTIER), bloc adresse PV.
- `src/routes/_authenticated/chantiers.$id.tsx` — bouton Modifier dans le header + nouveau composant inline `ChantierEditSheet`.
- (éventuel) extraction d'un petit helper de recherche client dans `pv.new.tsx` si la taille du switch case devient gênante — sinon tout reste inline.

Aucun changement schema, aucun nouveau secret, aucune nouvelle server function.

---

## Tests / vérification

- `tsgo --noEmit` sur le projet.
- Vérification visuelle en preview mobile 384px (déjà active).
- Smoke manuel : recherche client 2 char, création client entreprise, recherche chantier, création chantier depuis PV, modification fiche chantier, chantier verrouillé.

---

## Notes techniques (annexe)

- Pas de nouveau endpoint : recherche client/chantier en direct via `supabase` client (déjà importé), `ilike` + `limit(20)`.
- Le `useEffect` debounce nettoie le timer existant ; annulation via flag local `cancelled`.
- Le bottom sheet de modif chantier utilise `Sheet side="bottom"` cohérent avec les autres bottom sheets du projet.
