import mongoose from 'mongoose';

import ApiError from '../utils/ApiError.js';
import Department from '../models/Department.js';
import User, { DEPARTMENT_ROLES, MANAGER_ROLES } from '../models/User.js';
import { presentUser } from './auth.controller.js';

function assertObjectId(id, label = 'id') {
  if (!mongoose.isValidObjectId(id)) throw ApiError.badRequest(`Invalid ${label}.`);
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
  return {
    id: String(department._id),
    name: department.name,
    code: department.code,
    description: department.description,
    isActive: department.isActive,
    memberCount: tally.members,
    headCount: tally.heads,
    teamCount: tally.team,
    createdAt: department.createdAt,
  };
}

export async function listDepartments(req, res) {
  const [departments, counts] = await Promise.all([
    Department.find().sort({ name: 1 }),
    countsByDepartment(),
  ]);

  res.json({
    success: true,
    departments: departments.map((department) => present(department, counts)),
  });
}

export async function getDepartment(req, res) {
  assertObjectId(req.params.id, 'department id');

  const department = await Department.findById(req.params.id);
  if (!department) throw ApiError.notFound('Department not found.');

  const members = await User.find({ 'memberships.department': department._id })
    .sort({ name: 1 })
    .populate('memberships.department', 'name code');

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

export async function createDepartment(req, res) {
  const { name, description, code } = req.body ?? {};

  if (!name?.trim()) throw ApiError.badRequest('Department name is required.');

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
    description: description?.trim() ?? '',
    createdBy: req.user._id,
  });

  res.status(201).json({ success: true, department: present(department) });
}

export async function updateDepartment(req, res) {
  assertObjectId(req.params.id, 'department id');

  const department = await Department.findById(req.params.id);
  if (!department) throw ApiError.notFound('Department not found.');

  const { name, description, isActive } = req.body ?? {};

  if (typeof name === 'string' && name.trim()) {
    const clash = await Department.exists({ name: name.trim(), _id: { $ne: department._id } });
    if (clash) throw ApiError.conflict('A department with this name already exists.');
    department.name = name.trim();
  }
  if (typeof description === 'string') department.description = description.trim();
  if (typeof isActive === 'boolean') department.isActive = isActive;

  await department.save();

  const counts = await countsByDepartment();
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

  const { name, email, password, role } = req.body ?? {};

  if (!email?.trim()) throw ApiError.badRequest('Email is required.');
  if (!DEPARTMENT_ROLES.includes(role)) {
    throw ApiError.badRequest(`Role must be one of: ${DEPARTMENT_ROLES.join(', ')}.`);
  }

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
    user.memberships.push({ department: department._id, role });
    await user.save({ validateBeforeSave: false });
  } else {
    if (!name?.trim()) throw ApiError.badRequest('Name is required for a new user.');
    if (!password || password.length < 8) {
      throw ApiError.badRequest('Password must be at least 8 characters.');
    }

    user = await User.create({
      name: name.trim(),
      email: normalisedEmail,
      password,
      role: 'user',
      status: 'active',
      memberships: [{ department: department._id, role }],
    });
  }

  const populated = await User.findById(user._id).populate('memberships.department', 'name code');

  res.status(201).json({
    success: true,
    member: { ...presentUser(populated), departmentRole: role },
  });
}

export async function updateMemberRole(req, res) {
  assertObjectId(req.params.id, 'department id');
  assertObjectId(req.params.userId, 'user id');

  const { role } = req.body ?? {};
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

  const populated = await User.findById(user._id).populate('memberships.department', 'name code');
  res.json({ success: true, member: { ...presentUser(populated), departmentRole: role } });
}

export async function removeMember(req, res) {
  assertObjectId(req.params.id, 'department id');
  assertObjectId(req.params.userId, 'user id');

  const result = await User.updateOne(
    { _id: req.params.userId },
    { $pull: { memberships: { department: req.params.id } } },
  );

  if (result.matchedCount === 0) throw ApiError.notFound('User not found.');

  res.json({ success: true });
}
