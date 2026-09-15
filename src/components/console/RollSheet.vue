<script setup lang="ts">
import { computed, ref, watch } from "vue";
import * as api from "../../lib/api";

/**
 * LA FEUILLE D'APPEL — P, A, et le cumul fait le reste.
 *
 * The register was readable and unwritable: absences were aggregated onto
 * bulletins and class sheets, and nothing anywhere created one. Absence hours
 * therefore printed as zero on every bulletin unless somebody had seeded them
 * by hand.
 *
 * P ou A, une lettre par élève, parce que c'est ce qu'un enseignant écrit dans
 * une colonne — pas une durée, pas un motif, pas un formulaire. L'ACCUMULATION
 * EST LA DÉFINITION : `absenceHours` on a bulletin is nothing but the sum of the
 * A's, each converted through its own lesson's length, which is why an A carries
 * minutes the teacher never has to type.
 *
 * R (retard) et E (excusé) sont là parce que les deux existent et comptent
 * différemment : un retard est un retard, pas une heure d'absence, et une école
 * qui compte cinq minutes comme une heure cesse d'être crue.
 *
 * Tout le monde est présent par défaut — c'est l'état d'une classe, et pointer
 * trente P pour marquer deux A est le genre de friction qui fait ressortir le
 * cahier papier.
 */
const props = defineProps<{
  roll: api.SessionRoll | api.DayRoll;
  /** False for anyone consulting somebody else's register. */
  editable?: boolean;
  saving?: boolean;
}>();
const emit = defineEmits<{
  save: [entries: { studentId: string; state: api.RollState }[]];
}>();

/** The four letters, in the order a teacher reads them. */
const STATES: { key: api.RollState; letter: string; label: string; cls: string }[] = [
  { key: "PRESENT", letter: "P", label: "Présent", cls: "is-p" },
  { key: "ABSENT", letter: "A", label: "Absent", cls: "is-a" },
  { key: "LATE", letter: "R", label: "Retard", cls: "is-r" },
  { key: "EXCUSED", letter: "E", label: "Excusé", cls: "is-e" },
];

/** Everyone present until said otherwise — the state of a class. */
const marks = ref<Record<string, api.RollState>>({});

watch(
  () => props.roll,
  (roll) => {
    const next: Record<string, api.RollState> = {};
    for (const e of roll.entries) next[e.studentId] = e.state ?? "PRESENT";
    marks.value = next;
  },
  { immediate: true, deep: false },
);

function set(studentId: string, state: api.RollState) {
  if (!props.editable) return;
  marks.value = { ...marks.value, [studentId]: state };
}

/** The count that makes the letters mean something, live. */
const tally = computed(() => {
  const out = { PRESENT: 0, ABSENT: 0, LATE: 0, EXCUSED: 0 } as Record<api.RollState, number>;
  for (const e of props.roll.entries) out[marks.value[e.studentId] ?? "PRESENT"]++;
  return out;
});

/** Nothing called yet, so "tout le monde présent" is an assumption not a record. */
const untouched = computed(() => props.roll.entries.every((e) => e.state === null));

const dirty = computed(() =>
  untouched.value ||
  props.roll.entries.some((e) => (e.state ?? "PRESENT") !== marks.value[e.studentId]),
);

function save() {
  emit(
    "save",
    props.roll.entries.map((e) => ({
      studentId: e.studentId,
      state: marks.value[e.studentId] ?? "PRESENT",
    })),
  );
}

/** Marks everybody at once — the two cases a teacher actually has. */
function all(state: api.RollState) {
  if (!props.editable) return;
  const next: Record<string, api.RollState> = {};
  for (const e of props.roll.entries) next[e.studentId] = state;
  marks.value = next;
}
</script>

<template>
  <div>
    <div class="roll-head">
      <div class="roll-tally">
        <span v-for="s in STATES" :key="s.key" class="roll-count" :class="s.cls">
          <strong>{{ tally[s.key] }}</strong> {{ s.label.toLowerCase() }}
        </span>
      </div>
      <div v-if="editable" class="row-actions">
        <button class="btn sm ghost" type="button" @click="all('PRESENT')">
          Tout présent
        </button>
        <button class="btn primary" type="button" :disabled="!dirty || saving" @click="save">
          Enregistrer l'appel
        </button>
      </div>
    </div>

    <p v-if="untouched" class="hint" style="margin: 0 0 var(--s3)">
      Appel non fait — tout le monde est marqué présent tant que rien n'est
      enregistré.
    </p>

    <div class="table-wrap">
      <table class="data">
        <thead>
          <tr>
            <th class="c-name">Élève</th>
            <th class="c-text">Matricule</th>
            <th class="c-text">Appel</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="e in roll.entries" :key="e.studentId">
            <td class="c-name">
              <span class="cell-strong">{{ e.lastName.toUpperCase() }} {{ e.firstName }}</span>
              <span v-if="e.reason" class="cell-sub">{{ e.reason }}</span>
            </td>
            <td class="c-text">{{ e.matricule }}</td>
            <td class="c-text">
              <!-- Quatre lettres, pas un menu déroulant. Un enseignant fait
                   l'appel debout devant trente élèves. -->
              <div class="roll-pick" role="group" :aria-label="`Appel — ${e.lastName}`">
                <button
                  v-for="s in STATES"
                  :key="s.key"
                  type="button"
                  class="roll-btn"
                  :class="[s.cls, { 'is-on': marks[e.studentId] === s.key }]"
                  :disabled="!editable"
                  :title="s.label"
                  :aria-pressed="marks[e.studentId] === s.key"
                  @click="set(e.studentId, s.key)"
                >
                  {{ s.letter }}
                </button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<style scoped>
.roll-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: var(--s3);
  margin-bottom: var(--s3);
}
.roll-tally {
  display: flex;
  gap: var(--s4);
  font-size: var(--t-small);
  color: var(--ink-3);
}
.roll-count strong {
  font-variant-numeric: tabular-nums;
  color: var(--ink);
}
.roll-count.is-a strong {
  color: var(--danger);
}
.roll-count.is-r strong {
  color: var(--warn);
}

.roll-pick {
  display: inline-flex;
  gap: 2px;
}
/* Square, equal, and big enough to hit standing up. */
.roll-btn {
  width: 30px;
  height: 30px;
  padding: 0;
  border: 1px solid var(--line);
  border-radius: var(--radius-sm);
  background: var(--surface);
  color: var(--ink-3);
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  cursor: pointer;
}
.roll-btn:hover:not(:disabled) {
  border-color: var(--line-strong);
  color: var(--ink);
}
.roll-btn:disabled {
  cursor: default;
  opacity: 0.5;
}
.roll-btn.is-on {
  color: var(--primary-ink);
  border-color: transparent;
}
.roll-btn.is-p.is-on {
  background: var(--ok);
}
.roll-btn.is-a.is-on {
  background: var(--danger);
}
.roll-btn.is-r.is-on {
  background: var(--warn);
}
.roll-btn.is-e.is-on {
  background: var(--ink-3);
}
.roll-btn:focus-visible {
  outline: none;
  box-shadow: var(--ring);
}
</style>
