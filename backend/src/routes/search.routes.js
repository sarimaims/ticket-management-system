import { Router } from 'express';

import asyncHandler from '../utils/asyncHandler.js';
import { requireAuth } from '../middleware/auth.js';
import { search } from '../controllers/search.controller.js';

const router = Router();

// Anybody signed in may search; what comes back is only what they could open.
router.get('/', requireAuth, asyncHandler(search));

export default router;
