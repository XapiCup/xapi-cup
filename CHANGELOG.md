# Changelog Xapi Cup

## v2.0.0 (Août 2026) — Refonte majeure

### ✨ Nouveautés

#### 🏆 Multi-tournois
- Nouvelle entité "Tournoi" : tu peux maintenant gérer **plusieurs tournois en parallèle**
- Sélecteur en haut de l'admin (dropdown vert) : change de tournoi en un clic
- Actions : nouveau, dupliquer, renommer, archiver, supprimer
- Modal "Tous les tournois" pour voir l'état de tous tes tournois d'un coup
- Archivage : cache un tournoi terminé sans le supprimer
- **Migration automatique** : ton ancien tournoi devient "Tournoi 1"

#### 🐛 Fix critique : "À déterminer" sur les arbres
- Le bug venait de `buildBracket()` qui ne construisait que le 1er tour, et la propagation se faisait mal
- Réécriture complète : tous les rounds sont construits d'un coup, avec les vainqueurs propagés à chaque score
- Maintenant, après avoir cliqué "Lancer les arbres", **tous les slots du 1er tour sont remplis** avec les équipes seedées
- Le bug "impossible d'entrer un score" est aussi résolu (la modale s'ouvre correctement)

#### 📅 Planning de matchs (nouvelle section 5 admin)
- Configuration complète : nombre de terrains, durée d'un match, pause entre matchs, pause déjeuner
- **Mono-jour ou multi-jours** : si tu dépasses la journée, étale sur 2, 3 jours
- Génération automatique qui équilibre les matchs sur tous les terrains
- **Détection de conflits** : alerte si une même équipe doit jouer sur 2 terrains en même temps
- Export en image (PNG) pour affichage sur place
- **Planning public** sur la page viewer (les supporters voient quand leur équipe joue)

#### 📜 Historique (nouvelle section 6 admin)
- Chaque événement important est logué : équipe ajoutée, tirage des poules, score enregistré, planning généré…
- Vue chronologique inverse, garde les 500 derniers événements
- **Feed live** sur la page publique : un panneau à droite "🔴 EN DIRECT" qui défile en temps réel
- Animation discrète sur les nouveaux items

### 🔧 Améliorations techniques
- Refactor complet de `state.js` (v2) avec système de migration v1→v2
- 19 tests e2e (le bug bracket est désormais couvert)
- CSS étendu pour les nouveaux composants (tournament bar, live feed, history, schedule)
- Viewer enrichi : titre dynamique, planning public, feed live

---

## v1.1.0 (Août 2026) — Authentification & QR codes

### ✨ Nouveautés
- **Authentification 2FA** sur l'admin : mot de passe (hashé SHA-256) + code à 6 chiffres
- Mot de passe initial `xapi-cup-2026` — à changer via le bandeau admin
- Lien `mailto:cupxapi@gmail.com` pour transmettre le code manuellement
- **QR codes** du site : PNG + SVG, palette basque, correction d'erreur niveau H
- Section QR code sur la page d'accueil avec téléchargement direct
- Script de régénération : `node scripts/generate-qr.mjs`
- Liens "Admin" retirés de la nav publique (sécurité)

### 🔧 Améliorations
- 7 tests e2e pour l'authentification
- Authentification : 8h de session, expiration automatique, bouton déconnexion

---

## v1.0.0 (Août 2026) — Version initiale

### ✨ Fonctionnalités
- Page d'accueil avec présentation du tournoi
- Page publique (viewer) avec poules, classements, arbres, live
- Page admin complète (équipes, poules, scores, qualification, arbres)
- Tirage automatique des poules (équilibré, aléatoire)
- Génération automatique des arbres Or + Consolante (avec byes)
- Saisie des scores en temps réel
- Règles foot complètes (V=3pts, N=1pt, D=0pt) + départage
- Export PNG/JPG des arbres finaux
- Sauvegarde / restauration JSON
- Sync temps réel entre onglets (BroadcastChannel)
- Mini-serveur WebSocket inclus (Node 22 natif, 0 dep)

### 🎨 Charte
- Palette basque : vert profond, rouge, or, blanc cassé
- Typographies : Oswald (titres) + Inter (corps)
- Responsive : mobile, tablette, TV
