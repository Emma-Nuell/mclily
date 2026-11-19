export function deliveryFeeLabel(option) {
  if (!option) return 'Choose at checkout';
  if (option.method === 'courier') return 'Pay courier separately';
  if (option.method === 'pickup') return 'Free collection';
  return option.fee === 0
    ? 'No delivery charge'
    : `₦${option.fee.toLocaleString('en-NG')}`;
}
