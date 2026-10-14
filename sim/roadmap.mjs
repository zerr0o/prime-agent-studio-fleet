// Roadmap model of the Studio simulator: DTO, closed mutations and two-way merge.
// Mirrors lib/roadmap.mjs (dto, progress, derivedSteps, apply) and lib/roadmap-merge.mjs of Prime Agent Studio.
import { createHash, randomUUID } from 'node:crypto';

export class ApiError extends Error {
  constructor(status, code, message, extra) {
    super(message);
    this.status = status;
    this.code = code;
    if (extra) Object.assign(this, extra);
  }
}
const fail = (status, code, message, extra) => new ApiError(status, code, message, extra);
const invalid = (message = 'The Roadmap change is invalid.') => fail(400, 'roadmap_invalid', message);
const missing = (message) => fail(404, 'roadmap_missing', message);

export const clone = (value) => structuredClone(value);
export const canonical = (value) =>
  Array.isArray(value)
    ? value.map(canonical)
    : value && typeof value === 'object'
      ? Object.fromEntries(
          Object.keys(value)
            .sort()
            .map((key) => [key, canonical(value[key])]),
        )
      : value;
export const canonicalJson = (value) => JSON.stringify(canonical(value));
const isObject = (value) => !!value && typeof value === 'object' && !Array.isArray(value);
const own = (value, key) => Object.hasOwn(value, key);
const newId = (prefix) => `${prefix}-${randomUUID()}`;

const PLAN_STATUSES = new Set(['active', 'done', 'paused', 'abandoned']);
const MILESTONE_STATUSES = new Set(['planned', 'active', 'done']);
const PLAN_COLORS = new Set(['#0d9488', '#db2777', '#4f46e5', '#65a30d', '#ea580c']);
const ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,199}$/;
const MAX_STEPS = 2000;

function text(value, label, max = 8000, optional = false) {
  if (optional && (value === undefined || value === null)) return '';
  if (typeof value !== 'string' || value.length > max || value.includes('\0') || (!optional && !value.trim()))
    throw invalid(`${label} is invalid (maximum ${max} characters).`);
  return value.trim();
}
function identifier(value, label = 'Identifier') {
  if (typeof value !== 'string' || !ID.test(value)) throw invalid(`${label} is invalid.`);
  return value;
}
function integer(value, label, minimum = 0) {
  if (!Number.isSafeInteger(value) || value < minimum) throw invalid(`${label} is invalid.`);
  return value;
}
function boolean(value) {
  if (typeof value !== 'boolean') throw invalid('The box must be checked or unchecked explicitly.');
  return value;
}
function list(value, label, max = MAX_STEPS) {
  if (!Array.isArray(value) || value.length > max) throw invalid(`${label} is invalid (maximum ${max} items).`);
  return value;
}
function oneOf(value, values) {
  if (!values.has(value)) throw invalid('Roadmap status is invalid.');
  return value;
}

export function emptyDoc() {
  return {
    schemaVersion: 1,
    revision: 0,
    lastEdit: null,
    overview: { vision: '', milestones: [] },
    plans: [],
    backlog: { items: [], notes: [], nextNumber: 1 },
    pastudioImports: [],
  };
}

// ---------------------------------------------------------------------------
// DTO
// ---------------------------------------------------------------------------
export function progress(steps) {
  let done = 0;
  let total = 0;
  for (const step of steps) {
    if (step.children.length) {
      const value = progress(step.children);
      total += value.total;
      done += value.done;
    } else {
      total++;
      if (step.done) done++;
    }
  }
  return { done, total, percent: total ? Math.round((done / total) * 100) : 0 };
}
function aggregate(plans) {
  const value = plans.reduce(
    (acc, plan) => ({ done: acc.done + plan.progress.done, total: acc.total + plan.progress.total }),
    { done: 0, total: 0 },
  );
  return { ...value, percent: value.total ? Math.round((value.done / value.total) * 100) : 0 };
}
export function derivedSteps(steps) {
  return steps.map((step) => {
    const children = derivedSteps(step.children);
    const value = progress(children);
    return {
      ...step,
      children,
      done: children.length ? value.done === value.total : step.done,
      partial: children.length ? value.done > 0 && value.done < value.total : false,
    };
  });
}
/** Roadmap DTO as returned by GET /roadmap (without cwd and without the live decoration). */
export function toDto(name, doc) {
  const plans = doc.plans.map((plan) => ({
    ...clone(plan),
    steps: derivedSteps(clone(plan.steps)),
    progress: progress(plan.steps),
  }));
  const activePlans = plans.filter((plan) => plan.status !== 'abandoned' && !plan.archived);
  const value = aggregate(activePlans);
  return {
    name,
    initialized: doc.revision > 0,
    revision: doc.revision,
    lastEdit: clone(doc.lastEdit),
    overview: {
      ...clone(doc.overview),
      milestones: doc.overview.milestones.map((milestone) => ({
        ...clone(milestone),
        progress: aggregate(activePlans.filter((plan) => plan.milestone === milestone.id)),
      })),
      progress: value,
    },
    plans,
    backlog: clone(doc.backlog),
    progress: value,
    pastudioImports: clone(doc.pastudioImports ?? []),
  };
}

// ---------------------------------------------------------------------------
// Steps
// ---------------------------------------------------------------------------
const derivedEffective = (step) => (step.children.length ? step.children.every(derivedEffective) : step.done);
function collectSteps(steps, map = new Map(), parent = null, depth = 1) {
  steps.forEach((step, index) => {
    map.set(step.id, { step, siblings: steps, index, parent, depth });
    collectSteps(step.children, map, step, depth + 1);
  });
  return map;
}
export const findStepIn = (steps, id) => collectSteps(steps).get(id)?.step ?? null;
const subtreeDepth = (step) => 1 + Math.max(0, ...step.children.map(subtreeDepth));
function syncParents(steps) {
  for (const step of steps) {
    syncParents(step.children);
    if (step.children.length) step.done = step.children.every((child) => child.done);
  }
}
function effectiveMap(steps) {
  const map = new Map();
  for (const [id, { step }] of collectSteps(steps)) map.set(id, derivedEffective(step));
  return map;
}
// Stamp false->true once with the executing actor, clear on reopen (see reconcilePlanCompletions).
function reconcile(plan, before, { allowStamp, stamp }) {
  const was = effectiveMap(before || []);
  for (const [id, { step }] of collectSteps(plan.steps)) {
    const now = derivedEffective(step);
    if (now && was.get(id) !== true) {
      if (allowStamp) step.completion = stamp ? { ...stamp } : null;
    } else if (!now && was.get(id) === true) step.completion = null;
  }
}
function normalizeSteps(input, { old = [], creating = false } = {}) {
  const existing = collectSteps(old);
  const seen = new Set();
  let count = 0;
  const visit = (nodes, depth) =>
    list(nodes, 'Steps').map((node) => {
      if (++count > MAX_STEPS || depth > 3 || !isObject(node))
        throw invalid('A checklist accepts three levels and 2,000 steps at most.');
      const stepId = node.id === undefined ? newId('step') : identifier(node.id, 'Step');
      if (seen.has(stepId)) throw invalid('Every step needs a unique id.');
      seen.add(stepId);
      const previous = existing.get(stepId)?.step;
      if (!creating && node.id !== undefined && !previous)
        throw invalid('A new step must omit its id; existing ids stay unchanged.');
      const children =
        node.children === undefined && previous ? clone(previous.children) : visit(node.children ?? [], depth + 1);
      return {
        id: stepId,
        text: text(node.text === undefined && previous ? previous.text : node.text, 'Step text'),
        note: text(node.note === undefined && previous ? previous.note : node.note, 'Note', 16000, true),
        done: children.length
          ? children.every((child) => child.done)
          : node.done === undefined
            ? (previous?.done ?? false)
            : boolean(node.done),
        completion: !creating && previous?.completion ? { ...previous.completion } : null,
        children,
      };
    });
  const result = visit(input, 1);
  if (!creating && [...existing.keys()].some((id) => !seen.has(id)))
    throw invalid('An existing step is missing. Remove it explicitly before replacing the plan.');
  return result;
}

function moveInList(entries, value, target, position) {
  if (!['before', 'after'].includes(position)) throw invalid('Move position is invalid.');
  if (value === target) return;
  entries.splice(entries.indexOf(value), 1);
  entries.splice(entries.indexOf(target) + (position === 'after' ? 1 : 0), 0, value);
}
function moveStep(plan, input) {
  const source = findStep(plan, input.stepId);
  let destination;
  let index;
  if (input.direction !== undefined) {
    switch (input.direction) {
      case 'up':
      case 'down': {
        const next = source.index + (input.direction === 'up' ? -1 : 1);
        if (next < 0 || next >= source.siblings.length) return;
        source.siblings.splice(source.index, 1);
        source.siblings.splice(next, 0, source.step);
        return;
      }
      case 'indent': {
        const previous = source.siblings[source.index - 1];
        if (!previous) throw invalid('No previous step can hold this group.');
        if (source.depth + subtreeDepth(source.step) > 3) throw invalid('The checklist is limited to three levels.');
        destination = previous.children;
        index = destination.length;
        break;
      }
      case 'outdent': {
        if (!source.parent) throw invalid('This step is already at the first level.');
        const parent = findStep(plan, source.parent.id);
        destination = parent.siblings;
        index = parent.index + 1;
        break;
      }
      default:
        throw invalid('Move direction is invalid.');
    }
  } else {
    if (!['before', 'after', 'inside'].includes(input.position)) throw invalid('Move position is invalid.');
    const target = findStep(plan, input.targetId);
    if (source.step === target.step) return;
    if (collectSteps([source.step]).has(target.step.id)) throw invalid('A step cannot move into its own children.');
    const depth = target.depth + (input.position === 'inside' ? 1 : 0);
    if (depth + subtreeDepth(source.step) - 1 > 3) throw invalid('The checklist is limited to three levels.');
    destination = input.position === 'inside' ? target.step.children : target.siblings;
    index = input.position === 'inside' ? destination.length : target.index + (input.position === 'after' ? 1 : 0);
  }
  if (destination === source.siblings && source.index < index) index--;
  source.siblings.splice(source.index, 1);
  destination.splice(index, 0, source.step);
}

// ---------------------------------------------------------------------------
// Lookups
// ---------------------------------------------------------------------------
function findPlan(doc, planId) {
  identifier(planId, 'Plan');
  const plan = doc.plans.find((entry) => entry.id === planId || entry.slug === planId);
  if (!plan) throw missing('This plan is not in the project.');
  return plan;
}
function findStep(plan, stepId) {
  identifier(stepId, 'Step');
  const found = collectSteps(plan.steps).get(stepId);
  if (!found) throw missing('This step is not in the plan.');
  return found;
}
function findMilestone(doc, id) {
  identifier(id, 'Milestone');
  const found = doc.overview.milestones.find((entry) => entry.id === id);
  if (!found) throw missing('This milestone is not in the project.');
  return found;
}
export function findBacklog(doc, number) {
  integer(number, 'Number', 1);
  for (const entries of [doc.backlog.items, doc.backlog.notes]) {
    const index = entries.findIndex((entry) => entry.number === number);
    if (index !== -1) return { entry: entries[index], entries, index, isNote: entries === doc.backlog.notes };
  }
  throw missing('This item is not in the backlog.');
}
function addJournal(plan, value, actor, now) {
  if (plan.journal.length >= 2000) throw invalid('The journal already holds 2,000 entries.');
  plan.journal.push({ id: newId('journal'), at: now, text: text(value, 'Journal entry', 16000), ...actor });
}
function planColor(value) {
  if (value === undefined || value === null || value === '' || value === 'transparent') return undefined;
  if (!PLAN_COLORS.has(value)) throw invalid('Plan color is invalid.');
  return value;
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------
export function whoOf(actor = {}) {
  const result = { by: actor.by ?? 'user' };
  for (const key of ['sessionId', 'rootSessionId']) if (actor[key] !== undefined) result[key] = actor[key];
  if (actor.name !== undefined) result.name = actor.name;
  return result;
}

function apply(doc, input, actor, now) {
  const needsPlan =
    (input.action.startsWith('plan.') && input.action !== 'plan.create') ||
    input.action.startsWith('step.') ||
    input.action === 'journal.add';
  const plan = needsPlan ? findPlan(doc, input.planId) : null;
  if (plan?.archived && !['plan.delete', 'plan.archive', 'plan.unarchive'].includes(input.action))
    throw fail(400, 'roadmap_archived', 'This plan is archived. Restore it before changing it.');
  if (plan) plan.updatedAt = now;
  switch (input.action) {
    case 'init':
      break;
    case 'vision':
      doc.overview.vision = text(input.text, 'Vision', 20000, true);
      break;
    case 'milestone.create':
      doc.overview.milestones.push({
        id: newId('milestone'),
        title: text(input.title, 'Title', 300),
        summary: text(input.summary, 'Summary', 16000, true),
        status: oneOf(input.status ?? 'planned', MILESTONE_STATUSES),
      });
      break;
    case 'milestone.patch': {
      const milestone = findMilestone(doc, input.milestoneId);
      if (own(input, 'title')) milestone.title = text(input.title, 'Title', 300);
      if (own(input, 'summary')) milestone.summary = text(input.summary, 'Summary', 16000, true);
      if (own(input, 'status')) milestone.status = oneOf(input.status, MILESTONE_STATUSES);
      break;
    }
    case 'milestone.delete': {
      const milestone = findMilestone(doc, input.milestoneId);
      doc.overview.milestones = doc.overview.milestones.filter((entry) => entry !== milestone);
      for (const entry of doc.plans)
        if (entry.milestone === milestone.id) {
          entry.milestone = null;
          entry.updatedAt = now;
        }
      break;
    }
    case 'milestone.move':
      moveInList(
        doc.overview.milestones,
        findMilestone(doc, input.milestoneId),
        findMilestone(doc, input.targetId),
        input.position,
      );
      break;
    case 'plan.create': {
      const planId = newId('plan');
      const title = text(input.title, 'Title', 300);
      const slugBase =
        title
          .normalize('NFKD')
          .replace(/[\u0300-\u036f]/g, '')
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-|-$/g, '')
          .slice(0, 70) || 'plan';
      const color = planColor(input.color);
      const created = {
        id: planId,
        slug: `${slugBase}-${planId.slice(-8)}`,
        title,
        summary: text(input.summary, 'Summary', 16000, true),
        status: oneOf(input.status ?? 'active', PLAN_STATUSES),
        milestone: input.milestone == null ? null : findMilestone(doc, input.milestone).id,
        ...(color ? { color } : {}),
        sessions: [...new Set(list(input.sessions ?? [], 'Conversations', 500).map((v) => identifier(v, 'Session')))],
        steps: normalizeSteps(input.steps ?? [], { creating: true }),
        journal: [],
        createdAt: now,
        updatedAt: now,
        archived: false,
        archivedAt: null,
      };
      doc.plans.push(created);
      return { createdPlan: created };
    }
    case 'plan.patch': {
      if (own(input, 'title')) plan.title = text(input.title, 'Title', 300);
      if (own(input, 'summary')) plan.summary = text(input.summary, 'Summary', 16000, true);
      if (own(input, 'status')) {
        const value = oneOf(input.status, PLAN_STATUSES);
        if (plan.status !== value) addJournal(plan, `Status: ${plan.status} -> ${value}`, actor, now);
        plan.status = value;
      }
      if (own(input, 'milestone')) plan.milestone = input.milestone === null ? null : findMilestone(doc, input.milestone).id;
      if (own(input, 'color')) {
        const color = planColor(input.color);
        if (color) plan.color = color;
        else delete plan.color;
      }
      break;
    }
    case 'plan.attach': {
      const sessionId = identifier(input.sessionId, 'Session');
      if (!plan.sessions.includes(sessionId)) plan.sessions.push(sessionId);
      break;
    }
    case 'plan.delete':
      doc.plans = doc.plans.filter((entry) => entry !== plan);
      break;
    case 'plan.archive':
      plan.archived = true;
      plan.archivedAt = now;
      break;
    case 'plan.unarchive':
      plan.archived = false;
      plan.archivedAt = null;
      break;
    case 'plan.steps':
      plan.steps = normalizeSteps(input.steps, { old: plan.steps });
      break;
    case 'step.add': {
      const parent = input.parentId == null ? null : findStep(plan, input.parentId);
      if (parent?.depth >= 3) throw invalid('The checklist is limited to three levels.');
      const entries = parent ? parent.step.children : plan.steps;
      let index = entries.length;
      if (input.afterId != null) {
        const after = findStep(plan, input.afterId);
        if (after.siblings !== entries) throw invalid('The previous step must belong to the same group.');
        index = after.index + 1;
      }
      entries.splice(index, 0, {
        id: newId('step'),
        text: text(input.text, 'Step text'),
        note: text(input.note, 'Note', 16000, true),
        done: false,
        completion: null,
        children: [],
      });
      break;
    }
    case 'step.edit': {
      const { step } = findStep(plan, input.stepId);
      if (own(input, 'text')) step.text = text(input.text, 'Step text');
      if (own(input, 'note')) step.note = text(input.note, 'Note', 16000, true);
      break;
    }
    case 'step.check': {
      if (own(input, 'stepId') && own(input, 'stepIds')) throw invalid('Choose one step or a list of steps.');
      const ids = own(input, 'stepIds') ? list(input.stepIds, 'Steps to check') : [input.stepId];
      if (!ids.length || (ids.length !== 1 && own(input, 'note'))) throw invalid('A step note targets one step only.');
      const selected = [...new Set(ids)].map((id) => findStep(plan, id).step);
      const done = boolean(input.done);
      for (const one of selected) for (const { step } of collectSteps([one]).values()) step.done = done;
      if (own(input, 'note')) selected[0].note = text(input.note, 'Note', 16000, true);
      if (input.comment !== undefined && input.comment !== '') addJournal(plan, input.comment, actor, now);
      break;
    }
    case 'step.remove': {
      const found = findStep(plan, input.stepId);
      found.siblings.splice(found.index, 1);
      break;
    }
    case 'step.move':
      moveStep(plan, input);
      break;
    case 'journal.add':
      addJournal(plan, input.text, actor, now);
      break;
    case 'work.attach': {
      const sessionId = identifier(input.sessionId, 'Session');
      const plans = list(input.planIds ?? [], 'Plans', 200).map((id) => findPlan(doc, id));
      const entries = list(input.backlogNumbers ?? [], 'Backlog items').map((n) => findBacklog(doc, n).entry);
      for (const entry of [...plans, ...entries]) {
        entry.sessions ??= [];
        if (!entry.sessions.includes(sessionId)) entry.sessions.push(sessionId);
      }
      for (const linked of plans) linked.updatedAt = now;
      break;
    }
    case 'backlog.add': {
      const items = list(input.items ?? [], 'Backlog items');
      const notes = list(input.notes ?? [], 'Backlog notes');
      if (!items.length && !notes.length) throw invalid('Add at least one backlog item.');
      for (const [entries, isNote] of [
        [items, false],
        [notes, true],
      ])
        for (const entry of entries) {
          if (!isObject(entry)) throw invalid();
          doc.backlog[isNote ? 'notes' : 'items'].push({
            number: doc.backlog.nextNumber++,
            text: text(entry.text, 'Text'),
            note: text(entry.note, 'Note', 16000, true),
            ...(isNote ? {} : { done: false }),
            addedAt: now,
            id: newId('backlog'),
            updatedAt: now,
            ...actor,
            sessions: [],
          });
        }
      break;
    }
    case 'backlog.edit': {
      const { entry } = findBacklog(doc, input.number);
      if (own(input, 'text')) entry.text = text(input.text, 'Text');
      if (own(input, 'note')) entry.note = text(input.note, 'Note', 16000, true);
      entry.updatedAt = now;
      break;
    }
    case 'backlog.set': {
      const numbers = list(input.numbers, 'Backlog items');
      if (!numbers.length) throw invalid('Select at least one item.');
      const done = boolean(input.done);
      const entries = numbers.map((n) => findBacklog(doc, n));
      if (entries.some((e) => e.isNote)) throw invalid('A note has no checkbox.');
      for (const { entry } of entries) {
        entry.done = done;
        entry.updatedAt = now;
      }
      break;
    }
    case 'backlog.remove': {
      const numbers = new Set(list(input.numbers, 'Backlog items'));
      if (!numbers.size) throw invalid('Select at least one item.');
      for (const n of numbers) findBacklog(doc, n);
      doc.backlog.items = doc.backlog.items.filter((e) => !numbers.has(e.number));
      doc.backlog.notes = doc.backlog.notes.filter((e) => !numbers.has(e.number));
      break;
    }
    case 'backlog.move': {
      const source = findBacklog(doc, input.number);
      const target = findBacklog(doc, input.targetNumber);
      if (source.entries !== target.entries) throw invalid('Convert this item before moving it to another group.');
      moveInList(source.entries, source.entry, target.entry, input.position);
      break;
    }
    case 'backlog.convert': {
      if (!['item', 'note'].includes(input.kind)) throw invalid('Backlog kind is invalid.');
      const source = findBacklog(doc, input.number);
      if (source.isNote === (input.kind === 'note')) break;
      source.entries.splice(source.index, 1);
      if (input.kind === 'note') delete source.entry.done;
      else source.entry.done = false;
      source.entry.updatedAt = now;
      doc.backlog[input.kind === 'note' ? 'notes' : 'items'].push(source.entry);
      break;
    }
    default:
      throw invalid('Unknown Roadmap action.');
  }
  return {};
}

/**
 * Apply one closed mutation. Returns the new document (or the same one for a redundant init).
 * actor: { by, sessionId?, rootSessionId?, name? }. machineId stamps step completions.
 */
export function mutateDoc(doc, input, { actor = { by: 'user' }, machineId, now = Date.now() } = {}) {
  if (input.action === 'init' && doc.revision > 0) return { doc, changed: false };
  integer(input.expectedRevision, 'Expected revision');
  if (!doc.revision && input.action !== 'init')
    throw fail(409, 'roadmap_uninitialized', 'Initialize the Roadmap before changing it.');
  if (input.expectedRevision !== doc.revision)
    throw fail(409, 'roadmap_conflict', 'The Roadmap changed since you read it. Refresh it before applying your change.', {
      currentRevision: doc.revision,
    });
  const next = clone(doc);
  const target = next.plans.find((p) => p.id === input.planId || p.slug === input.planId);
  const trackSteps = ['plan.steps', 'step.check', 'step.add', 'step.remove', 'step.move'].includes(input.action);
  const snapshot = trackSteps && target ? clone(target.steps) : null;
  const result = apply(next, input, whoOf(actor), now);
  const stamp = { machineId, sessionId: actor.sessionId ?? null, completedAt: now };
  if (input.action === 'plan.create' && result.createdPlan) reconcile(result.createdPlan, [], { allowStamp: true, stamp });
  else if (snapshot && target) {
    const after = next.plans.find((p) => p.id === target.id);
    if (after) reconcile(after, snapshot, { allowStamp: ['plan.steps', 'step.check'].includes(input.action), stamp });
  }
  for (const plan of next.plans) syncParents(plan.steps);
  next.revision += 1;
  next.lastEdit = { ...whoOf(actor), at: now };
  return { doc: next, changed: true };
}


/** One mutation that checks many targets at once (agent end of run): a single revision bump. */
export function checkTargets(doc, { jobs = [], backlogNumbers = [], actor, machineId, now = Date.now() }) {
  const next = clone(doc);
  const stamp = { machineId, sessionId: actor.sessionId ?? null, completedAt: now };
  let changed = false;
  for (const job of jobs) {
    const plan = next.plans.find((p) => p.id === job.planId);
    if (!plan || plan.archived) continue;
    const snapshot = clone(plan.steps);
    const ids = job.stepIds ?? plan.steps.map((s) => s.id);
    for (const id of ids) {
      const found = collectSteps(plan.steps).get(id);
      if (found) for (const { step } of collectSteps([found.step]).values()) step.done = true;
    }
    reconcile(plan, snapshot, { allowStamp: true, stamp });
    syncParents(plan.steps);
    plan.updatedAt = now;
    changed = true;
  }
  for (const number of backlogNumbers) {
    const found = [...next.backlog.items].find((e) => e.number === number);
    if (found) {
      found.done = true;
      found.updatedAt = now;
      changed = true;
    }
  }
  if (!changed) return { doc, changed: false };
  next.revision += 1;
  next.lastEdit = { ...whoOf(actor), at: now };
  return { doc: next, changed: true };
}

// ---------------------------------------------------------------------------
// Merge (simulated R2 bucket)
// ---------------------------------------------------------------------------
const timeOf = (value) => (Number.isSafeInteger(value) ? value : 0);
const docTime = (doc) => timeOf(doc?.lastEdit?.at);
function newest(a, b, ta, tb) {
  if (ta !== tb) return ta > tb ? a : b;
  return canonicalJson(b) >= canonicalJson(a) ? b : a;
}
export function contentOf(doc) {
  return { overview: doc.overview, plans: doc.plans, backlog: doc.backlog, pastudioImports: doc.pastudioImports ?? [] };
}
export const contentHash = (doc) => createHash('sha256').update(canonicalJson(contentOf(doc))).digest('hex');

/** Two-way merge of the local copy and the bucket copy. Same result whichever side is "local". */
export function mergeDocs(a, b) {
  const ta = docTime(a);
  const tb = docTime(b);
  const vision =
    a.overview.vision === b.overview.vision ? a.overview.vision : newest(a.overview.vision, b.overview.vision, ta, tb);
  const byId = (xa, xb, stamp) => {
    const mapB = new Map(xb.map((e) => [e.id, e]));
    const out = [];
    for (const e of xb) {
      const other = xa.find((x) => x.id === e.id);
      out.push(clone(other ? newest(other, e, stamp(other, ta), stamp(e, tb)) : e));
    }
    for (const e of xa) if (!mapB.has(e.id)) out.push(clone(e));
    return out;
  };
  const milestones = byId(a.overview.milestones, b.overview.milestones, (_, t) => t);
  const plans = byId(a.plans, b.plans, (p) => timeOf(p.updatedAt)).sort(
    (x, y) => (x.createdAt || 0) - (y.createdAt || 0) || String(x.id).localeCompare(String(y.id)),
  );
  // Backlog: by stable id, newest updatedAt/addedAt wins; number collisions renumber the later entry.
  const entryTime = (e) => timeOf(e.updatedAt ?? e.addedAt);
  const all = new Map();
  for (const [doc, kindOf] of [
    [b, 'bucket'],
    [a, 'local'],
  ]) {
    void kindOf;
    for (const [list_, kind] of [
      [doc.backlog.items, 'item'],
      [doc.backlog.notes, 'note'],
    ])
      for (const entry of list_) {
        const key = entry.id ?? `n${entry.number}:${entry.addedAt}`;
        const known = all.get(key);
        if (!known) all.set(key, { entry: clone(entry), kind });
        else if (canonicalJson(known.entry) !== canonicalJson(entry) || known.kind !== kind) {
          const win = newest(known, { entry, kind }, entryTime(known.entry), entryTime(entry));
          all.set(key, { entry: clone(win.entry), kind: win.kind });
        }
      }
  }
  const merged = [...all.values()].sort(
    (x, y) => x.entry.number - y.entry.number || (x.entry.addedAt || 0) - (y.entry.addedAt || 0) || String(x.entry.id).localeCompare(String(y.entry.id)),
  );
  let nextNumber = Math.max(a.backlog.nextNumber, b.backlog.nextNumber, 1);
  const used = new Set();
  for (const m of merged) {
    if (used.has(m.entry.number)) m.entry.number = nextNumber++;
    used.add(m.entry.number);
  }
  nextNumber = Math.max(nextNumber, ...merged.map((m) => m.entry.number + 1));
  const imports = [];
  const digests = new Set();
  for (const entry of [...(b.pastudioImports ?? []), ...(a.pastudioImports ?? [])])
    if (!digests.has(entry.payloadDigest)) {
      digests.add(entry.payloadDigest);
      imports.push(clone(entry));
    }
  const byNumber = (x, y) => x.number - y.number;
  return {
    schemaVersion: 1,
    revision: Math.max(a.revision, b.revision),
    lastEdit: clone(newest(a.lastEdit, b.lastEdit, ta, tb)),
    overview: { vision, milestones },
    plans,
    backlog: {
      items: merged.filter((m) => m.kind === 'item').map((m) => m.entry).sort(byNumber),
      notes: merged.filter((m) => m.kind === 'note').map((m) => m.entry).sort(byNumber),
      nextNumber,
    },
    pastudioImports: imports,
  };
}

/** Count the elements of `merged` that differ from `copy` (plans, milestones, backlog entries, vision). */
export function diffCount(copy, merged) {
  let count = copy.overview.vision === merged.overview.vision ? 0 : 1;
  const compare = (xs, ys, key) => {
    const mapX = new Map(xs.map((e) => [e[key], canonicalJson(e)]));
    const mapY = new Map(ys.map((e) => [e[key], canonicalJson(e)]));
    for (const [k, v] of mapY) if (mapX.get(k) !== v) count++;
    for (const k of mapX.keys()) if (!mapY.has(k)) count++;
  };
  compare(copy.overview.milestones, merged.overview.milestones, 'id');
  compare(copy.plans, merged.plans, 'id');
  compare([...copy.backlog.items, ...copy.backlog.notes], [...merged.backlog.items, ...merged.backlog.notes], 'id');
  return count;
}
