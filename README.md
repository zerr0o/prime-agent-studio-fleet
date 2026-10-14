# Prime Agent Studio Fleet

**English** · [Français](README.fr.md)

> **Work in progress · technical demo.** This project shows how to drive several [Prime Agent Studio](https://github.com/zerr0o/prime-agent-studio) instances through the Studio public API v1. It is not a finished product: expect missing parts and breaking changes.

> **Requires Cloudflare R2 sync.** Prime Fleet relies on the sync of conversations and Roadmaps through the Cloudflare R2 bucket configured in Prime Agent Studio (Preferences, Synchronization). If sync is not configured on your Studios, the app cannot work: machines never see each other's progress and the pipeline cannot chain tasks.

Prime Agent Studio Fleet (the app is called **Prime Fleet**) is a control center for several [Prime Agent Studio](https://github.com/zerr0o/prime-agent-studio) instances. It talks to each Studio through its public API v1, groups the machines by project, shows whether each machine has an up-to-date Roadmap, and runs a planned pipeline of Roadmap tasks across your PCs.

It is a React Native app (Expo SDK 57) for **Android** (phone and tablet) and the **web on a PC**, served by a small local relay.

https://github.com/user-attachments/assets/6c6717c1-e20d-4e16-bf9a-b86718ca1ffb

Intro video (45 s, with sound). Recorded on the built-in simulator, sample data only.

## What it does

- **Projects first.** A project found on several machines (same `syncId`) appears once, with each machine and its Roadmap sync status: Synced, Most recent, Behind, Diverged, Sync off, Offline.
- **Roadmap second.** Read the Roadmap of any machine, check or uncheck tasks, and assign each task (step, whole plan or backlog item) to a machine of the project.
- **Pipeline (node view).** One lane per machine. Tasks are nodes, links are dependencies. Drag a task to another lane to reassign it; drag from a task's right port to another task to link them. Each node shows its live state: Ready, Queued, Working, Done, To review, Failed, Waiting, Machine offline.
- **Auto mode per pipeline.** When a run ends (its SSE stream closes), Prime Fleet syncs the machines of the project through Cloudflare R2, reads the Roadmaps again and starts the next ready task on its machine. With auto off, it proposes the start instead.
- **Conversation of the next task.** In the pipeline settings, choose a new conversation for each task or "continue the previous one". Override it per task (new, its own last conversation, or the conversation of a task it waits for), or with the switch of a selected link; a small bubble marks the link that carries the conversation. Prime Fleet moves that conversation to the next machine through the R2 sync of that one conversation before it starts the task. If the move fails, the task does not start: you choose again, nothing is replaced silently.
- **Injected instructions.** Every task started by Prime Fleet tells the agent to check its Roadmap step when the task is finished, and (by default) to `git pull` at the start and commit and push on the current branch at the end. Editable per pipeline.
- **Runs.** Live transcript, agent questions answered on purpose, follow-up or steer messages, stop.
- **Machines.** Add a Studio with its address and token, test the connection, pick its color. Tokens stay on the device and are shown as `•••• 7f2a` only.

Assignments, links and layouts are stored in the app only. Use Preferences, Export / Import to move them to another device (tokens are never exported).

## Requirements

1. **Prime Agent Studio 4.3 or later** on each PC, with the API turned on (Preferences, API).
2. **One token per Studio** (Preferences, API, Create a token): scopes `read`, `runs:write`, `roadmaps:write`, `sync:write`, on **all projects**. A full Roadmap sync covers every synced project, so a token limited to some projects cannot push Roadmaps right after a run. Moving a conversation to another machine also needs `sync:write` on both tokens.
3. **Cloudflare R2 sync** configured in every Studio (Preferences, Synchronization), so that a step checked on one PC reaches the others.
4. **Addresses Studio accepts for the API**:
   - this PC: `http://127.0.0.1:3088`;
   - another PC: its Tailscale HTTPS address `https://pc-name.tailnet.ts.net` (Studio, Preferences, Remote access, Tailscale HTTPS) or Tailscale HTTP `http://100.x.y.z:3089`.
   Studio refuses the API over the plain local network (`192.168.x.x`).

## Use it on a PC (web)

```sh
npm install
npm run serve:web        # builds the web app, then starts the relay
```

Open http://127.0.0.1:8790. The relay listens on 127.0.0.1 only. It serves the app and forwards `/relay/api/v1/*` to the Studio you chose, because Studio refuses calls from browser pages of another origin.

## Use it on Android

```sh
npm install
npx expo prebuild --platform android   # once
npm run android:apk
```

The APK is in `android/app/build/outputs/apk/release/app-release.apk`. Install it with `adb install` or copy it to the phone. On the phone, connect Tailscale and add each PC with its Tailscale address and token.

## Development

```sh
npm run sim       # 3 simulated Studios on ports 3101 to 3103 (tokens in the console)
npm run relay     # relay on 127.0.0.1:8790 (allows the Metro dev origin)
npm run web       # Metro dev server, web
npm test          # vitest: domain, conductor, i18n, relay, simulator (116 tests)
npm run typecheck
```

The simulator implements the API v1 contract (`docs/openapi-v1.json`) with three machines, shared projects, a simulated R2 bucket, runs with SSE events, agent questions and failure scenarios (`[fail]`, `[nocheck]`, `[ask]`, `[slow]` in a task text). Use it to try the pipeline without cost.

Architecture and rules: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## How the pipeline decides

- A task is **done** when its step is checked in a synced Roadmap.
- A task is **ready** when its dependencies are done, its machine is online and has the project, and no other task of this project runs on that machine.
- A run that ends **without checking its step** puts the task in **To review**. Nothing chains after it until a person marks it done or starts it again.
- A task done and then **unchecked** (in Studio or in Prime Fleet) is **reopened**: it is open again (Ready, Waiting...) and its next start is a new attempt. It never restarts by itself, even in auto mode: start it from its node or with "Start ready tasks".
- Each task is read from the synced copy that holds the newest version of its plan, like Studio's merge. A machine without R2 sync keeps its own checks, and its copy never hides a check made elsewhere.
- A failed or stopped run, a lost answer or an offline machine is **never retried automatically** and never moved to another machine.
- Two devices driving the same pipeline do not start a task twice: request ids are stable per task attempt and Prime Fleet adopts a run that already exists.

## Limits

- Prime Fleet orchestrates while it is open (web page or Android app in the foreground).
- Studio keeps finished runs for one hour; older runs are read from the conversation history.
- The web build stores tokens in the browser storage of `127.0.0.1:8790`.
