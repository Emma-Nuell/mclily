import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Shirt, Footprints, ShoppingBag, Layers, House, Scissors, Grid2X2, UserRound, ShieldCheck, Truck, MessageCircle } from 'lucide-react';
import api from '../api/catalog';
import ProductCard from '../components/ProductCard';

const shortcuts = [
  { name: 'Men', icon: UserRound, path: '/shop?category=Men' },
  { name: 'Women', icon: Shirt, path: '/shop?category=Women' },
  { name: 'Shoes', icon: Footprints, path: '/shop?category=Shoes' },
  { name: 'Bags', icon: ShoppingBag, path: '/shop?category=Bags' },
  { name: 'Fabrics', icon: Layers, path: '/fabrics' },
  { name: 'Home & Kitchen', icon: House, path: '/shop?category=Appliances' },
  { name: 'Tailoring', icon: Scissors, path: '/tailoring' },
  { name: 'More', icon: Grid2X2, path: '/categories' },
];

export default function HomePage() {
  const [products, setProducts] = useState([]);
  const [fabrics, setFabrics] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  useEffect(() => {
    let active = true;
    Promise.all([api.get('/products?limit=8&productType=retail'), api.get('/products?limit=4&productType=fabric')])
      .then(([retail, fabric]) => {
        if (!active) return;
        setProducts(retail.data?.data || []);
        setFabrics(fabric.data?.data || []);
      })
      .catch(() => { if (active) setError(true); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);
  return (
    <div className="storefront-home">
      <section className="home-hero" aria-labelledby="home-heading">
        <picture className="hero-visual">
          <source media="(max-width: 767px)" srcSet="/images/mclily-shopping-campaign-mobile-v4.webp" />
          <img className="hero-photograph" src="/images/mclily-shopping-campaign-v3-1536.webp" alt="Two shoppers carrying cream and forest-green McLily bags in a sunlit courtyard" width="1536" height="1024" fetchPriority="high" />
        </picture>
        <div className="hero-shade" />
        <div className="hero-copy">
          <div className="hero-brand">McLily<span>.</span></div>
          <p className="hero-eyebrow">Style. Quality. Convenience.</p>
          <h1 id="home-heading">Everything You Need,<br />All in One Place.</h1>
          <p>Fashion, shoes, electronics, home essentials,<br className="hidden sm:block" /> beauty and more — delivered to your door.</p>
          <Link to="/shop" className="campaign-button pressable">Shop Now <ArrowRight size={16} /></Link>
        </div>
      </section>
      <div className="home-content">
        <nav className="category-shortcuts" aria-label="Shop by category">
          {shortcuts.map(({ name, icon: Icon, path }) => <Link key={name} to={path} className="category-shortcut pressable"><span><Icon size={23} strokeWidth={1.4} /></span><span>{name}</span></Link>)}
        </nav>
        <section className="arrivals-campaign" aria-labelledby="arrivals-title">
          <img src="/images/arrivals-campaign-v2.jpg" alt="Minimal white sneakers in a dark editorial setting" loading="lazy" />
          <div><p className="campaign-eyebrow">The everyday edit</p><h2 id="arrivals-title">Fresh Styles,<br />Bigger Vibes.</h2><p>A fresh perspective on your everyday.</p><Link to="/shop" className="campaign-button pressable">Shop New Arrivals <ArrowRight size={14} /></Link></div>
        </section>
        <section className="home-section" aria-labelledby="picks-heading">
          <div className="section-heading"><div><p className="section-eyebrow">Discover McLily</p><h2 id="picks-heading">Your next favourites.</h2></div><Link to="/shop">Shop all <ArrowRight size={15} /></Link></div>
          {loading ? <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-6" aria-label="Loading products">{[1,2,3,4].map(i => <div key={i} className="aspect-[3/4] rounded-xl bg-surface-secondary animate-pulse" />)}</div>
            : error ? <div className="catalog-message"><p>We couldn’t load the collection right now.</p><Link to="/shop">Try the shop <ArrowRight size={14} /></Link></div>
            : products.length ? <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-x-3 gap-y-6 sm:gap-x-6 sm:gap-y-9">{products.map(product => <ProductCard key={product._id} product={product} />)}</div>
            : <p className="catalog-message">Our next collection is on its way. Check back soon.</p>}
        </section>
        <div className="shopping-benefits"><div><Truck size={20} strokeWidth={1.4} /><span>Delivery options at checkout</span></div><div><ShieldCheck size={20} strokeWidth={1.4} /><span>Secure checkout</span></div><div><MessageCircle size={20} strokeWidth={1.4} /><span>WhatsApp support</span></div></div>
        <section className="division-feature fabric-feature">
          <div className="division-copy"><p className="section-eyebrow">For what you have in mind</p><h2>Beautiful fabric.<br />Endless possibilities.</h2><p>Find your texture, colour and perfect starting point. Discover fabrics by the yard.</p><Link className="text-link" to="/fabrics">Shop Fabrics <ArrowRight size={16} /></Link></div>
          <div className="fabric-preview">{fabrics.length ? fabrics.slice(0,2).map(fabric => <Link key={fabric._id} to={`/fabrics/${fabric.slug}`}><img src={fabric.images?.[0]} alt={fabric.name} loading="lazy" /><span>{fabric.name}<small>₦{fabric.pricePerYard.toLocaleString()} /yd</small></span></Link>) : <img src="/images/fabric-editorial-v2.jpg" alt="Detail of soft woven cotton" loading="lazy" />}</div>
        </section>
        <section className="division-feature tailoring-feature">
          <img src="/images/tailoring-campaign.jpg" alt="Detail of a tailored suit" loading="lazy" />
          <div className="division-copy"><p className="section-eyebrow">Made for you</p><h2>Tailored to<br />Your Style.</h2><p>From the first idea to the final fit. Explore our bespoke tailoring division and bring your vision to life.</p><Link to="/tailoring" className="text-link">Explore Tailoring <ArrowRight size={16} /></Link></div>
        </section>
      </div>
    </div>
  );
}
