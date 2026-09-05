/**
 * Filesystem discovery: schemas/, queries/, strategies/, templates/,
 * type-templates/, models/.
 *
 * Each top-level dir under src/schemas/ is a schema. Each top-level dir under
 * src/queries/ is a category. Each top-level dir under src/strategies/ is a
 * strategy. Each top-level dir under src/templates/ is a field template
 * (meta.json + index.ts with `render`). Each top-level dir under
 * src/type-templates/ is a type template (same shape, but `render` takes a
 * TypeDef). Each top-level dir under src/models/ is a model
 * (meta.json only — models are pure config). The loader is the one place that
 * walks these — nothing else hard-codes IDs.
 */
import { createHash } from 'node:crypto';
import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';
import type {
    CategoryMeta,
    ModelDef,
    AgentModelDef,
    AgentPromptDef,
    QueryDef,
    SchemaDef,
    StrategyDef,
    TemplateDef,
    TypeTemplateDef,
} from '../types.ts';

const SRC_ROOT = (() => {
    // src/core/shared/loader.ts → src/
    const here = fileURLToPath(new URL('.', import.meta.url));
    return join(here, '..', '..');
})();

async function isDir(p: string): Promise<boolean> {
    try {
        return (await stat(p)).isDirectory();
    } catch {
        return false;
    }
}

async function readJson<T>(p: string): Promise<T> {
    const raw = await readFile(p, 'utf8');
    return JSON.parse(raw) as T;
}

export async function loadSchemas(): Promise<SchemaDef[]> {
    const root = join(SRC_ROOT, 'schemas');
    const entries = await readdir(root);
    const out: SchemaDef[] = [];
    for (const name of entries) {
        const dir = join(root, name);
        if (!(await isDir(dir))) continue;
        const meta = await readJson<{ id: string; name: string; description?: string }>(
            join(dir, 'meta.json'),
        );
        const sdl = await readFile(join(dir, 'schema.graphql'), 'utf8');
        out.push({
            id: meta.id,
            name: meta.name,
            ...(meta.description !== undefined ? { description: meta.description } : {}),
            sdl,
        });
    }
    return out;
}

export async function loadCategories(): Promise<CategoryMeta[]> {
    const root = join(SRC_ROOT, 'queries');
    const entries = await readdir(root);
    const out: CategoryMeta[] = [];
    for (const name of entries) {
        const dir = join(root, name);
        if (!(await isDir(dir))) continue;
        const meta = await readJson<CategoryMeta>(join(dir, '_meta.json'));
        out.push(meta);
    }
    return out;
}

export async function loadQueries(): Promise<QueryDef[]> {
    const root = join(SRC_ROOT, 'queries');
    const entries = await readdir(root);
    const out: QueryDef[] = [];
    for (const cat of entries) {
        const dir = join(root, cat);
        if (!(await isDir(dir))) continue;
        const files = await readdir(dir);
        for (const f of files) {
            if (!f.endsWith('.yaml') && !f.endsWith('.yml')) continue;
            if (f === '_meta.json') continue;
            const raw = await readFile(join(dir, f), 'utf8');
            const parsed = parseYaml(raw) as Omit<QueryDef, 'category'>;
            out.push({
                ...parsed,
                category: cat,
                targetFields: parsed.targetFields ?? [],
                targetTypes: parsed.targetTypes ?? [],
            });
        }
    }
    return out;
}

export async function loadStrategies(): Promise<StrategyDef[]> {
    const root = join(SRC_ROOT, 'strategies');
    const entries = await readdir(root);
    const out: StrategyDef[] = [];
    for (const name of entries) {
        const dir = join(root, name);
        if (!(await isDir(dir))) continue;
        const meta = await readJson<{
            id: string;
            name: string;
            description: string;
            defaultConfig?: Record<string, unknown>;
        }>(join(dir, 'meta.json'));
        // Dynamic import of the strategy entry point. Each strategy is fully
        // self-contained; the framework just expects an exported `run`.
        const mod = (await import(join(dir, 'index.ts'))) as { run: StrategyDef['run'] };
        if (typeof mod.run !== 'function') {
            throw new Error(`Strategy ${name} must export a 'run' function`);
        }
        const src = await readFile(join(dir, 'index.ts'), 'utf8');
        const sourceHash = createHash('sha256').update(src).digest('hex');
        out.push({
            id: meta.id,
            name: meta.name,
            description: meta.description,
            ...(meta.defaultConfig !== undefined ? { defaultConfig: meta.defaultConfig } : {}),
            run: mod.run,
            sourceHash,
        });
    }
    return out;
}

interface TemplateMeta {
    id: string;
    name: string;
    description: string;
    /** Defaults to ['field'] if omitted. */
    applies?: ReadonlyArray<'field'>;
}

export async function loadTemplates(): Promise<TemplateDef[]> {
    const root = join(SRC_ROOT, 'templates');
    let entries: string[];
    try {
        entries = await readdir(root);
    } catch {
        return [];
    }
    const out: TemplateDef[] = [];
    for (const name of entries) {
        const dir = join(root, name);
        if (!(await isDir(dir))) continue;
        const meta = await readJson<TemplateMeta>(join(dir, 'meta.json'));
        const mod = (await import(join(dir, 'index.ts'))) as { render: TemplateDef['render'] };
        if (typeof mod.render !== 'function') {
            throw new Error(`Template ${name} must export a 'render' function`);
        }
        const src = await readFile(join(dir, 'index.ts'), 'utf8');
        const sourceHash = createHash('sha256').update(src).digest('hex');
        out.push({
            id: meta.id,
            name: meta.name,
            description: meta.description,
            applies: new Set(meta.applies ?? ['field']),
            render: mod.render,
            sourceHash,
        });
    }
    return out;
}

interface TypeTemplateMeta {
    id: string;
    name: string;
    description: string;
}

export async function loadTypeTemplates(): Promise<TypeTemplateDef[]> {
    const root = join(SRC_ROOT, 'type-templates');
    let entries: string[];
    try {
        entries = await readdir(root);
    } catch {
        return [];
    }
    const out: TypeTemplateDef[] = [];
    for (const name of entries) {
        const dir = join(root, name);
        if (!(await isDir(dir))) continue;
        const meta = await readJson<TypeTemplateMeta>(join(dir, 'meta.json'));
        const mod = (await import(join(dir, 'index.ts'))) as { render: TypeTemplateDef['render'] };
        if (typeof mod.render !== 'function') {
            throw new Error(`Type template ${name} must export a 'render' function`);
        }
        const src = await readFile(join(dir, 'index.ts'), 'utf8');
        const sourceHash = createHash('sha256').update(src).digest('hex');
        out.push({
            id: meta.id,
            name: meta.name,
            description: meta.description,
            render: mod.render,
            sourceHash,
        });
    }
    return out;
}

export async function loadModels(): Promise<ModelDef[]> {
    const root = join(SRC_ROOT, 'models');
    let entries: string[];
    try {
        entries = await readdir(root);
    } catch {
        return [];
    }
    const out: ModelDef[] = [];
    for (const name of entries) {
        const dir = join(root, name);
        if (!(await isDir(dir))) continue;
        const raw = await readFile(join(dir, 'meta.json'), 'utf8');
        const meta = JSON.parse(raw) as ModelDef;
        const sourceHash = createHash('sha256').update(raw).digest('hex');
        out.push({ ...meta, sourceHash });
    }
    return out;
}

/** Swappable agent prompts — src/agent-prompts/<id>/{index.ts,meta.json}. Each
 *  index.ts exports buildSystem + searchToolDescription + executeToolDescription;
 *  the prompt is a comparison axis (model × strategy × prompt). */
export async function loadAgentPrompts(): Promise<AgentPromptDef[]> {
    const root = join(SRC_ROOT, 'agent-prompts');
    let entries: string[];
    try {
        entries = await readdir(root);
    } catch {
        return [];
    }
    const out: AgentPromptDef[] = [];
    for (const name of entries) {
        const dir = join(root, name);
        if (!(await isDir(dir))) continue;
        const meta = await readJson<{ id: string; name: string; description: string }>(
            join(dir, 'meta.json'),
        );
        const mod = (await import(join(dir, 'index.ts'))) as {
            buildSystem: AgentPromptDef['buildSystem'];
            searchToolDescription: string;
            executeToolDescription: string;
            answerToolDescription: string;
        };
        if (typeof mod.buildSystem !== 'function') {
            throw new Error(`Agent prompt ${name} must export a 'buildSystem' function`);
        }
        const src = await readFile(join(dir, 'index.ts'), 'utf8');
        const sourceHash = createHash('sha256').update(src).digest('hex');
        out.push({
            id: meta.id,
            name: meta.name,
            description: meta.description,
            buildSystem: mod.buildSystem,
            searchToolDescription: mod.searchToolDescription,
            executeToolDescription: mod.executeToolDescription,
            answerToolDescription: mod.answerToolDescription,
            sourceHash,
        });
    }
    return out;
}

/** Chat models for the agent benchmark — src/agent-models/<id>/meta.json.
 *  Separate axis from loadModels (embedding models); never on the openai-only
 *  embeddings provider path. */
export async function loadAgentModels(): Promise<AgentModelDef[]> {
    const root = join(SRC_ROOT, 'agent-models');
    let entries: string[];
    try {
        entries = await readdir(root);
    } catch {
        return [];
    }
    const out: AgentModelDef[] = [];
    for (const name of entries) {
        const dir = join(root, name);
        if (!(await isDir(dir))) continue;
        const raw = await readFile(join(dir, 'meta.json'), 'utf8');
        const meta = JSON.parse(raw) as AgentModelDef;
        const sourceHash = createHash('sha256').update(raw).digest('hex');
        out.push({ ...meta, sourceHash });
    }
    return out;
}
