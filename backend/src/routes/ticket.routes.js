import { Router } from 'express';

import asyncHandler from '../utils/asyncHandler.js';
import { requireAuth } from '../middleware/auth.js';
import {
  answerApproval,
  countEscalations,
  getDashboard,
  createTicket,
  createTicketUploadTarget,
  deleteTicket,
  deleteTickets,
  downloadAttachment,
  downloadAttachmentsArchive,
  escalateTicket,
  getTicket,
  handleEscalation,
  listApprovals,
  listAssignments,
  listTickets,
  reassignTickets,
  updateTicket,
} from '../controllers/ticket.controller.js';
import {
  answerHandover,
  createHandover,
  listHandovers,
  releaseTicket,
} from '../controllers/handover.controller.js';
import {
  createMessage,
  createUploadTarget,
  deleteMessage,
  listLibrary,
  listMedia,
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
// All of them at once. Built here rather than redirected to, because a zip of
// several objects does not exist in the bucket to be signed.
router.get('/:id/attachments.zip', asyncHandler(downloadAttachmentsArchive));

// My requests waiting on my sign-off. Before '/:id', so the word is never
// read as a ticket id.
router.get('/approvals', asyncHandler(listApprovals));
// Every file, photo, video and link across the tickets this person can see.
router.get('/media', asyncHandler(listLibrary));
// How many escalations are open, for the super admin's sidebar.
router.get('/escalations/count', asyncHandler(countEscalations));
// The dashboard, shaped by the reader's role. Before '/:id' like the rest.
router.get('/dashboard', asyncHandler(getDashboard));

router.get('/:id', asyncHandler(getTicket));

// The requester's answer to a resolved ticket: approve it, or send it back.
router.post('/:id/approval', asyncHandler(answerApproval));

// Put a ticket in front of the super admin, and - theirs alone - close it.
router.post('/:id/escalate', asyncHandler(escalateTicket));
router.post('/:id/escalation/handle', asyncHandler(handleEscalation));

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
// A URL the browser PUTs a photo, video, document or voice note to, before
// saying anything.
router.post('/:id/messages/upload-url', asyncHandler(createUploadTarget));

// Everything the thread has shared, grouped the way a phone does it - media,
// documents and links - and searchable by the name each file was sent with.
router.get('/:id/media', asyncHandler(listMedia));

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
// Giving it back: off the holder, and to the head if nobody else is left.
router.post('/:id/release', asyncHandler(releaseTicket));

// Who has held it, and who handed it on. Written by raising and updating a
// ticket, never posted to directly - a history anyone can write is not one.
router.get('/:id/assignments', asyncHandler(listAssignments));

export default router;
