/**
 * Coverage recorder for the convergence loop.
 *
 * The default resolver calls {@link CoverageRecorder.record} for every field it handles
 * generically. After a run, {@link CoverageRecorder.report} emits a ranked markdown table;
 * rows whose `argNames` is non-empty are FLAGGED — those are fields whose arguments the
 * generic default ignored (the high-value gaps to write a real resolver for).
 */
import type { CoverageRecorder } from './types.ts';

/** One generic-resolution coordinate: a `(type, field)` and the union of arg names seen. */
interface CoverageRow {
    type: string;
    field: string;
    count: number;
    argNames: Set<string>;
}

/** Build a fresh coverage recorder. It aggregates across `execute()` calls for one server. */
export function createCoverageRecorder(): CoverageRecorder {
    const rows = new Map<string, CoverageRow>();

    const record = (type: string, field: string, argNames: string[]): void => {
        const key = `${type}.${field}`;
        let row = rows.get(key);
        if (!row) {
            row = { type, field, count: 0, argNames: new Set() };
            rows.set(key, row);
        }
        row.count++;
        for (const a of argNames) {
            row.argNames.add(a);
        }
    };

    const report = (): string => {
        // Rank: flagged (has ignored args) first, then by frequency, then by coordinate.
        const ordered = [...rows.values()].sort((a, b) => {
            const aFlagged = a.argNames.size > 0 ? 1 : 0;
            const bFlagged = b.argNames.size > 0 ? 1 : 0;
            if (aFlagged !== bFlagged) return bFlagged - aFlagged;
            if (a.count !== b.count) return b.count - a.count;
            return `${a.type}.${a.field}`.localeCompare(`${b.type}.${b.field}`);
        });

        const lines: string[] = [];
        lines.push('| flag | type | field | count | ignored args |');
        lines.push('| --- | --- | --- | --- | --- |');
        for (const r of ordered) {
            const flag = r.argNames.size > 0 ? '⚠️' : '';
            const args = [...r.argNames].sort().join(', ');
            lines.push(`| ${flag} | ${r.type} | ${r.field} | ${r.count} | ${args} |`);
        }
        return lines.join('\n');
    };

    return { record, report };
}
