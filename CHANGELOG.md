# Changelog Xapi Cup

## v1.0.0 (Août 2026) — Version initiale

### ✨ Fonctionnalités
- Page d'accueil avec présentation du tournoi
- Page publique (viewer) avec poules, classements, arbres Or/Consolante, mise à jour live
- Page admin avec gestion complète (équipes, poules, scores, qualification, arbres)
- Tirage automatique des poules (équilibré, aléatoire)
- Génération automatique des arbres à élimination directe (avec byes)
- Modification manuelle des scores et vainqueurs
- Export PNG/JPG des arbres finaux
- Sauvegarde / restauration JSON du tournoi complet
- Synchronisation temps réel entre onglets (BroadcastChannel + storage event)
- Mini-serveur WebSocket inclus pour synchro multi-machines (zéro dépendance)

### 🎨 Charte graphique
- Palette basque : vert profond, rouge, or, blanc cassé
- Typographies : Oswald (titres) + Inter (corps)
- Responsive : mobile, tablette, TV

### 🧪 Tests
- Algorithmes testés sur 7, 8, 10, 12 et 16 équipes
- Cas limites couverts : nombre non-puissance de 2 (byes), égalités, confrontation directe
