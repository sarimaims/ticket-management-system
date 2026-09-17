import { Router } from 'express';

import asyncHandler from '../utils/asyncHandler.js';
import { requireAdmin, requireAuth } from '../middleware/auth.js';
import { createUser, deleteUser, listUsers, updateUser } from '../controllers/user.controller.js';

const router = Router();

// The directory is managed by the super admin and by admins alike.
router.use(requireAuth, requireAdmin);

router.get('/', asyncHandler(listUsers));
router.post('/', asyncHandler(createUser));
router.patch('/:id', asyncHandler(updateUser));
router.delete('/:id', asyncHandler(deleteUser));

export default router;
