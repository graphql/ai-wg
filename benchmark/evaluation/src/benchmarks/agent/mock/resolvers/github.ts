/**
 * Self-contained natural GraphQL server for the "github" schema.
 *
 * Architecture: ONE plain JS object per logical entity, with DIRECT references between
 * related entities (no FK strings, no store lookups). Path-independence is free because
 * repository(owner:"octocat",name:"example") and org.repositories.nodes[0] are the
 * IDENTICAL JS object when both reference the same repo.
 *
 * Connection fields get a resolver (source,args)=>conn(source.<field>,args).
 * Root Query fields always get a resolver.
 * Scalar/single-object/plain-list fields: value on the entity, served by the default resolver.
 *
 * Dates anchored to REFERENCE_TODAY = 2025-06-01.
 */
import { stableHash } from '../seed.ts';
import type { ResolverMap } from '../types.ts';

// ---------------------------------------------------------------------------
// Local connection helper — mirrors the shape common.ts produces, but local.
// ---------------------------------------------------------------------------
interface ConnArgs {
    first?: number;
    last?: number;
}

function conn(nodes: any[], args: ConnArgs = {}) {
    const limit = args.first ?? args.last ?? nodes.length;
    const slice =
        args.last != null && args.first == null
            ? nodes.slice(Math.max(0, nodes.length - args.last))
            : nodes.slice(0, limit);
    const edges = slice.map((n: any, i: number) => ({ node: n, cursor: String(i) }));
    return {
        nodes: slice,
        edges,
        totalCount: nodes.length,
        count: nodes.length,
        pageInfo: {
            hasNextPage: args.first != null && nodes.length > (args.first ?? 0),
            hasPreviousPage: false,
            startCursor: edges.length > 0 ? '0' : null,
            endCursor: edges.length > 0 ? String(edges.length - 1) : null,
        },
    };
}

// ---------------------------------------------------------------------------
// Seed helpers — deterministic scalars from entity identity
// ---------------------------------------------------------------------------
function h(key: string) {
    return stableHash(key);
}

// REFERENCE_TODAY = 2025-06-01T00:00:00Z (epoch ms: 1748736000000)
const REF_MS = 1748736000000;

function mkDate(offsetDays: number): string {
    return new Date(REF_MS - offsetDays * 86400000).toISOString();
}

// ---------------------------------------------------------------------------
// ACTORS / USERS
// ---------------------------------------------------------------------------
function mkUser(login: string, name: string, opts: Record<string, any> = {}) {
    const id = h(`User#${login}`);
    return {
        __typename: 'User',
        id: `user-${login}`,
        _seed: id,
        login,
        name,
        viewerIsFollowing: opts.viewerIsFollowing ?? false,
        updatedAt: opts.updatedAt ?? mkDate(10 + (id % 50)),
        url: `https://github.com/${login}`,
        email: `${login}@example.com`,
        avatarUrl: `https://avatars.githubusercontent.com/u/${id % 9999}`,
        bio: null,
        company: null,
        location: null,
        // connection arrays (populated later)
        starredRepositories: [] as any[],
        gists: [] as any[],
        issueComments: [] as any[],
        repositories: [] as any[],
        organizations: [] as any[],
        following: [] as any[],
        followers: [] as any[],
        pinnedItems: [] as any[],
        ...opts,
    };
}

const userOctocat = mkUser('octocat', 'The Octocat');
const userViewer = mkUser('viewer-user', 'Viewer User', { viewerIsFollowing: false });
const userAlice = mkUser('alice', 'Alice Dev');
const userBob = mkUser('bob', 'Bob Coder', { viewerIsFollowing: true });
const userCarol = mkUser('carol', 'Carol Engineer', { viewerIsFollowing: false });
const userDave = mkUser('dave', 'Dave Dev', { viewerIsFollowing: true });
const userEve = mkUser('eve', 'Eve Hacker', { viewerIsFollowing: false });
const userFrank = mkUser('frank', 'Frank Admin', { viewerIsFollowing: false });
const userGrace = mkUser('grace', 'Grace Lead', { viewerIsFollowing: false });
const userHenry = mkUser('henry', 'Henry Member', { viewerIsFollowing: false });
const userIris = mkUser('iris', 'Iris Owner', { viewerIsFollowing: false });

const userByLogin = new Map<string, any>([
    ['octocat', userOctocat],
    ['viewer-user', userViewer],
    ['alice', userAlice],
    ['bob', userBob],
    ['carol', userCarol],
    ['dave', userDave],
    ['eve', userEve],
    ['frank', userFrank],
    ['grace', userGrace],
    ['henry', userHenry],
    ['iris', userIris],
]);

// ---------------------------------------------------------------------------
// LICENSES / CODE OF CONDUCT / TOPICS
// ---------------------------------------------------------------------------
const licenseMIT = {
    __typename: 'License',
    id: 'license-mit',
    _seed: h('License#mit'),
    name: 'MIT License',
    spdxId: 'MIT',
};
const licenseApache = {
    __typename: 'License',
    id: 'license-apache',
    _seed: h('License#apache'),
    name: 'Apache License 2.0',
    spdxId: 'Apache-2.0',
};
const codeOfConduct = {
    __typename: 'CodeOfConduct',
    id: 'coc-1',
    _seed: h('CodeOfConduct#coc-1'),
    name: 'Contributor Covenant',
    body: 'Be nice.',
};
const topicGraphQL = {
    __typename: 'Topic',
    id: 'topic-graphql',
    _seed: h('Topic#graphql'),
    name: 'graphql',
};
const topicAPI = { __typename: 'Topic', id: 'topic-api', _seed: h('Topic#api'), name: 'api' };
const topicOctocat = {
    __typename: 'Topic',
    id: 'topic-octocat',
    _seed: h('Topic#octocat'),
    name: 'octocat',
};

// ---------------------------------------------------------------------------
// BRANCHES / REFS / COMMITS
// ---------------------------------------------------------------------------
// Git actor helpers
const GIT_ACTOR_NAMES = [
    'Alice Dev',
    'Bob Coder',
    'Carol Engineer',
    'Dave Dev',
    'Eve Hacker',
    'Frank Admin',
    'Grace Lead',
    'Henry Member',
    'Iris Owner',
    'Jack Builder',
    'Karen Reviewer',
    'Liam Tester',
    'Mia Deployer',
    'Noah Architect',
    'Olivia Ops',
];
const GIT_ACTOR_LOGINS = [
    'alice',
    'bob',
    'carol',
    'dave',
    'eve',
    'frank',
    'grace',
    'henry',
    'iris',
    'jack',
    'karen',
    'liam',
    'mia',
    'noah',
    'olivia',
];
function mkGitActor(seed: number) {
    const idx = stableHash(`GitActor#${seed}`) % GIT_ACTOR_NAMES.length;
    const name = GIT_ACTOR_NAMES[idx]!;
    const login = GIT_ACTOR_LOGINS[idx]!;
    return {
        __typename: 'GitActor',
        _seed: seed,
        name,
        email: `${login}@example.com`,
    };
}

// Commits for HEAD of octocat/example — anchored to 2025-06-01
const COMMIT_MESSAGES = [
    'fix: resolve null pointer in authentication middleware',
    'feat: add support for pagination in repository list',
    'chore: update dependencies to latest stable versions',
    'refactor: extract token validation into separate service',
    'fix: correct race condition in concurrent request handling',
    'feat: implement GraphQL subscription support',
    'docs: update API reference for repository endpoints',
    'test: add integration tests for OAuth flow',
    'fix: handle edge case when branch name contains slashes',
    'perf: optimize database query for issue listing',
    'feat: add webhook delivery retry logic',
    'chore: clean up unused imports and dead code',
    'fix: prevent XSS in markdown renderer',
    'refactor: simplify error handling in API client',
    'feat: expose commit signature verification status',
];
function mkCommit(id: string, opts: Record<string, any> = {}) {
    const seed = h(`Commit#${id}`);
    const msgIdx = stableHash(`Commit.message#${seed}`) % COMMIT_MESSAGES.length;
    return {
        __typename: 'Commit',
        id,
        _seed: seed,
        oid: id,
        message: COMMIT_MESSAGES[msgIdx]!,
        additions: 5 + (seed % 100),
        deletions: 2 + (seed % 50),
        changedFilesIfAvailable: 1 + (seed % 10),
        committedDate: opts.committedDate ?? mkDate(seed % 14),
        author: mkGitActor(seed),
        signature: {
            __typename: 'GpgSignature',
            _seed: seed,
            isValid: seed % 2 === 0,
            state: ['VALID', 'INVALID', 'UNSIGNED', 'MALFORMED_SIG'][seed % 4]!,
        },
        checkSuites: [] as any[],
        history: [] as any[],
        associatedPullRequests: [] as any[],
        ...opts,
    };
}

// HEAD commit for octocat/example — recent (after 2025-05-24 for gh-ext-001 since filter)
const headCommit = mkCommit('abc1234def5678901234567890abcdef12345678', {
    committedDate: mkDate(1),
});
const commit2 = mkCommit('bcd2345ef6789012345678901bcdef234567890a', { committedDate: mkDate(2) });
const commit3 = mkCommit('cde3456f789012345678901bcdef3456789012ab', { committedDate: mkDate(3) });
const commit4 = mkCommit('def4567890123456789012bcdef456789012abc3', { committedDate: mkDate(5) });
const commit5 = mkCommit('ef56789012345678901bcdef56789012abcd34de', { committedDate: mkDate(7) });

// History of headCommit — 5 recent commits (all within past 2 weeks before 2025-06-01)
headCommit.history = [headCommit, commit2, commit3, commit4, commit5];
// associatedPullRequests is populated after PRs are created (below)

// Check suites for HEAD commit
const checkSuite1 = {
    __typename: 'CheckSuite',
    id: 'cs-1',
    _seed: h('CheckSuite#cs-1'),
    status: 'QUEUED',
    conclusion: null,
    workflowRun: {
        __typename: 'WorkflowRun',
        id: 'wr-1',
        _seed: h('WorkflowRun#wr-1'),
        runNumber: 42,
        createdAt: mkDate(3),
        event: 'push',
        workflow: { __typename: 'Workflow', id: 'wf-1', _seed: h('Workflow#wf-1'), name: 'CI' },
    },
    checkRuns: [] as any[],
};
const checkSuite2 = {
    __typename: 'CheckSuite',
    id: 'cs-2',
    _seed: h('CheckSuite#cs-2'),
    status: 'QUEUED',
    conclusion: null,
    workflowRun: {
        __typename: 'WorkflowRun',
        id: 'wr-2',
        _seed: h('WorkflowRun#wr-2'),
        runNumber: 43,
        createdAt: mkDate(2),
        event: 'pull_request',
        workflow: { __typename: 'Workflow', id: 'wf-2', _seed: h('Workflow#wf-2'), name: 'Deploy' },
    },
    checkRuns: [] as any[],
};
const checkSuite3 = {
    __typename: 'CheckSuite',
    id: 'cs-3',
    _seed: h('CheckSuite#cs-3'),
    status: 'REQUESTED',
    conclusion: null,
    workflowRun: {
        __typename: 'WorkflowRun',
        id: 'wr-3',
        _seed: h('WorkflowRun#wr-3'),
        runNumber: 44,
        createdAt: mkDate(1),
        event: 'push',
        workflow: { __typename: 'Workflow', id: 'wf-1', _seed: h('Workflow#wf-1'), name: 'CI' },
    },
    checkRuns: [] as any[],
};
const checkSuite4 = {
    __typename: 'CheckSuite',
    id: 'cs-4',
    _seed: h('CheckSuite#cs-4'),
    status: 'COMPLETED',
    conclusion: 'SUCCESS',
    workflowRun: {
        __typename: 'WorkflowRun',
        id: 'wr-4',
        _seed: h('WorkflowRun#wr-4'),
        runNumber: 41,
        createdAt: mkDate(10),
        event: 'push',
        workflow: { __typename: 'Workflow', id: 'wf-1', _seed: h('Workflow#wf-1'), name: 'CI' },
    },
    checkRuns: [] as any[],
};
const checkSuite5 = {
    __typename: 'CheckSuite',
    id: 'cs-5',
    _seed: h('CheckSuite#cs-5'),
    status: 'WAITING',
    conclusion: null,
    workflowRun: {
        __typename: 'WorkflowRun',
        id: 'wr-5',
        _seed: h('WorkflowRun#wr-5'),
        runNumber: 45,
        createdAt: mkDate(0),
        event: 'push',
        workflow: { __typename: 'Workflow', id: 'wf-2', _seed: h('Workflow#wf-2'), name: 'Deploy' },
    },
    checkRuns: [] as any[],
};

// Check runs
const checkRun1 = {
    __typename: 'CheckRun',
    id: 'cr-1',
    _seed: h('CheckRun#cr-1'),
    name: 'test',
    startedAt: mkDate(3),
    completedAt: mkDate(2),
};
const checkRun2 = {
    __typename: 'CheckRun',
    id: 'cr-2',
    _seed: h('CheckRun#cr-2'),
    name: 'lint',
    startedAt: mkDate(3),
    completedAt: mkDate(3),
};
const checkRun3 = {
    __typename: 'CheckRun',
    id: 'cr-3',
    _seed: h('CheckRun#cr-3'),
    name: 'build',
    startedAt: mkDate(2),
    completedAt: mkDate(2),
};

checkSuite1.checkRuns = [checkRun1, checkRun2];
checkSuite4.checkRuns = [checkRun1, checkRun2, checkRun3];
headCommit.checkSuites = [checkSuite1, checkSuite2, checkSuite3, checkSuite4, checkSuite5];

// Branch protection rule for main
const branchProtectionRule1 = {
    __typename: 'BranchProtectionRule',
    id: 'bpr-1',
    _seed: h('BranchProtectionRule#bpr-1'),
    pattern: 'main',
    requiredStatusCheckContexts: ['ci/test', 'ci/lint'],
    pushAllowances: [] as any[],
};
const branchProtectionRule2 = {
    __typename: 'BranchProtectionRule',
    id: 'bpr-2',
    _seed: h('BranchProtectionRule#bpr-2'),
    pattern: 'release/**',
    requiredStatusCheckContexts: ['ci/build'],
    pushAllowances: [] as any[],
};

// Push allowances: User, Team, App
const pushAllowanceUser = {
    __typename: 'PushAllowance',
    id: 'pa-user',
    _seed: h('PushAllowance#user'),
    actor: {
        __typename: 'User',
        id: 'pa-user-actor',
        _seed: h('User#pa-alice'),
        login: 'alice',
        name: 'Alice Dev',
    },
};
const pushAllowanceTeam = {
    __typename: 'PushAllowance',
    id: 'pa-team',
    _seed: h('PushAllowance#team'),
    actor: {
        __typename: 'Team',
        id: 'pa-team-actor',
        _seed: h('Team#devops'),
        name: 'devops',
        slug: 'devops',
    },
};
const pushAllowanceApp = {
    __typename: 'PushAllowance',
    id: 'pa-app',
    _seed: h('PushAllowance#app'),
    actor: { __typename: 'App', id: 'pa-app-actor', _seed: h('App#ci-bot'), name: 'CI Bot' },
};
branchProtectionRule1.pushAllowances = [pushAllowanceUser, pushAllowanceTeam, pushAllowanceApp];
branchProtectionRule2.pushAllowances = [pushAllowanceUser];

// Default branch ref for octocat/example
const mainRef: any = {
    __typename: 'Ref',
    id: 'ref-main',
    _seed: h('Ref#main'),
    name: 'main',
    prefix: 'refs/heads/',
    target: headCommit,
    branchProtectionRule: branchProtectionRule1,
    compare: {
        __typename: 'Comparison',
        id: 'compare-1',
        _seed: h('Comparison#1'),
        aheadBy: 3,
        behindBy: 0,
        baseTarget: headCommit,
        status: 'AHEAD',
    },
    associatedPullRequests: [] as any[],
};

// ---------------------------------------------------------------------------
// STATUS CHECK ROLLUP
// ---------------------------------------------------------------------------
const statusContext1 = {
    __typename: 'StatusContext',
    id: 'sc-1',
    _seed: h('StatusContext#1'),
    context: 'ci/test',
    state: 'SUCCESS',
    targetUrl: 'https://ci.example.com/builds/1001',
    isRequired: true,
};
const statusContext2 = {
    __typename: 'StatusContext',
    id: 'sc-2',
    _seed: h('StatusContext#2'),
    context: 'ci/lint',
    state: 'SUCCESS',
    targetUrl: 'https://ci.example.com/builds/1002',
    isRequired: true,
};
const statusContext3 = {
    __typename: 'StatusContext',
    id: 'sc-3',
    _seed: h('StatusContext#3'),
    context: 'ci/build',
    state: 'PENDING',
    targetUrl: 'https://ci.example.com/builds/1003',
    isRequired: false,
};
const statusCheckRollup = {
    __typename: 'StatusCheckRollup',
    id: 'scr-1',
    _seed: h('StatusCheckRollup#1'),
    state: 'PENDING',
    contexts: [statusContext1, statusContext2, statusContext3],
};

// ---------------------------------------------------------------------------
// PULL REQUESTS for octocat/example
// ---------------------------------------------------------------------------
function mkPR(
    id: string,
    number: number,
    title: string,
    state: string,
    opts: Record<string, any> = {},
) {
    const seed = h(`PullRequest#${id}`);
    return {
        __typename: 'PullRequest',
        id,
        _seed: seed,
        number,
        title,
        state,
        closed: state === 'CLOSED' || state === 'MERGED',
        isDraft: opts.isDraft ?? false,
        additions: opts.additions ?? 10 + (seed % 200),
        deletions: opts.deletions ?? 5 + (seed % 100),
        mergedAt: state === 'MERGED' ? (opts.mergedAt ?? mkDate(10 + (seed % 30))) : null,
        createdAt: opts.createdAt ?? mkDate(30 + (seed % 60)),
        headRefName: opts.headRefName ?? `feature/${id}`,
        totalCommentsCount: seed % 20,
        url: `https://github.com/octocat/example/pull/${number}`,
        author: opts.author ?? userAlice,
        baseRef: mainRef,
        statusCheckRollup: opts.statusCheckRollup ?? statusCheckRollup,
        repository: null as any, // set after repo is created
        files: [] as any[],
        reviews: [] as any[],
        reviewRequests: [] as any[],
        reviewThreads: [] as any[],
        commits: [] as any[],
        comments: [] as any[],
        timelineItems: [] as any[],
        closingIssuesReferences: [] as any[],
        ...opts,
    };
}

// PR #1 (specific: gh-ext-006, gh-ext-019, gh-ext-031, gh-ext-066, gh-ext-067)
const pr1 = mkPR('pr-1', 1, 'Add GraphQL endpoint', 'OPEN', { author: userAlice, isDraft: false });

// PR #42 (specific: gh-ext-011 - additions:308, deletions:302)
const pr42 = mkPR('pr-42', 42, 'Refactor authentication module', 'MERGED', {
    additions: 308,
    deletions: 302,
    mergedAt: mkDate(15),
});

// Additional PRs for connections
const pr2 = mkPR('pr-2', 2, 'Fix login bug', 'OPEN', { author: userBob, isDraft: true });
const pr3 = mkPR('pr-3', 3, 'Update dependencies', 'MERGED', { author: userCarol });
const pr4 = mkPR('pr-4', 4, 'Add dark mode', 'OPEN', { author: userDave, isDraft: true });
const pr5 = mkPR('pr-5', 5, 'Improve search performance', 'OPEN', { author: userEve });
const pr6 = mkPR('pr-6', 6, 'Fix security vulnerability', 'CLOSED', { author: userFrank });
const pr7 = mkPR('pr-7', 7, 'Add CI pipeline', 'MERGED', { author: userGrace });
const pr8 = mkPR('pr-8', 8, 'Update documentation', 'OPEN', { author: userAlice });
const pr9 = mkPR('pr-9', 9, 'Implement rate limiting', 'OPEN', { author: userBob });
const pr10 = mkPR('pr-10', 10, 'Refactor data layer', 'MERGED', { author: userCarol });

// PR files
const prFile1 = {
    __typename: 'PullRequestChangedFile',
    id: 'pf-1',
    _seed: h('PullRequestChangedFile#1'),
    path: 'src/auth/token.ts',
};
const prFile2 = {
    __typename: 'PullRequestChangedFile',
    id: 'pf-2',
    _seed: h('PullRequestChangedFile#2'),
    path: 'src/auth/middleware.ts',
};
const prFile3 = {
    __typename: 'PullRequestChangedFile',
    id: 'pf-3',
    _seed: h('PullRequestChangedFile#3'),
    path: 'tests/auth.test.ts',
};
pr1.files = [prFile1, prFile2];
pr42.files = [prFile1, prFile2, prFile3];

// PR reviews (gh-ext-006: CHANGES_REQUESTED state)
function mkBot(login: string) {
    return { __typename: 'Bot', id: `bot-${login}`, _seed: h(`Bot#${login}`), login };
}
const bot1 = mkBot('dependabot[bot]'.replace(/[^a-z0-9]/gi, '-'));
const bot2 = mkBot('github-actions[bot]'.replace(/[^a-z0-9]/gi, '-'));

const review1 = {
    __typename: 'PullRequestReview',
    id: 'rev-1',
    _seed: h('PullRequestReview#1'),
    body: 'Please fix the error handling.',
    bodyText: 'Please fix the error handling.',
    state: 'CHANGES_REQUESTED',
    author: bot1,
};
const review2 = {
    __typename: 'PullRequestReview',
    id: 'rev-2',
    _seed: h('PullRequestReview#2'),
    body: 'Looks good overall but needs fixes.',
    bodyText: 'Looks good overall but needs fixes.',
    state: 'CHANGES_REQUESTED',
    author: bot2,
};
const review3 = {
    __typename: 'PullRequestReview',
    id: 'rev-3',
    _seed: h('PullRequestReview#3'),
    body: 'LGTM',
    bodyText: 'LGTM',
    state: 'APPROVED',
    author: userCarol,
};
pr1.reviews = [review1, review2, review3];

// Review requests for PR#1 (gh-ext-019: asCodeOwner entries)
const mannequin1 = {
    __typename: 'Mannequin',
    id: 'mann-1',
    _seed: h('Mannequin#1'),
    login: 'mannequin-user',
};
const enterpriseTeam1 = {
    __typename: 'EnterpriseTeam',
    id: 'et-1',
    _seed: h('EnterpriseTeam#1'),
    name: 'enterprise-team',
};
const reviewRequest1 = {
    __typename: 'ReviewRequest',
    id: 'rr-1',
    _seed: h('ReviewRequest#1'),
    asCodeOwner: true,
    requestedReviewer: userAlice,
};
const reviewRequest2 = {
    __typename: 'ReviewRequest',
    id: 'rr-2',
    _seed: h('ReviewRequest#2'),
    asCodeOwner: true,
    requestedReviewer: userBob,
};
const reviewRequest3 = {
    __typename: 'ReviewRequest',
    id: 'rr-3',
    _seed: h('ReviewRequest#3'),
    asCodeOwner: false,
    requestedReviewer: bot1,
};
const reviewRequest4 = {
    __typename: 'ReviewRequest',
    id: 'rr-4',
    _seed: h('ReviewRequest#4'),
    asCodeOwner: false,
    requestedReviewer: mannequin1,
};
const reviewRequest5 = {
    __typename: 'ReviewRequest',
    id: 'rr-5',
    _seed: h('ReviewRequest#5'),
    asCodeOwner: false,
    requestedReviewer: enterpriseTeam1,
};
pr1.reviewRequests = [
    reviewRequest1,
    reviewRequest2,
    reviewRequest3,
    reviewRequest4,
    reviewRequest5,
];

// Review threads (gh-ext-012: mixed isResolved)
function mkReviewThread(id: string, isResolved: boolean) {
    return {
        __typename: 'PullRequestReviewThread',
        id,
        _seed: h(`PullRequestReviewThread#${id}`),
        isResolved,
    };
}
const thread1 = mkReviewThread('rt-1', true);
const thread2 = mkReviewThread('rt-2', false);
const thread3 = mkReviewThread('rt-3', true);
for (const pr of [pr1, pr2, pr3, pr4, pr5, pr6, pr7, pr8, pr9, pr10]) {
    pr.reviewThreads = [thread1, thread2];
}
pr1.reviewThreads = [thread1, thread2, thread3];
pr2.reviewThreads = [thread2, thread3];

// PR commits
const prCommit1 = {
    __typename: 'PullRequestCommit',
    id: 'prc-1',
    _seed: h('PullRequestCommit#1'),
    commit: headCommit,
};
const prCommit2 = {
    __typename: 'PullRequestCommit',
    id: 'prc-2',
    _seed: h('PullRequestCommit#2'),
    commit: commit2,
};
pr1.commits = [prCommit1, prCommit2];

// Timeline items: ReopenedEvent (gh-ext-016)
const reopenedEvent1 = {
    __typename: 'ReopenedEvent',
    id: 're-1',
    _seed: h('ReopenedEvent#1'),
    createdAt: mkDate(20),
    actor: userAlice,
};
const reopenedEvent2 = {
    __typename: 'ReopenedEvent',
    id: 're-2',
    _seed: h('ReopenedEvent#2'),
    createdAt: mkDate(25),
    actor: userBob,
};
for (const pr of [pr1, pr2, pr3, pr4, pr5]) {
    pr.timelineItems = [reopenedEvent1];
}
pr1.timelineItems = [reopenedEvent1, reopenedEvent2];

const allPRsExample = [pr1, pr2, pr3, pr4, pr5, pr6, pr7, pr8, pr9, pr10];
const prByNumber = new Map<number, any>([
    [1, pr1],
    [42, pr42],
]);

// Patch associatedPullRequests onto commits (needed for Deployment.commit sub-selection)
headCommit.associatedPullRequests = [pr1, pr2];
commit2.associatedPullRequests = [pr3];
commit3.associatedPullRequests = [];

// ---------------------------------------------------------------------------
// ISSUES for octocat/example
// ---------------------------------------------------------------------------
function mkIssue(
    id: string,
    number: number,
    title: string,
    state: string,
    opts: Record<string, any> = {},
) {
    const seed = h(`Issue#${id}`);
    return {
        __typename: 'Issue',
        id,
        _seed: seed,
        number,
        title,
        state,
        closed: state === 'CLOSED',
        stateReason: opts.stateReason ?? null,
        closedAt: state === 'CLOSED' ? (opts.closedAt ?? mkDate(5 + (seed % 30))) : null,
        url: `https://github.com/octocat/example/issues/${number}`,
        repository: null as any, // set after repo is created
        assignees: opts.assignees ?? ([] as any[]),
        comments: [] as any[],
        closedByPullRequestsReferences: [] as any[],
        timelineItems: [] as any[],
        labels: [] as any[],
        ...opts,
    };
}

// Issues for octocat/example
const issue1 = mkIssue('issue-1', 1, 'Bug in login flow', 'OPEN', {
    assignees: [userAlice, userBob],
});
const issue2 = mkIssue('issue-2', 2, 'Feature request: dark mode', 'OPEN', { assignees: [] }); // no assignees
const issue3 = mkIssue('issue-3', 3, 'Documentation needs update', 'OPEN', {
    assignees: [userCarol],
});
const issue4 = mkIssue('issue-4', 4, 'Performance regression', 'OPEN', {
    assignees: [userDave, userEve],
});
const issue5 = mkIssue('issue-5', 5, 'Security vulnerability', 'OPEN', { assignees: [] }); // no assignees
const issue6 = mkIssue('issue-6', 6, 'Fix broken tests', 'CLOSED', {
    stateReason: 'COMPLETED',
    closedAt: mkDate(10),
});
const issue7 = mkIssue('issue-7', 7, 'API documentation', 'CLOSED', {
    stateReason: 'COMPLETED',
    closedAt: mkDate(20),
});
const issue8 = mkIssue('issue-8', 8, 'Memory leak in worker', 'CLOSED', {
    stateReason: 'NOT_PLANNED',
    closedAt: mkDate(15),
});
const issue9 = mkIssue('issue-9', 9, 'Improve error messages', 'CLOSED', {
    stateReason: 'NOT_PLANNED',
    closedAt: mkDate(25),
});
const issue10 = mkIssue('issue-10', 10, 'Update README', 'CLOSED', {
    stateReason: 'COMPLETED',
    closedAt: mkDate(8),
});

// closedByPullRequestsReferences (gh-ext-008: includeClosedPrs: true)
pr6.state = 'CLOSED';
issue1.closedByPullRequestsReferences = [pr6];
issue6.closedByPullRequestsReferences = [pr3];

// Issue comments
const issueComment1 = {
    __typename: 'IssueComment',
    id: 'ic-1',
    _seed: h('IssueComment#1'),
    body: 'I can reproduce this.',
    createdAt: mkDate(5),
    author: userBob,
    issue: issue1,
};
const issueComment2 = {
    __typename: 'IssueComment',
    id: 'ic-2',
    _seed: h('IssueComment#2'),
    body: 'Working on a fix.',
    createdAt: mkDate(4),
    author: userAlice,
    issue: issue1,
};
const issueComment3 = {
    __typename: 'IssueComment',
    id: 'ic-3',
    _seed: h('IssueComment#3'),
    body: 'This would be nice to have.',
    createdAt: mkDate(3),
    author: userCarol,
    issue: issue2,
};
issue1.comments = [issueComment1, issueComment2];
issue2.comments = [issueComment3];
userOctocat.issueComments = [issueComment1, issueComment2, issueComment3];

const allIssuesExample = [
    issue1,
    issue2,
    issue3,
    issue4,
    issue5,
    issue6,
    issue7,
    issue8,
    issue9,
    issue10,
];

// ---------------------------------------------------------------------------
// LABELS
// ---------------------------------------------------------------------------
const labelBug = {
    __typename: 'Label',
    id: 'label-bug',
    _seed: h('Label#bug'),
    name: 'bug',
    color: 'ee0701',
    issues: [] as any[],
    pullRequests: [] as any[],
};
const labelFeature = {
    __typename: 'Label',
    id: 'label-feature',
    _seed: h('Label#feature'),
    name: 'feature',
    color: '0075ca',
    issues: [] as any[],
    pullRequests: [] as any[],
};
const labelDocs = {
    __typename: 'Label',
    id: 'label-docs',
    _seed: h('Label#documentation'),
    name: 'documentation',
    color: '0075ca',
    issues: [] as any[],
    pullRequests: [] as any[],
};
const labelSecurity = {
    __typename: 'Label',
    id: 'label-security',
    _seed: h('Label#security'),
    name: 'security',
    color: 'e4e669',
    issues: [] as any[],
    pullRequests: [] as any[],
};
const labelPerf = {
    __typename: 'Label',
    id: 'label-perf',
    _seed: h('Label#performance'),
    name: 'performance',
    color: 'fbca04',
    issues: [] as any[],
    pullRequests: [] as any[],
};
labelBug.issues = [issue1, issue5];
labelBug.pullRequests = [pr2];
labelFeature.issues = [issue2, issue3];
labelFeature.pullRequests = [pr1, pr4];
labelDocs.issues = [issue3];
labelSecurity.issues = [issue5];
labelPerf.issues = [issue4];

issue1.labels = [labelBug];
issue2.labels = [labelFeature];
issue3.labels = [labelFeature, labelDocs];
issue4.labels = [labelPerf];
issue5.labels = [labelSecurity, labelBug];

const allLabels = [labelBug, labelFeature, labelDocs, labelSecurity, labelPerf];

// ---------------------------------------------------------------------------
// DEPLOYMENTS / ENVIRONMENTS
// ---------------------------------------------------------------------------
const depProtRuleRequired = {
    __typename: 'DeploymentProtectionRule',
    id: 'dpr-1',
    _seed: h('DeploymentProtectionRule#1'),
    type: 'REQUIRED_REVIEWERS',
    timeout: 1440, // 24 hours in minutes
    preventSelfReview: false,
    reviewers: [] as any[], // populated below
};
const envStaging: any = {
    __typename: 'Environment',
    id: 'env-staging',
    _seed: h('Environment#staging'),
    name: 'staging',
    protectionRules: [depProtRuleRequired],
};
const envProduction: any = {
    __typename: 'Environment',
    id: 'env-production',
    _seed: h('Environment#production'),
    name: 'production',
    protectionRules: [depProtRuleRequired],
};

// Populate reviewers for the shared protection rule (after users are in scope)
depProtRuleRequired.reviewers = [userAlice, userBob];

function mkDeployment(
    id: string,
    environment: string,
    envObj: any,
    state: string,
    createdAtOffset: number,
) {
    const seed = h(`Deployment#${id}`);
    const depStatus = {
        __typename: 'DeploymentStatus',
        id: `ds-${id}`,
        _seed: h(`DeploymentStatus#${id}`),
        state: state === 'ACTIVE' ? 'SUCCESS' : 'FAILURE',
        createdAt: mkDate(createdAtOffset - 1),
    };
    return {
        __typename: 'Deployment',
        id,
        _seed: seed,
        environment,
        state,
        createdAt: mkDate(createdAtOffset),
        latestStatus: depStatus,
        ref: mainRef,
        commit: headCommit,
    };
}

const dep1 = mkDeployment('dep-1', 'staging', envStaging, 'ACTIVE', 5);
const dep2 = mkDeployment('dep-2', 'staging', envStaging, 'INACTIVE', 15);
const dep3 = mkDeployment('dep-3', 'production', envProduction, 'ACTIVE', 3);
const dep4 = mkDeployment('dep-4', 'production', envProduction, 'INACTIVE', 20);
const dep5 = mkDeployment('dep-5', 'staging', envStaging, 'ACTIVE', 8);

const allDeployments = [dep1, dep2, dep3, dep4, dep5];

// ---------------------------------------------------------------------------
// VULNERABILITY ALERTS
// ---------------------------------------------------------------------------
function mkSecAdvisoryInline(id: string, ghsaId: string, summary: string, severity: string) {
    return {
        __typename: 'SecurityAdvisory',
        id,
        _seed: h(`SecurityAdvisory#${id}`),
        ghsaId,
        summary,
        severity,
        identifiers: [{ type: 'GHSA', value: ghsaId }],
        vulnerabilities: [] as any[], // populated after mkSecVuln objects are created
    };
}

const vulnAdvisoryLodash = mkSecAdvisoryInline(
    'sa-lodash',
    'GHSA-xxxx-lodash-0001',
    'Prototype pollution in lodash',
    'HIGH',
);
const vulnAdvisoryAxios = mkSecAdvisoryInline(
    'sa-axios',
    'GHSA-xxxx-axios-0002',
    'SSRF vulnerability in axios',
    'CRITICAL',
);
const vulnAdvisoryExpress = mkSecAdvisoryInline(
    'sa-express',
    'GHSA-xxxx-express-0003',
    'Open redirect in express',
    'HIGH',
);

function mkSecVuln(id: string, packageName: string, severity: string, advisory?: any) {
    const seed = h(`SecurityVulnerability#${id}`);
    const advisoryObj =
        advisory ??
        (packageName === 'axios'
            ? vulnAdvisoryAxios
            : packageName === 'express'
              ? vulnAdvisoryExpress
              : vulnAdvisoryLodash);
    return {
        __typename: 'SecurityVulnerability',
        id,
        _seed: seed,
        severity,
        vulnerableVersionRange: '< 2.0.0',
        package: {
            __typename: 'SecurityAdvisoryPackage',
            id: `pkg-${id}`,
            _seed: seed,
            name: packageName,
        },
        advisory: advisoryObj,
    };
}

const DISMISS_REASONS = ['TOLERABLE_RISK', 'NO_BANDWIDTH', 'NOT_USED', 'INACCURATE'];
function mkVulnAlert(id: string, number: number, state: string, opts: Record<string, any> = {}) {
    const seed = h(`RepositoryVulnerabilityAlert#${id}`);
    const dismissIdx = stableHash(`dismissReason#${seed}`) % DISMISS_REASONS.length;
    const secVuln = opts.securityVulnerability ?? mkSecVuln(`sv-${id}`, 'lodash', 'HIGH');
    return {
        __typename: 'RepositoryVulnerabilityAlert',
        id,
        _seed: seed,
        number,
        state,
        dismissReason: state === 'DISMISSED' ? DISMISS_REASONS[dismissIdx]! : null,
        dismissedAt: state === 'DISMISSED' ? mkDate(10 + (seed % 30)) : null,
        vulnerableManifestFilename: `package.json`,
        vulnerableManifestPath: `package.json`,
        vulnerableRequirements: `>= 1.0.0, < 2.0.0`,
        securityAdvisory: secVuln.advisory ?? vulnAdvisoryLodash,
        securityVulnerability: secVuln,
    };
}

// Patch vulnerabilities onto inline advisories (circular reference established after mkSecVuln is defined)
const _lodashVuln = mkSecVuln('sv-lodash-ref', 'lodash', 'HIGH', vulnAdvisoryLodash);
const _axiosVuln = mkSecVuln('sv-axios-ref', 'axios', 'CRITICAL', vulnAdvisoryAxios);
const _expressVuln = mkSecVuln('sv-express-ref', 'express', 'HIGH', vulnAdvisoryExpress);
vulnAdvisoryLodash.vulnerabilities = [_lodashVuln];
vulnAdvisoryAxios.vulnerabilities = [_axiosVuln];
vulnAdvisoryExpress.vulnerabilities = [_expressVuln];

// For octocat/example: open + dismissed alerts
const alert1 = mkVulnAlert('alert-1', 534, 'OPEN');
const alert2 = mkVulnAlert('alert-2', 249, 'OPEN');
const alert3 = mkVulnAlert('alert-3', 101, 'DISMISSED');
const alert4 = mkVulnAlert('alert-4', 102, 'DISMISSED');
const alert5 = mkVulnAlert('alert-5', 103, 'OPEN');

// For owner-1/repo-1
const alertRepo1_1 = mkVulnAlert('alert-r1-1', 1, 'OPEN', {
    securityVulnerability: mkSecVuln('sv-r1-1', 'axios', 'CRITICAL'),
});
const alertRepo1_2 = mkVulnAlert('alert-r1-2', 2, 'OPEN', {
    securityVulnerability: mkSecVuln('sv-r1-2', 'express', 'HIGH'),
});

// ---------------------------------------------------------------------------
// DISCUSSIONS / DISCUSSION CATEGORIES
// ---------------------------------------------------------------------------
const discCategory = {
    __typename: 'DiscussionCategory',
    id: 'example-category-id', // literal id used in gh-ext-073
    _seed: h('DiscussionCategory#example-category-id'),
    name: 'General',
    description: 'General discussions',
};
const discCategory2 = {
    __typename: 'DiscussionCategory',
    id: 'disc-cat-2',
    _seed: h('DiscussionCategory#disc-cat-2'),
    name: 'Ideas',
    description: 'Idea discussions',
};

function mkDiscussionComment(id: string, authorObj: any, body?: string) {
    const text = body ?? 'This is the answer.';
    return {
        __typename: 'DiscussionComment',
        id,
        _seed: h(`DiscussionComment#${id}`),
        body: text,
        bodyText: text,
        bodyHTML: `<p>${text}</p>`,
        author: authorObj,
        createdAt: mkDate(5),
        url: `https://github.com/octocat/example/discussions/1#discussioncomment-${id}`,
    };
}

function mkDiscussion(
    id: string,
    number: number,
    title: string,
    isAnswered: boolean,
    locked: boolean,
    cat: any,
    opts: Record<string, any> = {},
) {
    const seed = h(`Discussion#${id}`);
    return {
        __typename: 'Discussion',
        id,
        _seed: seed,
        number,
        title,
        isAnswered,
        locked,
        upvoteCount: seed % 50,
        answer: isAnswered ? mkDiscussionComment(`dc-${id}`, userAlice) : null,
        category: cat,
        ...opts,
    };
}

// Shared discussion comments (for Discussion.comments connection)
const discComment1 = mkDiscussionComment('dcc-1', userAlice, 'Great point, I agree with this.');
const discComment2 = mkDiscussionComment('dcc-2', userBob, 'Thanks for raising this!');
const discComment3 = mkDiscussionComment('dcc-3', userCarol, 'I had the same question.');
const discComment4 = mkDiscussionComment('dcc-4', userDave, 'Could you clarify this further?');
const discComment5 = mkDiscussionComment('dcc-5', userAlice, 'Fixed in the latest release.');

const disc1 = mkDiscussion(
    'disc-1',
    1,
    'Documentation improvement suggestions',
    true,
    true,
    discCategory,
    { comments: [discComment1, discComment2] },
);
const disc2 = mkDiscussion(
    'disc-2',
    2,
    'How do I configure the API client?',
    true,
    true,
    discCategory,
    { comments: [discComment3] },
);
const disc3 = mkDiscussion(
    'disc-3',
    3,
    'Question about authentication flow',
    true,
    true,
    discCategory,
    { comments: [discComment4, discComment5] },
);
const disc4 = mkDiscussion(
    'disc-4',
    4,
    'Feedback on the new feature',
    false,
    false,
    discCategory2,
    { comments: [discComment1] },
);
const disc5 = mkDiscussion(
    'disc-5',
    5,
    'Best practices for error handling',
    false,
    false,
    discCategory2,
    { comments: [] },
);

const allDiscussions = [disc1, disc2, disc3, disc4, disc5];

// ---------------------------------------------------------------------------
// DEPENDENCY GRAPH MANIFESTS
// ---------------------------------------------------------------------------
function mkDepManifest(id: string, filename: string, deps: any[]) {
    return {
        __typename: 'DependencyGraphManifest',
        id,
        _seed: h(`DependencyGraphManifest#${id}`),
        filename,
        dependenciesCount: deps.length,
        dependencies: deps,
    };
}
function mkDep(name: string, manager: string, requirements: string) {
    return {
        __typename: 'DependencyGraphDependency',
        id: `dep-${name}`,
        _seed: h(`Dep#${name}`),
        packageName: name,
        packageManager: manager,
        requirements,
    };
}

const dep_lodash = mkDep('lodash', 'npm', '^4.17.21');
const dep_react = mkDep('react', 'npm', '^18.0.0');
const dep_express = mkDep('express', 'npm', '^4.18.0');
const dep_axios = mkDep('axios', 'npm', '^1.4.0');

const manifest1 = mkDepManifest('dm-1', 'package.json', [
    dep_lodash,
    dep_react,
    dep_express,
    dep_axios,
]);
const manifest2 = mkDepManifest('dm-2', 'package-lock.json', [dep_lodash, dep_react]);

// ---------------------------------------------------------------------------
// ISSUE TEMPLATES / PR TEMPLATES
// ---------------------------------------------------------------------------
const issueTemplate1 = {
    __typename: 'IssueTemplate',
    id: 'it-1',
    _seed: h('IssueTemplate#1'),
    name: 'Bug Report',
    body: '## Description\n\n## Steps to Reproduce\n',
};
const issueTemplate2 = {
    __typename: 'IssueTemplate',
    id: 'it-2',
    _seed: h('IssueTemplate#2'),
    name: 'Feature Request',
    body: '## Problem\n\n## Proposed Solution\n',
};
const prTemplate1 = {
    __typename: 'PullRequestTemplate',
    id: 'prt-1',
    _seed: h('PullRequestTemplate#1'),
    filename: 'PULL_REQUEST_TEMPLATE.md',
    body: '## Summary\n\n## Test Plan\n',
};

// ---------------------------------------------------------------------------
// REPOSITORY TOPICS
// ---------------------------------------------------------------------------
const repoTopicGraphQL = {
    __typename: 'RepositoryTopic',
    id: 'rt-graphql',
    _seed: h('RepositoryTopic#graphql'),
    topic: topicGraphQL,
};
const repoTopicAPI = {
    __typename: 'RepositoryTopic',
    id: 'rt-api',
    _seed: h('RepositoryTopic#api'),
    topic: topicAPI,
};
const repoTopicOctocat = {
    __typename: 'RepositoryTopic',
    id: 'rt-octocat',
    _seed: h('RepositoryTopic#octocat'),
    topic: topicOctocat,
};

// ---------------------------------------------------------------------------
// FUNDING LINKS (gh-ext-051: BUY_ME_A_COFFEE + POLAR)
// ---------------------------------------------------------------------------
const fundingLink1 = {
    __typename: 'FundingLink',
    id: 'fl-1',
    _seed: h('FundingLink#1'),
    platform: 'BUY_ME_A_COFFEE',
    url: 'https://www.buymeacoffee.com/octocat',
};
const fundingLink2 = {
    __typename: 'FundingLink',
    id: 'fl-2',
    _seed: h('FundingLink#2'),
    platform: 'POLAR',
    url: 'https://polar.sh/octocat',
};

// ---------------------------------------------------------------------------
// REPOSITORIES
// ---------------------------------------------------------------------------
function mkRepo(id: string, ownerLogin: string, name: string, opts: Record<string, any> = {}) {
    const seed = h(`Repository#${id}`);
    return {
        __typename: 'Repository',
        id,
        _seed: seed,
        name,
        nameWithOwner: `${ownerLogin}/${name}`,
        url: `https://github.com/${ownerLogin}/${name}`,
        description: opts.description ?? `${name} repository`,
        stargazerCount: opts.stargazerCount ?? seed % 1000,
        forkCount: opts.forkCount ?? seed % 500,
        isFork: opts.isFork ?? false,
        isArchived: opts.isArchived ?? false,
        archivedAt: opts.archivedAt ?? null,
        isDisabled: opts.isDisabled ?? false,
        isMirror: opts.isMirror ?? false,
        mirrorUrl: opts.mirrorUrl ?? null,
        hasWikiEnabled: opts.hasWikiEnabled ?? false,
        hasVulnerabilityAlertsEnabled: opts.hasVulnerabilityAlertsEnabled ?? false,
        diskUsage: seed % 10000,
        pushedAt: mkDate(seed % 30),
        updatedAt: mkDate((seed % 20) + 1),
        viewerPermission: 'WRITE',
        isInOrganization: ownerLogin === 'octocat',
        // owner is a RepositoryOwner (User | Organization); set as placeholder, overwritten post-construction for org repos
        owner: opts.owner ?? {
            __typename: 'User',
            id: `user-${ownerLogin}`,
            login: ownerLogin,
            url: `https://github.com/${ownerLogin}`,
        },
        licenseInfo: opts.licenseInfo ?? licenseMIT,
        codeOfConduct: opts.codeOfConduct ?? codeOfConduct,
        defaultBranchRef: opts.defaultBranchRef ?? null,
        parent: opts.parent ?? null,
        pullRequests: opts.pullRequests ?? ([] as any[]),
        issues: opts.issues ?? ([] as any[]),
        branchProtectionRules: opts.branchProtectionRules ?? ([] as any[]),
        deployments: opts.deployments ?? ([] as any[]),
        environments: opts.environments ?? ([] as any[]),
        forks: opts.forks ?? ([] as any[]),
        vulnerabilityAlerts: opts.vulnerabilityAlerts ?? ([] as any[]),
        labels: opts.labels ?? ([] as any[]),
        watchers: opts.watchers ?? ([] as any[]),
        discussions: opts.discussions ?? ([] as any[]),
        discussionCategories: opts.discussionCategories ?? ([] as any[]),
        dependencyGraphManifests: opts.dependencyGraphManifests ?? ([] as any[]),
        collaborators: opts.collaborators ?? ([] as any[]),
        fundingLinks: opts.fundingLinks ?? ([] as any[]),
        issueTemplates: opts.issueTemplates ?? ([] as any[]),
        pullRequestTemplates: opts.pullRequestTemplates ?? ([] as any[]),
        repositoryTopics: opts.repositoryTopics ?? ([] as any[]),
        packages: opts.packages ?? ([] as any[]),
        ...opts,
    };
}

// Main repo: octocat/example (gh-ext-057: stargazerCount:102, forkCount:225, isFork:false)
const repoExample: any = mkRepo('octocat/example', 'octocat', 'example', {
    stargazerCount: 102,
    forkCount: 225,
    isFork: false,
    isArchived: false,
    hasWikiEnabled: true,
    hasVulnerabilityAlertsEnabled: true,
    licenseInfo: licenseMIT,
    defaultBranchRef: mainRef,
    pullRequests: allPRsExample,
    issues: allIssuesExample,
    branchProtectionRules: [branchProtectionRule1, branchProtectionRule2],
    deployments: allDeployments,
    environments: [envStaging, envProduction],
    vulnerabilityAlerts: [alert1, alert2, alert3, alert4, alert5],
    labels: allLabels,
    watchers: [userAlice, userBob, userCarol, userDave, userEve],
    discussions: allDiscussions,
    discussionCategories: [discCategory, discCategory2],
    dependencyGraphManifests: [manifest1, manifest2],
    fundingLinks: [fundingLink1, fundingLink2],
    issueTemplates: [issueTemplate1, issueTemplate2],
    pullRequestTemplates: [prTemplate1],
    repositoryTopics: [repoTopicGraphQL, repoTopicAPI],
    collaborators: [userAlice, userBob, userCarol],
    forks: [] as any[], // populated below
});

// Set repo back-references
for (const pr of allPRsExample) {
    pr.repository = repoExample;
}
for (const pr of [pr42]) {
    pr.repository = repoExample;
}
for (const issue of allIssuesExample) {
    issue.repository = repoExample;
}

// mainRef gets the PR associations
mainRef.associatedPullRequests = [pr1, pr2];

// Forks of octocat/example
const repoFork1: any = mkRepo('fork/user1-example', 'user1', 'example', {
    isFork: true,
    parent: repoExample,
    stargazerCount: 5,
    forkCount: 0,
    pushedAt: mkDate(2),
    defaultBranchRef: {
        __typename: 'Ref',
        id: 'ref-fork1-main',
        _seed: h('Ref#fork1-main'),
        name: 'main',
        prefix: 'refs/heads/',
        target: headCommit,
        branchProtectionRule: null,
        compare: {
            __typename: 'Comparison',
            id: 'compare-fork1',
            _seed: h('Comparison#fork1'),
            aheadBy: 5,
            behindBy: 2,
            baseTarget: headCommit,
            status: 'DIVERGED',
        },
        associatedPullRequests: [],
    },
});
const repoFork2: any = mkRepo('fork/user2-example', 'user2', 'example', {
    isFork: true,
    parent: repoExample,
    stargazerCount: 2,
    forkCount: 0,
    pushedAt: mkDate(5),
});
const repoFork3: any = mkRepo('fork/user3-example', 'user3', 'example', {
    isFork: true,
    parent: repoExample,
    stargazerCount: 0,
    forkCount: 0,
    pushedAt: mkDate(10),
});
repoExample.forks = [repoFork1, repoFork2, repoFork3];

// octocat/Hello-World (gh-ext-100: issues 131, 641, 360 with CrossReferencedEvent)
// CrossReferencedEvent items for Hello-World issues
function mkCrossRefEvent(
    id: string,
    isCrossRepository: boolean,
    sourceType: 'Issue' | 'PullRequest',
    sourceRepoName: string,
) {
    const seed = h(`CrossReferencedEvent#${id}`);
    const sourceRepoId = `repo-${sourceRepoName.replace(/[^a-z0-9]/gi, '-')}`;
    const sourceRepo = {
        __typename: 'Repository',
        id: sourceRepoId,
        _seed: h(`Repository#${sourceRepoId}`),
        nameWithOwner: `Repository.nameWithOwner-${stableHash(`Repository.nameWithOwner#${h(`Repository#${sourceRepoId}`)}`) % 10000}`,
        name: sourceRepoName.split('/')[1] ?? sourceRepoName,
    };
    const source =
        sourceType === 'Issue'
            ? {
                  __typename: 'Issue',
                  id: `src-issue-${id}`,
                  _seed: seed,
                  number: seed % 100,
                  title: 'Source issue',
                  repository: sourceRepo,
              }
            : {
                  __typename: 'PullRequest',
                  id: `src-pr-${id}`,
                  _seed: seed,
                  number: seed % 100,
                  title: 'Source PR',
                  repository: sourceRepo,
              };
    return {
        __typename: 'CrossReferencedEvent',
        id,
        _seed: seed,
        isCrossRepository,
        source,
    };
}

const crossRef1 = mkCrossRefEvent('cre-1', true, 'PullRequest', 'octocat/other-repo');
const crossRef2 = mkCrossRefEvent('cre-2', false, 'Issue', 'octocat/Hello-World');
const crossRef3 = mkCrossRefEvent('cre-3', true, 'PullRequest', 'other/project');
const crossRef4 = mkCrossRefEvent('cre-4', true, 'Issue', 'octocat/another-repo');
const crossRef5 = mkCrossRefEvent('cre-5', true, 'PullRequest', 'third/thing');
const crossRef6 = mkCrossRefEvent('cre-6', false, 'Issue', 'octocat/Hello-World');

// hwIssue131: no assignees (empty subset for test at index 0)
const hwIssue131: any = mkIssue(
    'hw-issue-131',
    131,
    'Fix null reference exception in parser',
    'OPEN',
    { assignees: [] },
);
// hwIssue641: has assignees (non-empty subset for test at index 1)
const hwIssue641: any = mkIssue(
    'hw-issue-641',
    641,
    'Performance regression in query execution',
    'OPEN',
    { assignees: [userAlice, userBob] },
);
const hwIssue360: any = mkIssue('hw-issue-360', 360, 'Add support for custom headers', 'OPEN', {
    assignees: [],
});
// Additional OPEN issue to meet the pagination test requirement of first:4
const hwIssue200: any = mkIssue('hw-issue-200', 200, 'Update documentation for v2 API', 'OPEN', {
    assignees: [userCarol],
});

hwIssue131.timelineItems = [crossRef1, crossRef2];
hwIssue641.timelineItems = [crossRef3, crossRef4];
hwIssue360.timelineItems = [crossRef5, crossRef6];

const repoHelloWorld: any = mkRepo('octocat/Hello-World', 'octocat', 'Hello-World', {
    stargazerCount: 5000,
    forkCount: 3000,
    hasWikiEnabled: false,
    licenseInfo: licenseApache,
    defaultBranchRef: mainRef,
    issues: [hwIssue131, hwIssue641, hwIssue360, hwIssue200],
    pullRequests: [pr1, pr2],
    forks: [],
    vulnerabilityAlerts: [],
    labels: [labelBug, labelFeature],
});
hwIssue131.repository = repoHelloWorld;
hwIssue641.repository = repoHelloWorld;
hwIssue360.repository = repoHelloWorld;
hwIssue200.repository = repoHelloWorld;

// owner-1/repo-1 (gh-ext-070)
const repoOwner1Repo1: any = mkRepo('owner-1/repo-1', 'owner-1', 'repo-1', {
    vulnerabilityAlerts: [alertRepo1_1, alertRepo1_2],
});

// Org repos (for octocat organization)
const repoPrivate1: any = mkRepo('octocat/private-repo', 'octocat', 'private-repo', {
    isArchived: false,
    hasWikiEnabled: false,
    hasVulnerabilityAlertsEnabled: false,
    stargazerCount: 0,
    forkCount: 0,
    description: 'Private repository',
});
const repoArchived1: any = mkRepo('octocat/archived-old', 'octocat', 'archived-old', {
    isArchived: true,
    archivedAt: mkDate(100),
    hasWikiEnabled: false,
    stargazerCount: 10,
    forkCount: 2,
});
const repoArchived2: any = mkRepo('octocat/legacy-app', 'octocat', 'legacy-app', {
    isArchived: true,
    archivedAt: mkDate(150),
    hasWikiEnabled: false,
});
const repoDisabled1: any = mkRepo('octocat/disabled-repo', 'octocat', 'disabled-repo', {
    isDisabled: true,
    isArchived: false,
    stargazerCount: 0,
    forkCount: 0,
});
const repoMirror1: any = mkRepo('octocat/mirror-of-linux', 'octocat', 'mirror-of-linux', {
    isMirror: true,
    mirrorUrl: 'https://github.com/torvalds/linux',
    isArchived: false,
    hasWikiEnabled: false,
    stargazerCount: 50,
    forkCount: 5,
});
const repoWiki1: any = mkRepo('octocat/wiki-enabled', 'octocat', 'wiki-enabled', {
    hasWikiEnabled: true,
    isArchived: false,
    hasVulnerabilityAlertsEnabled: true,
    stargazerCount: 30,
    forkCount: 10,
});

// All org repos
const allOrgRepos = [
    repoExample,
    repoPrivate1,
    repoArchived1,
    repoArchived2,
    repoDisabled1,
    repoMirror1,
    repoWiki1,
    repoHelloWorld,
    repoFork1,
    repoFork2,
];

// Repo lookup map
const repoByOwnerName = new Map<string, any>([
    ['octocat/example', repoExample],
    ['octocat/Hello-World', repoHelloWorld],
    ['octocat/hello-world', repoHelloWorld], // case-insensitive alias
    ['owner-1/repo-1', repoOwner1Repo1],
]);

// ---------------------------------------------------------------------------
// STARRED REPOSITORIES (for octocat user - gh-ext-041)
// ---------------------------------------------------------------------------
const starredEdge1 = {
    node: repoExample,
    starredAt: '2024-09-10T00:00:00.000Z',
    cursor: '0',
};
const starredEdge2 = {
    node: repoHelloWorld,
    starredAt: '2025-02-15T00:00:00.000Z',
    cursor: '1',
};
userOctocat.starredRepositories = [repoExample, repoHelloWorld];

// ---------------------------------------------------------------------------
// GISTS (for octocat user - gh-ext-043, 044)
// ---------------------------------------------------------------------------
function mkGist(
    id: string,
    name: string,
    description: string | null,
    createdAt: string,
    stargazerCount: number,
) {
    return {
        __typename: 'Gist',
        id,
        _seed: h(`Gist#${id}`),
        name,
        description,
        createdAt,
        stargazerCount,
        updatedAt: createdAt,
    };
}
const gist1 = mkGist(
    'gist-1',
    'deployment-script.sh',
    'My first gist',
    '2025-01-21T00:00:00.000Z',
    5,
);
const gist2 = mkGist('gist-2', 'gist-older', 'An older gist', '2024-11-15T00:00:00.000Z', 2);
const gist3 = mkGist('gist-3', 'gist-oldest', 'The oldest gist', '2024-08-10T00:00:00.000Z', 0);
userOctocat.gists = [gist1, gist2, gist3];

// ---------------------------------------------------------------------------
// ORGANIZATION TEAMS (for octocat org)
// ---------------------------------------------------------------------------
function mkOrgTeam(
    id: string,
    name: string,
    slug: string,
    privacy: string,
    opts: Record<string, any> = {},
) {
    const seed = h(`Team#${id}`);
    return {
        __typename: 'Team',
        id,
        _seed: seed,
        name,
        slug,
        privacy,
        // organization is set post-construction once orgOctocat is in scope
        organization: null as any,
        repositories: opts.repositories ?? ([] as any[]),
        members: opts.members ?? ([] as any[]),
        parentTeam: opts.parentTeam ?? null,
        childTeams: opts.childTeams ?? ([] as any[]),
        ...opts,
    };
}

// "example" team (gh-ext-087: SECRET privacy)
const teamExample = mkOrgTeam('team-example', 'example', 'example', 'SECRET', {
    members: [userAlice, userBob],
    repositories: [repoExample, repoHelloWorld],
});
const teamDevs = mkOrgTeam('team-devs', 'Developers', 'developers', 'VISIBLE', {
    members: [userAlice, userBob, userCarol, userDave],
    repositories: [repoExample],
});
const teamOps = mkOrgTeam('team-ops', 'Operations', 'operations', 'VISIBLE', {
    members: [userEve, userFrank],
    repositories: [repoExample, repoPrivate1],
    parentTeam: teamDevs,
});
const teamSec = mkOrgTeam('team-security', 'Security', 'security', 'SECRET', {
    members: [userGrace, userHenry],
    repositories: [repoPrivate1],
});

const allOrgTeams = [teamExample, teamDevs, teamOps, teamSec];

const teamBySlug = new Map<string, any>([
    ['example', teamExample],
    ['developers', teamDevs],
    ['operations', teamOps],
    ['security', teamSec],
]);

// Team repository edges
const teamRepoEdge1 = {
    __typename: 'TeamRepositoryEdge',
    id: 'tre-1',
    _seed: h('TeamRepositoryEdge#1'),
    permission: 'PUSH',
    node: repoExample,
};
const teamRepoEdge2 = {
    __typename: 'TeamRepositoryEdge',
    id: 'tre-2',
    _seed: h('TeamRepositoryEdge#2'),
    permission: 'READ',
    node: repoHelloWorld,
};

// ---------------------------------------------------------------------------
// PROJECTS V2 (for octocat org)
// ---------------------------------------------------------------------------
// Iteration field for project #1 with field "example"
const iteration1 = {
    id: 'iter-1',
    title: 'Critical Bug Fixes Iteration',
    startDate: '2025-04-13T00:00:00.000Z',
    duration: 38,
};
const iteration2 = {
    id: 'iter-2',
    title: 'Q2 2026 Sprint Planning',
    startDate: '2024-07-02T00:00:00.000Z',
    duration: 504,
};
const iterationField = {
    __typename: 'ProjectV2IterationField',
    id: 'pf-iter',
    _seed: h('ProjectV2IterationField#example'),
    name: 'example',
    dataType: 'ITERATION',
    configuration: {
        __typename: 'ProjectV2IterationFieldConfiguration',
        id: 'pfifc-1',
        _seed: h('ProjectV2IterationFieldConfiguration#1'),
        iterations: [iteration1, iteration2],
    },
};

const statusField = {
    __typename: 'ProjectV2SingleSelectField',
    id: 'pf-status',
    _seed: h('ProjectV2SingleSelectField#Status'),
    name: 'Status',
    dataType: 'SINGLE_SELECT',
};

const titleField = {
    __typename: 'ProjectV2Field',
    id: 'pf-title',
    _seed: h('ProjectV2Field#Title'),
    name: 'Title',
    dataType: 'TEXT',
};

// Project items
const ITERATION_TITLES = [
    'Sprint 1 - Foundation',
    'Sprint 2 - Core Features',
    'Sprint 3 - Integrations',
    'Sprint 4 - Polish & Testing',
    'Sprint 5 - Release Prep',
    'Q1 Roadmap Execution',
    'Q2 Feature Rollout',
    'Milestone: Beta Launch',
    'Milestone: GA Release',
    'Bugfix Sprint',
];
function mkProjectItem(id: string, prObj: any, opts: Record<string, any> = {}) {
    const seed = h(`ProjectV2Item#${id}`);
    const iterTitleIdx = stableHash(`iterTitle#${seed}`) % ITERATION_TITLES.length;
    const iterValue = {
        __typename: 'ProjectV2ItemFieldIterationValue',
        id: `pfiv-${id}`,
        _seed: seed,
        iterationId: iteration1.id,
        title: ITERATION_TITLES[iterTitleIdx]!,
        startDate: iteration1.startDate,
        duration: iteration1.duration,
        field: iterationField,
    };
    const statusValue = {
        __typename: 'ProjectV2ItemFieldSingleSelectValue',
        id: `pfsv-${id}`,
        _seed: seed,
        name: ['In Progress', 'Done', 'Todo', 'Backlog', 'Review'][seed % 5]!,
        field: statusField,
    };
    const textValue = {
        __typename: 'ProjectV2ItemFieldTextValue',
        id: `pftv-${id}`,
        _seed: seed,
        text: `Item text ${id}`,
        field: titleField,
    };
    const numValue = {
        __typename: 'ProjectV2ItemFieldNumberValue',
        id: `pfnv-${id}`,
        _seed: seed,
        number: seed % 100,
        field: titleField,
    };
    return {
        __typename: 'ProjectV2Item',
        id,
        _seed: seed,
        type: 'PULL_REQUEST',
        isArchived: opts.isArchived ?? false,
        updatedAt: opts.updatedAt ?? mkDate(5 + (seed % 30)),
        content: prObj,
        fieldValues: [textValue, numValue, statusValue, iterValue],
        fieldValueByName: opts.fieldValueByName ?? iterValue,
    };
}

const projItem1 = mkProjectItem('pi-1', pr1, {
    updatedAt: '2024-07-15T00:00:00.000Z',
    isArchived: false,
});
const projItem2 = mkProjectItem('pi-2', pr2, {
    updatedAt: '2025-04-26T00:00:00.000Z',
    isArchived: true,
});
const projItem3 = mkProjectItem('pi-3', pr3, {
    updatedAt: '2025-02-08T00:00:00.000Z',
});
const projItem4 = mkProjectItem('pi-4', pr4, {
    updatedAt: '2024-11-05T00:00:00.000Z',
});
const projItem5 = mkProjectItem('pi-5', pr5, {
    updatedAt: '2025-02-28T00:00:00.000Z',
});

const projectView1 = {
    __typename: 'ProjectV2View',
    id: 'pv-1',
    _seed: h('ProjectV2View#1'),
    name: 'Board',
    filter: 'no:assignee',
};
const projectView2 = {
    __typename: 'ProjectV2View',
    id: 'pv-2',
    _seed: h('ProjectV2View#2'),
    name: 'Table',
    filter: null,
};

// Project #1 for octocat org
const project1: any = {
    __typename: 'ProjectV2',
    id: 'proj-1',
    _seed: h('ProjectV2#1'),
    title: 'GraphQL Schema Evolution',
    number: 1,
    fields: [titleField, statusField, iterationField],
    items: [projItem1, projItem2, projItem3, projItem4, projItem5],
    views: [projectView1, projectView2],
};

// project.field(name:) resolver needs to handle "example" and "Status"
function projectFieldByName(project: any, name: string): any {
    return project.fields.find((f: any) => f.name === name) ?? null;
}

// Additional projects
const project2: any = {
    __typename: 'ProjectV2',
    id: 'proj-2',
    _seed: h('ProjectV2#2'),
    title: 'API Modernization Roadmap',
    number: 2,
    fields: [titleField, statusField],
    items: [projItem1, projItem2],
    views: [projectView1],
};
const project3: any = {
    __typename: 'ProjectV2',
    id: 'proj-3',
    _seed: h('ProjectV2#3'),
    title: 'Security Hardening Initiative',
    number: 3,
    fields: [titleField],
    items: [projItem3],
    views: [projectView2],
};

// ProjectV2StatusUpdate entries (gh-ext-078)
const statusUpdate1 = {
    __typename: 'ProjectV2StatusUpdate',
    id: 'psu-1',
    _seed: h('ProjectV2StatusUpdate#1'),
    status: 'ON_TRACK',
    body: 'Everything is on schedule.',
    createdAt: mkDate(3),
    creator: userAlice,
};
const statusUpdate2 = {
    __typename: 'ProjectV2StatusUpdate',
    id: 'psu-2',
    _seed: h('ProjectV2StatusUpdate#2'),
    status: 'AT_RISK',
    body: 'Some blockers identified.',
    createdAt: mkDate(10),
    creator: userBob,
};
const statusUpdate3 = {
    __typename: 'ProjectV2StatusUpdate',
    id: 'psu-3',
    _seed: h('ProjectV2StatusUpdate#3'),
    status: 'COMPLETE',
    body: 'Project completed successfully.',
    createdAt: mkDate(1),
    creator: userCarol,
};

project1.statusUpdates = [statusUpdate1, statusUpdate2];
project2.statusUpdates = [statusUpdate3];
project3.statusUpdates = [];

const allProjects = [project1, project2, project3];
const projectByNumber = new Map<number, any>([
    [1, project1],
    [2, project2],
    [3, project3],
]);

// ---------------------------------------------------------------------------
// PACKAGES (for octocat org)
// ---------------------------------------------------------------------------
function mkPackage(
    id: string,
    name: string,
    packageType: string,
    version: string,
    downloads: number,
    repoObj: any | null,
) {
    const seed = h(`Package#${id}`);
    return {
        __typename: 'Package',
        id,
        _seed: seed,
        name,
        packageType,
        latestVersion: { __typename: 'PackageVersion', id: `pv-${id}`, _seed: seed, version },
        statistics: {
            __typename: 'PackageStatistics',
            id: `ps-${id}`,
            _seed: seed,
            downloadsTotalCount: downloads,
        },
        repository: repoObj,
    };
}

const pkg1 = mkPackage('pkg-1', 'example-package', 'NPM', '1.2.3', 50000, repoExample);
const pkg2 = mkPackage('pkg-2', 'example-lib', 'NPM', '2.0.0', 12000, repoExample);
const pkg3 = mkPackage('pkg-3', 'example-docker', 'DOCKER', 'latest', 5000, repoExample);

const allPackages = [pkg1, pkg2, pkg3];

// ---------------------------------------------------------------------------
// SECURITY ADVISORIES
// ---------------------------------------------------------------------------
function mkSecAdvisory(id: string, identifiers: { type: string; value: string }[]) {
    return {
        __typename: 'SecurityAdvisory',
        id,
        _seed: h(`SecurityAdvisory#${id}`),
        identifiers,
    };
}

const secAdvisory1 = mkSecAdvisory('sa-1', [
    { type: 'CVE', value: 'CVE-2024-0001' },
    { type: 'GHSA', value: 'GHSA-xxxx-xxxx-0001' },
]);
const secAdvisory2 = mkSecAdvisory('sa-2', [
    { type: 'CVE', value: 'CVE-2024-0002' },
    { type: 'GHSA', value: 'GHSA-xxxx-xxxx-0002' },
]);
const secAdvisory3 = mkSecAdvisory('sa-3', [{ type: 'CVE', value: 'CVE-2024-0003' }]);
const secAdvisory4 = mkSecAdvisory('sa-4', [{ type: 'GHSA', value: 'GHSA-xxxx-xxxx-0004' }]);
const secAdvisory5 = mkSecAdvisory('sa-5', [{ type: 'CVE', value: 'CVE-2024-0005' }]);
const secAdvisory6 = mkSecAdvisory('sa-6', [{ type: 'CVE', value: 'CVE-2024-0006' }]);
const secAdvisory7 = mkSecAdvisory('sa-7', [{ type: 'GHSA', value: 'GHSA-xxxx-xxxx-0007' }]);
const secAdvisory8 = mkSecAdvisory('sa-8', [{ type: 'CVE', value: 'CVE-2023-0001' }]);
const secAdvisory9 = mkSecAdvisory('sa-9', [{ type: 'CVE', value: 'CVE-2023-0002' }]);
const secAdvisory10 = mkSecAdvisory('sa-10', [{ type: 'GHSA', value: 'GHSA-xxxx-xxxx-0010' }]);

const allSecurityAdvisories = [
    secAdvisory1,
    secAdvisory2,
    secAdvisory3,
    secAdvisory4,
    secAdvisory5,
    secAdvisory6,
    secAdvisory7,
    secAdvisory8,
    secAdvisory9,
    secAdvisory10,
];

// ---------------------------------------------------------------------------
// ORGANIZATION MEMBER ROLES (for membersWithRole edges)
// ---------------------------------------------------------------------------
// alice is the sole admin; the rest are regular members.
const orgMemberRoles = new Map<string, string>([
    ['alice', 'ADMIN'],
    ['bob', 'MEMBER'],
    ['carol', 'MEMBER'],
    ['dave', 'MEMBER'],
    ['eve', 'MEMBER'],
]);

// ---------------------------------------------------------------------------
// ORGANIZATION (octocat)
// ---------------------------------------------------------------------------
const orgOctocat: any = {
    __typename: 'Organization',
    id: 'org-octocat',
    _seed: h('Organization#octocat'),
    login: 'octocat',
    name: 'Octocat',
    url: 'https://github.com/octocat',
    description: 'The Octocat organization',
    repositories: allOrgRepos,
    teams: allOrgTeams,
    projectsV2: allProjects,
    packages: allPackages,
    membersWithRole: [userAlice, userBob, userCarol, userDave, userEve],
    pendingMembers: [userFrank, userGrace],
    auditLog: [] as any[],
};

// Audit log entries (gh-ext-091)
const auditEntry1 = {
    __typename: 'OrgAddMemberAuditEntry',
    id: 'ae-1',
    _seed: h('OrgAddMemberAuditEntry#1'),
    action: 'org.add_member',
    createdAt: '2025-03-21T00:00:00.000Z',
    actor: userFrank,
    user: userHenry,
    organization: orgOctocat,
};
const auditEntry2 = {
    __typename: 'OrgAddMemberAuditEntry',
    id: 'ae-2',
    _seed: h('OrgAddMemberAuditEntry#2'),
    action: 'org.add_member',
    createdAt: '2024-10-11T00:00:00.000Z',
    actor: userGrace,
    user: userIris,
    organization: orgOctocat,
};
orgOctocat.auditLog = [auditEntry1, auditEntry2];

const orgByLogin = new Map<string, any>([['octocat', orgOctocat]]);

// Patch owner on org repos to the real Organization object (needs orgOctocat in scope)
for (const repo of allOrgRepos) {
    repo.owner = orgOctocat;
}
// Patch organization on all teams to the real Organization object
for (const team of allOrgTeams) {
    team.organization = orgOctocat;
}
// Viewer repos owner = userViewer (set below after userViewer repos are declared — done in viewer section)

// ---------------------------------------------------------------------------
// ENTERPRISE (example)
// ---------------------------------------------------------------------------
const enterpriseExample = {
    __typename: 'Enterprise',
    id: 'ent-example',
    _seed: h('Enterprise#example'),
    slug: 'example',
    name: 'Example Enterprise',
    // gh-ext-093: allLicensableUsersCount:9, totalLicenses:959
    // gh-ext-094: bandwidthUsage:26, storageUsage:46.8
    billingInfo: {
        __typename: 'EnterpriseBillingInfo',
        id: 'ebi-1',
        _seed: h('EnterpriseBillingInfo#1'),
        allLicensableUsersCount: 9,
        totalLicenses: 959,
        totalAvailableLicenses: 950,
        bandwidthUsage: 26,
        storageUsage: 46.8,
    },
    ownerInfo: {
        __typename: 'EnterpriseOwnerInfo',
        id: 'eoi-1',
        _seed: h('EnterpriseOwnerInfo#1'),
        // gh-ext-033: oidcProviderType: AAD
        oidcProvider: {
            __typename: 'OIDCProvider',
            id: 'oidc-1',
            _seed: h('OIDCProvider#1'),
            providerType: 'AAD',
        },
    },
};

const enterpriseBySlug = new Map<string, any>([['example', enterpriseExample]]);

// ---------------------------------------------------------------------------
// VIEWER (singleton user for viewer queries)
// ---------------------------------------------------------------------------
// Viewer repos (some forks, for gh-ext-047, 060, 071)
const viewerRepoOwn1: any = mkRepo('viewer/my-project', 'viewer-user', 'my-project', {
    isFork: false,
    stargazerCount: 10,
    forkCount: 2,
    defaultBranchRef: {
        __typename: 'Ref',
        id: 'ref-vr1-main',
        _seed: h('Ref#vr1-main'),
        name: 'main',
        prefix: 'refs/heads/',
        target: headCommit,
        branchProtectionRule: null,
        compare: {
            __typename: 'Comparison',
            id: 'cmp-vr1',
            _seed: h('Comparison#vr1'),
            aheadBy: 2,
            behindBy: 0,
            baseTarget: headCommit,
            status: 'AHEAD',
        },
        associatedPullRequests: [],
    },
    parent: null,
});
const viewerRepoFork1: any = mkRepo('viewer/example-fork', 'viewer-user', 'example-fork', {
    isFork: true,
    parent: repoExample,
    stargazerCount: 0,
    forkCount: 0,
    defaultBranchRef: {
        __typename: 'Ref',
        id: 'ref-vfork1-main',
        _seed: h('Ref#vfork1-main'),
        name: 'main',
        prefix: 'refs/heads/',
        target: headCommit,
        branchProtectionRule: null,
        compare: {
            __typename: 'Comparison',
            id: 'cmp-vfork1',
            _seed: h('Comparison#vfork1'),
            aheadBy: 1,
            behindBy: 3,
            baseTarget: headCommit,
            status: 'DIVERGED',
        },
        associatedPullRequests: [],
    },
});
const viewerRepoFork2: any = mkRepo('viewer/hello-world-fork', 'viewer-user', 'hello-world-fork', {
    isFork: true,
    parent: repoHelloWorld,
    stargazerCount: 0,
    forkCount: 0,
});
const viewerRepoFork3: any = mkRepo('viewer/another-fork', 'viewer-user', 'another-fork', {
    isFork: true,
    parent: repoExample,
    stargazerCount: 0,
    forkCount: 0,
});

const viewerAllRepos = [viewerRepoOwn1, viewerRepoFork1, viewerRepoFork2, viewerRepoFork3];

// Pinned items for viewer (gh-ext-045)
const viewerPinnedItems = [repoExample, repoHelloWorld];

// Viewer following / followers (gh-ext-046, 048)
const viewerFollowing = [userAlice, userBob, userCarol];
const viewerFollowers = [
    { ...userDave, viewerIsFollowing: true },
    { ...userEve, viewerIsFollowing: false },
    { ...userFrank, viewerIsFollowing: true },
    { ...userGrace, viewerIsFollowing: false },
    { ...userHenry, viewerIsFollowing: false },
];

// Viewer organizations (gh-ext-085: includes teams with role MEMBER)
userViewer.organizations = [orgOctocat];
userViewer.following = viewerFollowing;
userViewer.followers = viewerFollowers;
userViewer.repositories = viewerAllRepos;
userViewer.pinnedItems = viewerPinnedItems;
userViewer.starredRepositories = [repoExample, repoHelloWorld];
userViewer.gists = [gist1];
userViewer.pullRequests = [pr1, pr2, pr5, pr8, pr9];

// Patch owner on viewer repos to the real User object
for (const repo of viewerAllRepos) {
    repo.owner = userViewer;
}

// ---------------------------------------------------------------------------
// RATE LIMIT (gh-ext-098: limit:428, remaining:609; gh-ext-099: cost:862)
// ---------------------------------------------------------------------------
const rateLimit = {
    __typename: 'RateLimit',
    id: 'rl-1',
    _seed: h('RateLimit#1'),
    limit: 428,
    remaining: 609,
    cost: 862,
    resetAt: '2025-03-18T00:00:00.000Z',
};

// ---------------------------------------------------------------------------
// SEARCH RESULTS
// ---------------------------------------------------------------------------
const searchResultRepos = [repoExample, repoHelloWorld, repoFork1, repoMirror1, repoArchived1];

// ---------------------------------------------------------------------------
// THE RESOLVER MAP
// ---------------------------------------------------------------------------
export const github: ResolverMap = {
    Query: {
        // ID-lookup roots
        repository: (_src, args) => {
            const argName = String(args.name);
            const argOwner = String(args.owner);
            const key = `${argOwner}/${argName}`;
            const repo = repoByOwnerName.get(key) ?? repoByOwnerName.get(key.toLowerCase()) ?? null;
            if (!repo) return null;
            // Seed the name from the lookup arg so "lookup seeding" holds (e.g. name:"hello-world" → .name === "hello-world")
            if (repo.name !== argName) {
                return { ...repo, name: argName, nameWithOwner: `${argOwner}/${argName}` };
            }
            return repo;
        },
        organization: (_src, args) => orgByLogin.get(String(args.login)) ?? null,
        user: (_src, args) => userByLogin.get(String(args.login)) ?? null,
        enterprise: (_src, args) => enterpriseBySlug.get(String(args.slug)) ?? null,
        viewer: () => userViewer,
        rateLimit: () => rateLimit,

        // Search (gh-ext-056, 064)
        search: (_src, args) => {
            const first = args.first as number | undefined;
            const nodes = searchResultRepos.slice(0, first ?? searchResultRepos.length);
            const edges = nodes.map((n, i) => ({
                __typename: 'SearchResultItemEdge',
                node: n,
                cursor: String(i),
                textMatches: [],
            }));
            return {
                __typename: 'SearchResultItemConnection',
                nodes,
                edges,
                totalCount: searchResultRepos.length,
                repositoryCount: searchResultRepos.length,
                issueCount: 0,
                userCount: 0,
                wikiCount: 0,
                discussionCount: 0,
                codeCount: 0,
                pageInfo: {
                    hasNextPage: false,
                    hasPreviousPage: false,
                    startCursor: edges.length > 0 ? '0' : null,
                    endCursor: edges.length > 0 ? String(edges.length - 1) : null,
                },
            };
        },

        // Security advisories (gh-ext-037)
        securityAdvisories: (_src, args) => conn(allSecurityAdvisories, args),
    },

    // ---- Repository ----
    Repository: {
        // point lookup
        pullRequest: (src: any, args: any) => {
            const num = Number(args.number);
            // if it's the main repo, use our literal PR map; else seed dynamically
            if (src?.id === repoExample.id) {
                return (
                    prByNumber.get(num) ??
                    mkPR(`${src.id}/pr/${num}`, num, `Pull request #${num}`, 'OPEN')
                );
            }
            return mkPR(`${src.id}/pr/${num}`, num, `Pull request #${num}`, 'OPEN');
        },
        object: (src: any, _args: any) => {
            // Always return HEAD commit for HEAD/main/master expressions
            return headCommit;
        },

        // point lookups
        ref: (src: any, args: any) => {
            // Return the named ref if it's the main ref, else a minimal Ref object
            const qn = String(args.qualifiedName ?? '');
            if (qn.includes('main') || qn.includes('master') || qn === '') {
                return src?.defaultBranchRef ?? mainRef;
            }
            return {
                __typename: 'Ref',
                id: `ref-${qn}`,
                _seed: h(`Ref#${qn}`),
                name: qn.replace('refs/heads/', ''),
                prefix: 'refs/heads/',
                target: headCommit,
                branchProtectionRule: null,
                compare: {
                    __typename: 'Comparison',
                    id: `cmp-${qn}`,
                    _seed: h(`Comparison#${qn}`),
                    aheadBy: 0,
                    behindBy: 0,
                    baseTarget: headCommit,
                    status: 'IDENTICAL',
                },
                associatedPullRequests: [],
            };
        },
        vulnerabilityAlert: (src: any, args: any) => {
            const num = Number(args.number);
            const list: any[] = src?.vulnerabilityAlerts ?? allDeployments;
            return (
                (src?.vulnerabilityAlerts ?? [alert1, alert2, alert3, alert4, alert5]).find(
                    (a: any) => a.number === num,
                ) ?? null
            );
        },
        packages: (src: any, args: any) => conn(src?.packages ?? [], args),

        // connections
        pullRequests: (src: any, args: any) => {
            const states = args.states as string[] | undefined;
            let list: any[] = src?.pullRequests ?? allPRsExample;
            if (states && states.length > 0) {
                list = list.filter((pr: any) => states.includes(pr.state));
            }
            return conn(list, args);
        },
        issues: (src: any, args: any) => {
            const states = args.states as string[] | undefined;
            let list: any[] = src?.issues ?? allIssuesExample;
            if (states && states.length > 0) {
                list = list.filter((issue: any) => states.includes(issue.state));
            }
            return conn(list, args);
        },
        branchProtectionRules: (src: any, args: any) =>
            conn(src?.branchProtectionRules ?? [], args),
        deployments: (src: any, args: any) => {
            const envs = args.environments as string[] | undefined;
            let list: any[] = src?.deployments ?? allDeployments;
            if (envs && envs.length > 0) {
                list = list.filter((d: any) => envs.includes(d.environment));
            }
            return conn(list, args);
        },
        environments: (src: any, args: any) => conn(src?.environments ?? [], args),
        forks: (src: any, args: any) => conn(src?.forks ?? [], args),
        vulnerabilityAlerts: (src: any, args: any) => {
            const states = args.states as string[] | undefined;
            let list: any[] = src?.vulnerabilityAlerts ?? [];
            if (states && states.length > 0) {
                list = list.filter((a: any) => states.includes(a.state));
            }
            return conn(list, args);
        },
        labels: (src: any, args: any) => conn(src?.labels ?? allLabels, args),
        watchers: (src: any, args: any) => conn(src?.watchers ?? [], args),
        discussions: (src: any, args: any) => {
            let list: any[] = src?.discussions ?? allDiscussions;
            if (args.answered === true) {
                list = list.filter((d: any) => d.isAnswered === true);
            }
            if (args.categoryId != null) {
                list = list.filter((d: any) => d.category?.id === args.categoryId);
            }
            return conn(list, args);
        },
        discussionCategories: (src: any, args: any) =>
            conn(src?.discussionCategories ?? [discCategory, discCategory2], args),
        dependencyGraphManifests: (src: any, args: any) =>
            conn(src?.dependencyGraphManifests ?? [], args),
        collaborators: (src: any, args: any) => conn(src?.collaborators ?? [], args),
        repositoryTopics: (src: any, args: any) => conn(src?.repositoryTopics ?? [], args),
    },

    // ---- PullRequest connections ----
    PullRequest: {
        files: (src: any, args: any) => conn(src?.files ?? [prFile1, prFile2], args),
        reviews: (src: any, args: any) => {
            const states = args.states as string[] | undefined;
            let list: any[] = src?.reviews ?? [review1, review2, review3];
            if (states && states.length > 0) {
                list = list.filter((r: any) => states.includes(r.state));
            }
            return conn(list, args);
        },
        reviewRequests: (src: any, args: any) => conn(src?.reviewRequests ?? [], args),
        reviewThreads: (src: any, args: any) =>
            conn(src?.reviewThreads ?? [thread1, thread2], args),
        commits: (src: any, args: any) => conn(src?.commits ?? [prCommit1], args),
        timelineItems: (src: any, args: any) => {
            const itemTypes = args.itemTypes as string[] | undefined;
            let list: any[] = src?.timelineItems ?? [reopenedEvent1];
            if (itemTypes && itemTypes.length > 0) {
                list = list.filter((item: any) =>
                    itemTypes.includes(item.__typename.toUpperCase()),
                );
            }
            return conn(list, args);
        },
        closingIssuesReferences: (src: any, args: any) =>
            conn(src?.closingIssuesReferences ?? [], args),
        comments: (src: any, args: any) => conn(src?.comments ?? [], args),
    },

    // ---- Issue connections ----
    Issue: {
        assignees: (src: any, args: any) => conn(src?.assignees ?? [], args),
        comments: (src: any, args: any) => conn(src?.comments ?? [], args),
        closedByPullRequestsReferences: (src: any, args: any) =>
            conn(src?.closedByPullRequestsReferences ?? [], args),
        timelineItems: (src: any, args: any) => {
            const itemTypes = args.itemTypes as string[] | undefined;
            let list: any[] = src?.timelineItems ?? [];
            if (itemTypes && itemTypes.length > 0) {
                list = list.filter((item: any) =>
                    itemTypes.includes(item.__typename.toUpperCase()),
                );
            }
            return conn(list, args);
        },
        labels: (src: any, args: any) => conn(src?.labels ?? [], args),
    },

    // ---- Commit connections ----
    Commit: {
        associatedPullRequests: (src: any, args: any) =>
            conn(src?.associatedPullRequests ?? [pr1], args),
        history: (src: any, args: any) => {
            // CommitHistoryConnection shape
            const allHistory: any[] = src?.history ?? [
                headCommit,
                commit2,
                commit3,
                commit4,
                commit5,
            ];
            const since = args.since as string | undefined;
            let list = allHistory;
            if (since) {
                list = list.filter((c: any) => c.committedDate >= since);
            }
            const limit = args.first ?? args.last ?? list.length;
            const slice = list.slice(0, limit);
            const edges = slice.map((n: any, i: number) => ({
                __typename: 'CommitEdge',
                node: n,
                cursor: String(i),
            }));
            return {
                __typename: 'CommitHistoryConnection',
                nodes: slice,
                edges,
                totalCount: list.length,
                pageInfo: {
                    hasNextPage: args.first != null && list.length > (args.first ?? 0),
                    hasPreviousPage: false,
                    startCursor: edges.length > 0 ? '0' : null,
                    endCursor: edges.length > 0 ? String(edges.length - 1) : null,
                },
            };
        },
        checkSuites: (src: any, args: any) =>
            conn(
                src?.checkSuites ?? [
                    checkSuite1,
                    checkSuite2,
                    checkSuite3,
                    checkSuite4,
                    checkSuite5,
                ],
                args,
            ),
        authors: (src: any, args: any) => {
            const gitActors = [mkGitActor(src?._seed ?? 0), mkGitActor((src?._seed ?? 0) + 1)];
            return conn(gitActors, args);
        },
    },

    // ---- Ref ----
    Ref: {
        associatedPullRequests: (src: any, args: any) =>
            conn(src?.associatedPullRequests ?? [pr1, pr2], args),
    },

    // ---- BranchProtectionRule ----
    BranchProtectionRule: {
        pushAllowances: (src: any, args: any) =>
            conn(
                src?.pushAllowances ?? [pushAllowanceUser, pushAllowanceTeam, pushAllowanceApp],
                args,
            ),
    },

    // ---- Environment ----
    Environment: {
        protectionRules: (src: any, args: any) =>
            conn(src?.protectionRules ?? [depProtRuleRequired], args),
    },

    // ---- DeploymentProtectionRule ----
    DeploymentProtectionRule: {
        reviewers: (src: any, args: any) => conn(src?.reviewers ?? [], args),
    },

    // ---- CheckSuite ----
    CheckSuite: {
        checkRuns: (src: any, args: any) => conn(src?.checkRuns ?? [checkRun1], args),
    },

    // ---- StatusContext ----
    StatusContext: {
        isRequired: (src: any, _args: any) => src?.isRequired ?? false,
    },

    // ---- StatusCheckRollup ----
    StatusCheckRollup: {
        contexts: (src: any, args: any) =>
            conn(src?.contexts ?? [statusContext1, statusContext2, statusContext3], args),
    },

    // ---- Label ----
    Label: {
        issues: (src: any, args: any) => conn(src?.issues ?? [], args),
        pullRequests: (src: any, args: any) => conn(src?.pullRequests ?? [], args),
    },

    // ---- Discussion ----
    Discussion: {
        comments: (src: any, args: any) => conn(src?.comments ?? [], args),
    },

    // ---- SecurityAdvisory ----
    SecurityAdvisory: {
        vulnerabilities: (src: any, args: any) => conn(src?.vulnerabilities ?? [], args),
    },

    // ---- DependencyGraphManifest ----
    DependencyGraphManifest: {
        dependencies: (src: any, args: any) =>
            conn(src?.dependencies ?? [dep_lodash, dep_react], args),
    },

    // ---- Organization ----
    Organization: {
        repositories: (src: any, args: any) => {
            let list: any[] = src?.repositories ?? allOrgRepos;
            if (args.isArchived === true) {
                list = list.filter((r: any) => r.isArchived === true);
            }
            if (args.privacy === 'PRIVATE') {
                // only truly private (small stargazer count, non-public)
                list = list.filter((r: any) => !r.isArchived && r.stargazerCount === 0);
            }
            return conn(list, args);
        },
        teams: (src: any, args: any) => {
            let list: any[] = src?.teams ?? allOrgTeams;
            // role: MEMBER filter - return all teams for simplicity
            return conn(list, args);
        },
        projectsV2: (src: any, args: any) => conn(src?.projectsV2 ?? allProjects, args),
        projectV2: (src: any, args: any) => {
            const num = Number(args.number);
            return projectByNumber.get(num) ?? project1;
        },
        team: (src: any, args: any) => {
            const slug = String(args.slug);
            return teamBySlug.get(slug) ?? null;
        },
        packages: (src: any, args: any) => conn(src?.packages ?? allPackages, args),
        membersWithRole: (src: any, args: any) => {
            const members: any[] = src?.membersWithRole ?? [];
            const limit = args.first ?? args.last ?? members.length;
            const slice = members.slice(0, limit);
            const edges = slice.map((user: any, i: number) => ({
                node: user,
                cursor: String(i),
                role: orgMemberRoles.get(user.login) ?? 'MEMBER',
            }));
            return {
                nodes: slice,
                edges,
                totalCount: members.length,
                pageInfo: {
                    hasNextPage: args.first != null && members.length > (args.first ?? 0),
                    hasPreviousPage: false,
                    startCursor: edges.length > 0 ? '0' : null,
                    endCursor: edges.length > 0 ? String(edges.length - 1) : null,
                },
            };
        },
        pendingMembers: (src: any, args: any) => conn(src?.pendingMembers ?? [], args),
        auditLog: (src: any, args: any) => {
            const query = args.query as string | undefined;
            let list: any[] = src?.auditLog ?? [];
            // Only OrgAddMemberAuditEntry for "action:org.add_member" filter
            if (query?.includes('org.add_member')) {
                list = list.filter((e: any) => e.__typename === 'OrgAddMemberAuditEntry');
            }
            return conn(list, args);
        },
        repositoryDiscussionComments: (src: any, args: any) => {
            // Return a flat list of all discussion comments across all org repos
            const allComments = [
                discComment1,
                discComment2,
                discComment3,
                discComment4,
                discComment5,
            ];
            let list =
                args.onlyAnswers === true
                    ? allComments // treat all as answers for simplicity
                    : allComments;
            return conn(list, args);
        },
    },

    // ---- Team ----
    Team: {
        repositories: (src: any, args: any) => {
            const repos: any[] = src?.repositories ?? [repoExample];
            const edges = repos.map((r, i) => ({
                __typename: 'TeamRepositoryEdge',
                node: r,
                permission: ['WRITE', 'READ', 'ADMIN'][i % 3]!,
                cursor: String(i),
            }));
            const limit = args.first ?? args.last ?? repos.length;
            const slicedEdges = edges.slice(0, limit);
            const slicedNodes = slicedEdges.map((e: any) => e.node);
            return {
                __typename: 'TeamRepositoryConnection',
                nodes: slicedNodes,
                edges: slicedEdges,
                totalCount: repos.length,
                pageInfo: {
                    hasNextPage: false,
                    hasPreviousPage: false,
                    startCursor: slicedEdges.length > 0 ? '0' : null,
                    endCursor: slicedEdges.length > 0 ? String(slicedEdges.length - 1) : null,
                },
            };
        },
        members: (src: any, args: any) => conn(src?.members ?? [userAlice, userBob], args),
        childTeams: (src: any, args: any) => conn(src?.childTeams ?? [], args),
    },

    // ---- ProjectV2 ----
    ProjectV2: {
        fields: (src: any, args: any) =>
            conn(src?.fields ?? [titleField, statusField, iterationField], args),
        field: (src: any, args: any) => {
            const name = String(args.name);
            return projectFieldByName(src, name);
        },
        items: (src: any, args: any) =>
            conn(src?.items ?? [projItem1, projItem2, projItem3, projItem4, projItem5], args),
        views: (src: any, args: any) => conn(src?.views ?? [projectView1, projectView2], args),
        statusUpdates: (src: any, args: any) => conn(src?.statusUpdates ?? [], args),
    },

    // ---- ProjectV2Item ----
    ProjectV2Item: {
        fieldValues: (src: any, args: any) => conn(src?.fieldValues ?? [], args),
    },

    // ---- User ----
    User: {
        starredRepositories: (src: any, args: any) => {
            const repos: any[] = src?.starredRepositories ?? [repoExample, repoHelloWorld];
            const starredAts = ['2024-09-10T00:00:00.000Z', '2025-02-15T00:00:00.000Z'];
            const limit = args.first ?? args.last ?? repos.length;
            const slicedRepos = repos.slice(0, limit);
            const edges = slicedRepos.map((r, i) => ({
                __typename: 'StarredRepositoryEdge',
                node: r,
                starredAt: starredAts[i] ?? mkDate(50 + i * 30),
                cursor: String(i),
            }));
            return {
                __typename: 'StarredRepositoryConnection',
                nodes: slicedRepos,
                edges,
                totalCount: repos.length,
                pageInfo: {
                    hasNextPage: false,
                    hasPreviousPage: false,
                    startCursor: edges.length > 0 ? '0' : null,
                    endCursor: edges.length > 0 ? String(edges.length - 1) : null,
                },
            };
        },
        gists: (src: any, args: any) => conn(src?.gists ?? [gist1, gist2, gist3], args),
        issueComments: (src: any, args: any) => conn(src?.issueComments ?? [], args),
        repositories: (src: any, args: any) => {
            let list: any[] = src?.repositories ?? viewerAllRepos;
            if (args.isFork === true) {
                list = list.filter((r: any) => r.isFork === true);
            }
            return conn(list, args);
        },
        organizations: (src: any, args: any) => conn(src?.organizations ?? [orgOctocat], args),
        following: (src: any, args: any) => conn(src?.following ?? viewerFollowing, args),
        followers: (src: any, args: any) => conn(src?.followers ?? viewerFollowers, args),
        pinnedItems: (src: any, args: any) => conn(src?.pinnedItems ?? viewerPinnedItems, args),
        pullRequests: (src: any, args: any) => {
            const states = args.states as string[] | undefined;
            let list: any[] = src?.pullRequests ?? [pr1, pr2, pr5, pr8, pr9];
            if (states && states.length > 0) {
                list = list.filter((pr: any) => states.includes(pr.state));
            }
            return conn(list, args);
        },
    },
};
