# Prime Agent Studio Fleet: architecture

Work in progress, technical demo of the Studio public API v1. The app is called Prime Fleet.

Prime Fleet is an Expo (SDK 57, React Native 0.86) app that drives several
Prime Agent Studio instances through the Studio public API v1
(`docs/openapi-v1.json`, guide: [docs/api.md](https://github.com/zerr0o/prime-agent-studio/blob/main/docs/api.md) of Prime Agent Studio).
Targets: Android (phone and tablet) and the web on a PC, served by a small local relay.

## Product decisions (from the user, do not change)

1. **Projects first.** The top level is a project found on one or several machines.
   The same project on two machines shares a non-null `syncId`; never match by name or folder.
   Each machine of a project shows its Roadmap sync status.
2. **Roadmap second.** Every Roadmap task (plan step, whole plan, backlog item) can be assigned
   to a machine of the fleet.
3. **Pipeline.** Assignments, dependencies between tasks and the node layout are stored
   **in the app only** (AsyncStorage), with JSON export and import. Nothing is written in the
   Roadmaps for the pipeline itself.
4. **End of run.** When a run ends (its SSE stream closes), the app syncs the machines of the
   project (`POST /projects/{id}/sync`), reads the Roadmaps again and checks whether another task
   of the pipeline is now ready on another PC.
5. **Auto mode per pipeline.** Auto on: ready tasks start on their machine. Auto off: the app
   proposes "Start on <machine>". Never retry or move work to another machine after a failure,
   a timeout or an offline machine.
6. **Injected instructions.** Every task started by the app receives instructions (field
   `instructions` of `POST /roadmap/work`, 4 000 characters max): check the Roadmap step with
   `roadmap_check` when the task is finished, plus Git handoff (git pull at start, commit and
   push on the current branch at the end), editable and switchable per pipeline.
7. **Done** = the step is checked in the synced Roadmap. A run that ends without checking its
   step puts the task in "review" and nothing chains. A task done and then unchecked (by a person,
   in Studio or in Fleet) is **reopened**: it is open again (ready, waiting...), never "review".
8. **Conversation of the next task** (user request): per pipeline, a new conversation (default) or
   "continue the previous one"; per task, an explicit choice (new, its own last conversation, or the
   conversation of one of its dependencies); per link, a switch "continues the conversation". A
   continued conversation is moved to the next machine by the R2 sync of that one conversation
   (`POST /projects/{id}/sync { sessionId }` on the source, then on the target), then
   `POST /roadmap/work { sessionId }`. If it cannot move, the task does not start (launch error);
   Prime Fleet never replaces it by a new conversation. A dependency done without any run has no
   conversation: the task starts a new one and the activity says so.
9. **Tests**: a multi-machine simulator and read-only calls on the real Studio. No real run
   without asking the user first.

## Look and feel

The app must look like one more screen of Prime Agent Studio. Follow the style kit:
[`prime-agent-studio-style`](https://github.com/zerr0o/prime-agent-studio/tree/main/SKILLS/prime-agent-studio-style) (SKILL.md,
`references/*.md`, `assets/studio.css`, `assets/icons.js`, screenshots). In React Native:

- Colors, radii, type sizes and layout sizes come from `src/ui/theme.ts` only. No literal color
  outside `theme.ts` (palettes included there).
- Dark first, light supported (`useTheme()` from `src/ui/theme-context.tsx`).
- 12 px UI text, 13 px reading text (line height 1.8), 10 to 11 px metadata, weights 400 to 650.
- Status = 6 px dot + short word. Identity colors (machines, plans) only tint a dot, an icon or a
  3 px border. At most one accent-filled button per view.
- Sentence case, no em dash, " · " as separator, no emoji, no exclamation mark.
- Touch targets 44 px on phones; dense 32 to 38 px controls on desktop.

## Directory layout

```
src/app/            expo-router routes only (screens), thin
src/api/            types.ts (DTOs), client.ts (StudioClient), sse.ts, errors.ts, transport.ts
src/domain/         pure TS: fleet grouping, sync status, pipeline engine, instructions, conductor
src/state/          zustand store + persistence (AsyncStorage, SecureStore)
src/ui/             theme.ts, theme-context.tsx, icons.tsx, components/ (Studio components)
src/features/       feature components (node editor, roadmap list, run view...)
src/i18n/           fr.ts, en.ts, index.ts
relay/server.mjs    web relay: serves dist/ and proxies /relay/api/v1/* to a Studio
sim/studio-sim.mjs  multi-machine Studio simulator (v1 contract) for tests and demos
test/               vitest tests (domain, client, conductor, relay, simulator)
```

## Platform and transport

- **Native (Android)**: direct calls to `<baseUrl>/api/v1/...` with `Authorization: Bearer`.
  On SDK 57 the global `fetch` is `expo/fetch` and streams (`response.body.getReader()`), so SSE
  is read with fetch (EventSource cannot send headers).
- **Web**: Studio refuses cross-origin browser calls (Origin check, no CORS). The web build calls
  the relay: `POST|GET <relay>/relay/api/v1/...` with header `X-Studio-Target: <baseUrl>`.
  The relay strips Origin, Referer, Cookie and Sec-Fetch headers, sets Host and streams the answer.
  Relay URL: same origin in production; `EXPO_PUBLIC_RELAY_URL` (default `http://127.0.0.1:8790`)
  with the Metro dev server.
- **Addresses Studio accepts**: `http://127.0.0.1:3088` (local PC only), Tailscale HTTPS
  `https://<pc>.<tailnet>.ts.net`, Tailscale HTTP `http://100.64.0.0/10:3089`.
  Plain LAN HTTP (192.168.x.x) is refused by Studio (`api_requires_encrypted_transport`).
  The Android emulator reaches the local Studio with `adb reverse tcp:3088 tcp:3088`.

## API facts that shape the app

- Tokens are created in Studio (Preferences, API). Scopes: `read`, `runs:write`,
  `roadmaps:write`, `files:download`, `computer:write`, `sync:write`. Scopes are not readable:
  learn them from `403 insufficient_scope`. Show at most the last 4 characters of a token.
- `GET /machine` gives `machineId` (stable) and `name` (host name).
- Full sync `POST /projects/{id}/sync {}` covers every synced project and Roadmap and needs a
  token authorized on all of them (else 403). With `{ sessionId }` it syncs one conversation only
  (no Roadmap). 409 `sync_not_configured` / `sync_disabled`, 502 `sync_failed`.
- Roadmap `revision` is local to each copy. `lastEdit.at` converges to the newest edit after sync.
  Same content on two machines = same `overview`, `plans`, `backlog`, `pastudioImports`.
- `POST /roadmap/work` needs `read`, `runs:write`, `roadmaps:write`, the local `expectedRevision`
  and a `requestId` (`[A-Za-z0-9_-]{16,100}`). Studio caches a requestId for one hour per
  project, failures included: after a 409 use a new requestId. Runs keep `requestId`, which lets
  the app find a run it already started (`GET /runs`).
- Run events (SSE): `session`, `message_start`, `text`/`thinking` (delta), `message`,
  `tool_start`/`tool_update`/`tool_end`, `status`, `interaction` (agent question),
  `done` (`status: completed | failed | stopped`), `replay_truncated`. Frames are
  `id: <seq>` + `data: <json>`; `: heartbeat` comments every 15 s; the stream ends with the run.
- Questions: `run.interactions[]` with `{ id, method: select|input|confirm|editor, title,
  message, options, optionDetails, allowCustom, status }`. Answer with
  `POST /runs/{id}/interactions { id, response: { value } | { confirmed } | { cancelled: true } }`.
  Never answer automatically.

## Domain rules

- **Fleet project key**: `sync:<syncId>`, or `local:<machineId>:<projectId>` without syncId.
- **Sync status of a member** (project with 2+ members): compare content fingerprints of the
  readable copies. All equal: `synced`. Otherwise the copies with the newest `lastEdit.at` are
  `latest` (or `diverged` if two copies share that time with different content) and the others
  are `behind`. Machines without R2 sync: `sync-off`. Unreachable: `offline` / `unknown`.
- **Reading a task across copies**: among the copies of machines that take part in the R2 sync,
  the one holding the newest version of its plan (`plan.updatedAt`, or `updatedAt` of a backlog
  entry) wins, as in Studio's merge. So a check made on one PC and an uncheck made later on another
  both read correctly before every machine synced. A machine without R2 sync never takes part in
  that choice (its copy cannot hide a check made elsewhere), but its own checks still count.
- **Reopened tasks never restart by themselves**, even in auto mode (a merge can also drop a check
  when two PCs change the same plan between two syncs): only an explicit start runs them again.
- **Node states**, by priority: `running`, `done`, `failed`, `stopped`, `review`, `queued`,
  `ready`, `offline`, `waiting`, `unassigned`, `missing`. A finished last run gives
  `failed`/`stopped`/`review` only while its task was never seen done since (`lastRun.checked` or
  `lastRun.seenDone`); otherwise the task is reopened and gets an open state. One running pipeline
  task per (machine, project) at a time; the next one is `queued`.
- **Launch** (`launchNode`): a task whose last run is finished starts a new attempt (attempt + 1;
  the old run is history and never comes back on the node). Then look for an existing run of this
  attempt on the target machine (`GET /runs`, requestId prefix), else read the target Roadmap,
  verify the dependencies are done in that copy, move the conversation to continue (if any), then
  `POST /roadmap/work`. RequestId = `pf-<hash(project, node, attempt)>-r<rev>[-s<hash(session)>]`.

## Commands

```
npm run web            Metro dev server (web) + use the relay for API calls
npm run relay          node relay/server.mjs (port 8790, serves dist/ when built)
npm run sim            node sim/studio-sim.mjs (simulated Studios on ports 3101 to 3103)
npm test               vitest run
npx tsc --noEmit       typecheck
npx expo export -p web build the web app into dist/
```

## Rules for contributors (agents included)

- Read the relevant Expo SDK 57 doc before using an Expo API (see AGENTS.md).
- Do not add a dependency without a clear need; prefer the standard library and React Native core.
- Domain code (`src/domain`, `src/api`, `src/i18n/core.ts`) must stay free of React Native imports.
- Android runs Hermes: no `Intl.PluralRules` (and partial `Intl`). Plurals and dates are done by hand
  in `src/i18n/core.ts`; do not add `Intl` calls in render paths. Test Android with
  `npm run android:apk`, then `adb install -r android/app/build/outputs/apk/release/app-release.apk`
  (emulator: `adb reverse tcp:3101 tcp:3101` and the same for 3102 and 3103 to reach the simulator).
- Keep secrets out of logs, URLs, screenshots and commits (`.secrets/` is ignored).
