<script setup lang="ts">
import { computed, ref } from "vue";
import { RouterLink, type RouteLocationRaw } from "vue-router";
import * as api from "../../lib/api";
import { ACTIONS, GROUPS, type ActionSpec } from "../../lib/actions";
import { KIND_FR } from "../structure/kinds";
import { useOrgStore } from "../../stores/org";
import Icon from "../ui/Icon.vue";

/**
 * Everything doable on one node, as a menu bar above it.
 *
 * It replaces a card of forty tiles that pushed the actual contents of the node
 * below the fold. A toolbar is the right shape for this: the operator came here
 * to look at a class and occasionally to act on it, not to read a catalogue.
 *
 * INHERITED ACTIONS are the interesting part. A course offering belongs to the
 * NIVEAU and a period to the SCHOOL — that is the data model and it is correct,
 * because every 6e class shares one programme. But an operator standing on 6e B
 * who wants to add a subject does not care where the row lives, and sending
 * them off to find 6e in the tree is the kind of errand that makes people give
 * up on software.
 *
 * So the bar also offers the actions of the nearest ancestor that accepts them,
 * and names that ancestor on the item and again in the dialog. Contextual, and
 * still honest about what is being changed — the alternative, quietly writing
 * to the niveau while the screen says "6e B", would be a lie.
 */
const props = defineProps<{ unit: api.OrgUnit }>();
const emit = defineEmits<{
  run: [{ spec: ActionSpec; target: api.OrgUnit | api.TreeUnit }];
  structure: [action: "add" | "rename" | "close" | "reopen"];
}>();

const org = useOrgStore();
const open = ref<string | null>(null);

/** A classe is the last rung of the tree; nothing nests under it. */
const canHoldChildren = computed(() => props.unit.kind !== "CLASSE");

interface Item {
  spec: ActionSpec;
  target: api.OrgUnit | api.TreeUnit;
  /** True when the action belongs to an ancestor rather than to this node. */
  inherited: boolean;
  to: RouteLocationRaw | null;
  blocked: string | null;
}

/** Where a route-bearing action goes, carrying the node with it. */
function routeFor(spec: ActionSpec, targetId: string): RouteLocationRaw | null {
  if (!spec.route) return null;
  // These screens ARE about one unit, so it is their :id.
  if (spec.route === "classe" || spec.route === "marks" || spec.route === "bulletins") {
    return { name: spec.route, params: { id: targetId } };
  }
  // The rest take it as the scope they pre-select, so the picker they own
  // opens already answered.
  return { name: spec.route, query: { scope: targetId } };
}

const items = computed<Item[]>(() => {
  const out: Item[] = [];
  const chain = org.ancestors(props.unit.id); // root-first, includes self
  const ancestorsNearestFirst = [...chain.slice(0, -1)].reverse();

  for (const spec of ACTIONS) {
    // The explorer IS the tree beside this bar; offering it here is a link to
    // where you already are.
    if (spec.id === "explorer") continue;
    if (!spec.scope?.length) continue; // complex-wide: belongs in the rail

    const direct = spec.scope.includes(props.unit.kind);
    const target = direct
      ? props.unit
      : ancestorsNearestFirst.find((a) => spec.scope!.includes(a.kind));
    if (!target) continue;

    out.push({
      spec,
      target,
      inherited: !direct,
      to: routeFor(spec, target.id),
      blocked: spec.planned ?? null,
    });
  }
  return out;
});

const groups = computed(() =>
  GROUPS.map((g) => ({ ...g, items: items.value.filter((i) => i.spec.group === g.id) })).filter(
    (g) => g.items.length > 0,
  ),
);

function toggle(id: string) {
  open.value = open.value === id ? null : id;
}

function choose(item: Item) {
  open.value = null;
  if (item.blocked) return;
  if (!item.to) emit("run", { spec: item.spec, target: item.target });
}

function structure(action: "add" | "rename" | "close" | "reopen") {
  open.value = null;
  emit("structure", action);
}
</script>

<template>
  <div class="actionbar">
    <!-- Adding a child, in place. This used to be a link to the Structure
         screen, which threw away the node you were standing on and asked you
         to find it again in a tree. -->
    <button
      v-if="canHoldChildren"
      class="actionbar-btn is-primary"
      type="button"
      title="Créer un élément à l'intérieur de cette unité"
      @click="structure('add')"
    >
      <Icon name="plus" :size="15" />
      <span>Ajouter un élément</span>
    </button>

    <div v-for="g in groups" :key="g.id" class="actionbar-menu">
      <button
        class="actionbar-btn"
        type="button"
        :aria-expanded="open === g.id"
        @click="toggle(g.id)"
      >
        <Icon :name="g.icon" :size="15" />
        <span>{{ g.label }}</span>
        <Icon name="chevronDown" :size="12" class="actionbar-twist" />
      </button>

      <template v-if="open === g.id">
        <div class="actionbar-scrim" @click="open = null" />
        <div class="actionbar-pop" role="menu">
          <component
            :is="item.to && !item.blocked ? RouterLink : 'button'"
            v-for="item in g.items"
            :key="item.spec.id"
            class="actionbar-item"
            :class="{ 'is-blocked': item.blocked }"
            role="menuitem"
            :to="item.to && !item.blocked ? item.to : undefined"
            :type="item.to && !item.blocked ? undefined : 'button'"
            :title="item.blocked ?? item.spec.summary"
            @click="choose(item)"
          >
            <Icon :name="item.spec.icon" :size="15" />
            <span class="actionbar-item-text">
              <span>{{ item.spec.label }}</span>
              <!-- Named, always: an action that writes to the niveau must not
                   look like one that writes to the class. -->
              <span v-if="item.inherited" class="actionbar-on">
                sur {{ KIND_FR[item.target.kind].toLowerCase() }} « {{ item.target.name }} »
              </span>
              <span v-else-if="item.blocked" class="actionbar-on">{{ item.blocked }}</span>
            </span>
          </component>
        </div>
      </template>
    </div>

    <!-- The node itself, kept apart from what it contains. -->
    <div class="actionbar-menu actionbar-end">
      <button
        class="actionbar-btn is-icon"
        type="button"
        aria-label="Gérer cette unité"
        :aria-expanded="open === '_self'"
        @click="toggle('_self')"
      >
        <Icon name="dots" :size="15" />
      </button>

      <template v-if="open === '_self'">
        <div class="actionbar-scrim" @click="open = null" />
        <div class="actionbar-pop is-right" role="menu">
          <button class="actionbar-item" type="button" role="menuitem" @click="structure('rename')">
            <Icon name="settings" :size="15" /><span>Renommer</span>
          </button>
          <button
            v-if="unit.validTo"
            class="actionbar-item"
            type="button"
            role="menuitem"
            @click="structure('reopen')"
          >
            <Icon name="check" :size="15" /><span>Rouvrir</span>
          </button>
          <button
            v-else
            class="actionbar-item is-danger"
            type="button"
            role="menuitem"
            @click="structure('close')"
          >
            <Icon name="lock" :size="15" /><span>Fermer</span>
          </button>
        </div>
      </template>
    </div>
  </div>
</template>
