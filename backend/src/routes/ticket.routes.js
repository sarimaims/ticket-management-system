import { Router } from 'express';

import asyncHandler from '../utils/asyncHandler.js';
import { requireAuth } from '../middleware/auth.js';
import {
  createTicket,
  getTicket,
  listTickets,
  updateTicket,
} from '../controllers/ticket.controller.js';
import {
  createMessage,
  createUploadTarget,
  listMessages,
} from '../controllers/message.controller.js';

const router = Router();

// Anyone signed in can raise a ticket; what they can read is decided per query.
router.use(requireAuth);

router.get('/', asyncHandler(listTickets));
router.post('/', asyncHandler(createTicket));
router.get('/:id', asyncHandler(getTicket));
router.patch('/:id', asyncHandler(updateTicket));

// The conversation on one ticket. Reading it is the right to read the ticket.
router.get('/:id/messages', asyncHandler(listMessages));
router.post('/:id/messages', asyncHandler(createMessage));
// A URL the browser PUTs a photo or a voice note to, before saying anything.
router.post('/:id/messages/upload-url', asyncHandler(createUploadTarget));

export default router;
