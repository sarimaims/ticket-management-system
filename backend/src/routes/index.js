import { Router } from 'express';

import activityRoutes from './activity.routes.js';
import authRoutes from './auth.routes.js';
import departmentRoutes from './department.routes.js';
import healthRoutes from './health.routes.js';
import ticketRoutes from './ticket.routes.js';
import userRoutes from './user.routes.js';

const router = Router();

router.use('/health', healthRoutes);
router.use('/auth', authRoutes);
router.use('/activity', activityRoutes);
router.use('/departments', departmentRoutes);
router.use('/tickets', ticketRoutes);
router.use('/users', userRoutes);

export default router;
