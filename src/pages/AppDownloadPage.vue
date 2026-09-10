<script setup lang="ts">
/**
 * UN LIEN À ENVOYER — l'APK de Nzela-Nzela, hors de la console.
 *
 * TEMPORAIRE, et le dire est la moitié de la page. Nzela-Nzela n'a rien à voir
 * avec TeYa : c'est l'application Android de collecte terrain de Brazzaville,
 * hébergée ici le temps de la faire installer sur quelques téléphones. Rien ne
 * pointe vers cette page depuis le reste du site — on y arrive par le lien, et
 * elle disparaîtra avec la release qui porte le fichier.
 *
 * LE FICHIER N'EST PAS SERVI PAR CE SITE. Cloudflare Pages refuse tout asset
 * au-dessus de 25 Mio et l'APK en pèse 59 : le binaire vit dans une release
 * GitHub du dépôt public, qui sert des fichiers de plusieurs centaines de Mo
 * sans alourdir l'historique du dépôt — et qui se supprime en un clic quand
 * l'installation est faite.
 */

/** L'asset de la release. Changer le tag ici suffit à publier un autre build. */
const APK =
  "https://github.com/oglaplace/okeleweb/releases/download/nzela-apk/nzela-nzela-0.1.0-debug.apk";

const FACTS = [
  { label: "Version", value: "0.1.0 (build de debug)" },
  { label: "Taille", value: "59,4 Mio" },
  { label: "Android", value: "8.0 ou plus récent" },
  { label: "Compilé le", value: "25 août 2026" },
];
</script>

<template>
  <div class="verify">
    <article class="verify-card">
      <div class="verify-badge">Installation directe</div>
      <h1 class="verify-title">Nzela-Nzela — application Android</h1>
      <p class="verify-sub">
        Collecte terrain de Brazzaville : courses effectuées, courses refusées et
        points de repère, hors ligne. Ce fichier s'installe à la main, il n'est
        pas encore sur le Play Store.
      </p>

      <p>
        <a class="btn primary" :href="APK" rel="noopener">Télécharger l'APK (59,4 Mio)</a>
      </p>

      <dl class="verify-id">
        <div v-for="f in FACTS" :key="f.label">
          <dt>{{ f.label }}</dt>
          <dd>{{ f.value }}</dd>
        </div>
      </dl>

      <div class="verify-note">
        <strong>Installation.</strong> Ouvrez le fichier téléchargé depuis la
        barre de notifications. Android demandera d'autoriser l'installation
        depuis cette source : <em>Paramètres → Autoriser depuis cette source</em>,
        puis revenez en arrière et confirmez. C'est une seule fois, par
        navigateur.
      </div>

      <!-- `.hint` n'existe que dans un `.field` : cette note prend le style des
           sous-titres de la page, sinon elle s'affiche en corps de texte. -->
      <p class="verify-sub" style="margin: var(--s4) 0 0">
        Build de debug, non signé pour la distribution : à installer sur les
        téléphones de test, pas à diffuser. Le lien est temporaire.
      </p>
    </article>
  </div>
</template>
