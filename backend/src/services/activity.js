import Activity from '../models/Activity.js';

/**
 * Appends one line to the log. Logging is never allowed to break the action it
 * describes, so a failure here is reported and swallowed.
 */
export async function record({ actor, department, action, summary, ticketNumber = '' }) {
  try {
    await Activity.create({
      department: department?._id ?? department ?? null,
      departmentName: department?.name ?? '',
      actor: actor?._id ?? null,
      actorName: actor?.name ?? 'Someone',
      actorRole: actor?.role ?? 'user',
      action,
      summary,
      ticketNumber,
    });
  } catch (error) {
    console.error('Activity log failed:', error.message);
  }
}
