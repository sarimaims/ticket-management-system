import { Router } from 'express';

import asyncHandler from '../utils/asyncHandler.js';
import { requireAdmin, requireAuth } from '../middleware/auth.js';
import {
  createUnit,
  deleteUnit,
  getUnit,
  listUnitOptions,
  listUnits,
  updateUnit,
} from '../controllers/unit.controller.js';

const router = Router();

router.use(requireAuth);

router.get('/', asyncHandler(listUnits));
// Names only, so a department can be filed under one.
router.get('/options', asyncHandler(listUnitOptions));
router.get('/:id', asyncHandler(getUnit));

// The top of the org chart is a manager's to change.
router.post('/', requireAdmin, asyncHandler(createUnit));
router.patch('/:id', requireAdmin, asyncHandler(updateUnit));
router.delete('/:id', requireAdmin, asyncHandler(deleteUnit));

export default router;
