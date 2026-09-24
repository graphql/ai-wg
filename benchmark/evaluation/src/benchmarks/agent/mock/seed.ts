/**
 * Deterministic value generation for the mock server.
 *
 * DETERMINISM IS MANDATORY: no wall-clock, no RNG. Every value is a pure function of a
 * canonical string key via {@link stableHash}. Dates derive from {@link REFERENCE_INSTANT}
 * offset by seed arithmetic on the ISO string. Same key ⇒ same value, always.
 */

/** Fixed clock anchor. All generated dates are offsets from this instant — never `Date.now()`. */
export const REFERENCE_INSTANT = '2025-06-01T00:00:00Z';

/** Reference instant as epoch milliseconds, computed once from the constant string (NOT the clock). */
const REFERENCE_MS = Date.parse(REFERENCE_INSTANT);

/** FNV-1a 32-bit hash of a string → a non-negative int. Deterministic and dependency-free. */
export function stableHash(key: string): number {
    let h = 0x811c9dc5;
    for (let i = 0; i < key.length; i++) {
        h ^= key.charCodeAt(i);
        // h *= 16777619, kept in 32-bit range via Math.imul.
        h = Math.imul(h, 0x01000193);
    }
    // Coerce to an unsigned 32-bit int.
    return h >>> 0;
}

/** A canonical seed for an entity field, derived from its owning entity seed + coordinate. */
export function fieldSeed(type: string, field: string, entitySeed: number): number {
    return stableHash(`${type}.${field}#${entitySeed}`);
}

/** Deterministic Int in [0, 1000) for a field coordinate. */
export function seedInt(type: string, field: string, entitySeed: number): number {
    return fieldSeed(type, field, entitySeed) % 1000;
}

/** Deterministic Float in [0, 1000) with two decimals. */
export function seedFloat(type: string, field: string, entitySeed: number): number {
    const h = fieldSeed(type, field, entitySeed);
    return Math.round((h % 100000) / 100) / 10;
}

/** Deterministic Boolean for a field coordinate. */
export function seedBoolean(type: string, field: string, entitySeed: number): boolean {
    return (fieldSeed(type, field, entitySeed) & 1) === 1;
}

/** Deterministic short String value for a field coordinate. */
export function seedString(type: string, field: string, entitySeed: number): string {
    return `${type}.${field}-${fieldSeed(type, field, entitySeed) % 10000}`;
}

/** Deterministic stable id string for a child of a parent under a relation. */
export function seedId(parentId: string, relation: string, index: number): string {
    return `${parentId}/${relation}/${index}`;
}

/** Deterministic ISO-8601 date string, offset from REFERENCE_INSTANT by a seeded number of days. */
export function seedDate(type: string, field: string, entitySeed: number): string {
    const h = fieldSeed(type, field, entitySeed);
    // Spread across roughly a year before the reference instant.
    const offsetDays = h % 365;
    const ms = REFERENCE_MS - offsetDays * 24 * 60 * 60 * 1000;
    return new Date(ms).toISOString();
}

/** Pick a deterministic member of a non-empty list for a field coordinate. */
export function seedPick<T>(
    type: string,
    field: string,
    entitySeed: number,
    choices: ReadonlyArray<T>,
): T {
    const idx = fieldSeed(type, field, entitySeed) % choices.length;
    // choices is non-empty by contract; the modulo keeps the index in range.
    return choices[idx]!;
}
