export function getWhatsAppUrl(message) {
  const phone = (import.meta.env.VITE_WHATSAPP_NUMBER ?? '2348037256630').replace(/\D/g, '');
  if (phone.length < 8 || phone.length > 15) return null;
  return `https://wa.me/${phone}?text=${encodeURIComponent(message || '')}`;
}
