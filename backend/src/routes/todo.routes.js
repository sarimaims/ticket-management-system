import { Router } from 'express';

import asyncHandler from '../utils/asyncHandler.js';
import { requireAuth } from '../middleware/auth.js';
import {
  createBoard,
  createColumn,
  deleteBoard,
  listBoards,
  updateBoard,
  createTodo,
  deleteColumn,
  deleteTodo,
  getBoard,
  getSummary,
  moveTodo,
  reorderColumns,
  updateColumn,
  updateTodo,
} from '../controllers/todo.controller.js';

const router = Router();

// A personal board: every route is scoped to the caller by the controller.
router.use(requireAuth);

// `?board=<id>`: one workspace's columns and cards.
router.get('/', asyncHandler(getBoard));

// Everything at once, for the dashboard.
router.get('/summary', asyncHandler(getSummary));
router.get('/boards', asyncHandler(listBoards));
router.post('/boards', asyncHandler(createBoard));
router.patch('/boards/:id', asyncHandler(updateBoard));
router.delete('/boards/:id', asyncHandler(deleteBoard));

router.post('/columns', asyncHandler(createColumn));
// Before /columns/:id, so "order" is not read as an id.
router.patch('/columns/order', asyncHandler(reorderColumns));
router.patch('/columns/:id', asyncHandler(updateColumn));
router.delete('/columns/:id', asyncHandler(deleteColumn));

router.post('/', asyncHandler(createTodo));
router.patch('/:id', asyncHandler(updateTodo));
router.patch('/:id/move', asyncHandler(moveTodo));
router.delete('/:id', asyncHandler(deleteTodo));

export default router;
