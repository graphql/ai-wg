import fs from 'node:fs';
import path from 'node:path';
import yaml from 'yaml';
import {
    buildSchema,
    parse,
    validate,
    TypeInfo,
    visit,
    visitWithTypeInfo,
    getNamedType,
    isObjectType,
    isInterfaceType,
    isUnionType,
} from 'graphql';

const YAML_DIR = '/workspaces/embedder/evaluation/src/queries/all-schemas';
const SCHEMA_PATHS = {
    github: '/workspaces/embedder/evaluation/src/schemas/github/schema.graphql',
    gitlab: '/workspaces/embedder/evaluation/src/schemas/gitlab/schema.graphql',
    linear: '/workspaces/embedder/evaluation/src/schemas/linear/schema.graphql',
    shopify: '/workspaces/embedder/evaluation/src/schemas/shopify/schema.graphql',
    singapore: '/workspaces/embedder/evaluation/src/schemas/singapore/schema.graphql',
};

// Previously broken 12 - we'll look at the user's claim
const PREVIOUSLY_BROKEN_12 = []; // We don't have an explicit list passed; we'll record candidate identifiers if needed.

console.error('Loading schemas...');
const schemas = {};
for (const [id, p] of Object.entries(SCHEMA_PATHS)) {
    const sdl = fs.readFileSync(p, 'utf8');
    schemas[id] = buildSchema(sdl, { assumeValid: false });
    console.error(`  - ${id} loaded`);
}

function schemaHasCoordinate(schema, coord) {
    // coord format: "ParentType.fieldName"
    const dotIdx = coord.indexOf('.');
    if (dotIdx === -1) {
        // bare type
        return !!schema.getType(coord);
    }
    const typeName = coord.slice(0, dotIdx);
    const fieldName = coord.slice(dotIdx + 1);
    const t = schema.getType(typeName);
    if (!t) return { ok: false, reason: `type "${typeName}" not in schema` };
    if (isObjectType(t) || isInterfaceType(t)) {
        const fields = t.getFields();
        if (!fields[fieldName]) {
            return { ok: false, reason: `field "${fieldName}" not on type "${typeName}"` };
        }
        return { ok: true };
    }
    // Could be input object, enum, scalar, union — generally invalid coordinate
    return {
        ok: false,
        reason: `type "${typeName}" is ${t.constructor.name}, cannot have field "${fieldName}"`,
    };
}

const files = fs
    .readdirSync(YAML_DIR)
    .filter((f) => f.endsWith('.yaml'))
    .sort();
console.error(`Found ${files.length} YAML files`);

let operationPassed = 0;
let operationFailed = 0;
let mustIncludePassed = 0;
let mustIncludeFailed = 0;
let totalChecked = 0;
let wellFormedFailed = 0;

const operationFailures = [];
const mustIncludeFailures = [];
const wellFormedFailures = [];

for (const file of files) {
    totalChecked++;
    const full = path.join(YAML_DIR, file);
    const raw = fs.readFileSync(full, 'utf8');
    let doc;
    try {
        doc = yaml.parse(raw);
    } catch (e) {
        wellFormedFailed++;
        wellFormedFailures.push({ queryId: file, error: `YAML parse: ${e.message}` });
        operationFailed++;
        operationFailures.push({ queryId: file, error: `YAML parse: ${e.message}` });
        mustIncludeFailed++;
        mustIncludeFailures.push({ queryId: file, error: `YAML parse: ${e.message}` });
        continue;
    }

    const queryId = doc?.id || file;
    const schemaId = doc?.schemaId;

    // Check well-formedness
    let wellFormed = true;
    const wfErrors = [];
    if (!doc || typeof doc !== 'object') {
        wellFormed = false;
        wfErrors.push('not an object');
    }
    if (!doc?.operation || typeof doc.operation !== 'string') {
        wellFormed = false;
        wfErrors.push('missing/invalid operation');
    }
    if (!Array.isArray(doc?.targetFields)) {
        wellFormed = false;
        wfErrors.push('targetFields not an array');
    }
    if (!Array.isArray(doc?.targetTypes)) {
        wellFormed = false;
        wfErrors.push('targetTypes not an array');
    }
    if (!Array.isArray(doc?.mustInclude) || doc.mustInclude.length === 0) {
        wellFormed = false;
        wfErrors.push('missing/invalid mustInclude');
    }
    if (!schemaId || !schemas[schemaId]) {
        wellFormed = false;
        wfErrors.push(`unknown schemaId: ${schemaId}`);
    }

    if (!wellFormed) {
        wellFormedFailed++;
        wellFormedFailures.push({ queryId, error: wfErrors.join('; ') });
        operationFailed++;
        operationFailures.push({ queryId, error: `well-formed: ${wfErrors.join('; ')}` });
        mustIncludeFailed++;
        mustIncludeFailures.push({ queryId, error: `well-formed: ${wfErrors.join('; ')}` });
        continue;
    }

    const schema = schemas[schemaId];

    // 1. Parse + validate operation
    let opOk = true;
    let opErr = null;
    try {
        const ast = parse(doc.operation);
        const errors = validate(schema, ast);
        if (errors.length > 0) {
            opOk = false;
            opErr = errors.map((e) => e.message).join(' | ');
        }
    } catch (e) {
        opOk = false;
        opErr = `parse: ${e.message}`;
    }
    if (opOk) {
        operationPassed++;
    } else {
        operationFailed++;
        operationFailures.push({ queryId, error: opErr });
    }

    // 2. Validate mustInclude coordinates exist in schema
    const miErrs = [];
    for (const coord of doc.mustInclude) {
        if (typeof coord !== 'string') {
            miErrs.push(`non-string coordinate: ${JSON.stringify(coord)}`);
            continue;
        }
        const result = schemaHasCoordinate(schema, coord);
        if (result === true) continue;
        if (result && result.ok) continue;
        if (result === false) {
            miErrs.push(`bare type "${coord}" not in schema`);
            continue;
        }
        if (result && !result.ok) {
            miErrs.push(`${coord}: ${result.reason}`);
        }
    }
    if (miErrs.length === 0) {
        mustIncludePassed++;
    } else {
        mustIncludeFailed++;
        mustIncludeFailures.push({ queryId, error: miErrs.join(' | ') });
    }
}

const result = {
    totalChecked,
    operationPassed,
    operationFailed,
    mustIncludePassed,
    mustIncludeFailed,
    wellFormedFailed,
    operationFailures,
    mustIncludeFailures,
    wellFormedFailures,
};

console.log(JSON.stringify(result, null, 2));
