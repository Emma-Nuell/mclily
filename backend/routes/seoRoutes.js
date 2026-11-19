import express from 'express';
import { asyncHandler } from '../middlewares/errorMiddleware.js';
import {
  publicDocument,
  renderDocument,
  sitemapXml,
} from '../services/publicPageService.js';

const router = express.Router();
router.get(
  '/sitemap.xml',
  asyncHandler(async (req, res) => res.type('xml').send(await sitemapXml()))
);
router.get(
  '/meta',
  asyncHandler(async (req, res) => {
    const path = req.query.path;
    if (
      typeof path !== 'string' ||
      path.length > 600 ||
      !path.startsWith('/') ||
      path.startsWith('//') ||
      /[?#\\]/.test(path)
    )
      return res
        .status(400)
        .json({ success: false, message: 'Choose a public page path.' });
    const document = await publicDocument(path);
    const { body, redirect, ...metadata } = document;
    void body;
    void redirect;
    res.status(document.status).json({ success: true, data: metadata });
  })
);
router.get(
  '/og/:slug',
  asyncHandler(async (req, res) => {
    const document = await publicDocument(
      '/product/' + encodeURIComponent(req.params.slug)
    );
    res
      .status(document.status)
      .type('html')
      .send(
        renderDocument(
          '<!doctype html><html lang="en"><head><meta charset="UTF-8"></head><body><div id="root"></div></body></html>',
          document
        )
      );
  })
);
export default router;
