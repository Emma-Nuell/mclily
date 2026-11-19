import { describe, it, expect, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

const mocks = vi.hoisted(() => ({ env: { CLOUDINARY_CLOUD_NAME: 'test-cloud', CLOUDINARY_API_KEY: 'test-key', CLOUDINARY_API_SECRET: 'test-secret', NODE_ENV: 'test' }, stream: vi.fn(), end: vi.fn(), config: vi.fn() }));
vi.mock('../config/env.js', () => ({ default: mocks.env }));
vi.mock('cloudinary', () => ({ v2: { config: mocks.config, uploader: { upload_stream: mocks.stream } } }));
vi.mock('../middlewares/authMiddleware.js', () => ({ protect: (req, res, next) => next(), requireAdmin: (req, res, next) => next() }));
import { uploadImageBuffer } from '../services/cloudinaryService.js';
import mediaRoutes from '../routes/mediaRoutes.js';
import { errorHandler } from '../middlewares/errorMiddleware.js';
const app = express(); app.use('/media', mediaRoutes); app.use(errorHandler);

describe('Real upload failure contracts (provider mocked)', () => {
  beforeEach(() => { vi.clearAllMocks(); Object.assign(mocks.env, { CLOUDINARY_CLOUD_NAME: 'test-cloud', CLOUDINARY_API_KEY: 'test-key', CLOUDINARY_API_SECRET: 'test-secret' }); });
  it.each(['CLOUDINARY_CLOUD_NAME', 'CLOUDINARY_API_KEY', 'CLOUDINARY_API_SECRET'])('fails closed when %s is missing instead of inventing a successful photo', async key => {
    mocks.env[key] = '';
    await expect(uploadImageBuffer(Buffer.from('test'))).rejects.toMatchObject({ statusCode: 503, code: 'MEDIA_NOT_CONFIGURED' });
    expect(mocks.stream).not.toHaveBeenCalled();
  });
  it('returns readable errors for unsupported and oversized files without calling the provider', async () => {
    const invalid = await request(app).post('/media/upload').attach('images', Buffer.from('not an image'), { filename: 'test.txt', contentType: 'text/plain' });
    expect(invalid.status).toBe(400); expect(invalid.body.code).toBe('INVALID_IMAGE_FORMAT');
    const large = await request(app).post('/media/upload').attach('images', Buffer.alloc(10 * 1024 * 1024 + 1), { filename: 'large.png', contentType: 'image/png' });
    expect(large.status).toBe(413); expect(large.body.code).toBe('IMAGE_TOO_LARGE');
    expect(mocks.stream).not.toHaveBeenCalled();
  });
  it('rejects nine files and empty requests without reporting success', async () => {
    const req = request(app).post('/media/upload');
    for (let i = 0; i < 9; i++) req.attach('images', Buffer.from('test'), { filename: `image-${i}.png`, contentType: 'image/png' });
    expect((await req).status).toBe(400);
    expect((await request(app).post('/media/upload')).status).toBe(400);
    expect(mocks.stream).not.toHaveBeenCalled();
  });
  it('does not expose vendor credentials when an upstream upload fails', async () => {
    mocks.stream.mockImplementation((options, callback) => ({ end: () => callback({ http_code: 401, message: 'private vendor error with credentials' }) }));
    const response = await request(app).post('/media/upload').attach('images', Buffer.from('test'), { filename: 'test.png', contentType: 'image/png' });
    expect(response.status).toBe(502); expect(response.body.code).toBe('IMAGE_UPLOAD_FAILED');
    expect(response.text).not.toContain('private vendor error');
  });
  it('only accepts a confirmed HTTPS provider response', async () => {
    mocks.stream.mockImplementation((options, callback) => ({ end: () => callback(null, {}) }));
    await expect(uploadImageBuffer(Buffer.from('test'))).rejects.toMatchObject({ code: 'IMAGE_UPLOAD_FAILED' });
    mocks.stream.mockImplementation((options, callback) => ({ end: () => callback(null, { url: 'http://test/image.webp', secure_url: 'https://test/image.webp', public_id: 'test-id' }) }));
    await expect(uploadImageBuffer(Buffer.from('test'))).resolves.toMatchObject({ secureUrl: 'https://test/image.webp', publicId: 'test-id' });
  });
});
