import { Router } from 'express';

import asyncHandler from '../utils/asyncHandler.js';
import { requireAdmin, requireAuth } from '../middleware/auth.js';
import {
  createUser,
  deleteUser,
  getUserProfile,
  listMyTeam,
  listUsers,
  updateUser,
} from '../controllers/user.controller.js';

const router = Router();

// A head's own team. Declared before the admin gate below, because this is the
// one thing here that is not an admin's to do: the controller works out the
// scope from who is asking and refuses anyone who runs no department.
router.get('/team', requireAuth, asyncHandler(listMyTeam));

// One person's card, opened from a name anywhere in the app. Also declared
// above the admin gate: anybody signed in may look up a colleague.
router.get('/:id/profile', requireAuth, asyncHandler(getUserProfile));

// Everything else is the directory, managed by the super admin and admins.
router.use(requireAuth, requireAdmin);

router.get('/', asyncHandler(listUsers));
router.post('/', asyncHandler(createUser));
router.patch('/:id', asyncHandler(updateUser));
router.delete('/:id', asyncHandler(deleteUser));

export default router;
