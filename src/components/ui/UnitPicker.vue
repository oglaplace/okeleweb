<script setup lang="ts">
import { computed, nextTick, ref } from "vue";
import Icon from "./Icon.vue";
import SearchField from "./SearchField.vue";

/**
 * CHOISIR UNE AFFECTATION DANS UN COMPLEXE RÉEL.
 *
 * C'était un `<select>`. Un complexe de Brazzaville qui tient une maternelle,
 * une primaire, un collège et un lycée porte deux cents unités, et le menu
 * déroulant natif les rend toutes, dans l'ordre de l'arbre, sans rien pour
 * chercher — donc on descend à la molette en lisant « Complexe / Collège /
 * Premier cycle / Sixième / 6e A · Classe » quarante fois de suite.
 *
 * Ce qu'on cherche, on le SAIT: « 6e A », « compta », « CM2 ». Une boîte de
 * recherche sur le chemin complet répond en deux frappes, et le chemin complet
 * est ce qui distingue la 6e A du collège de la 6e A du lycée technique.
 *
 * Une fois choisie, l'affectation se lit comme une phrase et non comme une
 * ligne de menu: le nom en clair, et un bouton pour revenir sur son choix.
 * Rien de tout cela n'est un composant de bibliothèque — c'est un champ, une
 * liste et un filtre.
 */
export interface PickableUnit {
  id: string;
  /** Le chemin complet, tel qu'il s'affiche. */
  label: string;
  /** Ce sur quoi on cherche: chemin + genres, déjà en minuscules. */
  path: string;
}

const model = defineModel<string>({ required: true });

const props = withDefaults(
  defineProps<{
    units: PickableUnit[];
    /** Ce que « aucune » veut dire ici, ou null pour rendre le choix obligatoire. */
    emptyLabel?: string | null;
    placeholder?: string;
    id?: string;
  }>(),
  { emptyLabel: null, placeholder: "Chercher une école, un niveau, une classe…", id: undefined },
);

const query = ref("");
const box = ref<HTMLElement | null>(null);

const chosen = computed(
  () => props.units.find((u) => u.id === model.value) ?? null,
);

/**
 * Plafonné à quarante.
 *
 * Une liste sans fin invite à faire défiler plutôt qu'à préciser sa recherche,
 * et une recherche précisée trouve en deux frappes ce que le défilement trouve
 * en vingt secondes. Le compte total reste affiché, donc on sait qu'on n'a pas
 * tout sous les yeux.
 */
const matches = computed(() => {
  const q = query.value.trim().toLowerCase();
  const hits = q
    ? props.units.filter((u) => q.split(/\s+/).every((word) => u.path.includes(word)))
    : props.units;
  return { rows: hits.slice(0, 40), total: hits.length };
});

function choose(id: string) {
  model.value = id;
  query.value = "";
}

async function reopen() {
  model.value = "";
  await nextTick();
  box.value?.querySelector("input")?.focus();
}
</script>

<template>
  <div class="unitpick">
    <!-- Choisie: une phrase, pas une ligne de menu. -->
    <div v-if="chosen" class="unitpick-chosen">
      <Icon name="folder" :size="14" aria-hidden="true" />
      <span class="unitpick-label">{{ chosen.label }}</span>
      <button class="btn sm ghost" type="button" @click="reopen">Changer</button>
    </div>

    <div v-else ref="box" class="unitpick-open">
      <SearchField
        :id="props.id"
        v-model="query"
        :placeholder="props.placeholder"
        label="Chercher une unité"
        :hint="query.trim() ? `${matches.total}` : ''"
      />

      <ul class="unitpick-list">
        <!-- « Aucune » est un choix, quand c'en est un: on embauche souvent
             avant de savoir où la personne sera postée. -->
        <li v-if="emptyLabel !== null && !query.trim()">
          <button class="unitpick-row is-none" type="button" @click="choose('')">
            {{ emptyLabel }}
          </button>
        </li>
        <li v-for="u in matches.rows" :key="u.id">
          <button class="unitpick-row" type="button" @click="choose(u.id)">
            {{ u.label }}
          </button>
        </li>
        <li v-if="!matches.rows.length" class="unitpick-none">
          Aucune unité ne correspond à « {{ query.trim() }} ».
        </li>
      </ul>
    </div>
  </div>
</template>
