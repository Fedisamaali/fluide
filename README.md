# Fluide

Simulation de fluides en temps réel (équations de Navier–Stokes) qui tourne entièrement sur le GPU, dans le navigateur, avec WebGL2. Aucune dépendance.

## Lancer avec Docker (Mac, Linux, Windows)

Prérequis : [Docker Desktop](https://www.docker.com/products/docker-desktop/) lancé. Fonctionne sur les Mac Intel comme Apple Silicon (M1 à M4).

```bash
git clone <url-du-depot>
cd fluide
docker compose up -d --build
```

Puis ouvrir **http://localhost:8080** dans Chrome, Edge, Firefox ou Safari.

Pour arrêter : `docker compose down`.

Si le port 8080 est déjà pris, changer `"8080:80"` dans `docker-compose.yml` (par exemple `"3000:80"`, puis ouvrir http://localhost:3000).

## Lancer sans Docker

Ouvrir simplement `index.html` dans le navigateur (double-clic).

## Commandes

| Action | Commande |
| --- | --- |
| Remuer le fluide | glisser à la souris ou au doigt (multi-touch) |
| Explosion | `Espace` |
| Écrire un mot dans le fluide | `T` |
| Changer de palette | `1` à `6` |
| Réglages | `R` ou le bouton en haut à droite |
| Pause / effacer / capture PNG | `P` / `C` / `S` |
| Plein écran / masquer l'interface | `F` / `H` |

Le panneau de réglages permet aussi d'activer le **micro** : le fluide réagit alors à la musique.

L'adresse accepte des paramètres, par exemple `http://localhost:8080/?texte=Salut&palette=lave` (palettes : `aurore`, `neon`, `lave`, `ocean`, `or`, `spectre`).
