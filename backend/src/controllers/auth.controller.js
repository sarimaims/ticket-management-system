import ApiError from '../utils/ApiError.js';
import User from '../models/User.js';
import { clearAuthCookie, setAuthCookie, signToken } from '../utils/token.js';

/** Shape sent to the client. Never includes the password hash. */
export function presentUser(user) {
  return {
    id: String(user._id),
    name: user.name,
    email: user.email,
    role: user.role,
    status: user.status,
    departments: (user.memberships ?? []).map((membership) => {
      const department = membership.department;
      const populated = department && typeof department === 'object' && department.name;
      const unit = populated ? department.unit : null;
      const unitPopulated = unit && typeof unit === 'object' && unit.name;

      return {
        id: String(populated ? department._id : department),
        name: populated ? department.name : undefined,
        code: populated ? department.code : undefined,
        role: membership.role,
        unit: unit
          ? { id: String(unitPopulated ? unit._id : unit), name: unitPopulated ? unit.name : undefined }
          : null,
      };
    }),
    createdAt: user.createdAt,
    lastActiveAt: user.lastActiveAt,
  };
}

const WITH_DEPARTMENTS = {
  path: 'memberships.department',
  select: 'name code unit',
  populate: { path: 'unit', select: 'name code' },
};

async function loadWithDepartments(userId) {
  return User.findById(userId).populate(WITH_DEPARTMENTS);
}

export { WITH_DEPARTMENTS };

export async function login(req, res) {
  const { email, password } = req.body ?? {};

  if (!email?.trim() || !password) {
    throw ApiError.badRequest('Email and password are required.');
  }

  const user = await User.findOne({ email: email.trim().toLowerCase() }).select('+password');

  // Same message either way, so the response cannot be used to discover which
  // emails have accounts.
  if (!user || !(await user.verifyPassword(password))) {
    throw ApiError.unauthorized('Email or password is incorrect.');
  }
  if (user.status === 'suspended') {
    throw ApiError.forbidden('This account is suspended.');
  }

  user.lastActiveAt = new Date();
  await user.save({ validateBeforeSave: false });

  setAuthCookie(res, signToken(user));
  res.json({ success: true, user: presentUser(await loadWithDepartments(user._id)) });
}

export async function logout(req, res) {
  clearAuthCookie(res);
  res.json({ success: true });
}

export async function me(req, res) {
  res.json({ success: true, user: presentUser(await loadWithDepartments(req.user._id)) });
}
