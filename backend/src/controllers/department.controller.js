import mongoose from 'mongoose';

import ApiError from '../utils/ApiError.js';
import { designation } from '../utils/designation.js';
import { phoneNumber } from '../utils/phoneNumber.js';
import { workEmail } from '../utils/workEmail.js';
import Department from '../models/Department.js';
import Unit from '../models/Unit.js';
import User, { DEPARTMENT_ROLES, MANAGER_ROLES } from '../models/User.js';
import { presentUser, WITH_DEPARTMENTS } from './auth.controller.js';
import { record } from '../services/activity.js';
import { forgetUser } from '../middleware/auth.js';

function assertObjectId(id, label = 'id') {
  if (!mongoose.isValidObjectId(id)) throw ApiError.badRequest(`Invalid ${label}.`);
}

const isManager = (user) => MANAGER_ROLES.includes(user.role);

/** The departments a non-manager is allowed to look at: their own. */
function myDepartmentIds(user) {
  return (user.memberships ?? []).map((membership) => membership.department);
}

/** A head runs its own department; a manager runs all of them. */
function canManageMembers(user, departmentId) {
  if (isManager(user)) return true;
  return user.roleInDepartment(departmentId) === 'head';
}

/** One aggregate for every department's head/team counts, so the list is a single round trip. */
async function countsByDepartment() {
  const rows = await User.aggregate([
    { $unwind: '$memberships' },
    {
      $group: {
        _id: '$memberships.department',
        members: { $sum: 1 },
        heads: { $sum: { $cond: [{ $eq: ['$memberships.role', 'head'] }, 1, 0] } },
      },
    },
  ]);

  return new Map(
    rows.map((row) => [
      String(row._id),
      { members: row.members, heads: row.heads, team: row.members - row.heads },
    ]),
  );
}

function present(department, counts) {
  const tally = counts?.get(String(department._id)) ?? { members: 0, heads: 0, team: 0 };
  const unit = department.unit;
  const populated = unit && typeof unit === 'object' && unit.name;

  return {
    id: String(department._id),
    name: department.name,
    code: department.code,
    unit: unit
      ? populated
        ? { id: String(unit._id), name: unit.name, code: unit.code }
        : { id: String(unit) }
      : null,
    description: department.description,
    isActive: department.isActive,
    memberCount: tally.members,
    headCount: tally.heads,
    teamCount: tally.team,
    createdAt: department.createdAt,
  };
}

export async function listDepartments(req, res) {
  // A head or team member sees the departments they belong to, nothing else.
  // Managers see the whole org chart.
  const filter = isManager(req.user) ? {} : { _id: { $in: myDepartmentIds(req.user) } };

  // ?unit= narrows the list to one unit; an unparseable id matches nothing
  // rather than quietly listing everything.
  if (req.query.unit) {
    assertObjectId(req.query.unit, 'unit id');
    filter.unit = req.query.unit;
  }

  const [departments, counts] = await Promise.all([
    Department.find(filter).populate('unit', 'name code').sort({ name: 1 }),
    countsByDepartment(),
  ]);

  res.json({
    success: true,
    departments: departments.map((department) => present(department, counts)),
  });
}

/**
 * Names only, for choosing where to send a ticket. You may raise a request to
 * any department; that is different from being able to inspect its members,
 * which `listDepartments` above restricts.
 */
export async function listDepartmentOptions(req, res) {
  const departments = await Department.find({ isActive: true })
    .select('name code unit')
    .populate('unit', 'name code')
    .sort({ name: 1 });

  res.json({
    success: true,
    departments: departments.map((department) => ({
      id: String(department._id),
      name: department.name,
      code: department.code,
      unit: department.unit
        ? { id: String(department.unit._id), name: department.unit.name }
        : null,
    })),
  });
}

export async function getDepartment(req, res) {
  assertObjectId(req.params.id, 'department id');

  const department = await Department.findById(req.params.id).populate('unit', 'name code');
  if (!department) throw ApiError.notFound('Department not found.');

  if (!isManager(req.user) && !req.user.roleInDepartment(department._id)) {
    throw ApiError.forbidden('You can only view a department you belong to.');
  }

  const members = await User.find({ 'memberships.department': department._id })
    .sort({ name: 1 })
    .populate(WITH_DEPARTMENTS);

  const counts = await countsByDepartment();

  res.json({
    success: true,
    department: present(department, counts),
    members: members.map((member) => ({
      ...presentUser(member),
      departmentRole: member.roleInDepartment(department._id),
    })),
  });
}

/**
 * Who is in one department, names only.
 *
 * The same trust as listing the departments themselves: anyone may raise a
 * request to any department, so anyone may see who is in it to address the
 * request at a person. Everything else about them - email, standing, when
 * they were last here - stays behind getDepartment above, which only its own
 * members and a manager can read.
 *
 * Suspended accounts are left out: a ticket addressed at one would sit
 * unanswered.
 */
export async function listMemberOptions(req, res) {
  assertObjectId(req.params.id, 'department id');

  const department = await Department.findById(req.params.id).select('_id');
  if (!department) throw ApiError.notFound('Department not found.');

  const members = await User.find({
    'memberships.department': department._id,
    status: { $ne: 'suspended' },
  })
    .select('name memberships')
    .sort({ name: 1 });

  res.json({
    success: true,
    members: members.map((member) => ({
      id: String(member._id),
      name: member.name,
      departmentRole: member.roleInDepartment(department._id),
    })),
  });
}

/**
 * Everyone a ticket can be addressed at, across the whole org chart.
 *
 * One entry per membership rather than per person: somebody who sits in two
 * departments can be asked in either, and the ticket that results belongs to
 * whichever one was picked - so the two are different answers, not a
 * duplicate. Each carries its department and unit so the caller can say which
 * is which without a second lookup.
 *
 * `unit` and `department` narrow it. Same policy as the per-department list
 * above: names and roles only, open to anyone signed in, because addressing a
 * ticket is something every user does.
 */
export async function listAllMemberOptions(req, res) {
  const { unit, department } = req.query;

  const scope = { isActive: true };
  if (department) {
    // One id or a comma-separated list: a ticket can be addressed at several
    // departments, and the people on offer are everybody in any of them.
    const asked = String(department)
      .split(',')
      .map((id) => id.trim())
      .filter(Boolean);

    for (const id of asked) assertObjectId(id, 'department id');
    scope._id = { $in: asked };
  }
  if (unit) {
    assertObjectId(unit, 'unit id');
    scope.unit = unit;
  }

  const departments = await Department.find(scope).select('_id name unit').populate('unit', 'name');

  if (departments.length === 0) {
    res.json({ success: true, members: [] });
    return;
  }

  const byId = new Map(departments.map((item) => [String(item._id), item]));

  const users = await User.find({
    'memberships.department': { $in: departments.map((item) => item._id) },
    status: { $ne: 'suspended' },
  })
    .select('name memberships')
    .sort({ name: 1 });

  const members = [];
  for (const user of users) {
    for (const membership of user.memberships ?? []) {
      const held = byId.get(String(membership.department));
      // A membership in a department outside the filter, or in one that has
      // been deactivated, is simply not on offer.
      if (!held) continue;

      members.push({
        id: String(user._id),
        name: user.name,
        departmentRole: membership.role,
        department: { id: String(held._id), name: held.name },
        unit: held.unit ? { id: String(held.unit._id), name: held.unit.name } : null,
      });
    }
  }

  res.json({ success: true, members });
}

export async function createDepartment(req, res) {
  const { name, description, code, unit } = req.body ?? {};

  if (!name?.trim()) throw ApiError.badRequest('Department name is required.');
  if (!unit) throw ApiError.badRequest('Choose the unit this department belongs to.');

  assertObjectId(unit, 'unit id');
  const parent = await Unit.findById(unit);
  if (!parent) throw ApiError.notFound('That unit does not exist.');

  const trimmed = name.trim();
  if (await Department.exists({ name: trimmed })) {
    throw ApiError.conflict('A department with this name already exists.');
  }

  // Derive a code when none is given, then walk suffixes until it is unique.
  let candidate = (code?.trim() || Department.codeFrom(trimmed)).toUpperCase();
  let suffix = 1;
  while (await Department.exists({ code: candidate })) {
    suffix += 1;
    candidate = `${Department.codeFrom(trimmed)}${suffix}`.slice(0, 8);
  }

  const department = await Department.create({
    name: trimmed,
    code: candidate,
    unit: parent._id,
    description: description?.trim() ?? '',
    createdBy: req.user._id,
  });

  await record({
    actor: req.user,
    department,
    action: 'department.created',
    summary: `created the department ${department.name} under ${parent.name}`,
  });

  department.unit = parent;
  res.status(201).json({ success: true, department: present(department) });
}

export async function updateDepartment(req, res) {
  assertObjectId(req.params.id, 'department id');

  const department = await Department.findById(req.params.id);
  if (!department) throw ApiError.notFound('Department not found.');

  const { name, description, isActive, unit } = req.body ?? {};

  /*
   * An admin reshapes the org chart; a head runs one corner of it. So a head
   * may say what the department they run is called and what it does - both
   * are theirs to describe - but moving it between units or switching it off
   * changes the chart for everyone, and stays with an admin.
   */
  if (!isManager(req.user)) {
    if (req.user.roleInDepartment(department._id) !== 'head') {
      throw ApiError.forbidden('Only a head of this department, or an admin, can edit it.');
    }
    if (isActive !== undefined || unit !== undefined) {
      throw ApiError.forbidden('Moving a department to another unit needs an admin.');
    }
  }

  const previousName = department.name;

  if (name !== undefined) {
    const next = typeof name === 'string' ? name.trim() : '';
    if (!next) throw ApiError.badRequest('A department needs a name.');
    if (next.length > 80) throw ApiError.badRequest('Keep the name under 80 characters.');
    const clash = await Department.exists({
      name: new RegExp(`^${next.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i'),
      _id: { $ne: department._id },
    });
    if (clash) throw ApiError.conflict('A department with this name already exists.');
    department.name = next;
  }
  if (typeof description === 'string') {
    if (description.trim().length > 300) {
      throw ApiError.badRequest('Keep the description under 300 characters.');
    }
    department.description = description.trim();
  }
  if (typeof isActive === 'boolean') department.isActive = isActive;

  if (unit !== undefined) {
    assertObjectId(unit, 'unit id');
    const parent = await Unit.findById(unit);
    if (!parent) throw ApiError.notFound('That unit does not exist.');

    if (String(parent._id) !== String(department.unit)) {
      await record({
        actor: req.user,
        department,
        action: 'department.moved',
        summary: `moved ${department.name} to ${parent.name}`,
      });
    }
    department.unit = parent._id;
  }

  await department.save();

  if (department.name !== previousName) {
    await record({
      actor: req.user,
      department,
      action: 'department.renamed',
      summary: `renamed ${previousName} to ${department.name}`,
    });
  }

  const counts = await countsByDepartment();
  await department.populate('unit', 'name code');
  res.json({ success: true, department: present(department, counts) });
}

export async function deleteDepartment(req, res) {
  assertObjectId(req.params.id, 'department id');

  const department = await Department.findById(req.params.id);
  if (!department) throw ApiError.notFound('Department not found.');

  // Detach every member first so no user is left pointing at a dead department.
  await User.updateMany(
    { 'memberships.department': department._id },
    { $pull: { memberships: { department: department._id } } },
  );
  await department.deleteOne();

  res.json({ success: true });
}

/* --------------------------------------------------------------- members */

/**
 * Adds someone to a department as head or team. A new email creates the
 * account; an existing email is attached to the department instead.
 */
export async function addMember(req, res) {
  assertObjectId(req.params.id, 'department id');

  const department = await Department.findById(req.params.id);
  if (!department) throw ApiError.notFound('Department not found.');

  const { name, email, phone, designation: title, password, role } = req.body ?? {};

  if (!canManageMembers(req.user, department._id)) {
    throw ApiError.forbidden('Only a head of this department, or an admin, can add members.');
  }
  if (!email?.trim()) throw ApiError.badRequest('Email is required.');
  if (!DEPARTMENT_ROLES.includes(role)) {
    throw ApiError.badRequest(`Role must be one of: ${DEPARTMENT_ROLES.join(', ')}.`);
  }
  // What they are in *this* department. Asked whether the account is new or
  // not: an existing person joining a second department is exactly the case
  // where their title here can differ from the one they already have.
  const job = designation(title);

  const normalisedEmail = email.trim().toLowerCase();
  let user = await User.findOne({ email: normalisedEmail });

  if (user) {
    if (MANAGER_ROLES.includes(user.role)) {
      throw ApiError.badRequest(
        'Admins are not part of any department - they already have access to all of them.',
      );
    }
    if (user.roleInDepartment(department._id)) {
      throw ApiError.conflict('This user is already in the department.');
    }
    user.memberships.push({ department: department._id, role, designation: job });
    await user.save({ validateBeforeSave: false });
  } else {
    if (!name?.trim()) throw ApiError.badRequest('Name is required for a new user.');
    if (!password || password.length < 8) {
      throw ApiError.badRequest('Password must be at least 8 characters.');
    }

    user = await User.create({
      name: name.trim(),
      // Only a new account needs one here; attaching an existing one keeps
      // the number already on it.
      phone: phoneNumber(phone),
      // Only a new account is held to the domain; attaching one that already
      // exists is a lookup, not a sign-up.
      email: workEmail(normalisedEmail),
      password,
      role: 'user',
      status: 'active',
      memberships: [{ department: department._id, role, designation: job }],
    });
  }

  const populated = await User.findById(user._id).populate(WITH_DEPARTMENTS);

  await record({
    actor: req.user,
    department,
    action: 'member.added',
    summary: `added ${user.name} to ${department.name} as ${role}`,
  });

  res.status(201).json({
    success: true,
    member: { ...presentUser(populated), departmentRole: role },
  });
}

export async function updateMemberRole(req, res) {
  assertObjectId(req.params.id, 'department id');
  assertObjectId(req.params.userId, 'user id');

  const { role } = req.body ?? {};
  if (!isManager(req.user)) {
    throw ApiError.forbidden('Only an admin can change a member\'s role.');
  }
  if (!DEPARTMENT_ROLES.includes(role)) {
    throw ApiError.badRequest(`Role must be one of: ${DEPARTMENT_ROLES.join(', ')}.`);
  }

  const user = await User.findOne({
    _id: req.params.userId,
    'memberships.department': req.params.id,
  });
  if (!user) throw ApiError.notFound('This user is not in that department.');

  const membership = user.memberships.find(
    (item) => String(item.department) === String(req.params.id),
  );
  membership.role = role;
  await user.save({ validateBeforeSave: false });

  await record({
    actor: req.user,
    department: req.params.id,
    action: 'member.role_changed',
    summary: `changed ${user.name}'s role to ${role}`,
  });

  const populated = await User.findById(user._id).populate(WITH_DEPARTMENTS);
  res.json({ success: true, member: { ...presentUser(populated), departmentRole: role } });
}

/**
 * Corrects a member's details: their name, phone number and designation.
 *
 * A head adds people to their team, so a head must also be able to fix what
 * they typed - a misspelt name, a wrong number, a title that changed with a
 * promotion. They may do it for the team they run and nobody else: not a
 * fellow head, and not themselves, whose name is an admin's to change and
 * whose phone is theirs to change in Settings.
 *
 * What a person signs in with and what they may do - email, password, role
 * and status - stays on the admin's Users page.
 */
export async function updateMemberDetails(req, res) {
  assertObjectId(req.params.id, 'department id');
  assertObjectId(req.params.userId, 'user id');

  if (!canManageMembers(req.user, req.params.id)) {
    throw ApiError.forbidden('Only a head of this department, or an admin, can edit its members.');
  }

  const user = await User.findOne({
    _id: req.params.userId,
    'memberships.department': req.params.id,
  });
  if (!user) throw ApiError.notFound('This user is not in that department.');

  if (!isManager(req.user)) {
    if (String(user._id) === String(req.user._id)) {
      throw ApiError.forbidden('Change your own phone in Settings; your name is an admin\'s to change.');
    }
    if (user.roleInDepartment(req.params.id) === 'head') {
      throw ApiError.forbidden('A head cannot edit a fellow head. Ask an admin.');
    }
  }

  const { name, phone, designation: title } = req.body ?? {};
  const changed = [];

  if (name !== undefined) {
    const next = typeof name === 'string' ? name.replace(/\s+/g, ' ').trim() : '';
    if (next.length < 2) throw ApiError.badRequest('Enter their full name.');
    if (next.length > 80) throw ApiError.badRequest('Keep the name under 80 characters.');
    if (next !== user.name) {
      user.name = next;
      changed.push('name');
    }
  }

  if (phone !== undefined) {
    const next = phoneNumber(phone);
    if (next !== user.phone) {
      user.phone = next;
      changed.push('phone');
    }
  }

  if (title !== undefined) {
    const next = designation(title);
    if (next !== user.designation) {
      user.designation = next;
      changed.push('designation');
    }
  }

  if (changed.length > 0) {
    // Only what was touched is validated: an older account with no number on
    // it must still be able to have its name corrected.
    await user.save({ validateModifiedOnly: true });
    forgetUser(user._id);

    await record({
      actor: req.user,
      department: req.params.id,
      action: 'member.updated',
      summary: `updated ${user.name}'s ${changed.join(', ')}`,
    });
  }

  const populated = await User.findById(user._id).populate(WITH_DEPARTMENTS);
  res.json({
    success: true,
    member: { ...presentUser(populated), departmentRole: populated.roleInDepartment(req.params.id) },
  });
}

export async function removeMember(req, res) {
  assertObjectId(req.params.id, 'department id');
  assertObjectId(req.params.userId, 'user id');

  if (!canManageMembers(req.user, req.params.id)) {
    throw ApiError.forbidden('Only a head of this department, or an admin, can remove members.');
  }

  // A head runs the team, but cannot remove a fellow head - including itself.
  if (!isManager(req.user)) {
    const target = await User.findById(req.params.userId);
    if (!target) throw ApiError.notFound('User not found.');
    if (target.roleInDepartment(req.params.id) === 'head') {
      throw ApiError.forbidden('Only an admin can remove a department head.');
    }
  }

  const result = await User.updateOne(
    { _id: req.params.userId },
    { $pull: { memberships: { department: req.params.id } } },
  );

  if (result.matchedCount === 0) throw ApiError.notFound('User not found.');

  const removed = await User.findById(req.params.userId).select('name');
  await record({
    actor: req.user,
    department: req.params.id,
    action: 'member.removed',
    summary: `removed ${removed?.name ?? 'a member'} from the department`,
  });

  res.json({ success: true });
}
