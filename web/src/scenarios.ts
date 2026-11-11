// Saved scenario sets (plan.md's "later — saved scenario sets"): named model
// variants kept in localStorage and grouped into sets — the spreadsheet-tabs
// notion of scenario (aggressive / cautious / …) without leaving the REPL.
//
// A scenario is the shareable session minus playhead and branches: model code
// plus the raw horizon/MC control values. Branches stay a share-URL notion —
// inside a set, what-ifs are separate scenarios, not forks stacked on a trunk.
// Storage is injected as a StorageLike so the module tests need no DOM.

import { validatePayload, type SharePayload } from "./share.js";

export const SCENARIOS_KEY = "kairotron.scenarios.v1";

export type ScenarioPayload = Pick<SharePayload, "code" | "horizon" | "mc">;

export interface Scenario {
  name: string;
  payload: ScenarioPayload;
}

export interface ScenarioSet {
  name: string;
  scenarios: Scenario[];
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

// Selection into the flat (set, scenario) list, as carried by <option> values.
export function parseRef(ref: string): [number, number] {
  const m = /^(\d+):(\d+)$/.exec(ref);
  return m ? [Number(m[1]), Number(m[2])] : [-1, -1];
}

// Lenient load: an unreadable/absent/corrupt entry degrades to an empty list
// rather than taking the REPL down; inside a well-formed list, malformed sets
// and scenarios are dropped one by one (payloads revalidated through the
// share codec's rules, with playhead/branches stripped).
export function loadSets(store: StorageLike | undefined): ScenarioSet[] {
  if (!store) return [];
  let raw: string | null;
  try {
    raw = store.getItem(SCENARIOS_KEY);
  } catch {
    return [];
  }
  if (raw === null) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return parsed.flatMap((e): ScenarioSet[] => {
    if (!e || typeof e !== "object") return [];
    const { name, scenarios } = e as Record<string, unknown>;
    if (typeof name !== "string" || name.trim() === "" || !Array.isArray(scenarios)) return [];
    const kept = scenarios.flatMap((s): Scenario[] => {
      if (!s || typeof s !== "object") return [];
      const { name: scen, payload } = s as Record<string, unknown>;
      if (typeof scen !== "string" || scen.trim() === "" || !payload || typeof payload !== "object") return [];
      try {
        const { playhead, branches, ...base } = validatePayload(payload);
        return [{ name: scen, payload: base }];
      } catch {
        return [];
      }
    });
    return kept.length ? [{ name, scenarios: kept }] : [];
  });
}

// Quota/security errors throw — the caller turns them into a status line.
export function writeSets(store: StorageLike | undefined, sets: ScenarioSet[]): void {
  if (!store) throw new Error("local storage is unavailable");
  store.setItem(SCENARIOS_KEY, JSON.stringify(sets));
}

// Upsert by (set name, scenario name): a same-named scenario in a same-named
// set is replaced in place; otherwise the set is found/created and appended to.
// Returns the next state plus the ref the new entry lands on.
export function upsertScenario(
  sets: ScenarioSet[],
  setName: string,
  name: string,
  payload: ScenarioPayload,
): { sets: ScenarioSet[]; ref: string } {
  const si = sets.findIndex((s) => s.name === setName);
  if (si === -1) {
    return {
      sets: [...sets, { name: setName, scenarios: [{ name, payload }] }],
      ref: `${sets.length}:0`,
    };
  }
  const set = sets[si]!;
  const ci = set.scenarios.findIndex((x) => x.name === name);
  const scenarios =
    ci === -1
      ? [...set.scenarios, { name, payload }]
      : set.scenarios.map((x, i) => (i === ci ? { ...x, payload } : x));
  return {
    sets: sets.map((s, i) => (i === si ? { ...s, scenarios } : s)),
    ref: `${si}:${ci === -1 ? set.scenarios.length : ci}`,
  };
}

// Removing a set's last scenario removes the set (an empty group is noise).
export function removeScenario(
  sets: ScenarioSet[],
  ref: string,
): { sets: ScenarioSet[]; removed?: string } {
  const [si, ci] = parseRef(ref);
  const set = sets[si];
  const scen = set?.scenarios[ci];
  if (!set || !scen) return { sets };
  const scenarios = set.scenarios.filter((_, i) => i !== ci);
  const next = scenarios.length
    ? sets.map((s, i) => (i === si ? { ...s, scenarios } : s))
    : sets.filter((_, i) => i !== si);
  return { sets: next, removed: `${set.name} · ${scen.name}` };
}
