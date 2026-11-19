import express from 'express';
import { recordPosSale, getPosSales, recordInstallment } from '../controllers/posController.js';
import { protect, requireAdmin } from '../middlewares/authMiddleware.js';

const router = express.Router();

router.use(protect, requireAdmin);

router.post('/sale', recordPosSale);
router.get('/sales', getPosSales);
router.post('/sales/:id/installment', recordInstallment);

export default router;
