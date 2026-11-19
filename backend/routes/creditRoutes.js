import express from 'express';
import { protect, requireAdmin } from '../middlewares/authMiddleware.js';
import {
  listCreditAccounts,
  lookupCreditAccount,
  getCreditAccount,
  getCreditEntries,
  createCreditAccount,
  updateCreditBalance,
} from '../controllers/creditController.js';
const router = express.Router();
router.use(protect, requireAdmin);
router.get('/', listCreditAccounts);
router.get('/lookup', lookupCreditAccount);
router.post('/', createCreditAccount);
router.get('/:id', getCreditAccount);
router.get('/:id/entries', getCreditEntries);
router.post('/:id/:operation', updateCreditBalance);
export default router;
