# Rituel Barber — Application de gestion du salon

Document de référence complet : contexte, design, architecture, code et
**instructions de déploiement pas-à-pas** (utilisables par un humain ou par un
agent IA qui pilote le navigateur, ex. pour déployer via hPanel Hostinger).

---

## 1. C'est quoi

Application web privée pour le salon **Rituel Barber** (Viry-Châtillon), avec
deux interfaces :

| Rôle | Ce qu'il fait | Ce qu'il voit |
|---|---|---|
| **Barbier** | Après chaque client : 2 touches pour enregistrer la prestation (ex. « Coupe & Barbe »), le prix (pré-rempli, ajustable) et le paiement Espèces/Carte | Ses heures de passage et son **nombre** de clients du jour. **JAMAIS aucun montant ni total.** |
| **Gérant** | Suit l'activité en temps réel | Total du jour / semaine / mois, chaque coupe horodatée avec prix et mode de paiement, ticket moyen, part carte/espèces, graphiques, répartition par prestation, comparaison avec la période précédente, export CSV |

Fonctions clés :
- Le barbier peut **annuler sa dernière saisie pendant 5 minutes** ; au-delà,
  seul le gérant corrige (traçabilité).
- **PWA installable** sur l'écran d'accueil du téléphone (icône RB, plein écran).
- **Hors-ligne** : si le wifi coupe, les saisies sont gardées en local
  (localStorage) puis synchronisées automatiquement.
- Le gérant gère tout depuis l'app : prestations/tarifs, PIN des barbiers,
  ajout d'un 2ᵉ barbier, mot de passe, export comptable.

## 2. Règle d'or (non négociable)

**Aucun montant ne doit jamais être visible par un compte barbier.**
C'est appliqué **côté serveur** dans `api.php` : l'action `state` (journal du
barbier) ne renvoie ni prix ni total, et l'action `stats` répond
`403 Réservé au gérant` à tout compte non-gérant. Ne jamais « déplacer » ce
filtrage côté JavaScript.

## 3. Structure des fichiers

```
gestion/
├── index.html            Coquille de la SPA (meta noindex, manifest, fonts)
├── assets/
│   ├── styles.css        Tout le style (thème clair, tokens en :root)
│   └── app.js            Toute la logique (vues, API client, file hors-ligne)
├── api.php               API JSON — toutes les actions, contrôle des rôles
├── db.php                Connexion SQLite + création auto du schéma + tarifs par défaut
├── sw.js                 Service worker (cache du shell, jamais l'API)
├── manifest.webmanifest  PWA
├── icons/                icon-192/512, apple-touch-icon (fond crème, monogramme RB)
├── .htaccess             noindex (X-Robots-Tag), -Indexes, blocage des .sqlite
├── robots.txt            Disallow: /
└── data/                 ← créé AUTOMATIQUEMENT au 1er lancement (base SQLite)
                            protégé par un .htaccess « Require all denied » auto-généré
                            ⚠️ NE JAMAIS SUPPRIMER lors d'une mise à jour : c'est la base de données
```

## 4. Design (validé par le client)

Le client a choisi le **thème clair** parmi 5 propositions (maquette :
Bois & Charbon sombre, Olive, Or, Rouge Barbier, **Clair ✓**).

Tokens (définis dans `assets/styles.css`, `:root`) :

| Token | Valeur | Usage |
|---|---|---|
| `--bg` | `#F3EFE6` | fond crème |
| `--card` | `#FDFCF8` | cartes |
| `--line` | `#E0D9C8` | bordures |
| `--ink` / `--mut` | `#1A1912` / `#75705F` | texte / texte secondaire |
| `--accent` | `#96652C` | bois foncé : boutons, actifs, liens |
| `--vif` | `#B26A1F` | barres de graphiques (contraste validé, daltonisme OK) |
| `--on-accent` | `#FBF7EE` | texte sur bouton accent |
| `--good` / `--bad` | `#4C6B42` / `#A3392C` | delta positif / négatif, erreurs |

Typo : **Bebas Neue** (titres, gros chiffres — comme le site public) +
**Poppins** (texte), chargées via Google Fonts avec fallbacks système.

Composants récurrents : cartes arrondies 14px, bottom-sheet pour toute saisie,
segmented control Espèces/Carte, onglets Jour/Semaine/Mois, bottom-nav 2 items,
graphique en barres HTML/CSS (jour en cours en pleine opacité, autres à 42 %).

## 5. Base de données (SQLite — créée automatiquement)

`data/rituel.sqlite`, schéma créé par `db.php` au premier appel :

- `users(id, name, role 'owner'|'barber', secret_hash, active, created_at)` —
  mots de passe et PIN **hachés** (`password_hash`).
- `services(id, name, price_cents, sort, active)` — prix en **centimes**.
  Suppression = `active=0` (l'historique garde ses libellés).
- `entries(id, user_id, service_id, service_name, price_cents, payment 'cash'|'card', created_at)`
- `settings(key, value)` — compteur anti-bruteforce.

Tarifs par défaut (repris du site public, modifiables dans Réglages) :
Coupe Classique 25 €, Coupe & Barbe 40 €, Taille de Barbe 20 €,
Dégradé Américain 30 €, Coupe Enfant 15 €, Soin Visage 30 €.

## 6. API (`api.php?action=…`, JSON, sessions PHP)

| Action | Accès | Rôle |
|---|---|---|
| `bootstrap` | public | dit si la 1ʳᵉ configuration est requise + session en cours |
| `setup` | 1ʳᵉ fois seulement | crée le gérant (mot de passe ≥ 8) + 1ᵉʳ barbier (PIN 4-6 chiffres) + tarifs |
| `login` / `logout` | public | PIN (barbier) ou mot de passe (gérant) ; verrou 60 s après 5 échecs |
| `state` | connecté | services + journal du jour **sans prix** |
| `add_entry` | connecté | enregistre une prestation (accepte `client_time` pour la file hors-ligne) |
| `undo_entry` | connecté | barbier : sa saisie, < 5 min ; gérant : tout |
| `stats` | **gérant** | totaux, kpis, série par jour, répartition, delta vs période précédente |
| `entry_update` | **gérant** | corrige prix / paiement |
| `service_save` / `service_delete` | **gérant** | CRUD prestations |
| `barbers` / `barber_save` / `barber_toggle` | **gérant** | équipe + PIN |
| `owner_password` | **gérant** | changement de mot de passe |
| `export&from=Y-m-d&to=Y-m-d` | **gérant** | CSV (`;`, BOM UTF-8, prêt pour Excel) |

Fuseau : `Europe/Paris` (défini dans `db.php`).

## 7. Confidentialité / anti-indexation

Quatre couches : meta `noindex` dans `index.html` · en-tête `X-Robots-Tag`
via `.htaccess` et `api.php` · `robots.txt` Disallow all · et de toute façon
**rien n'est visible sans connexion**. Aucun lien ne doit pointer vers cette
app depuis le site public.

---

## 8. DÉPLOIEMENT SUR HOSTINGER — étapes exactes

Prérequis : hébergement mutualisé Hostinger avec PHP ≥ 8.0 (extension
pdo_sqlite incluse par défaut). **Aucun nom de domaine à acheter** : on utilise
un sous-domaine gratuit du domaine existant.

### Étape A — Créer le sous-domaine
1. Se connecter sur `https://hpanel.hostinger.com`
2. Ouvrir l'hébergement du site → menu **Domaines** → **Sous-domaines**
3. Créer le sous-domaine `gestion` (résultat : `gestion.<domaine du site>`)
4. Noter le **dossier racine** attribué (ex. `public_html/gestion` ou
   `domains/gestion.<domaine>/public_html`)

### Étape B — Déposer les fichiers
1. hPanel → **Fichiers** → **Gestionnaire de fichiers**
2. Naviguer vers le dossier racine du sous-domaine (étape A.4)
3. Téléverser **tout le contenu du dossier `gestion/` de ce dépôt GitHub**
   (`jajamouss/site-rituelbarber`, branche principale une fois fusionnée) :
   `index.html`, `api.php`, `db.php`, `sw.js`, `manifest.webmanifest`,
   `robots.txt`, `.htaccess`, dossiers `assets/` et `icons/`.
   - Le plus simple : téléverser un zip du dossier puis « Extraire », et
     s'assurer que les fichiers sont bien **à la racine** du sous-domaine
     (PAS dans un sous-dossier `gestion/`).
   - ⚠️ Vérifier que `.htaccess` (fichier caché) a bien été transféré :
     activer « Afficher les fichiers cachés » dans le gestionnaire.
4. Ne PAS créer le dossier `data/` : il se crée tout seul.

### Étape C — HTTPS
1. hPanel → **Sécurité** → **SSL**
2. Vérifier qu'un certificat couvre `gestion.<domaine>` (installation
   automatique, parfois 10-15 min). Forcer HTTPS si l'option existe.

### Étape D — Première configuration (2 minutes)
1. Ouvrir `https://gestion.<domaine>` dans un navigateur
2. L'écran « Première configuration » apparaît. Renseigner :
   - **Mot de passe gérant** (8 caractères minimum) — choisi par le gérant,
     à ne stocker nulle part en clair
   - **Prénom du barbier** et son **PIN** (4 à 6 chiffres)
3. Valider → l'app crée la base et connecte le gérant.

### Étape E — Vérifications post-déploiement (checklist)
- [ ] `https://gestion.<domaine>` affiche l'app (pas d'erreur 500 → sinon
  vérifier la version PHP dans hPanel, mettre PHP 8.1+)
- [ ] `https://gestion.<domaine>/data/rituel.sqlite` renvoie **403/404**
  (jamais le fichier !)
- [ ] `https://gestion.<domaine>/robots.txt` affiche `Disallow: /`
- [ ] Se déconnecter, taper le PIN barbier → grille des prestations
- [ ] Enregistrer une prestation test → apparaît dans « Ma journée » **sans prix**
- [ ] Se reconnecter en gérant → la prestation test apparaît AVEC prix dans
  l'onglet Jour → la supprimer (toucher la ligne → Supprimer)
- [ ] Sur téléphone : « Ajouter à l'écran d'accueil » fonctionne (icône RB)

### Mises à jour ultérieures
Re-téléverser les fichiers modifiés **sans toucher au dossier `data/`**
(c'est la base de données : l'écraser = perdre l'historique).
Penser à incrémenter `?v=1` dans `index.html` et la constante `CACHE` de
`sw.js` pour invalider le cache des téléphones.

### Sauvegardes
La seule chose à sauvegarder est `data/rituel.sqlite` (téléchargeable via le
Gestionnaire de fichiers). Hostinger fait aussi des sauvegardes automatiques
de l'hébergement. L'export CSV depuis les Réglages sert de copie comptable.

---

## 9. Historique du projet

- Maquette validée par le client avec 5 pistes de couleurs ; **thème clair choisi**.
- Application développée et testée de bout en bout (PHP 8.4 + navigateur) :
  configuration, connexions PIN/mot de passe, saisies, annulation, stats
  jour/semaine/mois, export CSV, absence totale de montants côté barbier.
- Le site public (racine du dépôt) n'est **pas** modifié par cette app ;
  `gestion/` est autonome.
