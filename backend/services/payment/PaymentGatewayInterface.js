/**
 * Payment Gateway Interface Definition
 */
export class PaymentGatewayInterface {
  /**
   * Initializes a checkout session or transaction with the provider
   * @param {Object} params
   * @param {string} params.orderNumber
   * @param {number} params.amount - Total amount in Naira
   * @param {Object} params.customer - { name, email, phone }
   * @param {string} params.callbackUrl
   * @param {Object} [params.metadata]
   * @returns {Promise<{ authorizationUrl: string, reference: string, accessCode?: string }>}
   */
  async initializePayment() {
    throw new Error('Method initializePayment() must be implemented');
  }

  /**
   * Verifies a payment reference directly against the provider's API
   * @param {string} reference
   * @returns {Promise<{ isPaid: boolean, amount: number, reference: string, channel?: string, raw: any }>}
   */
  async verifyPayment() {
    throw new Error('Method verifyPayment() must be implemented');
  }

  /**
   * Cryptographically verifies the webhook signature against the raw request body
   * @param {import('express').Request} req
   * @returns {boolean}
   */
  verifyWebhookSignature() {
    throw new Error('Method verifyWebhookSignature() must be implemented');
  }

  /**
   * Parses the webhook request into a standardized event payload
   * @param {import('express').Request} req
   * @returns {{ eventType: string, isPaid: boolean, reference: string, amount: number, raw: any }}
   */
  parseWebhookEvent() {
    throw new Error('Method parseWebhookEvent() must be implemented');
  }
}
