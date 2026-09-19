import mongoose from 'mongoose';

import ApiError from '../utils/ApiError.js';
import Department from '../models/Department.js';
import Unit from '../models/Unit.js';
import User, { MANAGER_ROLES } from '../models/User.js';
import { record } from '../services/activity.js';

function assertObjectId(id, label = 'id') {
  if (!mongoose.isValidObjectId(id)) throw ApiError.badRequest(`Invalid ${label}.`);
}

const isManager = (user) => MANAGER_ROLES.includes(user.role);

/** The units a non-manager may look at: the ones their departments sit under. */
async function myUnitIds(user) {
  const departmentIds = (user.memberships ?? []).map((membership) => membership.department);
  if (departmentIds.length === 0) return [];

  const departments = await Department.find({ _id: { $in: departmentIds } }).select('unit');
  return [...new Set(departments.map((department) => String(department.unit)))];
}

/**
 * Department and member counts for every unit, in two round trips rather than
 * one per row.
 */
async function tallies() {
  const [departments, members] = await Promise.all([
    Department.aggregate([
      { $group: { _id: '$unit', departments: { $sum: 1 }, ids: { $push: '$_id' } } },
    ]),
    User.aggregate([
      { $unwind: '$memberships' },
      { $group: { _id: '$memberships.department', members: { $sum: 1 } } },
    ]),
  ]);

  const perDepartment = new Map(members.map((row) => [String(row._id), row.members]));

  return new Map(
    departments.map((row) => [
      String(row._id),
      {
        departments: row.departments,
        // A person in two departments of the same unit counts once per
        // department here, which is what "members across the unit" means.
        members: row.ids.reduce((sum, id) => sum + (perDepartment.get(String(id)) ?? 0), 0),
      },
    ]),
  );
}

function present(unit, counts) {
  const tally = counts?.get(String(unit._id)) ?? { departments: 0, members: 0 };
  return {
    id: String(unit._id),
    name: unit.name,
    code: unit.code,
    description: unit.description,
    isActive: unit.isActive,
    departmentCount: tally.departments,
    memberCount: tally.members,
    createdAt: unit.createdAt,
  };
}

/** A unique code, derived from the name unless one was given. */
async function uniqueCode(name, given) {
  let candidate = (given?.trim() || Unit.codeFrom(name)).toUpperCase();
  let suffix = 1;
  while (await Unit.exists({ code: candidate })) {
    suffix += 1;
    candidate = `${Unit.codeFrom(name)}${suffix}`.slice(0, 8);
  }
  return candidate;
}

export async function listUnits(req, res) {
  const filter = isManager(req.user) ? {} : { _id: { $in: await myUnitIds(req.user) } };

  const [units, counts] = await Promise.all([Unit.find(filter).sort({ name: 1 }), tallies()]);

  res.json({ success: true, units: units.map((unit) => present(unit, counts)) });
}

/**
 * Names only, for the picker that puts a department under a unit. Kept apart
 * from listUnits so choosing a parent never depends on being allowed to
 * inspect one.
 */
export async function listUnitOptions(req, res) {
  const units = await Unit.find({ isActive: true }).select('name code').sort({ name: 1 });

  res.json({
    success: true,
    units: units.map((unit) => ({ id: String(unit._id), name: unit.name, code: unit.code })),
  });
}

/** One unit and the departments under it. */
export async function getUnit(req, res) {
  assertObjectId(req.params.id, 'unit id');

  const unit = await Unit.findById(req.params.id);
  if (!unit) throw ApiError.notFound('Unit not found.');

  if (!isManager(req.user)) {
    const mine = await myUnitIds(req.user);
    if (!mine.includes(String(unit._id))) {
      throw ApiError.forbidden('You can only view a unit you belong to.');
    }
  }

  const departments = await Department.find({ unit: unit._id }).sort({ name: 1 });
  const memberCounts = await User.aggregate([
    { $unwind: '$memberships' },
    { $match: { 'memberships.department': { $in: departments.map((item) => item._id) } } },
    {
      $group: {
        _id: '$memberships.department',
        members: { $sum: 1 },
        heads: { $sum: { $cond: [{ $eq: ['$memberships.role', 'head'] }, 1, 0] } },
      },
    },
  ]);
  const perDepartment = new Map(memberCounts.map((row) => [String(row._id), row]));
  const counts = await tallies();

  res.json({
    success: true,
    unit: present(unit, counts),
    departments: departments.map((department) => {
      const tally = perDepartment.get(String(department._id)) ?? { members: 0, heads: 0 };
      return {
        id: String(department._id),
        name: department.name,
        code: department.code,
        description: department.description,
        isActive: department.isActive,
        memberCount: tally.members,
        headCount: tally.heads,
        teamCount: tally.members - tally.heads,
        createdAt: department.createdAt,
      };
    }),
  });
}

export async function createUnit(req, res) {
  const { name, description, code } = req.body ?? {};

  if (!name?.trim()) throw ApiError.badRequest('Unit name is required.');

  const trimmed = name.trim();
  if (await Unit.exists({ name: trimmed })) {
    throw ApiError.conflict('A unit with this name already exists.');
  }

  const unit = await Unit.create({
    name: trimmed,
    code: await uniqueCode(trimmed, code),
    description: description?.trim() ?? '',
    createdBy: req.user._id,
  });

  await record({
    actor: req.user,
    department: null,
    action: 'unit.created',
    summary: `created the unit ${unit.name}`,
  });

  res.status(201).json({ success: true, unit: present(unit) });
}

export async function updateUnit(req, res) {
  assertObjectId(req.params.id, 'unit id');

  const unit = await Unit.findById(req.params.id);
  if (!unit) throw ApiError.notFound('Unit not found.');

  const { name, description, isActive } = req.body ?? {};

  if (typeof name === 'string' && name.trim()) {
    const clash = await Unit.exists({ name: name.trim(), _id: { $ne: unit._id } });
    if (clash) throw ApiError.conflict('A unit with this name already exists.');
    unit.name = name.trim();
  }
  if (typeof description === 'string') unit.description = description.trim();
  if (typeof isActive === 'boolean') unit.isActive = isActive;

  await unit.save();

  await record({
    actor: req.user,
    department: null,
    action: 'unit.updated',
    summary: `updated the unit ${unit.name}`,
  });

  const counts = await tallies();
  res.json({ success: true, unit: present(unit, counts) });
}

/**
 * Deleting a unit never cascades into departments: that would take their
 * members and tickets with it. The departments have to be moved or deleted
 * first, and the message says how many are in the way.
 */
export async function deleteUnit(req, res) {
  assertObjectId(req.params.id, 'unit id');

  const unit = await Unit.findById(req.params.id);
  if (!unit) throw ApiError.notFound('Unit not found.');

  const inside = await Department.countDocuments({ unit: unit._id });
  if (inside > 0) {
    throw ApiError.conflict(
      `${unit.name} still holds ${inside} department${inside === 1 ? '' : 's'}. Move or delete them first.`,
    );
  }

  await unit.deleteOne();

  await record({
    actor: req.user,
    department: null,
    action: 'unit.deleted',
    summary: `deleted the unit ${unit.name}`,
  });

  res.json({ success: true });
}
