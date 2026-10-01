/**
 * One search across everything a person can reach: tickets, the people they
 * work with, departments, units, files, and what was said on the tickets.
 *
 * What "reach" means goes by level, and every section follows it:
 *
 *   - the super admin and admins: everything;
 *   - a head: the tickets of the departments they run - those sent to them
 *     and those their department raised elsewhere - and their own;
 *   - everyone else: their own tickets only - the ones they raised, the ones
 *     assigned to them, and the ones somebody has asked them to take.
 *
 * Narrower than what a department member may open by link, on purpose: a
 * search box puts a whole department's work one word away, so it answers
 * only for what is the reader's own to follow.
 */
import Department from '../models/Department.js';
import HandoverRequest from '../models/HandoverRequest.js';
import Message from '../models/Message.js';
import Ticket, { CLOSED_STATUSES, NOT_LATE_STATUSES, RESOLVED } from '../models/Ticket.js';
import Unit from '../models/Unit.js';
import User, { MANAGER_ROLES } from '../models/User.js';
import { headedDepartmentIds } from '../services/ticketAccess.js';
import { createDownloadUrl } from '../services/storage.js';
import { pastDue, startOfToday, statusOf } from '../services/overdue.js';

/** What the search box may ask for, and what each answers with. */
const TYPES = ['tickets', 'people', 'departments', 'units', 'messages', 'files'];

/** Per section when everything is asked for at once; the whole page when one is. */
const PREVIEW_LIMIT = 6;
const FULL_LIMIT = 30;

/** Long enough for any real query, short enough that a pasted essay is not a regex. */
const MAX_WORDS = 6;
const MAX_WORD = 60;

const STATUS_WORDS = {
  new: 'New',
  'not-started': 'New',
  progress: 'In Progress',
  'in-progress': 'In Progress',
  approval: RESOLVED,
  resolved: RESOLVED,
  completed: 'Completed',
  done: 'Completed',
  cancelled: 'Cancelled',
  canceled: 'Cancelled',
};

const PRIORITY_WORDS = { low: 'Low', medium: 'Medium', high: 'High', critical: 'Critical' };

const isManager = (user) => MANAGER_ROLES.includes(user.role);

/**
 * How long any one query may run. A search is asked again with every few
 * letters typed, so one that would take seconds is worth less than a quick
 * partial answer: past this the database stops and that part comes back
 * empty, rather than holding up the rest.
 */
const BUDGET_MS = 1500;

/**
 * How long a newest-first scan is still waited for once the text index has
 * answered. A word that is everywhere fills the scan's page in a moment; one
 * that is rare would keep it reading the whole collection - and the index has
 * found those already.
 */
const GRACE_MS = 40;

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * How long a newest-first scan may read when an index can answer the words
 * too. Plenty to fill a page with a word that is everywhere; for a rare one it
 * stops the scan early - the index has those - rather than leaving it to read
 * the whole collection in the background after the answer has gone. Only a
 * scan nothing else can answer for (a half-typed word, or one under three
 * letters) gets the full budget; on a large collection a rare half-typed word
 * then simply shows its results once the word is finished.
 */
const GLANCE_MS = 150;

/**
 * A newest-first scan, waited for in full only when the index found nothing
 * (the word is half typed, or too short for it) - otherwise for as long as
 * the grace allows, and whatever it has not found by then is left out.
 */
const settle = (scan, indexFound) =>
  indexFound ? Promise.race([scan, pause(GRACE_MS).then(() => [])]) : scan;

/** How many lines of conversation are looked at to find the tickets they are on. */
const CONVERSATION_SCAN = 200;

/** Everything a ticket row and its preview show. */
const TICKET_FIELDS =
  'number subject description status priority requestType project department departments raisedBy assignees deadline committedDeadline attachments messageCount lastMessageAt escalationStatus createdAt updatedAt';

/* ------------------------------------------------------------------ indexes */

let indexed = null;

/**
 * The indexes search leans on, asked for once - the first time anybody
 * searches - and never waited for.
 *
 * Asked for here rather than declared on the models: the tickets' indexes
 * belong to the Prisma schema, which has no word for a text index, and asking
 * on first use keeps search out of every other startup path. Each is named,
 * so asking again changes nothing. Until they exist - or if one cannot be
 * made - every query below still answers, by scanning instead; only slower.
 */
function ensureSearchIndexes() {
  indexed ??= Promise.allSettled([
    // Whole words anywhere in a ticket, the subject counting most.
    Ticket.collection.createIndex(
      { subject: 'text', description: 'text', requestType: 'text', project: 'text', 'attachments.filename': 'text' },
      {
        name: 'search_text',
        weights: { subject: 10, requestType: 4, project: 4, 'attachments.filename': 3, description: 1 },
      },
    ),
    // Newest first with no other filter - a manager's view of everything.
    Ticket.collection.createIndex({ updatedAt: -1 }, { name: 'search_recent' }),
    // Whole words in what was said, and what was said most recently.
    Message.collection.createIndex({ body: 'text' }, { name: 'search_body' }),
    Message.collection.createIndex({ createdAt: -1 }, { name: 'search_recent' }),
  ]).then((results) => {
    for (const result of results) {
      if (result.status === 'rejected') console.warn('Search index not created:', result.reason?.message);
    }
  });
  return indexed;
}

/** A part of the answer that failed or ran out of time comes back empty, not as an error. */
async function quietly(promise, fallback) {
  try {
    return await promise;
  } catch (error) {
    if (error?.code !== 50) console.warn('Search query failed:', error?.message);
    return fallback;
  }
}

/** The words a text index can answer for: three letters or more, and not a ticket number. */
function indexedWords(words) {
  return words.filter((word) => word.length >= 3 && numberIn(word) === null);
}

/**
 * Asks the text index for every word, and - if that finds nothing - again
 * without the last one, which may still be being typed ("lapt" is not a word
 * yet). What comes back is then checked against every word as typed.
 */
async function textLook(indexed, run) {
  if (indexed.length === 0) return [];
  const all = await run(textQuery(indexed));
  if (all.length > 0 || indexed.length < 2) return all;
  return run(textQuery(indexed.slice(0, -1)));
}

/** Each word quoted, so a text search needs every one of them rather than any. */
const textQuery = (words) => words.map((word) => `"${word.replace(/"/g, '')}"`).join(' ');

/**
 * The tickets this reader's search may find, as a filter - or `{}` for a
 * manager, who may find them all. See the top of this file for the levels.
 */
async function reachOf(user) {
  if (isManager(user)) return {};

  const me = user._id;
  const headed = headedDepartmentIds(user);
  // Handed over to them and waiting for their answer: theirs to look at.
  const asked = await HandoverRequest.find({ to: me, status: 'pending' }).distinct('ticket');

  const either = [{ raisedBy: me }, { assignees: me }];
  if (asked.length > 0) either.push({ _id: { $in: asked } });
  if (headed.length > 0) {
    either.push(
      { departments: { $in: headed } },
      { department: { $in: headed } },
      // What their own people asked of other departments.
      { fromDepartments: { $in: headed } },
    );
  }
  return { $or: either };
}

/**
 * What one request knows about its reader, worked out once and shared by
 * every section: how far their search reaches, which tickets that is, and
 * what was said on them.
 */
function readerOf(req) {
  const manager = isManager(req.user);
  let reach = null;
  let readable = null;
  return {
    manager,
    /** The ticket filter for this reader's level. */
    reach() {
      reach ??= reachOf(req.user);
      return reach;
    },
    /** The tickets in reach, as ids - or null for a manager, whose reach is everything. */
    async readableIds() {
      if (manager) return null;
      readable ??= this.reach().then((filter) => Ticket.find(filter).distinct('_id'));
      return readable;
    },
    conversations: null,
  };
}

const escape = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Every word of the search, each a case-blind pattern. */
function wordsOf(raw) {
  return String(raw ?? '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, MAX_WORDS)
    .map((word) => word.slice(0, MAX_WORD));
}

const patternOf = (word) => new RegExp(escape(word), 'i');

/** A comma list from the query string, lower-cased and de-duplicated. */
function listOf(value) {
  return [
    ...new Set(
      String(value ?? '')
        .split(',')
        .map((item) => item.trim().toLowerCase())
        .filter(Boolean),
    ),
  ];
}

/** Every word somewhere in one of these fields. */
function everyWordIn(words, fields) {
  return words.map((word) => {
    const pattern = patternOf(word);
    return { $or: fields.map((field) => ({ [field]: pattern })) };
  });
}

/** The sentence around the first match, so a result can say why it matched. */
function snippetOf(text, words, size = 140) {
  const value = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (!value) return '';
  const lower = value.toLowerCase();
  const at = words.reduce((found, word) => {
    const index = lower.indexOf(word.toLowerCase());
    return index >= 0 && (found < 0 || index < found) ? index : found;
  }, -1);
  if (at < 0 || value.length <= size) return value.slice(0, size);
  const start = Math.max(0, at - Math.floor(size / 3));
  return `${start > 0 ? '…' : ''}${value.slice(start, start + size).trim()}${start + size < value.length ? '…' : ''}`;
}

const idOf = (value) => String(value?._id ?? value ?? '');

/** The ticket number a word is, if it is one: "21", "#21", "TK-21", "tk0021". */
function numberIn(word) {
  const match = /^(?:#|tk-?)?0*(\d{1,6})$/i.exec(word);
  return match ? Number(match[1]) : null;
}

/** Users whose name matches, as ids - for "from:" and "to:". */
async function peopleNamed(text) {
  const words = wordsOf(text);
  if (words.length === 0) return null;
  const users = await User.find({ $and: everyWordIn(words, ['name', 'email']) })
    .select('_id')
    .limit(50)
    .lean();
  return users.map((user) => user._id);
}

/** Departments whose name matches, as ids - for "dept:". */
async function departmentsNamed(text) {
  const words = wordsOf(text);
  if (words.length === 0) return null;
  const departments = await Department.find({ $and: everyWordIn(words, ['name', 'code']) })
    .select('_id')
    .limit(50)
    .lean();
  return departments.map((department) => department._id);
}

/**
 * The ticket conditions the filters ask for, on top of who may read them.
 *
 * Each is a plain clause so they combine with $and: a status of "Overdue" is
 * a date question rather than a stored value, and "open" is everything not
 * finished.
 */
async function ticketConditions(req, reader) {
  const me = req.user._id;
  const and = [await reader.reach()];

  const statuses = listOf(req.query.status);
  if (statuses.length > 0) {
    const either = [];
    const stored = statuses.map((item) => STATUS_WORDS[item]).filter(Boolean);
    if (stored.length > 0) either.push({ status: { $in: stored } });
    if (statuses.includes('overdue') || statuses.includes('late')) {
      either.push({ $and: [{ status: { $nin: NOT_LATE_STATUSES } }, pastDue(true)] });
    }
    if (statuses.includes('open')) either.push({ status: { $nin: CLOSED_STATUSES } });
    // A status nobody recognises matches nothing, rather than everything.
    and.push(either.length > 0 ? { $or: either } : { _id: null });
  }

  const priorities = listOf(req.query.priority)
    .flatMap((item) => (item === 'urgent' ? ['High', 'Critical'] : [PRIORITY_WORDS[item]]))
    .filter(Boolean);
  if (listOf(req.query.priority).length > 0) {
    and.push(priorities.length > 0 ? { priority: { $in: priorities } } : { _id: null });
  }

  // A name that matches nobody matches no tickets; an empty one asks nothing.
  const departmentIds = await departmentsNamed(req.query.dept);
  if (departmentIds) {
    and.push({ $or: [{ departments: { $in: departmentIds } }, { department: { $in: departmentIds } }] });
  }
  const raisers = await peopleNamed(req.query.from);
  if (raisers) and.push({ raisedBy: { $in: raisers } });
  const holders = await peopleNamed(req.query.to);
  if (holders) and.push({ assignees: { $in: holders } });

  for (const flag of listOf(req.query.is)) {
    if (flag === 'mine') and.push({ raisedBy: me });
    else if (flag === 'assigned') and.push({ assignees: me });
    else if (flag === 'unassigned') {
      and.push({ assignees: { $size: 0 }, status: { $nin: [...CLOSED_STATUSES, RESOLVED] } });
    } else if (flag === 'overdue') {
      and.push({ status: { $nin: NOT_LATE_STATUSES } }, pastDue(true));
    } else if (flag === 'today') {
      const from = startOfToday();
      const to = new Date(from.getTime() + 24 * 60 * 60 * 1000);
      and.push({
        status: { $nin: NOT_LATE_STATUSES },
        $expr: {
          $and: [
            { $gte: [{ $ifNull: ['$committedDeadline', '$deadline'] }, from] },
            { $lt: [{ $ifNull: ['$committedDeadline', '$deadline'] }, to] },
          ],
        },
      });
    } else if (flag === 'approval') and.push({ status: RESOLVED });
    else if (flag === 'escalated') and.push({ escalationStatus: 'open' });
    else if (flag === 'urgent') {
      and.push({ priority: { $in: ['High', 'Critical'] }, status: { $nin: [...CLOSED_STATUSES, RESOLVED] } });
    } else if (flag === 'shared') and.push({ 'departments.1': { $exists: true } });
    else and.push({ _id: null });
  }

  for (const kind of listOf(req.query.has)) {
    if (kind === 'files' || kind === 'attachments') and.push({ 'attachments.0': { $exists: true } });
    else if (kind === 'replies' || kind === 'chat') and.push({ messageCount: { $gt: 0 } });
    else if (kind === 'date' || kind === 'deadline') {
      and.push({ $or: [{ deadline: { $ne: null } }, { committedDeadline: { $ne: null } }] });
    } else and.push({ _id: null });
  }

  return and;
}

/** Whether a ticket filter was asked for at all, beyond the words. */
const hasTicketFilters = (query) =>
  ['status', 'priority', 'dept', 'from', 'to', 'is', 'has'].some((key) => query[key]);

/** A ticket as a result row: enough to show it and preview it, not the whole record. */
function presentTicket(ticket, words, conversation) {
  const departments = (ticket.departments ?? []).length > 0 ? ticket.departments : [ticket.department];

  // Why it matched, when the subject alone does not say.
  const subjectHit = words.length === 0 || words.every((word) => patternOf(word).test(ticket.subject));
  let match = null;
  if (!subjectHit) {
    const file = (ticket.attachments ?? []).find((item) =>
      words.some((word) => patternOf(word).test(item.filename ?? '')),
    );
    if (conversation) match = { field: 'conversation', text: conversation };
    else if (words.some((word) => patternOf(word).test(ticket.description ?? ''))) {
      match = { field: 'description', text: snippetOf(ticket.description, words) };
    } else if (file) match = { field: 'attachment', text: file.filename };
  }

  return {
    id: idOf(ticket),
    number: ticket.number,
    subject: ticket.subject,
    status: statusOf(ticket),
    priority: ticket.priority,
    requestType: ticket.requestType ?? '',
    description: snippetOf(ticket.description, words, 220),
    departments: departments.filter(Boolean).map((department) => ({
      id: idOf(department),
      name: department.name ?? '',
      unit: department.unit?.name ?? '',
    })),
    raisedBy: { id: idOf(ticket.raisedBy), name: ticket.raisedBy?.name ?? '' },
    assignees: (ticket.assignees ?? []).map((person) => ({ id: idOf(person), name: person?.name ?? '' })),
    deadline: ticket.committedDeadline ?? ticket.deadline ?? null,
    attachmentCount: (ticket.attachments ?? []).length,
    messageCount: ticket.messageCount ?? 0,
    lastMessageAt: ticket.lastMessageAt ?? null,
    escalated: ticket.escalationStatus === 'open',
    createdAt: ticket.createdAt,
    updatedAt: ticket.updatedAt,
    match,
  };
}

/**
 * How well a ticket answers the words, best first: its own number, then a
 * subject that starts with what was typed, then one that holds it, then
 * anything that matched somewhere else.
 */
function ticketRank(ticket, words, numbers) {
  const subject = String(ticket.subject ?? '').toLowerCase();
  const seq = Number(String(ticket.number ?? '').replace(/\D/g, ''));
  if (numbers.includes(seq)) return 0;
  const phrase = words.join(' ').toLowerCase();
  if (phrase && subject.startsWith(phrase)) return 1;
  if (phrase && subject.includes(phrase)) return 2;
  if (words.every((word) => subject.includes(word.toLowerCase()))) return 3;
  return 4;
}

/** "TK-0021" and "TK-21" for 21: a ticket number as it is stored, for the unique index. */
const numberForms = (numbers) => [
  ...new Set(numbers.flatMap((number) => [`TK-${String(number).padStart(4, '0')}`, `TK-${number}`])),
];

/** Every word, as typed, somewhere in these strings. */
const holdsEvery = (words, ...parts) => {
  const text = parts.filter(Boolean).join(' ');
  return words.every((word) => patternOf(word).test(text));
};

/**
 * Lines of conversation holding every word, newest first, on tickets the
 * reader may open - asked once per request, for the tickets section and the
 * conversations section both.
 *
 * Two looks at once: newest first, reading until enough match - instant for
 * a word that is everywhere - and the text index - instant for one that is
 * rare. The first is only waited out when the second has nothing. Words are
 * checked as typed, so "need" still finds "needed" but "needed" does not find
 * "needs".
 */
function conversationMatches(req, words, reader) {
  reader.conversations ??= (async () => {
    if (words.length === 0) return [];
    const readable = await reader.readableIds();
    const scope = {
      kind: 'text',
      ...(reader.manager ? {} : { deletedAt: null, ticket: { $in: readable } }),
    };
    const fields = 'ticket author authorName body createdAt';
    const indexed = indexedWords(words);
    // A number has no index to fall back on here: a glance, then what the ticket search finds.
    const answerable = indexed.length > 0 || words.every((word) => numberIn(word) !== null);

    const scan = quietly(
      Message.find({ ...scope, $and: words.map((word) => ({ body: patternOf(word) })) })
        .sort({ createdAt: -1 })
        .limit(CONVERSATION_SCAN)
        .select(fields)
        .maxTimeMS(answerable ? GLANCE_MS : BUDGET_MS)
        .lean(),
      [],
    );
    const matched = (
      await textLook(indexed, (search) =>
        quietly(
          Message.find({ ...scope, $text: { $search: search } })
            .limit(CONVERSATION_SCAN)
            .select(fields)
            .maxTimeMS(BUDGET_MS)
            .lean(),
          [],
        ),
      )
    ).filter((message) => holdsEvery(words, message.body));
    const newest = await settle(scan, matched.length > 0);

    const byId = new Map();
    for (const message of [...newest, ...matched]) if (!byId.has(idOf(message))) byId.set(idOf(message), message);
    return [...byId.values()]
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .slice(0, CONVERSATION_SCAN);
  })().catch(() => []);
  return reader.conversations;
}

/** Everything on a ticket besides its subject that a word can be found in. */
const ELSEWHERE = ['description', 'requestType', 'project', 'attachments.filename'];

/** What a candidate needs, to be checked and ranked before it is fetched in full. */
const CANDIDATE_FIELDS = '_id number subject description requestType project attachments.filename updatedAt';

/**
 * Tickets that answer the words, best first.
 *
 * Asked as a few small questions at once rather than one large one: the
 * ticket with that number (the unique index), every whole word anywhere on it
 * (the text index), and newest-first scans of the subject and the rest - the
 * scans waited out only when the index had nothing, which is a word still
 * being typed. Then where the words were said. Only the winners are fetched in
 * full, once, so the work is the size of the answer, not of the collection.
 * A query that is only ticket numbers asks for the ticket and its subject.
 */
async function searchTickets(req, words, limit, reader) {
  const base = await ticketConditions(req, reader);

  const full = (filter) =>
    Ticket.find(filter)
      .select(TICKET_FIELDS)
      .populate({ path: 'department', select: 'name unit', populate: { path: 'unit', select: 'name' } })
      .populate({ path: 'departments', select: 'name unit', populate: { path: 'unit', select: 'name' } })
      .populate('raisedBy', 'name')
      .populate('assignees', 'name')
      .maxTimeMS(BUDGET_MS)
      .lean();

  // A filter and no words: the newest that match, straight off the index.
  if (words.length === 0) {
    const found = await full({ $and: base }).sort({ updatedAt: -1 }).limit(limit + 1);
    return { items: found.slice(0, limit).map((ticket) => presentTicket(ticket, words, null)), more: found.length > limit };
  }

  const numbers = words.map(numberIn).filter((value) => value !== null);
  const numbersOnly = numbers.length === words.length;
  const indexed = indexedWords(words);
  const budget = indexed.length > 0 || numbersOnly ? GLANCE_MS : BUDGET_MS;
  const newestFirst = (filter, max) =>
    quietly(Ticket.find(filter).sort({ updatedAt: -1 }).limit(max).select(CANDIDATE_FIELDS).maxTimeMS(budget).lean(), []);

  const subjectScan = newestFirst(
    { $and: [...base, ...words.map((word) => ({ $or: [{ subject: patternOf(word) }, { number: patternOf(word) }] }))] },
    limit * 3,
  );
  const elsewhereScan = numbersOnly
    ? Promise.resolve([])
    : newestFirst({ $and: [...base, ...everyWordIn(words, ELSEWHERE)] }, limit * 2);
  const saidOn = numbersOnly ? Promise.resolve([]) : conversationMatches(req, words, reader);

  const [byNumber, matched] = await Promise.all([
    numbers.length > 0
      ? quietly(
          Ticket.find({ $and: [...base, { number: { $in: numberForms(numbers) } }] })
            .select('_id')
            .limit(10)
            .lean(),
          [],
        )
      : [],
    textLook(indexed, (search) =>
      quietly(
        Ticket.find({ $text: { $search: search }, $and: base })
          .limit(limit * 3)
          .select(CANDIDATE_FIELDS)
          .maxTimeMS(BUDGET_MS)
          .lean(),
        [],
      ),
    ).then((found) =>
      found.filter((ticket) =>
        holdsEvery(words, ticket.subject, ticket.description, ticket.requestType, ticket.project, ...(ticket.attachments ?? []).map((item) => item.filename)),
      ),
    ),
  ]);

  const indexFound = matched.length > 0 || byNumber.length > 0;
  const [bySubject, byElsewhere, said] = await Promise.all([
    settle(subjectScan, indexFound),
    settle(elsewhereScan, indexFound),
    saidOn,
  ]);

  // The first line said on each ticket is the one the row quotes.
  const quoted = new Map();
  for (const message of said) {
    const key = idOf(message.ticket);
    if (!quoted.has(key)) quoted.set(key, `${message.authorName}: ${snippetOf(message.body, words, 120)}`);
  }

  // One ranked list of ids: the number, then the subject, then the rest.
  const order = [];
  const seen = new Set();
  const add = (id) => {
    const key = idOf(id);
    if (!seen.has(key)) {
      seen.add(key);
      order.push(key);
    }
  };
  byNumber.forEach((ticket) => add(ticket._id));
  [...bySubject, ...matched.filter((ticket) => holdsEvery(words, ticket.subject, ticket.number))]
    .map((ticket) => ({ ticket, rank: ticketRank(ticket, words, numbers) }))
    .sort((a, b) => a.rank - b.rank || new Date(b.ticket.updatedAt) - new Date(a.ticket.updatedAt))
    .forEach(({ ticket }) => add(ticket._id));
  matched.forEach((ticket) => add(ticket._id));
  byElsewhere.forEach((ticket) => add(ticket._id));
  quoted.forEach((_, id) => add(id));

  // The winners in full, once - still asked through the filters, so a line of
  // conversation cannot bring in a ticket the filters leave out.
  const wanted = order.slice(0, limit + 1);
  const found = wanted.length > 0 ? await full({ _id: { $in: wanted }, $and: base }) : [];
  const byId = new Map(found.map((ticket) => [idOf(ticket), ticket]));
  const ranked = wanted.map((id) => byId.get(id)).filter(Boolean);

  return {
    items: ranked.slice(0, limit).map((ticket) => presentTicket(ticket, words, quoted.get(idOf(ticket)) ?? null)),
    more: order.length > limit,
  };
}

/**
 * People, by level. A manager finds everyone; anyone else finds the people in
 * their own departments - whom the department page already shows them - and
 * the people on the tickets in their reach. The super admin is left out for
 * everyone but themselves, as the directory does, and suspended accounts are
 * left to the admins.
 */
async function searchPeople(req, words, limit, reader) {
  const and = [];
  if (req.user.role !== 'superadmin') and.push({ role: { $ne: 'superadmin' } });
  if (!reader.manager) {
    and.push({ status: { $ne: 'suspended' } });
    const reach = await reader.reach();
    const [raisers, holders] = await Promise.all([
      Ticket.find(reach).distinct('raisedBy'),
      Ticket.find(reach).distinct('assignees'),
    ]);
    const mine = (req.user.memberships ?? []).map((membership) => membership.department);
    and.push({
      $or: [
        { _id: { $in: [req.user._id, ...raisers, ...holders] } },
        { 'memberships.department': { $in: mine } },
      ],
    });
  }
  if (words.length > 0) {
    and.push(...everyWordIn(words, ['name', 'email', 'phone', 'designation', 'memberships.designation']));
  }
  const departmentIds = await departmentsNamed(req.query.dept);
  if (departmentIds) and.push({ 'memberships.department': { $in: departmentIds } });

  const users = await User.find(and.length > 0 ? { $and: and } : {})
    .select('name email phone role status designation memberships')
    .populate({ path: 'memberships.department', select: 'name unit', populate: { path: 'unit', select: 'name' } })
    .sort({ name: 1 })
    .limit(limit * 3)
    .lean();

  const phrase = words.join(' ').toLowerCase();
  const rank = (user) => {
    const name = String(user.name ?? '').toLowerCase();
    if (phrase && name === phrase) return 0;
    if (phrase && name.startsWith(phrase)) return 1;
    if (phrase && name.includes(phrase)) return 2;
    return 3;
  };

  const sorted = users.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
  return {
    items: sorted.slice(0, limit).map((user) => ({
      id: idOf(user),
      name: user.name,
      email: user.email,
      phone: user.phone ?? '',
      role: user.role,
      status: user.status,
      designation:
        user.designation ||
        (user.memberships ?? []).map((membership) => membership.designation).find(Boolean) ||
        '',
      departments: (user.memberships ?? [])
        .filter((membership) => membership.department)
        .map((membership) => ({
          id: idOf(membership.department),
          name: membership.department.name ?? '',
          unit: membership.department.unit?.name ?? '',
          role: membership.role,
          designation: membership.designation ?? '',
        })),
    })),
    more: sorted.length > limit,
  };
}

/**
 * Departments, by level: a manager finds every one; anyone else finds the
 * departments they belong to - the same list as their own Departments page.
 */
async function searchDepartments(req, words, limit, reader) {
  const manager = reader.manager;
  const mine = new Map((req.user.memberships ?? []).map((item) => [String(item.department), item.role]));

  const and = manager ? [] : [{ _id: { $in: (req.user.memberships ?? []).map((item) => item.department) } }];
  if (words.length > 0) and.push(...everyWordIn(words, ['name', 'code', 'description']));

  const departments = await Department.find(and.length > 0 ? { $and: and } : {})
    .select('name code description unit isActive')
    .populate('unit', 'name')
    .sort({ name: 1 })
    .limit(limit * 2)
    .lean();

  const ids = departments.map((department) => department._id);
  const counts = await User.aggregate([
    { $match: { 'memberships.department': { $in: ids } } },
    { $unwind: '$memberships' },
    { $match: { 'memberships.department': { $in: ids } } },
    {
      $group: {
        _id: '$memberships.department',
        members: { $sum: 1 },
        heads: { $sum: { $cond: [{ $eq: ['$memberships.role', 'head'] }, 1, 0] } },
      },
    },
  ]);
  const countOf = new Map(counts.map((item) => [String(item._id), item]));

  const phrase = words.join(' ').toLowerCase();
  const rank = (department) => {
    const name = String(department.name ?? '').toLowerCase();
    if (phrase && name.startsWith(phrase)) return 0;
    if (mine.has(String(department._id))) return 1;
    return 2;
  };

  const sorted = departments.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
  return {
    items: sorted.slice(0, limit).map((department) => {
      const id = idOf(department);
      return {
        id,
        name: department.name,
        description: department.description ?? '',
        unit: department.unit ? { id: idOf(department.unit), name: department.unit.name } : null,
        isActive: department.isActive !== false,
        members: countOf.get(id)?.members ?? 0,
        heads: countOf.get(id)?.heads ?? 0,
        // What the reader is in it, if anything: decides whether its page opens.
        myRole: mine.get(id) ?? null,
        canOpen: manager || mine.has(id),
      };
    }),
    more: sorted.length > limit,
  };
}

/** Units are an admin's page, so only an admin finds them. */
async function searchUnits(req, words, limit) {
  if (!isManager(req.user)) return { items: [], more: false };

  const and = words.length > 0 ? everyWordIn(words, ['name', 'code', 'description']) : [];
  const units = await Unit.find(and.length > 0 ? { $and: and } : {})
    .select('name description')
    .sort({ name: 1 })
    .limit(limit + 1)
    .lean();

  const counts = await Department.aggregate([
    { $match: { unit: { $in: units.map((unit) => unit._id) } } },
    { $group: { _id: '$unit', departments: { $sum: 1 } } },
  ]);
  const countOf = new Map(counts.map((item) => [String(item._id), item.departments]));

  return {
    items: units.slice(0, limit).map((unit) => ({
      id: idOf(unit),
      name: unit.name,
      description: unit.description ?? '',
      departments: countOf.get(idOf(unit)) ?? 0,
    })),
    more: units.length > limit,
  };
}

/** What was said on the tickets the reader can open, newest first. */
async function searchMessages(req, words, limit, reader) {
  if (words.length === 0) return { items: [], more: false };

  const messages = await conversationMatches(req, words, reader);
  const shown = messages.slice(0, limit + 1);
  const tickets = await Ticket.find({ _id: { $in: shown.map((message) => message.ticket) } })
    .select('number subject status deadline committedDeadline')
    .lean();
  const ticketOf = new Map(tickets.map((ticket) => [idOf(ticket), ticket]));

  const items = shown
    .filter((message) => ticketOf.has(idOf(message.ticket)))
    .map((message) => {
      const ticket = ticketOf.get(idOf(message.ticket));
      return {
        id: idOf(message),
        body: snippetOf(message.body, words, 160),
        author: { id: idOf(message.author), name: message.authorName },
        createdAt: message.createdAt,
        ticket: { id: idOf(ticket), number: ticket.number, subject: ticket.subject, status: statusOf(ticket) },
      };
    });

  return { items: items.slice(0, limit), more: messages.length > limit };
}

/* -------------------------------------------------------------------- files */

const LINK = /\bhttps?:\/\/[^\s<>"']+/gi;
const LINK_SOURCE = /https?:\/\//i;
const trimLink = (url) => url.replace(/[.,;:!?)\]]+$/, '');

/** Which shelf a file belongs on, by what it is rather than how it was sent. */
const shelfOf = (kind, mimeType) =>
  kind === 'image' || mimeType?.startsWith('image/')
    ? 'image'
    : kind === 'video' || mimeType?.startsWith('video/')
      ? 'video'
      : 'document';

/**
 * Photos, videos, documents and links, from the tickets in reach - attached
 * when the request was raised, or sent in its conversation - newest first.
 *
 * The same shape as the Attachments page's library, so the box shows them
 * the same way; but only the tickets in this reader's reach, and only the
 * rows that will be shown are signed - however many files there are, the
 * work is the size of the answer.
 */
async function searchFiles(req, words, limit, reader) {
  const reach = await reader.reach();
  const readable = await reader.readableIds();
  const inReach = reader.manager ? {} : { ticket: { $in: readable } };
  const withdrawn = reader.manager ? {} : { deletedAt: null };
  const matches = (...parts) => words.length === 0 || holdsEvery(words, ...parts);
  const scan = limit * 3;

  // Tickets the words name - "0058", or a word of the subject - bring all their files.
  const named =
    words.length > 0
      ? await quietly(
          Ticket.find({
            $and: [reach, ...words.map((word) => ({ $or: [{ subject: patternOf(word) }, { number: patternOf(word) }] }))],
          })
            .select('_id')
            .limit(20)
            .lean(),
          [],
        )
      : [];
  const namedIds = named.map((ticket) => ticket._id);
  const byWords = (fields) => (words.length > 0 ? [{ $and: everyWordIn(words, fields) }] : []);

  const [chatFiles, chatLinks, requests] = await Promise.all([
    quietly(
      Message.find({
        ...inReach,
        ...withdrawn,
        'attachment.kind': { $in: ['image', 'video', 'file'] },
        ...(words.length > 0
          ? { $or: [...byWords(['attachment.filename', 'authorName']), { ticket: { $in: namedIds } }] }
          : {}),
      })
        .sort({ createdAt: -1 })
        .limit(scan)
        .select('ticket author authorName attachment createdAt')
        .maxTimeMS(BUDGET_MS)
        .lean(),
      [],
    ),
    quietly(
      Message.find({
        ...inReach,
        ...withdrawn,
        body: LINK_SOURCE,
        ...(words.length > 0 ? { $or: [...byWords(['body', 'authorName']), { ticket: { $in: namedIds } }] } : {}),
      })
        .sort({ createdAt: -1 })
        .limit(scan)
        .select('ticket author authorName body createdAt')
        .maxTimeMS(BUDGET_MS)
        .lean(),
      [],
    ),
    quietly(
      Ticket.find({
        $and: [
          reach,
          { $or: [{ 'attachments.0': { $exists: true } }, { description: LINK_SOURCE }] },
          ...(words.length > 0
            ? [{ $or: [...byWords(['attachments.filename', 'description']), { _id: { $in: namedIds } }] }]
            : []),
        ],
      })
        .sort({ updatedAt: -1 })
        .limit(scan)
        .select('number subject status deadline committedDeadline department departments raisedBy attachments description createdAt')
        .populate('raisedBy', 'name')
        .lean(),
      [],
    ),
  ]);

  // Every ticket a file came from, once, to name it on the row.
  const ticketIds = [...new Set([...chatFiles, ...chatLinks].map((message) => idOf(message.ticket)))];
  const fromChat = await Ticket.find({ _id: { $in: ticketIds } })
    .select('number subject status deadline committedDeadline department departments raisedBy')
    .populate('department', 'name')
    .populate('departments', 'name')
    .lean();
  const ticketOf = new Map([...fromChat, ...requests].map((ticket) => [idOf(ticket), ticket]));
  const label = (ticket) => ({
    id: idOf(ticket),
    number: ticket.number,
    subject: ticket.subject,
    status: statusOf(ticket),
    department:
      (ticket.departments ?? []).length > 1
        ? ticket.departments.map((item) => item?.name).filter(Boolean).join(', ')
        : (ticket.department?.name ?? ''),
    raisedById: idOf(ticket.raisedBy),
  });
  const namedSet = new Set(namedIds.map(String));
  const about = (ticket) => namedSet.has(idOf(ticket));

  const found = [];
  for (const message of chatFiles) {
    const ticket = ticketOf.get(idOf(message.ticket));
    const file = message.attachment;
    if (!ticket || !(about(ticket) || matches(file.filename, message.authorName))) continue;
    found.push({
      id: idOf(message),
      type: shelfOf(file.kind, file.mimeType),
      from: 'chat',
      key: file.key,
      filename: file.filename ?? '',
      mimeType: file.mimeType,
      size: file.size,
      by: { id: idOf(message.author), name: message.authorName },
      createdAt: message.createdAt,
      ticket: label(ticket),
    });
  }
  const addLinks = (text, base) => {
    const urls = [...new Set(String(text ?? '').match(LINK) ?? [])].map(trimLink);
    urls.forEach((url, index) => {
      if (!base.named && !matches(url, text, base.by.name)) return;
      found.push({ ...base.row, id: `${base.row.id}-link-${index}`, type: 'link', url, context: String(text).slice(0, 200) });
    });
  };
  for (const message of chatLinks) {
    const ticket = ticketOf.get(idOf(message.ticket));
    if (!ticket) continue;
    const by = { id: idOf(message.author), name: message.authorName };
    addLinks(message.body, {
      named: about(ticket),
      by,
      row: { id: idOf(message), from: 'chat', messageId: idOf(message), by, createdAt: message.createdAt, ticket: label(ticket) },
    });
  }
  for (const ticket of requests) {
    const by = { id: idOf(ticket.raisedBy), name: ticket.raisedBy?.name ?? '' };
    (ticket.attachments ?? []).forEach((file, index) => {
      if (!(about(ticket) || matches(file.filename, by.name))) return;
      found.push({
        id: `${idOf(ticket)}-request-${index}`,
        type: shelfOf(null, file.mimeType),
        from: 'request',
        key: file.key,
        filename: file.filename ?? '',
        mimeType: file.mimeType,
        size: file.size,
        by,
        createdAt: file.uploadedAt ?? ticket.createdAt,
        ticket: label(ticket),
      });
    });
    addLinks(ticket.description, {
      named: about(ticket),
      by,
      row: { id: `${idOf(ticket)}-request`, from: 'request', messageId: null, by, createdAt: ticket.createdAt, ticket: label(ticket) },
    });
  }

  found.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  const shown = found.slice(0, limit);

  // Signed only for what is shown, and fresh each time - the bucket stays private.
  const items = await Promise.all(
    shown.map(async ({ key, ...item }) => {
      if (item.type === 'link') return item;
      try {
        return {
          ...item,
          url: await createDownloadUrl(key),
          downloadUrl: await createDownloadUrl(key, { saveAs: item.filename || 'attachment' }),
        };
      } catch {
        // Storage not set up here: the row still names the file and its ticket.
        return { ...item, url: '', downloadUrl: '' };
      }
    }),
  );

  return { items, more: found.length > limit };
}

/**
 * GET /search?q=&types=&size=&status=&priority=&dept=&from=&to=&is=&has=
 *
 * `types` narrows which sections are searched; left out, all of them are, a
 * few rows each. A ticket filter (status, from, is, ...) is a question about
 * tickets, so asking one leaves the other sections out unless they were
 * named.
 */
export async function search(req, res) {
  void ensureSearchIndexes();

  const words = wordsOf(req.query.q);
  const asked = listOf(req.query.types).filter((type) => TYPES.includes(type));
  const ticketOnly = hasTicketFilters(req.query) && asked.length === 0;
  const types = asked.length > 0 ? asked : ticketOnly ? ['tickets'] : TYPES;
  // `size` says it outright; left out, one section is a whole page and several are a few rows each.
  const size = req.query.size === 'full' || req.query.size === 'preview' ? req.query.size : null;
  const limit = (size ?? (types.length === 1 ? 'full' : 'preview')) === 'full' ? FULL_LIMIT : PREVIEW_LIMIT;
  const reader = readerOf(req);

  // A bare filter is a list of tickets; nothing typed and nothing asked is nothing.
  const empty = { items: [], more: false };
  const run = (type, find) =>
    types.includes(type) && (words.length > 0 || (type === 'tickets' && hasTicketFilters(req.query)) || asked.length > 0)
      ? find(req, words, limit, reader)
      : Promise.resolve(empty);

  const [tickets, people, departments, units, messages, files] = await Promise.all([
    run('tickets', searchTickets),
    run('people', searchPeople),
    run('departments', searchDepartments),
    run('units', searchUnits),
    run('messages', searchMessages),
    run('files', searchFiles),
  ]);

  res.json({ success: true, tickets, people, departments, units, messages, files });
}
