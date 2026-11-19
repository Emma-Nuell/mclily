import { MessageCircle } from 'lucide-react';
import { getWhatsAppUrl } from '../utils/whatsapp';

// Configure once for support, tailoring enquiries and order receipts.
export default function WhatsAppLink({ message, children, className, ...props }) {
  const href = getWhatsAppUrl(message);
  if (!href) {
    return <span className={`${className} opacity-60`} aria-disabled="true" title="The store's WhatsApp number has not been configured.">
      <MessageCircle size={15} /> WhatsApp contact coming soon
    </span>;
  }
  return <a {...props} className={className} href={href}>{children}</a>;
}
