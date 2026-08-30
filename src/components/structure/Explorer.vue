<script setup lang="ts">
import { computed, ref, watch } from "vue";
import * as api from "../../lib/api";
import { ACTIONS, type ActionSpec } from "../../lib/actions";
import { KIND_FR } from "./kinds";
import Icon from "../ui/Icon.vue";

/**
 * The tree, as a file explorer, in the main content.
 *
 * It moved out of the sidebar for a reason: at 244px a seven-level tree is all
 * ellipsis, and the rail's job is navigation, not inspection. Here it has room
 * for the path, the code and the kind, and the panel beside it shows what the
 * selected node actually is.
 *
 * The whole tree arrives in ONE request and is filtered client-side; search
 * therefore costs nothing per keystroke, which is the difference between a box
 * people use and one they avoid on a metered connection. `GET /org-units/search`
 * exists for the same query server-side and is used when the tree is large
 * enough that shipping it all would be the wrong trade — not yet, at a few
 * hundred units.
 */
const props = defineProps<{
  units: api.TreeUnit[];
  selected: string | null;
  /**
   * Pick mode: only these kinds may be chosen, everything else is context.
   *
   * The same tree serves "navigate the structure" and "choose where this action
   * applies", because they are the same question and a second, flatter list
   * would answer it worse — "6e A" means nothing without the school above it.
   */
  pickKinds?: api.OrgUnitKind[];
}>();
const emit = defineEmits<{
  select: [api.TreeUnit];
  /** The row's ⋯ was used. The parent owns the dialogs — see OrgPane. */
  menu: [{ unit: api.TreeUnit; action: NodeAction }];
  /** A registry action was chosen on a row: it opens HERE, over the tree. */
  run: [{ unit: api.TreeUnit; spec: ActionSpec }];
}>();

/**
 * What a ⋯ offers, filtered per node.
 *
 * The set is deliberately small and all of it maps to an endpoint that exists:
 * add a child (POST), rename (PATCH), close or reopen (DELETE / POST), and open
 * the node's own page. Move is absent — reparenting needs a target picker and a
 * cycle check, and a half-built one on a context menu is how a tree gets
 * corrupted.
 */
export type NodeAction = "open" | "add" | "rename" | "close" | "reopen";

/**
 * The domain actions a node offers from the tree itself.
 *
 * Only the ones that are FORMS. An action with a screen of its own — the mark
 * grid, the bulletins — is a destination, and the row's own page is where those
 * belong; putting them in a context menu would just be a second way to
 * navigate. What is left is precisely the set that can be done without leaving
 * the tree, which is the point: choose "programmer une matière" on a niveau and
 * the form opens over it, already knowing which niveau.
 */
function specsFor(unit: api.TreeUnit): ActionSpec[] {
  return ACTIONS.filter(
    (a) => !a.planned && !a.route && a.scope?.includes(unit.kind),
  );
}

const picking = computed(() => (props.pickKinds?.length ?? 0) > 0);
const eligible = (u: api.TreeUnit) => !picking.value || props.pickKinds!.includes(u.kind);

const openMenu = ref<string | null>(null);

function menuFor(unit: api.TreeUnit): { id: NodeAction; label: string; danger?: boolean }[] {
  const items: { id: NodeAction; label: string; danger?: boolean }[] = [
    { id: "open", label: "Ouvrir" },
  ];
  // A classe is the last rung: nothing nests under it.
  if (unit.kind !== "CLASSE") items.push({ id: "add", label: "Ajouter un élément" });
  items.push({ id: "rename", label: "Renommer" });
  items.push(
    unit.validTo
      ? { id: "reopen", label: "Rouvrir" }
      : { id: "close", label: "Fermer", danger: true },
  );
  return items;
}

function choose(unit: api.TreeUnit, action: NodeAction) {
  openMenu.value = null;
  // "Ouvrir" is a selection like any other, so it clears a search the same way.
  if (action === "open") {
    pick(unit);
    return;
  }
  emit("menu", { unit, action });
}

function run(unit: api.TreeUnit, spec: ActionSpec) {
  openMenu.value = null;
  emit("run", { unit, spec });
}

const q = ref("");

/**
 * EXPANDED nodes, not collapsed ones.
 *
 * The set was inverted before, so an empty set meant "nothing is collapsed" —
 * i.e. the whole complex opened fully expanded, thirty-odd rows deep, and the
 * operator's first act was always to close things. Tracking what is OPEN makes
 * the default the useful one: the root and its schools, and nothing else until
 * asked.
 */
const expanded = ref<Set<string>>(new Set());
const seeded = ref(false);

const childrenOf = computed(() => {
  const map = new Map<string | null, api.TreeUnit[]>();
  for (const u of props.units) {
    const key = u.parentId;
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(u);
  }
  return map;
});

/** Ids that match the query, plus every ancestor — so a hit stays reachable. */
const visible = computed(() => {
  const needle = q.value.trim().toLowerCase();
  if (!needle) return null;

  const byId = new Map(props.units.map((u) => [u.id, u]));
  const keep = new Set<string>();
  for (const u of props.units) {
    if (
      u.name.toLowerCase().includes(needle) ||
      u.code.toLowerCase().includes(needle)
    ) {
      keep.add(u.id);
      let cursor = u.parentId;
      for (let i = 0; cursor && i < 12; i++) {
        keep.add(cursor);
        cursor = byId.get(cursor)?.parentId ?? null;
      }
    }
  }
  return keep;
});

/**
 * Flattened render list, honouring collapse and the search filter.
 *
 * `guides` carries, for each ancestor depth, whether that ancestor still has a
 * sibling below it. That is what lets the vertical rules stop at the last child
 * of a branch instead of running to the bottom of the panel — the difference
 * between a tree that reads and a grid of stripes.
 */
const rows = computed(() => {
  const out: {
    unit: api.TreeUnit;
    depth: number;
    hasChildren: boolean;
    guides: boolean[];
    isLast: boolean;
  }[] = [];

  const walk = (parentId: string | null, depth: number, guides: boolean[]) => {
    const siblings = (childrenOf.value.get(parentId) ?? []).filter(
      (u) => !visible.value || visible.value.has(u.id),
    );
    siblings.forEach((u, i) => {
      const kids = childrenOf.value.get(u.id) ?? [];
      const isLast = i === siblings.length - 1;
      out.push({ unit: u, depth, hasChildren: kids.length > 0, guides, isLast });
      // A search result is always expanded: hiding the hit behind a collapsed
      // parent would defeat searching for it.
      if (kids.length && (visible.value || expanded.value.has(u.id))) {
        walk(u.id, depth + 1, [...guides, !isLast]);
      }
    });
  };
  walk(null, 0, []);
  return out;
});

function toggle(id: string) {
  const next = new Set(expanded.value);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  expanded.value = next;
}

/**
 * Opens the root, and stops there.
 *
 * Two wrong answers were tried before this one. Seeding the root AND its
 * schools opened a complex to a dozen rows the operator then had to close;
 * seeding nothing showed a single line that answers no question at all. One
 * level is what a director actually needs on arrival — which schools exist —
 * and every level below that is a decision they came here to make.
 *
 * Pick mode is the exception, below — a pane that hides the thing it is asking
 * you to choose is asking you to go and find it.
 */
watch(
  () => props.units,
  (units) => {
    if (seeded.value || !units.length) return;
    // The roots themselves, so their children show. Nothing deeper.
    const next = new Set(units.filter((u) => u.parentId === null).map((u) => u.id));

    // Picking is different: reveal what can be chosen.
    if (picking.value) {
      const byId = new Map(units.map((u) => [u.id, u]));
      for (const u of units) {
        if (!eligible(u)) continue;
        let cursor = u.parentId;
        for (let i = 0; cursor && i < 12; i++) {
          next.add(cursor);
          cursor = byId.get(cursor)?.parentId ?? null;
        }
      }
    }

    expanded.value = next;
    seeded.value = true;
  },
  { immediate: true },
);

/**
 * Reveals the selection's ancestry, however it was arrived at.
 *
 * Watches the UNITS too, and runs immediately, because the common case is a
 * tree that mounts with a selection already set: enrolling from the rail lands
 * on the class's own page, and the pane is created there for the first time. A
 * watcher on the selection alone never fires for that — the value did not
 * change, it started that way — so the operator arrived somewhere the tree
 * claimed not to know about.
 */
watch(
  [() => props.selected, () => props.units],
  ([id]) => {
    if (!id) return;
    const byId = new Map(props.units.map((u) => [u.id, u]));
    const next = new Set(expanded.value);
    let cursor = byId.get(id)?.parentId ?? null;
    for (let i = 0; cursor && i < 12; i++) {
      next.add(cursor);
      cursor = byId.get(cursor)?.parentId ?? null;
    }
    expanded.value = next;
  },
  { immediate: true },
);

/**
 * Choosing a row — and, when it came out of a search, putting the tree back.
 *
 * A search result is shown by force-expanding every branch that contains a hit,
 * so the tree behind the query is not the tree the operator is looking at.
 * Clearing the box without doing anything else would drop them back into
 * whatever was open before they searched, with their result nowhere in sight —
 * they searched precisely because they could not find it by hand.
 *
 * So the query goes, the full tree comes back, and the expansion is REPLACED by
 * exactly the path down to what they picked: one open branch, ending on the
 * selection. Merging with what was open before would leave the noise they were
 * escaping.
 */
function pick(unit: api.TreeUnit) {
  if (q.value.trim()) {
    const byId = new Map(props.units.map((u) => [u.id, u]));
    const path = new Set<string>();
    let cursor = byId.get(unit.id)?.parentId ?? null;
    for (let i = 0; cursor && i < 16; i++) {
      path.add(cursor);
      cursor = byId.get(cursor)?.parentId ?? null;
    }
    expanded.value = path;
    q.value = "";
  }
  emit("select", unit);
}

const matches = computed(() => (visible.value ? rows.value.length : props.units.length));
</script>

<template>
  <div class="explorer">
    <div class="explorer-search">
      <Icon name="search" :size="15" />
      <input
        v-model="q"
        type="search"
        placeholder="Rechercher une unité…"
        aria-label="Rechercher une unité"
      />
    </div>

    <div class="explorer-tree">
      <div v-if="!units.length" class="tnode-hint">Aucune unité.</div>
      <div v-else-if="!rows.length" class="tnode-hint">Aucun résultat pour « {{ q }} ».</div>

      <div
        v-for="row in rows"
        :key="row.unit.id"
        class="ex-row"
        :class="{ 'is-selected': selected === row.unit.id }"
      >
        <!-- One rule per ancestor that still has a sibling below it, then the
             elbow into this row. Drawn as spans rather than a background image
             so the last child of a branch genuinely stops. -->
        <span
          v-for="(carry, i) in row.guides"
          :key="i"
          class="ex-guide"
          :class="{ 'is-blank': !carry }"
          aria-hidden="true"
        />
        <span v-if="row.depth > 0" class="ex-elbow" :class="{ 'is-last': row.isLast }" aria-hidden="true" />

        <button
          v-if="row.hasChildren"
          class="ex-twist"
          type="button"
          :aria-label="expanded.has(row.unit.id) ? 'Replier' : 'Déplier'"
          @click.stop="toggle(row.unit.id)"
        >
          <Icon :name="expanded.has(row.unit.id) ? 'chevronDown' : 'chevronRight'" :size="13" />
        </button>
        <span v-else class="ex-twist ex-twist-leaf" aria-hidden="true" />

        <button
          class="ex-label"
          :class="{ 'is-dim': !eligible(row.unit) }"
          type="button"
          :title="eligible(row.unit) ? KIND_FR[row.unit.kind] : `${KIND_FR[row.unit.kind]} — cette action ne s'y applique pas`"
          @click="eligible(row.unit) ? pick(row.unit) : toggle(row.unit.id)"
        >
          <!-- Codes are gone: they are for printed documents, and in a 280px
               panel they cost the width the names need. The kind stays as a
               tooltip. -->
          <span class="ex-name" :class="{ 'is-closed': row.unit.validTo }">{{ row.unit.name }}</span>
        </button>

        <button
          v-if="!picking"
          class="ex-menu"
          type="button"
          :aria-label="`Actions sur ${row.unit.name}`"
          :aria-expanded="openMenu === row.unit.id"
          @click.stop="openMenu = openMenu === row.unit.id ? null : row.unit.id"
        >
          <Icon name="dots" :size="14" />
        </button>

        <template v-if="openMenu === row.unit.id && !picking">
          <!-- Click-away: a menu that only its own button can close is a menu
               people leave open. -->
          <div class="ex-menu-scrim" @click.stop="openMenu = null" />
          <div class="ex-menu-pop" role="menu">
            <button
              v-for="item in menuFor(row.unit)"
              :key="item.id"
              class="ex-menu-item"
              :class="{ 'is-danger': item.danger }"
              type="button"
              role="menuitem"
              @click.stop="choose(row.unit, item.id)"
            >{{ item.label }}</button>

            <template v-if="specsFor(row.unit).length">
              <div class="ex-menu-sep" role="separator" />
              <button
                v-for="spec in specsFor(row.unit)"
                :key="spec.id"
                class="ex-menu-item"
                type="button"
                role="menuitem"
                :title="spec.summary"
                @click.stop="run(row.unit, spec)"
              >{{ spec.label }}</button>
            </template>
          </div>
        </template>
      </div>
    </div>

    <div class="explorer-foot">{{ matches }} unité(s)</div>
  </div>
</template>
