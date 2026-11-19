import express from 'express';
import multer from 'multer';
import { uploadImageBuffer } from '../services/cloudinaryService.js';
import { protect, requireAdmin } from '../middlewares/authMiddleware.js';
import { AppError } from '../utils/AppError.js';

const router = express.Router();

// Configure Multer memory storage with file filters (Checklist 1.3.10)
const storage = multer.memoryStorage();

const fileFilter = (req, file, cb) => {
  const allowedMimes = ['image/jpeg', 'image/png', 'image/webp', 'image/avif'];
  if (allowedMimes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new AppError(400, 'INVALID_IMAGE_FORMAT', 'Use JPG, PNG, WebP or AVIF images.'), false);
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: {
    files: 8,
    fileSize: 10 * 1024 * 1024, // 10MB limit
  },
});

function parsePhotos(req, res, next) {
  upload.array('images', 8)(req, res, error => {
    if (error?.code === 'LIMIT_FILE_SIZE') return next(new AppError(413, 'IMAGE_TOO_LARGE', 'Each photo must be 10 MB or smaller.'));
    if (['LIMIT_FILE_COUNT', 'LIMIT_UNEXPECTED_FILE'].includes(error?.code)) return next(new AppError(400, 'INVALID_IMAGE_COUNT', 'Choose up to eight photos using the images field.'));
    next(error);
  });
}

/**
 * @desc   Upload single or multiple product images to Cloudinary
 * @route  POST /api/media/upload
 * @access Admin only
 */
router.post('/upload', protect, requireAdmin, parsePhotos, async (req, res, next) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No image files provided',
        code: 'MISSING_FILE',
      });
    }

    const uploadPromises = req.files.map((file) => uploadImageBuffer(file.buffer));
    const results = await Promise.all(uploadPromises);

    res.status(200).json({
      success: true,
      message: 'Images uploaded successfully',
      data: results.map((r) => r.secureUrl),
    });
  } catch (error) {
    next(error);
  }
});

export default router;
