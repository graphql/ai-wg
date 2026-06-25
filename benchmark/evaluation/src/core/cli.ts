/**
 * CLI entry point. Dispatches by benchmark type:
 *   pnpm eval strategies     [filters]   # default; varies strategy
 *   pnpm eval templates      [filters]   # Phase 2: varies field template
 *   pnpm eval type-templates [filters]   # varies type template
 *   pnpm eval models         [filters]   # Phase 2: varies model
 *
 * Filters: --schema / --strategy / --category / --query / --concurrency.
 * `--list` prints available IDs (schemas, queries, strategies, templates,
 * type-templates, models, benchmarks) and exits.
 */
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    loadAgentModels,
    loadAgentPrompts,
    loadCategories,
    loadModels,
    loadQueries,
    loadSchemas,
    loadStrategies,
    loadTemplates,
    loadTypeTemplates,
} from './shared/loader.ts';
import { runBenchmark as runStrategiesBenchmark } from '../benchmarks/strategies/runner.ts';
import { writeReport as writeStrategiesReport } from '../benchmarks/strategies/reporter.ts';
import { runBenchmark as runTemplatesBenchmark } from '../benchmarks/templates/runner.ts';
import { writeReport as writeTemplatesReport } from '../benchmarks/templates/reporter.ts';
import { runBenchmark as runTypeTemplatesBenchmark } from '../benchmarks/type-templates/runner.ts';
import { writeReport as writeTypeTemplatesReport } from '../benchmarks/type-templates/reporter.ts';
import { runBenchmark as runModelsBenchmark } from '../benchmarks/models/runner.ts';
import { writeReport as writeModelsReport } from '../benchmarks/models/reporter.ts';
import { runBenchmark as runAgentBenchmark, selectCherryPick } from '../benchmarks/agent/runner.ts';
import { writeReport as writeAgentReport } from '../benchmarks/agent/reporter.ts';
import {
    computeQueryContentHash,
    computeSchemaSdlHash,
    computeStaticDeterminants,
    type CacheKeyDeterminants,
} from '../benchmarks/agent/determinants.ts';
import { pruneOrphanedAgentCache } from '../benchmarks/agent/prune.ts';
import type {
    AgentModelDef,
    AgentPromptDef,
    CategoryMeta,
    EmbeddingSetup,
    ModelDef,
    QueryDef,
    SchemaDef,
    StrategyDef,
    TemplateDef,
    TypeTemplateDef,
} from './types.ts';

type BenchmarkType = 'strategies' | 'templates' | 'type-templates' | 'models' | 'agent';
const BENCHMARKS: ReadonlyArray<{ id: BenchmarkType; name: string; description: string }> = [
    {
        id: 'strategies',
        name: 'Strategy benchmark',
        description: 'Vary the slicing strategy; fixed (model, template). Headline: perfect%.',
    },
    {
        id: 'templates',
        name: 'Template benchmark',
        description:
            'Vary the field rendering template; fixed (model, strategy=pure-knn). Headline: recall@50.',
    },
    {
        id: 'type-templates',
        name: 'Type-template benchmark',
        description:
            'Vary the type rendering template; fixed (model, field template, strategy=pure-knn). Headline: type recall@50.',
    },
    {
        id: 'models',
        name: 'Model benchmark',
        description:
            'Vary the embedding model; fixed (template, strategy=pure-knn). Headline: recall@50.',
    },
    {
        id: 'agent',
        name: 'Agent benchmark',
        description:
            'Agentic LLM schema-search loop; vary (chat model × strategy × prompt). Headline: success%.',
    },
];

const DEFAULT_MODEL_ID = 'openai-3-small';
const DEFAULT_TEMPLATE_ID = 'coord-return-desc';
const DEFAULT_TYPE_TEMPLATE_ID = 'name-desc';

interface Args {
    benchmark: BenchmarkType;
    schemaIds: Set<string> | null;
    strategyIds: Set<string> | null;
    templateIds: Set<string> | null;
    typeTemplateIds: Set<string> | null;
    modelIds: Set<string> | null;
    promptIds: Set<string> | null;
    categoryIds: Set<string> | null;
    queryIds: Set<string> | null;
    list: boolean;
    concurrency: number | null;
    noCache: boolean;
    // Agent benchmark flags (ignored by the other four categories).
    maxTurns: number | null;
    maxToolCalls: number | null;
    maxCostUsd: number | null;
    nSamples: number | null;
    seed: number | null;
    temperature: number | null;
    fullBench: boolean;
    keywords: boolean;
    limit: number | null;
    pruneCache: boolean;
}

function isBenchmarkType(s: string): s is BenchmarkType {
    return BENCHMARKS.some((b) => b.id === s);
}

function parseArgs(argv: string[]): Args {
    const a: Args = {
        benchmark: 'strategies',
        schemaIds: null,
        strategyIds: null,
        templateIds: null,
        typeTemplateIds: null,
        modelIds: null,
        promptIds: null,
        categoryIds: null,
        queryIds: null,
        list: false,
        concurrency: null,
        noCache: false,
        maxTurns: null,
        maxToolCalls: null,
        maxCostUsd: null,
        nSamples: null,
        seed: null,
        temperature: null,
        fullBench: false,
        keywords: false,
        limit: null,
        pruneCache: false,
    };
    // Positional first arg = benchmark type (if it doesn't look like a flag).
    let start = 0;
    if (argv.length > 0 && argv[0] !== undefined && !argv[0].startsWith('-')) {
        const candidate = argv[0];
        if (!isBenchmarkType(candidate)) {
            throw new Error(
                `Unknown benchmark type: '${candidate}'. Known: ${BENCHMARKS.map((b) => b.id).join(', ')}`,
            );
        }
        a.benchmark = candidate;
        start = 1;
    }
    for (let i = start; i < argv.length; i++) {
        const k = argv[i];
        const v = argv[i + 1];
        const asSet = (s?: string): Set<string> =>
            new Set(
                (s ?? '')
                    .split(',')
                    .map((x) => x.trim())
                    .filter(Boolean),
            );
        switch (k) {
            case '--schema':
                a.schemaIds = asSet(v);
                i++;
                break;
            case '--strategy':
                a.strategyIds = asSet(v);
                i++;
                break;
            case '--template':
                a.templateIds = asSet(v);
                i++;
                break;
            case '--type-template':
                a.typeTemplateIds = asSet(v);
                i++;
                break;
            case '--model':
                a.modelIds = asSet(v);
                i++;
                break;
            case '--prompt':
                a.promptIds = asSet(v);
                i++;
                break;
            case '--category':
                a.categoryIds = asSet(v);
                i++;
                break;
            case '--query':
                a.queryIds = asSet(v);
                i++;
                break;
            case '--list':
                a.list = true;
                break;
            case '--concurrency':
            case '-j': {
                const n = Number(argv[++i]);
                if (!Number.isFinite(n) || n < 1)
                    throw new Error(`--concurrency must be a positive integer (got '${argv[i]}')`);
                a.concurrency = Math.floor(n);
                break;
            }
            case '--no-cache':
                a.noCache = true;
                break;
            case '--max-turns': {
                const n = Number(argv[++i]);
                if (!Number.isFinite(n) || n < 1)
                    throw new Error(`--max-turns must be a positive integer (got '${argv[i]}')`);
                a.maxTurns = Math.floor(n);
                break;
            }
            case '--max-tool-calls': {
                const n = Number(argv[++i]);
                if (!Number.isFinite(n) || n < 1)
                    throw new Error(
                        `--max-tool-calls must be a positive integer (got '${argv[i]}')`,
                    );
                a.maxToolCalls = Math.floor(n);
                break;
            }
            case '--max-cost': {
                const n = Number(argv[++i]);
                if (!Number.isFinite(n) || n <= 0)
                    throw new Error(`--max-cost must be a positive number (got '${argv[i]}')`);
                a.maxCostUsd = n;
                break;
            }
            case '--samples': {
                const n = Number(argv[++i]);
                if (!Number.isFinite(n) || n < 1)
                    throw new Error(`--samples must be a positive integer (got '${argv[i]}')`);
                a.nSamples = Math.floor(n);
                break;
            }
            case '--seed': {
                const n = Number(argv[++i]);
                if (!Number.isFinite(n))
                    throw new Error(`--seed must be a number (got '${argv[i]}')`);
                a.seed = Math.floor(n);
                break;
            }
            case '--temperature': {
                const n = Number(argv[++i]);
                if (!Number.isFinite(n) || n < 0)
                    throw new Error(
                        `--temperature must be a non-negative number (got '${argv[i]}')`,
                    );
                a.temperature = n;
                break;
            }
            case '--full-bench':
                a.fullBench = true;
                break;
            case '--keywords':
                a.keywords = true;
                break;
            case '--prune-cache':
                a.pruneCache = true;
                break;
            case '--limit': {
                const n = Number(argv[++i]);
                if (!Number.isFinite(n) || n < 1)
                    throw new Error(`--limit must be a positive integer (got '${argv[i]}')`);
                a.limit = Math.floor(n);
                break;
            }
            case '-h':
            case '--help':
                console.log(`
Usage: pnpm eval [<benchmark>] [options]

  <benchmark>             one of: ${BENCHMARKS.map((b) => b.id).join(', ')}  (default: strategies)

  --schema <ids>          comma-separated schema ids
  --strategy <ids>        comma-separated strategy ids
  --template <ids>        comma-separated field template ids (templates benchmark)
  --type-template <ids>   comma-separated type template ids (type-templates benchmark)
  --model <ids>           comma-separated model ids (models benchmark)
  --category <ids>        comma-separated category ids
  --query <ids>           comma-separated query ids
  --concurrency, -j <N>   worker thread count (default: floor(os.cpus().length / 2) - 1; agent default: 4)
  --no-cache              skip result cache and re-run every job

  Agent benchmark only (--model selects chat models from src/agent-models/):
    NOTE: --model/--schema/--query/--category scope ONLY what runs LIVE this
    invocation. The report (results.md) always shows the FULL accumulated board
    read from the result cache — every loaded agent model over the cherry|full
    board query set — so running a subset never erases prior models from the board.
    --strategy/--prompt remain deliberate opt-in axes that scope both run and board.
  --prompt <ids>          comma-separated agent-prompt ids (default: default)
  --max-turns <N>         per-session turn cap (default: 12)
  --max-tool-calls <N>    per-session tool-call cap (default: 20)
  --max-cost <USD>        per-session cost cap (default: 0.50)
  --samples <N>           draws per cell (default: 1)
  --seed <N>              RNG seed determinant (default: 0)
  --temperature <F>       passed to the provider (default: 0)
  --full-bench            run all selected queries instead of the cherry-pick manifest
  --keywords              include -kw keyword-rephrased queries (agent benchmark excludes them by default)
  --limit <N>             cap total cells after filtering (cost safety)
  --prune-cache           delete orphaned agent cache entries the current determinants would never read, print stats, and exit (no benchmark run)

  --list                  list available schemas, queries, strategies, templates, type-templates, models, agent models, benchmarks and exit
`);
                process.exit(0);
            default:
                if (k !== undefined) throw new Error(`Unknown arg: ${k}`);
        }
    }
    return a;
}

function resolveDefaultSetup(
    models: ModelDef[],
    templates: TemplateDef[],
    typeTemplates: TypeTemplateDef[],
): EmbeddingSetup {
    const model = models.find((m) => m.id === DEFAULT_MODEL_ID);
    if (!model) throw new Error(`Default model '${DEFAULT_MODEL_ID}' not found in src/models/`);
    const template = templates.find((t) => t.id === DEFAULT_TEMPLATE_ID);
    if (!template)
        throw new Error(`Default template '${DEFAULT_TEMPLATE_ID}' not found in src/templates/`);
    const typeTemplate = typeTemplates.find((t) => t.id === DEFAULT_TYPE_TEMPLATE_ID);
    if (!typeTemplate)
        throw new Error(
            `Default type template '${DEFAULT_TYPE_TEMPLATE_ID}' not found in src/type-templates/`,
        );
    return { model, template, typeTemplate };
}

/** Resolve the fixed default type template shared by the models/templates/strategies snapshot builds. */
function resolveDefaultTypeTemplate(typeTemplates: TypeTemplateDef[]): TypeTemplateDef {
    const typeTemplate = typeTemplates.find((t) => t.id === DEFAULT_TYPE_TEMPLATE_ID);
    if (!typeTemplate)
        throw new Error(
            `Default type template '${DEFAULT_TYPE_TEMPLATE_ID}' not found in src/type-templates/`,
        );
    return typeTemplate;
}

async function main(): Promise<void> {
    const args = parseArgs(process.argv.slice(2));

    const [
        schemas,
        categories,
        queries,
        strategies,
        templates,
        typeTemplates,
        models,
        agentModels,
        agentPrompts,
    ] = await Promise.all([
        loadSchemas(),
        loadCategories(),
        loadQueries(),
        loadStrategies(),
        loadTemplates(),
        loadTypeTemplates(),
        loadModels(),
        loadAgentModels(),
        loadAgentPrompts(),
    ]);

    if (args.list) {
        console.log('Benchmarks:');
        for (const b of BENCHMARKS) console.log(`  ${b.id}  — ${b.name}`);
        console.log('\nSchemas:');
        for (const s of schemas) console.log(`  ${s.id}  — ${s.name}`);
        console.log('\nCategories:');
        for (const c of categories) console.log(`  ${c.id}  — ${c.name}`);
        console.log('\nStrategies:');
        for (const s of strategies) console.log(`  ${s.id}  — ${s.name}`);
        console.log('\nTemplates:');
        for (const t of templates) console.log(`  ${t.id}  — ${t.name}`);
        console.log('\nType templates:');
        for (const t of typeTemplates) console.log(`  ${t.id}  — ${t.name}`);
        console.log('\nModels:');
        for (const m of models)
            console.log(`  ${m.id}  — ${m.name}  (${m.provider}/${m.modelName}, ${m.dims}d)`);
        console.log('\nAgent models:');
        for (const m of agentModels)
            console.log(`  ${m.id}  — ${m.name}  (${m.provider}/${m.modelName})`);
        console.log('\nAgent prompts:');
        for (const p of agentPrompts) console.log(`  ${p.id}  — ${p.name}`);
        console.log('\nQueries:');
        for (const q of queries) console.log(`  [${q.category}] ${q.id}  (schema=${q.schemaId})`);
        return;
    }

    // Dispatch by benchmark type.
    if (args.benchmark === 'templates') {
        await runTemplates(args, schemas, categories, queries, templates, typeTemplates, models);
        return;
    }
    if (args.benchmark === 'type-templates') {
        await runTypeTemplates(
            args,
            schemas,
            categories,
            queries,
            templates,
            typeTemplates,
            models,
        );
        return;
    }
    if (args.benchmark === 'models') {
        await runModels(args, schemas, categories, queries, templates, typeTemplates, models);
        return;
    }
    if (args.benchmark === 'agent') {
        await runAgent(
            args,
            schemas,
            categories,
            queries,
            templates,
            typeTemplates,
            models,
            strategies,
            agentModels,
            agentPrompts,
        );
        return;
    }

    // strategies benchmark.
    const setup = resolveDefaultSetup(models, templates, typeTemplates);

    const useSchemas = args.schemaIds ? schemas.filter((s) => args.schemaIds!.has(s.id)) : schemas;
    const useStrategies = args.strategyIds
        ? strategies.filter((s) => args.strategyIds!.has(s.id))
        : strategies;
    const useCategories = args.categoryIds
        ? categories.filter((c) => args.categoryIds!.has(c.id))
        : categories;
    const useQueries = queries.filter((q) => {
        if (args.queryIds && !args.queryIds.has(q.id)) return false;
        if (args.categoryIds && !args.categoryIds.has(q.category)) return false;
        if (args.schemaIds && !args.schemaIds.has(q.schemaId)) return false;
        return true;
    });

    if (useSchemas.length === 0) throw new Error('No schemas selected.');
    if (useStrategies.length === 0) throw new Error('No strategies selected.');
    if (useQueries.length === 0) throw new Error('No queries selected.');

    // One cohort per strategy now that presets are gone.
    const cohorts = useStrategies.map((s) => s.id);
    console.log(
        `Benchmark: ${args.benchmark}  (model=${setup.model.id}, template=${setup.template.id})`,
    );
    console.log(
        `Running ${cohorts.length} cohorts × ${useQueries.length} queries × ${useSchemas.length} schemas`,
    );
    console.log(`Cohorts: ${cohorts.join(', ')}`);
    console.log(`Categories: ${useCategories.map((c) => c.id).join(', ')}\n`);

    const report = await runStrategiesBenchmark({
        schemas: useSchemas,
        categories: useCategories,
        strategies: useStrategies,
        queries: useQueries,
        setup,
        timestampIso: new Date().toISOString(),
        onProgress: (m) => console.log(m),
        ...(args.concurrency !== null ? { concurrency: args.concurrency } : {}),
        ...(args.noCache ? { noCache: true } : {}),
    });

    const here = fileURLToPath(new URL('.', import.meta.url));
    const outDir = join(here, '..', '..', 'runs', 'current', args.benchmark);
    const { jsonPath, mdPath } = await writeStrategiesReport(report, outDir);

    console.log(`\nWrote:`);
    console.log(`  ${jsonPath}`);
    console.log(`  ${mdPath}`);

    // Headline — perfect% leads, then full token distribution.
    console.log('');
    console.log('Headline (sorted by perfect%):');
    console.log(
        '  strategy                       perfect%   tk mean   tk p50   tk p95   tk p99   recall mean   recall p50',
    );
    console.log('  ' + '-'.repeat(110));
    const fmtTk = (v: number): string => (v >= 1000 ? `${(v / 1000).toFixed(1)}k` : v.toFixed(0));
    const pc = (sorted: number[], q: number): number =>
        sorted.length
            ? sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * q))]!
            : 0;
    const mn = (a: number[]): number =>
        a.length ? a.reduce((acc, x) => acc + x, 0) / a.length : 0;
    // One formatted metric row, aligned so a 30-wide strategy label and a
    // 28-wide indented schema label land their numbers in the same columns.
    const fmtRow = (
        indent: string,
        label: string,
        width: number,
        perfect: number,
        toks: number[],
        recs: number[],
    ): string =>
        indent +
        label.padEnd(width) +
        ((perfect * 100).toFixed(1) + '%').padStart(8) +
        fmtTk(mn(toks)).padStart(10) +
        fmtTk(pc(toks, 0.5)).padStart(9) +
        fmtTk(pc(toks, 0.95)).padStart(9) +
        fmtTk(pc(toks, 0.99)).padStart(9) +
        mn(recs).toFixed(3).padStart(14) +
        pc(recs, 0.5).toFixed(3).padStart(13);
    const schemaIds = [...new Set(report.rows.map((r) => r.schemaId))].sort();
    for (const s of [...report.summary].sort((a, b) => b.perfectPct - a.perfectPct)) {
        const ts = s.tokenStats;
        const rs = s.recallStats;
        console.log(
            '  ' +
                s.strategyId.padEnd(30) +
                ((s.perfectPct * 100).toFixed(1) + '%').padStart(8) +
                fmtTk(ts.mean).padStart(10) +
                fmtTk(ts.p50).padStart(9) +
                fmtTk(ts.p95).padStart(9) +
                fmtTk(ts.p99).padStart(9) +
                rs.mean.toFixed(3).padStart(14) +
                rs.p50.toFixed(3).padStart(13),
        );
        // Indented per-schema breakdown.
        for (const sid of schemaIds) {
            const rows = report.rows.filter(
                (r) => r.strategyId === s.strategyId && r.schemaId === sid,
            );
            if (rows.length === 0) continue;
            const wm = rows.filter((r) => r.metrics.mustTotal > 0);
            const perfect = wm.length
                ? wm.filter((r) => r.metrics.perfectRecall).length / wm.length
                : 0;
            // Indent 6 + same 30-wide label as the strategy row ⇒ the whole
            // schema sub-row (label AND every number column) is offset 4 right.
            console.log(
                fmtRow(
                    '      ',
                    sid,
                    30,
                    perfect,
                    rows.map((r) => r.metrics.sliceTokens).sort((a, b) => a - b),
                    wm.map((r) => r.metrics.mustRecall).sort((a, b) => a - b),
                ),
            );
        }
    }
}

async function runTemplates(
    args: Args,
    schemas: SchemaDef[],
    categories: CategoryMeta[],
    queries: QueryDef[],
    templates: TemplateDef[],
    typeTemplates: TypeTemplateDef[],
    models: ModelDef[],
): Promise<void> {
    const model = models.find((m) => m.id === DEFAULT_MODEL_ID);
    if (!model) throw new Error(`Default model '${DEFAULT_MODEL_ID}' not found in src/models/`);
    const typeTemplate = resolveDefaultTypeTemplate(typeTemplates);

    const useSchemas = args.schemaIds ? schemas.filter((s) => args.schemaIds!.has(s.id)) : schemas;
    const useTemplates = args.templateIds
        ? templates.filter((t) => args.templateIds!.has(t.id))
        : templates;
    const useCategories = args.categoryIds
        ? categories.filter((c) => args.categoryIds!.has(c.id))
        : categories;
    const useQueries = queries.filter((q) => {
        if (args.queryIds && !args.queryIds.has(q.id)) return false;
        if (args.categoryIds && !args.categoryIds.has(q.category)) return false;
        if (args.schemaIds && !args.schemaIds.has(q.schemaId)) return false;
        return true;
    });

    if (useSchemas.length === 0) throw new Error('No schemas selected.');
    if (useTemplates.length === 0) throw new Error('No templates selected.');
    if (useQueries.length === 0) throw new Error('No queries selected.');

    console.log(`Benchmark: templates  (model=${model.id}, strategy=pure-knn inline)`);
    console.log(
        `Running ${useTemplates.length} templates × ${useQueries.length} queries × ${useSchemas.length} schemas`,
    );
    console.log(`Templates: ${useTemplates.map((t) => t.id).join(', ')}`);
    console.log(`Categories: ${useCategories.map((c) => c.id).join(', ')}\n`);

    const report = await runTemplatesBenchmark({
        schemas: useSchemas,
        categories: useCategories,
        templates: useTemplates,
        queries: useQueries,
        model,
        typeTemplate,
        timestampIso: new Date().toISOString(),
        onProgress: (m) => console.log(m),
        ...(args.concurrency !== null ? { concurrency: args.concurrency } : {}),
        ...(args.noCache ? { noCache: true } : {}),
    });

    const here = fileURLToPath(new URL('.', import.meta.url));
    const outDir = join(here, '..', '..', 'runs', 'current', 'templates');
    const { jsonPath, mdPath } = await writeTemplatesReport(report, outDir);

    console.log(`\nWrote:`);
    console.log(`  ${jsonPath}`);
    console.log(`  ${mdPath}`);

    console.log('');
    console.log('Headline (sorted by FIELD recall@50):');
    console.log(
        '  template                       F recall@20  F recall@50  F recall@100  T recall@20  T recall@50  F rank p50  F rank p95',
    );
    console.log('  ' + '-'.repeat(130));
    for (const s of [...report.summary].sort(
        (a, b) => (b.fieldRecallAtK[50] ?? 0) - (a.fieldRecallAtK[50] ?? 0),
    )) {
        const pctStr = (v: number): string => (v * 100).toFixed(1) + '%';
        console.log(
            '  ' +
                s.templateId.padEnd(30) +
                pctStr(s.fieldRecallAtK[20] ?? 0).padStart(12) +
                pctStr(s.fieldRecallAtK[50] ?? 0).padStart(13) +
                pctStr(s.fieldRecallAtK[100] ?? 0).padStart(14) +
                pctStr(s.typeRecallAtK[20] ?? 0).padStart(13) +
                pctStr(s.typeRecallAtK[50] ?? 0).padStart(13) +
                s.fieldRankStats.p50.toFixed(0).padStart(12) +
                s.fieldRankStats.p95.toFixed(0).padStart(11),
        );
    }
}

async function runModels(
    args: Args,
    schemas: SchemaDef[],
    categories: CategoryMeta[],
    queries: QueryDef[],
    templates: TemplateDef[],
    typeTemplates: TypeTemplateDef[],
    models: ModelDef[],
): Promise<void> {
    const template = templates.find((t) => t.id === DEFAULT_TEMPLATE_ID);
    if (!template)
        throw new Error(`Default template '${DEFAULT_TEMPLATE_ID}' not found in src/templates/`);
    const typeTemplate = resolveDefaultTypeTemplate(typeTemplates);

    const useSchemas = args.schemaIds ? schemas.filter((s) => args.schemaIds!.has(s.id)) : schemas;
    const useModels = args.modelIds ? models.filter((m) => args.modelIds!.has(m.id)) : models;
    const useCategories = args.categoryIds
        ? categories.filter((c) => args.categoryIds!.has(c.id))
        : categories;
    const useQueries = queries.filter((q) => {
        if (args.queryIds && !args.queryIds.has(q.id)) return false;
        if (args.categoryIds && !args.categoryIds.has(q.category)) return false;
        if (args.schemaIds && !args.schemaIds.has(q.schemaId)) return false;
        return true;
    });

    if (useSchemas.length === 0) throw new Error('No schemas selected.');
    if (useModels.length === 0) throw new Error('No models selected.');
    if (useQueries.length === 0) throw new Error('No queries selected.');

    console.log(`Benchmark: models  (template=${template.id}, strategy=pure-knn inline)`);
    console.log(
        `Running ${useModels.length} models × ${useQueries.length} queries × ${useSchemas.length} schemas`,
    );
    console.log(`Models: ${useModels.map((m) => `${m.id}(${m.dims}d)`).join(', ')}`);
    console.log(`Categories: ${useCategories.map((c) => c.id).join(', ')}\n`);

    const report = await runModelsBenchmark({
        schemas: useSchemas,
        categories: useCategories,
        models: useModels,
        queries: useQueries,
        template,
        typeTemplate,
        timestampIso: new Date().toISOString(),
        onProgress: (m) => console.log(m),
        ...(args.concurrency !== null ? { concurrency: args.concurrency } : {}),
        ...(args.noCache ? { noCache: true } : {}),
    });

    const here = fileURLToPath(new URL('.', import.meta.url));
    const outDir = join(here, '..', '..', 'runs', 'current', 'models');
    const { jsonPath, mdPath } = await writeModelsReport(report, outDir);

    console.log(`\nWrote:`);
    console.log(`  ${jsonPath}`);
    console.log(`  ${mdPath}`);

    console.log('');
    console.log('Headline (sorted by FIELD recall@50):');
    console.log(
        '  model                          F recall@20  F recall@50  F recall@100  T recall@20  T recall@50  F rank p50  F rank p95',
    );
    console.log('  ' + '-'.repeat(130));
    for (const s of [...report.summary].sort(
        (a, b) => (b.fieldRecallAtK[50] ?? 0) - (a.fieldRecallAtK[50] ?? 0),
    )) {
        const pctStr = (v: number): string => (v * 100).toFixed(1) + '%';
        console.log(
            '  ' +
                s.modelId.padEnd(30) +
                pctStr(s.fieldRecallAtK[20] ?? 0).padStart(12) +
                pctStr(s.fieldRecallAtK[50] ?? 0).padStart(13) +
                pctStr(s.fieldRecallAtK[100] ?? 0).padStart(14) +
                pctStr(s.typeRecallAtK[20] ?? 0).padStart(13) +
                pctStr(s.typeRecallAtK[50] ?? 0).padStart(13) +
                s.fieldRankStats.p50.toFixed(0).padStart(12) +
                s.fieldRankStats.p95.toFixed(0).padStart(11),
        );
    }
}

// Per-session defaults for the agent benchmark (§7.3). The runner's RunOptions
// requires these as concrete numbers, so the CLI resolves them here.
const AGENT_DEFAULT_MAX_TURNS = 12;
const AGENT_DEFAULT_MAX_TOOL_CALLS = 20;
const AGENT_DEFAULT_MAX_COST_USD = 0.5;
const AGENT_DEFAULT_SAMPLES = 1;
const AGENT_DEFAULT_SEED = 0;
const AGENT_DEFAULT_TEMPERATURE = 0;

async function runAgent(
    args: Args,
    schemas: SchemaDef[],
    categories: CategoryMeta[],
    queries: QueryDef[],
    templates: TemplateDef[],
    typeTemplates: TypeTemplateDef[],
    models: ModelDef[],
    strategies: StrategyDef[],
    agentModels: AgentModelDef[],
    agentPrompts: AgentPromptDef[],
): Promise<void> {
    // FIXED embedding setup used inside `search` (NOT the thing under test):
    // openai-3-small / coord-return-desc / name-desc.
    const setup = resolveDefaultSetup(models, templates, typeTemplates);

    // Default strategy is SLICER only — never run another strategy unless --strategy asks.
    const useStrategies = args.strategyIds
        ? strategies.filter((s) => args.strategyIds!.has(s.id))
        : strategies.filter((s) => s.id === 'slicer');
    // Default prompt is 'default'; --prompt opts into other prompt variants for comparison.
    const usePrompts = args.promptIds
        ? agentPrompts.filter((p) => args.promptIds!.has(p.id))
        : agentPrompts.filter((p) => p.id === 'default');

    const maxTurns = args.maxTurns ?? AGENT_DEFAULT_MAX_TURNS;
    const maxToolCalls = args.maxToolCalls ?? AGENT_DEFAULT_MAX_TOOL_CALLS;
    const maxCostUsd = args.maxCostUsd ?? AGENT_DEFAULT_MAX_COST_USD;
    const nSamples = args.nSamples ?? AGENT_DEFAULT_SAMPLES;
    const seed = args.seed ?? AGENT_DEFAULT_SEED;
    const temperature = args.temperature ?? AGENT_DEFAULT_TEMPERATURE;

    // The BOARD query set: the cherry|full set over the UNFILTERED base queries, NOT
    // narrowed by --schema/--query/--category. Only the -kw rule applies (base-only
    // unless --keywords). The board shows every model over this set; the live selection
    // (useQueries/useAgentModels below) is what actually runs this invocation.
    const allBase = args.keywords ? queries : queries.filter((q) => !q.id.endsWith('-kw'));
    const boardQueries = args.fullBench ? allBase : selectCherryPick(allBase);

    // --prune-cache: delete orphaned agent cache entries the current determinants would
    // never read, print stats, and exit (no benchmark run). Build determinants over the
    // FULL board universe (all schemas/queries/models/strategies/prompts) so a record
    // whose def still loads is keyed correctly and only true orphans are removed.
    if (args.pruneCache) {
        const statics = computeStaticDeterminants(setup);
        const schemaSdlHashes = new Map<string, string>();
        for (const s of schemas) schemaSdlHashes.set(s.id, computeSchemaSdlHash(s.sdl));
        const queryContentHashes = new Map<string, string>();
        for (const q of queries) queryContentHashes.set(q.id, computeQueryContentHash(q));
        const determinants: CacheKeyDeterminants = {
            statics,
            budgets: { maxTurns, maxToolCalls, maxCostUsd, temperature, nSamples, seed },
            schemaSdlHashes,
            queryContentHashes,
        };
        console.log('Pruning orphaned agent cache entries under current determinants…');
        const stats = await pruneOrphanedAgentCache({
            determinants,
            models: agentModels,
            strategies,
            prompts: agentPrompts,
            queries,
        });
        const mb = (stats.bytesFreed / 1e6).toFixed(2);
        console.log(
            `Prune: scanned ${stats.scanned} agent records, deleted ${stats.deleted}, freed ${mb} MB.`,
        );
        return;
    }

    // --model selects CHAT models here (resolved against src/agent-models/ only).
    const useAgentModels = args.modelIds
        ? agentModels.filter((m) => args.modelIds!.has(m.id))
        : agentModels;
    const useSchemas = args.schemaIds ? schemas.filter((s) => args.schemaIds!.has(s.id)) : schemas;
    const useCategories = args.categoryIds
        ? categories.filter((c) => args.categoryIds!.has(c.id))
        : categories;
    const filteredQueries = queries.filter((q) => {
        if (args.queryIds && !args.queryIds.has(q.id)) return false;
        if (args.categoryIds && !args.categoryIds.has(q.category)) return false;
        if (args.schemaIds && !args.schemaIds.has(q.schemaId)) return false;
        return true;
    });
    // `-kw` keyword-rephrased queries are EXCLUDED from the agent benchmark by default:
    // sending a keyword bag as the question tests keyword-interpretation, not agentic
    // schema-search — that robustness axis is opt-in via --keywords (and lives in the
    // strategy benchmark). Base (natural-language) questions only unless --keywords.
    const baseQueries = args.keywords
        ? filteredQueries
        : filteredQueries.filter((q) => !q.id.endsWith('-kw'));
    // Default to the cherry-pick manifest (~20/schema); --full-bench runs all.
    // Done HERE (not just in the runner) so the printed count is the real one.
    const useQueries = args.fullBench ? baseQueries : selectCherryPick(baseQueries);

    if (useAgentModels.length === 0) throw new Error('No agent models selected.');
    if (useStrategies.length === 0)
        throw new Error('No strategies selected (default is slicer — check it exists).');
    if (usePrompts.length === 0)
        throw new Error('No agent prompts selected (default is the "default" prompt).');
    if (useSchemas.length === 0) throw new Error('No schemas selected.');
    if (useQueries.length === 0) throw new Error('No queries selected.');

    console.log(
        `Benchmark: agent  (embed=${setup.model.id}, fieldTemplate=${setup.template.id}, typeTemplate=${setup.typeTemplate.id})`,
    );
    console.log(
        `Running ${useAgentModels.length} chat models × ${useStrategies.length} strategies × ${usePrompts.length} prompts × ${useQueries.length} queries × ${nSamples} samples`,
    );
    console.log(`Agent models: ${useAgentModels.map((m) => `${m.id}(${m.provider})`).join(', ')}`);
    console.log(
        `Grading: deterministic structured-answer deep-equal (YAML answer key when present; no judge)`,
    );
    console.log(`Strategies: ${useStrategies.map((s) => s.id).join(', ')}`);
    console.log(`Prompts: ${usePrompts.map((p) => p.id).join(', ')}`);
    console.log(`Categories: ${useCategories.map((c) => c.id).join(', ')}`);
    console.log(
        `Budgets: maxTurns=${maxTurns}, maxToolCalls=${maxToolCalls}, maxCost=$${maxCostUsd}, temperature=${temperature}, seed=${seed}`,
    );
    console.log(
        `Mode: ${args.fullBench ? 'full-bench (all selected queries)' : 'cherry-pick manifest'}, ${args.keywords ? 'incl. -kw' : 'base-only (no -kw)'}${args.limit !== null ? `, limit=${args.limit}` : ''}\n`,
    );

    const here = fileURLToPath(new URL('.', import.meta.url));
    const outDir = join(here, '..', '..', 'runs', 'current', 'agent');

    const report = await runAgentBenchmark({
        // Warm ALL schemas, not just --schema, so the FULL board (which spans every
        // schema's board queries) can be classified + read from the cache. The live
        // selection is scoped by useQueries/useAgentModels below, not by the schema set.
        schemas,
        categories: useCategories,
        agentModels: useAgentModels,
        allAgentModels: agentModels,
        strategies: useStrategies,
        prompts: usePrompts,
        queries: useQueries,
        boardQueries,
        setup,
        maxTurns,
        maxToolCalls,
        maxCostUsd,
        temperature,
        nSamples,
        seed,
        fullBench: args.fullBench,
        timestampIso: new Date().toISOString(),
        transcriptDir: join(outDir, 'transcripts'),
        onProgress: (m) => console.log(m),
        ...(args.limit !== null ? { limit: args.limit } : {}),
        ...(args.concurrency !== null ? { concurrency: args.concurrency } : {}),
        ...(args.noCache ? { noCache: true } : {}),
    });
    const { jsonPath, mdPath } = await writeAgentReport(report, outDir);

    console.log(`\nWrote:`);
    console.log(`  ${jsonPath}`);
    console.log(`  ${mdPath}`);

    if (report.unsatisfiableQueryIds.length > 0) {
        console.log(
            `\nCarved out ${report.unsatisfiableQueryIds.length} unsatisfiable quer${report.unsatisfiableQueryIds.length === 1 ? 'y' : 'ies'} (bare-union musts): ${report.unsatisfiableQueryIds.join(', ')}`,
        );
    }

    // Full-board coverage (cache-as-ledger): the report shows every model's accumulated
    // results read from the cache; a cohort's expected cell count is queryCount × nSamples.
    // Cells missing under the current determinants don't appear — surface the gap + a hint.
    // The EMPTY-board case (every cell went stale after a re-key) has no cohorts, so a
    // numeric "N of M" is unknowable — print a generic message (the scenario this exists for).
    const expectedPerCohort = report.board.queryCount * report.fixed.nSamples;
    const totalPresent = report.summary.reduce((a, s) => a + s.rowCount, 0);
    const totalExpected = report.summary.length * expectedPerCohort;
    if (report.summary.length === 0 && report.board.queryCount > 0) {
        console.log(
            '\nNo board cells present under current determinants — the harness logic or ' +
                'query set changed since the last run. Run `pnpm eval agent [--model …]` to refresh.',
        );
    } else if (expectedPerCohort > 0 && totalPresent < totalExpected) {
        console.log(
            `\n${totalExpected - totalPresent} of ${totalExpected} board cells missing under current determinants — ` +
                'run `pnpm eval agent [--model …]` to refresh.',
        );
    }

    // Headline — success% leads, with Wilson CI and cost/turn distributions (§7.6).
    console.log('');
    console.log('Headline (sorted by success%, board coverage = cells present / expected):');
    console.log(
        '  model                strategy        prompt        coverage   success%        [95% CI]   turns p50   search μ   queries μ   invalid μ   api s μ     in μ    out μ   cache μ      $ μ    $ total',
    );
    console.log('  ' + '-'.repeat(190));
    const pct = (v: number): string => (v * 100).toFixed(1) + '%';
    const tok = (n: number): string =>
        n >= 1000 ? (n / 1000).toFixed(1) + 'k' : String(Math.round(n));
    for (const s of [...report.summary].sort((a, b) => b.successPct - a.successPct)) {
        const coverage =
            expectedPerCohort > 0 ? `${s.rowCount}/${expectedPerCohort}` : `${s.rowCount}/-`;
        console.log(
            '  ' +
                s.chatModelId.padEnd(20) +
                s.strategyId.padEnd(16) +
                s.promptId.padEnd(14) +
                coverage.padStart(9) +
                '   ' +
                pct(s.successPct).padStart(8) +
                `[${pct(s.successCI.lo)},${pct(s.successCI.hi)}]`.padStart(17) +
                s.turnStats.p50.toFixed(0).padStart(12) +
                s.meanSearchCalls.toFixed(1).padStart(11) +
                s.meanQueriesUsed.toFixed(1).padStart(12) +
                s.meanInvalidQueries.toFixed(1).padStart(12) +
                (s.meanApiMs / 1000).toFixed(1).padStart(10) +
                tok(s.meanInputTokens).padStart(9) +
                tok(s.meanOutputTokens).padStart(9) +
                tok(s.meanCacheReadTokens).padStart(10) +
                ('$' + s.meanTotalCostUsd.toFixed(3)).padStart(9) +
                ('$' + s.totalCostUsd.toFixed(2)).padStart(11),
        );
    }

    // Failure taxonomy — only reasons that ACTUALLY occurred, each column sized to
    // its (long) label so nothing smushes together.
    const failReasons = [
        ...new Set(
            report.summary.flatMap((s) =>
                Object.entries(s.failBreakdown)
                    .filter(([, n]) => n > 0)
                    .map(([r]) => r),
            ),
        ),
    ].sort();
    if (failReasons.length > 0) {
        const w = failReasons.map((r) => r.length + 2);
        console.log('');
        console.log('Failure breakdown (non-zero reasons, counts over all rows):');
        console.log(
            '  ' +
                'model'.padEnd(20) +
                'strategy'.padEnd(16) +
                'prompt'.padEnd(12) +
                failReasons.map((r, i) => r.padStart(w[i]!)).join(''),
        );
        for (const s of [...report.summary].sort((a, b) => b.successPct - a.successPct)) {
            console.log(
                '  ' +
                    s.chatModelId.padEnd(20) +
                    s.strategyId.padEnd(16) +
                    s.promptId.padEnd(12) +
                    failReasons
                        .map((r, i) =>
                            String(
                                s.failBreakdown[r as keyof typeof s.failBreakdown] ?? 0,
                            ).padStart(w[i]!),
                        )
                        .join(''),
            );
        }
    }

    // Diagnostics — one-shot quality, search thrash, and the retrieval-ceiling
    // attribution (where the uncovered musts went: agent error vs slicer gap).
    console.log('');
    console.log('Diagnostics (per cohort):');
    console.log(
        '  model                strategy        prompt        1-shot%   thrash%   coverage-gap musts (agent / retrieval / never-selected)',
    );
    console.log('  ' + '-'.repeat(120));
    for (const s of [...report.summary].sort((a, b) => b.successPct - a.successPct)) {
        console.log(
            '  ' +
                s.chatModelId.padEnd(20) +
                s.strategyId.padEnd(16) +
                s.promptId.padEnd(14) +
                ((s.oneShotPct * 100).toFixed(1) + '%').padStart(8) +
                ((s.thrashRate * 100).toFixed(0) + '%').padStart(10) +
                `${s.coverageGapAgent} / ${s.coverageGapRetrieval} / ${s.coverageGapNeverSelected}`.padStart(
                    22,
                ),
        );
    }
    console.log(
        '  (agent = field retrieved but not selected · retrieval = never surfaced · never-selected = zero valid queries, NOT attributable to the agent)',
    );
}

async function runTypeTemplates(
    args: Args,
    schemas: SchemaDef[],
    categories: CategoryMeta[],
    queries: QueryDef[],
    templates: TemplateDef[],
    typeTemplates: TypeTemplateDef[],
    models: ModelDef[],
): Promise<void> {
    const model = models.find((m) => m.id === DEFAULT_MODEL_ID);
    if (!model) throw new Error(`Default model '${DEFAULT_MODEL_ID}' not found in src/models/`);
    const fieldTemplate = templates.find((t) => t.id === DEFAULT_TEMPLATE_ID);
    if (!fieldTemplate)
        throw new Error(`Default template '${DEFAULT_TEMPLATE_ID}' not found in src/templates/`);

    const useSchemas = args.schemaIds ? schemas.filter((s) => args.schemaIds!.has(s.id)) : schemas;
    const useTypeTemplates = args.typeTemplateIds
        ? typeTemplates.filter((t) => args.typeTemplateIds!.has(t.id))
        : typeTemplates;
    const useCategories = args.categoryIds
        ? categories.filter((c) => args.categoryIds!.has(c.id))
        : categories;
    const useQueries = queries.filter((q) => {
        if (args.queryIds && !args.queryIds.has(q.id)) return false;
        if (args.categoryIds && !args.categoryIds.has(q.category)) return false;
        if (args.schemaIds && !args.schemaIds.has(q.schemaId)) return false;
        return true;
    });

    if (useSchemas.length === 0) throw new Error('No schemas selected.');
    if (useTypeTemplates.length === 0) throw new Error('No type templates selected.');
    if (useQueries.length === 0) throw new Error('No queries selected.');

    console.log(
        `Benchmark: type-templates  (model=${model.id}, fieldTemplate=${fieldTemplate.id}, strategy=pure-knn inline)`,
    );
    console.log(
        `Running ${useTypeTemplates.length} type templates × ${useQueries.length} queries × ${useSchemas.length} schemas`,
    );
    console.log(`Type templates: ${useTypeTemplates.map((t) => t.id).join(', ')}`);
    console.log(`Categories: ${useCategories.map((c) => c.id).join(', ')}\n`);

    const report = await runTypeTemplatesBenchmark({
        schemas: useSchemas,
        categories: useCategories,
        typeTemplates: useTypeTemplates,
        queries: useQueries,
        model,
        fieldTemplate,
        timestampIso: new Date().toISOString(),
        onProgress: (m) => console.log(m),
        ...(args.concurrency !== null ? { concurrency: args.concurrency } : {}),
        ...(args.noCache ? { noCache: true } : {}),
    });

    const here = fileURLToPath(new URL('.', import.meta.url));
    const outDir = join(here, '..', '..', 'runs', 'current', 'type-templates');
    const { jsonPath, mdPath } = await writeTypeTemplatesReport(report, outDir);

    console.log(`\nWrote:`);
    console.log(`  ${jsonPath}`);
    console.log(`  ${mdPath}`);

    console.log('');
    console.log('Headline (sorted by TYPE recall@50):');
    console.log(
        '  type template                  T recall@20  T recall@50  T recall@100  T rank p50  T rank p95  F recall@50',
    );
    console.log('  ' + '-'.repeat(120));
    for (const s of [...report.summary].sort(
        (a, b) => (b.typeRecallAtK[50] ?? 0) - (a.typeRecallAtK[50] ?? 0),
    )) {
        const pctStr = (v: number): string => (v * 100).toFixed(1) + '%';
        console.log(
            '  ' +
                s.typeTemplateId.padEnd(30) +
                pctStr(s.typeRecallAtK[20] ?? 0).padStart(12) +
                pctStr(s.typeRecallAtK[50] ?? 0).padStart(13) +
                pctStr(s.typeRecallAtK[100] ?? 0).padStart(14) +
                s.typeRankStats.p50.toFixed(0).padStart(12) +
                s.typeRankStats.p95.toFixed(0).padStart(12) +
                pctStr(s.fieldRecallAtK[50] ?? 0).padStart(13),
        );
    }
}

main().catch((e) => {
    console.error(e instanceof Error ? e.stack : String(e));
    process.exit(1);
});
