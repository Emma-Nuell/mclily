import jwt from 'jsonwebtoken';
import env from '../config/env.js';
import User from '../models/User.js';

const COOKIE_NAME = 'mcl_jwt';

/**
 * Signs JWT and sets HttpOnly cookie on Express response (Checklist 1.3.1, 1.3.2)
 */
export const setAuthCookie = (res, user) => {
  const token = jwt.sign(
    { id: user._id, role: user.role, ver: user.authVersion || 0 },
    env.JWT_SECRET,
    {
      algorithm: 'HS256', // Locked algorithm
      expiresIn: env.JWT_EXPIRES_IN,
    }
  );

  const cookieOptions = {
    httpOnly: true,
    secure: env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 14 * 24 * 60 * 60 * 1000,
    path: '/',
  };

  res.cookie(COOKIE_NAME, token, cookieOptions);
  return token;
};

/**
 * Clears JWT cookie on logout
 */
export const clearAuthCookie = (res) => {
  res.clearCookie(COOKIE_NAME, {
    httpOnly: true,
    secure: env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
  });
};

/**
 * Require authenticated user via HttpOnly cookie or Authorization Bearer header
 */
export const protect = async (req, res, next) => {
  let token = req.cookies?.[COOKIE_NAME];

  if (!token && req.headers.authorization && req.headers.authorization.startsWith('Bearer ')) {
    token = req.headers.authorization.split(' ')[1];
  }

  if (!token) {
    return res.status(401).json({
      success: false,
      message: 'Not authorized: No authentication token provided',
      code: 'UNAUTHORIZED',
    });
  }

  try {
    const decoded = jwt.verify(token, env.JWT_SECRET, { algorithms: ['HS256'] });
    const user = await User.findById(decoded.id).select('-password');

    if (!user || !user.isActive || (decoded.ver || 0) !== (user.authVersion || 0)) {
      return res.status(401).json({
        success: false,
        message: 'User account not found or deactivated',
        code: 'USER_DEACTIVATED',
      });
    }

    req.user = user;
    next();
  } catch {
    return res.status(401).json({
      success: false,
      message: 'Invalid or expired token',
      code: 'INVALID_TOKEN',
    });
  }
};

/**
 * Optional authentication (attaches user if token present, proceeds if guest)
 */
export const optionalAuth = async (req, res, next) => {
  let token = req.cookies?.[COOKIE_NAME];

  if (!token && req.headers.authorization && req.headers.authorization.startsWith('Bearer ')) {
    token = req.headers.authorization.split(' ')[1];
  }

  if (!token) {
    req.user = null;
    return next();
  }

  try {
    const decoded = jwt.verify(token, env.JWT_SECRET, { algorithms: ['HS256'] });
    req.user = await User.findById(decoded.id).select('-password');
    if (!req.user?.isActive || (decoded.ver || 0) !== (req.user.authVersion || 0)) req.user = null;
  } catch {
    req.user = null;
  }
  next();
};

/**
 * Require Admin role
 */
export const requireAdmin = (req, res, next) => {
  if (!req.user || !['admin', 'superadmin'].includes(req.user.role)) {
    return res.status(403).json({
      success: false,
      message: 'Access denied: Admin credentials required',
      code: 'FORBIDDEN',
    });
  }
  next();
};
