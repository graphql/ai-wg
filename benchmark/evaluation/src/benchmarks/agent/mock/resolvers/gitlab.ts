/**
 * Self-contained natural GraphQL server for the "gitlab" schema.
 *
 * Architecture: ONE plain JS object per logical entity, with DIRECT references between
 * related entities (no FK strings, no store lookups). Path-independence is free because
 * mergeRequest(id:"gid://gitlab/MergeRequest/1") and the same record inside a project's
 * mergeRequests connection are the IDENTICAL JS object.
 *
 * Connection fields get a resolver (source,args)=>conn(source.<field>,args).
 * Root Query fields always get a resolver.
 * Scalar/single-object/plain-list fields: value on the entity, served by the default resolver.
 *
 * DATE ANCHOR: all relative dates use REFERENCE_TODAY = 2025-06-01.
 */
import { stableHash } from '../seed.ts';
import type { ResolverMap } from '../types.ts';

// ---------------------------------------------------------------------------
// Local connection helper
// ---------------------------------------------------------------------------
interface ConnArgs {
    first?: number;
    last?: number;
}

function conn(nodes: any[], args: ConnArgs = {}) {
    const total = nodes.length;
    let slice: any[];
    if (args.last != null) {
        slice = nodes.slice(Math.max(0, total - args.last));
    } else {
        const limit = args.first ?? total;
        slice = nodes.slice(0, limit);
    }
    const edges = slice.map((n: any, i: number) => ({ node: n, cursor: String(i) }));
    return {
        nodes: slice,
        edges,
        totalCount: total,
        count: total,
        pageInfo: {
            hasNextPage: args.first != null && total > args.first,
            hasPreviousPage: false,
            startCursor: edges.length > 0 ? '0' : null,
            endCursor: edges.length > 0 ? String(edges.length - 1) : null,
        },
    };
}

// ---------------------------------------------------------------------------
// Seed helpers
// ---------------------------------------------------------------------------
function h(key: string) {
    return stableHash(key);
}
// All dates anchored to 2025-06-01
const REFERENCE_MS = 1748736000000; // 2025-06-01T00:00:00Z

function mkDate(key: string, offsetDays?: number): string {
    const offset = offsetDays !== undefined ? offsetDays : h(key) % 365;
    return new Date(REFERENCE_MS - offset * 86400000).toISOString();
}
function mkDateStr(key: string, offsetDays?: number): string {
    const offset = offsetDays !== undefined ? offsetDays : h(key) % 365;
    const d = new Date(REFERENCE_MS - offset * 86400000);
    return d.toISOString().slice(0, 10);
}
function futureDate(key: string, offsetDays?: number): string {
    const offset = offsetDays !== undefined ? offsetDays : h(key) % 60;
    return new Date(REFERENCE_MS + offset * 86400000).toISOString();
}

// ---------------------------------------------------------------------------
// Deterministic realistic-value generators
// ---------------------------------------------------------------------------
// Pick a deterministic element from a pool by seed key.
function pick<T>(key: string, pool: T[]): T {
    return pool[h(key) % pool.length]!;
}
// Lowercase hex token of `len` chars derived deterministically from the key.
function hexToken(key: string, len: number): string {
    let out = '';
    let n = h(key);
    while (out.length < len) {
        out += (n % 16).toString(16);
        n = h(out + key);
    }
    return out.slice(0, len);
}

const SCOPE_WORDS = [
    'auth',
    'pipeline',
    'api',
    'cache',
    'database',
    'webhook',
    'scheduler',
    'parser',
    'serializer',
    'registry',
    'gateway',
    'worker',
    'indexer',
    'notification',
    'billing',
];
const ACTION_WORDS = [
    'fix',
    'add',
    'refactor',
    'improve',
    'optimize',
    'update',
    'remove',
    'harden',
    'migrate',
    'document',
];
const SUBJECT_WORDS = [
    'token expiry handling',
    'retry logic',
    'memory usage',
    'error reporting',
    'request validation',
    'connection pooling',
    'rate limiting',
    'logging output',
    'config loading',
    'schema validation',
    'race condition',
    'pagination',
    'permission checks',
    'timeout defaults',
];

function realTitle(key: string): string {
    const action = pick(`${key}act`, ACTION_WORDS);
    const subject = pick(`${key}subj`, SUBJECT_WORDS);
    const cap = action.charAt(0).toUpperCase() + action.slice(1);
    return `${cap} ${subject}`;
}
function realDescription(key: string): string {
    const scope = pick(`${key}scope`, SCOPE_WORDS);
    const subject = pick(`${key}dsub`, SUBJECT_WORDS);
    return `Addresses ${subject} in the ${scope} module to keep behavior consistent under load.`;
}
function realIid(key: string): string {
    return String(100 + (h(key) % 8900));
}
function realSha(key: string): string {
    return hexToken(`${key}sha`, 40);
}

// ---------------------------------------------------------------------------
// USERS (UserCore)
// ---------------------------------------------------------------------------
function mkUser(id: string, username: string, name: string) {
    return {
        __typename: 'UserCore',
        id,
        _seed: h(`UserCore#${id}`),
        username,
        name,
        authoredMergeRequests: { count: h(`${id}amr`) % 1000 } as any,
    };
}

const userAlice = mkUser('gid://gitlab/User/1', 'alice', 'Alice Johnson');
const userBob = mkUser('gid://gitlab/User/2', 'bob', 'Bob Smith');
const userCarol = mkUser('gid://gitlab/User/3', 'carol', 'Carol White');
const userDavid = mkUser('gid://gitlab/User/4', 'david', 'David Lee');
const userEva = mkUser('gid://gitlab/User/5', 'eva', 'Eva Martinez');
// Pool users for group members
const groupUsers = [
    mkUser('gid://gitlab/User/10', 'hrodriguez', 'Grace Lee'),
    mkUser('gid://gitlab/User/11', 'glee', 'Frank Wilson'),
    mkUser('gid://gitlab/User/12', 'jtaylor', 'Henry Rodriguez'),
    mkUser('gid://gitlab/User/13', 'ianderson', 'Jack Taylor'),
    mkUser('gid://gitlab/User/14', 'ejohnson', 'Emma Johnson'),
];
// Patch specific authored MR counts per glab-023
groupUsers[0]!.authoredMergeRequests = { count: 394 };
groupUsers[1]!.authoredMergeRequests = { count: 704 };
groupUsers[2]!.authoredMergeRequests = { count: 258 };
groupUsers[3]!.authoredMergeRequests = { count: 137 };
groupUsers[4]!.authoredMergeRequests = { count: 512 };

// gitlab-org group members
const gitlabOrgUsers = [
    mkUser('gid://gitlab/User/20', 'git-alice', 'Alice GL'),
    mkUser('gid://gitlab/User/21', 'git-bob', 'Bob GL'),
    mkUser('gid://gitlab/User/22', 'git-carol', 'Carol GL'),
    mkUser('gid://gitlab/User/23', 'git-david', 'David GL'),
    mkUser('gid://gitlab/User/24', 'git-eva', 'Eva GL'),
];

// ---------------------------------------------------------------------------
// ACCESS LEVELS
// ---------------------------------------------------------------------------
const accessLevels = [
    {
        __typename: 'AccessLevel',
        _seed: h('AccessLevel#0'),
        integerValue: 10,
        stringValue: 'GUEST',
    },
    {
        __typename: 'AccessLevel',
        _seed: h('AccessLevel#1'),
        integerValue: 20,
        stringValue: 'REPORTER',
    },
    {
        __typename: 'AccessLevel',
        _seed: h('AccessLevel#2'),
        integerValue: 30,
        stringValue: 'DEVELOPER',
    },
    {
        __typename: 'AccessLevel',
        _seed: h('AccessLevel#3'),
        integerValue: 40,
        stringValue: 'MAINTAINER',
    },
    {
        __typename: 'AccessLevel',
        _seed: h('AccessLevel#4'),
        integerValue: 50,
        stringValue: 'OWNER',
    },
];

// ---------------------------------------------------------------------------
// PIPELINES
// ---------------------------------------------------------------------------
function mkPipeline(id: string, opts: Record<string, any> = {}) {
    const createdAt = opts.createdAt ?? mkDate(`${id}ca`, h(`${id}ca`) % 30);
    return {
        __typename: 'Pipeline',
        id,
        _seed: h(`Pipeline#${id}`),
        iid: String(h(`Pipeline#${id}`) % 1000),
        status: opts.status ?? 'SUCCESS',
        duration: opts.duration ?? 100 + (h(`${id}dur`) % 900),
        coverage: opts.coverage ?? (h(`${id}cov`) % 10000) / 100,
        ref: opts.ref ?? 'main',
        source: opts.source ?? 'push',
        createdAt,
        updatedAt: opts.updatedAt ?? createdAt,
        finishedAt: opts.finishedAt ?? mkDate(`${id}fa`, h(`${id}fa`) % 25),
        webUrl:
            opts.webUrl ??
            `https://gitlab.example.com/group/project/-/pipelines/${h(`Pipeline#${id}`) % 1000}`,
        jobs: opts.jobs ?? ([] as any[]),
        stages: opts.stages ?? ([] as any[]),
        securityReportSummary: opts.securityReportSummary ?? null,
        securityReportFindings: opts.securityReportFindings ?? ([] as any[]),
    };
}

// Literal-id pipelines used by specific queries
const pipelineForMR1 = mkPipeline('gid://gitlab/Pipeline/1001', {
    status: 'FAILED',
    duration: 501,
});
const pipelineForMR1234 = mkPipeline('gid://gitlab/Pipeline/1234', { status: 'SUCCESS' });

// Pipeline pool for group/project (MR pipelines included)
const pipelineMain1 = mkPipeline('gid://gitlab/Pipeline/2001', {
    status: 'SUCCESS',
    ref: 'main',
    createdAt: mkDate('pl2001ca', 3),
});
const pipelineMain2 = mkPipeline('gid://gitlab/Pipeline/2002', {
    status: 'FAILED',
    ref: 'main',
    createdAt: mkDate('pl2002ca', 5),
});
const pipelineMain3 = mkPipeline('gid://gitlab/Pipeline/2003', {
    status: 'SUCCESS',
    ref: 'main',
    createdAt: mkDate('pl2003ca', 10),
});
const pipelineMain4 = mkPipeline('gid://gitlab/Pipeline/2004', {
    status: 'RUNNING',
    ref: 'feature/x',
    createdAt: mkDate('pl2004ca', 1),
});
const pipelineMain5 = mkPipeline('gid://gitlab/Pipeline/2005', {
    status: 'SUCCESS',
    ref: 'main',
    createdAt: mkDate('pl2005ca', 7),
});

// Latest pipeline for group/project (used by Project.pipeline singular)
const latestPipeline = mkPipeline('gid://gitlab/Pipeline/9999', { status: 'SUCCESS', ref: 'main' });

// gitlab-org/gitlab pipeline pool
const gitlabOrgPipeline1 = mkPipeline('gid://gitlab/Pipeline/3001', {
    status: 'SUCCESS',
    ref: 'main',
    createdAt: mkDate('gl3001ca', 2),
});
const gitlabOrgPipeline2 = mkPipeline('gid://gitlab/Pipeline/3002', {
    status: 'FAILED',
    ref: 'main',
    createdAt: mkDate('gl3002ca', 15),
});

// CiJobs for pipelines
function mkJob(id: string, opts: Record<string, any> = {}) {
    return {
        __typename: 'CiJob',
        id,
        _seed: h(`CiJob#${id}`),
        name:
            opts.name ??
            `${pick(`${id}jobstage`, ['build', 'test', 'lint', 'deploy', 'scan', 'package'])}-${pick(`${id}jobtgt`, ['unit', 'integration', 'frontend', 'backend', 'docker', 'staging', 'production'])}`,
        status: opts.status ?? 'SUCCESS',
        failureMessage: opts.failureMessage ?? null,
        duration: opts.duration ?? 100 + (h(`${id}dur`) % 900),
        artifacts: opts.artifacts ?? ([] as any[]),
    };
}
const job1 = mkJob('gid://gitlab/CiJob/1', {
    status: 'FAILED',
    failureMessage: 'exit code 1',
    name: 'test-unit',
});
const job2 = mkJob('gid://gitlab/CiJob/2', {
    status: 'FAILED',
    failureMessage: 'timeout',
    name: 'test-integration',
});
const job3 = mkJob('gid://gitlab/CiJob/3', { status: 'SUCCESS', name: 'build' });

// Artifacts
function mkArtifact(id: string, opts: Record<string, any> = {}) {
    return {
        __typename: 'CiJobArtifact',
        id,
        _seed: h(`CiJobArtifact#${id}`),
        name: opts.name ?? `artifact-${id}`,
        fileType: opts.fileType ?? 'ARCHIVE',
        size: opts.size ?? 1024,
    };
}
job3.artifacts = [
    mkArtifact('art-1', { fileType: 'ARCHIVE' }),
    mkArtifact('art-2', { fileType: 'CODEQUALITY' }),
];

// CiStages for pipelines
function mkStage(id: string, name: string, jobs: any[]) {
    return { __typename: 'CiStage', id, _seed: h(`CiStage#${id}`), name, jobs };
}
const stage1 = mkStage('stage-1', 'build', [job3]);
const stage2 = mkStage('stage-2', 'test', [job1, job2]);
const stage3 = mkStage('stage-3', 'deploy', []);

pipelineMain1.stages = [stage1, stage2, stage3];
pipelineMain1.jobs = [job3, job1, job2];
pipelineForMR1.jobs = [job1, job2];
latestPipeline.stages = [stage1, stage2];
latestPipeline.jobs = [job1, job2, job3];

// Security report summary
const scanForSAST = {
    __typename: 'Scan',
    id: 'scan-1',
    _seed: h('Scan#scan-1'),
    name: 'SAST Code Scan',
    status: 'JOB_FAILED',
};
const sastSection = {
    __typename: 'SecurityReportSummarySection',
    _seed: h('SecurityReportSummarySection#1'),
    vulnerabilitiesCount: 395,
    scans: [scanForSAST],
};
const secReportSummary = {
    __typename: 'SecurityReportSummary',
    _seed: h('SecurityReportSummary#1'),
    sast: sastSection,
};
pipelineMain1.securityReportSummary = secReportSummary;
latestPipeline.securityReportSummary = secReportSummary;

// Security report findings for latestPipeline
function mkFinding(id: string, opts: Record<string, any> = {}) {
    return {
        __typename: 'PipelineSecurityReportFinding',
        id,
        _seed: h(`Finding#${id}`),
        title:
            opts.title ??
            pick(`${id}findtitle`, [
                'Use of weak cryptographic hash',
                'Hardcoded credentials detected',
                'Improper input validation',
                'Insecure deserialization',
                'Missing authorization check',
                'Vulnerable dependency version',
            ]),
        reportType: opts.reportType ?? 'SARIF',
        description: opts.description ?? realDescription(`${id}finddesc`),
    };
}
latestPipeline.securityReportFindings = [
    mkFinding('f1', {
        reportType: 'SARIF',
        title: 'Reflected XSS via unsanitized query parameter',
        description:
            'User-supplied input from the search query parameter is reflected in the response without proper encoding, enabling reflected cross-site scripting attacks.',
    }),
    mkFinding('f2', {
        reportType: 'DEPENDENCY_SCANNING',
        title: 'Prototype pollution in lodash merge utility',
        description:
            'The lodash merge function is vulnerable to prototype pollution, allowing an attacker to inject properties into Object.prototype via crafted input.',
    }),
];

// ---------------------------------------------------------------------------
// ISSUES
// ---------------------------------------------------------------------------
function mkIssue(id: string, opts: Record<string, any> = {}) {
    const seed = h(`Issue#${id}`);
    const iid = opts.iid ?? realIid(`${id}iid`);
    return {
        __typename: 'Issue',
        id,
        _seed: seed,
        iid,
        title: opts.title ?? realTitle(`${id}title`),
        state: opts.state ?? 'opened',
        dueDate: opts.dueDate ?? null,
        confidential: opts.confidential ?? false,
        projectId: opts.projectId ?? 100, // integer DB id of the project
        webPath: opts.webPath ?? `/group/project/-/issues/${iid}`,
        webUrl: opts.webUrl ?? `https://gitlab.example.com/group/project/-/issues/${iid}`,
        createdAt: opts.createdAt ?? mkDate(`${id}ca`, h(`${id}ca`) % 60),
        upvotes: opts.upvotes ?? h(`${id}upvotes`) % 100,
        labels: opts.labels ?? ([] as any[]),
        blockedByIssues: opts.blockedByIssues ?? ([] as any[]),
    };
}

// gid://gitlab/Issue/1 (glab-008)
const issue1 = mkIssue('gid://gitlab/Issue/1', {
    iid: '1',
    title: 'Fix authentication timeout on expired tokens',
    state: 'opened',
});

// Issues for group/project due in week 2025-06-01..2025-06-07 (glab-082)
const issueDue1 = mkIssue('gid://gitlab/Issue/101', {
    iid: '2766',
    title: 'Add support for SAML 2.0 single sign-on',
    state: 'closed',
    dueDate: '2025-06-03',
});
const issueDue2 = mkIssue('gid://gitlab/Issue/102', {
    iid: '167',
    title: 'Implement dark mode UI theme',
    state: 'locked',
    dueDate: '2025-06-05',
});

// Issues with createdAfter 2025-06-01 for group issues sort (glab-080)
function mkGroupIssue(id: string, iid: string, title: string, upvotes: number) {
    return mkIssue(id, { iid, title, state: 'opened', upvotes });
}
const groupIssue1 = mkGroupIssue(
    'gid://gitlab/Issue/201',
    '7841',
    'Add export to CSV functionality',
    45,
);
const groupIssue2 = mkGroupIssue(
    'gid://gitlab/Issue/202',
    '3392',
    'Optimize database query performance',
    38,
);
const groupIssue3 = mkGroupIssue(
    'gid://gitlab/Issue/203',
    '5504',
    'Refactor legacy authentication module',
    12,
);

// Issues for gitlab-org/gitlab
const gitlabIssue1 = mkIssue('gid://gitlab/Issue/301', {
    iid: '101',
    title: 'Improve CI performance',
    state: 'opened',
});
const gitlabIssue2 = mkIssue('gid://gitlab/Issue/302', {
    iid: '102',
    title: 'Fix merge conflict detection',
    state: 'opened',
});
gitlabIssue1.blockedByIssues = [gitlabIssue2];

// project group/project issues pool
const projectIssuePool = [issue1, issueDue1, issueDue2, groupIssue1, groupIssue2, groupIssue3];

// Labels
function mkLabel(id: string, title: string, color: string) {
    return { __typename: 'Label', id, _seed: h(`Label#${id}`), title, color };
}
const labelBug = mkLabel('gid://gitlab/Label/1', 'bug', '#e74c3c');
const labelFeature = mkLabel('gid://gitlab/Label/2', 'feature', '#3498db');
issue1.labels = [labelBug];

// ---------------------------------------------------------------------------
// VULNERABILITIES
// ---------------------------------------------------------------------------
function mkVuln(id: string, opts: Record<string, any> = {}) {
    const seed = h(`Vulnerability#${id}`);
    const title =
        opts.title ??
        pick(`${id}vtitle`, [
            'SQL injection in query builder',
            'Cross-site scripting in template rendering',
            'Insecure direct object reference',
            'Server-side request forgery in webhook handler',
            'Path traversal in file upload',
            'Insecure random number generation',
            'Missing rate limiting on login endpoint',
        ]);
    return {
        __typename: 'Vulnerability',
        id,
        _seed: seed,
        title,
        name: opts.name ?? title,
        uuid:
            opts.uuid ??
            `${seed.toString(16).padStart(8, '0')}-${(seed >> 8).toString(16).padStart(4, '0')}-4${(seed >> 16).toString(16).padStart(3, '0')}-a${(seed >> 20).toString(16).padStart(3, '0')}-${(seed * 7919).toString(16).padStart(12, '0')}`.slice(
                0,
                36,
            ),
        severity: opts.severity ?? 'MEDIUM',
        state: opts.state ?? 'DETECTED',
        reportType: opts.reportType ?? 'DEPENDENCY_SCANNING',
        dismissalReason: opts.dismissalReason ?? null,
        hasRemediations: opts.hasRemediations ?? false,
        webUrl:
            opts.webUrl ??
            `https://gitlab.example.com/group/project/-/security/vulnerabilities/${seed % 10000}`,
        aiResolutionAvailable: opts.aiResolutionAvailable ?? false,
        aiResolutionEnabled: opts.aiResolutionEnabled ?? false,
        identifiers: opts.identifiers ?? [
            {
                __typename: 'VulnerabilityIdentifier',
                externalType: 'cve',
                name: `CVE-${h(`${id}cve`) % 10000}`,
            },
        ],
        issueLinks: opts.issueLinks ?? ([] as any[]),
    };
}

// For group/project vulnerabilities — 5 total (glab-053,055,059,065 etc.)
// glab-059: nodes 3 and 4 have hasRemediations=true (indices 2,3)
// glab-055: confirmed vuln pool: CRITICAL(4700), UNKNOWN(1400), UNKNOWN(3900), LOW(1489), HIGH(6933)
// glab-053: CRITICAL + (DETECTED or CONFIRMED)
const vuln1 = mkVuln('gid://gitlab/Vulnerability/1', {
    title: 'Weak password hashing algorithm detected',
    severity: 'CRITICAL',
    state: 'CONFIRMED',
    reportType: 'DEPENDENCY_SCANNING',
    hasRemediations: false,
    dismissalReason: null,
});
const vuln2 = mkVuln('gid://gitlab/Vulnerability/2', {
    title: 'SQL Injection in user input validation',
    severity: 'UNKNOWN',
    state: 'CONFIRMED',
    reportType: 'CONTAINER_SCANNING',
    hasRemediations: false,
    dismissalReason: null,
});
const vuln3 = mkVuln('gid://gitlab/Vulnerability/3', {
    title: 'Missing authentication on admin endpoints',
    severity: 'UNKNOWN',
    state: 'CONFIRMED',
    reportType: 'SARIF',
    hasRemediations: true,
    dismissalReason: null,
    identifiers: [{ __typename: 'VulnerabilityIdentifier', externalType: 'cwe', name: 'CWE-79' }],
});
const vuln4 = mkVuln('gid://gitlab/Vulnerability/4', {
    title: 'Cross-Site Scripting vulnerability in comments',
    severity: 'LOW',
    state: 'DETECTED',
    reportType: 'GENERIC',
    hasRemediations: true,
    dismissalReason: null,
});
const vuln5 = mkVuln('gid://gitlab/Vulnerability/5', {
    title: 'Hardcoded API credentials in source code',
    severity: 'HIGH',
    state: 'DETECTED',
    reportType: 'CONTAINER_SCANNING_FOR_REGISTRY',
    hasRemediations: false,
    dismissalReason: null,
});
// Dismissed vulns (glab-065)
const vuln6 = mkVuln('gid://gitlab/Vulnerability/6', {
    title: 'Unvalidated redirect in OAuth flow',
    severity: 'MEDIUM',
    state: 'DISMISSED',
    reportType: 'DEPENDENCY_SCANNING',
    dismissalReason: 'ACCEPTABLE_RISK',
});
const vuln7 = mkVuln('gid://gitlab/Vulnerability/7', {
    title: 'Insecure deserialization in API endpoint',
    severity: 'LOW',
    state: 'DISMISSED',
    reportType: 'SARIF',
    dismissalReason: 'USED_IN_TESTS',
});

// VulnerabilityIssueLinks (glab-067)
vuln1.issueLinks = [
    { __typename: 'VulnerabilityIssueLink', linkType: 'CREATED', issue: issue1 },
    { __typename: 'VulnerabilityIssueLink', linkType: 'RELATED', issue: issueDue1 },
];

const projectVulns = [vuln1, vuln2, vuln3, vuln4, vuln5, vuln6, vuln7];
const dismissedVulns = [vuln6, vuln7];
const confirmedVulns = [vuln1, vuln2, vuln3, vuln4, vuln5];

// Group-level vulnerabilities (glab-066)
const groupVulns = [
    mkVuln('gid://gitlab/Vulnerability/101', {
        title: 'Group vuln 1',
        severity: 'HIGH',
        identifiers: [
            { __typename: 'VulnerabilityIdentifier', externalType: 'cve', name: 'CVE-2024-001' },
        ],
    }),
    mkVuln('gid://gitlab/Vulnerability/102', {
        title: 'Group vuln 2',
        severity: 'CRITICAL',
        identifiers: [
            { __typename: 'VulnerabilityIdentifier', externalType: 'cwe', name: 'CWE-89' },
        ],
    }),
];

// ---------------------------------------------------------------------------
// MERGE REQUESTS
// ---------------------------------------------------------------------------
function mkMR(id: string, opts: Record<string, any> = {}) {
    const seed = h(`MergeRequest#${id}`);
    const iid = opts.iid ?? realIid(`${id}iid`);
    const mrTitle = opts.title ?? realTitle(`${id}title`);
    return {
        __typename: 'MergeRequest',
        id,
        _seed: seed,
        iid,
        title: mrTitle,
        state: opts.state ?? 'opened',
        createdAt: opts.createdAt ?? mkDate(`${id}ca`, h(`${id}ca`) % 90),
        mergedAt: opts.mergedAt ?? null,
        approved: opts.approved ?? false,
        approvalsLeft: opts.approvalsLeft ?? 0,
        approvalsRequired: opts.approvalsRequired ?? 1,
        webPath: opts.webPath ?? `/group/project/-/merge_requests/${iid}`,
        webUrl: opts.webUrl ?? `https://gitlab.example.com/group/project/-/merge_requests/${iid}`,
        project: opts.project ?? null, // patched after projectMain is defined
        diffHeadSha: opts.diffHeadSha ?? realSha(`${id}sha`),
        defaultSquashCommitMessage: opts.defaultSquashCommitMessage ?? `${mrTitle} (!${iid})`,
        resolvableDiscussionsCount: opts.resolvableDiscussionsCount ?? h(`${id}rdc`) % 10,
        resolvedDiscussionsCount: opts.resolvedDiscussionsCount ?? h(`${id}rdct`) % 5,
        conflicts: opts.conflicts ?? false,
        headPipeline: opts.headPipeline ?? null,
        // approvalState is non-nullable in the SDL; provide a minimal default
        approvalState: opts.approvalState ?? {
            __typename: 'MergeRequestApprovalState',
            _seed: h(`MergeRequestApprovalState#${id}`),
            rules: [],
            invalidApproversRules: [],
        },
        discussions: opts.discussions ?? ([] as any[]),
        reviewers: opts.reviewers ?? ([] as any[]),
        changeRequesters: opts.changeRequesters ?? ([] as any[]),
        commenters: opts.commenters ?? ([] as any[]),
        notes: opts.notes ?? ([] as any[]),
        diffStats: opts.diffStats ?? ([] as any[]),
    };
}

// ---- Literal id MRs ----
// gid://gitlab/MergeRequest/1 — used in glab-003, 005, 006, 010, 014, 032
const mr1 = mkMR('gid://gitlab/MergeRequest/1', {
    iid: '1',
    title: 'Fix critical auth bug',
    state: 'opened',
    approved: true,
    approvalsLeft: 917,
    conflicts: false,
    headPipeline: pipelineForMR1,
});
mr1.approvalState = {
    __typename: 'MergeRequestApprovalState',
    _seed: h('MergeRequestApprovalState#mr1'),
    rules: [
        {
            __typename: 'ApprovalRule',
            _seed: h('ApprovalRule#1'),
            name: 'Lead Developer Sign-off',
            approved: true,
            approvalsRequired: 835,
            type: 'REPORT_APPROVER',
            scanResultPolicies: [],
        },
        {
            __typename: 'ApprovalRule',
            _seed: h('ApprovalRule#2'),
            name: 'QA Verification',
            approved: true,
            approvalsRequired: 919,
            type: 'REPORT_APPROVER',
            scanResultPolicies: [],
        },
    ],
};

// Discussions for MR/1 (glab-005 expects 3 unresolved: indices 0,2,4 of 5)
function mkDiscussion(id: string, resolved: boolean, resolvable: boolean) {
    return { __typename: 'Discussion', id, _seed: h(`Discussion#${id}`), resolved, resolvable };
}
mr1.discussions = [
    mkDiscussion('gid://gitlab/MergeRequest/1/Discussion/0', false, true),
    mkDiscussion('gid://gitlab/MergeRequest/1/Discussion/1', true, true),
    mkDiscussion('gid://gitlab/MergeRequest/1/Discussion/2', false, true),
    mkDiscussion('gid://gitlab/MergeRequest/1/Discussion/3', true, true),
    mkDiscussion('gid://gitlab/MergeRequest/1/Discussion/4', false, true),
];

// Reviewer with highest count (glab-018)
const topReviewer = {
    __typename: 'MergeRequestReviewer',
    _seed: h('MergeRequestReviewer#top'),
    username: 'bmartinez',
    name: 'Diana Patel',
    reviewRequestedMergeRequests: { count: 897 },
};

// Notes for MR/1 (glab-032)
function mkNote(id: string, authorUser: any, body: string) {
    return {
        __typename: 'Note',
        id,
        _seed: h(`Note#${id}`),
        author: authorUser,
        body,
        createdAt: mkDate(`${id}ca`, h(`${id}ca`) % 30),
    };
}
mr1.notes = [
    mkNote('gid://gitlab/Note/1', userAlice, 'Please review the changes.'),
    mkNote('gid://gitlab/Note/2', userBob, 'Looks good to me.'),
];
mr1.commenters = [userAlice, userBob];
mr1.reviewers = [topReviewer];

// DiffStats for MR/1234 (glab-013)
function mkDiffStats(path: string, additions: number, deletions: number) {
    return { __typename: 'DiffStats', _seed: h(`DiffStats#${path}`), path, additions, deletions };
}

// gid://gitlab/MergeRequest/1234 — used in glab-013
const mr1234 = mkMR('gid://gitlab/MergeRequest/1234', {
    iid: '1234',
    title: 'Feature: add dashboard',
    state: 'opened',
    diffHeadSha: 'a7f3e8c9d2b4f6e1a5c7d9b2e4f6a8c0d2e4f6a',
    diffStats: [
        mkDiffStats('packages/shared/utils/helpers.ts', 598, 936),
        mkDiffStats('src/api/controllers/UserController.ts', 300, 10),
    ],
});

const mrById = new Map<string, any>([
    ['gid://gitlab/MergeRequest/1', mr1],
    ['gid://gitlab/MergeRequest/1234', mr1234],
]);

// ---- Pool MRs for group/project (the recurring 5) ----
// iids: 5794,108,7645,4774,2623
const poolMR0 = mkMR('gid://gitlab/MergeRequest/2001', {
    iid: '5794',
    title: 'docs: update API documentation',
    state: 'opened',
    approved: true,
    conflicts: true,
    defaultSquashCommitMessage: 'docs: update API documentation (#5794)',
    headPipeline: pipelineMain1,
    reviewers: [topReviewer],
    changeRequesters: [
        {
            __typename: 'UserCore',
            _seed: h('UserCore#cr1'),
            id: 'gid://gitlab/User/30',
            username: 'fwilson',
            name: 'Iris Anderson',
        },
    ],
});
const poolMR1 = mkMR('gid://gitlab/MergeRequest/2002', {
    iid: '108',
    title: 'perf: reduce memory footprint of serializer',
    state: 'opened',
    approved: true,
    conflicts: true,
    defaultSquashCommitMessage: 'perf: reduce memory footprint of serializer (#108)',
    headPipeline: pipelineMain2,
    reviewers: [
        {
            __typename: 'MergeRequestReviewer',
            _seed: h('MergeRequestReviewer#r2'),
            username: 'achen',
            name: 'Bob Martinez',
            reviewRequestedMergeRequests: { count: 234 },
        },
    ],
});
const poolMR2 = mkMR('gid://gitlab/MergeRequest/2003', {
    iid: '7645',
    title: 'refactor: consolidate validation logic',
    state: 'opened',
    approved: false,
    conflicts: false,
    defaultSquashCommitMessage: 'refactor: consolidate validation logic (#7645)',
    headPipeline: pipelineMain3,
    reviewers: [],
});
const poolMR3 = mkMR('gid://gitlab/MergeRequest/2004', {
    iid: '4774',
    title: 'feat: add webhook retry mechanism',
    state: 'opened',
    approved: true,
    conflicts: true,
    defaultSquashCommitMessage: 'feat: add webhook retry mechanism (#4774)',
    headPipeline: pipelineMain4,
    reviewers: [
        {
            __typename: 'MergeRequestReviewer',
            _seed: h('MergeRequestReviewer#r3'),
            username: 'dpatel',
            name: 'Alice Chen',
            reviewRequestedMergeRequests: { count: 562 },
        },
    ],
});
const poolMR4 = mkMR('gid://gitlab/MergeRequest/2005', {
    iid: '2623',
    title: 'fix: resolve race condition in cache layer',
    state: 'opened',
    approved: false,
    conflicts: false,
    defaultSquashCommitMessage: 'fix: resolve race condition in cache layer (#2623)',
    headPipeline: pipelineMain5,
    reviewers: [
        {
            __typename: 'MergeRequestReviewer',
            _seed: h('MergeRequestReviewer#r4'),
            username: 'cthompson',
            name: 'Carol Thompson',
            reviewRequestedMergeRequests: { count: 108 },
        },
    ],
});

// Add discussions to pool MRs for glab-029
for (const mr of [poolMR0, poolMR1, poolMR2, poolMR3, poolMR4]) {
    const seed = h(`Disc#${mr.id}`);
    mr.discussions = [
        {
            __typename: 'Discussion',
            id: `${mr.id}/D/0`,
            _seed: seed,
            resolved: false,
            resolvable: true,
        },
        {
            __typename: 'Discussion',
            id: `${mr.id}/D/1`,
            _seed: h(`${mr.id}/D/1`),
            resolved: true,
            resolvable: true,
        },
    ];
}

const poolMRs = [poolMR0, poolMR1, poolMR2, poolMR3, poolMR4];
// All opened MRs
const openedMRs = poolMRs;
// Authored MRs merged last month (glab-015): state=merged
const mergedMRs = poolMRs.map((m) => ({
    ...m,
    state: 'merged',
    mergedAt: mkDate(`${m.id}mergedAt`, 15),
}));

// Current user's assigned MRs (opened): use pool
const currentUserAssignedMRs = poolMRs;
// Current user's review requested MRs
const currentUserReviewMRs = [poolMR0, poolMR2];
// Current user's authored MRs (merged)
const currentUserAuthoredMergedMRs = mergedMRs;

// ---------------------------------------------------------------------------
// MILESTONES
// ---------------------------------------------------------------------------
function mkMilestone(id: string, opts: Record<string, any> = {}) {
    return {
        __typename: 'Milestone',
        id,
        _seed: h(`Milestone#${id}`),
        title:
            opts.title ??
            `${pick(`${id}msq`, ['v1.5', 'v2.0', 'v2.1', 'v3.0', 'Q2', 'Q3', 'Q4'])} ${pick(`${id}msn`, ['Release', 'Milestone', 'Planning', 'Hardening', 'Stabilization'])}`,
        startDate: opts.startDate ?? mkDateStr(`${id}sd`, h(`${id}sd`) % 60),
        dueDate: opts.dueDate ?? mkDateStr(`${id}dd`, h(`${id}dd`) % 30),
        stats: opts.stats ?? {
            __typename: 'MilestoneStats',
            totalIssuesCount: h(`${id}tic`) % 1000,
            closedIssuesCount: h(`${id}cic`) % 500,
        },
    };
}

// gid://gitlab/Milestone/1 (glab-072)
const milestone1 = mkMilestone('gid://gitlab/Milestone/1', {
    title: 'v2.0 Release Candidate',
    stats: { __typename: 'MilestoneStats', totalIssuesCount: 842, closedIssuesCount: 540 },
});

// Group milestones (glab-086)
const groupMilestone1 = mkMilestone('gid://gitlab/Milestone/101', {
    title: 'Security Hardening Sprint',
    startDate: '2026-06-01',
    dueDate: '2026-10-30',
});
const groupMilestone2 = mkMilestone('gid://gitlab/Milestone/102', {
    title: 'Q3 Performance Improvements',
    startDate: '2026-07-20',
    dueDate: '2026-09-15',
});

// ---------------------------------------------------------------------------
// ITERATIONS
// ---------------------------------------------------------------------------
function mkIteration(id: string, opts: Record<string, any> = {}) {
    const seed = h(`Iteration#${id}`);
    return {
        __typename: 'Iteration',
        id,
        _seed: seed,
        iid: opts.iid ?? String(seed % 10000),
        title: opts.title ?? `Sprint ${1 + (h(`${id}title`) % 40)}`,
        state: opts.state ?? 'opened',
        startDate: opts.startDate ?? mkDateStr(`${id}sd`, 30),
        dueDate: opts.dueDate ?? mkDateStr(`${id}dd`, 10),
        webPath: opts.webPath ?? `/group/project/-/iterations/${seed % 10000}`,
        webUrl:
            opts.webUrl ?? `https://gitlab.example.com/group/project/-/iterations/${seed % 10000}`,
        report: opts.report ?? null,
    };
}

// gid://gitlab/Iteration/1 (glab-085)
const iteration1 = mkIteration('gid://gitlab/Iteration/1', {
    title: 'Iteration 1',
    state: 'closed',
    startDate: '2025-04-01',
    dueDate: '2025-04-14',
    report: {
        __typename: 'TimeboxReport',
        _seed: h('TimeboxReport#1'),
        burnupTimeSeries: [
            {
                __typename: 'BurnupChartDailyTotals',
                _seed: h('BU#iter1#1'),
                date: '2025-04-05',
                completedCount: 144,
                completedWeight: 260,
                scopeCount: 1386,
                scopeWeight: 916,
            },
            {
                __typename: 'BurnupChartDailyTotals',
                _seed: h('BU#iter1#2'),
                date: '2025-04-10',
                completedCount: 336,
                completedWeight: 580,
                scopeCount: 1386,
                scopeWeight: 916,
            },
            {
                __typename: 'BurnupChartDailyTotals',
                _seed: h('BU#iter1#3'),
                date: '2025-04-14',
                completedCount: 480,
                completedWeight: 867,
                scopeCount: 1386,
                scopeWeight: 916,
            },
        ],
        stats: {
            __typename: 'TimeReportStats',
            _seed: h('TimeReportStats#1'),
            complete: {
                __typename: 'TimeboxMetrics',
                _seed: h('TimeboxMetrics#c1'),
                count: 480,
                weight: 867,
            },
            incomplete: {
                __typename: 'TimeboxMetrics',
                _seed: h('TimeboxMetrics#i1'),
                count: 906,
                weight: 49,
            },
            total: {
                __typename: 'TimeboxMetrics',
                _seed: h('TimeboxMetrics#t1'),
                count: 629,
                weight: 544,
            },
        },
    },
});

// Group iterations (glab-073, glab-077)
function mkIterReport(complete: number, incomp: number) {
    const total = complete + incomp;
    // Build a simple 3-day burnup series anchored to REFERENCE_TODAY
    const burnupTimeSeries = [
        {
            __typename: 'BurnupChartDailyTotals',
            _seed: h(`BU#${complete}#1`),
            date: mkDateStr('bu1', 10),
            completedCount: Math.floor(complete * 0.3),
            completedWeight: Math.floor(complete * 0.3 * 2),
            scopeCount: total,
            scopeWeight: total * 2,
        },
        {
            __typename: 'BurnupChartDailyTotals',
            _seed: h(`BU#${complete}#2`),
            date: mkDateStr('bu2', 5),
            completedCount: Math.floor(complete * 0.7),
            completedWeight: Math.floor(complete * 0.7 * 2),
            scopeCount: total,
            scopeWeight: total * 2,
        },
        {
            __typename: 'BurnupChartDailyTotals',
            _seed: h(`BU#${complete}#3`),
            date: mkDateStr('bu3', 0),
            completedCount: complete,
            completedWeight: complete * 2,
            scopeCount: total,
            scopeWeight: total * 2,
        },
    ];
    return {
        __typename: 'TimeboxReport',
        _seed: h(`TR#${complete}`),
        burnupTimeSeries,
        stats: {
            __typename: 'TimeReportStats',
            _seed: h(`TRS#${complete}`),
            complete: {
                __typename: 'TimeboxMetrics',
                _seed: h(`TM#c${complete}`),
                count: complete,
                weight: complete * 2,
            },
            incomplete: {
                __typename: 'TimeboxMetrics',
                _seed: h(`TM#i${incomp}`),
                count: incomp,
                weight: incomp * 2,
            },
            total: {
                __typename: 'TimeboxMetrics',
                _seed: h(`TM#t${complete}`),
                count: total,
                weight: total * 2,
            },
        },
    };
}
const groupIteration1 = mkIteration('gid://gitlab/Iteration/201', {
    title: 'Sprint 1',
    state: 'closed',
    startDate: '2025-03-01',
    dueDate: '2025-03-14',
    report: mkIterReport(15, 3),
});
const groupIteration2 = mkIteration('gid://gitlab/Iteration/202', {
    title: 'Sprint 2',
    state: 'opened',
    startDate: '2025-05-01',
    dueDate: '2025-05-14',
    report: mkIterReport(8, 7),
});
const groupIteration3 = mkIteration('gid://gitlab/Iteration/203', {
    title: 'Sprint 3',
    state: 'opened',
    startDate: '2025-06-01',
    dueDate: '2025-06-14',
    report: mkIterReport(2, 13),
});

// gitlab-org iterations (glab-077)
const gitlabOrgIteration1 = mkIteration('gid://gitlab/Iteration/301', {
    title: 'GitLab Sprint 1',
    state: 'closed',
    report: mkIterReport(20, 5),
});
const gitlabOrgIteration2 = mkIteration('gid://gitlab/Iteration/302', {
    title: 'GitLab Sprint 2',
    state: 'opened',
    report: mkIterReport(12, 8),
});

// Iteration cadences (glab-073)
function mkCadence(id: string, title: string, active: boolean) {
    return {
        __typename: 'IterationCadence',
        id,
        _seed: h(`IterationCadence#${id}`),
        title,
        active,
        durationInWeeks: 2,
        startDate: mkDate(`${id}sd`, 90),
        automatic: true,
        rollOver: false,
        iterationsInAdvance: 3,
    };
}
const cadence1 = mkCadence('gid://gitlab/IterationCadence/1', 'Two-week sprints', true);
const cadence2 = mkCadence('gid://gitlab/IterationCadence/2', 'Monthly cadence', false);

// ---------------------------------------------------------------------------
// EPICS
// ---------------------------------------------------------------------------
function mkEpic(id: string, opts: Record<string, any> = {}) {
    return {
        __typename: 'Epic',
        id,
        _seed: h(`Epic#${id}`),
        iid: opts.iid ?? `${h(`${id}iid`) % 1000}`,
        title:
            opts.title ??
            `${pick(`${id}epicq`, ['Platform', 'Security', 'Mobile', 'Billing', 'Observability', 'Performance', 'Developer Experience'])} ${pick(`${id}epicn`, ['Modernization', 'Initiative', 'Overhaul', 'Roadmap', 'Program'])}`,
        state: opts.state ?? 'opened',
        children: opts.children ?? ([] as any[]),
        blockedByEpics: opts.blockedByEpics ?? ([] as any[]),
    };
}

// Epic iid=1 in group/project (glab-076)
const epic1 = mkEpic('gid://gitlab/Epic/1', { iid: '1', title: 'Platform Epic', state: 'opened' });
const epic1Child1 = mkEpic('gid://gitlab/Epic/2', {
    iid: '2',
    title: 'Auth Sub-epic',
    state: 'opened',
});
const epic1Child2 = mkEpic('gid://gitlab/Epic/3', {
    iid: '3',
    title: 'API Sub-epic',
    state: 'closed',
});
epic1.children = [epic1Child1, epic1Child2];

// Pool epics for group (glab-087)
const epic2 = mkEpic('gid://gitlab/Epic/4', {
    iid: '4',
    title: 'Q3 Release Epic',
    state: 'opened',
});
const epic3 = mkEpic('gid://gitlab/Epic/5', {
    iid: '5',
    title: 'Security Hardening',
    state: 'opened',
});
epic2.blockedByEpics = [epic3];
const epic4 = mkEpic('gid://gitlab/Epic/6', {
    iid: '6',
    title: 'Mobile App Epic',
    state: 'closed',
});

// Board epics for glab-083
const boardEpic1 = {
    __typename: 'BoardEpic',
    id: 'gid://gitlab/BoardEpic/1',
    _seed: h('BoardEpic#1'),
    iid: '1',
    title: 'Q3 Infrastructure Modernization',
    healthStatus: {
        __typename: 'EpicHealthStatus',
        _seed: h('EpicHealthStatus#1'),
        issuesAtRisk: 188,
        issuesNeedingAttention: 864,
        issuesOnTrack: 846,
    },
};
const boardEpic2 = {
    __typename: 'BoardEpic',
    id: 'gid://gitlab/BoardEpic/2',
    _seed: h('BoardEpic#2'),
    iid: '2',
    title: 'Security Compliance Initiative',
    healthStatus: {
        __typename: 'EpicHealthStatus',
        _seed: h('EpicHealthStatus#2'),
        issuesAtRisk: 705,
        issuesNeedingAttention: 597,
        issuesOnTrack: 875,
    },
};

// ---------------------------------------------------------------------------
// BOARDS
// ---------------------------------------------------------------------------
function mkBoardList(id: string, listType: string, title: string, issuesCount: number) {
    return {
        __typename: 'BoardList',
        id,
        _seed: h(`BoardList#${id}`),
        listType,
        title,
        issuesCount,
    };
}

// Board gid://gitlab/Board/1 in group gitlab-org/gitlab (glab-083)
const board1 = {
    __typename: 'Board',
    id: 'gid://gitlab/Board/1',
    _seed: h('Board#gid://gitlab/Board/1'),
    name: 'Main Board',
    iteration: groupIteration1,
    lists: [
        mkBoardList('gid://gitlab/BoardList/1', 'backlog', 'Backlog', 5),
        mkBoardList('gid://gitlab/BoardList/2', 'label', 'In Progress', 3),
    ],
    epics: [boardEpic1, boardEpic2],
};

// Project boards for group/project (glab-024, glab-028)
const projectBoard1 = {
    __typename: 'Board',
    id: 'gid://gitlab/Board/101',
    _seed: h('Board#101'),
    name: 'Project Board',
    iteration: groupIteration2,
    lists: [
        mkBoardList('gid://gitlab/BoardList/101', 'backlog', 'Backlog', 8),
        mkBoardList('gid://gitlab/BoardList/102', 'label', 'Doing', 4),
        mkBoardList('gid://gitlab/BoardList/103', 'closed', 'Done', 12),
    ],
    epics: [boardEpic1],
};

// ---------------------------------------------------------------------------
// ENVIRONMENTS
// ---------------------------------------------------------------------------
function mkDeployment(id: string, opts: Record<string, any> = {}) {
    const pendingApprovalCount = opts.pendingApprovalCount ?? 0;
    return {
        __typename: 'Deployment',
        id,
        _seed: h(`Deployment#${id}`),
        iid: opts.iid ?? `${h(`${id}iid`) % 100}`,
        finishedAt: opts.finishedAt ?? mkDate(`${id}fa`, h(`${id}fa`) % 20),
        status: opts.status ?? 'CREATED',
        pendingApprovalCount,
        approvalSummary: opts.approvalSummary ?? {
            __typename: 'DeploymentApprovalSummary',
            _seed: h(`DeploymentApprovalSummary#${id}`),
            status: pendingApprovalCount > 0 ? 'PENDING_APPROVAL' : 'APPROVED',
            totalPendingApprovalCount: pendingApprovalCount,
            totalRequiredApprovals: pendingApprovalCount > 0 ? pendingApprovalCount + 1 : 1,
            rules: [],
        },
    };
}

const deployProd1 = mkDeployment('gid://gitlab/Deployment/1', {
    status: 'CREATED',
    pendingApprovalCount: 1,
});
const deployProd2 = mkDeployment('gid://gitlab/Deployment/2', {
    status: 'RUNNING',
    pendingApprovalCount: 0,
});
const deployProd3 = mkDeployment('gid://gitlab/Deployment/3', {
    status: 'BLOCKED',
    pendingApprovalCount: 2,
});

const freezePeriod = {
    __typename: 'CiFreezePeriod',
    _seed: h('CiFreezePeriod#1'),
    startCron: '0 22 * * 5',
    endCron: '0 6 * * 1',
    cronTimezone: 'UTC',
    status: 'ACTIVE',
};

const protectedEnvProd = {
    __typename: 'ProtectedEnvironment',
    _seed: h('ProtectedEnvironment#prod'),
    name: 'production',
};

function mkEnv(id: string, name: string, state: string) {
    return {
        __typename: 'Environment',
        id,
        _seed: h(`Environment#${id}`),
        name,
        state,
        deployments: [deployProd1, deployProd2, deployProd3],
        protectedEnvironments: name === 'production' ? [protectedEnvProd] : ([] as any[]),
        deployFreezes: name === 'production' ? [freezePeriod] : ([] as any[]),
    };
}

const envProduction = mkEnv('gid://gitlab/Environment/1', 'production', 'available');
const envStaging = mkEnv('gid://gitlab/Environment/2', 'staging', 'available');
const envReview = mkEnv('gid://gitlab/Environment/3', 'review', 'stopped');

const envByName = new Map([
    ['production', envProduction],
    ['staging', envStaging],
    ['review', envReview],
]);

// ---------------------------------------------------------------------------
// CI RUNNERS
// ---------------------------------------------------------------------------
function mkRunner(id: string, opts: Record<string, any> = {}) {
    const seed = h(`CiRunner#${id}`);
    return {
        __typename: 'CiRunner',
        id,
        _seed: seed,
        name: opts.name ?? `runner-${seed % 10000}`,
        description:
            opts.description ??
            `${pick(`${id}rdsc1`, ['Docker', 'Shell', 'Kubernetes', 'Windows', 'macOS', 'Auto-scaling'])} runner for ${pick(`${id}rdsc2`, ['CI builds', 'integration tests', 'deployments', 'security scans', 'parallel jobs', 'release pipelines'])}`,
        maximumTimeout: opts.maximumTimeout ?? 100 + (h(`${id}mt`) % 900),
        paused: opts.paused ?? false,
        status: opts.status ?? 'ONLINE', // CiRunnerStatus: ONLINE, OFFLINE, STALE, NEVER_CONTACTED
        runnerType: opts.runnerType ?? 'INSTANCE_TYPE', // CiRunnerType enum
        shortSha: opts.shortSha ?? `${seed % (16777215).toString(16).padStart(6, '0')}`.slice(0, 8),
        webPath: opts.webPath ?? `/admin/runners/${seed % 10000}`,
        webUrl: opts.webUrl ?? `https://gitlab.example.com/admin/runners/${seed % 10000}`,
        ownerProject: opts.ownerProject ?? null,
        createdAt: opts.createdAt ?? mkDate(`${id}crat`, h(`${id}crat`) % 365),
        updatedAt: opts.updatedAt ?? mkDate(`${id}ua`, h(`${id}ua`) % 30),
        contactedAt: opts.contactedAt ?? mkDate(`${id}ca`, h(`${id}ca`) % 60),
        tagList: opts.tagList ?? [`tag-${h(`${id}t1`) % 10}`, `tag-${h(`${id}t2`) % 20}`],
        jobExecutionStatus: opts.jobExecutionStatus ?? 'IDLE',
        jobs: opts.jobs ?? ([] as any[]),
    };
}

// Root runners for Query.runners (glab-038, glab-047)
const rootRunner0 = mkRunner('CiRunner:root/CiRunner/0', {
    description: 'Docker runner on Kubernetes cluster 1',
    maximumTimeout: 864,
    paused: false,
    status: 'ONLINE',
    jobExecutionStatus: 'IDLE', // CiRunnerJobExecutionStatus
    jobs: [
        mkJob('gid://gitlab/CiJob/r0j0', {
            name: 'integration-tests',
            duration: 558,
            status: 'RUNNING',
        }),
        mkJob('gid://gitlab/CiJob/r0j1', {
            name: 'deploy-production',
            duration: 809,
            status: 'RUNNING',
        }),
    ],
});
const rootRunner1 = mkRunner('CiRunner:root/CiRunner/1', {
    description: 'Dedicated machine runner for large builds',
    maximumTimeout: 151,
    paused: false,
    status: 'ONLINE',
    jobExecutionStatus: 'ACTIVE',
    jobs: [
        mkJob('gid://gitlab/CiJob/r1j0', {
            name: 'run-unit-tests',
            duration: 840,
            status: 'RUNNING',
        }),
        mkJob('gid://gitlab/CiJob/r1j1', {
            name: 'security-scan',
            duration: 533,
            status: 'RUNNING',
        }),
    ],
});
const rootRunner2 = mkRunner('CiRunner:root/CiRunner/2', {
    description: 'Auto-scaling runner for parallel jobs',
    maximumTimeout: 229,
    paused: true,
    status: 'OFFLINE',
    jobExecutionStatus: 'IDLE',
    jobs: [
        mkJob('gid://gitlab/CiJob/r2j0', {
            name: 'build-docker-image',
            duration: 419,
            status: 'RUNNING',
        }),
        mkJob('gid://gitlab/CiJob/r2j1', {
            name: 'performance-benchmark',
            duration: 956,
            status: 'RUNNING',
        }),
    ],
});
const rootRunner3 = mkRunner('CiRunner:root/CiRunner/3', {
    description: 'Shell runner for shell scripts',
    maximumTimeout: 636,
    paused: false,
    status: 'ONLINE',
    jobExecutionStatus: 'IDLE',
    jobs: [
        mkJob('gid://gitlab/CiJob/r3j0', {
            name: 'deploy-staging',
            duration: 291,
            status: 'RUNNING',
        }),
        mkJob('gid://gitlab/CiJob/r3j1', {
            name: 'lint-and-format',
            duration: 348,
            status: 'RUNNING',
        }),
    ],
});
const rootRunner4 = mkRunner('CiRunner:root/CiRunner/4', {
    description: 'Windows runner for .NET builds',
    maximumTimeout: 248,
    paused: false,
    status: 'ONLINE',
    jobExecutionStatus: 'IDLE',
    jobs: [
        mkJob('gid://gitlab/CiJob/r4j0', {
            name: 'static-code-analysis',
            duration: 845,
            status: 'RUNNING',
        }),
    ],
});

const rootRunners = [rootRunner0, rootRunner1, rootRunner2, rootRunner3, rootRunner4];

// Group gitlab-org/gitlab runners (glab-034): paused:false
const gitlabOrgRunner2 = mkRunner('gitlab-org/gitlab/CiRunner/2', {
    paused: false,
    status: 'ONLINE',
    contactedAt: '2025-05-21T00:00:00.000Z',
    description: 'Runner 2',
    tagList: ['docker', 'linux'],
});
const gitlabOrgRunner3 = mkRunner('gitlab-org/gitlab/CiRunner/3', {
    paused: false,
    status: 'ONLINE',
    contactedAt: '2024-08-16T00:00:00.000Z',
    description: 'Runner 3',
    tagList: ['shell'],
});
const gitlabOrgRunner4 = mkRunner('gitlab-org/gitlab/CiRunner/4', {
    paused: false,
    status: 'OFFLINE',
    contactedAt: '2024-07-18T00:00:00.000Z',
    description: 'Runner 4',
    tagList: ['windows'],
});
const gitlabOrgRunnersAll = [gitlabOrgRunner2, gitlabOrgRunner3, gitlabOrgRunner4];
const gitlabOrgRunnersActive = [gitlabOrgRunner2, gitlabOrgRunner3, gitlabOrgRunner4]; // all non-paused

// group/project runners (glab-090 paused:true)
// ownerProject will be patched after projectMain is defined
const projectRunner0 = mkRunner('group/project/CiRunner/0', {
    paused: true,
    status: 'OFFLINE',
    description: 'Paused runner 0',
    tagList: ['ruby'],
    runnerType: 'PROJECT_TYPE',
});
const projectRunner1 = mkRunner('group/project/CiRunner/1', {
    paused: true,
    status: 'OFFLINE',
    description: 'Paused runner 1',
    tagList: ['node'],
    runnerType: 'PROJECT_TYPE',
});
const projectRunner2 = mkRunner('group/project/CiRunner/2', {
    paused: false,
    status: 'ONLINE',
    description: 'Active runner 2',
    tagList: ['docker', 'linux'],
    runnerType: 'PROJECT_TYPE',
});
const projectRunner3 = mkRunner('group/project/CiRunner/3', {
    paused: false,
    status: 'ONLINE',
    description: 'Active runner 3',
    tagList: ['shell'],
    runnerType: 'PROJECT_TYPE',
});
const projectRunnersAll = [projectRunner0, projectRunner1, projectRunner2, projectRunner3];
const projectRunnersPaused = [projectRunner0, projectRunner1];
const projectRunnersActive = [projectRunner2, projectRunner3];

// Current user's runners for glab-050 (IDLE + ACTIVE)
const userRunner0 = mkRunner('gid://gitlab/CiRunner/501', {
    jobExecutionStatus: 'IDLE',
    status: 'ONLINE',
});
const userRunner1 = mkRunner('gid://gitlab/CiRunner/502', {
    jobExecutionStatus: 'ACTIVE',
    status: 'ONLINE',
});

// ---------------------------------------------------------------------------
// PIPELINE SCHEDULES
// ---------------------------------------------------------------------------
function mkSchedule(id: string, opts: Record<string, any> = {}) {
    return {
        __typename: 'PipelineSchedule',
        id,
        _seed: h(`PipelineSchedule#${id}`),
        description:
            opts.description ??
            `${pick(`${id}psd1`, ['Nightly', 'Weekly', 'Daily', 'Hourly', 'Monthly'])} ${pick(`${id}psd2`, ['build and test run', 'security scan', 'dependency update', 'cleanup job', 'deployment to staging'])}`,
        cron: opts.cron ?? `${h(`${id}cron`) % 60} ${h(`${id}ch`) % 24} * * *`,
        nextRunAt: opts.nextRunAt ?? futureDate(`${id}nra`, h(`${id}nra`) % 7),
        lastPipeline: opts.lastPipeline ?? pipelineMain1,
    };
}

const schedule1 = mkSchedule('gid://gitlab/PipelineSchedule/1', {
    description: 'Nightly build and test run',
    cron: '0 2 * * *',
    lastPipeline: pipelineMain1,
});
const schedule2 = mkSchedule('gid://gitlab/PipelineSchedule/2', {
    description: 'Weekly security scan',
    cron: '0 8 * * 1',
    lastPipeline: pipelineMain2,
});

// ---------------------------------------------------------------------------
// CI VARIABLES
// ---------------------------------------------------------------------------
function mkCiVar(id: string, key: string, opts: Record<string, any> = {}) {
    return {
        __typename: 'CiProjectVariable',
        id,
        _seed: h(`CiProjectVariable#${id}`),
        key,
        value: opts.value ?? `value-for-${key}`,
        description: opts.description ?? null,
        protected: opts.protected ?? false,
        masked: opts.masked ?? false,
        hidden: opts.hidden ?? false,
        raw: opts.raw ?? false,
        environmentScope: opts.environmentScope ?? '*',
        variableType: opts.variableType ?? 'ENV_VAR',
    };
}
function mkInheritedCiVar(
    id: string,
    key: string,
    groupName: string,
    opts: Record<string, any> = {},
) {
    return {
        __typename: 'InheritedCiVariable',
        id,
        _seed: h(`InheritedCiVariable#${id}`),
        key,
        value: opts.value ?? `value-for-${key}`,
        description: opts.description ?? null,
        protected: opts.protected ?? false,
        masked: opts.masked ?? false,
        hidden: opts.hidden ?? false,
        raw: opts.raw ?? false,
        environmentScope: opts.environmentScope ?? '*',
        variableType: opts.variableType ?? 'ENV_VAR',
        groupName,
        groupCiCdSettingsPath: opts.groupCiCdSettingsPath ?? `/${groupName}/-/settings/ci_cd`,
    };
}

const ciVarPool = [
    mkCiVar('v1', 'DATABASE_URL', {
        value: 'postgres://user:pass@db:5432/mydb',
        description: 'Primary database connection string',
        protected: true,
        masked: false,
        environmentScope: 'production',
    }),
    mkCiVar('v2', 'API_KEY', {
        value: 'sk-api-key-abc123',
        description: null,
        protected: false,
        masked: true,
        environmentScope: '*',
    }),
    mkCiVar('v3', 'SECRET_TOKEN', {
        value: 'supersecrettoken',
        description: 'Authentication secret',
        protected: true,
        masked: true,
        environmentScope: '*',
    }),
    mkCiVar('v4', 'DEPLOY_TOKEN', {
        value: 'deploy-token-xyz789',
        description: null,
        protected: false,
        masked: true,
        environmentScope: 'staging',
    }),
    mkCiVar('v5', 'CI_REGISTRY_USER', {
        value: 'registry-user',
        description: 'Container registry username',
        protected: false,
        masked: false,
        environmentScope: '*',
    }),
];
const inheritedVarPool = [
    mkInheritedCiVar('iv1', 'GROUP_TOKEN', 'parent-group', {
        value: 'group-token-secret',
        description: 'Shared group token',
        protected: true,
        masked: true,
        environmentScope: '*',
    }),
    mkInheritedCiVar('iv2', 'SHARED_CONFIG', 'parent-group', {
        value: 'config-value',
        description: 'Shared configuration',
        protected: false,
        masked: false,
        environmentScope: '*',
    }),
    mkInheritedCiVar('iv3', 'ORG_SECRET', 'root-group', {
        value: 'org-level-secret',
        description: null,
        protected: true,
        masked: true,
        environmentScope: '*',
    }),
];

// ---------------------------------------------------------------------------
// CLUSTER AGENTS
// ---------------------------------------------------------------------------
function mkAgent(id: string, name: string) {
    const seed = h(`ClusterAgent#${id}`);
    return {
        __typename: 'ClusterAgent',
        id,
        _seed: seed,
        name,
        webPath: `/group/project/-/cluster_agents/${seed % 10000}`,
        createdAt: mkDate(`${id}ca`, h(`${id}ca`) % 180),
        updatedAt: mkDate(`${id}ua`, h(`${id}ua`) % 30),
        userAccessAuthorizations: {
            __typename: 'ClusterAgentAuthorizationUserAccess',
            _seed: h(`ClusterAgentAuthorizationUserAccess#${id}`),
            config: { defaultNamespace: 'default', accessAs: { agent: true } },
            agent: null as any,
        },
    };
}
function mkAgentAccess(agent: any) {
    return {
        __typename: 'ClusterAgentAuthorizationCiAccess',
        _seed: h(`AgentAccess#${agent.id}`),
        agent,
        config: `{"defaultNamespace":"default"}`,
    };
}
const agent1 = mkAgent('gid://gitlab/ClusterAgent/1', 'production-agent');
const agent2 = mkAgent('gid://gitlab/ClusterAgent/2', 'staging-agent');
const agentAccesses = [mkAgentAccess(agent1), mkAgentAccess(agent2)];

// ---------------------------------------------------------------------------
// RELEASES
// ---------------------------------------------------------------------------
function mkRelease(id: string, opts: Record<string, any> = {}) {
    const seed = h(`Release#${id}`);
    return {
        __typename: 'Release',
        id,
        _seed: seed,
        name:
            opts.name ??
            `v${h(`${id}tag`) % 100}.0.0 ${pick(`${id}relname`, ['Stable', 'Release', 'GA', 'LTS', 'Patch'])}`,
        tagName: opts.tagName ?? `v${h(`${id}tag`) % 100}.0.0`,
        releasedAt: opts.releasedAt ?? mkDate(`${id}ra`, h(`${id}ra`) % 60),
        upcomingRelease: opts.upcomingRelease ?? false,
        assets: opts.assets ?? {
            __typename: 'ReleaseAssets',
            _seed: h(`ReleaseAssets#${id}`),
            count: 2,
            links: [
                {
                    __typename: 'ReleaseAssetLink',
                    _seed: h(`RAL#${id}0`),
                    name: 'Binary',
                    url: `https://example.com/${id}/release.tar.gz`,
                },
                {
                    __typename: 'ReleaseAssetLink',
                    _seed: h(`RAL#${id}1`),
                    name: 'Checksum',
                    url: `https://example.com/${id}/checksum.sha256`,
                },
            ],
        },
        milestones: opts.milestones ?? ([milestone1] as any[]),
        evidences: opts.evidences ?? ([] as any[]),
    };
}

// Evidences for glab-088 — 2 evidences for first release.
// IDs and scalar values are set explicitly to match the glab-088.yaml gold answer.
// The IDs follow the seeded-connection format for Release.evidences nodes[0..1].
const evidence0 = {
    __typename: 'ReleaseEvidence',
    id: 'ReleaseEvidenceConnection.nodes[0]#25071954',
    _seed: h('ReleaseEvidence#ReleaseEvidenceConnection.nodes[0]#25071954'),
    sha: 'd6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e',
    filepath: 'evidence/sbom-v2.0.0.json',
    collectedAt: '2025-05-20T14:32:01Z',
};
const evidence1 = {
    __typename: 'ReleaseEvidence',
    id: 'ReleaseEvidenceConnection.nodes[1]#41849573',
    _seed: h('ReleaseEvidence#ReleaseEvidenceConnection.nodes[1]#41849573'),
    sha: 'c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d',
    filepath: 'evidence/build-log-v2.0.0.txt',
    collectedAt: '2025-05-10T09:15:33Z',
};

const release1 = mkRelease('gid://gitlab/Release/1', {
    name: 'v1.0.0',
    tagName: 'v1.0.0',
    upcomingRelease: false,
    releasedAt: mkDate('rel1ra', 90),
    evidences: [evidence0, evidence1],
});
const release2 = mkRelease('gid://gitlab/Release/2', {
    name: 'v2.0.0',
    tagName: 'v2.0.0',
    upcomingRelease: true,
    releasedAt: futureDate('rel2ra', 30),
});
const release3 = mkRelease('gid://gitlab/Release/3', {
    name: 'v0.9.0',
    tagName: 'v0.9.0',
    upcomingRelease: false,
    releasedAt: mkDate('rel3ra', 120),
});
const projectReleases = [release1, release2, release3];

// ---------------------------------------------------------------------------
// DORA
// ---------------------------------------------------------------------------
const doraMetrics = [
    {
        __typename: 'DoraMetric',
        _seed: h('DoraMetric#1'),
        date: '2025-01-15',
        deploymentFrequency: 4.2,
        leadTimeForChanges: 2.1,
        changeFailureRate: 0.05,
        timeToRestoreService: 1.5,
    },
    {
        __typename: 'DoraMetric',
        _seed: h('DoraMetric#2'),
        date: '2025-02-15',
        deploymentFrequency: 3.8,
        leadTimeForChanges: 1.9,
        changeFailureRate: 0.04,
        timeToRestoreService: 1.2,
    },
    {
        __typename: 'DoraMetric',
        _seed: h('DoraMetric#3'),
        date: '2025-03-15',
        deploymentFrequency: 5.1,
        leadTimeForChanges: 1.7,
        changeFailureRate: 0.03,
        timeToRestoreService: 0.9,
    },
];
const dora = { __typename: 'Dora', _seed: h('Dora#1'), metrics: doraMetrics };

// ---------------------------------------------------------------------------
// SECURITY SCANNERS, TRAINING, POLICIES
// ---------------------------------------------------------------------------
const securityScanners = {
    __typename: 'SecurityScanners',
    _seed: h('SecurityScanners#1'),
    enabled: ['SECRET_DETECTION', 'DEPENDENCY_SCANNING'],
};

const securityTrainingProviders = [
    {
        __typename: 'ProjectSecurityTraining',
        id: 'gid://gitlab/SecurityTraining/1',
        _seed: h('SecurityTraining#1'),
        name: 'Secure Code Warrior',
        isEnabled: true,
        isPrimary: true,
        description: 'Interactive security training platform',
        logoUrl: 'https://cdn.securecodewarrior.com/logo.png',
        url: 'https://www.securecodewarrior.com/',
    },
    {
        __typename: 'ProjectSecurityTraining',
        id: 'gid://gitlab/SecurityTraining/2',
        _seed: h('SecurityTraining#2'),
        name: 'Kontra',
        isEnabled: false,
        isPrimary: false,
        description: 'Application security training with interactive challenges',
        logoUrl: 'https://application.security/kontra-logo.png',
        url: 'https://application.security/',
    },
];

// ScanExecutionPolicies (glab-063) — 2 enabled
const scanExecutionPolicies = [
    {
        __typename: 'ScanExecutionPolicy',
        _seed: h('SEP#1'),
        name: 'Weekly DAST Scanning',
        enabled: true,
    },
    {
        __typename: 'ScanExecutionPolicy',
        _seed: h('SEP#2'),
        name: 'Container Image Scanning',
        enabled: true,
    },
];

// ApprovalPolicies (glab-070) — 1 enabled
const approvalPolicies = [
    {
        __typename: 'ApprovalPolicy',
        _seed: h('AP#1'),
        name: 'Security Review Required',
        enabled: true,
    },
    {
        __typename: 'ApprovalPolicy',
        _seed: h('AP#2'),
        name: 'Architecture Board Approval',
        enabled: false,
    },
];

// BranchRules (glab-027)
const defaultBranchProtection = {
    __typename: 'BranchProtection',
    _seed: h('BranchProtection#default'),
    allowForcePush: false,
    codeOwnerApprovalRequired: true,
    isGroupLevel: false,
    modificationBlockedByPolicy: false,
    protectedFromPushBySecurityPolicy: false,
    warnModificationBlockedByPolicy: false,
    warnProtectedFromPushBySecurityPolicy: false,
    mergeAccessLevels: [] as any[],
    pushAccessLevels: [] as any[],
    unprotectAccessLevels: [] as any[],
};
const branchRules = [
    {
        __typename: 'BranchRule',
        _seed: h('BranchRule#1'),
        name: 'release-branch-guard',
        isProtected: false,
        matchingBranchesCount: 3,
        branchProtection: null,
    },
    {
        __typename: 'BranchRule',
        _seed: h('BranchRule#2'),
        name: 'main-protection-rule',
        isProtected: true,
        matchingBranchesCount: 1,
        branchProtection: defaultBranchProtection,
    },
];

// PushRules (glab-027)
const pushRules = {
    __typename: 'PushRules',
    _seed: h('PushRules#1'),
    commitCommitterCheck: false,
    memberCheck: true,
    preventSecrets: false,
    maxFileSize: 376,
    authorEmailRegex: '^[a-zA-Z0-9._%+-]+@company\.com$',
    branchNameRegex: '^(main|develop|feat|hotfix)/[a-zA-Z0-9-]+$',
    commitCommitterNameCheck: true,
    commitMessageNegativeRegex: '^WIP|^DEBUG|^TEMP',
    commitMessageRegex: '^(feat|fix|docs|style|refactor|test|chore):',
    denyDeleteTag: false,
    fileNameRegex: '^(?!.*\\.(exe|dll|so|dylib)$).*',
    rejectNonDcoCommits: true,
    rejectUnsignedCommits: true,
};

// ---------------------------------------------------------------------------
// DEPENDENCIES
// ---------------------------------------------------------------------------
function mkDep(id: string, name: string, vulnCount: number) {
    return {
        __typename: 'Dependency',
        id,
        _seed: h(`Dependency#${id}`),
        name,
        vulnerabilityCount: vulnCount,
    };
}
const dependencies = [
    mkDep('dep1', 'lodash', 2),
    mkDep('dep2', 'express', 0),
    mkDep('dep3', 'axios', 1),
    mkDep('dep4', 'react', 0),
    mkDep('dep5', 'webpack', 3),
];

// ---------------------------------------------------------------------------
// DAST PROFILES
// ---------------------------------------------------------------------------
function mkDastProfile(id: string, name: string, description: string) {
    return { __typename: 'DastProfile', id, _seed: h(`DastProfile#${id}`), name, description };
}
const dastProfiles = [
    mkDastProfile('gid://gitlab/DastProfile/1', 'Full scan', 'Complete DAST scan'),
    mkDastProfile('gid://gitlab/DastProfile/2', 'Baseline scan', 'Quick baseline scan'),
];

// ---------------------------------------------------------------------------
// MERGE TRAINS
// ---------------------------------------------------------------------------
const mergeTrainCar1 = {
    __typename: 'MergeTrainCar',
    _seed: h('MergeTrainCar#1'),
    status: 'FRESH',
    createdAt: mkDate('mtc1ca', 1),
};
const mergeTrainCar2 = {
    __typename: 'MergeTrainCar',
    _seed: h('MergeTrainCar#2'),
    status: 'MERGING',
    createdAt: mkDate('mtc2ca', 2),
};

const mergeTrain1 = {
    __typename: 'MergeTrain',
    _seed: h('MergeTrain#1'),
    targetBranch: 'main',
    cars: [mergeTrainCar1, mergeTrainCar2],
};
const mergeTrain2 = {
    __typename: 'MergeTrain',
    _seed: h('MergeTrain#2'),
    targetBranch: 'release',
    cars: [mergeTrainCar1],
};

// ---------------------------------------------------------------------------
// REPOSITORY
// ---------------------------------------------------------------------------
function mkCommit(
    id: string,
    sha: string,
    title: string,
    authorName: string,
    days: number,
    authorUser?: any,
) {
    const shortId = sha.slice(0, 8);
    return {
        __typename: 'Commit',
        id,
        _seed: h(`Commit#${id}`),
        sha,
        shortId,
        title,
        message: title, // Commit.message == the commit message (same as title for mocks)
        authorName,
        author: authorUser ?? null, // UserCore; patched after users defined
        authoredDate: mkDate(`${id}ad`, days),
        pipelines: [] as any[], // PipelineConnection — patched after pipelines defined
    };
}
const commits = [
    mkCommit(
        'c1',
        'abc1234def567890abc1234def567890abc12345',
        'Fix auth bug',
        'Alice Johnson',
        2,
        userAlice,
    ),
    mkCommit(
        'c2',
        'def5678abc901234def5678abc901234def56789',
        'Add rate limiting',
        'Bob Smith',
        5,
        userBob,
    ),
    mkCommit(
        'c3',
        'ghi9012jkl345678ghi9012jkl345678ghi90123',
        'Refactor pipeline',
        'Carol White',
        10,
        userCarol,
    ),
];
// Latest commit (HEAD of main) — used by Repository.commit(ref:"main")
const headCommit = commits[0]!;

const repository = {
    __typename: 'Repository',
    _seed: h('Repository#1'),
    rootRef: 'main',
    commits,
    // branchNames — array of branch name strings
    _branchNames: ['main', 'feature/auth', 'fix/rate-limiting'],
};

// ---------------------------------------------------------------------------
// TIMELOGS
// ---------------------------------------------------------------------------
function mkTimelog(id: string, user: any, timeSpent: number) {
    return { __typename: 'Timelog', id, _seed: h(`Timelog#${id}`), user, timeSpent };
}
const timelogs = [
    mkTimelog('tl1', userAlice, 3600),
    mkTimelog('tl2', userBob, 7200),
    mkTimelog('tl3', userCarol, 1800),
    mkTimelog('tl4', userDavid, 5400),
    mkTimelog('tl5', userEva, 900),
];
// For glab-074: projectId: gid://gitlab/Project/1 timelogs sum to 1894
const projectTimelogs = [mkTimelog('ptl1', userAlice, 1200), mkTimelog('ptl2', userBob, 694)];
// totalSpentTime = 1200 + 694 = 1894

// ---------------------------------------------------------------------------
// CI MINUTES USAGE
// ---------------------------------------------------------------------------
const ciMinutesUsage = [
    {
        __typename: 'CiMinutesNamespaceMonthlyUsage',
        _seed: h('CiMinutesUsage#1'),
        minutes: 1257,
        month: '2025-05',
    },
];

// ---------------------------------------------------------------------------
// ADD-ON PURCHASES
// ---------------------------------------------------------------------------
// glab-097: two purchases with qty 325 and 321
// IDs follow the default-resolver entity id format for list items at index 0,1:
// parentSeed=0 (Query root), field='addOnPurchases', index=i
// elemSeed = stableHash(`0#addOnPurchases#${i}`) → 3728801501, 3712023882
const addOnPurchaseId0 = 'Query.addOnPurchases[0]#3728801501';
const addOnPurchaseId1 = 'Query.addOnPurchases[1]#3712023882';
const addOnPurchases = [
    {
        __typename: 'AddOnPurchase',
        id: addOnPurchaseId0,
        _seed: h(`AddOnPurchase#${addOnPurchaseId0}`),
        name: 'Premium Support Bundle',
        purchasedQuantity: 325,
    },
    {
        __typename: 'AddOnPurchase',
        id: addOnPurchaseId1,
        _seed: h(`AddOnPurchase#${addOnPurchaseId1}`),
        name: 'Advanced Security Pack',
        purchasedQuantity: 321,
    },
];

// ---------------------------------------------------------------------------
// TODOS
// ---------------------------------------------------------------------------
function mkTodo(id: string, state: string, targetType: string, body: string, targetUrl: string) {
    return { __typename: 'Todo', id, _seed: h(`Todo#${id}`), body, state, targetType, targetUrl };
}
const todos = [
    mkTodo(
        'gid://gitlab/Todo/1',
        'pending',
        'NAMESPACE',
        'You were mentioned in a comment on issue #1234',
        'https://gitlab.example.com/group/project/-/issues/1234#note_5678',
    ),
    mkTodo(
        'gid://gitlab/Todo/2',
        'pending',
        'DUO_WORKFLOW',
        'Review requested for merge request !108',
        'https://gitlab.example.com/group/project/-/merge_requests/108',
    ),
    mkTodo(
        'gid://gitlab/Todo/3',
        'done',
        'NAMESPACE',
        'You were assigned to issue #2766',
        'https://gitlab.example.com/group/project/-/issues/2766',
    ),
    mkTodo(
        'gid://gitlab/Todo/4',
        'pending',
        'NAMESPACE',
        'Pipeline failed for merge request !5794',
        'https://gitlab.example.com/group/project/-/merge_requests/5794/pipelines',
    ),
];
const pendingTodos = todos.filter((t) => t.state === 'pending');

// ---------------------------------------------------------------------------
// SNIPPETS
// ---------------------------------------------------------------------------
function mkSnippet(id: string, title: string, createdAt: string, webUrl: string) {
    return { __typename: 'Snippet', id, _seed: h(`Snippet#${id}`), title, createdAt, webUrl };
}
const snippets = [
    mkSnippet(
        '1',
        'Bash script to backup PostgreSQL databases',
        mkDate('snip1ca', 45),
        'https://gitlab.example.com/-/snippets/1',
    ),
    mkSnippet(
        '2',
        'Python helper for parsing YAML config files',
        mkDate('snip2ca', 20),
        'https://gitlab.example.com/-/snippets/2',
    ),
    mkSnippet(
        '3',
        'GitLab CI template for Node.js projects',
        mkDate('snip3ca', 10),
        'https://gitlab.example.com/-/snippets/3',
    ),
];

// ---------------------------------------------------------------------------
// WORK ITEMS
// ---------------------------------------------------------------------------
function mkWorkItem(
    id: string,
    iid: string,
    confidential: boolean,
    startDate: string,
    dueDate: string,
) {
    const seed = h(`WorkItem#${id}`);
    return {
        __typename: 'WorkItem',
        id,
        _seed: seed,
        iid,
        confidential,
        title: realTitle(`${id}wititle`),
        state: 'OPEN',
        webPath: `/group/project/-/work_items/${iid}`,
        webUrl: `https://gitlab.example.com/group/project/-/work_items/${iid}`,
        project: null as any, // patched after projectMain
        widgets: [{ __typename: 'WorkItemWidgetStartAndDueDate', startDate, dueDate }],
    };
}

// gid://gitlab/Iteration/1 workItem iid=1 in gitlab-org (glab-084) is confidential:false
const workItemGitlabOrg1 = mkWorkItem(
    'gid://gitlab/WorkItem/1',
    '1',
    false,
    '2024-01-01',
    '2024-03-31',
);

// Group work items (glab-071)
const groupWorkItems = [
    mkWorkItem('gid://gitlab/WorkItem/101', '101', false, '2024-08-14', '2025-03-23'),
    mkWorkItem('gid://gitlab/WorkItem/102', '102', false, '2024-07-30', '2024-07-12'),
    mkWorkItem('gid://gitlab/WorkItem/103', '103', true, '2024-11-25', '2024-10-30'),
];
const workItemByIid = new Map([['1', workItemGitlabOrg1]]);

// ---------------------------------------------------------------------------
// VULNERABILITIES COUNT BY DAY (needed by mkProject)
// ---------------------------------------------------------------------------
function mkVulnCountByDayEarly(
    date: string,
    total: number,
    critical: number,
    high: number,
    medium: number,
    low: number,
) {
    return {
        __typename: 'VulnerabilitiesCountByDay',
        _seed: h(`VCBDay#${date}`),
        date,
        total,
        critical,
        high,
        medium,
        low,
    };
}
const vulnCountByDay = [
    mkVulnCountByDayEarly('2025-01-15', 45, 5, 10, 20, 10),
    mkVulnCountByDayEarly('2025-03-15', 52, 7, 12, 23, 10),
    mkVulnCountByDayEarly('2025-06-01', 38, 4, 8, 18, 8),
    mkVulnCountByDayEarly('2025-09-01', 41, 6, 9, 19, 7),
    mkVulnCountByDayEarly('2025-12-01', 35, 3, 7, 17, 8),
];

// ---------------------------------------------------------------------------
// PROJECTS
// ---------------------------------------------------------------------------
function mkProject(id: string, name: string, fullPath: string, opts: Record<string, any> = {}) {
    // path is the last component of fullPath
    const path = fullPath.includes('/') ? fullPath.split('/').pop()! : fullPath;
    return {
        __typename: 'Project',
        id,
        _seed: h(`Project#${id}`),
        name,
        fullPath,
        path,
        webUrl: opts.webUrl ?? `https://gitlab.example.com/${fullPath}`,
        namespace: opts.namespace ?? {
            __typename: 'Namespace',
            id: `gid://gitlab/Namespace/${h(`Namespace#${id}`) % 10000}`,
            _seed: h(`Namespace#${id}`),
            path,
            fullPath,
            storageSizeLimit: 10737418240,
        },
        visibility: opts.visibility ?? 'private',
        lastActivityAt: opts.lastActivityAt ?? mkDate(`${id}laa`, h(`${id}laa`) % 60),
        openMergeRequestsCount: opts.openMergeRequestsCount ?? 3,
        mergeRequestTitleRegex: opts.mergeRequestTitleRegex ?? null,
        repository: opts.repository ?? repository,
        pipelines: opts.pipelines ?? [
            pipelineMain1,
            pipelineMain2,
            pipelineMain3,
            pipelineMain4,
            pipelineMain5,
        ],
        pipeline: opts.pipeline ?? latestPipeline,
        mergeRequests: opts.mergeRequests ?? poolMRs,
        issues: opts.issues ?? projectIssuePool,
        boards: opts.boards ?? [projectBoard1],
        mergeTrains: opts.mergeTrains ?? [mergeTrain1, mergeTrain2],
        environments: opts.environments ?? [envProduction, envStaging, envReview],
        releases: opts.releases ?? projectReleases,
        ciVariables: opts.ciVariables ?? ciVarPool,
        inheritedCiVariables: opts.inheritedCiVariables ?? inheritedVarPool,
        ciAccessAuthorizedAgents: opts.ciAccessAuthorizedAgents ?? agentAccesses,
        pipelineSchedules: opts.pipelineSchedules ?? [schedule1, schedule2],
        vulnerabilities: opts.vulnerabilities ?? projectVulns,
        vulnerabilitiesCountByDay: opts.vulnerabilitiesCountByDay ?? vulnCountByDay,
        dependencies: opts.dependencies ?? dependencies,
        dastProfiles: opts.dastProfiles ?? dastProfiles,
        scanExecutionPolicies: opts.scanExecutionPolicies ?? scanExecutionPolicies,
        approvalPolicies: opts.approvalPolicies ?? approvalPolicies,
        securityScanners: opts.securityScanners ?? securityScanners,
        securityTrainingProviders: opts.securityTrainingProviders ?? securityTrainingProviders,
        branchRules: opts.branchRules ?? branchRules,
        pushRules: opts.pushRules ?? pushRules,
        dora: opts.dora ?? dora,
        timelogs: opts.timelogs ?? timelogs,
        statistics: opts.statistics ?? {
            __typename: 'ProjectStatistics',
            _seed: h(`ProjectStatistics#${id}`),
            containerRegistrySize: h(`${id}crs`) % 10000000,
            storageSize: h(`${id}ss`) % 10000000,
        },
    };
}

// Main project: group/project
const projectMain = mkProject('gid://gitlab/Project/100', 'group/project', 'group/project');
// Set MR title regex for glab-026
projectMain.mergeRequestTitleRegex =
    '^(feat|fix|docs|style|refactor|test|chore)(\\(.+\\))?: .{1,72}';
// Patch all pool MRs to reference projectMain
for (const mr of [...poolMRs, mr1, mr1234]) {
    mr.project = projectMain;
}
// Patch project runners ownerProject
for (const r of [projectRunner0, projectRunner1, projectRunner2, projectRunner3]) {
    r.ownerProject = projectMain;
}

// gitlab-org/gitlab project
const gitlabOrgGitlab = mkProject('gid://gitlab/Project/200', 'gitlab', 'gitlab-org/gitlab', {
    visibility: 'public',
    pipelines: [gitlabOrgPipeline1, gitlabOrgPipeline2],
    pipeline: gitlabOrgPipeline1,
    issues: [gitlabIssue1, gitlabIssue2],
    vulnerabilities: projectVulns,
});

// Project lookup map (by fullPath)
const projectByPath = new Map<string, any>([
    ['group/project', projectMain],
    ['gitlab-org/gitlab', gitlabOrgGitlab],
]);

// ---------------------------------------------------------------------------
// GROUP PROJECTS (pool + special for glab-100)
// ---------------------------------------------------------------------------
// glab-030 / glab-093 / glab-099: these 5 projects
const groupProjects = [
    mkProject('gid://gitlab/Project/301', 'data-analytics', 'group/project-4512', {
        visibility: 'public',
        lastActivityAt: mkDate('p301laa', 5),
    }),
    mkProject('gid://gitlab/Project/302', 'testing-framework', 'group/project-6872', {
        visibility: 'private',
        lastActivityAt: mkDate('p302laa', 10),
    }),
    mkProject('gid://gitlab/Project/303', 'mobile-app', 'group/project-2503', {
        visibility: 'internal',
        lastActivityAt: mkDate('p303laa', 15),
    }),
    mkProject('gid://gitlab/Project/304', 'notification-system', 'group/project-8529', {
        visibility: 'public',
        lastActivityAt: mkDate('p304laa', 20),
    }),
    mkProject('gid://gitlab/Project/305', 'web-frontend', 'group/project-223', {
        visibility: 'private',
        lastActivityAt: mkDate('p305laa', 25),
    }),
];
// All have mergeRequests(state:opened) count=3
for (const gp of groupProjects) {
    gp.mergeRequests = poolMRs.slice(0, 3);
}

// glab-100: 3 projects where containerRegistrySize > storageSize
// Project.name-4419, Project.name-2177, Project.name-9845
const bigRegistryProject1 = mkProject(
    'gid://gitlab/Project/401',
    'devops-infrastructure',
    'group/project-4419',
    {
        statistics: {
            __typename: 'ProjectStatistics',
            _seed: h('PS#401'),
            containerRegistrySize: 5000000,
            storageSize: 1000000,
        },
    },
);
const bigRegistryProject2 = mkProject(
    'gid://gitlab/Project/402',
    'backend-service',
    'group/project-2177',
    {
        statistics: {
            __typename: 'ProjectStatistics',
            _seed: h('PS#402'),
            containerRegistrySize: 8000000,
            storageSize: 2000000,
        },
    },
);
const bigRegistryProject3 = mkProject(
    'gid://gitlab/Project/403',
    'payment-processor',
    'group/project-9845',
    {
        statistics: {
            __typename: 'ProjectStatistics',
            _seed: h('PS#403'),
            containerRegistrySize: 3000000,
            storageSize: 500000,
        },
    },
);
const smallRegistryProject1 = mkProject(
    'gid://gitlab/Project/404',
    'documentation-site',
    'group/project-3311',
    {
        statistics: {
            __typename: 'ProjectStatistics',
            _seed: h('PS#404'),
            containerRegistrySize: 100000,
            storageSize: 900000,
        },
    },
);
const smallRegistryProject2 = mkProject(
    'gid://gitlab/Project/405',
    'auth-service',
    'group/project-7628',
    {
        statistics: {
            __typename: 'ProjectStatistics',
            _seed: h('PS#405'),
            containerRegistrySize: 50000,
            storageSize: 600000,
        },
    },
);
// All group100 projects including the 3 large ones
const group100Projects = [
    bigRegistryProject1,
    bigRegistryProject2,
    bigRegistryProject3,
    smallRegistryProject1,
    smallRegistryProject2,
];

// ---------------------------------------------------------------------------
// GROUPS
// ---------------------------------------------------------------------------
function mkGroupMember(user: any, levelIdx: number, expiresAt: string | null = null) {
    return {
        __typename: 'GroupMember',
        _seed: h(`GroupMember#${user.id}`),
        user,
        accessLevel: accessLevels[levelIdx]!,
        expiresAt,
    };
}

function mkMemberApproval(user: any, levelIdx: number) {
    return {
        __typename: 'MemberApproval',
        _seed: h(`MemberApproval#${user.id}`),
        status: 'pending',
        user,
        newAccessLevel: accessLevels[levelIdx]!,
    };
}

// CI Queueing history
const ciQueueingHistory = {
    __typename: 'CiQueueingHistory',
    _seed: h('CiQueueingHistory#1'),
    timeSeries: [
        {
            __typename: 'QueueingHistoryTimeSeries',
            _seed: h('QHTS#1'),
            time: mkDate('qhts1t', 3),
            p50: 12,
            p75: 24,
            p90: 45,
            p95: 67,
            p99: 120,
        },
        {
            __typename: 'QueueingHistoryTimeSeries',
            _seed: h('QHTS#2'),
            time: mkDate('qhts2t', 2),
            p50: 10,
            p75: 20,
            p90: 38,
            p95: 55,
            p99: 98,
        },
    ],
};

// (vulnCountByDay is defined earlier, before mkProject)

function mkGroup(id: string, fullPath: string, name: string, opts: Record<string, any> = {}): any {
    const parentGroup: any = opts.parent ?? null;
    const path = fullPath.includes('/') ? fullPath.split('/').pop()! : fullPath;
    return {
        __typename: 'Group',
        id,
        _seed: h(`Group#${id}`),
        name,
        fullPath,
        path,
        webUrl: `https://gitlab.example.com/${fullPath}`,
        visibility: opts.visibility ?? 'private',
        parent: parentGroup,
        groupMembers: opts.groupMembers ?? groupUsers.map((u, i) => mkGroupMember(u, i % 5)),
        projects: opts.projects ?? groupProjects,
        runners: opts.runners ?? projectRunnersAll,
        ciQueueingHistory: opts.ciQueueingHistory ?? ciQueueingHistory,
        vulnerabilities: opts.vulnerabilities ?? groupVulns,
        vulnerabilitiesCountByDay: opts.vulnerabilitiesCountByDay ?? vulnCountByDay,
        epics: opts.epics ?? [epic1, epic2, epic3, epic4],
        iterations: opts.iterations ?? [groupIteration1, groupIteration2, groupIteration3],
        iterationCadences: opts.iterationCadences ?? [cadence1, cadence2],
        milestones: opts.milestones ?? [groupMilestone1, groupMilestone2],
        issues: opts.issues ?? [groupIssue1, groupIssue2, groupIssue3],
        workItems: opts.workItems ?? groupWorkItems,
        workItem: opts.workItem ?? null,
        board: opts.board ?? null,
        namespaceSettings: opts.namespaceSettings ?? {
            __typename: 'NamespaceSettings',
            _seed: h(`NamespaceSettings#${id}`),
            stepUpAuthRequiredOauthProvider: pick(`${id}nsoa`, [
                'google',
                'github',
                'gitlab',
                'okta',
                'azure_activedirectory_v2',
            ]),
        },
        billableMembersCount: opts.billableMembersCount ?? 100 + (h(`${id}bmc`) % 500),
        descendantGroups: opts.descendantGroups ?? ([] as any[]),
        pendingMemberApprovals:
            opts.pendingMemberApprovals ??
            groupUsers.slice(0, 3).map((u, i) => mkMemberApproval(u, i + 1)),
        scanExecutionPolicies: opts.scanExecutionPolicies ?? scanExecutionPolicies,
        approvalPolicies: opts.approvalPolicies ?? approvalPolicies,
        clusterAgents: opts.clusterAgents ?? [agent1, agent2],
        dependencies: opts.dependencies ?? dependencies,
        dora: opts.dora ?? {
            __typename: 'GroupDora',
            _seed: h(`GroupDora#${id}`),
            metrics: doraMetrics,
        },
        projectStatistics: opts.projectStatistics ?? {
            __typename: 'NamespaceProjectStatistics',
            _seed: h(`NamespaceProjectStatistics#${id}`),
            buildArtifactsSize: h(`${id}bas`) % 1000000,
            lfsObjectsSize: h(`${id}lfs`) % 1000000,
            packagesSize: h(`${id}pkg`) % 1000000,
            pipelineArtifactsSize: h(`${id}pas`) % 1000000,
            repositorySize: h(`${id}rs`) % 1000000,
            snippetsSize: h(`${id}sns`) % 1000000,
            storageSize: h(`${id}ss`) % 1000000,
            uploadsSize: h(`${id}us`) % 1000000,
            wikiSize: h(`${id}ws`) % 1000000,
        },
        rootNamespace: opts.rootNamespace ?? null, // filled below for top-level groups
    };
}

// Main group: group/project
const groupMain = mkGroup('gid://gitlab/Group/1', 'group/project', 'Project Group', {
    billableMembersCount: 595,
    namespaceSettings: {
        __typename: 'NamespaceSettings',
        _seed: h('NamespaceSettings#1'),
        stepUpAuthRequiredOauthProvider: 'google',
    },
    runners: projectRunnersAll,
    projects: groupProjects,
    board: null, // set below after board is created
});

// Wire board lookup for group/project group
groupMain.board = (id: string) => (id === 'gid://gitlab/Board/1' ? board1 : null);

// gitlab-org/gitlab group
const gitlabOrgGitlabGroup = mkGroup(
    'gid://gitlab/Group/200',
    'gitlab-org/gitlab',
    'GitLab GitLab Group',
    {
        runners: gitlabOrgRunnersAll,
        board: board1,
    },
);

// gitlab-org group
const gitlabOrgGroup = mkGroup('gid://gitlab/Group/100', 'gitlab-org', 'GitLab Org', {
    groupMembers: gitlabOrgUsers.map((u, i) => mkGroupMember(u, (i + 2) % 5)),
    iterations: [gitlabOrgIteration1, gitlabOrgIteration2],
    workItem: workItemGitlabOrg1,
    projects: group100Projects,
});

// Group/project's group also includes the 100 projects for glab-100
groupMain.descendantGroups = [gitlabOrgGitlabGroup];

// Group lookup by fullPath
const groupByPath = new Map<string, any>([
    ['group/project', groupMain],
    ['gitlab-org', gitlabOrgGroup],
    ['gitlab-org/gitlab', gitlabOrgGitlabGroup],
]);

// Top-level groups (glab-089)
const topLevelGroup1 = mkGroup('gid://gitlab/Group/901', 'myorg', 'My Org', {
    visibility: 'public',
    parent: null,
});
const topLevelGroup2 = mkGroup('gid://gitlab/Group/902', 'devteam', 'Dev Team', {
    visibility: 'private',
    parent: null,
});
const topLevelGroup3 = mkGroup('gid://gitlab/Group/903', 'clients', 'Clients', {
    visibility: 'internal',
    parent: null,
});
const topLevelGroups = [groupMain, gitlabOrgGroup, topLevelGroup1, topLevelGroup2, topLevelGroup3];

// Patch rootNamespace for top-level groups (self-referential)
for (const g of topLevelGroups) {
    g.rootNamespace = g;
}

// Confidential work items for currentUser (glab-084)
const confidentialWorkItems = groupWorkItems.filter((wi) => wi.confidential);

// ---------------------------------------------------------------------------
// CURRENT USER
// ---------------------------------------------------------------------------
const currentUser: any = {
    __typename: 'CurrentUser',
    id: 'gid://gitlab/User/1',
    _seed: h('CurrentUser#gid://gitlab/User/1'),
    username: 'current_user',
    name: 'Current User',
    assignedMergeRequests: currentUserAssignedMRs,
    reviewRequestedMergeRequests: currentUserReviewMRs,
    authoredMergeRequests: currentUserAuthoredMergedMRs,
    todos: pendingTodos,
    contributedProjects: [projectMain, gitlabOrgGitlab],
    snippets,
    runners: [userRunner0, userRunner1],
    workItems: confidentialWorkItems,
};

// ---------------------------------------------------------------------------
// ISSUE LOOKUP
// ---------------------------------------------------------------------------
const issueById = new Map<string, any>([['gid://gitlab/Issue/1', issue1]]);

// Milestone lookup
const milestoneById = new Map<string, any>([['gid://gitlab/Milestone/1', milestone1]]);

// Iteration lookup
const iterationById = new Map<string, any>([['gid://gitlab/Iteration/1', iteration1]]);

// ---------------------------------------------------------------------------
// THE RESOLVER MAP
// ---------------------------------------------------------------------------
export const gitlab: ResolverMap = {
    Query: {
        // Singletons
        currentUser: () => currentUser,

        // GID lookups
        mergeRequest: (_src, args) => mrById.get(String(args.id)) ?? null,
        issue: (_src, args) => issueById.get(String(args.id)) ?? null,
        milestone: (_src, args) => milestoneById.get(String(args.id)) ?? null,
        iteration: (_src, args) => iterationById.get(String(args.id)) ?? null,

        // fullPath lookups — fall back to dynamic entity for unknown paths
        project: (_src, args) => {
            const fp = String(args.fullPath ?? '');
            return (
                projectByPath.get(fp) ??
                mkProject(
                    `gid://gitlab/Project/${h(`Project#${fp}`) % 100000}`,
                    fp.split('/').pop() ?? fp,
                    fp,
                )
            );
        },
        group: (_src, args) => {
            const fp = String(args.fullPath ?? '');
            return (
                groupByPath.get(fp) ??
                mkGroup(
                    `gid://gitlab/Group/${h(`Group#${fp}`) % 100000}`,
                    fp,
                    fp.split('/').pop() ?? fp,
                )
            );
        },

        // Namespace lookup (returns a Group acting as Namespace)
        namespace: (_src, args) => {
            const fullPath = String(args.fullPath ?? '');
            return groupByPath.get(fullPath) ?? projectByPath.get(fullPath) ?? groupMain;
        },

        // workItem by global id
        workItem: (_src, args) => {
            const id = String(args.id ?? '');
            return (
                [workItemGitlabOrg1, ...groupWorkItems].find((wi) => wi.id === id) ??
                workItemGitlabOrg1
            );
        },

        // projects (root-level)
        projects: (_src, args) => {
            const allProjects = [
                projectMain,
                gitlabOrgGitlab,
                ...groupProjects,
                ...group100Projects,
            ];
            return conn(allProjects, args);
        },

        // Collections
        groups: (_src, args) => conn(topLevelGroups, args),
        runners: (_src, args) => conn(rootRunners, args),
        timelogs: (_src, args) => {
            const projectId = args.projectId as string | undefined;
            const timelogs_list =
                projectId === 'gid://gitlab/Project/1' ? projectTimelogs : timelogs;
            const c = conn(timelogs_list, args) as any;
            c.totalSpentTime = timelogs_list.reduce(
                (sum: number, t: any) => sum + (t.timeSpent ?? 0),
                0,
            );
            return c;
        },
        issues: (_src, args) => {
            let list = [issue1, issueDue1, issueDue2, groupIssue1, groupIssue2];
            const dueAfter = args.dueAfter as string | undefined;
            const dueBefore = args.dueBefore as string | undefined;
            if (dueAfter || dueBefore) {
                list = list.filter((i) => {
                    if (!i.dueDate) return false;
                    if (dueAfter && i.dueDate < dueAfter) return false;
                    if (dueBefore && i.dueDate > dueBefore) return false;
                    return true;
                });
            }
            return conn(list, args);
        },
        ciMinutesUsage: (_src, args) => conn(ciMinutesUsage, args),
        addOnPurchases: () => addOnPurchases,
    },

    // ---- CurrentUser connection fields (mirrors UserCore resolvers; currentUser query returns CurrentUser type) ----
    CurrentUser: {
        assignedMergeRequests: (src: any, args: any) => {
            let list: any[] = src.assignedMergeRequests ?? [];
            const state = args.state as string | undefined;
            if (state) list = list.filter((m) => m.state === state);
            return conn(list, args);
        },
        reviewRequestedMergeRequests: (src: any, args: any) => {
            const list: any[] = src.reviewRequestedMergeRequests ?? [];
            return conn(list, args);
        },
        authoredMergeRequests: (src: any, args: any) => {
            let list: any[] = src.authoredMergeRequests ?? [];
            if (Array.isArray(list)) {
                const state = args.state as string | undefined;
                const mergedAfter = args.mergedAfter as string | undefined;
                const mergedBefore = args.mergedBefore as string | undefined;
                if (state) list = list.filter((m) => m.state === state);
                if (mergedAfter) list = list.filter((m) => m.mergedAt && m.mergedAt >= mergedAfter);
                if (mergedBefore)
                    list = list.filter((m) => m.mergedAt && m.mergedAt <= mergedBefore);
                return conn(list, args);
            }
            return list;
        },
        todos: (src: any, args: any) => {
            let list: any[] = src.todos ?? [];
            const states = args.state as string[] | undefined;
            if (states && states.length > 0) {
                list = list.filter((t) => states.includes(t.state));
            }
            return conn(list, args);
        },
        contributedProjects: (src: any, args: any) => conn(src.contributedProjects ?? [], args),
        snippets: (src: any, args: any) => conn(src.snippets ?? [], args),
        runners: (src: any, args: any) => conn(src.runners ?? [], args),
        workItems: (src: any, args: any) => {
            let list: any[] = src.workItems ?? [];
            const confidential = args.confidential as boolean | undefined;
            if (confidential === true) list = list.filter((wi: any) => wi.confidential === true);
            else if (confidential === false)
                list = list.filter((wi: any) => wi.confidential === false);
            return conn(list, args);
        },
    },

    // ---- UserCore connection fields ----
    UserCore: {
        assignedMergeRequests: (src: any, args: any) => {
            let list: any[] = src.assignedMergeRequests ?? [];
            const state = args.state as string | undefined;
            if (state) list = list.filter((m) => m.state === state);
            return conn(list, args);
        },
        reviewRequestedMergeRequests: (src: any, args: any) => {
            const list: any[] = src.reviewRequestedMergeRequests ?? [];
            return conn(list, args);
        },
        authoredMergeRequests: (src: any, args: any) => {
            let list: any[] = src.authoredMergeRequests ?? [];
            if (Array.isArray(list)) {
                const state = args.state as string | undefined;
                const mergedAfter = args.mergedAfter as string | undefined;
                const mergedBefore = args.mergedBefore as string | undefined;
                if (state) list = list.filter((m) => m.state === state);
                if (mergedAfter) list = list.filter((m) => m.mergedAt && m.mergedAt >= mergedAfter);
                if (mergedBefore)
                    list = list.filter((m) => m.mergedAt && m.mergedAt <= mergedBefore);
                return conn(list, args);
            }
            // It's an object with count (e.g. on MergeRequestReviewer)
            return list;
        },
        todos: (src: any, args: any) => {
            let list: any[] = src.todos ?? [];
            const states = args.state as string[] | undefined;
            if (states && states.length > 0) {
                list = list.filter((t) => states.includes(t.state));
            }
            return conn(list, args);
        },
        contributedProjects: (src: any, args: any) => conn(src.contributedProjects ?? [], args),
        snippets: (src: any, args: any) => conn(src.snippets ?? [], args),
        runners: (src: any, args: any) => conn(src.runners ?? [], args),
    },

    // ---- MergeRequest connection fields ----
    MergeRequest: {
        discussions: (src: any, args: any) => conn(src.discussions ?? [], args),
        reviewers: (src: any, args: any) => conn(src.reviewers ?? [], args),
        changeRequesters: (src: any, args: any) => conn(src.changeRequesters ?? [], args),
        commenters: (src: any, args: any) => conn(src.commenters ?? [], args),
        notes: (src: any, args: any) => conn(src.notes ?? [], args),
    },

    // ---- Project connection fields ----
    Project: {
        pipelines: (src: any, args: any) => {
            let list: any[] = src.pipelines ?? [];
            const status = args.status as string | undefined;
            const ref = args.ref as string | undefined;
            const updatedAfter = args.updatedAfter as string | undefined;
            if (status) list = list.filter((p) => p.status === status);
            if (ref) list = list.filter((p) => p.ref === ref);
            // For updatedAfter we include all (simplified: data was created before ref date, filter passes)
            // since we have pipelines with createdAt before reference
            return conn(list, args);
        },
        mergeRequests: (src: any, args: any) => {
            let list: any[] = src.mergeRequests ?? [];
            const state = args.state as string | undefined;
            if (state) list = list.filter((m) => m.state === state);
            const c = conn(list, args) as any;
            c.count = list.length;
            return c;
        },
        issues: (src: any, args: any) => conn(src.issues ?? [], args),
        boards: (src: any, args: any) => conn(src.boards ?? [], args),
        mergeTrains: (src: any, args: any) => conn(src.mergeTrains ?? [], args),
        environments: (src: any, args: any) => conn(src.environments ?? [], args),
        environment: (src: any, args: any) => {
            const name = args.name as string | undefined;
            if (name) return envByName.get(name) ?? src.environments?.[0] ?? null;
            return src.environments?.[0] ?? null;
        },
        releases: (src: any, args: any) => conn(src.releases ?? [], args),
        ciVariables: (src: any, args: any) => conn(src.ciVariables ?? [], args),
        inheritedCiVariables: (src: any, args: any) => conn(src.inheritedCiVariables ?? [], args),
        ciAccessAuthorizedAgents: (src: any, args: any) =>
            conn(src.ciAccessAuthorizedAgents ?? [], args),
        pipelineSchedules: (src: any, args: any) => conn(src.pipelineSchedules ?? [], args),
        vulnerabilities: (src: any, args: any) => {
            let list: any[] = src.vulnerabilities ?? [];
            const rawSeverity = args.severity as string | string[] | undefined;
            const rawState = args.state as string | string[] | undefined;
            const severities =
                rawSeverity == null
                    ? null
                    : Array.isArray(rawSeverity)
                      ? rawSeverity
                      : [rawSeverity];
            const states =
                rawState == null ? null : Array.isArray(rawState) ? rawState : [rawState];
            if (severities) list = list.filter((v) => severities.includes(v.severity));
            if (states) list = list.filter((v) => states.includes(v.state));
            return conn(list, args);
        },
        dependencies: (src: any, args: any) => conn(src.dependencies ?? [], args),
        dastProfiles: (src: any, args: any) => conn(src.dastProfiles ?? [], args),
        scanExecutionPolicies: (src: any, args: any) => conn(src.scanExecutionPolicies ?? [], args),
        approvalPolicies: (src: any, args: any) => conn(src.approvalPolicies ?? [], args),
        branchRules: (src: any) => conn(src.branchRules ?? [], {}),
        issue: (src: any, args: any) => {
            const iid = args.iid as string | undefined;
            if (iid) {
                return (src.issues ?? []).find((i: any) => i.iid === iid) ?? null;
            }
            return (src.issues ?? [])[0] ?? null;
        },
        timelogs: (src: any, args: any) => {
            const list: any[] = src.timelogs ?? timelogs;
            const c = conn(list, args) as any;
            c.totalSpentTime = list.reduce((sum: number, t: any) => sum + (t.timeSpent ?? 0), 0);
            return c;
        },
        vulnerabilitiesCountByDay: (src: any, args: any) =>
            conn(src.vulnerabilitiesCountByDay ?? vulnCountByDay, args),
        securityTrainingUrls: (_src: any, _args: any) => [
            {
                __typename: 'SecurityTrainingUrl',
                _seed: h('SecurityTrainingUrl#1'),
                identifier: 'CVE-2024-001',
                name: 'Secure Code Warrior',
                status: 'COMPLETED',
                url: 'https://www.securecodewarrior.com/training/cve-2024-001',
            },
            {
                __typename: 'SecurityTrainingUrl',
                _seed: h('SecurityTrainingUrl#2'),
                identifier: 'CWE-89',
                name: 'Kontra',
                status: 'PENDING',
                url: 'https://application.security/training/cwe-89',
            },
        ],
    },

    // ---- Repository ----
    Repository: {
        commits: (src: any, args: any) => conn(src.commits ?? [], args),
        commit: (src: any, args: any) => {
            // Return the head commit regardless of ref for this mock
            return (src.commits ?? [])[0] ?? headCommit;
        },
        branchNames: (src: any, args: any) => {
            const names: string[] = src._branchNames ?? ['main'];
            const pattern = (args.searchPattern as string | undefined) ?? '';
            if (pattern && pattern !== '*') {
                return names.filter((n) => n === pattern || n.includes(pattern));
            }
            const limit = args.limit as number | undefined;
            return limit != null ? names.slice(0, limit) : names;
        },
    },

    // ---- Group connection fields ----
    Group: {
        groupMembers: (src: any, args: any) => conn(src.groupMembers ?? [], args),
        projects: (src: any, args: any) => conn(src.projects ?? [], args),
        runners: (src: any, args: any) => {
            let list: any[] = src.runners ?? [];
            const paused = args.paused as boolean | undefined;
            if (paused === true) list = list.filter((r) => r.paused === true);
            else if (paused === false) list = list.filter((r) => r.paused === false);
            return conn(list, args);
        },
        vulnerabilities: (src: any, args: any) => conn(src.vulnerabilities ?? [], args),
        vulnerabilitiesCountByDay: (src: any, args: any) =>
            conn(src.vulnerabilitiesCountByDay ?? [], args),
        epics: (src: any, args: any) => {
            let list: any[] = src.epics ?? [];
            const iid = args.iid as string | undefined;
            if (iid) list = list.filter((e) => e.iid === iid);
            return conn(list, args);
        },
        iterations: (src: any, args: any) => conn(src.iterations ?? [], args),
        iterationCadences: (src: any, args: any) => conn(src.iterationCadences ?? [], args),
        milestones: (src: any, args: any) => conn(src.milestones ?? [], args),
        issues: (src: any, args: any) => {
            let list: any[] = src.issues ?? [];
            const createdAfter = args.createdAfter as string | undefined;
            // For createdAfter filter: all group issues have no explicit createdAt so we pass them all
            const sort = args.sort as string | undefined;
            if (sort === 'POPULARITY_DESC')
                list = [...list].sort((a, b) => (b.upvotes ?? 0) - (a.upvotes ?? 0));
            return conn(list, args);
        },
        workItems: (src: any, args: any) => conn(src.workItems ?? [], args),
        workItem: (src: any, args: any) => {
            const iid = args.iid as string | undefined;
            if (typeof src.workItem === 'function') return src.workItem(iid);
            if (iid) return workItemByIid.get(iid) ?? null;
            return src.workItem ?? null;
        },
        board: (src: any, args: any) => {
            const id = args.id as string | undefined;
            if (typeof src.board === 'function') return src.board(id ?? '');
            if (id === 'gid://gitlab/Board/1') return board1;
            return src.board ?? null;
        },
        descendantGroups: (src: any, args: any) => conn(src.descendantGroups ?? [], args),
        pendingMemberApprovals: (src: any, args: any) =>
            conn(src.pendingMemberApprovals ?? [], args),
        scanExecutionPolicies: (src: any, args: any) =>
            conn(src.scanExecutionPolicies ?? scanExecutionPolicies, args),
        approvalPolicies: (src: any, args: any) =>
            conn(src.approvalPolicies ?? approvalPolicies, args),
        clusterAgents: (src: any, args: any) => conn(src.clusterAgents ?? [agent1, agent2], args),
        dependencies: (src: any, args: any) => conn(src.dependencies ?? dependencies, args),
        epic: (src: any, args: any) => {
            const iid = args.iid as string | undefined;
            const epics: any[] = src.epics ?? [];
            if (iid) return epics.find((e: any) => e.iid === iid) ?? null;
            return epics[0] ?? null;
        },
    },

    // ---- Epic connection fields ----
    Epic: {
        children: (src: any, args: any) => conn(src.children ?? [], args),
        blockedByEpics: (src: any, args: any) => conn(src.blockedByEpics ?? [], args),
    },

    // ---- Issue connection fields ----
    Issue: {
        labels: (src: any, args: any) => conn(src.labels ?? [], args),
        blockedByIssues: (src: any, args: any) => conn(src.blockedByIssues ?? [], args),
    },

    // ---- Vulnerability connection fields ----
    Vulnerability: {
        issueLinks: (src: any, args: any) => conn(src.issueLinks ?? [], args),
    },

    // ---- Pipeline connection fields ----
    Pipeline: {
        jobs: (src: any, args: any) => {
            let list: any[] = src.jobs ?? [];
            const rawStatuses = args.statuses as string | string[] | undefined;
            if (rawStatuses) {
                const statuses = Array.isArray(rawStatuses) ? rawStatuses : [rawStatuses];
                list = list.filter((j) => statuses.includes(j.status));
            }
            return conn(list, args);
        },
        stages: (src: any, args: any) => conn(src.stages ?? [], args),
        securityReportFindings: (src: any, args: any) =>
            conn(src.securityReportFindings ?? [], args),
    },

    // ---- CiStage fields ----
    CiStage: {
        jobs: (src: any) => conn(src.jobs ?? [], {}),
    },

    // ---- CiJob fields ----
    CiJob: {
        artifacts: (src: any, args: any) => conn(src.artifacts ?? [], args),
    },

    // ---- CiRunner fields ----
    CiRunner: {
        jobs: (src: any, args: any) => {
            let list: any[] = src.jobs ?? [];
            const rawStatuses = args.statuses as string | string[] | undefined;
            if (rawStatuses) {
                const statuses = Array.isArray(rawStatuses) ? rawStatuses : [rawStatuses];
                list = list.filter((j) => statuses.includes(j.status));
            }
            return conn(list, args);
        },
    },

    // ---- Commit connection fields ----
    Commit: {
        pipelines: (src: any, args: any) => conn(src.pipelines ?? [], args),
    },

    // ---- BranchProtection connection fields ----
    BranchProtection: {
        mergeAccessLevels: (src: any, args: any) => conn(src.mergeAccessLevels ?? [], args),
        pushAccessLevels: (src: any, args: any) => conn(src.pushAccessLevels ?? [], args),
        unprotectAccessLevels: (src: any, args: any) => conn(src.unprotectAccessLevels ?? [], args),
    },

    // ---- SecurityReportSummarySection fields ----
    SecurityReportSummarySection: {
        scans: (src: any, args: any) => conn(src.scans ?? [], args),
    },

    // ---- Board connection fields ----
    Board: {
        lists: (src: any, args: any) => conn(src.lists ?? [], args),
        epics: (src: any, args: any) => conn(src.epics ?? [], args),
    },

    // ---- Environment connection fields ----
    Environment: {
        deployments: (src: any, args: any) => conn(src.deployments ?? [], args),
        protectedEnvironments: (src: any, args: any) => conn(src.protectedEnvironments ?? [], args),
    },

    // ---- MergeTrain connection fields ----
    MergeTrain: {
        cars: (src: any, args: any) => conn(src.cars ?? [], args),
    },

    // ---- Release connection fields ----
    Release: {
        milestones: (src: any, args: any) => conn(src.milestones ?? [], args),
        evidences: (src: any, args: any) => conn(src.evidences ?? [], args),
    },

    // ---- ReleaseAssets connection fields ----
    ReleaseAssets: {
        links: (src: any, args: any) => conn(src.links ?? [], args),
    },

    // ---- PipelineSchedule ----
    PipelineSchedule: {
        // lastPipeline is already a direct object ref — handled by default resolver
    },
};
