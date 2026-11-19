/**
 * Convert yards to integer half-yards (Checklist 1.1.3)
 */
export const yardsToHalfYards = (yards) => {
  return Math.round(Number(yards) * 2);
};

/**
 * Convert integer half-yards to decimal yards
 */
export const halfYardsToYards = (halfYards) => {
  return Number(halfYards) / 2;
};

/**
 * Format currency in Nigerian Naira (₦)
 */
export const formatNaira = (amount) => {
  return `₦${Number(amount || 0).toLocaleString('en-NG')}`;
};
