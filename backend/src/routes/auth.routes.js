import { Router } from 'express';

import asyncHandler from '../utils/asyncHandler.js';
import { requireAuth } from '../middleware/auth.js';
import { changePassword, login, logout, me } from '../controllers/auth.controller.js';

const router = Router();

router.post('/login', asyncHandler(login));
router.post('/logout', asyncHandler(logout));
router.get('/me', requireAuth, asyncHandler(me));
router.post('/password', requireAuth, asyncHandler(changePassword));

export default router;
