import { Router } from 'express';

import asyncHandler from '../utils/asyncHandler.js';
import { requireAdmin, requireAuth } from '../middleware/auth.js';
import {
  addMember,
  createDepartment,
  deleteDepartment,
  getDepartment,
  listDepartments,
  removeMember,
  updateDepartment,
  updateMemberRole,
} from '../controllers/department.controller.js';

const router = Router();

router.use(requireAuth);

router.get('/', asyncHandler(listDepartments));
router.get('/:id', asyncHandler(getDepartment));

// Everything that changes the org chart needs management rights.
router.post('/', requireAdmin, asyncHandler(createDepartment));
router.patch('/:id', requireAdmin, asyncHandler(updateDepartment));
router.delete('/:id', requireAdmin, asyncHandler(deleteDepartment));

router.post('/:id/members', requireAdmin, asyncHandler(addMember));
router.patch('/:id/members/:userId', requireAdmin, asyncHandler(updateMemberRole));
router.delete('/:id/members/:userId', requireAdmin, asyncHandler(removeMember));

export default router;
