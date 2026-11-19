import { describe, it, expect } from 'vitest';
import {
  calculateTotalAmount,
  yardsToHalfYards,
  halfYardsToYards,
  PAYMENT_FEE_CAP,
} from '../utils/feeCalculator.js';

describe('Fee & Yardage Calculator Utilities', () => {
  it('should correctly calculate website fee for a standard purchase (2% + 100)', () => {
    const res = calculateTotalAmount(10000);
    expect(res.baseAmount).toBe(10000);
    expect(res.paymentFee).toBe(300);
    expect(res.totalAmount).toBe(10300);
  });

  it('should cap the payment fee at ₦5000 for high amounts', () => {
    const res = calculateTotalAmount(300000);
    expect(res.baseAmount).toBe(300000);
    expect(res.paymentFee).toBe(PAYMENT_FEE_CAP);
    expect(res.totalAmount).toBe(305000);
  });

  it('should handle zero or negative amounts gracefully', () => {
    expect(calculateTotalAmount(0)).toEqual({ baseAmount: 0, paymentFee: 0, totalAmount: 0 });
    expect(calculateTotalAmount(-50)).toEqual({ baseAmount: 0, paymentFee: 0, totalAmount: 0 });
  });

  it('should convert decimal yards to integer half-yards accurately', () => {
    expect(yardsToHalfYards(1)).toBe(2);
    expect(yardsToHalfYards(1.5)).toBe(3);
    expect(yardsToHalfYards(2.5)).toBe(5);
    expect(yardsToHalfYards(10)).toBe(20);
  });

  it('should reject non-half-yard increments', () => {
    expect(() => yardsToHalfYards(1.2)).toThrow(/increments/);
    expect(() => yardsToHalfYards(0.25)).toThrow();
  });

  it('should convert integer half-yards back to decimal yards', () => {
    expect(halfYardsToYards(5)).toBe(2.5);
    expect(halfYardsToYards(3)).toBe(1.5);
    expect(halfYardsToYards(20)).toBe(10);
  });
});
