import env from '../config/env.js';

/**
 * Wraps an async route handler to catch and forward errors to Express errorHandler
 */
export const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

/**
 * 404 Route Not Found Handler
 */
export const notFoundHandler = (req, res) => {
  res.locals.requestError = { code: 'ROUTE_NOT_FOUND', name: 'NotFound' };
  res.status(404).json({
    success: false,
    message: `Resource not found: ${req.method} ${req.originalUrl}`,
    code: 'ROUTE_NOT_FOUND',
  });
};

/**
 * Central Error Handler - Standardizes responses without leaking internal stack traces in production
 */
export const errorHandler = (err, req, res, next) => { // eslint-disable-line no-unused-vars
  let statusCode = err.statusCode || (res.statusCode === 200 ? 500 : res.statusCode);
  let message = err.message || 'Internal Server Error';
  let code = err.code || 'INTERNAL_SERVER_ERROR';

  // Handle Mongoose Bad ObjectId / CastError
  if (err.name === 'CastError') {
    statusCode = 400;
    message = `Invalid resource identifier for ${err.path}`;
    code = 'INVALID_ID';
  }

  // Handle Mongoose Duplicate Key Error (E11000)
  if (err.code === 11000) {
    statusCode = 409;
    const field = Object.keys(err.keyValue || {})[0] || 'field';
    message = `Duplicate value entered for ${field}. Value already exists.`;
    code = 'DUPLICATE_ENTRY';
  }

  // Handle Mongoose Validation Error
  if (err.name === 'ValidationError') {
    statusCode = 400;
    const errors = Object.values(err.errors).map((e) => e.message);
    message = errors.join(', ');
    code = 'VALIDATION_ERROR';
  }

  // Handle JWT Error
  if (err.name === 'JsonWebTokenError') {
    statusCode = 401;
    message = 'Invalid authentication token';
    code = 'INVALID_TOKEN';
  }

  // Handle Token Expired
  if (err.name === 'TokenExpiredError') {
    statusCode = 401;
    message = 'Authentication token expired';
    code = 'TOKEN_EXPIRED';
  }

  res.locals.requestError = { code, name: err.name || 'Error' };
  res.status(statusCode).json({
    success: false,
    message,
    code,
    ...(env.NODE_ENV === 'development' && { stack: err.stack }),
  });
};
