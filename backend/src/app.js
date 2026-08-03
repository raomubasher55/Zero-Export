'use strict';

const express = require('express');
const compression = require('compression');
const cors = require('cors');
const helmet = require('helmet');
const hpp = require('hpp');
const rateLimit = require('express-rate-limit');
const { config } = require('./config/environment');
const HTTP_STATUS = require('./constants/http-status');
const ERROR_CODES = require('./constants/error-codes');
const apiRoutes = require('./routes/api.routes');
const healthRoutes = require('./routes/health.routes');
const errorHandler = require('./middleware/error-handler');
const notFound = require('./middleware/not-found');
const requestId = require('./middleware/request-id');
const requestLogger = require('./middleware/request-logger');
const AppError = require('./utils/app-error');

const app = express();

app.disable('x-powered-by');
app.set('trust proxy', config.server.trustProxy);

const corsOptions = {
  origin(origin, callback) {
    if (!origin || config.http.corsOrigins.includes('*') || config.http.corsOrigins.includes(origin)) {
      callback(null, true);
      return;
    }

    callback(
      new AppError('This browser origin is not allowed to access the API.', {
        statusCode: HTTP_STATUS.FORBIDDEN,
        code: ERROR_CODES.CORS_ORIGIN_DENIED,
      }),
    );
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-Id'],
  exposedHeaders: ['X-Request-Id', 'RateLimit-Limit', 'RateLimit-Remaining', 'RateLimit-Reset'],
  maxAge: 86400,
};

const apiRateLimiter = rateLimit({
  windowMs: config.http.rateLimitWindowMs,
  limit: config.http.rateLimitMaxRequests,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skip: (req) => ['/health', '/ready'].includes(req.path),
  handler(req, res) {
    res.status(HTTP_STATUS.TOO_MANY_REQUESTS).json({
      success: false,
      error: {
        code: ERROR_CODES.RATE_LIMITED,
        message: 'Too many requests. Please retry later.',
        requestId: req.requestId,
      },
    });
  },
});

// Rate limiting is opt-in (RATE_LIMIT_ENABLED=true). Personal/single-user
// deployments with realtime polling keep it disabled.
if (config.http.rateLimitEnabled) {
  app.use(apiRateLimiter);
}

app.use(requestId);
app.use(requestLogger);
app.use(helmet());
app.use(cors(corsOptions));
app.use(compression());
app.use(hpp());
app.use(express.json({ limit: config.http.requestBodyLimit }));
app.use(express.urlencoded({ extended: false, limit: config.http.requestBodyLimit }));

app.use(healthRoutes);
app.use('/api/v1', apiRoutes);

app.use(notFound);
app.use(errorHandler);

module.exports = app;
