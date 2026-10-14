// Seed data of the Studio simulator ("demo"): three machines, three projects, one shared R2 bucket.
import { createHash } from 'node:crypto';

export const MODEL = 'anthropic/claude-sonnet-5-5';
export const THINKING = 'high';

export const MACHINE_DEFS = [
  {
    name: 'Workstation',
    machineId: '6f1c2a40-5b7e-4d19-8a63-1c0d9e2f7a01',
    token: 'sim-workstation-token',
    syncConfigured: true,
  },
  {
    name: 'Laptop',
    machineId: '9d3e7b52-84a1-4c6f-b2d7-5e8a0f3c1b02',
    token: 'sim-laptop-token',
    syncConfigured: true,
  },
  {
    name: 'Buildbox',
    machineId: 'c24a8d96-1e5f-4b03-9a7c-d6b1e4f80c03',
    token: 'sim-buildbox-token',
    syncConfigured: false,
  },
];

const hex = (seed, ...parts) => createHash('sha256').update([seed, ...parts].join('|')).digest('hex');
export const uid = (seed, ...parts) => {
  const h = hex(seed, ...parts);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
};
export const projectIdFor = (seed, machineName, name) => 'p_' + hex(seed, 'project', machineName, name).slice(0, 32);

const iso = (ms) => new Date(ms).toISOString();

function message(seed, key, role, text, at, extra = {}) {
  return {
    id: 'm_' + hex(seed, 'message', key).slice(0, 24),
    role,
    text,
    timestamp: iso(at),
    ...(role === 'assistant' ? { model: MODEL, provider: 'anthropic', stopReason: 'stop' } : {}),
    tools: [],
    attachments: [],
    ...extra,
  };
}

function session(seed, key, title, createdAt, exchanges, model = MODEL) {
  const messages = [];
  let at = createdAt;
  exchanges.forEach(([user, assistant], i) => {
    messages.push(message(seed, `${key}-u${i}`, 'user', user, at));
    at += 45_000;
    messages.push(message(seed, `${key}-a${i}`, 'assistant', assistant, at));
    at += 120_000;
  });
  return { id: uid(seed, 'session', key), title, createdAt: iso(createdAt), updatedAt: iso(at - 120_000), model, thinking: THINKING, messages };
}

function step(seed, key, text, { done = false, completion = null, children = [], note = '' } = {}) {
  const kids = children;
  return {
    id: 'step-' + uid(seed, 'step', key),
    text,
    note,
    done: kids.length ? kids.every((k) => k.done) : done,
    completion: done || kids.length ? completion : null,
    children: kids,
  };
}

function journal(seed, key, at, text, actor) {
  return { id: 'journal-' + uid(seed, 'journal', key), at, text, ...actor };
}

function backlogEntry(seed, number, text, addedAt, { done, note = '', updatedAt = addedAt } = {}) {
  return {
    number,
    text,
    note,
    ...(done === undefined ? {} : { done }),
    addedAt,
    id: 'backlog-' + uid(seed, 'backlog', number),
    updatedAt,
    by: 'user',
    sessions: [],
  };
}

/** Build the content of the three projects. `now` is the simulator start (epoch ms). */
export function buildSeed(seed, now, machineIds) {
  const min = 60_000;
  const day = 24 * 60 * min;
  const [desktopId] = machineIds;
  const S = (key) => uid(seed, 'session', key);

  // ---- Nimbus API ---------------------------------------------------------------------------
  const nimbusSessions = [
    session(seed, 'nimbus-1', 'Design token scopes', now - 6 * day, [
      ['Draft the token scopes for the Nimbus API: read, write and admin. Keep it small.', 'I propose three scopes: `read`, `write` and `admin`. Keys inherit the scopes of their owner. I wrote the table in docs/auth.md and linked it from the Roadmap.'],
      ['Add a note about key rotation.', 'Done. Keys rotate every 90 days by default and the old key works for 24 hours after a rotation.'],
    ]),
    session(seed, 'nimbus-2', 'Refresh token rotation', now - 3 * day, [
      ['Implement refresh token rotation with reuse detection.', 'Refresh tokens are now single use. A reused token revokes the whole family and logs an `auth.reuse_detected` event. Tests pass: 14 added.'],
    ]),
    session(seed, 'nimbus-3', 'Redis limiter spike', now - 40 * min, [
      ['Implement the Redis-backed rate limiter from the Roadmap (token bucket).', 'The limiter uses a Lua script for atomic refills. Limits: 600 requests per minute per key, burst 100. I checked the step in the Roadmap.'],
    ]),
  ];
  const bySession = (key) => nimbusSessions.find((s) => s.id === S(key)).id;
  const s1 = bySession('nimbus-1');
  const s2 = bySession('nimbus-2');
  const s3 = bySession('nimbus-3');
  const stamp = (sessionId, ago) => ({ machineId: desktopId, sessionId, completedAt: now - ago });

  const nimbusDoc = (latest) => {
    const limiter = step(seed, 'nimbus-limiter', 'Implement the Redis-backed limiter', {
      done: latest,
      completion: latest ? stamp(s3, 12 * min) : null,
      note: 'Token bucket, one key per API key id.',
    });
    const plans = [
      {
        id: 'plan-' + uid(seed, 'plan', 'nimbus-auth'),
        slug: 'authentication-and-tokens',
        title: 'Authentication and tokens',
        summary: 'Scoped API keys, refresh tokens and a clear migration path for v1 clients.',
        status: 'active',
        milestone: 'milestone-' + uid(seed, 'milestone', 'nimbus-ga'),
        color: '#4f46e5',
        sessions: [s1, s2],
        steps: [
          step(seed, 'nimbus-scopes', 'Design the token scopes', { done: true, completion: stamp(s1, 6 * day) }),
          step(seed, 'nimbus-refresh', 'Implement refresh token rotation', { done: true, completion: stamp(s2, 3 * day) }),
          step(seed, 'nimbus-keys', 'Add API key management endpoints', {
            children: [
              step(seed, 'nimbus-keys-create', 'Create and revoke keys', { done: true, completion: stamp(s2, 2 * day) }),
              step(seed, 'nimbus-keys-audit', 'Write audit log entries for key events'),
              step(seed, 'nimbus-keys-limit', 'Apply a rate limit per key'),
            ],
          }),
          step(seed, 'nimbus-migration', 'Write the migration guide for v1 clients'),
        ],
        journal: [
          journal(seed, 'nimbus-auth-1', now - 3 * day, 'Refresh token rotation shipped behind a flag.', { by: 'agent', sessionId: s2, rootSessionId: s2, name: 'Prime Agent' }),
        ],
        createdAt: now - 8 * day,
        updatedAt: now - 2 * day,
        archived: false,
        archivedAt: null,
      },
      {
        id: 'plan-' + uid(seed, 'plan', 'nimbus-rate'),
        slug: 'rate-limiting-and-quotas',
        title: 'Rate limiting and quotas',
        summary: 'Protect the API from bursts and give each plan a clear quota.',
        status: 'active',
        milestone: 'milestone-' + uid(seed, 'milestone', 'nimbus-ga'),
        color: '#0d9488',
        sessions: latest ? [s3] : [],
        steps: [
          step(seed, 'nimbus-algo', 'Choose the algorithm (token bucket)', { done: true, completion: stamp(s1, 5 * day) }),
          limiter,
          step(seed, 'nimbus-headers', 'Expose the X-RateLimit headers'),
          step(seed, 'nimbus-load', 'Load test at 5,000 requests per second', {
            children: [
              step(seed, 'nimbus-load-k6', 'Write the k6 scenarios'),
              step(seed, 'nimbus-load-run', 'Run them on staging'),
            ],
          }),
        ],
        journal: latest
          ? [journal(seed, 'nimbus-rate-1', now - 12 * min, 'Limiter merged. Burst size still to be tuned.', { by: 'agent', sessionId: s3, rootSessionId: s3, name: 'Prime Agent' })]
          : [],
        createdAt: now - 5 * day,
        updatedAt: latest ? now - 12 * min : now - 95 * min,
        archived: false,
        archivedAt: null,
      },
      {
        id: 'plan-' + uid(seed, 'plan', 'nimbus-portal'),
        slug: 'developer-portal',
        title: 'Developer portal',
        summary: 'A public portal with reference docs, quickstarts and a preview environment.',
        status: 'active',
        milestone: null,
        color: '#ea580c',
        sessions: [],
        steps: [
          step(seed, 'nimbus-docs-gen', 'Pick the docs generator', { done: true, completion: stamp(s1, 4 * day) }),
          step(seed, 'nimbus-reference', 'Generate the reference from the OpenAPI file'),
          step(seed, 'nimbus-quickstart', 'Add quickstarts', {
            children: [step(seed, 'nimbus-qs-node', 'Quickstart for Node'), step(seed, 'nimbus-qs-py', 'Quickstart for Python')],
          }),
          step(seed, 'nimbus-preview', 'Publish a preview environment'),
          step(seed, 'nimbus-copy', 'Review the copy with the support team'),
        ],
        journal: [],
        createdAt: now - 4 * day,
        updatedAt: now - 4 * day,
        archived: false,
        archivedAt: null,
      },
    ];
    return {
      schemaVersion: 1,
      revision: latest ? 14 : 13,
      lastEdit: latest
        ? { by: 'agent', sessionId: s3, rootSessionId: s3, name: 'Prime Agent', at: now - 12 * min }
        : { by: 'user', at: now - 95 * min },
      overview: {
        vision: 'Ship Nimbus API 2.0: a fast, versioned REST API with solid auth, fair rate limits and a clean developer portal.',
        milestones: [
          {
            id: 'milestone-' + uid(seed, 'milestone', 'nimbus-ga'),
            title: '2.0 general availability',
            summary: 'Auth and rate limiting complete, migration guide published.',
            status: 'active',
          },
        ],
      },
      plans,
      backlog: {
        items: [
          backlogEntry(seed, 1, 'Evaluate a GraphQL gateway', now - 7 * day, { done: false, note: 'Only if two customers ask.' }),
          backlogEntry(seed, 2, 'Add a Deprecation header on /v1 endpoints', now - 6 * day, { done: false }),
          backlogEntry(seed, 3, 'Rename the environment variables to NIMBUS_*', now - 6 * day, { done: true, updatedAt: now - 3 * day }),
        ],
        notes: [backlogEntry(seed, 4, 'Customers ask for webhook retries. Revisit after GA.', now - 2 * day)],
        nextNumber: 5,
      },
      pastudioImports: [],
    };
  };

  // ---- Orbit Web ----------------------------------------------------------------------------
  const orbitSessions = [
    session(seed, 'orbit-1', 'Dashboard layout audit', now - 5 * day, [
      ['List the layout problems on the dashboard at 1280 px.', 'Three issues: the sidebar overlaps the chart below 1200 px, the KPI cards wrap badly, and the date picker has no focus ring. Details are in the plan notes.'],
    ]),
    session(seed, 'orbit-2', 'Keyboard navigation', now - 2 * day, [
      ['Make the data table navigable with the keyboard.', 'Arrow keys now move the focus between cells, Enter opens the row and Escape closes it. I added tests for the three cases.'],
    ]),
  ];
  const [o1, o2] = orbitSessions.map((s) => s.id);
  const orbitDoc = () => ({
    schemaVersion: 1,
    revision: 8,
    lastEdit: { by: 'agent', sessionId: o2, rootSessionId: o2, name: 'Prime Agent', at: now - 2 * day },
    overview: {
      vision: 'Orbit Web: the customer dashboard for fleet analytics. Fast, accessible and easy to extend.',
      milestones: [
        { id: 'milestone-' + uid(seed, 'milestone', 'orbit-beta'), title: 'Public beta', summary: 'Redesigned dashboard and an accessibility pass.', status: 'active' },
      ],
    },
    plans: [
      {
        id: 'plan-' + uid(seed, 'plan', 'orbit-dash'),
        slug: 'dashboard-redesign',
        title: 'Dashboard redesign',
        summary: 'New layout, KPI cards and a faster chart.',
        status: 'active',
        milestone: 'milestone-' + uid(seed, 'milestone', 'orbit-beta'),
        color: '#db2777',
        sessions: [o1],
        steps: [
          step(seed, 'orbit-audit', 'Audit the current layout', { done: true, completion: { machineId: desktopId, sessionId: o1, completedAt: now - 5 * day } }),
          step(seed, 'orbit-cards', 'Rebuild the KPI cards'),
          step(seed, 'orbit-chart', 'Switch the main chart to canvas rendering'),
          step(seed, 'orbit-empty', 'Design the empty states'),
        ],
        journal: [],
        createdAt: now - 6 * day,
        updatedAt: now - 5 * day,
        archived: false,
        archivedAt: null,
      },
      {
        id: 'plan-' + uid(seed, 'plan', 'orbit-a11y'),
        slug: 'accessibility-pass',
        title: 'Accessibility pass',
        summary: 'Reach WCAG 2.2 AA on the main flows.',
        status: 'active',
        milestone: 'milestone-' + uid(seed, 'milestone', 'orbit-beta'),
        color: '#65a30d',
        sessions: [o2],
        steps: [
          step(seed, 'orbit-kbd', 'Keyboard navigation for the data table', { done: true, completion: { machineId: desktopId, sessionId: o2, completedAt: now - 2 * day } }),
          step(seed, 'orbit-contrast', 'Fix the color contrast on the status chips'),
          step(seed, 'orbit-sr', 'Test with a screen reader', {
            children: [step(seed, 'orbit-sr-nvda', 'NVDA on Windows'), step(seed, 'orbit-sr-vo', 'VoiceOver on macOS')],
          }),
        ],
        journal: [],
        createdAt: now - 4 * day,
        updatedAt: now - 2 * day,
        archived: false,
        archivedAt: null,
      },
    ],
    backlog: {
      items: [backlogEntry(seed, 1, 'Dark theme for charts', now - 3 * day, { done: false }), backlogEntry(seed, 2, 'Export a dashboard as PDF', now - 3 * day, { done: false })],
      notes: [],
      nextNumber: 3,
    },
    pastudioImports: [],
  });

  // ---- Atlas Mobile (Buildbox only) -----------------------------------------------------------
  const atlasSessions = [
    session(seed, 'atlas-1', 'Offline cache design', now - 4 * day, [
      ['Sketch an offline cache for the trip list. SQLite or MMKV?', 'SQLite fits better: trips have relations and we need queries by date. I wrote a schema proposal and a migration plan.'],
    ]),
  ];
  const a1 = atlasSessions[0].id;
  const atlasDoc = () => ({
    schemaVersion: 1,
    revision: 5,
    lastEdit: { by: 'user', at: now - 1 * day },
    overview: { vision: 'Atlas Mobile: plan trips offline, sync when the network is back.', milestones: [] },
    plans: [
      {
        id: 'plan-' + uid(seed, 'plan', 'atlas-offline'),
        slug: 'offline-mode',
        title: 'Offline mode',
        summary: 'Trips, maps and bookings stay available without a network.',
        status: 'active',
        milestone: null,
        color: '#0d9488',
        sessions: [a1],
        steps: [
          step(seed, 'atlas-schema', 'Define the SQLite schema', { done: true, completion: { machineId: machineIds[2], sessionId: a1, completedAt: now - 4 * day } }),
          step(seed, 'atlas-cache', 'Cache the trip list'),
          step(seed, 'atlas-queue', 'Queue edits made offline'),
        ],
        journal: [],
        createdAt: now - 5 * day,
        updatedAt: now - 4 * day,
        archived: false,
        archivedAt: null,
      },
      {
        id: 'plan-' + uid(seed, 'plan', 'atlas-push'),
        slug: 'push-notifications',
        title: 'Push notifications',
        summary: 'Remind travelers of departures and gate changes.',
        status: 'paused',
        milestone: null,
        sessions: [],
        steps: [step(seed, 'atlas-push-1', 'Choose a push provider'), step(seed, 'atlas-push-2', 'Register device tokens')],
        journal: [],
        createdAt: now - 3 * day,
        updatedAt: now - 1 * day,
        archived: false,
        archivedAt: null,
      },
    ],
    backlog: { items: [backlogEntry(seed, 1, 'Widget with the next departure', now - 2 * day, { done: false })], notes: [], nextNumber: 2 },
    pastudioImports: [],
  });

  const syncIds = {
    nimbus: 'sync_' + hex(seed, 'sync', 'nimbus').slice(0, 24),
    orbit: 'sync_' + hex(seed, 'sync', 'orbit').slice(0, 24),
  };
  const withRevision = (doc, revision) => ({ ...doc, revision });
  return {
    syncIds,
    // Per machine: the projects it holds. Laptop's Nimbus copy is behind (one change missing).
    machines: [
      [
        { name: 'Nimbus API', syncId: syncIds.nimbus, doc: nimbusDoc(true), sessions: nimbusSessions },
        { name: 'Orbit Web', syncId: syncIds.orbit, doc: orbitDoc(), sessions: orbitSessions },
      ],
      [
        { name: 'Nimbus API', syncId: syncIds.nimbus, doc: nimbusDoc(false), sessions: nimbusSessions.slice(0, 2) },
        { name: 'Orbit Web', syncId: syncIds.orbit, doc: orbitDoc(), sessions: orbitSessions },
      ],
      [
        { name: 'Nimbus API', syncId: syncIds.nimbus, doc: withRevision(nimbusDoc(true), 12), sessions: nimbusSessions },
        { name: 'Atlas Mobile', syncId: null, doc: atlasDoc(), sessions: atlasSessions },
      ],
    ],
    // The bucket holds the latest Nimbus copy and the Orbit copy.
    bucket: {
      [syncIds.nimbus]: { doc: nimbusDoc(true), sessions: nimbusSessions },
      [syncIds.orbit]: { doc: orbitDoc(), sessions: orbitSessions },
    },
  };
}
