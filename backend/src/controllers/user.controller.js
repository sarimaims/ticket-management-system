import mongoose from 'mongoose';

import ApiError from '../utils/ApiError.js';
import { phoneNumber } from '../utils/phoneNumber.js';
import { workEmail } from '../utils/workEmail.js';
import { forgetUser } from '../middleware/auth.js';
import Department from '../models/Department.js';
import User, { DEPARTMENT_ROLES, MANAGER_ROLES, USER_STATUSES } from '../models/User.js';
import { presentUser, WITH_DEPARTMENTS } from './auth.controller.js';

function assertObjectId(id, label = 'id') {
  if (!mongoose.isValidObjectId(id)) throw ApiError.badRequest(`Invalid ${label}.`);
}

/** Directory for the admin pages, open to the super admin and to admins. */
export async function listUsers(req, res) {
  const { role, status, department } = req.query;

  const filter = {};
  if (status) filter.status = status;
  if (department) filter['memberships.department'] = department;
  if (role === 'superadmin') filter.role = 'superadmin';
  // The admins directory: the super admin and every admin, in one list.
  if (role === 'admin') filter.role = { $in: MANAGER_ROLES };
  if (role === 'head' || role === 'team') filter['memberships.role'] = role;

  /*
   * The account above an admin is not in their directory.
   *
   * An admin manages the workspace; the super admin manages the admins, and
   * is not theirs to read, count or edit. Held here rather than in the page,
   * so it holds for anything that asks - and as $and, so it also empties a
   * request that asked for the super admin by name.
   */
  if (!seesEveryone(req.user)) {
    filter.$and = [...(filter.$and ?? []), { role: { $ne: 'superadmin' } }];
  }

  const users = await User.find(filter)
    .sort({ createdAt: -1 })
    .populate(WITH_DEPARTMENTS);

  res.json({ success: true, users: users.map(presentUser) });
}

/** Only the super admin sees the super admin. */
const seesEveryone = (user) => user.role === 'superadmin';

/**
 * The account an admin is not allowed to know about, answered as though it
 * were not there. A 403 would confirm what a 404 keeps quiet.
 */
function assertVisible(target, viewer) {
  if (target.role === 'superadmin' && !seesEveryone(viewer)) {
    throw ApiError.notFound('User not found.');
  }
}

/** The departments this person runs, as ids. Empty for anyone who runs none. */
function headOf(user) {
  return (user.memberships ?? [])
    .filter((membership) => membership.role === 'head')
    .map((membership) => membership.department);
}

/**
 * A head's own directory: everyone in the departments they run.
 *
 * Deliberately not the admin list with a filter on it. A head is trusted with
 * their own team and nothing wider, so the scope is computed from who is
 * asking rather than taken from the query - there is no parameter here that
 * could be edited into showing somebody else's department.
 *
 * An admin has no memberships by design, so this answers 403 for them; the
 * whole directory is theirs under /users instead.
 */
export async function listMyTeam(req, res) {
  const departmentIds = headOf(req.user);
  if (departmentIds.length === 0) {
    throw ApiError.forbidden('Only a department head can see this.');
  }

  const { role, status } = req.query;

  const filter = { 'memberships.department': { $in: departmentIds } };
  if (status && USER_STATUSES.includes(status)) filter.status = status;

  const users = await User.find(filter).sort({ createdAt: -1 }).populate(WITH_DEPARTMENTS);

  // Filtered here rather than in the query: 'memberships.role' would match a
  // head of some other department who happens to sit on this team, and the
  // question being asked is what they are *here*.
  const mine = new Set(departmentIds.map(String));
  const isHere = (user, wanted) =>
    (user.memberships ?? []).some(
      (membership) => mine.has(String(membership.department?._id ?? membership.department)) &&
        membership.role === wanted,
    );

  const scoped = DEPARTMENT_ROLES.includes(role)
    ? users.filter((user) => isHere(user, role))
    : users;

  res.json({
    success: true,
    users: scoped.map(presentUser),
    /** Which departments this answer covers, so the page can say so. */
    departments: departmentIds.map(String),
  });
}

/**
 * One person's card, for anyone signed in.
 *
 * Deliberately not behind the admin gate the rest of this file sits behind:
 * the point of it is that whoever is holding a ticket can look up the person
 * at the other end and phone them. It answers with exactly what the directory
 * already shows about somebody - name, email, phone, where they work - and
 * nothing an admin alone is trusted with.
 */
export async function getUserProfile(req, res) {
  assertObjectId(req.params.id, 'user id');

  const user = await User.findById(req.params.id).populate(WITH_DEPARTMENTS);
  if (!user) throw ApiError.notFound('User not found.');

  res.json({ success: true, user: presentUser(user) });
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
  const { name, email, phone, password, role = 'admin', memberships } = req.body ?? {};

  if (!name?.trim()) throw ApiError.badRequest('Name is required.');
  if (!email?.trim()) throw ApiError.badRequest('Email is required.');
  const number = phoneNumber(phone);
  if (!password || password.length < 8) {
    throw ApiError.badRequest('Password must be at least 8 characters.');
  }
  if (role !== 'admin' && role !== 'user') {
    throw ApiError.badRequest('Role must be admin or user.');
  }

  const normalisedEmail = workEmail(email);
  if (await User.exists({ email: normalisedEmail })) {
    throw ApiError.conflict('An account with this email already exists.');
  }

  // A manager sits above the org chart, so the picker's value is not applied
  // to one; everybody else is required to hold at least one role.
  const cleaned = MANAGER_ROLES.includes(role) ? [] : await cleanMemberships(memberships ?? []);

  const user = await User.create({
    name: name.trim(),
    email: normalisedEmail,
    phone: number,
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
  assertVisible(user, req.user);

  const { name, email, phone, password, status, role, memberships } = req.body ?? {};
  const isSelf = String(user._id) === String(req.user._id);

  if (typeof name === 'string') {
    if (!name.trim()) throw ApiError.badRequest('Name cannot be empty.');
    user.name = name.trim();
  }

  if (typeof email === 'string' && email.trim().toLowerCase() !== user.email) {
    const normalised = workEmail(email);
    if (await User.exists({ email: normalised, _id: { $ne: user._id } })) {
      throw ApiError.conflict('Another account already uses this email.');
    }
    user.email = normalised;
  }

  /*
   * Every account carries a number. One sent here is checked the same way it
   * is on the way in; an account from before the field existed is asked for
   * one now, rather than being saved back without it.
   */
  if (phone !== undefined || !user.phone) {
    user.phone = phoneNumber(phone);
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
  assertVisible(user, req.user);

  // Not even by the one person who can see it: the profile is permanent.
  if (user.role === 'superadmin') {
    throw ApiError.forbidden('The super admin profile cannot be deleted.');
  }

  await user.deleteOne();
  forgetUser(user._id);
  res.json({ success: true });
}
