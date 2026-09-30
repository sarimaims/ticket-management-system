import ApiError from '../utils/ApiError.js';
import { phoneNumber } from '../utils/phoneNumber.js';
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
    /** Accounts made before the field existed have none until they are edited. */
    phone: user.phone ?? '',
    designation: user.designation ?? '',
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
        designation: membership.designation ?? '',
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

/**
 * Your own phone number: set it, or change it to another one.
 *
 * Not cleared, ever. The number is on every ticket this person raises so the
 * work can be chased at five o'clock, and an account that can quietly empty
 * the field is an account nobody can reach. Changing it to a different number
 * is always allowed - it is theirs, and a new SIM should not need an admin.
 *
 * The email stays with an admin, and so does a member's name: those are how
 * everyone else recognises this person, and are not for the person to rewrite.
 * A manager's name is the exception - see changeName.
 */
export async function changePhone(req, res) {
  const { phone } = req.body ?? {};

  if (phone === null || (typeof phone === 'string' && phone.trim() === '')) {
    throw ApiError.badRequest('A phone number cannot be removed, only changed.');
  }

  // Throws with the reason when it is not one: same check the directory uses,
  // so a number saved here is a number saved anywhere.
  const number = phoneNumber(phone);

  const user = await User.findById(req.user._id);
  if (!user) throw ApiError.unauthorized('This session is no longer valid.');

  user.phone = number;
  await user.save();

  res.json({
    success: true,
    user: presentUser(await loadWithDepartments(user._id)),
    features: { attachments: storageReady() },
  });
}

/**
 * Your own name, for the super admin and admins only.
 *
 * A member's name is set by an admin. A manager's has nobody above it to ask -
 * the super admin least of all - so they correct their own here rather than
 * through the directory, which asks for a whole profile to change one field.
 */
export async function changeName(req, res) {
  const { name } = req.body ?? {};

  if (typeof name !== 'string' || !name.trim()) {
    throw ApiError.badRequest('Name cannot be empty.');
  }
  if (name.trim().length > 80) {
    throw ApiError.badRequest('Name must be 80 characters or fewer.');
  }

  const user = await User.findById(req.user._id);
  if (!user) throw ApiError.unauthorized('This session is no longer valid.');

  user.name = name.trim();
  await user.save({ validateModifiedOnly: true });

  // The session cache holds this account for a few seconds; the new name
  // should be on the next request, not the one after.
  forgetUser(user._id);

  res.json({
    success: true,
    user: presentUser(await loadWithDepartments(user._id)),
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
  await user.save({ validateModifiedOnly: true });
  forgetUser(user._id);

  // A fresh cookie, so the browser that made the change keeps its full seven
  // days rather than expiring on the old clock.
  setAuthCookie(res, signToken(user));
  res.json({ success: true });
}
