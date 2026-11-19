import WhatsAppLink from './WhatsAppLink';
import React from 'react';
import { Link } from 'react-router-dom';
import { MessageCircle, ShieldCheck, Truck, RotateCcw } from 'lucide-react';

const Footer = () => {
  return (
    <footer id="about" className="bg-surface border-t border-border pt-12 pb-28 md:pb-12 text-text-secondary">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Brand Info & Links Grid */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-8 pb-12 border-b border-border">
          {/* Brand Col */}
          <div className="col-span-2 md:col-span-1 space-y-3">
            <Link to="/" className="inline-block">
              <span className="brand-wordmark text-text-primary">McLily</span>
            </Link>
            <p className="text-xs text-text-secondary leading-relaxed font-light">
              McLily is a contemporary lifestyle house offering curated retail fashion, luxury fabrics sold by the yard, and master bespoke tailoring.
            </p>
            <span className="inline-block text-[11px] font-bold uppercase tracking-wider text-text-tertiary">
              Style · Quality · Convenience
            </span>
          </div>

          {/* Quick Links */}
          <div className="space-y-3">
            <h5 className="text-xs font-bold text-text-primary uppercase tracking-wider">
              Explore
            </h5>
            <ul className="space-y-2 text-xs">
              <li>
                <Link to="/shop" className="hover:text-text-primary transition-colors">
                  Shop
                </Link>
              </li>
              <li>
                <Link to="/categories" className="hover:text-text-primary transition-colors">
                  Categories
                </Link>
              </li>
              <li>
                <Link to="/fabrics" className="hover:text-text-primary transition-colors">
                  Fabrics by the Yard
                </Link>
              </li>
              <li>
                <Link to="/tailoring" className="hover:text-text-primary transition-colors">
                  Tailoring Lookbook
                </Link>
              </li>
              <li>
                <Link to="/wishlist" className="hover:text-text-primary transition-colors">
                  Wishlist
                </Link>
              </li>
            </ul>
          </div>

          {/* Fabrics Taxonomy */}
          <div className="space-y-3">
            <h5 className="text-xs font-bold text-text-primary uppercase tracking-wider">
              Fabrics by Material
            </h5>
            <ul className="space-y-2 text-xs">
              <li><Link to="/fabrics?material=Cotton" className="hover:text-text-primary transition-colors">Pure Cotton</Link></li>
              <li><Link to="/fabrics?material=Linen" className="hover:text-text-primary transition-colors">Italian Crisp Linen</Link></li>
              <li><Link to="/fabrics?material=Silk" className="hover:text-text-primary transition-colors">Raw Mulberry Silk</Link></li>
              <li><Link to="/fabrics?material=Ankara" className="hover:text-text-primary transition-colors">Authentic Ankara Wax</Link></li>
              <li><Link to="/fabrics?material=Chiffon" className="hover:text-text-primary transition-colors">Chiffon & Crepe</Link></li>
            </ul>
          </div>

          {/* Direct Support & WhatsApp */}
          <div className="space-y-3">
            <h5 className="text-xs font-bold text-text-primary uppercase tracking-wider">
              Direct Contact
            </h5>
            <p className="text-xs text-text-secondary">
              Need quick support or want to order bespoke custom wear directly with our tailors?
            </p>
            <WhatsAppLink
              message="Hi McLily, I’d like to inquire about your products."
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-full bg-control-primary text-control-primary-text text-xs font-semibold shadow-xs transition-colors pressable"
            >
              <MessageCircle className="w-4 h-4" />
              <span>Chat on WhatsApp</span>
            </WhatsAppLink>
          </div>
        </div>

        {/* Copyright */}
        <div className="pt-8 flex flex-col sm:flex-row justify-between items-center text-xs text-text-tertiary gap-4">
          <p>© {new Date().getFullYear()} McLily Lifestyle Ltd. All rights reserved.</p>
          <div className="flex gap-6">
            <Link to="/shop" className="hover:text-text-secondary transition-colors">Shop McLily</Link>
            <Link to="/tailoring" className="hover:text-text-secondary transition-colors">Custom Tailoring</Link>
          </div>
        </div>
      </div>
    </footer>
  );
};

export default Footer;
