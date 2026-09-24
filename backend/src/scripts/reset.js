/**
 * Wipes the workspace back to a bare super admin: every unit, department,
 * ticket and account goes, along with the conversations, the assignment
 * trails, the bell, the activity log and the ticket numbering - so the next
 * ticket is TK-0001 again. The super admin account (and its password) is the
 * only thing kept.
 *
 *   npm run reset
 *
 * Irreversible. Refuses to run against NODE_ENV=production unless
 * RESET_CONFIRM=yes is set, so it cannot be triggered there by accident.
 */
import mongoose from 'mongoose';

import { connectDatabase, disconnectDatabase } from '../config/db.js';
import Activity from '../models/Activity.js';
import Department from '../models/Department.js';
import Message from '../models/Message.js';
import Notification from '../models/Notification.js';
import ThreadRead from '../models/ThreadRead.js';
import Ticket from '../models/Ticket.js';
import TicketAssignment from '../models/TicketAssignment.js';
import Unit from '../models/Unit.js';
import User from '../models/User.js';

async function run() {
  if (process.env.NODE_ENV === 'production' && process.env.RESET_CONFIRM !== 'yes') {
    throw new Error('Refusing to reset a production database without RESET_CONFIRM=yes.');
  }

  await connectDatabase();

  const keep = await User.find({ role: 'superadmin' }).select('_id name email');
  if (keep.length === 0) {
    throw new Error('No super admin found - refusing to empty the users collection.');
  }

  const before = {
    users: await User.countDocuments(),
    units: await Unit.countDocuments(),
    departments: await Department.countDocuments(),
    tickets: await Ticket.countDocuments(),
    messages: await Message.countDocuments(),
  };

  console.log('Before:', before);
  console.log('Keeping:', keep.map((user) => `${user.name} <${user.email}>`).join(', '));

  const keptIds = keep.map((user) => user._id);

  const users = await User.deleteMany({ _id: { $nin: keptIds } });
  const units = await Unit.deleteMany({});
  const departments = await Department.deleteMany({});
  const tickets = await Ticket.deleteMany({});

  // Everything that only existed because a ticket did. Cleared by hand rather
  // than left to cascade, because MongoDB has no cascade: a thread whose
  // ticket is gone is unreachable but still on disk.
  const messages = await Message.deleteMany({});
  const assignments = await TicketAssignment.deleteMany({});
  const notifications = await Notification.deleteMany({});
  const reads = await ThreadRead.deleteMany({});
  const activity = await Activity.deleteMany({});

  // The ticket counter lives outside the models, so clear it directly or the
  // first new ticket would carry on from the old sequence.
  await mongoose.connection.collection('counters').deleteMany({});

  // A kept super admin holds no memberships anyway; make sure of it now that
  // every department it could have pointed at is gone.
  await User.updateMany({ _id: { $in: keptIds } }, { $set: { memberships: [] } });

  console.log('Deleted:', {
    users: users.deletedCount,
    units: units.deletedCount,
    departments: departments.deletedCount,
    tickets: tickets.deletedCount,
    messages: messages.deletedCount,
    assignments: assignments.deletedCount,
    notifications: notifications.deletedCount,
    threadReads: reads.deletedCount,
    activity: activity.deletedCount,
  });

  console.log('After:', {
    users: await User.countDocuments(),
    units: await Unit.countDocuments(),
    departments: await Department.countDocuments(),
    tickets: await Ticket.countDocuments(),
    messages: await Message.countDocuments(),
  });

  await disconnectDatabase();
  console.log('Reset complete. Ticket numbering restarts at TK-0001.');
}

run().catch(async (error) => {
  console.error('Reset failed:', error.message);
  await disconnectDatabase();
  process.exit(1);
});
