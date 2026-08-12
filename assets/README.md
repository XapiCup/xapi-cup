# QR codes du site

Ces QR codes permettent d'accéder rapidement aux différentes pages du site, notamment lors du tournoi (impression sur affiches, flyers, brassards, écran TV…).

## 📁 Fichiers

| Fichier | URL cible | Couleur | Usage |
|---|---|---|---|
| `qr-home.svg` / `qr-home.png` | `https://xapicup.github.io/xapi-cup/` | 🟢 vert basque | **À imprimer** sur affiches, tracts, maillots |
| `qr-viewer.svg` / `qr-viewer.png` | `https://xapicup.github.io/xapi-cup/viewer.html` | 🟢 vert basque | Page publique pour les supporters |
| `qr-admin.svg` / `qr-admin.png` | `https://xapicup.github.io/xapi-cup/admin.html` | 🔴 rouge basque | ⚠️ Réservé à l'équipe d'organisation — à ne PAS diffuser publiquement |

## 🎨 Caractéristiques

- **Format** : PNG 600x600 (impression propre jusqu'à 10cm sans perte) + SVG vectoriel (impression illimitée, idéal pour print pro)
- **Correction d'erreur** : niveau H (30%) — résiste aux logos, salissures, pliures
- **Marge** : 2 modules (espace blanc autour) — respecte la spec ISO
- **Couleurs** : palette du club (vert basque / rouge basque)

## 🖨️ Conseils d'impression

- **Affiche A4** : utilise le SVG, agrandis-le sans perte
- **Tract A5** : le PNG est parfait
- **Fond sombre** : inverse les couleurs (le SVG est facile à éditer)
- **Vérifie** la lisibilité en flashant avec ton téléphone avant d'imprimer 200 tracts 😅

## 🔄 Régénération

Si l'URL du site change, relance :

```bash
npm install
node scripts/generate-qr.mjs
```

Le script lit les URL en haut de `scripts/generate-qr.mjs` — modifie-les si besoin.
