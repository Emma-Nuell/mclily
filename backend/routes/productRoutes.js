import express from 'express';
import {
  getProducts,
  getProductByIdOrSlug,
  createProduct,
  updateProduct,
  deleteProduct,
} from '../controllers/productController.js';
import { protect, requireAdmin } from '../middlewares/authMiddleware.js';
import { getStockHistory } from '../controllers/stockHistoryController.js';

const router = express.Router();

// Management visibility is set by authenticated middleware, never a public query flag.
router.get('/manage', protect, requireAdmin, (req, res, next) => {
  req.catalogManagement = true;
  getProducts(req, res, next);
});

router.get('/:id/stock-history', protect, requireAdmin, getStockHistory);

router.route('/')
  .get(getProducts)
  .post(protect, requireAdmin, createProduct);

router.route('/:slugOrId')
  .get(getProductByIdOrSlug);

router.route('/:id')
  .put(protect, requireAdmin, updateProduct)
  .delete(protect, requireAdmin, deleteProduct);

export default router;
