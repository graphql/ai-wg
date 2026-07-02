/**
 * Deterministic structured-answer grading — the agent benchmark's success gate.
 *
 * Every gradable question carries a STRUCTURED answer contract in its YAML: `answerSchema`
 * (the JSON Schema for the `answer` tool the model fills in) plus `answer` — the literal
 * expected value — and optional `answers` (additional acceptable literal values). The
 * session forces the model to call `answer` with an object matching `answerSchema`, then
 * grades the submitted value against `answer`/`answers` with the tolerant matcher below.
 *
 * The gold `operation` is NEVER involved: there is no derivation, no LLM judge. If the mock
 * returns wrong data, fix the mock; if more than one answer is correct, add `answers`.
 *
 * Pure: no I/O, no side effects on import.
 */
import type { QueryDef } from '../../core/types.ts';

/** An expected value that carries no gradable signal — undefined, null, or an empty
 *  object (the gold op selected nothing the mock could fill, e.g. an unanswerable
 *  question). Such a query cannot be graded deterministically and must be carved out. */
export function isEmptyExpected(expected: unknown): boolean {
    return (
        expected === undefined ||
        expected === null ||
        (typeof expected === 'object' &&
            !Array.isArray(expected) &&
            Object.keys(expected as object).length === 0)
    );
}

/** The assembled grading contract for one query. */
export interface AcceptedAnswers {
    /** The PRIMARY expected value (literal `answer`) — recorded/displayed as canonical. */
    expectedAnswer: unknown;
    /** ALL acceptable expected values: the literal `answer` plus any literal `answers`.
     *  Success = the submitted answer tolerantly matches ANY of these. */
    acceptedAnswers: unknown[];
    /** False iff there is no gradable literal answer (no `answer`/`answers`, or every
     *  candidate is empty). The runner warns when this is false; grading still runs. */
    gradable: boolean;
}

/**
 * Assemble the SET of acceptable expected values for a query from its literal
 * `answer` (+ optional `answers` alternatives). The gold `operation` is NEVER
 * consulted: the agent is measured purely on whether the data it reports matches the
 * question's stated answer. (If the mock returns wrong data, fix the mock; if more
 * than one answer is correct, add it to `answers`.)
 *
 * This is the grading-relevant home for accepted-answers assembly, hashed via
 * answer.ts in `validatorSourceHash` — which is why the runner can leave the hash.
 */
export function assembleAcceptedAnswers(query: QueryDef): AcceptedAnswers {
    const expectedAnswer: unknown = query.answer; // the PRIMARY value (recorded/displayed)
    const acceptedAnswers: unknown[] = [];
    if (query.answer !== undefined) acceptedAnswers.push(query.answer);
    for (const alt of query.answers ?? []) acceptedAnswers.push(alt);
    const gradable =
        acceptedAnswers.length > 0 && !acceptedAnswers.every((a) => isEmptyExpected(a));
    return { expectedAnswer, acceptedAnswers, gradable };
}

/** Order-independent structural equality: object keys are sorted and arrays are sorted by
 *  their JSON encoding, so the agent's answer matches the gold value regardless of the
 *  order it listed nodes/fields in. */
function norm(v: unknown): unknown {
    if (Array.isArray(v))
        return v.map(norm).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
    if (v && typeof v === 'object') {
        const o: Record<string, unknown> = {};
        for (const k of Object.keys(v as object).sort()) o[k] = norm((v as any)[k]);
        return o;
    }
    return v;
}

export const deepEqual = (a: unknown, b: unknown): boolean =>
    JSON.stringify(norm(a)) === JSON.stringify(norm(b));

// ─────────────────────────────────────────────────────────────────────────────
// Tolerant answer matching — the success gate.
//
// The mock seeds every scalar off the EXACT query path + args, and most questions
// are answerable by MANY valid GraphQL shapes (field synonyms, pagination depth,
// nesting, edges-vs-nodes). Exact deep-equal punished all of those even when the
// retrieved DATA was right. `answerMatches` grades on CONTENT, not shape:
//
//   • Objects are shape-insensitive: an object collapses to a "record" = the multiset
//     of scalar leaves reachable WITHOUT crossing a list, PLUS its list-typed
//     descendants ("slots"). Key names, nesting depth, object wrappers and EXTRA
//     fields therefore don't matter — only that every expected leaf is present.
//   • Lists are pagination-tolerant: two lists match when the SMALLER injects into the
//     larger (bipartite matching), so over- and under-fetch both pass.
//   • Acceptance is over a SET of expected values (the literal `answer` plus any literal
//     `answers` alternatives), so a question with more than one correct answer passes.
//
// It is strictly MORE permissive than the old order-independent deep-equal: an
// exactly-equal answer still matches, so no previously-passing row can regress.
// ─────────────────────────────────────────────────────────────────────────────

type Scalar = string | number | boolean | null;
type Canon =
    | { t: 'scalar'; v: Scalar }
    | { t: 'list'; items: Canon[] }
    | { t: 'rec'; leaves: Scalar[]; slots: Canon[] };

/** Canonicalize a JSON answer value (see the matcher contract above). */
function canon(v: unknown): Canon {
    if (v === null || v === undefined) return { t: 'scalar', v: null };
    if (Array.isArray(v)) return { t: 'list', items: v.map(canon) };
    if (typeof v === 'object') {
        const leaves: Scalar[] = [];
        const slots: Canon[] = [];
        for (const child of Object.values(v as Record<string, unknown>))
            mergeInto(canon(child), leaves, slots);
        return { t: 'rec', leaves, slots };
    }
    return { t: 'scalar', v: v as Scalar };
}

/** Fold a child canon into a parent record: nested records merge their leaves/slots up
 *  (so object wrappers vanish), lists become slots, scalars become leaves. */
function mergeInto(c: Canon, leaves: Scalar[], slots: Canon[]): void {
    // Drop `null` leaves: a gold field that is null carries no gradable signal, and a
    // correct answer may simply omit it. (A genuinely-required value is never null.)
    if (c.t === 'scalar') {
        if (c.v !== null) leaves.push(c.v);
    } else if (c.t === 'list') slots.push(c);
    else {
        leaves.push(...c.leaves);
        slots.push(...c.slots);
    }
}

/** Collapse a degenerate record that is just an object wrapper around a single list
 *  (no scalar leaves, one slot) to that list — so `{orders:[…]}` and a bare `[…]` match. */
function simplify(c: Canon): Canon {
    if (c.t === 'rec' && c.leaves.length === 0 && c.slots.length === 1)
        return simplify(c.slots[0]!);
    return c;
}

/** ISO-8601 date or date-time (optional time, optional fractional seconds, optional zone). */
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:?\d{2})?)?$/;

/** A stable multiset key for a scalar leaf (typed so number 5 ≠ string "5"). Date/date-time
 *  strings are canonicalized to a single instant so equivalent serializations of the SAME
 *  moment compare equal (`2024-06-18`, `…T00:00:00Z`, `…T00:00:00.000Z`). Without this, a
 *  correct answer that merely formats a timestamp differently than the gold would fail. */
function leafKey(v: Scalar): string {
    if (v === null) return 'null';
    if (typeof v === 'string' && ISO_DATE_RE.test(v)) {
        const d = new Date(v);
        if (!Number.isNaN(d.getTime())) return `date:${d.toISOString()}`;
    }
    return `${typeof v}:${String(v)}`;
}

/** Multiset containment: every element of `sub` appears in `sup` with ≥ its multiplicity. */
function multisetSubset(sub: Scalar[], sup: Scalar[]): boolean {
    const counts = new Map<string, number>();
    for (const v of sup) counts.set(leafKey(v), (counts.get(leafKey(v)) ?? 0) + 1);
    for (const v of sub) {
        const k = leafKey(v);
        const n = counts.get(k) ?? 0;
        if (n === 0) return false;
        counts.set(k, n - 1);
    }
    return true;
}

/** Kuhn's bipartite matching: true iff every element of `left` can be matched to a
 *  DISTINCT element of `right` under `ok` (i.e. `left` injects into `right`). */
function injects<L, R>(left: L[], right: R[], ok: (l: L, r: R) => boolean): boolean {
    if (left.length > right.length) return false;
    const matchOf: number[] = new Array(right.length).fill(-1);
    const augment = (li: number, seen: boolean[]): boolean => {
        for (let rj = 0; rj < right.length; rj++) {
            if (seen[rj] || !ok(left[li]!, right[rj]!)) continue;
            seen[rj] = true;
            if (matchOf[rj] === -1 || augment(matchOf[rj]!, seen)) {
                matchOf[rj] = li;
                return true;
            }
        }
        return false;
    };
    for (let li = 0; li < left.length; li++) {
        if (!augment(li, new Array(right.length).fill(false))) return false;
    }
    return true;
}

/** Does `actual` satisfy `expected`? Records: expected leaves ⊆ actual leaves and every
 *  expected slot injects into a distinct actual slot. Lists: the smaller injects into the
 *  larger (pagination-tolerant). Scalars: equal. */
function matchCanon(expected: Canon, actual: Canon): boolean {
    let exp = expected;
    let act = actual;
    // Reconcile ONLY a bare list against an object that merely wraps that list
    // (e.g. gold `{orders:[…]}` vs agent `[…]`). Never simplify when both sides are
    // records: a record's EXTRA fields are allowed (multisetSubset), so collapsing a
    // single-field record to a list would spuriously mismatch an extra-field record.
    if (exp.t === 'rec' && act.t === 'list') exp = simplify(exp);
    else if (act.t === 'rec' && exp.t === 'list') act = simplify(act);
    if (exp.t === 'scalar') return act.t === 'scalar' && leafKey(exp.v) === leafKey(act.v);
    if (exp.t === 'list') {
        if (act.t !== 'list') return false;
        // Pagination tolerance: the SMALLER list must inject into the larger, so a
        // different page size (fewer OR more rows) passes. BUT an empty actual is never
        // "fewer rows" — it is "no answer", and must NOT satisfy a non-empty expected
        // (else a lazy/timed-out agent returning `[]` passes nearly every row).
        if (exp.items.length > 0 && act.items.length === 0) return false;
        // An EMPTY expected list means "the answer is no items" — it must match ONLY an
        // empty (or absent) actual list, never a populated one. Without this an empty gold
        // answer matches anything, silently passing every row (score inflation).
        if (exp.items.length === 0) return act.items.length === 0;
        return act.items.length >= exp.items.length
            ? injects(exp.items, act.items, matchCanon)
            : injects(act.items, exp.items, (a, e) => matchCanon(e, a));
    }
    // exp.t === 'rec'
    if (act.t !== 'rec') return false;
    if (!multisetSubset(exp.leaves, act.leaves)) return false;
    return injects(exp.slots, act.slots, matchCanon);
}

/** Grade a submitted answer against one expected value (content-equal, shape/pagination
 *  tolerant). Used by the session over the SET of acceptable expected values. */
export function answerMatches(expected: unknown, actual: unknown): boolean {
    return matchCanon(canon(expected), canon(actual));
}
