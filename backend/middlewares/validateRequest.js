/**
 * Zod validation middleware for Express routes (Checklist 1.3.4)
 */
export const validateBody = (schema) => (req, res, next) => {
  try {
    req.body = schema.parse(req.body);
    next();
  } catch (error) {
    const errorDetails = error.issues?.map((e) => ({
      field: e.path.join('.'),
      message: e.message,
    })) || [{ message: error.message }];

    return res.status(400).json({
      success: false,
      message: 'Validation failed',
      code: 'VALIDATION_ERROR',
      errors: errorDetails,
    });
  }
};

export const validateQuery = (schema) => (req, res, next) => {
  try {
    req.query = schema.parse(req.query);
    next();
  } catch (error) {
    const errorDetails = error.issues?.map((e) => ({
      field: e.path.join('.'),
      message: e.message,
    })) || [{ message: error.message }];

    return res.status(400).json({
      success: false,
      message: 'Invalid query parameters',
      code: 'INVALID_QUERY',
      errors: errorDetails,
    });
  }
};
