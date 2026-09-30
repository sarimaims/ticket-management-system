import Ticket from '../models/Ticket.js';

/**
 * Gives every ticket its list of departments.
 *
 * Tickets raised before a ticket could be shared name one department and have
 * no list. The queues now ask the list, so each such ticket is given one
 * holding its own department - once, at start-up, and never again for a
 * ticket that already has it. Idempotent and quick: it only touches the rows
 * that need it.
 */
export async function backfillTicketDepartments() {
  try {
    const result = await Ticket.collection.updateMany(
      {
        department: { $ne: null },
        $or: [{ departments: { $exists: false } }, { departments: { $size: 0 } }],
      },
      [{ $set: { departments: ['$department'] } }],
    );
    if (result.modifiedCount > 0) {
      console.log(`Gave ${result.modifiedCount} ticket(s) their department list.`);
    }

    // The queues' own question, answered by an index. Created here because
    // Ticket indexes are otherwise owned by the Prisma schema.
    await Ticket.collection.createIndex({ departments: 1, updatedAt: -1 });
  } catch (error) {
    console.error('Ticket department backfill failed:', error.message);
  }
}
