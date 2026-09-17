import env from '../config/env.js';

// Centralized error handler. Any error passed to next() ends up here.
export default function errorHandler(err, req, res, next) {
  const status = err.status || err.statusCode || 500;

  res.status(status).json({
    success: false,
    message: err.message || 'Internal server error',
    ...(env.nodeEnv === 'development' && { stack: err.stack }),
  });
}
