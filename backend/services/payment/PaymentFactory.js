import env from '../../config/env.js';
import { PaystackService } from './PaystackService.js';
import { BachsService } from './BachsService.js';

class PaymentFactory {
  constructor() {
    this.instances = new Map();
  }

  /**
   * Returns the active payment gateway instance configured in environment
   * @param {string} [overrideGateway] Optional gateway name override for testing
   * @returns {import('./PaymentGatewayInterface').PaymentGatewayInterface}
   */
  getGateway(overrideGateway) {
    const gatewayName = (overrideGateway || process.env.ACTIVE_PAYMENT_GATEWAY || env.ACTIVE_PAYMENT_GATEWAY || 'bachs').toLowerCase();

    if (!this.instances.has(gatewayName)) {
      if (gatewayName === 'paystack') {
        this.instances.set('paystack', new PaystackService());
      } else if (gatewayName === 'bachs') {
        this.instances.set('bachs', new BachsService());
      } else {
        throw new Error(`Unsupported payment gateway: "${gatewayName}". Valid options: 'paystack' | 'bachs'`);
      }
    }

    return this.instances.get(gatewayName);
  }

  /**
   * Returns the name of the currently active payment gateway
   * @returns {'paystack' | 'bachs'}
   */
  getActiveGatewayName() {
    return (process.env.ACTIVE_PAYMENT_GATEWAY || env.ACTIVE_PAYMENT_GATEWAY || 'bachs').toLowerCase();
  }
}

export const paymentFactory = new PaymentFactory();
export default paymentFactory;
