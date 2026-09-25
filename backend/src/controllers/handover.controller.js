import mongoose from 'mongoose';

import ApiError from '../utils/ApiError.js';
import HandoverRequest from '../models/HandoverRequest.js';
import Ticket from '../models/Ticket.js';
import User, { MANAGER_ROLES } from '../models/User.js';
import { record } from '../services/activity.js';
import { recordAssignment } from '../services/assignment.js';
import { postSystemMessage } from '../services/chat.js';
import {
  notifyHandoverAnswered,
  notifyHandoverAsked,
  notifyTicketUpdated,
} from '../services/notify.js';
import { canWorkOn, visibilityFilter } from '../services/ticketAccess.js';

/**
 * Who may move a ticket without being asked.
 *
 * A head runs the department and a manager oversees all of them, so both hand
 * work out directly. Nobody else does - least of all the person who raised it:
 * asking for something is not the same as deciding whose desk it lands on, and
 * a requester reaching into another department's rota is how work gets put on
 * people who never agreed to it.
 *
 * Everyone else asks, and the person asked decides.
 */
export function assignsDirectly(user, ticket) {
  if (MANAGER_ROLES.includes(user.role)) return true;
  return user.roleInDepartment(ticket.department?._id ?? ticket.department) === 'head';
}

async function readableTicket(req) {
  if (!mongoose.isValidObjectId(req.params.id)) throw ApiError.badRequest('Invalid ticket id.');

  const ticket = await Ticket.findOne({ _id: req.params.id, ...visibilityFilter(req.user) });
  if (!ticket) throw ApiError.notFound('Ticket not found.');
  return ticket;
}

function present(request) {
  return {
    id: String(request._id),
    ticket: String(request.ticket),
    requestedBy: { id: String(request.requestedBy), name: request.requestedByName },
    to: (request.to ?? []).map((id, index) => ({
      id: String(id),
      name: request.toNames?.[index] ?? '',
    })),
    note: request.note,
    status: request.status,
    decidedBy: request.decidedBy
      ? { id: String(request.decidedBy), name: request.decidedByName }
      : null,
    decidedAt: request.decidedAt,
    declinedBy: (request.declinedBy ?? []).map(String),
    createdAt: request.createdAt,
  };
}

/** Every ask on this ticket, newest first. Reading it is the right to read the ticket. */
export async function listHandovers(req, res) {
  const ticket = await readableTicket(req);
  const requests = await HandoverRequest.find({ ticket: ticket._id }).sort({ createdAt: -1 });

  res.json({ success: true, handovers: requests.map(present) });
}

/**
 * Asks somebody to take the ticket on.
 *
 * Only the people holding it may ask, because an offer to hand over is only
 * meaningful from someone who has it, and only people who do not already hold
 * it can be asked. A head never gets here: they assign directly instead.
 */
export async function createHandover(req, res) {
  const ticket = await readableTicket(req);

  if (!canWorkOn(req.user, ticket)) {
    throw ApiError.forbidden('Only the receiving department can hand this ticket on.');
  }

  const holders = (ticket.assignees ?? []).map(String);
  if (!holders.includes(String(req.user._id))) {
    throw ApiError.forbidden('Only somebody holding this ticket can ask another to take it.');
  }

  const { to, note } = req.body ?? {};
  if (!Array.isArray(to) || to.length === 0) {
    throw ApiError.badRequest('Choose at least one person to ask.');
  }

  const wanted = [...new Set(to.filter(Boolean).map(String))];
  const people = [];

  for (const userId of wanted) {
    if (!mongoose.isValidObjectId(userId)) throw ApiError.badRequest('Invalid person.');
    if (holders.includes(userId)) {
      throw ApiError.badRequest('That person already holds this ticket.');
    }

    // eslint-disable-next-line no-await-in-loop
    const candidate = await User.findById(userId).select('name role memberships status');
    const belongs =
      candidate &&
      candidate.status !== 'suspended' &&
      (MANAGER_ROLES.includes(candidate.role) || candidate.roleInDepartment(ticket.department));

    if (!belongs) throw ApiError.badRequest('That person is not in this department.');
    // The head is not asked: releasing the ticket is how it goes back to them.
    if (candidate.roleInDepartment(ticket.department) === 'head') {
      throw ApiError.badRequest('Release the ticket to hand it back to the head.');
    }
    people.push(candidate);
  }

  // One open ask at a time per person doing the asking: a second would leave
  // two answers racing for the same ticket.
  const open = await HandoverRequest.findOne({
    ticket: ticket._id,
    requestedBy: req.user._id,
    status: 'pending',
  });
  if (open) {
    throw ApiError.conflict('You already have an open request on this ticket.');
  }

  const request = await HandoverRequest.create({
    ticket: ticket._id,
    requestedBy: req.user._id,
    requestedByName: req.user.name,
    to: people.map((person) => person._id),
    toNames: people.map((person) => person.name),
    note: typeof note === 'string' ? note.trim().slice(0, 500) : '',
  });

  const names = people.map((person) => person.name).join(', ');

  await postSystemMessage({
    ticket,
    actor: req.user,
    event: 'assignment',
    body: `asked ${names} to take this on`,
  });
  await notifyHandoverAsked({ ticket, actor: req.user, recipients: people.map((p) => p._id) });

  res.status(201).json({ success: true, handover: present(request) });
}

/**
 * Takes the ticket on, or turns it down.
 *
 * Accepting is what actually moves it: the person who asked steps off and the
 * person who accepted steps on, which is the whole point of asking rather than
 * assigning. Anyone else still asked is let go at the same time, because the
 * ticket has already moved.
 */
export async function answerHandover(req, res) {
  const ticket = await readableTicket(req);

  if (!mongoose.isValidObjectId(req.params.handoverId)) {
    throw ApiError.badRequest('Invalid request id.');
  }

  const request = await HandoverRequest.findOne({
    _id: req.params.handoverId,
    ticket: ticket._id,
  });
  if (!request) throw ApiError.notFound('That request no longer exists.');

  const me = String(req.user._id);
  const asked = (request.to ?? []).map(String).includes(me);
  const mine = String(request.requestedBy) === me;

  const { answer } = req.body ?? {};

  // Whoever asked may take it back while nobody has answered.
  if (answer === 'cancel') {
    if (!mine) throw ApiError.forbidden('Only the person who asked can withdraw it.');
    if (request.status !== 'pending') throw ApiError.badRequest('That request is already closed.');

    request.status = 'cancelled';
    request.decidedBy = req.user._id;
    request.decidedByName = req.user.name;
    request.decidedAt = new Date();
    await request.save();

    return res.json({ success: true, handover: present(request) });
  }

  if (!asked) throw ApiError.forbidden('That request was not addressed to you.');
  if (request.status !== 'pending') throw ApiError.badRequest('That request is already closed.');

  if (answer === 'decline') {
    if (!request.declinedBy.some((id) => String(id) === me)) request.declinedBy.push(req.user._id);

    // Still open while somebody asked has not answered; closed once nobody is
    // left to say yes.
    const outstanding = (request.to ?? []).filter(
      (id) => !request.declinedBy.some((no) => String(no) === String(id)),
    );
    if (outstanding.length === 0) {
      request.status = 'declined';
      request.decidedBy = req.user._id;
      request.decidedByName = req.user.name;
      request.decidedAt = new Date();
    }

    await request.save();
    await postSystemMessage({
      ticket,
      actor: req.user,
      event: 'assignment',
      body: `turned down ${request.requestedByName}'s request to take this on`,
    });
    await notifyHandoverAnswered({
      ticket,
      actor: req.user,
      recipient: request.requestedBy,
      accepted: false,
    });

    return res.json({ success: true, handover: present(request) });
  }

  if (answer !== 'accept') throw ApiError.badRequest('Answer must be accept, decline or cancel.');

  // The move itself: off the asker, onto the accepter. Everyone else holding
  // it stays, because they were never part of this ask.
  const from = await User.find({ _id: { $in: ticket.assignees ?? [] } }).select('name');
  const held = (ticket.assignees ?? [])
    .map(String)
    .filter((id) => id !== String(request.requestedBy));

  if (!held.includes(me)) held.push(me);
  ticket.assignees = held;
  await ticket.save();

  request.status = 'accepted';
  request.decidedBy = req.user._id;
  request.decidedByName = req.user.name;
  request.decidedAt = new Date();
  await request.save();

  // The ticket has moved, so any other ask on it is moot.
  await HandoverRequest.updateMany(
    { ticket: ticket._id, status: 'pending', _id: { $ne: request._id } },
    { $set: { status: 'cancelled', decidedAt: new Date() } },
  );

  const to = await User.find({ _id: { $in: ticket.assignees } }).select('name');
  await recordAssignment({ ticket, from, to, actor: req.user });

  const summary = `assigned to ${to.map((person) => person.name).join(', ')}`;
  await postSystemMessage({
    ticket,
    actor: req.user,
    event: 'assignment',
    body: `took this on from ${request.requestedByName}`,
  });

  const populated = await Ticket.findById(ticket._id).populate('department', 'name');
  await record({
    actor: req.user,
    department: populated.department,
    action: 'ticket.updated',
    summary: `updated ${populated.number}: ${summary}`,
    ticketNumber: populated.number,
  });
  await notifyHandoverAnswered({
    ticket,
    actor: req.user,
    recipient: request.requestedBy,
    accepted: true,
  });

  res.json({ success: true, handover: present(request) });
}

/**
 * Gives a ticket back.
 *
 * The holder steps off it. Anyone else still on it keeps it; if that leaves
 * nobody, it goes back to being unassigned - which is where a ticket nobody
 * was named for starts, and means the same thing: it sits in the department's
 * All Tickets for the head to hand out again.
 *
 * Any ask this person still has out is withdrawn with it, since they no
 * longer have anything to hand on.
 */
export async function releaseTicket(req, res) {
  const ticket = await readableTicket(req);

  if (!canWorkOn(req.user, ticket)) {
    throw ApiError.forbidden('Only the receiving department can release this ticket.');
  }

  const me = String(req.user._id);
  const holders = (ticket.assignees ?? []).map(String);
  if (!holders.includes(me)) {
    throw ApiError.forbidden('Only somebody holding this ticket can release it.');
  }

  const from = await User.find({ _id: { $in: ticket.assignees ?? [] } }).select('name');

  // Whoever is left, which is often nobody - and nobody is the answer: the
  // head picks it up off the department's queue like any other unheld ticket.
  ticket.assignees = holders.filter((id) => id !== me);
  await ticket.save();

  await HandoverRequest.updateMany(
    { ticket: ticket._id, requestedBy: req.user._id, status: 'pending' },
    {
      $set: {
        status: 'cancelled',
        decidedBy: req.user._id,
        decidedByName: req.user.name,
        decidedAt: new Date(),
      },
    },
  );

  const to = await User.find({ _id: { $in: ticket.assignees } }).select('name');
  await recordAssignment({ ticket, from, to, actor: req.user });

  const names = to.map((person) => person.name).join(', ');
  await postSystemMessage({
    ticket,
    actor: req.user,
    event: 'assignment',
    body: names ? `released this back to ${names}` : 'released this back to the department',
  });

  const populated = await Ticket.findById(ticket._id).populate('department', 'name');
  await record({
    actor: req.user,
    department: populated.department,
    action: 'ticket.updated',
    summary: `updated ${populated.number}: ${names ? `assigned to ${names}` : 'released'}`,
    ticketNumber: populated.number,
  });

  // Work has just landed back on somebody's list without their asking for it.
  // With nobody holding it that somebody is the head, which is exactly who the
  // bell reaches for an unheld ticket.
  await notifyTicketUpdated({
    ticket: populated,
    actor: req.user,
    summary: names ? `released back to ${names}` : 'released back to the department',
    event: 'assigned',
  });

  res.json({
    success: true,
    assignees: to.map((person) => ({ id: String(person._id), name: person.name })),
  });
}
