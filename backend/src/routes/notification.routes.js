import { Router } from 'express';

import asyncHandler from '../utils/asyncHandler.js';
import { requireAuth } from '../middleware/auth.js';
import {
  clearNotifications,
  listNotifications,
  markRead,
  streamNotifications,
} from '../controllers/notification.controller.js';

const router = Router();

// Every route here is scoped to the caller by the controller.
router.use(requireAuth);

router.get('/', asyncHandler(listNotifications));

// Long lived: no asyncHandler, because this one deliberately never resolves.
router.get('/stream', streamNotifications);
router.patch('/read', asyncHandler(markRead));
router.delete('/', asyncHandler(clearNotifications));

export default router;
