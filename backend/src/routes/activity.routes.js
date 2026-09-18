import { Router } from 'express';

import asyncHandler from '../utils/asyncHandler.js';
import { requireAdmin, requireAuth } from '../middleware/auth.js';
import { clearActivity, listActivity } from '../controllers/activity.controller.js';

const router = Router();

router.use(requireAuth);

// Everyone reads their own departments' log; the controller decides the scope.
router.get('/', asyncHandler(listActivity));

// Wiping history is a manager's call.
router.delete('/', requireAdmin, asyncHandler(clearActivity));

export default router;
