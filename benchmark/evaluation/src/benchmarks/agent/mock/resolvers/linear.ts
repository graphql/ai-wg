/**
 * Self-contained natural GraphQL server for the "linear" schema.
 *
 * Architecture: ONE plain JS object per logical entity, with DIRECT references between
 * related entities (no FK strings, no store lookups). Path-independence is free because
 * issue(id:"ENG-7").assignee and issues().nodes[eng7].assignee are the IDENTICAL JS object.
 *
 * Connection fields get a resolver (source,args)=>conn(source.<field>,args).
 * Root Query fields always get a resolver.
 * Scalar/single-object/plain-list fields: value on the entity, served by the default resolver.
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
    const slice = nodes.slice(0, limit);
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
function mkDate(key: string, offsetDays?: number) {
    const base = 1748736000000; // 2025-06-01T00:00:00Z in ms
    const offset = offsetDays !== undefined ? offsetDays : h(key) % 365;
    return new Date(base - offset * 86400000).toISOString();
}
// A date that is far in the past (> 90 days before 2025-06-01)
function oldDate(key: string) {
    const offset = 91 + (h(key) % 200); // 91-290 days before 2025-06-01
    return mkDate(key, offset);
}

// ---------------------------------------------------------------------------
// WorkflowState entities (shared; referenced by Issue, Team, etc.)
// ---------------------------------------------------------------------------
const wsUnstarted1 = {
    __typename: 'WorkflowState',
    id: 'ws-unstarted-1',
    _seed: h('WorkflowState#ws-unstarted-1'),
    name: 'Todo',
    type: 'unstarted',
    color: '#e2e2e2',
    position: 0,
};
const wsStarted1 = {
    __typename: 'WorkflowState',
    id: 'ws-started-1',
    _seed: h('WorkflowState#ws-started-1'),
    name: 'In Progress',
    type: 'started',
    color: '#f2c94c',
    position: 1,
};
const wsCompleted1 = {
    __typename: 'WorkflowState',
    id: 'ws-completed-1',
    _seed: h('WorkflowState#ws-completed-1'),
    name: 'Done',
    type: 'completed',
    color: '#5e6ad2',
    position: 2,
};
const wsCanceled1 = {
    __typename: 'WorkflowState',
    id: 'ws-canceled-1',
    _seed: h('WorkflowState#ws-canceled-1'),
    name: 'Canceled',
    type: 'canceled',
    color: '#95a2b3',
    position: 3,
};
const wsTriage1 = {
    __typename: 'WorkflowState',
    id: 'ws-triage-1',
    _seed: h('WorkflowState#ws-triage-1'),
    name: 'Triage',
    type: 'triage',
    color: '#f4a261',
    position: 0,
};
const wsDesignTodo = {
    __typename: 'WorkflowState',
    id: 'ws-design-todo',
    _seed: h('WorkflowState#ws-design-todo'),
    name: 'Backlog',
    type: 'unstarted',
    color: '#c4c4c4',
    position: 0,
};
const wsDesignDone = {
    __typename: 'WorkflowState',
    id: 'ws-design-done',
    _seed: h('WorkflowState#ws-design-done'),
    name: 'Complete',
    type: 'completed',
    color: '#27ae60',
    position: 1,
};
const wsTeam0State1 = {
    __typename: 'WorkflowState',
    id: 'ws-t0-1',
    _seed: h('WorkflowState#ws-t0-1'),
    name: 'Open',
    type: 'unstarted',
    color: '#a29bfe',
    position: 0,
};
const wsTeam0State2 = {
    __typename: 'WorkflowState',
    id: 'ws-t0-2',
    _seed: h('WorkflowState#ws-t0-2'),
    name: 'Resolved',
    type: 'completed',
    color: '#55efc4',
    position: 1,
};

// All WorkflowStates list (global)
const allWorkflowStates = [
    wsUnstarted1,
    wsStarted1,
    wsCompleted1,
    wsCanceled1,
    wsTriage1,
    wsDesignTodo,
    wsDesignDone,
    wsTeam0State1,
    wsTeam0State2,
];

// ---------------------------------------------------------------------------
// CustomerStatus / CustomerTier
// ---------------------------------------------------------------------------
const statusActive = {
    __typename: 'CustomerStatus',
    id: 'cstatus-active',
    _seed: h('CustomerStatus#cstatus-active'),
    name: 'Active',
    displayName: 'Active',
    color: '#27ae60',
    position: 0,
    type: 'active',
    description: 'Healthy, active customer',
    archivedAt: null,
    createdAt: mkDate('csaca', 200),
    updatedAt: mkDate('csaua', 10),
};
const statusChurnRisk = {
    __typename: 'CustomerStatus',
    id: 'cstatus-churn-risk',
    _seed: h('CustomerStatus#cstatus-churn-risk'),
    name: 'Churn Risk',
    displayName: 'Churn Risk',
    color: '#e74c3c',
    position: 1,
    type: 'inactive',
    description: 'At risk of churning',
    archivedAt: null,
    createdAt: mkDate('cscca', 200),
    updatedAt: mkDate('cscua', 10),
};
const statusTrial = {
    __typename: 'CustomerStatus',
    id: 'cstatus-trial',
    _seed: h('CustomerStatus#cstatus-trial'),
    name: 'Trial',
    displayName: 'Trial',
    color: '#f39c12',
    position: 2,
    type: 'active',
    description: 'In trial period',
    archivedAt: null,
    createdAt: mkDate('cstca', 200),
    updatedAt: mkDate('cstua', 10),
};
const tierEnterprise = {
    __typename: 'CustomerTier',
    id: 'ctier-enterprise',
    _seed: h('CustomerTier#ctier-enterprise'),
    name: 'Enterprise',
    displayName: 'Enterprise',
    color: '#6c5ce7',
    position: 0,
    description: 'Enterprise tier',
    archivedAt: null,
    createdAt: mkDate('cteca', 200),
    updatedAt: mkDate('cteua', 10),
};
const tierPro = {
    __typename: 'CustomerTier',
    id: 'ctier-pro',
    _seed: h('CustomerTier#ctier-pro'),
    name: 'Pro',
    displayName: 'Pro',
    color: '#00b894',
    position: 1,
    description: 'Pro tier',
    archivedAt: null,
    createdAt: mkDate('ctpca', 200),
    updatedAt: mkDate('ctpua', 10),
};
const tierFree = {
    __typename: 'CustomerTier',
    id: 'ctier-free',
    _seed: h('CustomerTier#ctier-free'),
    name: 'Free',
    displayName: 'Free',
    color: '#b2bec3',
    position: 2,
    description: 'Free tier',
    archivedAt: null,
    createdAt: mkDate('ctfca', 200),
    updatedAt: mkDate('ctfua', 10),
};

// ---------------------------------------------------------------------------
// Users (30 total; user-1..user-5 admin=true)
// ---------------------------------------------------------------------------
const userTitles: Record<string, string> = {
    'user-1': 'Staff Engineer',
    'user-2': 'Engineering Manager',
    'user-3': 'Senior Designer',
    'user-4': 'Security Engineer',
    'user-5': 'Site Reliability Engineer',
    'user-6': 'Backend Engineer',
    'user-7': 'Frontend Engineer',
    'user-8': 'Backend Engineer',
    'user-9': 'Platform Engineer',
    'user-10': 'Software Engineer',
};

function mkUser(
    id: string,
    name: string,
    email: string,
    admin: boolean,
    opts: Record<string, any> = {},
) {
    return {
        __typename: 'User',
        id,
        _seed: h(`User#${id}`),
        name,
        displayName: name,
        email,
        admin,
        active: true,
        guest: false,
        app: false,
        isMe: id === 'user-1',
        isMentionable: true,
        isAssignable: true,
        owner: false,
        createdIssueCount: 10 + (h(`${id}cic`) % 50),
        lastSeen: opts.lastSeen ?? mkDate(`${id}ls`, 5 + (h(`${id}ls`) % 20)),
        timezone: 'America/Los_Angeles',
        initials: name
            .split(' ')
            .map((p) => p[0])
            .join(''),
        avatarBackgroundColor: '#5e6ad2',
        url: `https://linear.app/u/${id}`,
        title: userTitles[id] ?? 'Software Engineer',
        supportsAgentSessions: false,
        inviteHash: '',
        canAccessAnyPublicTeam: true,
        // Connection arrays — populated after team/issue objects are created
        assignedIssues: [] as any[],
        createdIssues: [] as any[],
        teams: [] as any[],
        teamMemberships: [] as any[],
        issueDrafts: [] as any[],
        notifications: [] as any[],
        notificationSubscriptions: [] as any[],
        favorites: [] as any[],
        ...opts,
    };
}

const user1 = mkUser('user-1', 'Alice Johnson', 'alice@acme.com', true);
const user2 = mkUser('user-2', 'Bob Smith', 'bob@acme.com', true);
const user3 = mkUser('user-3', 'Carol White', 'carol@acme.com', true);
const user4 = mkUser('user-4', 'David Lee', 'david@acme.com', true);
const user5 = mkUser('user-5', 'Eva Martinez', 'eva@acme.com', true);
const user6 = mkUser('user-6', 'Frank Nguyen', 'frank@acme.com', false, {
    lastSeen: oldDate('user-6-ls'),
});
const user7 = mkUser('user-7', 'Grace Kim', 'grace@acme.com', false, {
    lastSeen: oldDate('user-7-ls'),
});
const user8 = mkUser('user-8', 'Henry Park', 'henry@acme.com', false);
const user9 = mkUser('user-9', 'Iris Chen', 'iris@acme.com', false);
const user10 = mkUser('user-10', 'Jack Brown', 'jack@acme.com', false);
const user11 = mkUser('user-11', 'Karen Davis', 'karen@acme.com', false);
const user12 = mkUser('user-12', 'Liam Wilson', 'liam@acme.com', false);
const user13 = mkUser('user-13', 'Maya Patel', 'maya@acme.com', false);
const user14 = mkUser('user-14', 'Noah Taylor', 'noah@acme.com', false);
const user15 = mkUser('user-15', 'Olivia Anderson', 'olivia@acme.com', false);
const user16 = mkUser('user-16', 'Peter Jackson', 'peter@acme.com', false);
const user17 = mkUser('user-17', 'Quinn Roberts', 'quinn@acme.com', false);
const user18 = mkUser('user-18', 'Rachel Green', 'rachel@acme.com', false);
const user19 = mkUser('user-19', 'Sam Harris', 'sam@acme.com', false);
const user20 = mkUser('user-20', 'Tara Lewis', 'tara@acme.com', false);
const user21 = mkUser('user-21', 'Umar Khan', 'umar@acme.com', false);
const user22 = mkUser('user-22', 'Vera Scott', 'vera@acme.com', false);
const user23 = mkUser('user-23', 'Will Turner', 'will@acme.com', false);
const user24 = mkUser('user-24', 'Xena Blake', 'xena@acme.com', false);
const user25 = mkUser('user-25', 'Yusuf Ali', 'yusuf@acme.com', false);
const user26 = mkUser('user-26', 'Zoe Clark', 'zoe@acme.com', false);
const user27 = mkUser('user-27', 'Aaron Hill', 'aaron@acme.com', false);
const user28 = mkUser('user-28', 'Bella Young', 'bella@acme.com', false);
const user29 = mkUser('user-29', 'Carlos King', 'carlos@acme.com', false);
const user30 = mkUser('user-30', 'Diana Wright', 'diana@acme.com', false);

const allUsers = [
    user1,
    user2,
    user3,
    user4,
    user5,
    user6,
    user7,
    user8,
    user9,
    user10,
    user11,
    user12,
    user13,
    user14,
    user15,
    user16,
    user17,
    user18,
    user19,
    user20,
    user21,
    user22,
    user23,
    user24,
    user25,
    user26,
    user27,
    user28,
    user29,
    user30,
];
const userById = new Map(allUsers.map((u) => [u.id, u]));

// ---------------------------------------------------------------------------
// Teams
// ---------------------------------------------------------------------------
function mkTeam(
    id: string,
    name: string,
    key: string,
    visibility = 'public',
    opts: Record<string, any> = {},
) {
    return {
        __typename: 'Team',
        id,
        _seed: h(`Team#${id}`),
        name,
        key,
        displayName: name,
        visibility,
        cyclesEnabled: true,
        cycleDuration: 2,
        cycleStartDay: 1,
        cycleCooldownTime: 0,
        upcomingCycleCount: 2,
        cycleIssueAutoAssignStarted: true,
        cycleIssueAutoAssignCompleted: true,
        cycleLockToActive: false,
        issueEstimationType: 'fibonacci',
        issueEstimationAllowZero: false,
        issueEstimationExtended: false,
        defaultIssueEstimate: 1,
        groupIssueHistory: true,
        autoArchivePeriod: 3,
        triageEnabled: true,
        requirePriorityToLeaveTriage: false,
        issueCount: 10 + (h(`${id}ic`) % 50),
        timezone: 'America/Los_Angeles',
        setIssueSortOrderOnStateChange: 'bottom',
        scimManaged: false,
        protected: false,
        inheritWorkflowStatuses: false,
        inheritIssueEstimation: false,
        securitySettings: {},
        progressHistory: {},
        currentProgress: {},
        aiThreadSummariesEnabled: false,
        aiDiscussionSummariesEnabled: false,
        slackNewIssue: false,
        slackIssueComments: false,
        slackIssueStatuses: false,
        inviteHash: '',
        cycleCalenderUrl: `https://linear.app/cycle/${id}.ical`,
        // populated later
        members: [] as any[],
        issues: [] as any[],
        cycles: [] as any[],
        states: [] as any[],
        gitAutomationStates: [] as any[],
        templates: [] as any[],
        activeCycle: null as any,
        triageResponsibility: null as any,
        ...opts,
    };
}

const teamEngineering = mkTeam('team-engineering', 'Engineering', 'ENG', 'public');
const teamDesign = mkTeam('team-design', 'Design', 'DES', 'private');
const team1 = mkTeam('team-1', 'Backend', 'BACK', 'public');
const teamT1 = mkTeam('team-t1', 'Infrastructure', 'INFRA', 'public');
const teamRoot0 = mkTeam('Team:root/Team/0', 'Platform', 'PLAT', 'public');
const teamFrontend = mkTeam('team-frontend', 'Frontend', 'FE', 'public');
const teamSecurity = mkTeam('team-security', 'Security', 'SEC', 'private');

const allTeams = [
    teamEngineering,
    teamDesign,
    team1,
    teamT1,
    teamRoot0,
    teamFrontend,
    teamSecurity,
];
const teamById = new Map(allTeams.map((t) => [t.id, t]));

// ---------------------------------------------------------------------------
// PaidSubscription & Organization
// ---------------------------------------------------------------------------
const paidSub = {
    __typename: 'PaidSubscription',
    id: 'sub-1',
    _seed: h('PaidSubscription#sub-1'),
    seats: 50,
    type: 'business',
    nextBillingAt: mkDate('sub1nb', 30),
    createdAt: mkDate('sub1ca', 365),
    updatedAt: mkDate('sub1ua', 10),
};

const org1: any = {
    __typename: 'Organization',
    id: 'org-1',
    _seed: h('Organization#org-1'),
    name: 'Acme Corp',
    urlKey: 'acme',
    logoUrl: null,
    periodUploadVolume: 42.5,
    roadmapEnabled: true,
    samlEnabled: false,
    scimEnabled: false,
    securitySettings: {},
    authSettings: {},
    scimSettings: null,
    samlSettings: null,
    allowedAuthServices: [],
    allowedFileUploadContentTypes: null,
    ipRestrictions: null,
    projectUpdateReminderFrequencyInWeeks: 2,
    projectUpdateRemindersDay: 'Wednesday',
    projectUpdateRemindersHour: 9,
    initiativeUpdateReminderFrequencyInWeeks: 4,
    initiativeUpdateRemindersDay: 'Monday',
    initiativeUpdateRemindersHour: 10,
    fiscalYearStartMonth: 0,
    workingDays: [1, 2, 3, 4, 5],
    releaseChannel: 'public',
    userCount: 30,
    createdIssueCount: 500,
    customerCount: 12,
    customersEnabled: true,
    releasesEnabled: true,
    feedEnabled: true,
    hipaaComplianceEnabled: false,
    aiAddonEnabled: false,
    agentAutomationEnabled: false,
    generatedUpdatesEnabled: false,
    aiTelemetryEnabled: false,
    aiThreadSummariesEnabled: false,
    aiDiscussionSummariesEnabled: false,
    linearAgentEnabled: false,
    linearAgentSettings: {},
    codingAgentEnabled: false,
    codingAgentSettings: {},
    codeIntelligenceEnabled: false,
    codeIntelligenceRepository: null,
    defaultFeedSummarySchedule: null,
    customersConfiguration: {},
    gitBranchFormat: null,
    gitLinkbackMessagesEnabled: true,
    gitPublicLinkbackMessagesEnabled: true,
    gitLinkbackDescriptionsEnabled: false,
    slackProjectChannelIntegration: null,
    slackProjectChannelPrefix: 'proj-',
    slackProjectChannelsEnabled: false,
    slackAutoCreateProjectChannel: false,
    projectStatuses: [] as any[],
    previousUrlKeys: [],
    subscription: paidSub,
    users: null as any,
    teams: null as any,
    integrations: null as any,
};

// Org.users / teams / integrations are set after all entities exist (connection resolvers handle them).

// ---------------------------------------------------------------------------
// UserSettings
// ---------------------------------------------------------------------------
const notifSchedule = {
    disabled: false,
    monday: { start: '09:00', end: '18:00' },
    tuesday: { start: '09:00', end: '18:00' },
    wednesday: { start: '09:00', end: '18:00' },
    thursday: { start: '09:00', end: '18:00' },
    friday: { start: '09:00', end: '17:00' },
    saturday: { start: null, end: null },
    sunday: { start: null, end: null },
};

const mkChannelPref = (mobile: boolean, desktop: boolean, email: boolean, slack: boolean) => ({
    mobile,
    desktop,
    email,
    slack,
});

const usettings1 = {
    __typename: 'UserSettings',
    id: 'usettings-1',
    _seed: h('UserSettings#usettings-1'),
    createdAt: mkDate('us1ca', 300),
    updatedAt: mkDate('us1ua', 5),
    notificationDeliveryPreferences: {
        mobile: { notificationsDisabled: false, schedule: notifSchedule },
        desktop: { notificationsDisabled: false, schedule: null },
        email: { notificationsDisabled: false, schedule: null },
    },
    notificationCategoryPreferences: {
        assignments: mkChannelPref(true, true, true, false),
        statusChanges: mkChannelPref(true, true, false, false),
        commentsAndReplies: mkChannelPref(true, true, true, false),
        mentions: mkChannelPref(true, true, false, true),
        reactions: mkChannelPref(false, true, false, false),
        subscriptions: mkChannelPref(true, true, false, false),
        documentChanges: mkChannelPref(true, true, false, false),
        postsAndUpdates: mkChannelPref(true, true, true, false),
        reminders: mkChannelPref(true, true, true, false),
        reviews: mkChannelPref(true, true, false, false),
        appsAndIntegrations: mkChannelPref(false, true, false, false),
        system: mkChannelPref(true, true, true, false),
        triage: mkChannelPref(true, true, false, false),
        customers: mkChannelPref(true, true, false, true),
        feed: mkChannelPref(false, true, false, false),
        billing: mkChannelPref(false, false, true, false),
    },
};

// ---------------------------------------------------------------------------
// ProjectStatus entities
// ---------------------------------------------------------------------------
const psPlanned = {
    __typename: 'ProjectStatus',
    id: 'ps-planned',
    _seed: h('ProjectStatus#ps-planned'),
    name: 'Planned',
    type: 'planned',
    color: '#b2bec3',
    position: 0,
    description: 'Not yet started',
};
const psStarted = {
    __typename: 'ProjectStatus',
    id: 'ps-started',
    _seed: h('ProjectStatus#ps-started'),
    name: 'In Progress',
    type: 'started',
    color: '#f2c94c',
    position: 1,
    description: 'Currently active',
};
const psPaused = {
    __typename: 'ProjectStatus',
    id: 'ps-paused',
    _seed: h('ProjectStatus#ps-paused'),
    name: 'On Hold',
    type: 'paused',
    color: '#fd79a8',
    position: 2,
    description: 'Temporarily paused',
};
const psCanceled = {
    __typename: 'ProjectStatus',
    id: 'ps-canceled',
    _seed: h('ProjectStatus#ps-canceled'),
    name: 'Canceled',
    type: 'canceled',
    color: '#e74c3c',
    position: 3,
    description: 'No longer active',
};
const psCompleted = {
    __typename: 'ProjectStatus',
    id: 'ps-completed',
    _seed: h('ProjectStatus#ps-completed'),
    name: 'Completed',
    type: 'completed',
    color: '#27ae60',
    position: 4,
    description: 'Done',
};

org1.projectStatuses = [psPlanned, psStarted, psPaused, psCanceled, psCompleted];

// ---------------------------------------------------------------------------
// Cycles (must exist before Issues)
// ---------------------------------------------------------------------------
const cycleEngineeringCurrent: any = {
    __typename: 'Cycle',
    id: 'cycle-engineering-current',
    _seed: h('Cycle#cycle-engineering-current'),
    number: 5,
    name: 'Sprint 5',
    description: 'Current sprint',
    startsAt: '2025-05-19T00:00:00.000Z',
    endsAt: '2025-06-02T00:00:00.000Z',
    completedAt: null,
    autoArchivedAt: null,
    isActive: true,
    isFuture: false,
    isPast: false,
    isNext: false,
    isPrevious: false,
    progress: 0.45,
    issueCountHistory: [0, 3, 5, 8, 10],
    completedIssueCountHistory: [0, 1, 2, 4, 5],
    scopeHistory: [0, 8, 13, 21, 26],
    completedScopeHistory: [0, 2, 5, 9, 12],
    inProgressScopeHistory: [0, 1, 2, 3, 4],
    progressHistory: {},
    currentProgress: {},
    team: teamEngineering,
    issues: [] as any[],
    uncompletedIssuesUponClose: [] as any[],
};

const cycle1: any = {
    __typename: 'Cycle',
    id: 'cycle-1',
    _seed: h('Cycle#cycle-1'),
    number: 1,
    name: 'Sprint 1',
    description: 'First sprint',
    startsAt: '2025-01-06T00:00:00.000Z',
    endsAt: '2025-01-20T00:00:00.000Z',
    completedAt: '2025-01-20T00:00:00.000Z',
    autoArchivedAt: null,
    isActive: false,
    isFuture: false,
    isPast: true,
    isNext: false,
    isPrevious: false,
    progress: 0.766,
    issueCountHistory: [0, 2, 4, 6, 8, 10, 12],
    completedIssueCountHistory: [0, 1, 2, 3, 5, 7, 9],
    scopeHistory: [0, 5, 8, 13, 21, 26, 30],
    completedScopeHistory: [0, 2, 4, 7, 10, 14, 23],
    inProgressScopeHistory: [0, 1, 1, 2, 3, 2, 1],
    progressHistory: {},
    currentProgress: {},
    team: team1,
    issues: [] as any[],
    uncompletedIssuesUponClose: [] as any[],
};

const cycleEngPast1: any = {
    __typename: 'Cycle',
    id: 'cycle-eng-past-1',
    _seed: h('Cycle#cycle-eng-past-1'),
    number: 3,
    name: 'Sprint 3',
    description: 'Past sprint',
    startsAt: '2025-03-03T00:00:00.000Z',
    endsAt: '2025-03-17T00:00:00.000Z',
    completedAt: '2025-03-17T00:00:00.000Z',
    autoArchivedAt: null,
    isActive: false,
    isFuture: false,
    isPast: true,
    isNext: false,
    isPrevious: false,
    progress: 0.82,
    issueCountHistory: [0, 4, 7, 10, 14],
    completedIssueCountHistory: [0, 2, 4, 7, 11],
    scopeHistory: [0, 10, 18, 27, 35],
    completedScopeHistory: [0, 4, 9, 15, 29],
    inProgressScopeHistory: [0, 1, 2, 3, 2],
    progressHistory: {},
    currentProgress: {},
    team: teamEngineering,
    issues: [] as any[],
    uncompletedIssuesUponClose: [] as any[],
};

const cycleEngPast2: any = {
    __typename: 'Cycle',
    id: 'cycle-eng-past-2',
    _seed: h('Cycle#cycle-eng-past-2'),
    number: 4,
    name: 'Sprint 4',
    description: 'Previous sprint',
    startsAt: '2025-04-28T00:00:00.000Z',
    endsAt: '2025-05-12T00:00:00.000Z',
    completedAt: '2025-05-12T00:00:00.000Z',
    autoArchivedAt: null,
    isActive: false,
    isFuture: false,
    isPast: true,
    isNext: false,
    isPrevious: true,
    progress: 0.91,
    issueCountHistory: [0, 3, 6, 9, 12, 15],
    completedIssueCountHistory: [0, 2, 4, 7, 10, 14],
    scopeHistory: [0, 8, 15, 22, 28, 33],
    completedScopeHistory: [0, 3, 7, 13, 18, 30],
    inProgressScopeHistory: [0, 1, 2, 2, 3, 1],
    progressHistory: {},
    currentProgress: {},
    team: teamEngineering,
    issues: [] as any[],
    uncompletedIssuesUponClose: [] as any[],
};

teamEngineering.activeCycle = cycleEngineeringCurrent;
teamEngineering.cycles = [cycleEngineeringCurrent, cycleEngPast1, cycleEngPast2];
team1.cycles = [cycle1];

const allCycles = [cycleEngineeringCurrent, cycle1, cycleEngPast1, cycleEngPast2];
const cycleById = new Map(allCycles.map((c) => [c.id, c]));

// ---------------------------------------------------------------------------
// Projects (must exist before Issues)
// ---------------------------------------------------------------------------
function mkProject(
    id: string,
    name: string,
    status: any,
    lead: any,
    opts: Record<string, any> = {},
) {
    const health = opts.health ?? ['onTrack', 'atRisk', 'offTrack'][h(`${id}hlth`) % 3]!;
    return {
        __typename: 'Project',
        id,
        _seed: h(`Project#${id}`),
        name,
        status,
        lead,
        description: `${name} project description`,
        targetDate: `2025-Q${1 + (h(`${id}td`) % 4)}`,
        health,
        healthUpdatedAt: mkDate(`${id}huat`, 3 + (h(`${id}huat`) % 10)),
        state: status.type, // deprecated scalar alias for status type
        startDate: `2025-0${1 + (h(`${id}sd`) % 6)}-01`,
        createdAt: mkDate(`${id}ca`, 90),
        updatedAt: mkDate(`${id}ua`, 2),
        archivedAt: null,
        trashed: false,
        url: `https://linear.app/projects/${id}`,
        slugId: id,
        sortOrder: h(`${id}so`) % 100,
        // populated later
        teams: [] as any[],
        documents: [] as any[],
        projectMilestones: [] as any[],
        projectUpdates: [] as any[],
        lastUpdate: null as any,
        externalLinks: [] as any[],
        relations: [] as any[],
        inverseRelations: [] as any[],
        ...opts,
    };
}

const projectMobileApp: any = mkProject('project-mobile-app', 'Mobile App', psStarted, user3);
const projectAuthRedesign: any = mkProject(
    'project-auth-redesign',
    'Auth Redesign',
    psStarted,
    user2,
);
const projectBillingPortal: any = mkProject('billing-portal', 'Billing Portal', psPlanned, user4);
const projectDataPipeline: any = mkProject('data-pipeline', 'Data Pipeline', psStarted, user1);
const projectAPIGateway: any = mkProject('api-gateway', 'API Gateway', psCanceled, null);
const projectDesignSystem: any = mkProject('design-system', 'Design System', psCompleted, user3);
const projectInfraUpgrade: any = mkProject(
    'infra-upgrade',
    'Infrastructure Upgrade',
    psStarted,
    user5,
    { health: 'onTrack' },
);
const projectSecurityAudit: any = mkProject('security-audit', 'Security Audit', psPaused, user4);
const projectOnboarding: any = mkProject('onboarding', 'Onboarding Flow', psStarted, user1);
const projectReporting: any = mkProject('reporting', 'Reporting Dashboard', psPlanned, null);

const allProjects = [
    projectMobileApp,
    projectAuthRedesign,
    projectBillingPortal,
    projectDataPipeline,
    projectAPIGateway,
    projectDesignSystem,
    projectInfraUpgrade,
    projectSecurityAudit,
    projectOnboarding,
    projectReporting,
];
const projectById = new Map(allProjects.map((p) => [p.id, p]));

// ---------------------------------------------------------------------------
// ProjectUpdates
// ---------------------------------------------------------------------------
function mkProjectUpdate(id: string, project: any, body: string, health: string) {
    return {
        __typename: 'ProjectUpdate',
        id,
        _seed: h(`ProjectUpdate#${id}`),
        body,
        health,
        createdAt: mkDate(`${id}ca`, 7),
        updatedAt: mkDate(`${id}ua`, 1),
        project,
        user: user1,
    };
}

const pu1 = mkProjectUpdate(
    'pu-mobile-1',
    projectMobileApp,
    'Mobile App is on track. Backend APIs complete.',
    'onTrack',
);
const pu2 = mkProjectUpdate(
    'pu-mobile-2',
    projectMobileApp,
    'UI components 70% done. Some delays in testing.',
    'atRisk',
);
const pu3 = mkProjectUpdate(
    'pu-auth-1',
    projectAuthRedesign,
    'Auth redesign started. OAuth integration in progress.',
    'onTrack',
);
const puInitiativePlatform = mkProjectUpdate(
    'pu-init-platform',
    projectMobileApp,
    'Platform refactor proceeding well. Key milestones met.',
    'onTrack',
);

projectMobileApp.lastUpdate = pu2;
projectAuthRedesign.lastUpdate = pu3;
projectMobileApp.projectUpdates = [pu1, pu2];
projectAuthRedesign.projectUpdates = [pu3];

// ---------------------------------------------------------------------------
// ProjectMilestones
// ---------------------------------------------------------------------------
const milestoneV2Beta: any = {
    __typename: 'ProjectMilestone',
    id: 'milestone-v2-beta',
    _seed: h('ProjectMilestone#milestone-v2-beta'),
    name: 'v2 Beta Launch',
    targetDate: '2025-05-15',
    status: 'overdue',
    progress: 0.885,
    currentProgress: 0.885,
    description: 'Beta release for testing',
    sortOrder: 1,
    createdAt: mkDate('mv2bca', 60),
    updatedAt: mkDate('mv2bua', 3),
    project: projectMobileApp,
};
const milestoneV2GA: any = {
    __typename: 'ProjectMilestone',
    id: 'milestone-v2-ga',
    _seed: h('ProjectMilestone#milestone-v2-ga'),
    name: 'v2 General Availability',
    targetDate: '2025-06-15',
    status: 'unstarted',
    progress: 0.12,
    currentProgress: 0.12,
    description: 'Public release',
    sortOrder: 2,
    createdAt: mkDate('mv2gaca', 55),
    updatedAt: mkDate('mv2gaua', 1),
    project: projectMobileApp,
};
const milestoneAuthV1: any = {
    __typename: 'ProjectMilestone',
    id: 'milestone-auth-v1',
    _seed: h('ProjectMilestone#milestone-auth-v1'),
    name: 'OAuth Integration',
    targetDate: '2025-06-30',
    status: 'unstarted',
    progress: 0.3,
    currentProgress: 0.3,
    description: 'OAuth 2.0 integration complete',
    sortOrder: 1,
    createdAt: mkDate('mav1ca', 45),
    updatedAt: mkDate('mav1ua', 2),
    project: projectAuthRedesign,
};

projectMobileApp.projectMilestones = [milestoneV2Beta, milestoneV2GA];
projectAuthRedesign.projectMilestones = [milestoneAuthV1];

const allProjectMilestones = [milestoneV2Beta, milestoneV2GA, milestoneAuthV1];
const projectMilestoneById = new Map(allProjectMilestones.map((m) => [m.id, m]));

// ---------------------------------------------------------------------------
// EntityExternalLinks (for Project.externalLinks)
// ---------------------------------------------------------------------------
function mkEntityExternalLink(id: string, label: string, url: string, project: any) {
    return {
        __typename: 'EntityExternalLink',
        id,
        _seed: h(`EntityExternalLink#${id}`),
        label,
        url,
        sortOrder: h(`${id}so`) % 10,
        archivedAt: null,
        creator: user1,
        createdAt: mkDate(`${id}ca`, 30),
        updatedAt: mkDate(`${id}ua`, 5),
    };
}

const eel1 = mkEntityExternalLink(
    'eel-mobile-1',
    'Design Figma',
    'https://figma.com/file/mobile-app-design',
    projectMobileApp,
);
const eel2 = mkEntityExternalLink(
    'eel-mobile-2',
    'Mobile App Store',
    'https://apps.apple.com/app/acme',
    projectMobileApp,
);
const eel3 = mkEntityExternalLink(
    'eel-auth-1',
    'Auth Spec',
    'https://notion.so/auth-spec',
    projectAuthRedesign,
);
const eel4 = mkEntityExternalLink(
    'eel-infra-1',
    'Infra Runbook',
    'https://wiki.example.com/infra',
    projectInfraUpgrade,
);

projectMobileApp.externalLinks = [eel1, eel2];
projectAuthRedesign.externalLinks = [eel3];
projectInfraUpgrade.externalLinks = [eel4];

const allEntityExternalLinks = [eel1, eel2, eel3, eel4];

// ---------------------------------------------------------------------------
// ProjectRelations — link to projects (add to project.relations / inverseRelations)
// ---------------------------------------------------------------------------
// pr1 and pr2 are defined later but we link here after projects exist
// (pr1 and pr2 defined in the ProjectRelations section below)

// ---------------------------------------------------------------------------
// Documents
// ---------------------------------------------------------------------------
function mkDoc(id: string, title: string, project: any) {
    return {
        __typename: 'Document',
        id,
        _seed: h(`Document#${id}`),
        title,
        content: `# ${title}\n\nContent for ${title}.`,
        summary: `Summary of ${title}.`,
        url: `https://linear.app/docs/${id}`,
        slugId: id,
        sortOrder: h(`${id}so`) % 10,
        icon: null,
        color: null,
        creator: user1,
        updatedBy: user1,
        initiative: null,
        team: null,
        issue: null,
        release: null,
        cycle: null,
        lastAppliedTemplate: null,
        hiddenAt: null,
        trashed: false,
        createdAt: mkDate(`${id}ca`, 30),
        updatedAt: mkDate(`${id}ua`, 5),
        project,
    };
}

const docAuthSpec = mkDoc('doc-auth-spec', 'Auth Redesign Spec', projectAuthRedesign);
const docMobileRoadmap = mkDoc('doc-mobile-roadmap', 'Mobile App Roadmap', projectMobileApp);
const docIncidentResponse = mkDoc('doc-incident-response', 'Incident Response Plan', null);

projectAuthRedesign.documents = [docAuthSpec];
projectMobileApp.documents = [docMobileRoadmap];
const allDocuments = [docAuthSpec, docMobileRoadmap, docIncidentResponse];

// ---------------------------------------------------------------------------
// Roadmaps
// ---------------------------------------------------------------------------
const roadmap1: any = {
    __typename: 'Roadmap',
    id: 'roadmap-1',
    _seed: h('Roadmap#roadmap-1'),
    name: 'Q3 2025 Roadmap',
    description: 'Key initiatives for Q3',
    createdAt: mkDate('r1ca', 90),
    updatedAt: mkDate('r1ua', 5),
    projects: [projectMobileApp, projectAuthRedesign, projectBillingPortal, projectDataPipeline],
    creator: user1,
};
const roadmap2: any = {
    __typename: 'Roadmap',
    id: 'roadmap-2',
    _seed: h('Roadmap#roadmap-2'),
    name: 'Security Roadmap',
    description: 'Security and compliance initiatives',
    createdAt: mkDate('r2ca', 80),
    updatedAt: mkDate('r2ua', 3),
    projects: [projectSecurityAudit, projectInfraUpgrade, projectAPIGateway, projectDesignSystem],
    creator: user4,
};
const allRoadmaps = [roadmap1, roadmap2];

// ---------------------------------------------------------------------------
// Initiatives
// ---------------------------------------------------------------------------
function mkInitiativeUpdate(id: string, initiative: any, body: string, health: string) {
    return {
        __typename: 'InitiativeUpdate',
        id,
        _seed: h(`InitiativeUpdate#${id}`),
        body,
        health,
        createdAt: mkDate(`${id}ca`, 5),
        updatedAt: mkDate(`${id}ua`, 1),
        initiative,
    };
}

const initiativePlatformRefactor: any = {
    __typename: 'Initiative',
    id: 'initiative-platform-refactor',
    _seed: h('Initiative#initiative-platform-refactor'),
    name: 'Platform Refactor',
    status: 'Active',
    slugId: 'platform-refactor',
    targetDate: '2025-Q4',
    targetDateResolution: 'quarter',
    health: 'onTrack',
    description: 'Refactor core platform services for scalability.',
    sortOrder: 0,
    color: '#6c5ce7',
    icon: '🔧',
    trashed: false,
    labelIds: [],
    createdAt: mkDate('iprca', 120),
    updatedAt: mkDate('iprua', 3),
    owner: user1,
    creator: user1,
    organization: org1,
    url: 'https://linear.app/initiatives/initiative-platform-refactor',
    subInitiatives: [] as any[],
    projects: [projectMobileApp, projectDataPipeline],
    lastUpdate: null as any,
    healthUpdatedAt: mkDate('iprhuat', 5),
    startedAt: mkDate('iprsa', 90),
    completedAt: null,
    frequencyResolution: 'weeks',
    updateReminderFrequencyInWeeks: 2,
};

const initiativeAIPlatform: any = {
    __typename: 'Initiative',
    id: 'AI-Platform',
    _seed: h('Initiative#AI-Platform'),
    name: 'AI Platform',
    status: 'Active',
    slugId: 'ai-platform',
    targetDate: '2026-Q1',
    targetDateResolution: 'quarter',
    health: 'atRisk',
    description: 'Build AI-powered features across the platform.',
    sortOrder: 1,
    color: '#00b894',
    icon: '🤖',
    trashed: false,
    labelIds: [],
    createdAt: mkDate('aipc', 100),
    updatedAt: mkDate('aipua', 2),
    owner: user2,
    creator: user2,
    organization: org1,
    url: 'https://linear.app/initiatives/ai-platform',
    subInitiatives: [] as any[],
    projects: [projectAuthRedesign, projectBillingPortal],
    lastUpdate: null as any,
    healthUpdatedAt: mkDate('aiphuat', 4),
    startedAt: mkDate('aipsa', 60),
    completedAt: null,
    frequencyResolution: 'weeks',
    updateReminderFrequencyInWeeks: 4,
};

const initiativeSecurityHardening: any = {
    __typename: 'Initiative',
    id: 'initiative-security-hardening',
    _seed: h('Initiative#initiative-security-hardening'),
    name: 'Security Hardening',
    status: 'Active',
    slugId: 'security-hardening',
    targetDate: '2025-Q3',
    targetDateResolution: 'quarter',
    health: 'offTrack',
    description: 'Harden security across all services.',
    sortOrder: 2,
    color: '#e74c3c',
    icon: '🔒',
    trashed: false,
    labelIds: [],
    createdAt: mkDate('ishca', 110),
    updatedAt: mkDate('ishua', 1),
    owner: user4,
    creator: user4,
    organization: org1,
    url: 'https://linear.app/initiatives/initiative-security-hardening',
    subInitiatives: [] as any[],
    projects: [projectSecurityAudit],
    lastUpdate: null as any,
    healthUpdatedAt: mkDate('ishhuat', 3),
    startedAt: mkDate('ishsa', 80),
    completedAt: null,
    frequencyResolution: 'weeks',
    updateReminderFrequencyInWeeks: 2,
};

const initiativePlanned1: any = {
    __typename: 'Initiative',
    id: 'initiative-planned-1',
    _seed: h('Initiative#initiative-planned-1'),
    name: 'Developer Experience',
    status: 'Planned',
    slugId: 'developer-experience',
    targetDate: '2025-Q3',
    health: null,
    targetDateResolution: 'quarter',
    description: 'Improve developer tooling and workflows.',
    sortOrder: 3,
    color: '#0984e3',
    icon: '💻',
    trashed: false,
    labelIds: [],
    createdAt: mkDate('ip1ca', 70),
    updatedAt: mkDate('ip1ua', 10),
    owner: user3,
    creator: user3,
    organization: org1,
    url: 'https://linear.app/initiatives/initiative-planned-1',
    subInitiatives: [] as any[],
    projects: [projectDesignSystem, projectOnboarding],
    lastUpdate: null as any,
    healthUpdatedAt: null,
    startedAt: null,
    completedAt: null,
    frequencyResolution: 'weeks',
    updateReminderFrequencyInWeeks: null,
};

// Sub-initiatives of AI-Platform
const subInitiativeMLOps: any = {
    __typename: 'Initiative',
    id: 'initiative-ml-ops',
    _seed: h('Initiative#initiative-ml-ops'),
    name: 'MLOps Infrastructure',
    status: 'Active',
    slugId: 'ml-ops',
    targetDate: '2025-Q4',
    health: 'atRisk',
    targetDateResolution: 'quarter',
    description: 'Build ML operations infrastructure.',
    sortOrder: 0,
    color: '#fdcb6e',
    icon: '⚙️',
    trashed: false,
    labelIds: [],
    createdAt: mkDate('smca', 50),
    updatedAt: mkDate('smua', 2),
    owner: user5,
    creator: user2,
    organization: org1,
    url: 'https://linear.app/initiatives/initiative-ml-ops',
    subInitiatives: [] as any[],
    projects: [],
    lastUpdate: null as any,
    healthUpdatedAt: mkDate('smhuat', 2),
    startedAt: mkDate('smsa', 40),
    completedAt: null,
    frequencyResolution: 'weeks',
    parentInitiative: initiativeAIPlatform,
    updateReminderFrequencyInWeeks: 2,
};

const subInitiativeLLMIntegration: any = {
    __typename: 'Initiative',
    id: 'initiative-llm-integration',
    _seed: h('Initiative#initiative-llm-integration'),
    name: 'LLM Integration',
    status: 'Active',
    slugId: 'llm-integration',
    targetDate: '2026-Q1',
    health: 'onTrack',
    targetDateResolution: 'quarter',
    description: 'Integrate large language models into the platform.',
    sortOrder: 1,
    color: '#a29bfe',
    icon: '🧠',
    trashed: false,
    labelIds: [],
    createdAt: mkDate('slca', 45),
    updatedAt: mkDate('slua', 1),
    owner: user2,
    creator: user2,
    organization: org1,
    url: 'https://linear.app/initiatives/initiative-llm-integration',
    subInitiatives: [] as any[],
    projects: [],
    lastUpdate: null as any,
    healthUpdatedAt: mkDate('slhuat', 1),
    startedAt: mkDate('slsa', 35),
    completedAt: null,
    frequencyResolution: 'weeks',
    parentInitiative: initiativeAIPlatform,
    updateReminderFrequencyInWeeks: 4,
};

initiativeAIPlatform.subInitiatives = [subInitiativeMLOps, subInitiativeLLMIntegration];

// Initiative updates
const iuPlatform = mkInitiativeUpdate(
    'iu-platform-1',
    initiativePlatformRefactor,
    'Platform refactor proceeding well. Key milestones met.',
    'onTrack',
);
const iuAI = mkInitiativeUpdate(
    'iu-ai-1',
    initiativeAIPlatform,
    'AI platform showing promise but timeline at risk.',
    'atRisk',
);
const iuSecurity = mkInitiativeUpdate(
    'iu-security-1',
    initiativeSecurityHardening,
    'Security hardening behind schedule.',
    'offTrack',
);

initiativePlatformRefactor.lastUpdate = iuPlatform;
initiativeAIPlatform.lastUpdate = iuAI;
initiativeSecurityHardening.lastUpdate = iuSecurity;

const allInitiatives = [
    initiativePlatformRefactor,
    initiativeAIPlatform,
    initiativeSecurityHardening,
    initiativePlanned1,
    subInitiativeMLOps,
    subInitiativeLLMIntegration,
];
const initiativeById = new Map(allInitiatives.map((i) => [i.id, i]));

// ---------------------------------------------------------------------------
// Attachments
// ---------------------------------------------------------------------------
function mkAttachment(
    id: string,
    title: string,
    url: string,
    sourceType: string,
    issueRef: any = null,
) {
    return {
        __typename: 'Attachment',
        id,
        _seed: h(`Attachment#${id}`),
        title,
        url,
        sourceType,
        subtitle: `${sourceType} attachment`,
        createdAt: mkDate(`${id}ca`, 10),
        updatedAt: mkDate(`${id}ua`, 2),
        creator: user1,
        issue: issueRef,
    };
}

// Will be linked to issues after issues are created
const allAttachments: any[] = [];

// ---------------------------------------------------------------------------
// IssueLabels
// ---------------------------------------------------------------------------
function mkLabel(id: string, name: string, color: string, team: any) {
    return {
        __typename: 'IssueLabel',
        id,
        _seed: h(`IssueLabel#${id}`),
        name,
        color,
        team,
        createdAt: mkDate(`${id}ca`, 60),
        updatedAt: mkDate(`${id}ua`, 10),
    };
}

const labelBug = mkLabel('label-bug', 'Bug', '#e74c3c', teamEngineering);
const labelFeature = mkLabel('label-feature', 'Feature', '#3498db', teamEngineering);
const labelUX = mkLabel('label-ux', 'UX', '#9b59b6', teamDesign);
const labelPerf = mkLabel('label-perf', 'Performance', '#f39c12', teamEngineering);
const labelSecurity = mkLabel('label-security', 'Security', '#e74c3c', teamSecurity);
const labelInfra = mkLabel('label-infra', 'Infrastructure', '#1abc9c', teamT1);
const labelDocs = mkLabel('label-docs', 'Documentation', '#7f8c8d', teamEngineering);
const labelAPI = mkLabel('label-api', 'API', '#2ecc71', teamEngineering);
const labelMobile = mkLabel('label-mobile', 'Mobile', '#00b894', teamEngineering);
const labelRefactor = mkLabel('label-refactor', 'Refactor', '#a29bfe', teamEngineering);

const allIssueLabels = [
    labelBug,
    labelFeature,
    labelUX,
    labelPerf,
    labelSecurity,
    labelInfra,
    labelDocs,
    labelAPI,
    labelMobile,
    labelRefactor,
];

// ---------------------------------------------------------------------------
// Issues — the main entity set
// ---------------------------------------------------------------------------
function mkIssue(
    id: string,
    title: string,
    team: any,
    state: any,
    priority: number,
    opts: Record<string, any> = {},
) {
    const seed = h(`Issue#${id}`);
    return {
        __typename: 'Issue',
        id,
        _seed: seed,
        identifier: opts.identifier ?? `${team.key}-${100 + (seed % 900)}`,
        title,
        priority,
        priorityLabel:
            ['No priority', 'Urgent', 'High', 'Medium', 'Low'][Math.min(priority, 4)] ??
            'No priority',
        estimate: opts.estimate ?? (seed % 2 === 0 ? null : [1, 2, 3, 5, 8, 13][seed % 6]!),
        number: seed % 1000,
        state,
        team,
        cycle: opts.cycle ?? null,
        project: opts.project ?? null,
        assignee: opts.assignee ?? null,
        creator: opts.creator ?? user1,
        parent: opts.parent ?? null,
        projectMilestone: opts.projectMilestone ?? null,
        dueDate: opts.dueDate ?? null,
        snoozedUntilAt: opts.snoozedUntilAt ?? null,
        startedAt:
            opts.startedAt ??
            (state.type === 'started' || state.type === 'completed'
                ? mkDate(`${id}sta`, 10)
                : null),
        completedAt:
            opts.completedAt ?? (state.type === 'completed' ? mkDate(`${id}cpa`, 3) : null),
        canceledAt: opts.canceledAt ?? (state.type === 'canceled' ? mkDate(`${id}cxa`, 2) : null),
        branchName:
            opts.branchName ??
            `${team.key.toLowerCase()}-${seed % 9000}-${title
                .toLowerCase()
                .replace(/[^a-z0-9]+/g, '-')
                .slice(0, 30)}`,
        url: `https://linear.app/issues/${id}`,
        description: `Description for ${title}`,
        labelIds: [],
        previousIdentifiers: [],
        trashed: false,
        reactionData: {},
        customerTicketCount: opts.customerTicketCount ?? seed % 100,
        inheritsSharedAccess: false,
        sortOrder: seed % 10000,
        prioritySortOrder: seed % 10000,
        boardOrder: seed % 10000,
        subIssueSortOrder: null,
        // Connection arrays
        children: opts.children ?? ([] as any[]),
        comments: [] as any[],
        history: [] as any[],
        relations: [] as any[],
        attachments: [] as any[],
        subscribers: [] as any[],
        needs: [] as any[],
        reactions: [] as any[],
        labels: opts.labels ?? ([] as any[]),
        documents: [] as any[],
        // other nullable scalars
        archivedAt: null,
        autoArchivedAt: null,
        autoClosedAt: null,
        triagedAt: null,
        startedTriageAt: null,
        addedToProjectAt: null,
        addedToCycleAt: null,
        addedToTeamAt: null,
        suggestionsGeneratedAt: null,
        slaStartedAt: null,
        slaMediumRiskAt: null,
        slaHighRiskAt: null,
        slaBreachesAt: null,
        slaType: null,
        createdAt: opts.createdAt ?? mkDate(`${id}ca`, 30),
        updatedAt: mkDate(`${id}ua`, 1),
    };
}

// Required literal issues
const issueENG7: any = mkIssue(
    'ENG-7',
    'Fix authentication token refresh',
    teamEngineering,
    wsStarted1,
    2,
    {
        identifier: 'ENG-7',
        assignee: user1,
        creator: user2,
        cycle: cycleEngineeringCurrent,
        project: projectAuthRedesign,
        labels: [labelBug, labelAPI],
    },
);
const issueENG99: any = mkIssue(
    'ENG-99',
    'Implement rate limiting on API gateway',
    teamEngineering,
    wsUnstarted1,
    1,
    {
        identifier: 'ENG-99',
        assignee: user2,
        creator: user1,
        project: projectAPIGateway,
        labels: [labelAPI, labelPerf],
        dueDate: '2025-07-30',
    },
);
const issueENG200: any = mkIssue(
    'ENG-200',
    'Migrate database to PostgreSQL 16',
    teamEngineering,
    wsStarted1,
    2,
    {
        identifier: 'ENG-200',
        assignee: user3,
        creator: user1,
        project: projectDataPipeline,
        labels: [labelInfra],
    },
);
const issueENG241: any = mkIssue(
    'ENG-241',
    'Refactor authentication middleware',
    teamEngineering,
    wsCompleted1,
    3,
    {
        identifier: 'ENG-241',
        assignee: user1,
        creator: user3,
        project: projectAuthRedesign,
        labels: [labelRefactor],
        startedAt: '2025-05-01T00:00:00.000Z',
        completedAt: '2025-05-15T00:00:00.000Z',
    },
);
const issueENG321: any = mkIssue(
    'ENG-321',
    'Add unit tests for payment module',
    teamEngineering,
    wsUnstarted1,
    3,
    {
        identifier: 'ENG-321',
        assignee: user2,
        creator: user1,
        project: projectBillingPortal,
        labels: [labelFeature],
    },
);
const issueENG512: any = mkIssue(
    'ENG-512',
    'Fix rate limit bypass vulnerability',
    teamEngineering,
    wsStarted1,
    1,
    {
        identifier: 'ENG-512',
        assignee: user4,
        creator: user1,
        branchName: 'fix-rate-limit',
        project: projectSecurityAudit,
        labels: [labelSecurity, labelBug],
        url: 'https://linear.app/issues/ENG-512',
    },
);
const issueENG902: any = mkIssue(
    'ENG-902',
    'Performance regression in search results',
    teamEngineering,
    wsStarted1,
    2,
    {
        identifier: 'ENG-902',
        assignee: user5,
        creator: user2,
        project: projectDataPipeline,
        labels: [labelPerf, labelBug],
    },
);
const issueEngAlt441: any = mkIssue(
    'issue-eng-441',
    'Customer reported login issue on mobile',
    teamEngineering,
    wsStarted1,
    1,
    {
        identifier: 'ENG-441',
        assignee: user1,
        creator: user3,
        project: projectMobileApp,
        labels: [labelBug, labelMobile],
        customerTicketCount: 531,
    },
);
const issueEngAlt1023: any = mkIssue(
    'issue-eng-1023',
    'API documentation update needed',
    teamEngineering,
    wsUnstarted1,
    4,
    {
        identifier: 'ENG-1023',
        assignee: user2,
        creator: user1,
        project: projectAPIGateway,
        labels: [labelDocs, labelAPI],
        customerTicketCount: 677,
    },
);

// Additional issues for user-1 assignedIssues (need many, various states/priorities)
// Some with dueDate < 2025-06-01 (overdue) and some with snoozedUntilAt
const issueU1A: any = mkIssue(
    'issue-u1-a',
    'Update mobile app onboarding flow',
    teamEngineering,
    wsStarted1,
    2,
    {
        identifier: 'ENG-100',
        assignee: user1,
        creator: user2,
        project: projectMobileApp,
        cycle: cycleEngineeringCurrent,
        dueDate: '2025-05-29', // overdue relative to today 2025-06-01
        labels: [labelFeature, labelMobile],
    },
);
const issueU1B: any = mkIssue(
    'issue-u1-b',
    'Resolve webpack bundle size issue',
    teamEngineering,
    wsUnstarted1,
    3,
    {
        identifier: 'ENG-101',
        assignee: user1,
        creator: user3,
        project: projectInfraUpgrade,
        cycle: cycleEngineeringCurrent,
        dueDate: '2025-05-27', // overdue
        snoozedUntilAt: '2025-06-14T09:00:00.000Z',
        labels: [labelPerf, labelInfra],
    },
);
const issueU1C: any = mkIssue(
    'issue-u1-c',
    'Add dark mode support',
    teamEngineering,
    wsStarted1,
    4,
    {
        identifier: 'ENG-102',
        assignee: user1,
        creator: user1,
        project: projectMobileApp,
        cycle: cycleEngineeringCurrent,
        labels: [labelFeature, labelUX],
    },
);
const issueU1D: any = mkIssue(
    'issue-u1-d',
    'Fix CI pipeline flakiness',
    teamEngineering,
    wsUnstarted1,
    2,
    {
        identifier: 'ENG-103',
        assignee: user1,
        creator: user4,
        project: projectInfraUpgrade,
        snoozedUntilAt: '2025-06-18T10:00:00.000Z',
        labels: [labelInfra],
    },
);
const issueU1E: any = mkIssue(
    'issue-u1-e',
    'Implement audit logging',
    teamEngineering,
    wsUnstarted1,
    1,
    {
        identifier: 'ENG-104',
        assignee: user1,
        creator: user1,
        project: projectSecurityAudit,
        dueDate: '2025-05-30', // overdue
        labels: [labelSecurity],
    },
);
const issueU1F: any = mkIssue(
    'issue-u1-f',
    'Upgrade dependencies to latest LTS',
    teamEngineering,
    wsStarted1,
    3,
    {
        identifier: 'ENG-105',
        assignee: user1,
        creator: user2,
        project: projectInfraUpgrade,
        cycle: cycleEngineeringCurrent,
        labels: [labelInfra, labelRefactor],
    },
);
const issueU1G: any = mkIssue(
    'issue-u1-g',
    'Write integration tests for auth service',
    teamEngineering,
    wsUnstarted1,
    2,
    {
        identifier: 'ENG-106',
        assignee: user1,
        creator: user3,
        project: projectAuthRedesign,
        labels: [labelFeature],
    },
);
const issueU1H: any = mkIssue(
    'issue-u1-h',
    'Optimize database query performance',
    teamEngineering,
    wsStarted1,
    2,
    {
        identifier: 'ENG-107',
        assignee: user1,
        creator: user1,
        project: projectDataPipeline,
        cycle: cycleEngineeringCurrent,
        labels: [labelPerf],
    },
);

// More issues for various teams
const issueBACK1: any = mkIssue(
    'issue-back-1',
    'Implement pagination for user list',
    team1,
    wsUnstarted1,
    3,
    {
        identifier: 'BACK-1',
        assignee: user8,
        creator: user9,
        project: projectDataPipeline,
    },
);
const issueBACK2: any = mkIssue(
    'issue-back-2',
    'Add caching layer for frequent queries',
    team1,
    wsStarted1,
    2,
    {
        identifier: 'BACK-2',
        assignee: user9,
        creator: user8,
        project: projectDataPipeline,
        cycle: cycle1,
        startedAt: '2025-01-10T00:00:00.000Z',
        completedAt: '2025-01-18T00:00:00.000Z',
    },
);
const issueBACK3: any = mkIssue(
    'issue-back-3',
    'Migrate to new message queue system',
    team1,
    wsCanceled1,
    4,
    {
        identifier: 'BACK-3',
        assignee: null,
        creator: user8,
        canceledAt: '2025-01-15T00:00:00.000Z',
        cycle: cycle1,
    },
);
const issueINFRA1: any = mkIssue(
    'issue-infra-1',
    'Set up Kubernetes cluster for staging',
    teamT1,
    wsStarted1,
    1,
    {
        identifier: 'INFRA-1',
        assignee: user5,
        creator: user4,
        project: projectInfraUpgrade,
    },
);
const issueINFRA2: any = mkIssue(
    'issue-infra-2',
    'Configure monitoring and alerting',
    teamT1,
    wsUnstarted1,
    2,
    {
        identifier: 'INFRA-2',
        assignee: user12,
        creator: user5,
        project: projectInfraUpgrade,
    },
);
const issueDES1: any = mkIssue(
    'issue-des-1',
    'Redesign dashboard layout',
    teamDesign,
    wsDesignTodo,
    2,
    {
        identifier: 'DES-1',
        assignee: user3,
        creator: user3,
        project: projectDesignSystem,
    },
);
const issueDES2: any = mkIssue('issue-des-2', 'Create icon library', teamDesign, wsDesignDone, 3, {
    identifier: 'DES-2',
    assignee: user3,
    creator: user3,
    project: projectDesignSystem,
    startedAt: '2025-04-01T00:00:00.000Z',
    completedAt: '2025-05-01T00:00:00.000Z',
});

// Additional generic issues
const genericIssues: any[] = [];
for (let i = 1; i <= 20; i++) {
    const states = [wsUnstarted1, wsStarted1, wsCompleted1, wsCanceled1];
    const teams = [teamEngineering, team1, teamT1];
    const projects = [projectMobileApp, projectAuthRedesign, projectBillingPortal, null];
    const assignees = [user6, user7, user8, user9, user10, user11, null];
    const sd = h(`generic-issue-${i}`);
    genericIssues.push(
        mkIssue(
            `issue-generic-${i}`,
            [
                `Implement feature X-${i}`,
                `Fix bug Y-${i}`,
                `Refactor module Z-${i}`,
                `Update docs for component-${i}`,
                `Add tests for service-${i}`,
            ][i % 5]!,
            teams[sd % 3]!,
            states[sd % 4]!,
            [0, 1, 2, 3, 4][sd % 5]!,
            {
                identifier: `${teams[sd % 3]!.key}-${200 + i}`,
                assignee: assignees[sd % 7]!,
                project: projects[sd % 4]!,
                cycle: i % 3 === 0 ? cycleEngineeringCurrent : null,
            },
        ),
    );
}

// Sub-issue for ENG-7
const issueENG7Sub1: any = mkIssue(
    'issue-eng7-sub-1',
    'Fix token refresh endpoint',
    teamEngineering,
    wsCompleted1,
    2,
    {
        identifier: 'ENG-7S1',
        assignee: user1,
        parent: issueENG7,
        project: projectAuthRedesign,
        startedAt: '2025-05-20T00:00:00.000Z',
        completedAt: '2025-05-25T00:00:00.000Z',
    },
);
const issueENG7Sub2: any = mkIssue(
    'issue-eng7-sub-2',
    'Update token refresh tests',
    teamEngineering,
    wsStarted1,
    3,
    {
        identifier: 'ENG-7S2',
        assignee: user1,
        parent: issueENG7,
        project: projectAuthRedesign,
    },
);
issueENG7.children = [issueENG7Sub1, issueENG7Sub2];

// Compile all issues list
const allIssues: any[] = [
    issueENG7,
    issueENG99,
    issueENG200,
    issueENG241,
    issueENG321,
    issueENG512,
    issueENG902,
    issueEngAlt441,
    issueEngAlt1023,
    issueU1A,
    issueU1B,
    issueU1C,
    issueU1D,
    issueU1E,
    issueU1F,
    issueU1G,
    issueU1H,
    issueBACK1,
    issueBACK2,
    issueBACK3,
    issueINFRA1,
    issueINFRA2,
    issueDES1,
    issueDES2,
    issueENG7Sub1,
    issueENG7Sub2,
    ...genericIssues,
];
const issueById = new Map(allIssues.map((i) => [i.id, i]));

// team.issues
teamEngineering.issues = [
    issueENG7,
    issueENG99,
    issueENG200,
    issueENG241,
    issueENG321,
    issueENG512,
    issueENG902,
    issueEngAlt441,
    issueEngAlt1023,
    issueU1A,
    issueU1B,
    issueU1C,
    issueU1D,
    issueU1E,
    issueU1F,
    issueU1G,
    issueU1H,
    issueENG7Sub1,
    issueENG7Sub2,
    ...genericIssues.filter((i: any) => i.team === teamEngineering),
];
team1.issues = [
    issueBACK1,
    issueBACK2,
    issueBACK3,
    ...genericIssues.filter((i: any) => i.team === team1),
];
teamT1.issues = [issueINFRA1, issueINFRA2, ...genericIssues.filter((i: any) => i.team === teamT1)];
teamDesign.issues = [issueDES1, issueDES2];
teamRoot0.issues = [...genericIssues.filter((i: any) => i.team === teamEngineering).slice(0, 5)];

// Cycle issues
cycleEngineeringCurrent.issues = [
    issueENG7,
    issueENG512,
    issueU1A,
    issueU1B,
    issueU1C,
    issueU1F,
    issueU1H,
];
cycle1.issues = [issueBACK2, issueBACK3];
cycleEngPast1.issues = [issueENG200, issueENG241, issueENG321, issueENG902, issueU1D, issueU1G];
cycleEngPast2.issues = [issueENG99, issueEngAlt441, issueU1A, issueU1E];
cycleEngineeringCurrent.uncompletedIssuesUponClose = [issueU1B, issueU1C, issueU1D];
cycleEngPast1.uncompletedIssuesUponClose = [issueENG321];
cycle1.uncompletedIssuesUponClose = [issueBACK3];

// Project issues
projectMobileApp.issues = [issueU1A, issueU1C, issueEngAlt441];
projectAuthRedesign.issues = [issueENG7, issueENG241, issueU1G, issueENG7Sub1, issueENG7Sub2];
projectDataPipeline.issues = [issueENG200, issueENG902, issueU1H, issueBACK1, issueBACK2];
projectSecurityAudit.issues = [issueENG512, issueU1E];
projectInfraUpgrade.issues = [issueU1B, issueU1D, issueU1F, issueINFRA1, issueINFRA2];
projectBillingPortal.issues = [issueENG321];
projectAPIGateway.issues = [issueENG99, issueEngAlt1023];
projectDesignSystem.issues = [issueDES1, issueDES2];

// user-1 assignedIssues and createdIssues
user1.assignedIssues = [
    issueENG7,
    issueENG241,
    issueEngAlt441,
    issueU1A,
    issueU1B,
    issueU1C,
    issueU1D,
    issueU1E,
    issueU1F,
    issueU1G,
    issueU1H,
];
user1.createdIssues = [
    issueENG99,
    issueENG200,
    issueENG321,
    issueU1C,
    issueU1D,
    issueU1H,
    issueENG7Sub1,
    issueENG7Sub2,
    issueBACK1,
    issueBACK2,
];
user2.assignedIssues = [
    issueENG99,
    issueENG321,
    issueEngAlt1023,
    issueU1B,
    ...genericIssues.filter((_, i) => i % 4 === 0).slice(0, 3),
];
user3.assignedIssues = [
    issueENG200,
    issueDES1,
    issueDES2,
    issueU1A,
    ...genericIssues.filter((_, i) => i % 5 === 1).slice(0, 2),
];
user4.assignedIssues = [
    issueENG512,
    issueINFRA1,
    ...genericIssues.filter((_, i) => i % 5 === 2).slice(0, 2),
];
user5.assignedIssues = [
    issueENG902,
    issueINFRA1,
    ...genericIssues.filter((_, i) => i % 6 === 3).slice(0, 2),
];

// issue-ENG-902: creator=user2, assignee=user5
issueENG902.creator = user2;

// Issue.documents connections (linked after issues created)
issueENG321.documents = [docMobileRoadmap];
issueENG7.documents = [docAuthSpec];

// ---------------------------------------------------------------------------
// IssueHistory for ENG-241
// ---------------------------------------------------------------------------
const hist1 = {
    __typename: 'IssueHistory',
    id: 'hist-eng241-1',
    _seed: h('IssueHistory#hist-eng241-1'),
    fromState: wsUnstarted1,
    toState: wsStarted1,
    createdAt: '2025-05-01T00:00:00.000Z',
    updatedAt: '2025-05-01T00:00:00.000Z',
    issue: issueENG241,
};
const hist2 = {
    __typename: 'IssueHistory',
    id: 'hist-eng241-2',
    _seed: h('IssueHistory#hist-eng241-2'),
    fromState: wsStarted1,
    toState: wsCompleted1,
    createdAt: '2025-05-15T00:00:00.000Z',
    updatedAt: '2025-05-15T00:00:00.000Z',
    issue: issueENG241,
};
issueENG241.history = [hist1, hist2];

// ---------------------------------------------------------------------------
// IssueRelations for ENG-200
// ---------------------------------------------------------------------------
const rel1 = {
    __typename: 'IssueRelation',
    id: 'rel-eng200-1',
    _seed: h('IssueRelation#rel-eng200-1'),
    type: 'blocks',
    relatedIssue: issueENG99,
    issue: issueENG200,
    createdAt: mkDate('rel1ca', 20),
    updatedAt: mkDate('rel1ua', 5),
};
const rel2 = {
    __typename: 'IssueRelation',
    id: 'rel-eng200-2',
    _seed: h('IssueRelation#rel-eng200-2'),
    type: 'related',
    relatedIssue: issueENG7,
    issue: issueENG200,
    createdAt: mkDate('rel2ca', 15),
    updatedAt: mkDate('rel2ua', 3),
};
issueENG200.relations = [rel1, rel2];

// ---------------------------------------------------------------------------
// Attachments for ENG-321, issue-eng-1023
// ---------------------------------------------------------------------------
const att321_1 = mkAttachment(
    'att-321-1',
    'Design mockup',
    'https://figma.com/file/abc',
    'figma',
    issueENG321,
);
const att321_2 = mkAttachment(
    'att-321-2',
    'Ticket #4521',
    'https://zendesk.com/ticket/4521',
    'zendesk',
    issueENG321,
);
issueENG321.attachments = [att321_1, att321_2];

const att1023_1 = mkAttachment(
    'att-1023-1',
    'GitHub PR #789',
    'https://github.com/pr/789',
    'github',
    issueEngAlt1023,
);
const att1023_2 = mkAttachment(
    'att-1023-2',
    'Slack thread',
    'https://slack.com/thread/xyz',
    'slack',
    issueEngAlt1023,
);
const att1023_3 = mkAttachment(
    'att-1023-3',
    'Notion doc',
    'https://notion.so/doc/xyz',
    'notion',
    issueEngAlt1023,
);
const att1023_4 = mkAttachment(
    'att-1023-4',
    'Customer email',
    'https://gmail.com/email/xyz',
    'gmail',
    issueEngAlt1023,
);
issueEngAlt1023.attachments = [att1023_1, att1023_2, att1023_3, att1023_4];

const attGeneral1 = mkAttachment(
    'att-gen-1',
    'Linear doc',
    'https://linear.app/doc/1',
    'linear',
    issueENG7,
);
const attGeneral2 = mkAttachment(
    'att-gen-2',
    'Support ticket',
    'https://intercom.com/t/2',
    'intercom',
    issueENG99,
);
allAttachments.push(
    att321_1,
    att321_2,
    att1023_1,
    att1023_2,
    att1023_3,
    att1023_4,
    attGeneral1,
    attGeneral2,
);

// ---------------------------------------------------------------------------
// Comments for ENG-7 (comment thread), plus general comments
// ---------------------------------------------------------------------------
const commentParentENG7: any = {
    __typename: 'Comment',
    id: 'comment-eng7-1',
    _seed: h('Comment#comment-eng7-1'),
    body: 'This needs to be fixed urgently, affecting production users.',
    url: `https://linear.app/issues/${issueENG7.id}#comment-eng7-1`,
    user: user2,
    issue: issueENG7,
    parent: null,
    createdAt: mkDate('ceg71ca', 5),
    updatedAt: mkDate('ceg71ua', 2),
    reactions: [
        {
            __typename: 'Reaction',
            id: 'react-1',
            _seed: h('Reaction#react-1'),
            emoji: '👍',
            user: user1,
            createdAt: mkDate('r1ca', 3),
        },
    ],
    children: [] as any[],
};
const commentReplyENG7: any = {
    __typename: 'Comment',
    id: 'comment-eng7-2',
    _seed: h('Comment#comment-eng7-2'),
    body: 'I can reproduce it locally. Working on a fix.',
    url: `https://linear.app/issues/${issueENG7.id}#comment-eng7-2`,
    user: user1,
    issue: issueENG7,
    parent: commentParentENG7,
    createdAt: mkDate('ceg72ca', 4),
    updatedAt: mkDate('ceg72ua', 1),
    reactions: [],
    children: [] as any[],
};
commentParentENG7.children = [commentReplyENG7];
issueENG7.comments = [commentParentENG7, commentReplyENG7];

const commentByViewer1: any = {
    __typename: 'Comment',
    id: 'comment-viewer-1',
    _seed: h('Comment#comment-viewer-1'),
    body: 'I will take a look at this issue.',
    url: `https://linear.app/issues/${issueENG99.id}#comment-viewer-1`,
    user: user1,
    issue: issueENG99,
    parent: null,
    createdAt: mkDate('cv1ca', 3),
    updatedAt: mkDate('cv1ua', 1),
    reactions: [],
    children: [] as any[],
};
const commentByViewer2: any = {
    __typename: 'Comment',
    id: 'comment-viewer-2',
    _seed: h('Comment#comment-viewer-2'),
    body: 'The fix looks good, approving.',
    url: `https://linear.app/issues/${issueENG200.id}#comment-viewer-2`,
    user: user1,
    issue: issueENG200,
    parent: null,
    createdAt: mkDate('cv2ca', 2),
    updatedAt: mkDate('cv2ua', 0.5),
    reactions: [
        {
            __typename: 'Reaction',
            id: 'react-2',
            _seed: h('Reaction#react-2'),
            emoji: '🎉',
            user: user3,
            createdAt: mkDate('r2ca2', 1),
        },
    ],
    children: [] as any[],
};
const commentByOther: any = {
    __typename: 'Comment',
    id: 'comment-other-1',
    _seed: h('Comment#comment-other-1'),
    body: 'This is a great implementation.',
    url: `https://linear.app/issues/${issueENG321.id}#comment-other-1`,
    user: user3,
    issue: issueENG321,
    parent: null,
    createdAt: mkDate('co1ca', 6),
    updatedAt: mkDate('co1ua', 2),
    reactions: [],
    children: [] as any[],
};

issueENG99.comments = [commentByViewer1];
issueENG200.comments = [commentByViewer2];
issueENG321.comments = [commentByOther];

const allComments = [
    commentParentENG7,
    commentReplyENG7,
    commentByViewer1,
    commentByViewer2,
    commentByOther,
];
// all reactions
issueENG7.reactions = [
    {
        __typename: 'Reaction',
        id: 'react-issue-1',
        _seed: h('Reaction#react-issue-1'),
        emoji: '🔥',
        user: user3,
        createdAt: mkDate('rir1ca', 2),
    },
];
issueENG99.reactions = [
    {
        __typename: 'Reaction',
        id: 'react-issue-2',
        _seed: h('Reaction#react-issue-2'),
        emoji: '👍',
        user: user4,
        createdAt: mkDate('rir2ca', 1),
    },
];
// Add reactions to a few generic issues
genericIssues.slice(0, 5).forEach((iss, i) => {
    iss.reactions = [
        {
            __typename: 'Reaction',
            id: `react-gen-${i}`,
            _seed: h(`Reaction#react-gen-${i}`),
            emoji: ['👍', '🎉', '🔥', '😮', '❤️'][i % 5]!,
            user: allUsers[i % 10]!,
            createdAt: mkDate(`rgi${i}ca`, 1),
        },
    ];
});

// Issue subscribers
issueENG99.subscribers = [user1, user2, user3, user4, user5];
issueENG902.subscribers = [user1, user2, user4, user5, user8, user9];

// ---------------------------------------------------------------------------
// CustomerNeeds
// ---------------------------------------------------------------------------
function mkCustomerNeed(
    id: string,
    customer: any,
    issue: any | null,
    body: string,
    priority: number,
) {
    return {
        __typename: 'CustomerNeed',
        id,
        _seed: h(`CustomerNeed#${id}`),
        customer,
        issue,
        project: issue?.project ?? null,
        body,
        priority,
        createdAt: mkDate(`${id}ca`, 15),
        updatedAt: mkDate(`${id}ua`, 2),
        creator: user1,
        comment: null,
        attachment: null,
        projectAttachment: null,
        originalIssue: null,
        url: null,
        content: body,
    };
}

const need1 = mkCustomerNeed(
    'need-globex-1',
    null,
    issueEngAlt441,
    'Need faster login on mobile devices',
    2,
);
const need2 = mkCustomerNeed(
    'need-globex-2',
    null,
    issueENG512,
    'Rate limiting blocks our API integration',
    1,
);
const need3 = mkCustomerNeed(
    'need-initech-1',
    null,
    issueENG99,
    'API rate limiting causes failures in our workflow',
    2,
);
const need4 = mkCustomerNeed(
    'need-initech-2',
    null,
    null,
    'Need better error messages for failed operations',
    3,
);
const need5 = mkCustomerNeed('need-5', null, issueENG200, 'Database migrations are too slow', 2);
const need6 = mkCustomerNeed('need-6', null, null, 'Need export to CSV functionality', 1);
const need7 = mkCustomerNeed(
    'need-7',
    null,
    issueENG321,
    'Payment module has occasional failures',
    1,
);
const need8 = mkCustomerNeed('need-8', null, null, 'Would like SSO support', 3);
const need9 = mkCustomerNeed(
    'need-9',
    null,
    issueEngAlt441,
    'Also affected by mobile login issue',
    2,
);
const need10 = mkCustomerNeed('need-10', null, null, 'Need better reporting capabilities', 4);

// Needs linked to issue-eng-441
issueEngAlt441.needs = [need1, need9];

// ---------------------------------------------------------------------------
// Customers
// ---------------------------------------------------------------------------
function mkCustomer(
    id: string,
    name: string,
    status: any,
    tier: any,
    owner: any,
    needs: any[],
    opts: Record<string, any> = {},
) {
    return {
        __typename: 'Customer',
        id,
        _seed: h(`Customer#${id}`),
        name,
        status,
        tier,
        owner,
        needs,
        domains: [`${id.replace(/[^a-z]/g, '')}.com`],
        externalIds: [],
        slackChannelId: opts.slackChannelId ?? `C${h(id) % 99999}`,
        revenue: opts.revenue ?? (100 + (h(`${id}rev`) % 900)) * 100,
        size: opts.size ?? 10 + (h(`${id}sz`) % 500),
        approximateNeedCount: needs.length,
        slugId: id,
        mainSourceId: null,
        integration: null,
        url: `https://linear.app/customers/${id}`,
        createdAt: mkDate(`${id}ca`, 180),
        updatedAt: mkDate(`${id}ua`, 5),
    };
}

const customerGlobex = mkCustomer(
    'customer-globex',
    'Globex Corporation',
    statusActive,
    tierEnterprise,
    user2,
    [need1, need2],
    { slackChannelId: 'C-GLOBEX-001', revenue: 120000, size: 5000 },
);
const customerInitech = mkCustomer(
    'customer-initech',
    'Initech',
    statusActive,
    tierPro,
    user3,
    [need3],
    { slackChannelId: 'C-INITECH-002', revenue: 45000, size: 250 },
);
const customerChurnRiskCo = mkCustomer(
    'customer-churn-risk',
    'Widgets Inc',
    statusChurnRisk,
    tierPro,
    user4,
    [need5],
    { slackChannelId: 'C-WIDGETS-003', revenue: 15000, size: 75 },
);
const customerAcmeCo = mkCustomer(
    'customer-acme-co',
    'Acme Solutions',
    statusActive,
    tierEnterprise,
    user1,
    [need7],
    { revenue: 80000, size: 1200 },
);
const customerStartupXYZ = mkCustomer(
    'customer-startup-xyz',
    'Startup XYZ',
    statusTrial,
    tierFree,
    null,
    [],
    { revenue: 0, size: 15 },
);
const customerMegaCorp = mkCustomer(
    'customer-mega-corp',
    'MegaCorp Industries',
    statusActive,
    tierEnterprise,
    user5,
    [need9],
    { revenue: 250000, size: 10000 },
);
const customerTechPlus = mkCustomer(
    'customer-tech-plus',
    'TechPlus',
    statusActive,
    tierPro,
    user2,
    [],
    { revenue: 30000, size: 120 },
);
const customerSmallBiz = mkCustomer(
    'customer-small-biz',
    'SmallBiz LLC',
    statusActive,
    tierFree,
    null,
    [],
    { revenue: 5000, size: 8 },
);
const customerEnterpriseOne = mkCustomer(
    'customer-enterprise-one',
    'EnterpriseOne',
    statusActive,
    tierEnterprise,
    user3,
    [],
    { revenue: 180000, size: 8000 },
);
const customerGrowthCo = mkCustomer(
    'customer-growth-co',
    'GrowthCo',
    statusTrial,
    tierPro,
    user1,
    [],
    { revenue: 0, size: 45 },
);

// Update needs with customer references
need1.customer = customerGlobex;
need2.customer = customerGlobex;
need3.customer = customerInitech;
need4.customer = customerInitech;
need5.customer = customerChurnRiskCo;
need6.customer = customerAcmeCo;
need7.customer = customerAcmeCo;
need8.customer = customerStartupXYZ;
need9.customer = customerMegaCorp;
need10.customer = customerMegaCorp;

const allCustomers = [
    customerGlobex,
    customerInitech,
    customerChurnRiskCo,
    customerAcmeCo,
    customerStartupXYZ,
    customerMegaCorp,
    customerTechPlus,
    customerSmallBiz,
    customerEnterpriseOne,
    customerGrowthCo,
];
const customerById = new Map(allCustomers.map((c) => [c.id, c]));

const allCustomerNeeds = [need1, need2, need3, need4, need5, need6, need7, need8, need9, need10];

// ---------------------------------------------------------------------------
// Team members / memberships
// ---------------------------------------------------------------------------
function mkTeamMembership(id: string, user: any, team: any, owner: boolean) {
    return {
        __typename: 'TeamMembership',
        id,
        _seed: h(`TeamMembership#${id}`),
        user,
        team,
        owner,
        createdAt: mkDate(`${id}ca`, 200),
        updatedAt: mkDate(`${id}ua`, 10),
    };
}

const eng_members = [user1, user2, user3, user4, user5, user6, user8, user9, user10];
const design_members = [user3, user11, user12];
const team1_members = [user8, user9, user13, user14];
const teamT1_members = [user5, user15, user16];
const teamRoot0_members = [user1, user17, user18, user19];
const teamFrontend_members = [user20, user21, user22];
const teamSecurity_members = [user4, user23, user24];

teamEngineering.members = eng_members;
teamDesign.members = design_members;
team1.members = team1_members;
teamT1.members = teamT1_members;
teamRoot0.members = teamRoot0_members;
teamFrontend.members = teamFrontend_members;
teamSecurity.members = teamSecurity_members;

const tm1 = mkTeamMembership('tm-user1-eng', user1, teamEngineering, true);
const tm2 = mkTeamMembership('tm-user1-root0', user1, teamRoot0, false);
const tm3 = mkTeamMembership('tm-user2-eng', user2, teamEngineering, false);
const tm4 = mkTeamMembership('tm-user3-design', user3, teamDesign, true);
const tm5 = mkTeamMembership('tm-user3-eng', user3, teamEngineering, false);
const tm6 = mkTeamMembership('tm-user4-sec', user4, teamSecurity, true);
const tm7 = mkTeamMembership('tm-user5-t1', user5, teamT1, true);

user1.teamMemberships = [tm1, tm2];
user1.teams = [teamEngineering, teamRoot0];
user2.teamMemberships = [tm3];
user2.teams = [teamEngineering];
user3.teamMemberships = [tm4, tm5];
user3.teams = [teamDesign, teamEngineering];
user4.teamMemberships = [tm6];
user4.teams = [teamSecurity];
user5.teamMemberships = [tm7];
user5.teams = [teamT1];

// ---------------------------------------------------------------------------
// Team WorkflowStates
// ---------------------------------------------------------------------------
teamEngineering.states = [wsUnstarted1, wsStarted1, wsCompleted1, wsCanceled1, wsTriage1];
teamDesign.states = [wsDesignTodo, wsDesignDone];
team1.states = [wsUnstarted1, wsStarted1, wsCompleted1, wsCanceled1];
teamT1.states = [wsUnstarted1, wsStarted1, wsCompleted1];
teamRoot0.states = [wsTeam0State1, wsTeam0State2];
teamFrontend.states = [wsUnstarted1, wsStarted1, wsCompleted1];
teamSecurity.states = [wsUnstarted1, wsStarted1, wsCompleted1, wsCanceled1];

// ---------------------------------------------------------------------------
// GitAutomationStates
// ---------------------------------------------------------------------------
const gas1 = {
    __typename: 'GitAutomationState',
    id: 'gas-1',
    _seed: h('GitAutomationState#gas-1'),
    state: wsStarted1,
    event: 'start',
    team: teamEngineering,
    branchPattern: 'eng-*',
    createdAt: mkDate('gas1ca', 90),
    updatedAt: mkDate('gas1ua', 10),
};
const gas2 = {
    __typename: 'GitAutomationState',
    id: 'gas-2',
    _seed: h('GitAutomationState#gas-2'),
    state: wsCompleted1,
    event: 'merge',
    team: teamEngineering,
    branchPattern: 'eng-*',
    createdAt: mkDate('gas2ca', 90),
    updatedAt: mkDate('gas2ua', 10),
};
const gas3 = {
    __typename: 'GitAutomationState',
    id: 'gas-3',
    _seed: h('GitAutomationState#gas-3'),
    state: wsCanceled1,
    event: 'review',
    team: teamEngineering,
    branchPattern: 'eng-*',
    createdAt: mkDate('gas3ca', 90),
    updatedAt: mkDate('gas3ua', 10),
};
teamEngineering.gitAutomationStates = [gas1, gas2, gas3];

// ---------------------------------------------------------------------------
// TriageResponsibility for team-engineering
// ---------------------------------------------------------------------------
const triageManualSelection = {
    __typename: 'TriageResponsibilityManualSelection',
    userIds: [user1.id, user2.id, user3.id],
    assignmentIndex: 0,
};
const triageResp = {
    __typename: 'TriageResponsibility',
    id: 'tr-eng-1',
    _seed: h('TriageResponsibility#tr-eng-1'),
    action: 'assign',
    manualSelection: triageManualSelection,
    team: teamEngineering,
    currentUser: user1,
    timeSchedule: null,
    createdAt: mkDate('trca', 60),
    updatedAt: mkDate('trua', 5),
};
teamEngineering.triageResponsibility = triageResp;

// ---------------------------------------------------------------------------
// Templates for teams
// ---------------------------------------------------------------------------
function mkTemplate(id: string, name: string, type: string, team: any) {
    return {
        __typename: 'Template',
        id,
        _seed: h(`Template#${id}`),
        name,
        type,
        team,
        description: `Template for ${name}`,
        createdAt: mkDate(`${id}ca`, 90),
        updatedAt: mkDate(`${id}ua`, 10),
    };
}
const tmpl1 = mkTemplate('tmpl-bug', 'Bug Report', 'issue', teamEngineering);
const tmpl2 = mkTemplate('tmpl-feature', 'Feature Request', 'issue', teamEngineering);
const tmpl3 = mkTemplate('tmpl-design', 'Design Task', 'issue', teamDesign);
teamEngineering.templates = [tmpl1, tmpl2];
teamDesign.templates = [tmpl3];

// ---------------------------------------------------------------------------
// Integrations
// ---------------------------------------------------------------------------
function mkIntegration(id: string, service: string, creator: any) {
    return {
        __typename: 'Integration',
        id,
        _seed: h(`Integration#${id}`),
        service,
        creator,
        organization: org1,
        createdAt: mkDate(`${id}ca`, 200),
        updatedAt: mkDate(`${id}ua`, 30),
    };
}
const intGitHub = mkIntegration('int-github', 'github', user1);
const intSlack = mkIntegration('int-slack', 'slack', user2);
const intZendesk = mkIntegration('int-zendesk', 'zendesk', user3);
const intFigma = mkIntegration('int-figma', 'figma', user3);
const intJira = mkIntegration('int-jira', 'jira', user4);
const allIntegrations = [intGitHub, intSlack, intZendesk, intFigma, intJira];

// ---------------------------------------------------------------------------
// Webhooks
// ---------------------------------------------------------------------------
function mkWebhook(id: string, url: string, team: any, allPublicTeams: boolean) {
    return {
        __typename: 'Webhook',
        id,
        _seed: h(`Webhook#${id}`),
        url,
        team,
        allPublicTeams,
        enabled: true,
        secret: null,
        label: `Webhook ${id}`,
        resourceTypes: ['Issue', 'Comment'],
        createdAt: mkDate(`${id}ca`, 60),
        updatedAt: mkDate(`${id}ua`, 10),
    };
}
const webhook1 = mkWebhook(
    'webhook-1',
    'https://hooks.example.com/linear/1',
    teamEngineering,
    false,
);
const webhook2 = mkWebhook('webhook-2', 'https://hooks.example.com/linear/2', team1, true);
const webhook3 = mkWebhook(
    'webhook-3',
    'https://ci.example.com/linear/events',
    teamEngineering,
    false,
);
const allWebhooks = [webhook1, webhook2, webhook3];

// ---------------------------------------------------------------------------
// OAuthApplications
// ---------------------------------------------------------------------------
const oauth1 = {
    __typename: 'OAuthApplication',
    id: 'oauth-1',
    _seed: h('OAuthApplication#oauth-1'),
    name: 'CI Integration Bot',
    developer: 'Acme Corp Engineering',
    description: 'CI/CD automation',
    redirectUris: ['https://ci.example.com/callback', 'https://ci.example.com/auth'],
    createdAt: mkDate('oa1ca', 150),
    updatedAt: mkDate('oa1ua', 20),
};
const oauth2 = {
    __typename: 'OAuthApplication',
    id: 'oauth-2',
    _seed: h('OAuthApplication#oauth-2'),
    name: 'Analytics Dashboard',
    developer: 'Acme Corp Analytics',
    description: 'Analytics integration',
    redirectUris: ['https://analytics.example.com/oauth/callback'],
    createdAt: mkDate('oa2ca', 120),
    updatedAt: mkDate('oa2ua', 15),
};
const allOAuthApplications = [oauth1, oauth2];

// ---------------------------------------------------------------------------
// AuditEntries
// ---------------------------------------------------------------------------
function mkAuditEntry(id: string, type: string, actor: any) {
    return {
        __typename: 'AuditEntry',
        id,
        _seed: h(`AuditEntry#${id}`),
        type,
        actor,
        countryCode: 'US',
        ip: '192.168.1.1',
        metadata: {},
        organization: org1,
        createdAt: mkDate(`${id}ca`, 2),
        updatedAt: mkDate(`${id}ua`, 1),
    };
}
const ae1 = mkAuditEntry('ae-1', 'userLogin', user1);
const ae2 = mkAuditEntry('ae-2', 'issueCreate', user2);
const ae3 = mkAuditEntry('ae-3', 'projectUpdate', user3);
const ae4 = mkAuditEntry('ae-4', 'teamMembershipCreate', user4);
const ae5 = mkAuditEntry('ae-5', 'webhookCreate', user1);
const allAuditEntries = [ae1, ae2, ae3, ae4, ae5];

// ---------------------------------------------------------------------------
// OrganizationInvites
// ---------------------------------------------------------------------------
function mkOrgInvite(id: string, email: string, invitee: any | null, accepted: boolean) {
    return {
        __typename: 'OrganizationInvite',
        id,
        _seed: h(`OrganizationInvite#${id}`),
        email,
        invitee,
        inviter: user1,
        acceptedAt: accepted ? mkDate(`${id}acc`, 30) : null,
        expiresAt: mkDate(`${id}exp`, -10), // future
        role: 'user',
        external: false,
        organization: org1,
        createdAt: mkDate(`${id}ca`, 40),
        updatedAt: mkDate(`${id}ua`, 5),
    };
}
const invite1 = mkOrgInvite('invite-1', 'newmember1@example.com', null, false);
const invite2 = mkOrgInvite('invite-2', 'newmember2@example.com', user25, true);
const invite3 = mkOrgInvite('invite-3', 'newmember3@example.com', null, false);
const invite4 = mkOrgInvite('invite-4', 'newmember4@example.com', user26, true);
const invite5 = mkOrgInvite('invite-5', 'contractor@partner.com', null, false);
const allOrgInvites = [invite1, invite2, invite3, invite4, invite5];

// ---------------------------------------------------------------------------
// Notifications (some unread; some IssueNotification)
// ---------------------------------------------------------------------------
function mkNotification(
    id: string,
    type: string,
    actor: any,
    readAt: string | null,
    issue: any | null = null,
) {
    const base: any = {
        __typename: issue ? 'IssueNotification' : 'Notification',
        id,
        _seed: h(`Notification#${id}`),
        type,
        actor,
        readAt,
        user: user1,
        category: 'issue',
        url: `https://linear.app/notifications/${id}`,
        inboxUrl: `https://linear.app/inbox/${id}`,
        title: `Notification ${type}`,
        subtitle: `from ${actor.name}`,
        isLinearActor: false,
        groupingKey: id,
        groupingPriority: 1,
        actorAvatarUrl: null,
        actorInitials: actor.name[0]!,
        actorAvatarColor: '#5e6ad2',
        emailedAt: null,
        snoozedUntilAt: null,
        unsnoozedAt: null,
        createdAt: mkDate(`${id}ca`, 1),
        updatedAt: mkDate(`${id}ua`, 0.5),
        subscriptions: [],
    };
    if (issue) {
        base.__typename = 'IssueNotification';
        base.issue = issue;
        base.issueId = issue.id;
        base.team = issue.team;
        base.comment = null;
        base.parentComment = null;
        base.issueStatusType = null;
        base.reactionEmoji = null;
        base.commentId = null;
        base.parentCommentId = null;
        base.projectUpdateHealth = null;
        base.initiativeUpdateHealth = null;
    }
    return base;
}
const notif1 = mkNotification('notif-1', 'issueAssigned', user2, null, issueENG7); // unread
const notif2 = mkNotification(
    'notif-2',
    'issueComment',
    user3,
    '2025-05-28T08:00:00.000Z',
    issueENG99,
);
const notif3 = mkNotification('notif-3', 'issueMention', user4, null, issueENG200); // unread
const notif4 = mkNotification(
    'notif-4',
    'issueStatusChanged',
    user2,
    '2025-05-29T10:00:00.000Z',
    issueENG241,
);
const notif5 = mkNotification('notif-5', 'issueComment', user5, null, issueENG512); // unread
const notif6 = mkNotification(
    'notif-6',
    'issueAssigned',
    user1,
    '2025-05-27T14:00:00.000Z',
    issueENG902,
);
const allNotifications = [notif1, notif2, notif3, notif4, notif5, notif6];
user1.notifications = allNotifications;

// ---------------------------------------------------------------------------
// NotificationSubscriptions
// ---------------------------------------------------------------------------
function mkProjectNotifSub(id: string, project: any) {
    return {
        __typename: 'ProjectNotificationSubscription',
        id,
        _seed: h(`NotificationSubscription#${id}`),
        project,
        team: null,
        subscriber: user1,
        active: true,
        customer: null,
        customView: null,
        cycle: null,
        label: null,
        initiative: null,
        user: null,
        contextViewType: null,
        userContextViewType: null,
        notificationSubscriptionTypes: [],
        createdAt: mkDate(`${id}ca`, 30),
        updatedAt: mkDate(`${id}ua`, 5),
    };
}
function mkTeamNotifSub(id: string, team: any) {
    return {
        __typename: 'TeamNotificationSubscription',
        id,
        _seed: h(`NotificationSubscription#${id}`),
        project: null,
        team,
        subscriber: user1,
        active: true,
        customer: null,
        customView: null,
        cycle: null,
        label: null,
        initiative: null,
        user: null,
        contextViewType: null,
        userContextViewType: null,
        notificationSubscriptionTypes: [],
        createdAt: mkDate(`${id}ca`, 30),
        updatedAt: mkDate(`${id}ua`, 5),
    };
}
const ns1 = mkProjectNotifSub('ns-1', projectMobileApp);
const ns2 = mkTeamNotifSub('ns-2', teamEngineering);
const ns3 = mkProjectNotifSub('ns-3', projectAuthRedesign);
const ns4 = mkTeamNotifSub('ns-4', teamDesign);
const allNotifSubs = [ns1, ns2, ns3, ns4];
user1.notificationSubscriptions = allNotifSubs;

// ---------------------------------------------------------------------------
// IssueDrafts for viewer
// ---------------------------------------------------------------------------
function mkIssueDraft(id: string, title: string, stateRef: any = wsUnstarted1) {
    return {
        __typename: 'IssueDraft',
        id,
        _seed: h(`IssueDraft#${id}`),
        title,
        description: `Draft: ${title}`,
        team: teamEngineering,
        teamId: teamEngineering.id,
        stateId: stateRef.id,
        state: stateRef,
        priority: 3,
        estimate: null,
        dueDate: null,
        labelIds: [],
        cycleId: null,
        projectId: null,
        projectMilestoneId: null,
        creator: user1,
        assigneeId: null,
        delegateId: null,
        parent: null,
        parentId: null,
        parentIssue: null,
        parentIssueId: null,
        sourceCommentId: null,
        subIssueSortOrder: null,
        priorityLabel: 'Normal',
        descriptionData: null,
        attachments: null,
        needs: null,
        archivedAt: null,
        createdAt: mkDate(`${id}ca`, 2),
        updatedAt: mkDate(`${id}ua`, 0.5),
    };
}
const draft1 = mkIssueDraft('draft-1', 'Investigate memory leak in API service', wsUnstarted1);
const draft2 = mkIssueDraft('draft-2', 'Add two-factor authentication support', wsUnstarted1);
const draft3 = mkIssueDraft('draft-3', 'Refactor session management', wsStarted1);
const allDrafts = [draft1, draft2, draft3];
user1.issueDrafts = allDrafts;

// ---------------------------------------------------------------------------
// Favorites for viewer
// ---------------------------------------------------------------------------
function mkFavorite(id: string, issue: any | null, project: any | null) {
    const type = issue ? 'issue' : 'project';
    const title = issue ? issue.title : (project?.name ?? 'Favorite');
    const detail = issue ? (issue.team?.name ?? null) : null;
    const url = issue ? issue.url : (project?.url ?? null);
    return {
        __typename: 'Favorite',
        id,
        _seed: h(`Favorite#${id}`),
        issue,
        project,
        type,
        title,
        detail,
        url,
        color: null,
        icon: null,
        parent: null,
        folderName: null,
        predefinedViewType: null,
        projectTab: null,
        initiativeTab: null,
        pipelineTab: null,
        owner: user1,
        sortOrder: h(`${id}so`) % 100,
        createdAt: mkDate(`${id}ca`, 10),
        updatedAt: mkDate(`${id}ua`, 3),
    };
}
const fav1 = mkFavorite('fav-1', issueENG7, null);
const fav2 = mkFavorite('fav-2', null, projectMobileApp);
const fav3 = mkFavorite('fav-3', issueENG512, null);
const fav4 = mkFavorite('fav-4', null, projectAuthRedesign);
const allFavorites = [fav1, fav2, fav3, fav4];
user1.favorites = allFavorites;

// ---------------------------------------------------------------------------
// Releases, ReleaseStages, ReleasePipelines, ReleaseNotes
// ---------------------------------------------------------------------------
const stageStaging = {
    __typename: 'ReleaseStage',
    id: 'stage-staging',
    _seed: h('ReleaseStage#stage-staging'),
    name: 'Staging',
    description: 'Staging environment',
    position: 0,
    type: 'started',
    color: '#f2c94c',
    frozen: false,
    archivedAt: null,
    pipeline: null as any,
    createdAt: mkDate('ssca', 180),
    updatedAt: mkDate('ssua', 10),
};
const stageProduction = {
    __typename: 'ReleaseStage',
    id: 'stage-production',
    _seed: h('ReleaseStage#stage-production'),
    name: 'Production',
    description: 'Production environment',
    position: 1,
    type: 'completed',
    color: '#27ae60',
    frozen: false,
    archivedAt: null,
    pipeline: null as any,
    createdAt: mkDate('spca', 180),
    updatedAt: mkDate('spua', 10),
};
const stageQA = {
    __typename: 'ReleaseStage',
    id: 'stage-qa',
    _seed: h('ReleaseStage#stage-qa'),
    name: 'QA',
    description: 'QA environment',
    position: 0,
    type: 'started',
    color: '#f39c12',
    frozen: false,
    archivedAt: null,
    pipeline: null as any,
    createdAt: mkDate('sqca', 180),
    updatedAt: mkDate('squa', 10),
};

const pipeline1: any = {
    __typename: 'ReleasePipeline',
    id: 'pipeline-main',
    _seed: h('ReleasePipeline#pipeline-main'),
    name: 'Main Release Pipeline',
    description: 'Primary deployment pipeline',
    slugId: 'main-release',
    type: 'scheduled',
    isProduction: true,
    autoGenerateReleaseNotesOnCompletion: false,
    includePathPatterns: [],
    approximateReleaseCount: 2,
    trashed: false,
    releaseNoteTemplate: null,
    latestReleaseNote: null,
    url: 'https://linear.app/pipelines/pipeline-main',
    archivedAt: null,
    team: teamEngineering,
    stages: [stageStaging, stageProduction],
    // projects associated via issues — populated later
    projects: [] as any[],
    createdAt: mkDate('p1ca', 180),
    updatedAt: mkDate('p1ua', 10),
};
const pipeline2: any = {
    __typename: 'ReleasePipeline',
    id: 'pipeline-hotfix',
    _seed: h('ReleasePipeline#pipeline-hotfix'),
    name: 'Hotfix Pipeline',
    description: 'For urgent patches',
    slugId: 'hotfix',
    type: 'continuous',
    isProduction: true,
    autoGenerateReleaseNotesOnCompletion: false,
    includePathPatterns: [],
    approximateReleaseCount: 0,
    trashed: false,
    releaseNoteTemplate: null,
    latestReleaseNote: null,
    url: 'https://linear.app/pipelines/pipeline-hotfix',
    archivedAt: null,
    team: teamEngineering,
    stages: [stageQA, stageProduction],
    projects: [] as any[],
    createdAt: mkDate('p2ca', 90),
    updatedAt: mkDate('p2ua', 5),
};

stageStaging.pipeline = pipeline1;
stageProduction.pipeline = pipeline1;
stageQA.pipeline = pipeline2;

const releaseV30: any = {
    __typename: 'Release',
    id: 'release-v3.0',
    _seed: h('Release#release-v3.0'),
    name: 'v3.0',
    description: 'Major version release',
    stage: stageProduction,
    version: '3.0.0',
    targetDate: '2025-06-01',
    startDate: '2025-05-01',
    pipeline: pipeline1,
    team: teamEngineering,
    creator: user1,
    slugId: 'v3-0',
    commitSha: null,
    archivedAt: null,
    canceledAt: null,
    trashed: false,
    startedAt: '2025-05-01T00:00:00.000Z',
    completedAt: '2025-06-01T00:00:00.000Z',
    createdAt: mkDate('rv30ca', 40),
    updatedAt: mkDate('rv30ua', 5),
    issues: [issueENG241, issueENG321, issueENG7Sub1],
};
const releaseV31: any = {
    __typename: 'Release',
    id: 'release-v3.1',
    _seed: h('Release#release-v3.1'),
    name: 'v3.1',
    description: 'Patch release',
    stage: stageStaging,
    version: '3.1.0',
    targetDate: '2025-07-01',
    startDate: '2025-06-01',
    pipeline: pipeline1,
    team: teamEngineering,
    creator: user1,
    slugId: 'v3-1',
    commitSha: null,
    archivedAt: null,
    canceledAt: null,
    trashed: false,
    startedAt: '2025-06-01T00:00:00.000Z',
    completedAt: null,
    createdAt: mkDate('rv31ca', 10),
    updatedAt: mkDate('rv31ua', 2),
    issues: [issueENG7, issueENG99, issueENG512],
};
const allReleases = [releaseV30, releaseV31];
const allReleasePipelines = [pipeline1, pipeline2];
const releaseById = new Map(allReleases.map((r) => [r.id, r]));

// Populate pipeline projects from the issues in its releases
pipeline1.projects = [projectAuthRedesign, projectBillingPortal, projectMobileApp];

const rn1 = {
    __typename: 'ReleaseNote',
    id: 'rn-1',
    _seed: h('ReleaseNote#rn-1'),
    title: 'Improved authentication performance',
    content: 'Authentication is now 40% faster.',
    createdAt: mkDate('rn1ca', 15),
    updatedAt: mkDate('rn1ua', 5),
    release: releaseV30,
};
const rn2 = {
    __typename: 'ReleaseNote',
    id: 'rn-2',
    _seed: h('ReleaseNote#rn-2'),
    title: 'Fixed payment module edge cases',
    content: 'Several edge cases in payment processing resolved.',
    createdAt: mkDate('rn2ca', 10),
    updatedAt: mkDate('rn2ua', 3),
    release: releaseV30,
};
const rn3 = {
    __typename: 'ReleaseNote',
    id: 'rn-3',
    _seed: h('ReleaseNote#rn-3'),
    title: 'New mobile app features',
    content: 'Several new mobile app enhancements.',
    createdAt: mkDate('rn3ca', 5),
    updatedAt: mkDate('rn3ua', 1),
    release: releaseV31,
};
const allReleaseNotes = [rn1, rn2, rn3];

// ---------------------------------------------------------------------------
// ProjectRelations
// ---------------------------------------------------------------------------
const pr1 = {
    __typename: 'ProjectRelation',
    id: 'prel-1',
    _seed: h('ProjectRelation#prel-1'),
    type: 'blocks',
    project: projectMobileApp,
    relatedProject: projectAuthRedesign,
    createdAt: mkDate('pr1ca', 30),
    updatedAt: mkDate('pr1ua', 5),
};
const pr2 = {
    __typename: 'ProjectRelation',
    id: 'prel-2',
    _seed: h('ProjectRelation#prel-2'),
    type: 'related',
    project: projectDataPipeline,
    relatedProject: projectInfraUpgrade,
    createdAt: mkDate('pr2ca', 20),
    updatedAt: mkDate('pr2ua', 3),
};
const allProjectRelations = [pr1, pr2];

// Link project relations to project entities
projectMobileApp.relations = [pr1];
projectAuthRedesign.inverseRelations = [pr1];
projectDataPipeline.relations = [pr2];
projectInfraUpgrade.inverseRelations = [pr2];

// ---------------------------------------------------------------------------
// Search result wrappers
// ---------------------------------------------------------------------------
// IssueSearchResult — issues with "rate limit" in title
const issueSearchRateLimit1 = { ...issueENG99, __typename: 'IssueSearchResult' };
const issueSearchRateLimit2 = { ...issueENG512, __typename: 'IssueSearchResult' };
// ProjectSearchResult — projects with "billing" in name
const projectSearchBilling = { ...projectBillingPortal, __typename: 'ProjectSearchResult' };
// DocumentSearchResult — document about "incident response"
const docSearchIncident = {
    ...docIncidentResponse,
    __typename: 'DocumentSearchResult',
    url: 'https://linear.app/docs/doc-incident-response',
    summary: 'Incident response plan outlining steps for handling production incidents.',
    slugId: 'doc-incident-response',
    sortOrder: 0,
    icon: null,
    color: null,
    creator: user1,
    updatedBy: user1,
    initiative: null,
    team: null,
    issue: null,
    release: null,
    cycle: null,
    lastAppliedTemplate: null,
    hiddenAt: null,
    trashed: false,
};

// ---------------------------------------------------------------------------
// Set up org connections (arrays)
// ---------------------------------------------------------------------------
// org1 connection arrays — managed by the conn() helper in resolvers
// (not stored as arrays; resolved dynamically from allUsers/allTeams/allIntegrations)

// ---------------------------------------------------------------------------
// Project teams connections
// ---------------------------------------------------------------------------
projectMobileApp.teams = [teamEngineering, teamFrontend];
projectAuthRedesign.teams = [teamEngineering, teamSecurity];
projectBillingPortal.teams = [teamEngineering, teamFrontend];
projectDataPipeline.teams = [teamEngineering, teamT1];
projectAPIGateway.teams = [teamEngineering];
projectDesignSystem.teams = [teamDesign];
projectInfraUpgrade.teams = [teamT1, teamEngineering];
projectSecurityAudit.teams = [teamSecurity, teamEngineering];
projectOnboarding.teams = [teamFrontend, teamDesign];
projectReporting.teams = [teamEngineering, teamFrontend];

// ---------------------------------------------------------------------------
// THE RESOLVER MAP
// ---------------------------------------------------------------------------
export const linear: ResolverMap = {
    Query: {
        viewer: () => user1,
        organization: () => org1,
        userSettings: () => usettings1,

        // Single lookups
        user: (_src, args) => userById.get(String(args.id)) ?? null,
        team: (_src, args) => teamById.get(String(args.id)) ?? null,
        issue: (_src, args) => issueById.get(String(args.id)) ?? null,
        cycle: (_src, args) => cycleById.get(String(args.id)) ?? null,
        customer: (_src, args) => {
            const id = String(args.id);
            if (customerById.has(id)) {
                return customerById.get(id);
            }
            // Seed a minimal customer for unknown ids (lookup seeding pattern)
            return mkCustomer(id, `Customer ${id}`, statusActive, tierPro, null, []);
        },
        initiative: (_src, args) => initiativeById.get(String(args.id)) ?? null,
        project: (_src, args) => projectById.get(String(args.id)) ?? null,
        projectMilestone: (_src, args) => projectMilestoneById.get(String(args.id)) ?? null,
        release: (_src, args) => releaseById.get(String(args.id)) ?? null,

        // issueVcsBranchSearch
        issueVcsBranchSearch: (_src, args) => {
            const branch = String(args.branchName);
            return allIssues.find((i: any) => i.branchName === branch) ?? null;
        },

        // Collections
        users: (_src, args) => {
            let list = allUsers;
            const f = args.filter as any;
            if (f?.admin?.eq === true) list = list.filter((u) => u.admin === true);
            else if (f?.admin?.eq === false) list = list.filter((u) => u.admin === false);
            return conn(list, args);
        },
        teams: (_src, args) => conn(allTeams, args),
        issues: (_src, args) => {
            let list = allIssues;
            const f = args.filter as any;
            if (f) {
                if (f.priority?.in) {
                    const ps = f.priority.in as number[];
                    list = list.filter((i) => ps.includes(i.priority));
                }
                if (f.state?.type?.in) {
                    const types = f.state.type.in as string[];
                    list = list.filter((i) => types.includes(i.state.type));
                }
                if (f.dueDate?.null === false) list = list.filter((i) => i.dueDate != null);
                if (f.dueDate?.lt) {
                    const lt = f.dueDate.lt as string;
                    list = list.filter((i) => i.dueDate != null && i.dueDate < lt);
                }
                if (f.snoozedUntilAt?.null === false)
                    list = list.filter((i) => i.snoozedUntilAt != null);
                if (f.number?.eq !== undefined) {
                    const num = Number(f.number.eq);
                    list = list.filter((i) => i.number === num);
                }
                if (f.identifier?.eq !== undefined) {
                    const id = String(f.identifier.eq);
                    list = list.filter((i) => i.identifier === id);
                }
                if (f.assignee?.null === true) list = list.filter((i) => i.assignee == null);
            }
            // Apply nullableSubset pattern: blank assignee at i%3===0 (matches original mock behavior)
            const result = conn(list, args);
            result.nodes = result.nodes.map((node: any, i: number) =>
                i % 3 === 0 ? { ...node, assignee: null } : node,
            );
            result.edges = result.edges.map((edge: any, i: number) =>
                i % 3 === 0 ? { ...edge, node: { ...edge.node, assignee: null } } : edge,
            );
            return result;
        },
        customers: (_src, args) => {
            let list = allCustomers;
            const f = args.filter as any;
            if (f?.status?.name?.eqIgnoreCase) {
                const target = (f.status.name.eqIgnoreCase as string).toLowerCase();
                list = list.filter((c) => c.status.name.toLowerCase() === target);
            }
            return conn(list, args);
        },
        customerNeeds: (_src, args) => {
            let list = allCustomerNeeds;
            const f = args.filter as any;
            if (f) {
                if (f.priority?.gte !== undefined)
                    list = list.filter((n) => n.priority >= f.priority.gte);
                if (f.issue?.null === false) list = list.filter((n) => n.issue != null);
                if (f.issue?.null === true) list = list.filter((n) => n.issue == null);
            }
            return conn(list, args);
        },
        projects: (_src, args) => {
            let list = allProjects;
            const f = args.filter as any;
            if (f?.status?.type?.eq) {
                const type = f.status.type.eq as string;
                list = list.filter((p) => p.status.type === type);
            }
            return conn(list, args);
        },
        projectRelations: (_src, args) => conn(allProjectRelations, args),
        projectMilestones: (_src, args) => conn(allProjectMilestones, args),
        roadmaps: (_src, args) => conn(allRoadmaps, args),
        initiatives: (_src, args) => {
            let list = allInitiatives;
            const f = args.filter as any;
            if (f?.status?.eq) {
                const s = f.status.eq as string;
                list = list.filter((i) => i.status === s);
            }
            return conn(list, args);
        },
        cycles: (_src, args) => {
            let list = allCycles;
            const f = args.filter as any;
            if (f?.isPast?.eq === true) list = list.filter((c) => c.isPast === true);
            else if (f?.isPast?.eq === false) list = list.filter((c) => c.isPast === false);
            if (f?.isActive?.eq === true) list = list.filter((c) => c.isActive === true);
            else if (f?.isActive?.eq === false) list = list.filter((c) => c.isActive === false);
            return conn(list, args);
        },
        issueLabels: (_src, args) => conn(allIssueLabels, args),
        releases: (_src, args) => conn(allReleases, args),
        releaseNotes: (_src, args) => conn(allReleaseNotes, args),
        releasePipelines: (_src, args) => conn(allReleasePipelines, args),
        webhooks: (_src, args) => conn(allWebhooks, args),
        oauthApplications: (_src) => allOAuthApplications,
        auditEntries: (_src, args) => conn(allAuditEntries, args),
        organizationInvites: (_src, args) => conn(allOrgInvites, args),
        notifications: (_src, args) => {
            // Return from viewer's notifications
            return conn(allNotifications, args);
        },
        notificationSubscriptions: (_src, args) => conn(allNotifSubs, args),
        attachments: (_src, args) => conn(allAttachments, args),
        favorites: (_src, args) => conn(user1.favorites, args),
        comments: (_src, args) => {
            let list = allComments;
            const f = args.filter as any;
            if (f) {
                if (f.user?.isMe?.eq === true) list = list.filter((c: any) => c.user === user1);
                if (f.issue?.null === false) list = list.filter((c: any) => c.issue != null);
                if (f.issue?.null === true) list = list.filter((c: any) => c.issue == null);
            }
            return conn(list, args);
        },

        // issueSearch — same as searchIssues but uses `term` arg directly
        issueSearch: (_src, args) => {
            const term = ((args.term as string) ?? '').toLowerCase();
            const results = allIssues
                .filter(
                    (i: any) =>
                        i.title.toLowerCase().includes(term) ||
                        i.identifier.toLowerCase().includes(term),
                )
                .map((i: any) => ({ ...i, __typename: 'IssueSearchResult' }));
            return conn(results, args);
        },

        // customerStatuses — all customer statuses in workspace
        customerStatuses: (_src, args) => conn([statusActive, statusChurnRisk, statusTrial], args),

        // customerTiers — all customer tiers in workspace
        customerTiers: (_src, args) => conn([tierEnterprise, tierPro, tierFree], args),

        // documents — all documents in workspace
        documents: (_src, args) => conn(allDocuments, args),

        // notificationsUnreadCount
        notificationsUnreadCount: () =>
            allNotifications.filter((n: any) => n.readAt == null).length,

        // Search
        searchIssues: (_src, args) => {
            const term = ((args.term as string) ?? '').toLowerCase();
            const results = allIssues
                .filter((i: any) => i.title.toLowerCase().includes(term))
                .map((i: any) => ({ ...i, __typename: 'IssueSearchResult' }));
            return conn(results, args);
        },
        searchProjects: (_src, args) => {
            const term = ((args.term as string) ?? '').toLowerCase();
            const results = allProjects
                .filter((p: any) => p.name.toLowerCase().includes(term))
                .map((p: any) => ({ ...p, __typename: 'ProjectSearchResult' }));
            return conn(results, args);
        },
        searchDocuments: (_src, args) => {
            const term = ((args.term as string) ?? '').toLowerCase();
            const results = allDocuments
                .filter((d: any) => d.title.toLowerCase().includes(term))
                .map((d: any) => ({ ...d, __typename: 'DocumentSearchResult' }));
            return conn(results, args);
        },
    },

    // ---- User connection fields ----
    User: {
        assignedIssues: (src: any, args: any) => {
            let list: any[] = src.assignedIssues ?? [];
            const f = args.filter as any;
            if (f?.state?.type?.in) {
                const types = f.state.type.in as string[];
                list = list.filter((i: any) => types.includes(i.state.type));
            }
            if (f?.snoozedUntilAt?.null === false)
                list = list.filter((i: any) => i.snoozedUntilAt != null);
            if (f?.dueDate?.null === false) list = list.filter((i: any) => i.dueDate != null);
            if (f?.dueDate?.lt) {
                const lt = f.dueDate.lt as string;
                list = list.filter((i: any) => i.dueDate != null && i.dueDate < lt);
            }
            return conn(list, args);
        },
        createdIssues: (src: any, args: any) => conn(src.createdIssues ?? [], args),
        teams: (src: any, args: any) => conn(src.teams ?? [], args),
        teamMemberships: (src: any, args: any) => conn(src.teamMemberships ?? [], args),
        issueDrafts: (src: any, args: any) => conn(src.issueDrafts ?? [], args),
        drafts: (src: any, args: any) => conn(src.issueDrafts ?? [], args),
    },

    // ---- Team connection fields ----
    Team: {
        members: (src: any, args: any) => conn(src.members ?? [], args),
        issues: (src: any, args: any) => conn(src.issues ?? [], args),
        states: (src: any, args: any) => conn(src.states ?? [], args),
        cycles: (src: any, args: any) => conn(src.cycles ?? [], args),
        gitAutomationStates: (src: any, args: any) => conn(src.gitAutomationStates ?? [], args),
        templates: (src: any, args: any) => conn(src.templates ?? [], args),
    },

    // ---- Issue connection fields ----
    Issue: {
        children: (src: any, args: any) => conn(src.children ?? [], args),
        comments: (src: any, args: any) => conn(src.comments ?? [], args),
        history: (src: any, args: any) => conn(src.history ?? [], args),
        relations: (src: any, args: any) => conn(src.relations ?? [], args),
        attachments: (src: any, args: any) => conn(src.attachments ?? [], args),
        subscribers: (src: any, args: any) => conn(src.subscribers ?? [], args),
        needs: (src: any, args: any) => conn(src.needs ?? [], args),
        labels: (src: any, args: any) => conn(src.labels ?? [], args),
        documents: (src: any, args: any) => conn(src.documents ?? [], args),
    },

    // ---- Cycle connection fields ----
    Cycle: {
        issues: (src: any, args: any) => conn(src.issues ?? [], args),
        uncompletedIssuesUponClose: (src: any, args: any) =>
            conn(src.uncompletedIssuesUponClose ?? [], args),
    },

    // ---- Project connection fields ----
    Project: {
        teams: (src: any, args: any) => conn(src.teams ?? [], args),
        documents: (src: any, args: any) => conn(src.documents ?? [], args),
        projectMilestones: (src: any, args: any) => conn(src.projectMilestones ?? [], args),
        projectUpdates: (src: any, args: any) => conn(src.projectUpdates ?? [], args),
        externalLinks: (src: any, args: any) => conn(src.externalLinks ?? [], args),
        relations: (src: any, args: any) => conn(src.relations ?? [], args),
        inverseRelations: (src: any, args: any) => conn(src.inverseRelations ?? [], args),
        issues: (src: any, args: any) => conn(src.issues ?? [], args),
    },

    // ---- ProjectSearchResult connection fields (same shape as Project) ----
    ProjectSearchResult: {
        teams: (src: any, args: any) => conn(src.teams ?? [], args),
        documents: (src: any, args: any) => conn(src.documents ?? [], args),
        projectMilestones: (src: any, args: any) => conn(src.projectMilestones ?? [], args),
        projectUpdates: (src: any, args: any) => conn(src.projectUpdates ?? [], args),
        externalLinks: (src: any, args: any) => conn(src.externalLinks ?? [], args),
        relations: (src: any, args: any) => conn(src.relations ?? [], args),
        inverseRelations: (src: any, args: any) => conn(src.inverseRelations ?? [], args),
        issues: (src: any, args: any) => conn(src.issues ?? [], args),
    },

    // ---- Initiative connection fields ----
    Initiative: {
        projects: (src: any, args: any) => conn(src.projects ?? [], args),
        subInitiatives: (src: any, args: any) => conn(src.subInitiatives ?? [], args),
    },

    // ---- Roadmap connection fields ----
    Roadmap: {
        projects: (src: any, args: any) => conn(src.projects ?? [], args),
    },

    // ---- Organization connection fields ----
    Organization: {
        users: (src: any, args: any) => conn(allUsers, args),
        teams: (src: any, args: any) => conn(allTeams, args),
        integrations: (src: any, args: any) => conn(allIntegrations, args),
        labels: (src: any, args: any) => conn(allIssueLabels, args),
    },

    // ---- ReleasePipeline connection fields ----
    ReleasePipeline: {
        stages: (src: any, args: any) => conn(src.stages ?? [], args),
        releases: (src: any, args: any) => {
            const pipelineReleases = allReleases.filter((r: any) => r.pipeline?.id === src.id);
            return conn(pipelineReleases, args);
        },
        teams: (src: any, args: any) => conn([src.team].filter(Boolean), args),
        projects: (src: any, args: any) => conn(src.projects ?? [], args),
    },

    // ---- Release connection fields ----
    Release: {
        issues: (src: any, args: any) => conn(src.issues ?? [], args),
    },
};
