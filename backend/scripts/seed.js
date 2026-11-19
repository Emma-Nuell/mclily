import mongoose from 'mongoose';
import User from '../models/User.js';
import Product, { RetailProduct, FabricProduct } from '../models/Product.js';
import Order from '../models/Order.js';
import env from '../config/env.js';

async function seed() {
  try {
    await mongoose.connect(env.MONGODB_URI);
    console.log('Connected to MongoDB for seeding');

    // Seed Admin User
    const existingAdmin = await User.findOne({ email: 'admin@mclily.com' });
    if (!existingAdmin) {
      const admin = await User.create({
        fullName: 'McLily Manager',
        email: 'admin@mclily.com',
        phone: '08012345678',
        password: 'adminpassword123',
        role: 'admin',
      });
      console.log('Created Admin User:', admin.email);
    } else {
      console.log('Admin user already exists');
    }

    // Seed Initial Products if empty
    const productCount = await Product.countDocuments();
    if (productCount === 0) {
      console.log('Seeding initial products...');
      await RetailProduct.create([
        {
          name: 'Classic Tailored Double-Breasted Blazer',
          slug: 'classic-tailored-blazer',
          category: 'Clothing',
          price: 45000,
          originalPrice: 55000,
          description: 'Timeless Italian cut blazer crafted with structured shoulders and horn buttons.',
          isFeatured: true,
          rating: 4.9,
          reviewsCount: 14,
          images: [
            'https://images.unsplash.com/photo-1591047139829-d91aecb6caea?q=80&w=800&auto=format&fit=crop',
            'https://images.unsplash.com/photo-1594938298603-c8148c4dae35?q=80&w=800&auto=format&fit=crop',
          ],
          sizes: [
            { size: 'S', stock: 4 },
            { size: 'M', stock: 8 },
            { size: 'L', stock: 3 },
            { size: 'XL', stock: 2 },
          ],
        },
        {
          name: 'Satin Silk Evening Slip Dress',
          slug: 'satin-silk-evening-slip-dress',
          category: 'Clothing',
          price: 32000,
          originalPrice: 38000,
          description: 'Bias-cut fluid satin with delicate spaghetti straps and subtle side slit.',
          isFeatured: true,
          rating: 4.8,
          reviewsCount: 9,
          images: [
            'https://images.unsplash.com/photo-1572804013309-59a88b7e92f1?q=80&w=800&auto=format&fit=crop',
          ],
          sizes: [
            { size: 'S', stock: 5 },
            { size: 'M', stock: 2 },
          ],
        },
      ]);

      await FabricProduct.create([
        {
          name: 'Pure Indigo Washed Linen',
          slug: 'pure-indigo-washed-linen',
          category: 'Fabrics',
          price: 14000,
          pricePerYard: 14000,
          description: '100% breathable organic European flax linen, medium weight 185 GSM.',
          material: 'Linen',
          isFeatured: true,
          rating: 5.0,
          reviewsCount: 6,
          images: [
            'https://images.unsplash.com/photo-1604014237800-1c9102c219da?q=80&w=800&auto=format&fit=crop',
          ],
          colorVariants: [
            {
              colorName: 'Deep Indigo',
              colorHex: '#1B263B',
              rollStockHalfYards: 60, // 30 yards
              image: 'https://images.unsplash.com/photo-1604014237800-1c9102c219da?q=80&w=800&auto=format&fit=crop',
            },
          ],
        },
        {
          name: 'Super 150s Pure Wool Suiting',
          slug: 'super-150s-pure-wool-suiting',
          category: 'Fabrics',
          price: 28000,
          pricePerYard: 28000,
          description: 'Finest Australian merino wool twill suiting with luxurious natural luster.',
          material: 'Wool',
          isFeatured: true,
          rating: 5.0,
          reviewsCount: 4,
          images: [
            'https://images.unsplash.com/photo-1594938298603-c8148c4dae35?q=80&w=800&auto=format&fit=crop',
          ],
          colorVariants: [
            {
              colorName: 'Midnight Navy',
              colorHex: '#0B132B',
              rollStockHalfYards: 50, // 25 yards
              image: 'https://images.unsplash.com/photo-1594938298603-c8148c4dae35?q=80&w=800&auto=format&fit=crop',
            },
          ],
        },
      ]);
      console.log('Seeded products successfully');
    }

    // Seed Sample Orders if empty
    const orderCount = await Order.countDocuments();
    if (orderCount === 0) {
      console.log('Seeding sample order...');
      const sampleProd = await RetailProduct.findOne();
      if (sampleProd) {
        const subtotal = sampleProd.price;
        const deliveryFee = 3500;
        const baseAmount = subtotal + deliveryFee;
        const calculatedFee = (5 / 100) * baseAmount + 100;
        const paymentFee = Math.round(Math.min(calculatedFee, 5000));
        const totalAmount = Math.round(baseAmount + paymentFee);

        await Order.create({
          orderNumber: 'MCL-20261027-8492',
          customer: {
            name: 'Ngozi Adeyemi',
            phone: '08023456789',
            email: 'ngozi@example.com',
          },
          shippingAddress: {
            street: '14 Admiralty Way, Lekki Phase 1',
            city: 'Lagos',
            state: 'Lagos',
            deliveryTier: 'lagos_island',
            deliveryFee,
          },
          orderItems: [
            {
              product: sampleProd._id,
              productType: 'retail',
              name: sampleProd.name,
              unitPrice: sampleProd.price,
              quantity: 1,
              size: 'M',
              subtotal: sampleProd.price,
            },
          ],
          pricing: {
            subtotal,
            deliveryFee,
            baseAmount,
            paymentFee,
            totalAmount,
          },
          payment: {
            gateway: 'paystack',
            status: 'paid',
            reference: 'MCL_REF_9812497',
            paidAt: new Date(),
          },
          fulfillment: {
            status: 'pending',
            timeline: [
              {
                status: 'pending',
                timestamp: new Date(),
                note: 'Order confirmed and paid via Paystack',
              },
            ],
          },
        });
        console.log('Sample order seeded successfully');
      }
    }

    console.log('✅ Seed completed successfully');
    process.exit(0);
  } catch (err) {
    console.error('Seed error:', err);
    process.exit(1);
  }
}

seed();
