import { v2 as cloudinary } from 'cloudinary';
import env from '../config/env.js';
import { AppError } from '../utils/AppError.js';

cloudinary.config({
  cloud_name: env.CLOUDINARY_CLOUD_NAME,
  api_key: env.CLOUDINARY_API_KEY,
  api_secret: env.CLOUDINARY_API_SECRET,
  secure: true,
});

/**
 * Uploads a buffer directly to Cloudinary with WebP optimization and auto-quality
 * @param {Buffer} fileBuffer
 * @param {string} folder - Destination folder on Cloudinary
 * @returns {Promise<{ url: string, publicId: string, secureUrl: string }>}
 */
export const uploadImageBuffer = (fileBuffer, folder = 'mclily/products', { publicId } = {}) => {
  return new Promise((resolve, reject) => {
    if (!env.CLOUDINARY_CLOUD_NAME || !env.CLOUDINARY_API_KEY || !env.CLOUDINARY_API_SECRET) {
      return reject(new AppError(503, 'MEDIA_NOT_CONFIGURED', 'Photo uploads are not configured. Please contact the administrator.'));
    }

    const uploadStream = cloudinary.uploader.upload_stream(
      {
        folder,
        ...(publicId ? { public_id: publicId, overwrite: false } : {}),
        format: 'webp',
        quality: 'auto:good',
        fetch_format: 'auto',
      },
      (error, result) => {
        if (error) return reject(new AppError(error.http_code === 400 ? 400 : 502, 'IMAGE_UPLOAD_FAILED', error.http_code === 400
          ? 'This image could not be read. Please choose another photo.' : 'The photo service is unavailable. Please try again.'));
        if (!result?.public_id || !result.secure_url?.startsWith('https://')) return reject(new AppError(502, 'IMAGE_UPLOAD_FAILED', 'The photo service did not confirm the upload. Please try again.'));
        resolve({
          url: result.url,
          secureUrl: result.secure_url,
          publicId: result.public_id,
        });
      }
    );

    uploadStream.end(fileBuffer);
  });
};

export default {
  uploadImageBuffer,
};
