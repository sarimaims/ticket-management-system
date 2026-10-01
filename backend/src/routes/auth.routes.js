import { Router } from 'express';

import asyncHandler from '../utils/asyncHandler.js';
import { requireAdmin, requireAuth } from '../middleware/auth.js';
import {
  changeName,
  changePassword,
  changePhone,
  login,
  logout,
  me,
  updateOwnProfile,
} from '../controllers/auth.controller.js';

const router = Router();

router.post('/login', asyncHandler(login));
router.post('/logout', asyncHandler(logout));
router.get('/me', requireAuth, asyncHandler(me));
router.post('/password', requireAuth, asyncHandler(changePassword));
// Your own number, which you may set or change but never empty.
router.post('/phone', requireAuth, asyncHandler(changePhone));
// Your own name: the super admin and admins only, as nobody sits above them.
router.post('/name', requireAuth, requireAdmin, asyncHandler(changeName));
// The super admin's own name, designation, email and phone. Checked in the controller.
router.post('/profile', requireAuth, asyncHandler(updateOwnProfile));

export default router;
