import express from 'express';
import { registerUser, loginUser, logoutUser, getCurrentUser } from '../controllers/authController.js';
import { protect } from '../middlewares/authMiddleware.js';
import { authLimiter } from '../middlewares/rateLimitMiddleware.js';
import { recoveryLimiter } from '../middlewares/rateLimitMiddleware.js';
import { forgotPassword, resetPassword } from '../controllers/passwordRecoveryController.js';

const router = express.Router();

router.post('/register', authLimiter, registerUser);
router.post('/login', authLimiter, loginUser);
router.post('/logout', logoutUser);
router.post('/forgot-password', recoveryLimiter, forgotPassword);
router.post('/reset-password', recoveryLimiter, resetPassword);
router.get('/me', protect, getCurrentUser);

export default router;
