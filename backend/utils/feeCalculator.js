/**
 * McLily Platform - Fee & Quantity Calculation Utilities
 */

export const PAYMENT_FEE_PERCENTAGE = 2; // Website only; POS has no service fee.
export const PAYMENT_FIXED_FEE = 100;    // ₦100
export const PAYMENT_FEE_CAP = 5000;     // Max fee ₦5000

/**
 * Calculate total amount including payment gateway fee.
 * Formula: min((2% × baseAmount) + ₦100, ₦5000)
 *
 * @param {number} baseAmount - Subtotal + shipping before fees
 * @returns {{ baseAmount: number, paymentFee: number, totalAmount: number }}
 */
export const calculateTotalAmount = (baseAmount) => {
  const numericBase = Number(baseAmount) || 0;
  if (numericBase <= 0) {
    return { baseAmount: 0, paymentFee: 0, totalAmount: 0 };
  }

  const calculatedFee = (PAYMENT_FEE_PERCENTAGE / 100) * numericBase + PAYMENT_FIXED_FEE;
  const totalFee = Math.min(calculatedFee, PAYMENT_FEE_CAP);

  const roundedBase = Math.round(numericBase * 100) / 100;
  const roundedFee = Math.round(totalFee * 100) / 100;

  return {
    baseAmount: roundedBase,
    paymentFee: roundedFee,
    totalAmount: Math.round((roundedBase + roundedFee) * 100) / 100,
  };
};

/**
 * Convert yards (decimal e.g. 2.5) to integer half-yards (e.g. 5)
 * to avoid floating-point math issues in inventory records.
 *
 * @param {number} yards
 * @returns {number} integer half-yards
 */
export const yardsToHalfYards = (yards) => {
  const val = Number(yards);
  if (isNaN(val) || val < 0.5) {
    throw new Error('Fabric quantity must be at least 0.5 yards');
  }
  const halfYards = Math.round(val * 2);
  if (Math.abs(val * 2 - halfYards) > 0.001) {
    throw new Error('Fabric quantity must be in 0.5 yard increments');
  }
  return halfYards;
};

/**
 * Convert integer half-yards (e.g. 5) to decimal yards (e.g. 2.5)
 *
 * @param {number} halfYards
 * @returns {number}
 */
export const halfYardsToYards = (halfYards) => {
  const val = Number(halfYards) || 0;
  return val / 2;
};
