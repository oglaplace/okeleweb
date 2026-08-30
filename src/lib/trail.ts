import type { RouteLocationRaw } from "vue-router";
import { ACTIONS, GROUPS, ROUTE_NEEDS_UNIT, byId } from "./actions";

/**
 * ONE trail, derived from the route, for the whole console.
 *
 * There were two breadcrumbs before — a topbar one that knew the action but not
 * where in the tree it was pointed, and a second one inside the node page that
 * knew the tree but not which action had brought you there. Neither was
 * complete, and two trails disagreeing about where you are is worse than one
 * that is merely short.
 *
 * This is the whole path in one line: the action, then the structure from the
 * root down to the node it is aimed at. It is derived rather than pushed by
 * each screen, because a trail a page has to remember to set is a trail that is
 * wrong on the page that forgot.
 */
export interface Crumb {
    label: string;
    to?: RouteLocationRaw;
    /** Rendered as a house rather than a word — the shortest possible root. */
    home?: boolean;
}

/** Just enough of a route to build a trail; keeps this testable and pure. */
export interface TrailRoute {
    name?: string | symbol | null;
    params: Record<string, unknown>;
    query: Record<string, unknown>;
}

export interface TrailContext {
    /** Root-first, including the node itself. Synchronous — see stores/org. */
    ancestors(id: string | null | undefined): { id: string; name: string }[];
}

/** Routes where the unit being worked on is the route's own :id. */
const UNIT_PARAM = new Set(["unit", "classe", "marks", "bulletins"]);

/** The action segment: which group, and which action inside it. */
function actionCrumbs(route: TrailRoute): Crumb[] {
    const name = String(route.name ?? "");

    const spec =
        name === "action"
            ? byId(String(route.params.id ?? ""))
            : // A screen of its own still belongs to an action in the registry,
              // so its label comes from there and cannot drift from the rail.
              ACTIONS.find((a) => a.route === name);

    // A unit is reached THROUGH the structure, so it carries the same heading.
    const resolved = name === "unit" ? byId("explorer") : spec;
    if (!resolved) return [];

    const group = GROUPS.find((g) => g.id === resolved.group);
    const crumbs: Crumb[] = [];
    if (group) crumbs.push({ label: group.label });

    // A crumb pointing at a unit screen needs that unit, or resolving it throws
    // and takes the layout with it — see ROUTE_NEEDS_UNIT. Without one it stays
    // a plain label, which is what it is anyway.
    const unit = scopeOf(route);
    const to: RouteLocationRaw | undefined = !resolved.route
        ? { name: "action", params: { id: resolved.id } }
        : ROUTE_NEEDS_UNIT.has(resolved.route)
          ? unit
              ? { name: resolved.route, params: { id: unit } }
              : undefined
          : { name: resolved.route };

    crumbs.push({ label: resolved.label, ...(to ? { to } : {}) });
    return crumbs;
}

/** Which unit, if any, this route is aimed at. */
export function scopeOf(route: TrailRoute): string | null {
    const name = String(route.name ?? "");
    if (UNIT_PARAM.has(name)) return String(route.params.id ?? "") || null;
    const q = route.query.scope;
    return typeof q === "string" && q ? q : null;
}

export function trailFor(route: TrailRoute, ctx: TrailContext): Crumb[] {
    const name = String(route.name ?? "");
    const crumbs: Crumb[] = [{ label: "Tableau de bord", to: { name: "dashboard" }, home: true }];
    if (name === "dashboard") return crumbs;

    crumbs.push(...actionCrumbs(route));

    // …then the structure, root first, down to the node the action is aimed at.
    // Every level is a link: the trail is also how you move up.
    for (const unit of ctx.ancestors(scopeOf(route))) {
        crumbs.push({ label: unit.name, to: { name: "unit", params: { id: unit.id } } });
    }

    return crumbs;
}

/** What the back button says it is going back to. */
export function trailLabel(crumbs: Crumb[]): string {
    const last = crumbs[crumbs.length - 1];
    return last ? last.label : "Tableau de bord";
}
