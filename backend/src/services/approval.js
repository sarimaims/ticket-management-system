// Registered here as well as by the app, because the sweep populates both and
// may run before any route has imported them.
import '../models/Department.js';
import '../models/User.js';
import Ticket, { APPROVAL_WINDOW_TEXT, RESOLVED } from '../models/Ticket.js';
import { record } from './activity.js';
import { postSystemMessage } from './chat.js';
import { notifyAutoApproved } from './notify.js';

/**
 * Silence counts as yes.
 *
 * A resolved ticket waits for the person who asked to sign it off. If they
 * never answer, it would sit in Resolved for ever - so once its window has
 * passed it completes itself, and says so in the thread, the log and the bell,
 * so nobody reads the silence as nothing having happened.
 */

/** Who the thread and the log say did it: nobody, the workspace itself. */
const WORKSPACE = { _id: null, name: 'FlowDesk', role: 'user' };

const WINDOW = APPROVAL_WINDOW_TEXT;

/** How often to look. The window is two days; being five minutes late is fine. */
const EVERY_MS = 5 * 60 * 1000;

/**
 * Completes every resolved ticket whose window has run out.
 *
 * Each one is flipped only while it is still Resolved and still past due, so
 * two servers sweeping at once - or a sweep racing the requester's own answer
 * - complete it exactly once.
 */
export async function completeUnanswered(now = new Date()) {
  const due = await Ticket.find({ status: RESOLVED, approvalDueAt: { $lte: now } })
    .select('_id')
    .lean();

  let completed = 0;

  for (const { _id } of due) {
    // eslint-disable-next-line no-await-in-loop
    const ticket = await Ticket.findOneAndUpdate(
      { _id, status: RESOLVED, approvalDueAt: { $lte: now } },
      {
        $set: {
          status: 'Completed',
          completedAt: now,
          approvedByName: 'Auto-approved',
          approvalDueAt: null,
        },
      },
      { returnDocument: 'after' },
    )
      .populate('department', 'name')
      .populate('raisedBy', 'name')
      .lean();

    if (!ticket) continue;
    completed += 1;

    const raiser = ticket.raisedBy?.name ?? 'the requester';

    /* eslint-disable no-await-in-loop */
    await postSystemMessage({
      ticket,
      actor: WORKSPACE,
      event: 'auto-approved',
      side: 'raiser',
      body: `completed this automatically - ${raiser} did not answer within ${WINDOW}`,
    });
    await record({
      actor: WORKSPACE,
      department: ticket.department,
      action: 'ticket.auto_approved',
      summary: `completed ${ticket.number} "${ticket.subject}" automatically - no answer from ${raiser} within ${WINDOW}`,
      ticketNumber: ticket.number,
    });
    await notifyAutoApproved({ ticket, within: WINDOW });
    /* eslint-enable no-await-in-loop */
  }

  return completed;
}

/**
 * Starts the sweep: once now, for anything that ran out while the server was
 * down, then every few minutes. The timer is unref'd so it never holds the
 * process open on shutdown.
 */
export function startApprovalSweep() {
  const sweep = () =>
    completeUnanswered().catch((error) => console.error('Approval sweep failed:', error.message));

  // The sweep's own question, answered by an index. Idempotent, and created
  // here because Ticket indexes are otherwise owned by the Prisma schema.
  Ticket.collection
    .createIndex({ status: 1, approvalDueAt: 1 })
    .catch((error) => console.error('Approval index check failed:', error.message));

  void sweep();
  const timer = setInterval(sweep, EVERY_MS);
  timer.unref?.();
  return timer;
}
