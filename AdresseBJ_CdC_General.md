# Cahier des Charges — AdresseBJ
### Système d'adressage numérique béninois

---

## Table des matières

1. [Contexte](#1-contexte)
2. [Objectifs](#2-objectifs)
3. [Périmètre](#3-périmètre)
4. [Description fonctionnelle](#4-description-fonctionnelle)
---

## 1. Contexte

Au Bénin, l'absence d'un système d'adressage physique standardisé constitue un obstacle quotidien pour des millions de personnes. Les rues sont souvent sans nom officiel, les maisons sans numéro, et la localisation d'un lieu repose entièrement sur des repères oraux et informels :

> *« après le grand carrefour, 3ème von à gauche, portail bleu en face du manguier »*

Ces descriptions, transmises de bouche à oreille ou par message vocal sur WhatsApp, sont imprévisibles, non réutilisables et totalement inopérantes dans les systèmes informatiques.

Cette réalité engendre des inefficacités concrètes et mesurables :
- Les livreurs passent en moyenne **10 à 15 minutes** au téléphone pour localiser un destinataire.
- Les services d'urgence peinent à intervenir rapidement faute de repères précis.
- Les entreprises ne peuvent pas automatiser leurs processus tant qu'elles dépendent d'un appel téléphonique pour chaque destination.

### Importance stratégique

Le secteur de la logistique et du commerce en ligne est en pleine expansion au Bénin. Des acteurs comme Gozem, Yango ou les plateformes de vente locales voient leur croissance structurellement limitée par l'absence d'un système d'adressage fiable. Un identifiant numérique de lieu constitue une **infrastructure critique pour le développement économique du pays**, au même titre que le réseau routier ou le réseau électrique.

### Positionnement du produit

AdresseBJ est une **infrastructure d'adressage**, pas un outil de livraison. Le problème qu'il résout — l'absence de système de localisation précis et réutilisable — affecte tout le monde : un habitant qui veut être trouvé par un ami, un médecin qui cherche son patient, un service d'urgence qui intervient, une fintech qui vérifie une adresse de résidence.

Le système est structuré en **deux couches indépendantes** :

| Couche | Description |
|--------|-------------|
| **Infrastructure** | Universelle : créer, partager, consulter et naviguer vers une adresse. Aucun profil d'usage imposé. |
| **API** | Contextuelle : chaque intégrateur consomme les endpoints selon son propre contexte (livraison, navigation, vérification fintech, etc.). |

### Intégration à l'écosystème existant

AdresseBJ ne cherche pas à remplacer les outils existants mais à s'y greffer :

- **Google Maps** s'arrête souvent au niveau de la rue dans les quartiers non cartographiés — AdresseBJ complète cette précision jusqu'à la porte.
- **GPS Local** propose un guidage en repères locaux jusqu'à proximité d'un lieu — AdresseBJ prend le relais pour les derniers mètres avec des instructions structurées ancrées à un identifiant permanent.
- **WhatsApp**, premier canal de communication au Bénin, est exploité pour diffuser les adresses sans friction.

### Motivations

- Réduire le temps perdu à localiser des destinations et les coûts d'exploitation qui en découlent.
- Améliorer la réactivité des services d'urgence en leur fournissant des coordonnées précises et vérifiables.
- Permettre aux entreprises locales d'automatiser leurs processus sans intervention humaine.
- Poser les bases d'un standard national d'adressage numérique ouvert et réutilisable.

### Problématique

> **Comment permettre à tout habitant du Bénin de disposer d'une adresse numérique unique, précise et partageable, exploitable par n'importe quelle application ou service sans intervention humaine ?**

---

## 2. Objectifs

### Objectif général

Concevoir et développer une **Progressive Web App (PWA)** permettant de créer, partager et résoudre des adresses numériques uniques pour tout lieu physique au Bénin, afin d'éliminer le recours aux descriptions orales floues dans les processus de localisation.

### Objectifs spécifiques (SMART)

| Objectif | Indicateur | Seuil & justification | Échéance |
|----------|------------|----------------------|----------|
| Permettre à tout habitant de créer son adresse rapidement | Temps moyen de création mesuré en test utilisateur | ≤ 5 minutes. Seuil intégrant la saisie guidée obligatoire via prompts structurés. | Semaine 4 |
| Générer des codes uniques et non-ambigus | Nombre de collisions sur jeu de test | Zéro collision sur 1 000 adresses (test unitaire automatisé). | Semaine 3 |
| Fournir aux visiteurs un accès visuel sans appel téléphonique | Taux de réussite en test utilisateur contrôlé | ≥ 90% sur 5 visiteurs fictifs. Seuil inspiré des standards Nielsen Norman Group. | Semaine 6 |
| Exposer une API REST versionnée et documentée | Endpoints `/api/v1/` fonctionnels sur Swagger | 7 endpoints opérationnels : `resolve`, `verify`, `eta`, `visits/confirm`, `zones/analytics`, `zones` (liste), `addresses` (création). | Semaine 6 |
| Déployer l'application avant la soutenance | URL active et fonctionnelle | Application accessible en ligne. | Semaine 6 |

---

## 3. Périmètre

### Cibles

Le système AdresseBJ s'adresse à quatre profils distincts :

| Profil | Description | Rôle dans le système |
|--------|-------------|----------------------|
| **Habitant** | Toute personne souhaitant enregistrer son domicile ou commerce. Tout âge, tout niveau technique. | Créateur d'adresse |
| **Visiteur** | Toute personne consultant une adresse via un code ou QR code. Aucun compte requis. | Consultant d'adresse |
| **Administrateur** | Gestionnaire de la plateforme. Supervise les zones et la qualité des données. | Modérateur |
| **Développeur tiers** | Entreprise ou service intégrant l'API dans son propre système. | Intégrateur API |

### Gestion des accès

Le système distingue trois niveaux d'accès :

- **Accès public** (tout visiteur disposant d'un code) : consultation d'une adresse, navigation intégrée, évaluation de fiabilité. Aucune inscription requise.
- **Accès créateur** (Habitant) : création, modification et désactivation de ses propres adresses. L'inscription se fait exclusivement par numéro de téléphone vérifié par OTP. L'email est un champ optionnel de profil, jamais utilisé comme identifiant d'authentification.
  > *Justification : le téléphone est universel au Bénin, cohérent avec le partage WhatsApp, et évite la gestion de deux flux d'authentification distincts.*
- **Accès administrateur** : gestion des zones, modération des adresses signalées, gestion des clés API, supervision du référentiel. Compte créé manuellement.

> AdresseBJ collecte et traite des données à caractère personnel conformément à la **loi n°2017-20 du 20 avril 2017** portant code du numérique en République du Bénin. Les données d'une adresse appartiennent à leur créateur, qui consent explicitement à la visibilité publique avant toute publication.

> **Note sur la visibilité des adresses :** toute adresse dont le code est connu est consultable sans authentification. Ce choix est délibéré — il garantit qu'un visiteur peut accéder à une adresse depuis n'importe quel appareil sans friction. La structure du code intègre une composante zonale qui limite la surface d'exposition par brute force.

### Clés API

L'accès à l'API par les développeurs tiers est conditionné à l'obtention d'une clé API délivrée sur demande par l'administrateur.

- **Format :** `bj_live_[16car]`, identifiable dans les logs sans exposer la clé complète.
- **Champs associés :** date d'émission, statut (`active` / `revoked`), date d'expiration optionnelle.
- **Révocation :** l'administrateur peut révoquer une clé en un clic. Toute requête avec une clé révoquée retourne `HTTP 401` avec code `API_KEY_REVOKED`.
- **Granularité :** un seul niveau d'accès pour le prototype. La granularité par endpoint est une feature de production.

### Architecture applicative

L'application est développée sous forme de **Progressive Web App (PWA)**. Ce choix permet :
- une expérience installable depuis le navigateur sans passer par les stores applicatifs ;
- un accès partiel aux données hors connexion (dernières adresses consultées mises en cache) ;
- des notifications push pour les créateurs ;
- un accès natif à la caméra et à la géolocalisation du terminal.

Sur Android, qui représente la base installée dominante au Bénin, la compatibilité PWA est complète.

### Versioning de l'API

Toutes les routes API sont préfixées `/api/v1/` dès le premier endpoint. Règle documentée dans le Swagger :

- Les ajouts de champs optionnels sont rétrocompatibles et ne déclenchent **pas** de nouvelle version.
- Toute suppression ou modification de type de champ existant déclenche `/api/v2/`.

Cette convention protège les intégrations tierces à chaque évolution future.

### Étendue géographique

La première version couvre les communes de **Cotonou, Calavi et Abomey-Calavi**. L'extension aux autres communes est prévue à moyen terme.

### Langues

L'application est intégralement en **français**. Les instructions d'accès peuvent être rédigées en français ou en langue locale par l'habitant.

### Dimensionnement

Estimations pour la phase de lancement et les 3 premiers mois :

| Indicateur | Estimation basse | Estimation haute | Hypothèse |
|------------|-----------------|-----------------|-----------|
| Adresses créées | 500 | 2 000 | Adoption progressive sur Cotonou/Calavi |
| Comptes créateurs | 200 | 800 | Ratio ~2,5 adresses / créateur |
| Visiteurs uniques / mois | 300 | 1 500 | 3 à 5 consultations par adresse active |
| Développeurs tiers (API) | 2 | 10 | Apps diverses, pas uniquement logistique |
| Requêtes API / jour | 100 | 500 | Phase de lancement |
| Stockage photos | 250 Mo | 1 Go | ~100 Ko par adresse après compression |

### Hors périmètre

- Application mobile native iOS / Android
- Système de paiement ou de facturation
- Gestion des tournées ou suivi de colis
- Cartographie personnalisée avec tuiles propres
- Vérification formelle d'identité (KYC) — l'OTP téléphone est l'ancrage minimal du prototype
- Déduplication automatique de doublons géospatiaux — visible par l'admin, non automatisée dans cette version

---

## 4. Description fonctionnelle

Le problème central d'AdresseBJ est l'absence de référentiel commun entre celui qui connaît un lieu et celui qui doit le trouver. La solution crée un **identifiant numérique unique**, associant un lieu physique à ses données de localisation, partageable sans friction et interrogeable par n'importe quel système.

### Besoin 1 : Créer une adresse

Pour qu'un habitant puisse diffuser son adresse, il doit pouvoir l'enregistrer de façon autonome et fiable, sans assistance technique.

#### Format du code adresse

Le code adresse adopte le format **`[PRÉFIXE-ZONE]-[SÉQUENCE-4CAR]`**.

Exemples : `AKP-7X3K` (Akpakpa), `CAD-3M9P` (Cadjèhoun), `FID-K2QR` (Fidjrossè).

- **Préfixe zone :** 3 caractères générés automatiquement depuis le nom du quartier importé d'OSM (Akpakpa → `AKP`). En cas de collision entre deux quartiers, un discriminant numérique est ajouté (`AKP` / `AK2`). L'administrateur peut renommer manuellement.
- **Séquence :** 4 caractères en base 32, alphabet épuré sans `0, O, I, L` pour éviter les confusions visuelles et orales. Soit 32⁴ = **1 048 576 combinaisons par zone**, zéro collision garantie à l'échelle du prototype.
- **Génération :** aléatoire avec vérification d'unicité en base avant persistance.
- **Permanence :** un code ne change jamais, même si l'habitant modifie son adresse ou si l'admin restructure les zones. Une zone ne peut jamais être supprimée, seulement désactivée pour les nouvelles créations.

#### Saisie et stockage des instructions d'accès

Plutôt que de faire face à un champ texte libre, l'habitant répond à une séquence de questions ciblées :
- *« Depuis quel repère proche débuter ? »*
- *« Combien de voies après ce repère ? »*
- *« Quel élément visuel distinctif identifie votre portail ? »*

Le système assemble automatiquement les réponses en une description cohérente en logique béninoise, que l'habitant lit, valide ou ajuste avant publication.

Les instructions sont stockées sous forme d'un tableau d'étapes ordonnées accompagné d'un champ `assembled_text` :

```json
{
  "steps": [
    "Partir du marché Dantokpa",
    "Prendre la 2ème rue à droite",
    "Chercher le portail bleu avec étoile jaune",
    "Entrée côté nord"
  ],
  "assembled_text": "Partir du marché Dantokpa. Prendre la 2ème rue à droite. Chercher le portail bleu avec étoile jaune. Entrée côté nord."
}
```

- Chaque prompt produit une étape. La correspondance est directe, sans transformation intermédiaire.
- L'`assembled_text` est un `steps.join(". ")`, regénéré automatiquement à chaque modification.
- Côté affichage : les étapes se rendent en liste numérotée, lisible sur téléphone en mouvement.
- Côté API : le développeur tiers reçoit un tableau exploitable programmatiquement.

L'habitant renseigne également sa **position GPS** (captée automatiquement) et une **photographie reconnaissable** de son portail. À l'issue de la création, le système génère et restitue le code court mémorisable.

> **Note sur la précision GPS :** en milieu urbain dense, la précision peut varier de quelques mètres à plusieurs dizaines de mètres. AdresseBJ assume cette limitation : le GPS amène le visiteur dans la bonne rue, la photo et les instructions l'amènent devant la bonne porte.

**Conditions minimales de création :**
- Compte avec numéro de téléphone vérifié par OTP
- Coordonnées GPS dans le périmètre couvert
- Photo et instructions obligatoires

Une adresse incomplète ne peut pas être publiée.

---

### Besoin 2 : Partager une adresse

Une fois son adresse créée, l'habitant peut la partager sans demander à son interlocuteur d'installer une application.

- **Lien cliquable** partageable sur WhatsApp en un tap — ouvre directement la page dans le navigateur.
- **QR code** généré automatiquement, imprimable et apposable sur le portail pour une consultation par scan direct.

---

### Besoin 3 : Consulter et naviguer vers une adresse

Depuis un code reçu sur WhatsApp ou un QR code scanné, le visiteur accède instantanément à une **page récapitulative sans inscription**. Cette page présente dans l'ordre :

1. La **photographie du portail** pour identification visuelle
2. Les **instructions d'accès** structurées en liste numérotée en logique béninoise
3. Une **interface de navigation intégrée** via Leaflet.js et OpenStreetMap, affichant le trajet depuis la position courante jusqu'au portail avec suivi en temps réel

La navigation est assurée **sans redirection vers une application tierce**. L'itinéraire est calculé par OSRM sur le réseau routier réel.

L'horodatage de départ est enregistré au lancement ; l'horodatage d'arrivée est enregistré à la confirmation via le bouton **« J'y suis »**. Ces deux données alimentent le calcul des ETAs.

À l'issue de la navigation, le visiteur se voit proposer un formulaire optionnel limité à deux champs de précision terrain (sens de circulation, côté d'entrée). Cette contribution est soumise à validation par l'administrateur avant publication. Le visiteur reste anonyme, aucun compte n'est requis.

---

### Besoin 4 : Intégrer l'adressage dans un système tiers

Les entreprises, services publics et applications tierces peuvent interroger le système automatiquement via une **API REST versionnée documentée sur Swagger**. Un développeur tiers, disposant d'une clé API au format `bj_live_[16car]`, accède aux endpoints suivants :

| Endpoint | Description |
|----------|-------------|
| `GET /api/v1/addresses/{code}/resolve` | Résolution d'un code en données structurées (coordonnées GPS, photo, instructions, zone). Réponse JSON intégrable sans transformation. |
| `GET /api/v1/addresses/{code}/verify` | Retourne le score de fiabilité numérique et le nombre de visites. Conçu pour les cas d'usage de vérification d'adresse (KYC fintech, banques, assurances). |
| `GET /api/v1/addresses/{code}/eta` | Estimation du temps de trajet calculée sur des données réelles. La fiabilité est nulle au lancement et croît avec le volume. |
| `POST /api/v1/visits/confirm` | Permet aux intégrateurs de notifier le système à l'issue d'un trajet. Transmet le prix final et l'heure d'arrivée réelle. |
| `GET /api/v1/zones/{id}/analytics` | Rapport agrégé par zone : volume de trajets, prix médian, ETA médian, heures de pointe, taux de succès. |

#### Comportement de l'API face à une adresse désactivée

| Cas | Réponse HTTP |
|-----|-------------|
| Adresse inexistante | `404 Not Found` |
| Adresse désactivée | `410 Gone` avec corps `{"code": "ADDRESS_INACTIVE", "message": "This address has been deactivated.", "address_code": "AKP-7X3K", "deactivated_at": "2025-03-14T10:22:00Z"}` |

#### Obligation de remontée de données

La remontée des données via `POST /api/v1/visits/confirm` est une **condition d'utilisation de l'API**. Un système de quota progressif est appliqué :

- **Accès de base :** `resolve`, `verify` et `eta` accessibles à toute clé API active.
- **Accès analytique** (`zones/analytics`) : conditionné à un ratio de remontée **≥ 80%** sur 30 jours glissants. Si le ratio chute, l'accès aux analytics est suspendu automatiquement avec notification. L'endpoint `resolve` reste toujours accessible.

---

### Besoin 5 : Gérer les zones géographiques

À l'initialisation, un script importe automatiquement les quartiers des communes couvertes depuis **OpenStreetMap via l'API Overpass**. Chaque quartier devient une zone avec son périmètre GPS, son nom officiel et son préfixe de code généré.

L'administrateur arrive sur un tableau de bord pré-rempli : son rôle est de valider, ajuster et activer les zones, pas de les créer depuis zéro. Pour les quartiers informels absents d'OSM, la création manuelle reste disponible.

L'administrateur peut :
- Visualiser la couverture sur une carte et ajuster les périmètres si nécessaire.
- Superviser la qualité du référentiel : signalements, doublons suspects, adresses à modérer.
- Consulter les fourchettes de prix calculées automatiquement par agrégation des données de trajets confirmés (en lecture seule).

> Le champ affiche **« données insuffisantes »** tant que le volume est insuffisant pour un indicateur représentatif.

---

### Besoin 6 : Gérer le cycle de vie d'une adresse

- Le créateur peut modifier à tout moment la photo, les instructions ou la position GPS depuis son espace personnel. **Le code reste inchangé** — les liens et QR codes déjà partagés pointent automatiquement vers la version mise à jour.
- Lorsqu'un créateur **désactive son adresse**, la page informe le visiteur que l'adresse n'est plus active sans exposer les anciennes données. Le code est définitivement retiré et ne sera jamais réattribué.
- L'administrateur peut désactiver toute adresse signalée.
- En cas de **suppression de compte**, les adresses sont désactivées et les données personnelles effacées sous **30 jours**.

---

### Besoin 7 : Assurer la fiabilité du référentiel

Le score de fiabilité est alimenté par deux canaux distincts :

1. Les **évaluations manuelles des visiteurs** sur la page de l'adresse (conforme / non-conforme, action unique volontaire).
2. Les **données de trajets remontées automatiquement** par les intégrateurs via l'endpoint de confirmation.

#### Niveaux d'exposition du score de fiabilité

| Donnée | Page publique (Visiteur) | API (Développeur tiers) | Dashboard (Admin) |
|--------|:------------------------:|:-----------------------:|:-----------------:|
| Score numérique | ✗ | ✓ | ✓ |
| Badge qualitatif (vert/orange/rouge) | ✓ | ✗ | ✓ |
| Nombre de visites | ✓ | ✓ | ✓ |
| Historique des signalements | ✗ | ✗ | ✓ |

> Le visiteur voit un badge visuel, pas un chiffre. Le chiffre brut est réservé aux usages techniques. Cette distinction protège contre la gamification du score par les créateurs.

#### Notification de l'Habitant en cas de dégradation

- **Seuil intermédiaire :** notification push informative — *« Votre adresse AKP-7X3K a reçu des retours négatifs. Vérifiez que les informations sont à jour. »* L'habitant peut corriger avant toute intervention administrative.
- **Désactivation administrative :** notification explicite avec motif et possibilité de contester ou corriger.

#### Unicité du vote Visiteur

Le visiteur totalement anonyme ne peut voter qu'une fois par adresse par jour. Double mécanisme :

- **Côté client :** un flag `voted_[CODE]: true` est stocké en `localStorage` à la première évaluation.
- **Côté serveur :** un hash non-réversible de `IP + User-Agent + code_adresse + date_du_jour` est enregistré. Les votes en rafale depuis la même source dans la même journée sont ignorés.

Depuis la page publique, tout visiteur peut également **signaler un problème** en un tap — chaque signalement est transmis à l'administrateur pour examen.

---

### Stratégie de test technique

Un filet de sécurité technique minimal est défini en trois niveaux :

- **Tests unitaires :** génération de codes (zéro collision sur 1 000 adresses), assemblage des instructions (`steps.join`), calcul du score de fiabilité.
- **Tests d'intégration :** les 5 endpoints API critiques (`resolve`, `verify`, `eta`, `visits/confirm`, `zones/analytics`) testés avec cas nominaux et cas d'erreur (`404`, `410`, `401`).
- **Smoke test de démo :** script automatisé validant le parcours complet création → partage → consultation → navigation avant chaque déploiement ou démonstration.

---

## Conclusion

AdresseBJ répond à un besoin réel et quotidien au Bénin. En dotant chaque lieu d'un identifiant numérique partageable en un tap sur WhatsApp, consultable sans application et intégrable par n'importe quel système via API, ce projet pose les bases d'une **infrastructure d'adressage ouverte**, applicable à tout contexte de localisation, qui dépasse le simple prototype académique.

## Perspectives futures

- **Mode hors-ligne avancé :** consultation des adresses sans connexion, au-delà du cache PWA de base.
- **Application mobile native Android** pour une expérience terrain encore plus fluide (GPS background, performance).
- Extension progressive à toutes les communes du Bénin.
- Partenariats avec les acteurs du e-commerce, de la logistique et des services financiers locaux.
- Vérification d'identité (KYC) et contrôle de majorité légale pour les créateurs de comptes.
- Détection automatique de doublons géospatiaux et suggestions de fusion à l'administrateur.
- Score de fiabilité affiché publiquement une fois le volume de retours statistiquement significatif.
- ETA et Zone analytics exposés comme services premium une fois la masse critique de données atteinte.
- Instance OSRM dédiée hébergée en propre pour s'affranchir de l'API publique en production.

---

*Document réalisé dans le cadre du cursus IRT-AL — ESGIS, République du Bénin.*
