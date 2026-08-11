# ⚽ Xapi Cup

> Site web de gestion de tournois de football pour le **club d'Hasparren**.
> HTML/CSS/JS pur, zéro build, zéro framework, déployable en 30 secondes.

[![Made for Hasparren](https://img.shields.io/badge/Hasparren-FC-0f5132)](.) [![No framework](https://img.shields.io/badge/stack-vanilla%20JS-yellow)](.) [![License](https://img.shields.io/badge/license-MIT-blue)](.)

---

## ✨ Fonctionnalités

### 👀 Page publique (`viewer.html`)
- **Suivi en direct** des poules, classements, scores et arbres à élimination directe
- **Mise à jour automatique** dès qu'un score change côté admin (même onglet ou autre onglet sur la même machine)
- **Export visuel** des arbres (couleurs d'équipes, vainqueurs mis en avant)
- **Bandeau "phase"** indiquant où en est le tournoi
- **Responsive** : adapté mobile, tablette, TV

### 🛠️ Espace administrateur (`admin.html`)
- **Inscription des équipes** : une par une ou en masse (collage de liste)
- **Tirage automatique des poules** : équilibrées, mélange aléatoire
- **Saisie des scores** en temps réel, classements calculés à la volée
- **Règles sportives correctes** : V=3pts, N=1pt, D=0pt ; départage goal-average puis confrontation directe
- **Configuration de la qualification** : 1, 2 ou 3 équipes par poule
- **Consolante activable** : les non-qualifiés jouent aussi un arbre
- **Génération des arbres Or + Consolante** : byes automatiques, seeding classique
- **Modification manuelle** des scores et vainqueurs
- **Export PNG/JPG** des arbres (via html2canvas)
- **Sauvegarde / restauration** complète du tournoi (JSON)

### 🔄 Synchronisation
- **Entre onglets** : `BroadcastChannel` + `storage` event → instantané
- **Entre machines** : mini-serveur WebSocket inclus (`server/sync-server.js`), 100 lignes de Node 22 natif, zéro dépendance

---

## 🚀 Démarrage rapide

### Méthode 1 : Python (le plus simple)
```bash
cd xapi-cup
python3 -m http.server 8000
# Ouvrir http://localhost:8000
```
> ⚠ Avec cette méthode, la synchro marche **entre onglets** mais **pas entre machines**.

### Méthode 2 : Node avec synchro multi-machines (le jour du tournoi)
```bash
cd xapi-cup
node server/sync-server.js
# Le serveur affiche les IPs réseau (ex: http://192.168.1.42:8765/)
# Ouvrir cette IP sur n'importe quelle machine du réseau
```
> ✅ Avec cette méthode, l'écran TV, le PC admin, le smartphone du secrétaire, etc. sont **tous synchronisés en temps réel**.

### Méthode 3 : Tout autre serveur statique
Le projet est 100% statique (HTML/CSS/JS) → déployable sur **GitHub Pages**, **Netlify**, **Vercel**, **OVH**, n'importe quel hébergeur.

---

## 📖 Guide d'utilisation (admin)

### Étape 1 — Équipes
- Va sur `admin.html`
- Saisis les noms d'équipes un par un (Entrée pour valider), ou colle une liste en masse
- Chaque équipe a une **couleur attribuée automatiquement** (parmi 18 nuances de la palette)

### Étape 2 — Poules
- Section 2 : choisis le nombre de poules (selon le nombre d'équipes)
- Clique sur 🎲 **Générer les poules**
- Les poules sont équilibrées (écart max de 1 équipe)
- Saisis les scores au fur et à mesure → le classement se met à jour tout seul
- Tu peux re-générer autant de fois que tu veux (ça écrase)

### Étape 3 — Qualification
- Section 3 : choisis combien d'équipes par poule se qualifient
- Active/désactive la consolante
- Tu vois en temps réel qui est qualifié (étoiles ⭐ dans le classement)
- Quand tu es satisfait, clique sur 🚀 **Lancer les arbres**

### Étape 4 — Phase finale
- Section 4 : onglet **Tableau Or** ou **Consolante**
- **Clique sur un match** pour ouvrir la modale de score
- Saisis les deux scores, valide → le vainqueur passe automatiquement au tour suivant
- En cas d'égalité, on te demande qui se qualifie

### Étape 5 — Export & sauvegarde
- Section 5 : **exporte l'arbre** en PNG ou JPG (qualité haute, 2x par défaut)
- **Télécharge une sauvegarde JSON** à la fin de chaque journée de tournoi
- Pour **restaurer** une sauvegarde, sélectionne le fichier `.json` et c'est ré-importé

---

## 🗂️ Structure du projet

```
xapi-cup/
├── index.html              # Page d'accueil
├── viewer.html             # Page publique (lecture seule, live)
├── admin.html              # Espace administrateur
├── css/
│   └── style.css           # Charte graphique (palette basque modifiable)
├── js/
│   ├── app.js              # Helpers DOM (el, $, toast, etc.)
│   ├── state.js            # Source de vérité + persistence + sync
│   ├── tournament.js       # Algorithmes (poules, classement, brackets)
│   ├── render.js           # Génération DOM (poules, arbres)
│   ├── export.js           # Export PNG/JPG (html2canvas)
│   ├── admin.js            # Logique page admin
│   └── viewer.js           # Logique page publique
├── server/
│   └── sync-server.js      # Mini-serveur WebSocket (Node 22 natif, 0 dep)
├── assets/                 # Logos, images (à compléter)
├── .gitignore
├── package.json            # Pour npm run start
└── README.md
```

---

## 🎨 Personnalisation

### Couleurs du club
Toutes les couleurs sont dans des variables CSS en haut de `css/style.css` :
```css
:root {
  --color-primary:   #0f5132;  /* vert basque → remplacer par couleur maillot */
  --color-accent:    #c1272d;  /* rouge basque → idem */
  --color-gold:      #d4a017;  /* or (trophée) */
  --color-bg:        #f7f5f0;  /* fond */
}
```

### Logo
Dépose ton logo dans `assets/logo.png` et remplace le `<span class="logo-mark">⚽</span>` par :
```html
<img src="assets/logo.png" alt="Xapi Cup" class="logo-img" />
```

---

## 🧪 Tests manuels suggérés

1. **8 équipes, 2 poules de 4, 2 qualifiés par poule** → bracket Or à 4, bracket Consolante à 4
2. **12 équipes, 4 poules de 3, 2 qualifiés** → Or à 8, Consolante à 4
3. **7 équipes** (cas tordus) → 1 bye automatique
4. **Égalité parfaite en poule** → vérifier le départage par goal-average puis confrontation directe
5. **Export PNG puis JPG** → vérifier la qualité sur les deux formats

---

## 📜 Licence

MIT — Utilisable librement par le club d'Hasparren et au-delà.

Made with ❤️ par les supporters du club, pour les supporters du club.
