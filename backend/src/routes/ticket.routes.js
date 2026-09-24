import { Router } from 'express';

import asyncHandler from '../utils/asyncHandler.js';
import { requireAuth } from '../middleware/auth.js';
import {
  createTicket,
  createTicketUploadTarget,
  deleteTicket,
  deleteTickets,
  downloadAttachment,
  getTicket,
  listAssignments,
  listTickets,
  reassignTickets,
  updateTicket,
} from '../controllers/ticket.controller.js';
import {
  answerHandover,
  createHandover,
  listHandovers,
} from '../controllers/handover.controller.js';
import {
  createMessage,
  createUploadTarget,
  deleteMessage,
  listMessages,
  messageInfo,
  updateMessage,
} from '../controllers/message.controller.js';

const router = Router();

// Anyone signed in can raise a ticket; what they can read is decided per query.
router.use(requireAuth);

router.get('/', asyncHandler(listTickets));
router.post('/', asyncHandler(createTicket));

// A URL the browser PUTs a file to while the form is still being filled in.
// Declared before '/:id' so "attachments" is never read as a ticket id.
router.post('/attachments/upload-url', asyncHandler(createTicketUploadTarget));
// One file back, as a redirect to a link signed at the moment it is followed.
router.get('/:id/attachments/:index', asyncHandler(downloadAttachment));

router.get('/:id', asyncHandler(getTicket));

// A batch handed over in one go. Same right as working one ticket, applied to
// each of them, and each gets its own line in its own trail.
router.patch('/', asyncHandler(reassignTickets));
router.patch('/:id', asyncHandler(updateTicket));

// Deleting takes a ticket away from everyone who could see it, along with the
// conversation on it. Who may do it is decided per ticket in the controller: a
// manager at any time, and whoever raised it for a short while afterwards.
router.delete('/', asyncHandler(deleteTickets));
router.delete('/:id', asyncHandler(deleteTicket));

// The conversation on one ticket. Reading it is the right to read the ticket.
router.get('/:id/messages', asyncHandler(listMessages));
router.post('/:id/messages', asyncHandler(createMessage));
// A URL the browser PUTs a photo or a voice note to, before saying anything.
router.post('/:id/messages/upload-url', asyncHandler(createUploadTarget));

// When a line was said, and who has had the thread open since.
router.get('/:id/messages/:messageId/info', asyncHandler(messageInfo));

// An author corrects or withdraws their own line; the controller checks that.
router.patch('/:id/messages/:messageId', asyncHandler(updateMessage));
router.delete('/:id/messages/:messageId', asyncHandler(deleteMessage));

// Asking somebody to take a ticket on, and their answer. A head assigns
// instead, through PATCH above - see the controller for which is which.
router.get('/:id/handovers', asyncHandler(listHandovers));
router.post('/:id/handovers', asyncHandler(createHandover));
router.patch('/:id/handovers/:handoverId', asyncHandler(answerHandover));

// Who has held it, and who handed it on. Written by raising and updating a
// ticket, never posted to directly - a history anyone can write is not one.
router.get('/:id/assignments', asyncHandler(listAssignments));

export default router;
