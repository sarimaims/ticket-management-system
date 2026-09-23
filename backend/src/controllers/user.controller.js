import mongoose from 'mongoose';

import ApiError from '../utils/ApiError.js';
import { forgetUser } from '../middleware/auth.js';
import Department from '../models/Department.js';
import User, { DEPARTMENT_ROLES, MANAGER_ROLES, USER_STATUSES } from '../models/User.js';
import { presentUser, WITH_DEPARTMENTS } from './auth.controller.js';

function assertObjectId(id, label = 'id') {
  if (!mongoose.isValidObjectId(id)) throw ApiError.badRequest(`Invalid ${label}.`);
}

/** Directory for the admin pages. Super admin only - see the route. */
export async function listUsers(req, res) {
  const { role, status, department } = req.query;

  const filter = {};
  if (status) filter.status = status;
  if (department) filter['memberships.department'] = department;
  if (role === 'superadmin') filter.role = 'superadmin';
  // The admins directory: the super admin and every admin, in one list.
  if (role === 'admin') filter.role = { $in: MANAGER_ROLES };
  if (role === 'head' || role === 'team') filter['memberships.role'] = role;

  const users = await User.find(filter)
    .sort({ createdAt: -1 })
    .populate(WITH_DEPARTMENTS);

  res.json({ success: true, users: users.map(presentUser) });
}

/**
 * Turns whatever was sent into a clean membership list: one entry per
 * department, a valid role on each, and every department checked to exist.
 *
 * Shared by creating and editing an account, so the two cannot drift into
 * disagreeing about what a valid membership is.
 */
async function cleanMemberships(memberships) {
  if (!Array.isArray(memberships)) throw ApiError.badRequest('Memberships must be a list.');

  // A member with no department has nowhere to raise from and appears in
  // nobody's queue, so the account would exist without being usable.
  if (memberships.length === 0) {
    throw ApiError.badRequest('Give this person at least one role: a unit, a department and what they are in it.');
  }

  const cleaned = [];
  const seen = new Set();

  for (const entry of memberships) {
    const departmentId = entry?.department ?? entry?.id;
    assertObjectId(departmentId, 'department id');

    const membershipRole = entry?.role ?? 'team';
    if (!DEPARTMENT_ROLES.includes(membershipRole)) {
      throw ApiError.badRequest(`Role must be one of: ${DEPARTMENT_ROLES.join(', ')}.`);
    }

    // Last entry wins rather than erroring, so a duplicated pick is harmless.
    if (seen.has(String(departmentId))) {
      const existing = cleaned.find((item) => String(item.department) === String(departmentId));
      existing.role = membershipRole;
      continue;
    }

    seen.add(String(departmentId));
    cleaned.push({ department: departmentId, role: membershipRole });
  }

  const found = await Department.countDocuments({ _id: { $in: [...seen] } });
  if (found !== seen.size) throw ApiError.badRequest('One or more departments are invalid.');

  return cleaned;
}

/**
 * Creates an account. Both a super admin and an admin may do this; the super
 * admin role itself is never handed out here.
 *
 * A member can be placed in their departments as they are created - any unit,
 * any department, with a role in each - rather than being made first and
 * filed afterwards.
 */
export async function createUser(req, res) {
  const { name, email, password, role = 'admin', memberships } = req.body ?? {};

  if (!name?.trim()) throw ApiError.badRequest('Name is required.');
  if (!email?.trim()) throw ApiError.badRequest('Email is required.');
  if (!password || password.length < 8) {
    throw ApiError.badRequest('Password must be at least 8 characters.');
  }
  if (role !== 'admin' && role !== 'user') {
    throw ApiError.badRequest('Role must be admin or user.');
  }

  const normalisedEmail = email.trim().toLowerCase();
  if (await User.exists({ email: normalisedEmail })) {
    throw ApiError.conflict('An account with this email already exists.');
  }

  // A manager sits above the org chart, so the picker's value is not applied
  // to one; everybody else is required to hold at least one role.
  const cleaned = MANAGER_ROLES.includes(role) ? [] : await cleanMemberships(memberships ?? []);

  const user = await User.create({
    name: name.trim(),
    email: normalisedEmail,
    password,
    role,
    status: 'active',
    memberships: cleaned,
  });

  // Populated, so the new row arrives with department and unit names on it
  // rather than bare ids the directory cannot label.
  // The session cache holds this account for a few seconds; a change to it
  // must not wait that long to take effect.
  forgetUser(user._id);

  const populated = await User.findById(user._id).populate(WITH_DEPARTMENTS);
  res.status(201).json({ success: true, user: presentUser(populated) });
}

/**
 * Edits one account: profile, status, system role and the full set of
 * department memberships. Sending `memberships` replaces the list, which is
 * how one user ends up in several departments with a role in each.
 */
export async function updateUser(req, res) {
  assertObjectId(req.params.id, 'user id');

  const user = await User.findById(req.params.id);
  if (!user) throw ApiError.notFound('User not found.');

  const { name, email, password, status, role, memberships } = req.body ?? {};
  const isSelf = String(user._id) === String(req.user._id);

  if (typeof name === 'string') {
    if (!name.trim()) throw ApiError.badRequest('Name cannot be empty.');
    user.name = name.trim();
  }

  if (typeof email === 'string' && email.trim().toLowerCase() !== user.email) {
    const normalised = email.trim().toLowerCase();
    if (await User.exists({ email: normalised, _id: { $ne: user._id } })) {
      throw ApiError.conflict('Another account already uses this email.');
    }
    user.email = normalised;
  }

  // Set only when a new one is sent: an empty field means "leave it alone".
  // The pre-save hook hashes it, so the plaintext never reaches the database.
  if (password !== undefined && password !== '') {
    if (typeof password !== 'string' || password.length < 8) {
      throw ApiError.badRequest('Password must be at least 8 characters.');
    }
    user.password = password;
  }

  // A super admin must not be able to lock themselves out of their own
  // workspace, so self-edits cannot touch status or the system role.
  if (typeof status === 'string') {
    if (!USER_STATUSES.includes(status)) {
      throw ApiError.badRequest(`Status must be one of: ${USER_STATUSES.join(', ')}.`);
    }
    if (isSelf && status !== user.status) {
      throw ApiError.badRequest('You cannot change your own status.');
    }
    user.status = status;
  }

  // Admin and user swap freely; the single super admin is off limits in both
  // directions, so the role can be neither granted nor taken away.
  if (typeof role === 'string' && role !== user.role) {
    if (user.role === 'superadmin' || role === 'superadmin') {
      throw ApiError.badRequest('The super admin role cannot be reassigned.');
    }
    if (role !== 'admin' && role !== 'user') {
      throw ApiError.badRequest('Role must be admin or user.');
    }
    if (isSelf) throw ApiError.badRequest('You cannot change your own role.');
    user.role = role;
  }

  // A manager has no departments, so the picker's value is simply not applied.
  if (memberships !== undefined && !MANAGER_ROLES.includes(user.role)) {
    user.memberships = await cleanMemberships(memberships);
  }

  // Also catches the way in through the side door: an admin demoted to member
  // without a list being sent would otherwise land in no department at all.
  if (!MANAGER_ROLES.includes(user.role) && user.memberships.length === 0) {
    throw ApiError.badRequest('Give this person at least one role: a unit, a department and what they are in it.');
  }

  await user.save({ validateBeforeSave: true });

  // The session cache holds this account for a few seconds; a change to it
  // must not wait that long to take effect.
  forgetUser(user._id);

  const populated = await User.findById(user._id).populate(WITH_DEPARTMENTS);
  res.json({ success: true, user: presentUser(populated) });
}

export async function deleteUser(req, res) {
  assertObjectId(req.params.id, 'user id');

  if (String(req.params.id) === String(req.user._id)) {
    throw ApiError.badRequest('You cannot delete your own account.');
  }

  const user = await User.findById(req.params.id);
  if (!user) throw ApiError.notFound('User not found.');

  // An admin has every other right, but the super admin profile is permanent.
  if (user.role === 'superadmin') {
    throw ApiError.forbidden('The super admin profile cannot be deleted.');
  }

  await user.deleteOne();
  forgetUser(user._id);
  res.json({ success: true });
}
