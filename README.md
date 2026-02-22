# KeePic

Application de bureau pour importer, dédupliquer et organiser des photos dans une bibliothèque locale partagée.

Fonctionne sur **Windows 10/11** et **macOS**. La bibliothèque peut être synchronisée entre plusieurs machines via Synology Drive (ou tout autre outil de sync de dossiers).

---

## Téléchargement

Les installeurs sont disponibles sur la page [**Releases GitHub**](https://github.com/MateoTTR/keepic/releases).

| Plateforme | Fichier |
|---|---|
| Windows 10/11 | `KeePic Setup x.x.x.exe` |
| macOS | `KeePic-x.x.x.dmg` |

> **Windows** : lors de la première installation, Windows SmartScreen peut afficher un avertissement ("l'application est inconnue"). Cliquer sur *Informations complémentaires* puis *Exécuter quand même*.

> **macOS** : si macOS bloque l'ouverture du DMG, aller dans *Réglages Système → Confidentialité et sécurité* et cliquer sur *Ouvrir quand même*.

---

## Fonctionnalités

- **Import local** — depuis un dossier, une carte SD ou un appareil photo
- **Import Google Photos** — récupération automatique et incrémentale par date
- **Déduplication** — détection des photos en double par hash perceptuel (pHash) avec revue côté à côté
- **Organisation automatique** — photos classées par date de prise de vue dans des dossiers mensuels (`YYYY/YYYY.MM/`)
- **Multi-utilisateurs** — plusieurs personnes peuvent pointer l'app vers le même dossier partagé sans conflit
- **Non-destructif** — les fichiers source ne sont jamais modifiés ou supprimés

### Formats supportés

JPEG · HEIC/HEIF · PNG · TIFF · RAW (CR2, NEF, ARW)

Les Live Photos iPhone sont supportées : le fichier HEIC est importé, le clip MOV est ignoré par défaut. Une option de conversion HEIC → JPEG est disponible dans les réglages.

---

## Structure de la bibliothèque

L'app organise les photos dans un dossier de bibliothèque selon cette hiérarchie :

```
Bibliothèque/
├── 2025/
│   ├── 2025.01/                        ← dossier mensuel (créé par l'app)
│   ├── 2025.04.15-19.Londres/          ← dossier événement (créé manuellement)
│   └── 2025.05/
└── 2026/
    └── 2026.01/
```

Les dossiers événements (`YYYY.MM.DD[-[MM.]DD].NomEvenement`) sont créés et remplis manuellement par les utilisateurs.

---

## Configuration de Google Photos

KeePic utilise l'API officielle Google Photos via OAuth 2.0. Comme l'application est en mode *test* (non publiée sur le Google Workspace Marketplace), **chaque utilisateur doit être ajouté manuellement comme utilisateur de test** dans la console Google Cloud.

### Étapes

1. Demander à l'administrateur du projet d'ajouter votre adresse e-mail Google comme utilisateur de test :

   - Ouvrir la [Google Cloud Console](https://console.cloud.google.com/)
   - Sélectionner le projet KeePic
   - Aller dans **APIs & Services → Écran de consentement OAuth**
   - Section **Utilisateurs test** → cliquer sur **+ Add users**
   - Saisir votre adresse Gmail et enregistrer

2. Lancer KeePic, aller dans l'onglet **Google Photos** et cliquer sur **Connecter**.

3. Un navigateur s'ouvre avec la page d'autorisation Google. Vous verrez peut-être un avertissement *"Cette application n'est pas vérifiée"* — c'est normal pour une app en mode test. Cliquer sur *Paramètres avancés → Accéder à KeePic (non sécurisé)*.

4. Autoriser l'accès en lecture à vos photos. L'autorisation est enregistrée dans le trousseau de votre OS (Windows Credential Manager / Trousseau macOS) — vous n'aurez pas à vous reconnecter.

> **Confidentialité** : KeePic demande uniquement l'accès en lecture seule à vos photos (`photoslibrary.readonly`). Aucune photo n'est uploadée. Aucune donnée n'est envoyée à un serveur externe.

---

## Données locales

Toutes les données de l'app sont stockées localement, en dehors du dossier de bibliothèque partagé :

| OS | Emplacement |
|---|---|
| Windows | `%APPDATA%\KeePic\` |
| macOS | `~/Library/Application Support/KeePic/` |

Contenu : configuration (`config.json`), index local SQLite (`index.db`), fichiers temporaires d'import (`temp/`).

L'index peut être entièrement reconstruit à partir du dossier de bibliothèque via le bouton **Ré-indexer**.
