import { defineStore } from "pinia";
import * as api from "../lib/api";

/**
 * The organisation tree, loaded once and shared.
 *
 * It used to be fetched independently by the pane, the scope picker, the
 * enrolment form, the import screen and the staff screen — five copies of the
 * same complex, five chances to be out of date with each other, and five
 * requests on a metered connection for a document that changes a few times a
 * year.
 *
 * Holding it here also makes the breadcrumb possible: a trail that has to await
 * `GET /:id/ancestors` renders empty on first paint and jumps a moment later,
 * which is worse than no trail. `ancestors()` here is a synchronous walk over
 * data the console already has.
 */
export const useOrgStore = defineStore("org", {
    state: () => ({
        units: [] as api.TreeUnit[],
        loaded: false,
        loading: false,
    }),

    getters: {
        /** id → unit, rebuilt only when the tree changes. */
        index: (s) => new Map(s.units.map((u) => [u.id, u])),
        roots: (s) => s.units.filter((u) => u.parentId === null),
    },

    actions: {
        async load(force = false) {
            if (this.loading) return;
            if (this.loaded && !force) return;
            this.loading = true;
            try {
                this.units = await api.orgUnits.tree();
                this.loaded = true;
            } catch {
                // Left as-is rather than emptied: a failed refresh must not
                // wipe a tree the operator is currently navigating.
                if (!this.loaded) this.units = [];
            } finally {
                this.loading = false;
            }
        },

        byId(id: string | null | undefined): api.TreeUnit | null {
            return id ? (this.index.get(id) ?? null) : null;
        },

        /** Root-first and INCLUDING the node itself, like the API's endpoint. */
        ancestors(id: string | null | undefined): api.TreeUnit[] {
            const out: api.TreeUnit[] = [];
            let cursor = this.byId(id);
            // Bounded: a cycle in the tree would otherwise hang the breadcrumb.
            for (let i = 0; cursor && i < 16; i++) {
                out.unshift(cursor);
                cursor = this.byId(cursor.parentId);
            }
            return out;
        },

        /** "Collège / 6e" — what disambiguates two classes both called "A". */
        pathOf(id: string | null | undefined): string {
            return this.ancestors(id).slice(0, -1).map((u) => u.name).join(" / ");
        },

        children(id: string | null): api.TreeUnit[] {
            return this.units.filter((u) => u.parentId === id);
        },

        ofKind(kinds: api.OrgUnitKind[]): api.TreeUnit[] {
            return this.units.filter((u) => kinds.includes(u.kind));
        },
    },
});
