import User from '../models/User.js';
import { asyncHandler } from '../middlewares/errorMiddleware.js';
import { setAuthCookie, clearAuthCookie } from '../middlewares/authMiddleware.js';
import validator from 'validator';

/**
 * @desc   Register user with email or phone
 * @route  POST /api/auth/register
 * @access Public
 */
export const registerUser = asyncHandler(async (req, res) => {
  const { fullName, email, phone, password } = req.body;
  if (typeof email !== 'string' || !validator.isEmail(email.trim()) || email.length > 254 || typeof fullName !== 'string' || !fullName.trim() || fullName.length > 200 || typeof password !== 'string' || password.length < 8 || password.length > 128 || (phone !== undefined && typeof phone !== 'string')) {
    return res.status(400).json({ success: false, code: 'INVALID_REGISTRATION', message: 'Enter your name, a valid email address and a password of 8 to 128 characters.' });
  }

  if (!email && !phone) {
    return res.status(400).json({
      success: false,
      message: 'Please provide either an email or phone number',
      code: 'MISSING_CREDENTIALS',
    });
  }

  // Check if user already exists
  const query = [];
  if (email) query.push({ email: email.trim().toLowerCase() });
  if (phone) query.push({ phone });

  const existingUser = await User.findOne({ $or: query });
  if (existingUser) {
    return res.status(409).json({
      success: false,
      message: 'An account with this email or phone number already exists',
      code: 'USER_EXISTS',
    });
  }

  const user = await User.create({
    fullName,
    email: email.trim().toLowerCase(),
    phone,
    password,
  });

  const token = setAuthCookie(res, user);

  res.status(201).json({
    success: true,
    message: 'Account created successfully',
    data: {
      _id: user._id,
      fullName: user.fullName,
      email: user.email,
      phone: user.phone,
      role: user.role,
    },
    token, // Provided for non-browser clients e.g. Telegram Bot
  });
});

/**
 * @desc   Authenticate user & obtain JWT cookie
 * @route  POST /api/auth/login
 * @access Public
 */
export const loginUser = asyncHandler(async (req, res) => {
  const { credential, password } = req.body;

  if (!credential || !password) {
    return res.status(400).json({
      success: false,
      message: 'Please provide email/phone and password',
      code: 'MISSING_CREDENTIALS',
    });
  }

  // Allow login by either email or phone
  const user = await User.findOne({
    $or: [{ email: credential.toLowerCase() }, { phone: credential }],
  }).select('+password');

  if (!user || !(await user.matchPassword(password))) {
    return res.status(401).json({
      success: false,
      message: 'Invalid email/phone or password',
      code: 'INVALID_CREDENTIALS',
    });
  }

  if (!user.isActive) {
    return res.status(403).json({
      success: false,
      message: 'Account has been deactivated. Please contact support.',
      code: 'ACCOUNT_DEACTIVATED',
    });
  }

  const token = setAuthCookie(res, user);

  res.status(200).json({
    success: true,
    message: 'Logged in successfully',
    data: {
      _id: user._id,
      fullName: user.fullName,
      email: user.email,
      phone: user.phone,
      role: user.role,
    },
    token,
  });
});

/**
 * @desc   Log user out & clear cookie
 * @route  POST /api/auth/logout
 * @access Public
 */
export const logoutUser = asyncHandler(async (req, res) => {
  clearAuthCookie(res);
  res.status(200).json({
    success: true,
    message: 'Logged out successfully',
  });
});

/**
 * @desc   Get current user profile
 * @route  GET /api/auth/me
 * @access Private
 */
export const getCurrentUser = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user._id).select('-password');
  res.status(200).json({
    success: true,
    data: user,
  });
});
