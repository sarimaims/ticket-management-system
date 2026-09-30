import { Router } from 'express';

import asyncHandler from '../utils/asyncHandler.js';
import { requireAdmin, requireAuth } from '../middleware/auth.js';
import {
  addMember,
  createDepartment,
  listDepartmentOptions,
  deleteDepartment,
  getDepartment,
  listAllMemberOptions,
  listDepartments,
  listMemberOptions,
  removeMember,
  updateDepartment,
  updateMemberDetails,
  updateMemberRole,
} from '../controllers/department.controller.js';

const router = Router();

router.use(requireAuth);

router.get('/', asyncHandler(listDepartments));
// Any signed-in user may list the names, so they can address a ticket.
router.get('/options', asyncHandler(listDepartmentOptions));
// Everyone who can be addressed, across departments. Declared before `/:id`
// so "members" is never read as a department id.
router.get('/members/options', asyncHandler(listAllMemberOptions));
router.get('/:id', asyncHandler(getDepartment));
// Names only, so a ticket can be addressed at a person rather than a queue.
// Reading the department itself stays restricted; this does not.
router.get('/:id/members/options', asyncHandler(listMemberOptions));

// Everything that changes the org chart needs management rights - except a
// head renaming their own department, which the controller allows and holds
// to the name alone.
router.post('/', requireAdmin, asyncHandler(createDepartment));
router.patch('/:id', asyncHandler(updateDepartment));
router.delete('/:id', requireAdmin, asyncHandler(deleteDepartment));

// Membership is guarded inside the controller: a head may run its own team,
// an admin may run any of them.
router.post('/:id/members', asyncHandler(addMember));
router.patch('/:id/members/:userId', asyncHandler(updateMemberRole));
// A member's name, phone and designation: a head for their team, an admin for anyone.
router.patch('/:id/members/:userId/details', asyncHandler(updateMemberDetails));
router.delete('/:id/members/:userId', asyncHandler(removeMember));

export default router;
