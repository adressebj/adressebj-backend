# Cahier des Charges — AdresseBJ
### Système d'adressage numérique béninois

---

**Institution :** École Supérieure de Gestion d'Informatique et de Sciences (ESGIS)  
**Ministère :** Ministère de l'Enseignement Supérieur et de la Recherche Scientifique  
**Filière :** IRT-AL  

**Membres du groupe**
1. BADAROU Mouwafic
2. BANKOLE Primael

---

## Table des matières

1. [Contexte](#1-contexte)
2. [Objectifs](#2-objectifs)
3. [Périmètre](#3-périmètre)
4. [Description fonctionnelle](#4-description-fonctionnelle)
5. [Budget](#5-budget)
6. [Délais](#6-délais)

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
| Fournir à toute personne disposant d'un lien ou d'un code un accès visuel sans appel téléphonique | Taux de réussite en test utilisateur contrôlé | ≥ 90% sur 5 testeurs fictifs. Seuil inspiré des standards Nielsen Norman Group. | Semaine 6 |
| Exposer une API REST versionnée et documentée | Endpoints `/api/v1/` fonctionnels sur Swagger | 7 endpoints opérationnels : `resolve`, `verify`, `eta`, `visits/confirm`, `zones/analytics`, `zones` (liste), `addresses` (création). | Semaine 6 |
| Déployer l'application avant la soutenance | URL active et fonctionnelle | Application accessible en ligne. | Semaine 6 |

---

## 3. Périmètre

### Cibles

Le système AdresseBJ s'adresse à quatre profils distincts :

| Profil | Description | Rôle dans le système |
|--------|-------------|----------------------|
| **Habitant** | Toute personne souhaitant enregistrer son domicile ou commerce, consulter une adresse ou naviguer vers un lieu. Tout âge, tout niveau technique. Compte obligatoire pour toute action avec effet (évaluation, signalement, contribution terrain, création d'adresse). Un Habitant peut également se rattacher à une adresse existante comme contributeur rattaché. | Créateur, consultant, évaluateur et contributeur d'adresse |
| **Modérateur** | Utilisateur dont le compte est créé manuellement par un Administrateur. Dispose exclusivement de permissions de modération : validation ou rejet des adresses en attente, gestion des signalements, des contributions terrain et des propositions de contributeurs rattachés. | Modérateur de contenu |
| **Administrateur** | Gestionnaire global de la plateforme. Dispose de toutes les permissions du Modérateur, plus la gestion des zones géographiques, des clés API, du référentiel et des comptes Modérateurs. | Gestionnaire de plateforme |
| **Développeur tiers** | Entreprise ou service intégrant l'API dans son propre système. | Intégrateur API |

### Gestion des accès

Le système distingue quatre niveaux d'accès :

- **Accès public** (toute personne disposant d'un lien, d'un QR code ou du code unique) : consultation d'une adresse (photo, instructions) et navigation intégrée. Aucune inscription requise.
- **Accès Habitant** : création, modification et désactivation de ses propres adresses ; rattachement à une adresse existante comme contributeur ; évaluation et signalement sur toute adresse publiée. L'inscription se fait exclusivement par numéro de téléphone vérifié par OTP. L'email est un champ optionnel de profil, jamais utilisé comme identifiant d'authentification.
  > *Justification : le téléphone est universel au Bénin, cohérent avec le partage WhatsApp, et évite la gestion de deux flux d'authentification distincts.*
- **Accès Modérateur** : permissions de modération exclusivement : validation ou rejet des adresses en attente de publication (motif obligatoire en cas de rejet), gestion des signalements en attente, validation ou rejet des contributions terrain en attente, et validation ou rejet des propositions de contributeurs rattachés en attente. Compte créé manuellement par un Administrateur.
- **Accès Administrateur** : toutes les permissions de modération du Modérateur, plus la gestion des zones géographiques, des clés API, du référentiel et des comptes Modérateurs. Compte créé manuellement.

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
| Consultations uniques / mois | 300 | 1 500 | 3 à 5 consultations par adresse active |
| Développeurs tiers (API) | 2 | 10 | Apps diverses, pas uniquement logistique |
| Requêtes API / jour | 100 | 500 | Phase de lancement |
| Stockage photos | 250 Mo | 1 Go | ~100 Ko par adresse après compression |

### Hors périmètre

- Application mobile native iOS / Android
- Système de paiement ou de facturation
- Gestion des tournées ou suivi de colis
- Cartographie personnalisée avec tuiles propres
- Vérification formelle d'identité (KYC) — l'OTP téléphone est l'ancrage minimal du prototype

---

## 4. Description fonctionnelle

Le problème central d'AdresseBJ est l'absence de référentiel commun entre celui qui connaît un lieu et celui qui doit le trouver. La solution crée un **identifiant numérique unique**, associant un lieu physique à ses données de localisation, partageable sans friction et interrogeable par n'importe quel système.

### Besoin 1 : Créer une adresse ou se rattacher à une adresse existante

Pour qu'un habitant puisse diffuser son adresse, il doit pouvoir l'enregistrer de façon autonome et fiable, sans assistance technique.

#### Prévention des doublons à la création

Avant toute création, le système vérifie les adresses publiées dans un rayon de 15m autour de la position GPS de l'habitant. Si des adresses existent dans ce rayon, elles sont toutes affichées avec leur photo et leur code unique. L'habitant fait alors un choix explicite :

- **Se rattacher à une adresse existante** : si l'une des adresses affichées correspond à son lieu, il la sélectionne et devient contributeur rattaché de cette adresse.
- **Créer une nouvelle adresse** : si aucune adresse affichée ne correspond à son lieu, il procède à la création.

Ce mécanisme élimine la majorité des doublons involontaires à la source, sans recourir à une fusion post-hoc.

#### Rattachement à une adresse existante

Un Habitant rattaché à une adresse peut proposer des modifications sur son contenu : photo, instructions d'accès et position GPS. Chaque proposition suit le circuit suivant :

1. Soumission par le contributeur rattaché.
2. Examen par un Modérateur ou un Administrateur dans la file de modération dédiée.
3. Si jugée pertinente : notification au propriétaire de l'adresse, qui intègre ou ignore la proposition. **Le propriétaire a le dernier mot sur le contenu de son adresse.**
4. Si jugée non pertinente : rejet par le modérateur, avec motif transmis au contributeur.

En cas de suppression de compte du propriétaire, l'adresse est désactivée et tous les contributeurs rattachés sont notifiés. Ils sont libres de créer une nouvelle adresse pour ce lieu.

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

Une adresse incomplète ne peut pas être soumise à validation. Une adresse complète soumise passe à l'état `en_attente_validation` jusqu'à décision d'un Modérateur ou d'un Administrateur. En cas de rejet, un motif obligatoire est transmis au créateur par notification push ; le créateur peut corriger et resoumettre.

#### Cycle de vie d'une adresse — états

| État | Description | Transition suivante | Acteur |
|------|-------------|---------------------|--------|
| `brouillon` | Adresse incomplète, non soumise. Invisible publiquement et via API. | Soumission par le créateur si toutes les conditions sont remplies | Habitant |
| `en_attente_validation` | Adresse complète soumise, en attente de décision. Invisible publiquement et via API. | Validation ou rejet | Modérateur / Administrateur |
| `publiée` | Adresse active, consultable publiquement et résolvable via API. | Modification (avec re-validation) ou désactivation | Habitant / Modérateur / Administrateur |
| `rejetée` | Adresse refusée avec motif. Invisible publiquement. Le créateur peut corriger et resoumettre. | Retour à `brouillon` après correction | Habitant |
| `désactivée` | Adresse retirée définitivement. Code non réattribuable. La page informe sans exposer les données. | Aucune | Habitant / Modérateur / Administrateur |

---

### Besoin 2 : Partager une adresse

Une fois son adresse créée, l'habitant peut la partager sans demander à son interlocuteur d'installer une application.

- **Lien cliquable** partageable sur WhatsApp en un tap — ouvre directement la page dans le navigateur.
- **QR code** généré automatiquement, imprimable et apposable sur le portail pour une consultation par scan direct.

---

### Besoin 3 : Consulter et naviguer vers une adresse

Toute personne accède instantanément à une page récapitulative sans inscription, via le lien partagé, le QR code ou la saisie directe du code unique dans la barre de recherche. Cette page présente dans l'ordre :

1. La **photographie du portail** pour identification visuelle
2. Les **instructions d'accès** structurées en liste numérotée en logique béninoise
3. Une **interface de navigation intégrée** via Leaflet.js et OpenStreetMap, affichant le trajet depuis la position courante jusqu'au portail avec suivi en temps réel

La navigation est assurée **sans redirection vers une application tierce**. L'itinéraire est calculé par OSRM sur le réseau routier réel.

L'horodatage de départ est enregistré au lancement de la navigation ; l'horodatage d'arrivée est enregistré à la confirmation via le bouton **« J'y suis »**. Ces deux enregistrements sont des collectes de données de trajet anonymes : aucun compte n'est requis pour les déclencher.

À l'issue de la navigation, une évaluation sur 5 étoiles est proposée. Si la note est ≤ 3/5 ou si l'habitant ne soumet pas d'évaluation, un formulaire de contribution terrain optionnel est proposé : un champ texte libre permettant de préciser toute information utile au terrain. La soumission nécessite un compte Habitant authentifié et est soumise à validation par un Modérateur ou un Administrateur avant publication. Le signalement d'un problème est également surfacé à ce moment, sans préjudice de son accessibilité permanente depuis la page de l'adresse. La consultation et la navigation restent intégralement accessibles sans compte.

> AdresseBJ collecte et traite des données à caractère personnel conformément à la **loi n°2017-20 du 20 avril 2017** portant code du numérique en République du Bénin. Les données d'une adresse appartiennent à leur créateur, qui consent explicitement à la visibilité publique avant toute publication.

---

### Besoin 4 : Gérer les comptes utilisateurs

#### Authentification

Les règles d'authentification diffèrent selon le profil :

- **Habitant** : connexion par numéro de téléphone et mot de passe. L'OTP SMS est utilisé uniquement à l'inscription pour vérifier le numéro, et à chaque modification de numéro.
- **Modérateur et Administrateur** : connexion par email et mot de passe. Réinitialisation du mot de passe via email.

#### Espace personnel Habitant

L'espace personnel de l'Habitant regroupe trois éléments :

- **Ses adresses** : liste de toutes ses adresses avec leur état courant (`brouillon`, `en_attente_validation`, `publiée`, `rejetée`, `désactivée`).
- **Ses rattachements** : liste des adresses auxquelles il est rattaché comme contributeur.
- **Ses notifications** : historique complet, consultable à tout moment.

#### Modification de profil

L'Habitant peut modifier depuis son espace personnel :
- Son nom et prénom : modification libre, sans vérification.
- Son email : modification libre, sans vérification. L'email n'étant pas un identifiant d'authentification, aucune confirmation n'est requise.
- Son numéro de téléphone : nécessite une re-vérification OTP du nouveau numéro. Les sessions actives sont invalidées à l'issue du changement.

#### Suppression de compte

L'Habitant peut supprimer son compte depuis son espace personnel. Avant confirmation définitive, un écran récapitulatif liste les conséquences : ses adresses seront désactivées, les contributeurs rattachés à ses adresses seront notifiés et libres de recréer, ses données personnelles seront effacées sous 30 jours.

#### Gestion des comptes par l'Administrateur

L'Administrateur dispose d'une interface de gestion des comptes lui permettant de :

- **Créer et gérer les comptes Modérateurs** : création manuelle, désactivation et réactivation sans suppression définitive, modification ou réinitialisation du mot de passe.
- **Suspendre un compte Habitant** : en cas de comportement abusif (spam d'adresses, signalements malveillants). Les adresses de l'Habitant suspendu restent visibles publiquement. Ses rattachements et sa capacité à soumettre de nouvelles contributions sont gelés pendant la suspension. L'Habitant est notifié avec motif. La suspension est à durée indéterminée et levée manuellement par l'Administrateur.

---

### Besoin 5 : Intégrer l'adressage dans un système tiers

Les entreprises, services publics et applications tierces peuvent interroger le système automatiquement via une **API REST versionnée documentée sur Swagger**. Un développeur tiers, disposant d'une clé API au format `bj_live_[16car]`, accède aux endpoints suivants :

| Endpoint | Description |
|----------|-------------|
| `GET /api/v1/addresses/{code}/resolve` | Résolution d'un code en données structurées (coordonnées GPS, photo, instructions, zone). Réponse JSON intégrable sans transformation. |
| `GET /api/v1/addresses/{code}/verify` | Retourne la moyenne des évaluations (sur 5, arrondie au dixième) et le nombre total d'évaluations. Conçu pour les cas d'usage de vérification d'adresse (KYC fintech, banques, assurances). |
| `GET /api/v1/addresses/{code}/eta` | Estimation du temps de trajet calculée sur des données réelles. La fiabilité est nulle au lancement et croît avec le volume. |
| `POST /api/v1/visits/confirm` | Permet aux intégrateurs de notifier le système à l'issue d'un trajet. Transmet le prix final et l'heure d'arrivée réelle. |
| `GET /api/v1/zones/{id}/analytics` | Rapport agrégé par zone : volume de trajets, prix médian, ETA médian, heures de pointe, taux de succès. |

#### Comportement de l'API face à une adresse indisponible

| Cas | Réponse HTTP |
|-----|-------------|
| Adresse inexistante | `404 Not Found` |
| Adresse en attente de validation | `404 Not Found` (l'adresse n'a jamais été publique ; son existence n'est pas exposée) |
| Adresse désactivée | `410 Gone` avec corps `{"code": "ADDRESS_INACTIVE", "message": "This address has been deactivated.", "address_code": "AKP-7X3K", "deactivated_at": "2025-03-14T10:22:00Z"}` |

#### Obligation de remontée de données

La remontée des données via `POST /api/v1/visits/confirm` est une **condition d'utilisation de l'API**. Un système de quota progressif est appliqué :

- **Accès de base :** `resolve`, `verify` et `eta` accessibles à toute clé API active.
- **Accès analytique** (`zones/analytics`) : conditionné à un ratio de remontée **≥ 80%** sur 30 jours glissants. Si le ratio chute, l'accès aux analytics est suspendu automatiquement avec notification. L'endpoint `resolve` reste toujours accessible.

---

### Besoin 6 : Gérer les zones géographiques

À l'initialisation, un script importe automatiquement les quartiers des communes couvertes depuis **OpenStreetMap via l'API Overpass**. Chaque quartier devient une zone avec son périmètre GPS, son nom officiel et son préfixe de code généré.

L'administrateur arrive sur un tableau de bord pré-rempli : son rôle est de valider, ajuster et activer les zones, pas de les créer depuis zéro. Pour les quartiers informels absents d'OSM, la création manuelle reste disponible.

L'administrateur peut :
- Visualiser la couverture sur une carte et ajuster les périmètres si nécessaire.
- Superviser la qualité du référentiel : signalements, doublons suspects, adresses à modérer.
- Consulter les fourchettes de prix calculées automatiquement par agrégation des données de trajets confirmés (en lecture seule).

> Le champ affiche **« données insuffisantes »** tant que le volume est insuffisant pour un indicateur représentatif.

---

### Besoin 7 : Gérer le cycle de vie d'une adresse

Le créateur peut modifier à tout moment la photo, les instructions ou la position GPS depuis son espace personnel. Toute modification soumet la nouvelle version à re-validation. L'adresse reste consultable publiquement dans sa version précédente jusqu'à validation par un Modérateur ou un Administrateur. En cas de rejet, la version précédente reste active et le créateur reçoit le motif par notification push. **Le code reste inchangé** — les liens et QR codes déjà partagés pointent automatiquement vers la version active.

Lorsqu'un créateur **désactive son adresse**, la page informe que l'adresse n'est plus active sans exposer les données. Le code est définitivement retiré et ne sera jamais réattribué. Les contributeurs rattachés à cette adresse sont notifiés et libres de créer une nouvelle adresse pour ce lieu.

Un Modérateur ou un Administrateur peut désactiver toute adresse signalée. **Le Modérateur a le dernier mot sur la visibilité d'une adresse, jamais sur son contenu.**

En cas de **suppression de compte du propriétaire**, l'adresse est désactivée immédiatement. Les contributeurs rattachés sont notifiés et libres de créer une nouvelle adresse pour ce lieu. Les données personnelles du propriétaire sont effacées sous **30 jours**.

Les notifications push au créateur couvrent : la validation de son adresse, le rejet avec motif obligatoire, la dégradation du score de fiabilité, et toute désactivation par un Modérateur ou un Administrateur avec motif. Toutes les notifications sont stockées et consultables à tout moment depuis l'espace personnel de l'Habitant.

#### Propriétaire inactif

Un signalement sur une adresse dont le propriétaire n'a pas eu de session depuis plus de **90 jours** est traité par le Modérateur avec présomption de validité du signalement. Le Modérateur peut désactiver l'adresse si le contenu est jugé inexact et notifie le propriétaire. Ce critère d'inactivité est une aide à la décision pour le Modérateur, pas un déclencheur automatique.

#### File de modération

Le Modérateur et l'Administrateur disposent d'une interface dédiée présentant quatre files distinctes, traitées indépendamment :
- **Adresses en attente** : adresses soumises par des Habitants, en attente de première publication.
- **Signalements en attente** : signalements soumis par des Habitants authentifiés sur des adresses publiées.
- **Contributions terrain en attente** : précisions soumises à l'issue de navigations, en attente de validation.
- **Propositions de contributeurs rattachés en attente** : modifications de photo, instructions ou position GPS proposées par des Habitants rattachés à une adresse, en attente de décision avant notification au propriétaire.

---

### Besoin 8 : Assurer la fiabilité du référentiel

Le score de fiabilité est alimenté par deux canaux distincts :

1. Les **évaluations manuelles des habitants authentifiés** sur la page de l'adresse (notation sur 5 étoiles, modifiable à tout moment).
2. Les **données de trajets remontées automatiquement** par les intégrateurs via l'endpoint de confirmation.

#### Affichage du score de fiabilité

La note moyenne est affichée publiquement sur la page de l'adresse (ex : 3.7/5, basée sur N évaluations). Tant qu'aucune évaluation n'a été soumise, la mention suivante est affichée : *« Aucune évaluation pour le moment — le score de fiabilité n'est pas encore disponible. »* Le score numérique brut est également exposé via l'API et le dashboard Administrateur.

#### Niveaux d'exposition du score de fiabilité

| Donnée | Page publique | API (Développeur tiers) | Dashboard (Admin) |
|--------|:---:|:---:|:---:|
| Score numérique (moyenne/5) | ✓ | ✓ | ✓ |
| Nombre d'évaluations | ✓ | ✓ | ✓ |
| Historique des signalements | ✗ | ✗ | ✓ |

#### Notification de l'Habitant en cas de dégradation

- **Seuil intermédiaire :** notification push informative — *« Votre adresse AKP-7X3K a reçu des retours négatifs. Vérifiez que les informations sont à jour. »* L'habitant peut corriger avant toute intervention administrative.
- **Désactivation par un Modérateur ou un Administrateur :** notification explicite avec motif.

#### Unicité de l'évaluation Habitant

Un Habitant authentifié ne peut soumettre qu'une évaluation par adresse, modifiable à tout moment depuis la page de l'adresse. La contrainte est une unicité en base sur le couple `(habitant_id, code_adresse)` : toute nouvelle soumission remplace la précédente. Le score de fiabilité est recalculé immédiatement à chaque modification.

#### Signalement

Depuis la page d'une adresse publiée, tout Habitant authentifié peut **signaler un problème** en un tap. Le signalement est également surfacé après une évaluation ≤ 3/5. Chaque signalement est routé vers la file de modération, traitée par un Modérateur ou un Administrateur.

---

## 5. Budget

Le projet est réalisé dans un cadre académique avec des outils majoritairement gratuits.

### Coûts opérationnels

| Poste de dépense | Solution retenue | Estimation |
|------------------|-----------------|------------|
| Hébergement backend | Render.com, plan gratuit | 0 FCFA |
| Base de données | Render.com PostgreSQL, plan gratuit | 0 FCFA |
| Stockage photos | Cloudinary, plan gratuit (25 Go, compression `q_auto,f_auto`) | 0 FCFA |
| Navigation et routage | Leaflet.js + tuiles OpenStreetMap + API publique OSRM | 0 FCFA |
| Import zones géographiques | API Overpass (OpenStreetMap), import initial unique | 0 FCFA |
| Maintien actif backend | cron-job.org, ping toutes les 10 min (7h–23h) | 0 FCFA |
| Nom de domaine (optionnel) | adressebj.com ou sous-domaine gratuit | ~5 000 FCFA/an |
| Outils de développement | VS Code, GitHub, Figma, Postman | 0 FCFA |
| Tests terrain, données mobiles | Forfait personnel | ~3 000 FCFA |
| **TOTAL COÛTS OPÉRATIONNELS** | | **~8 000 FCFA** |

### Ressources humaines

| Ressource | Volume estimé | Valeur marché | Coût projet |
|-----------|--------------|---------------|-------------|
| Développeur fullstack (×2) | 2 × 7 sem. × ~15h = 210h | ~2 500 FCFA/h = 525 000 FCFA | 0 FCFA (académique) |
| **TOTAL** | **210 heures** | **~525 000 FCFA** | **0 FCFA** |

### Dettes techniques documentées

Les choix techniques suivants sont retenus pour le prototype académique à coût zéro. Chacun est conscient et documenté :

**Render.com plan gratuit — cold start**
- Risque : le service entre en veille après inactivité, réveil 30 à 60 secondes.
- Mitigation : un cron job (cron-job.org) envoie une requête HTTP toutes les 10 minutes de 7h à 23h.
- En production : migration vers un plan payant.

**API publique OSRM**
- Risque : quota et disponibilité non garantis en production.
- Mitigation : tous les appels OSRM sont encapsulés derrière un `RoutingService` interne. Fallback gracieux : si OSRM ne répond pas, affichage du marqueur de destination sans itinéraire.
- En production : instance OSRM dédiée hébergée en propre.

**Cloudinary bande passante**
- Risque : le plan gratuit est limité en transformations et bande passante.
- Mitigation : compression automatique (`q_auto,f_auto`) activée sur toutes les URLs, réduisant le poids moyen de ~500 Ko à ~80–120 Ko sans perte visuelle perceptible.

---

## 6. Délais

La réalisation du projet s'étend sur **7 semaines**. Le planning est organisé en deux tracks parallèles (Dev Backend et Dev Frontend). La seule phase séquentielle est S1. L'intégration réelle se fait progressivement en S4. **La semaine S6 est une marge de sécurité intentionnelle et non planifiée.**

### Diagramme de Gantt

|  | S1 | S2 | S3 | S4 | S5 | S6 | S7 |
|--|----|----|----|----|----|----|-----|
| **Backend** | Conception commune | Auth + endpoints | Endpoints + deploy | Support intégration | Admin API + Swagger | *Marge* | Démo finale |
| **Frontend** | Conception commune | Interface habitant | Interface consultation + deploy | Branchement backend | Admin UI + polish | *Marge* | Démo finale |

### Planning détaillé avec jalons

| Sem. | Dev Backend | Dev Frontend | Mode | Critère de validation du jalon |
|------|-------------|--------------|------|--------------------------------|
| **S1** | Schéma BDD + contrats API + mocks JSON + import zones OSM | Révision conjointe des mocks + setup repos + premières maquettes Figma | Conjoint | Mocks JSON validés. Schéma BDD approuvé. Zones importées depuis OSM. |
| **S2** | Auth OTP téléphone + endpoints `resolve` & `verify` + génération codes + logique détection doublons 15m | Setup Next.js + interface habitant sur mocks + début interface consultation | Parallèle | Auth testée sur Postman. Codes générés sans collision (test unitaire). Détection doublons fonctionnelle. Interface habitant fonctionnelle sur mocks. |
| **S3** | Endpoints restants (`eta`, `visits/confirm`, `zones/analytics`) + deploy Render + Swagger partiel | Interface consultation + navigation Leaflet/OSRM + QR code + og:tags WhatsApp + deploy Vercel | Parallèle | Les 7 endpoints répondent sur Postman. Navigation intégrée fonctionnelle. Frontend déployé sur URL publique. |
| **S4** | Support intégration + corrections backend + tests Postman finaux | Branchement vrai backend + dashboard modération frontend (4 files) + tests utilisateurs | Intégration | Scénario end-to-end : création, rattachement, partage, consultation, navigation sans erreur. `410 Gone` validé sur code désactivé. Les 4 files de modération sont fonctionnelles. |
| **S5** | Dashboard admin API + Swagger complet + polish final API | Corrections bugs + polish UI + répétition scénario démo | Parallèle | Swagger complet sur les 7 endpoints. Test : ≥ 90% de réussite sur 5 scénarios. Zéro bug bloquant. |
| **S6** | *Marge de sécurité* | *Marge de sécurité* | Buffer | Semaine libre. Utilisée uniquement si un jalon précédent est incomplet. |
| **S7** | Répétition démo finale + dernières corrections | Répétition démo finale + dernières corrections | Conjoint | Démo répétée avec succès de bout en bout. Application stable sur URL publique. |

### Stratégie de test technique

Un filet de sécurité technique minimal est défini en trois niveaux :

- **Tests unitaires :** génération de codes (zéro collision sur 1 000 adresses), assemblage des instructions (`steps.join`), calcul du score de fiabilité, détection doublons dans un rayon de 15m.
- **Tests d'intégration :** les 5 endpoints API critiques (`resolve`, `verify`, `eta`, `visits/confirm`, `zones/analytics`) testés avec cas nominaux et cas d'erreur (`404`, `410`, `401`).
- **Smoke test de démo :** script automatisé validant le parcours complet création → validation → partage → consultation → navigation avant chaque déploiement ou démonstration.

---

## Conclusion

AdresseBJ répond à un besoin réel et quotidien au Bénin. En dotant chaque lieu d'un identifiant numérique partageable en un tap sur WhatsApp, consultable sans application et intégrable par n'importe quel système via API, ce projet pose les bases d'une **infrastructure d'adressage ouverte**, applicable à tout contexte de localisation, qui dépasse le simple prototype académique.

## Perspectives futures

- **Mode hors-ligne avancé :** consultation des adresses sans connexion, au-delà du cache PWA de base.
- **Application mobile native Android** pour une expérience terrain encore plus fluide (GPS background, performance).
- Extension progressive à toutes les communes du Bénin.
- Partenariats avec les acteurs du e-commerce, de la logistique et des services financiers locaux.
- Vérification d'identité (KYC) et contrôle de majorité légale pour les créateurs de comptes.
- ETA et Zone analytics exposés comme services premium une fois la masse critique de données atteinte.
- Instance OSRM dédiée hébergée en propre pour s'affranchir de l'API publique en production.
- Contestation des décisions de modération (désactivation, rejet).

---

*Document réalisé dans le cadre du cursus IRT-AL — ESGIS, République du Bénin.*
