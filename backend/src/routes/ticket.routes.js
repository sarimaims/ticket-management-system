import { Router } from 'express';

import asyncHandler from '../utils/asyncHandler.js';
import { requireAuth } from '../middleware/auth.js';
import {
  createTicket,
  getTicket,
  listTickets,
  updateTicket,
} from '../controllers/ticket.controller.js';

const router = Router();

// Anyone signed in can raise a ticket; what they can read is decided per query.
router.use(requireAuth);

router.get('/', asyncHandler(listTickets));
router.post('/', asyncHandler(createTicket));
router.get('/:id', asyncHandler(getTicket));
router.patch('/:id', asyncHandler(updateTicket));

export default router;
