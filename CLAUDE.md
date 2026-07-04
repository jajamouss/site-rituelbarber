# Règles du projet Rituel Barber

## Règle client : maquettes et pages partagées en lien (Artifacts)

Le client a signalé qu'il ne pouvait pas défiler sur les maquettes partagées
en lien. **Règle permanente, pour toute maquette ou page livrée en Artifact :**

1. **Garantir le défilement**, surtout tactile/mobile :
   - jamais de `overflow:hidden` ni de hauteur figée (`height:100vh`) sur
     `html`/`body` ;
   - inclure les garanties CSS :
     `html,body{height:auto!important;overflow-y:auto!important;touch-action:pan-y;-webkit-overflow-scrolling:touch}` ;
   - les effets `:hover` uniquement derrière `@media (hover:hover)` pour ne
     pas gêner le toucher.
2. **Tester le défilement avant livraison** avec Chromium en émulation mobile
   (geste tactile + molette, vérifier que `window.scrollY` bouge).
3. **Toujours joindre des captures d'écran** (SendUserFile) en plus du lien,
   pour que le client voie le contenu même si le lien pose problème chez lui.

## Contexte projet

- Site vitrine du salon à la racine (`index.html`) — ne pas le modifier sans demande.
- Application privée de gestion dans `gestion/` — voir `gestion/README.md`
  (design validé, architecture, API, déploiement Hostinger).
- Règle d'or de l'app : les comptes barbiers ne voient jamais montants ni
  totaux (appliqué côté serveur dans `gestion/api.php`).
- Couleurs : palette « Vert & Blanc » tirée des photos du salon — olive
  `#525E36`, crème `#F1EFE7`, or `#A8863B`, graphiques `#66802E`.
- Langue de travail avec le client : français.
