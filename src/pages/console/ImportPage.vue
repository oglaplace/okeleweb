<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import * as api from "../../lib/api";
import { parseCsv } from "../../lib/csv";
import { useBusyStore } from "../../stores/busy";

/**
 * A term's worth of people, from a spreadsheet.
 *
 * Two steps, always, and the first one writes nothing. The file is parsed here,
 * sent for a DRY RUN, and the server answers with the column mapping it derived
 * and the rows it could not read. Only then is there a button that commits.
 *
 * That order is the whole design. A file whose "Prénom" column was read as an
 * address is obvious when you can see the mapping and invisible when you
 * cannot — and by then it is four hundred pupils. The import is also all-or-
 * nothing: a partial import of 400 rows is not a smaller success, it is a file
 * somebody has to diff by hand against a class list.
 */
const busy = useBusyStore();

const mode = ref<"students" | "staff">("students");
const fileName = ref<string | null>(null);
const headings = ref<string[]>([]);
const rows = ref<Record<string, string>[]>([]);
const report = ref<api.ImportReport | null>(null);
const error = ref<string | null>(null);
const notice = ref<string | null>(null);
const working = ref(false);

const classes = ref<{ id: string; label: string }[]>([]);
const years = ref<api.AcademicYear[]>([]);
const classeId = ref("");
const academicYearId = ref("");

onMounted(async () => {
  try {
    const y = await api.academics.years();
    years.value = y;
    academicYearId.value = y.find((x) => x.isCurrent)?.id ?? y[0]?.id ?? "";

    const found: { id: string; label: string }[] = [];
    const queue: { id: string | null; path: string[] }[] = [{ id: null, path: [] }];
    for (let guard = 0; guard < 400 && queue.length; guard++) {
      const next = queue.shift()!;
      for (const c of await api.orgUnits.children(next.id)) {
        if (c.kind === "CLASSE") {
          found.push({ id: c.id, label: [...next.path, c.name].join(" / ") });
        } else {
          queue.push({ id: c.id, path: [...next.path, c.name] });
        }
      }
    }
    classes.value = found;
  } catch {
    // The picker is empty; the empty state below explains it.
  }
});

async function onFile(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0];
  if (!file) return;
  report.value = null;
  notice.value = null;
  error.value = null;
  fileName.value = file.name;
  try {
    const parsed = parseCsv(await file.text());
    headings.value = parsed.headings;
    rows.value = parsed.rows;
    if (!parsed.rows.length) error.value = "Le fichier ne contient aucune ligne.";
  } catch {
    error.value = "Fichier illisible. Enregistrez-le au format CSV depuis Excel.";
  }
}

const canCheck = computed(
  () =>
    rows.value.length > 0 &&
    !working.value &&
    (mode.value === "staff" || (classeId.value !== "" && academicYearId.value !== "")),
);

async function run(dryRun: boolean) {
  if (!canCheck.value) return;
  working.value = true;
  error.value = null;
  try {
    const result = await busy.run(
      () =>
        mode.value === "students"
          ? api.people.importStudents({
              academicYearId: academicYearId.value,
              classeId: classeId.value,
              rows: rows.value,
              dryRun,
            })
          : api.people.importStaff({ rows: rows.value, dryRun }),
      dryRun
        ? undefined
        : {
            title: "Import en cours",
            detail: `${rows.value.length} ligne(s). Ne fermez pas cette page.`,
          },
    );
    report.value = result;
    if (!dryRun && result.imported > 0) {
      notice.value = `${result.imported} ligne(s) importée(s).`;
      rows.value = [];
      headings.value = [];
      fileName.value = null;
    }
  } catch (e) {
    error.value = e instanceof api.ApiError ? e.message : "Import impossible.";
  } finally {
    working.value = false;
  }
}

/** Only fields the file actually supplied — a table of nulls teaches nothing. */
const mappedFields = computed(() =>
  Object.entries(report.value?.mapping ?? {}).filter(([, column]) => column !== null),
);
const unmappedFields = computed(() =>
  Object.entries(report.value?.mapping ?? {})
    .filter(([, column]) => column === null)
    .map(([field]) => field),
);
const clean = computed(() => report.value !== null && report.value.problems.length === 0);
</script>

<template>
  <div>
    <div class="page-head">
      <div>
        <h1 class="page-title">Importer</h1>
        <div class="page-sub">
          Depuis Excel : « Enregistrer sous » → CSV. Le fichier est vérifié avant
          d'être enregistré, et rien n'est écrit tant qu'une ligne pose problème.
        </div>
      </div>
    </div>

    <div v-if="notice" class="form-ok">{{ notice }}</div>
    <div v-if="error" class="form-error">{{ error }}</div>

    <div class="card">
      <div class="card-body">
        <fieldset class="fieldset">
          <legend>Quoi</legend>
          <div class="choices">
            <label class="choice" :class="{ 'is-selected': mode === 'students' }">
              <input v-model="mode" type="radio" value="students" />
              <span class="choice-name">Élèves</span>
              <span class="choice-note">Nom, Prénom, Sexe, Date de naissance, Classe…</span>
            </label>
            <label class="choice" :class="{ 'is-selected': mode === 'staff' }">
              <input v-model="mode" type="radio" value="staff" />
              <span class="choice-name">Personnel</span>
              <span class="choice-note">Nom, Prénom, Fonction, Contrat, Salaire…</span>
            </label>
          </div>
        </fieldset>

        <fieldset v-if="mode === 'students'" class="fieldset">
          <legend>Destination</legend>
          <div v-if="!classes.length" class="hint">
            Aucune classe. Créez-en une avant d'importer des élèves.
          </div>
          <div v-else class="field-row">
            <div class="field">
              <label for="i-cl">Classe par défaut</label>
              <select id="i-cl" v-model="classeId">
                <option value="">—</option>
                <option v-for="c in classes" :key="c.id" :value="c.id">{{ c.label }}</option>
              </select>
              <span class="hint">
                Utilisée pour les lignes sans colonne « Classe ».
              </span>
            </div>
            <div class="field">
              <label for="i-yr">Année scolaire</label>
              <select id="i-yr" v-model="academicYearId">
                <option v-for="y in years" :key="y.id" :value="y.id">{{ y.label }}</option>
              </select>
            </div>
          </div>
        </fieldset>

        <fieldset class="fieldset" style="margin-bottom: 0">
          <legend>Fichier</legend>
          <input type="file" accept=".csv,text/csv,text/plain" @change="onFile" />
          <div v-if="fileName" class="hint" style="margin-top: 6px">
            {{ fileName }} — {{ rows.length }} ligne(s), {{ headings.length }} colonne(s).
          </div>
        </fieldset>
      </div>

      <div class="card-foot">
        <span class="hint" style="margin-right: auto">
          La vérification n'écrit rien.
        </span>
        <button class="btn" type="button" :disabled="!canCheck" @click="run(true)">
          <span v-if="working" class="btn-spin" aria-hidden="true" />
          Vérifier
        </button>
        <button
          class="btn primary"
          type="button"
          :disabled="!canCheck || !clean"
          :title="clean ? undefined : 'Vérifiez le fichier d’abord'"
          @click="run(false)"
        >
          Importer {{ rows.length ? `${rows.length} ligne(s)` : "" }}
        </button>
      </div>
    </div>

    <!-- The mapping, before anything is written. -->
    <div v-if="report" class="card" style="margin-top: var(--s4)">
      <div class="card-head">
        Vérification
        <span v-if="clean" class="pill ok">{{ report.ready }} ligne(s) prêtes</span>
        <span v-else class="pill danger">{{ report.problems.length }} problème(s)</span>
      </div>
      <div class="card-body">
        <div class="legend" style="margin-top: 0">
          <div v-for="[field, column] in mappedFields" :key="field" class="legend-item">
            <dt>{{ field }}</dt>
            <dd>← {{ column }}</dd>
          </div>
        </div>
        <p v-if="unmappedFields.length" class="hint" style="margin: 0">
          Colonnes absentes du fichier, ignorées : {{ unmappedFields.join(", ") }}.
        </p>
      </div>

      <div v-if="report.problems.length" class="table-wrap">
        <table class="data">
          <thead><tr><th class="c-text">Ligne</th><th class="c-name">Problème</th></tr></thead>
          <tbody>
            <tr v-for="p in report.problems" :key="p.line">
              <td class="c-text">{{ p.line }}</td>
              <td class="c-name">{{ p.message }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>
</template>
