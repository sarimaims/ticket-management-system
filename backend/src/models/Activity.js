import mongoose from 'mongoose';

import { SYSTEM_ROLES } from './User.js';

/**
 * A line in a department's activity log. Everything is written once and never
 * updated, so the actor's name and role are snapshots: the log still reads
 * correctly after an account is renamed, demoted or deleted.
 */
const activitySchema = new mongoose.Schema(
  {
    // null means workspace-level, visible to managers only.
    department: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Department',
      default: null,
      index: true,
    },
    departmentName: {
      type: String,
      default: '',
    },
    actor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    actorName: {
      type: String,
      required: true,
    },
    actorRole: {
      type: String,
      enum: SYSTEM_ROLES,
      default: 'user',
    },
    /** Machine-readable: ticket.created, member.added, ... */
    action: {
      type: String,
      required: true,
    },
    /** One line, already written for a human to read. */
    summary: {
      type: String,
      required: true,
    },
    ticketNumber: {
      type: String,
      default: '',
    },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

activitySchema.index({ createdAt: -1 });

const Activity = mongoose.model('Activity', activitySchema);

export default Activity;
