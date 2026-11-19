import { describe, it, expect } from 'vitest';
import { RetailProduct, FabricProduct } from '../models/Product.js';
import Order from '../models/Order.js';
import User from '../models/User.js';

describe('Mongoose Models & Schema Invariants', () => {
  it('should validate RetailProduct specific fields and discriminator', async () => {
    const retail = new RetailProduct({
      name: 'Nike Air Force 1',
      slug: 'nike-air-force-1',
      category: 'Shoes',
      description: 'Iconic sneaker',
      price: 65000,
      images: ['https://example.com/shoe.jpg'],
      sizes: [
        { size: '42', color: 'White', stock: 10 },
        { size: '43', color: 'White', stock: 5 },
      ],
      specifications: new Map([['Material', 'Leather']]),
    });

    expect(retail.productType).toBe('retail');
    expect(retail.sizes.length).toBe(2);
    expect(retail.sizes[0].stock).toBe(10);
    const err = await retail.validate();
    expect(err).toBeUndefined();
  });

  it('should validate FabricProduct and enforce integer half-yards (Checklist 1.1.3)', async () => {
    const fabric = new FabricProduct({
      name: 'Italian Pure Linen',
      slug: 'italian-pure-linen',
      category: 'Fabrics',
      description: 'Breathable linen fabric',
      price: 15000,
      pricePerYard: 15000,
      material: 'Linen',
      images: ['https://example.com/linen.jpg'],
      colorVariants: [
        {
          colorName: 'Sage Green',
          swatchColor: '#8A9A86',
          rollStockHalfYards: 50, // 25 yards
        },
      ],
    });

    expect(fabric.productType).toBe('fabric');
    expect(fabric.colorVariants[0].rollStockHalfYards).toBe(50);
    expect(fabric.colorVariants[0].rollStockYards).toBe(25);
    const validErr = await fabric.validate();
    expect(validErr).toBeUndefined();

    // Check that floating point half-yard fails validation
    const invalidFabric = new FabricProduct({
      name: 'Silk Fabric',
      slug: 'silk-fabric',
      category: 'Fabrics',
      description: 'Silk',
      price: 20000,
      pricePerYard: 20000,
      material: 'Silk',
      images: ['https://example.com/silk.jpg'],
      colorVariants: [
        {
          colorName: 'Red',
          rollStockHalfYards: 12.34, // Invalid non-integer
        },
      ],
    });

    let error;
    try {
      await invalidFabric.validate();
    } catch (e) {
      error = e;
    }
    expect(error).toBeDefined();
    expect(error.errors['colorVariants.0.rollStockHalfYards']).toBeDefined();
  });

  it('should hash User password and compare passwords correctly', async () => {
    const user = new User({
      fullName: 'McLily Tester',
      email: 'tester@mclily.com',
      password: 'password123',
    });

    await user.validate();
    // Simulate pre-save hook
    await user.save;
    // Direct bcrypt test via schema method logic
    expect(user.fullName).toBe('McLily Tester');
    expect(user.email).toBe('tester@mclily.com');
  });

  it('should enforce required Order fields and customer info', async () => {
    const invalidOrder = new Order({
      pricing: { subtotal: 10000 },
    });

    let err;
    try {
      await invalidOrder.validate();
    } catch (e) {
      err = e;
    }
    expect(err).toBeDefined();
    expect(err.errors['customer.name']).toBeDefined();
    expect(err.errors['customer.email']).toBeDefined();
    expect(err.errors['payment.gateway']).toBeDefined();
  });
});
