import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';

import { PHONE_PATTERN } from '../utils/phoneNumber.js';

/**
 * What a user can do across the whole workspace.
 *  superadmin - the single seeded owner. Cannot be created, demoted or deleted.
 *  admin      - full management rights, except deleting the super admin.
 *  user       - no management rights; their role lives on each membership.
 */
export const SYSTEM_ROLES = ['superadmin', 'admin', 'user'];

/** Roles that may manage the workspace. */
export const MANAGER_ROLES = ['superadmin', 'admin'];

/** What a user is inside one department. */
export const DEPARTMENT_ROLES = ['head', 'team'];

export const USER_STATUSES = ['active', 'invited', 'suspended'];

const membershipSchema = new mongoose.Schema(
  {
    department: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Department',
      required: true,
    },
    role: {
      type: String,
      enum: DEPARTMENT_ROLES,
      default: 'team',
    },
  },
  { _id: false },
);

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Name is required'],
      trim: true,
      maxlength: 80,
    },
    email: {
      type: String,
      required: [true, 'Email is required'],
      trim: true,
      lowercase: true,
      unique: true,
      match: [/^[^\s@]+@[^\s@]+\.[^\s@]+$/, 'Enter a valid email address'],
    },
    /**
     * How to reach this person away from the app. Required on every account:
     * a ticket that has to be chased at five o'clock is chased by phone, and
     * an account with no number on it is a dead end for whoever is holding
     * the ticket.
     *
     * Stored as digits with an optional leading "+", so the same number typed
     * two different ways is one value here. Accounts made before this field
     * existed have none, and are asked for one the next time they are edited.
     */
    phone: {
      type: String,
      required: [true, 'Phone number is required'],
      trim: true,
      match: [PHONE_PATTERN, 'Enter a valid phone number'],
    },
    // Never returned by a query unless explicitly selected.
    password: {
      type: String,
      required: [true, 'Password is required'],
      minlength: 8,
      select: false,
    },
    role: {
      type: String,
      enum: SYSTEM_ROLES,
      default: 'user',
    },
    status: {
      type: String,
      enum: USER_STATUSES,
      default: 'active',
    },
    memberships: {
      type: [membershipSchema],
      default: [],
    },
    lastActiveAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
    toJSON: {
      transform(_doc, ret) {
        delete ret.password;
        return ret;
      },
    },
  },
);

userSchema.index({ 'memberships.department': 1 });
userSchema.index({ phone: 1 });

/**
 * Super admins and admins sit above the org chart: their rights are workspace
 * wide, so a department membership would be meaningless. Enforced here rather
 * than in each controller, so no path can reintroduce one.
 */
userSchema.pre('save', function clearManagerMemberships() {
  if (MANAGER_ROLES.includes(this.role) && this.memberships.length > 0) {
    this.memberships = [];
  }
});

// Mongoose 9 no longer passes `next` to async middleware: resolving the
// promise is what advances the chain.
userSchema.pre('save', async function hashPassword() {
  if (!this.isModified('password')) return;
  this.password = await bcrypt.hash(this.password, 10);
});

userSchema.methods.verifyPassword = function verifyPassword(plain) {
  return bcrypt.compare(plain, this.password);
};

/** The department role, or null when the user is not in that department. */
userSchema.methods.roleInDepartment = function roleInDepartment(departmentId) {
  const target = String(departmentId?._id ?? departmentId);
  const membership = this.memberships.find(
    // `department` is an id normally and a document once populated - read the
    // id off both shapes, otherwise a populated query always answers null.
    (item) => String(item.department?._id ?? item.department) === target,
  );
  return membership ? membership.role : null;
};

const User = mongoose.model('User', userSchema);

export default User;
