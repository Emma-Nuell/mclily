import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import env from '../config/env.js';
import { AppError } from '../utils/AppError.js';
const defaults = JSON.parse(
  readFileSync(new URL('../config/delivery.json', import.meta.url), 'utf8')
);
const text = z.string().trim().min(1).max(120);
const schema = z
  .object({
    pickup: z
      .object({
        enabled: z.boolean(),
        address: z.string().trim().max(500),
        hours: z.string().trim().max(200),
      })
      .strict(),
    externalCourierEnabled: z.boolean(),
    zones: z
      .array(
        z
          .object({
            id: z.string().regex(/^[a-z][a-z0-9_]{1,50}$/),
            name: text,
            fee: z
              .number()
              .finite()
              .min(0)
              .max(1000000)
              .refine((v) => Math.abs(v * 100 - Math.round(v * 100)) < 0.00001),
            states: z.array(text).min(1).max(50),
            cities: z.array(text).max(100),
            enabled: z.boolean(),
          })
          .strict()
      )
      .max(50),
  })
  .strict();
export const courierNotice =
  'Courier delivery — delivery fee is not included. Pay the courier on delivery.';
export function deliveryConfiguration() {
  try {
    const config = schema.parse(
      env.DELIVERY_CONFIG_JSON ? JSON.parse(env.DELIVERY_CONFIG_JSON) : defaults
    );
    const ids = config.zones.map((v) => v.id);
    if (
      new Set(ids).size !== ids.length ||
      ids.some((v) =>
        ['in_store_pickup', 'external_courier', 'local_delivery'].includes(v)
      ) ||
      (config.pickup.enabled && !config.pickup.address)
    )
      throw new Error();
    return config;
  } catch {
    throw new AppError(
      503,
      'DELIVERY_UNAVAILABLE',
      'Delivery settings need a check. Please contact McLily before paying.'
    );
  }
}
export function deliveryOptions() {
  const config = deliveryConfiguration();
  const options = config.zones
    .filter((v) => v.enabled)
    .map((v) => ({
      id: v.id,
      name: `${v.name} — McLily delivery`,
      method: 'local',
      fee: v.fee,
      states: v.states,
      cities: v.cities,
      description: `McLily delivery to ${v.cities.length ? v.cities.join(', ') : v.states.join(', ')}.`,
    }));
  if (config.pickup.enabled)
    options.push({
      id: 'in_store_pickup',
      name: 'Collect from McLily',
      method: 'pickup',
      fee: 0,
      description: [config.pickup.address, config.pickup.hours]
        .filter(Boolean)
        .join(' · '),
    });
  if (config.externalCourierEnabled)
    options.push({
      id: 'external_courier',
      name: 'Other locations — courier delivery',
      method: 'courier',
      fee: 0,
      description: courierNotice,
    });
  return {
    version: createHash('sha256')
      .update(JSON.stringify(config))
      .digest('hex')
      .slice(0, 24),
    options,
    courierNotice,
  };
}
const normalize = (value) =>
  String(value || '')
    .trim()
    .toLowerCase();
export function selectDelivery(address, version, courierAccepted) {
  const policy = deliveryOptions();
  if (version !== policy.version)
    throw new AppError(
      409,
      'DELIVERY_CHANGED',
      'Delivery options changed. Refresh checkout and review the current fee.'
    );
  const option = policy.options.find((v) => v.id === address?.deliveryTier);
  if (!option)
    throw new AppError(
      400,
      'DELIVERY_OPTION_REQUIRED',
      'Choose an available delivery option.'
    );
  if (
    option.method !== 'pickup' &&
    !['street', 'city', 'state'].every(
      (key) =>
        typeof address[key] === 'string' &&
        address[key].trim().length > 0 &&
        address[key].length <= 500
    )
  )
    throw new AppError(
      400,
      'ADDRESS_REQUIRED',
      'Enter your full delivery address, city and state.'
    );
  if (
    option.method === 'local' &&
    (!option.states.some((v) => normalize(v) === normalize(address.state)) ||
      (option.cities.length &&
        !option.cities.some((v) => normalize(v) === normalize(address.city))))
  )
    throw new AppError(
      400,
      'OUTSIDE_DELIVERY_ZONE',
      'This address is outside the selected McLily delivery area. Choose courier delivery or contact McLily.'
    );
  if (option.method === 'courier' && courierAccepted !== true)
    throw new AppError(
      400,
      'COURIER_ACKNOWLEDGEMENT_REQUIRED',
      'Confirm that delivery is paid separately to the courier.'
    );
  const pickup = deliveryConfiguration().pickup;
  return {
    shippingAddress:
      option.method === 'pickup'
        ? {
            street: pickup.address,
            city: 'Store collection',
            state: 'Store collection',
            deliveryTier: 'in_store_pickup',
            deliveryFee: 0,
          }
        : {
            street: address.street.trim(),
            city: address.city.trim(),
            state: address.state.trim(),
            deliveryTier:
              option.method === 'courier'
                ? 'external_courier'
                : 'local_delivery',
            deliveryFee: option.fee,
          },
    snapshot: {
      method: option.method,
      optionId: option.id,
      label: option.name,
      description: option.description,
      policyVersion: policy.version,
      feeCollectedOnline: option.fee,
      courierStatus:
        option.method === 'courier' ? 'awaiting_confirmation' : 'not_required',
      checkoutAcknowledgedAt:
        option.method === 'courier' ? new Date() : undefined,
      revision: 0,
    },
  };
}
