import { Router } from 'express';

import activityRoutes from './activity.routes.js';
import authRoutes from './auth.routes.js';
import departmentRoutes from './department.routes.js';
import healthRoutes from './health.routes.js';
import notificationRoutes from './notification.routes.js';
import searchRoutes from './search.routes.js';
import ticketRoutes from './ticket.routes.js';
import todoRoutes from './todo.routes.js';
import unitRoutes from './unit.routes.js';
import userRoutes from './user.routes.js';

const router = Router();

router.use('/health', healthRoutes);
router.use('/auth', authRoutes);
router.use('/activity', activityRoutes);
router.use('/departments', departmentRoutes);
router.use('/notifications', notificationRoutes);
router.use('/search', searchRoutes);
router.use('/tickets', ticketRoutes);
router.use('/todos', todoRoutes);
router.use('/units', unitRoutes);
router.use('/users', userRoutes);

export default router;
