import express from 'express';
import { protect, requireAdmin } from '../middlewares/authMiddleware.js';
import { asyncHandler } from '../middlewares/errorMiddleware.js';
import { inTransaction } from '../services/transactionService.js';
import {
  reportPeriod,
  buildSalesReport,
} from '../services/salesReportService.js';
const router = express.Router();
router.use(protect, requireAdmin);
router.get(
  '/sales',
  asyncHandler(async (req, res) => {
    const period = reportPeriod(req.query);
    const data = await inTransaction((session) =>
      buildSalesReport(period, session)
    );
    res.set('Cache-Control', 'no-store').json({ success: true, data });
  })
);
export default router;
