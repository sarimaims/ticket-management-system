import { Router } from 'express';

import asyncHandler from '../utils/asyncHandler.js';
import { requireAdmin, requireAuth } from '../middleware/auth.js';
import {
  addMember,
  createDepartment,
  listDepartmentOptions,
  deleteDepartment,
  getDepartment,
  listDepartments,
  listMemberOptions,
  removeMember,
  updateDepartment,
  updateMemberRole,
} from '../controllers/department.controller.js';

const router = Router();

router.use(requireAuth);

router.get('/', asyncHandler(listDepartments));
// Any signed-in user may list the names, so they can address a ticket.
router.get('/options', asyncHandler(listDepartmentOptions));
router.get('/:id', asyncHandler(getDepartment));
// Names only, so a ticket can be addressed at a person rather than a queue.
// Reading the department itself stays restricted; this does not.
router.get('/:id/members/options', asyncHandler(listMemberOptions));

// Everything that changes the org chart needs management rights.
router.post('/', requireAdmin, asyncHandler(createDepartment));
router.patch('/:id', requireAdmin, asyncHandler(updateDepartment));
router.delete('/:id', requireAdmin, asyncHandler(deleteDepartment));

// Membership is guarded inside the controller: a head may run its own team,
// an admin may run any of them.
router.post('/:id/members', asyncHandler(addMember));
router.patch('/:id/members/:userId', asyncHandler(updateMemberRole));
router.delete('/:id/members/:userId', asyncHandler(removeMember));

export default router;
