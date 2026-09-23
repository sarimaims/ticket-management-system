import ApiError from '../utils/ApiError.js';
import { forgetUser } from '../middleware/auth.js';
import User from '../models/User.js';
import { clearAuthCookie, setAuthCookie, signToken } from '../utils/token.js';
import { isConfigured as storageReady } from '../services/storage.js';

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
  res.json({
    success: true,
    user: presentUser(await loadWithDepartments(user._id)),
    features: { attachments: storageReady() },
  });
}

export async function logout(req, res) {
  clearAuthCookie(res);
  res.json({ success: true });
}

export async function me(req, res) {
  res.json({
    success: true,
    user: presentUser(await loadWithDepartments(req.user._id)),
    // What this deployment can actually do, so the app does not offer a
    // button that is bound to fail.
    features: { attachments: storageReady() },
  });
}

/** The shortest password this workspace accepts, as everywhere else. */
const MIN_PASSWORD = 8;

/**
 * Changing your own password. The current one is asked for even though the
 * session already proves who you are: a browser left open on a shared desk
 * should not be enough to lock the owner out of their own account.
 */
export async function changePassword(req, res) {
  const { currentPassword, newPassword } = req.body ?? {};

  if (!currentPassword || !newPassword) {
    throw ApiError.badRequest('Your current and new password are both required.');
  }
  if (typeof newPassword !== 'string' || newPassword.length < MIN_PASSWORD) {
    throw ApiError.badRequest(`The new password must be at least ${MIN_PASSWORD} characters.`);
  }
  if (newPassword === currentPassword) {
    throw ApiError.badRequest('The new password must be different from the current one.');
  }

  // requireAuth left the user here without the hash, which is select: false.
  const user = await User.findById(req.user._id).select('+password');
  if (!user) throw ApiError.unauthorized('This session is no longer valid.');

  if (!(await user.verifyPassword(currentPassword))) {
    throw ApiError.badRequest('Your current password is not correct.');
  }

  // The model hashes it on save; the plain value never reaches the database.
  user.password = newPassword;
  await user.save();
  forgetUser(user._id);

  // A fresh cookie, so the browser that made the change keeps its full seven
  // days rather than expiring on the old clock.
  setAuthCookie(res, signToken(user));
  res.json({ success: true });
}
