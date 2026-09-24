import express from 'express';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';

import env from './config/env.js';
import routes from './routes/index.js';
import healthRoutes from './routes/health.routes.js';
import notFound from './middleware/notFound.js';
import errorHandler from './middleware/errorHandler.js';

const app = express();

app.use(helmet());
// ETag is not a CORS-safelisted response header, so without exposing it the
// browser hides it from fetch and a polling client can never revalidate.
/**
 * Allowed callers: whatever CORS_ORIGIN lists, plus any *.devtunnels.ms host,
 * so the app keeps working when the frontend is reached through a tunnel too.
 * Requests with no Origin (curl, health checks, server to server) are allowed.
 */
function allowedOrigin(origin, callback) {
  if (!origin) return callback(null, true);
  if (env.corsOrigin.includes(origin)) return callback(null, true);

  try {
    const { hostname, protocol } = new URL(origin);
    if (protocol === 'https:' && hostname.endsWith('.devtunnels.ms')) {
      return callback(null, true);
    }
  } catch {
    /* an origin that will not parse is not one we allow */
  }

  return callback(new Error(`Origin not allowed by CORS: ${origin}`));
}

// Server-Timing is exposed so the browser's network panel can draw where a
// slow request spent its time; ETag is what the polling clients send back.
app.use(
  cors({
    origin: allowedOrigin,
    credentials: true,
    exposedHeaders: ['ETag', 'Server-Timing'],
    /**
     * A day. Every request carrying JSON is preceded by a preflight the
     * browser must wait for, and across a continent that is a round trip
     * spent asking permission rather than doing the work. Telling the browser
     * to remember the answer pays for itself on the second request.
     */
    maxAge: 86_400,
  }),
);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

if (env.nodeEnv !== 'test') {
  app.use(morgan('dev'));
}

app.use('/api', routes);

// Hosting platforms probe the root, not /api. Both answer, so a health check
// passes whichever path it was pointed at.
app.use('/health', healthRoutes);
app.get('/', (req, res) => {
  res.json({ success: true, service: 'flowdesk-api', api: '/api' });
});

app.use(notFound);
app.use(errorHandler);

export default app;
