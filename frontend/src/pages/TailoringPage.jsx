import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, MessageCircle, Ruler, CheckCheck, PackageCheck } from 'lucide-react';
import WhatsAppLink from '../components/WhatsAppLink';
import TailoringOrbitGallery from '../components/tailoring/TailoringOrbitGallery';
import catalog from '../api/catalog';
import styles from '../data/tailoring-styles.json';
import './TailoringPage.css';

const categories = [
  ['Men’s Wear', 'Men', styles[0], 'Suits, kaftans & everyday pieces'],
  ['Women’s Wear', 'Women', styles[1], 'Dresses, separates & occasionwear'],
  ['Children’s Wear', 'Children', styles[4], 'Little looks for their big moments'],
  ['Corporate Outfits', 'Corporate', styles[3], 'Considered looks for working days'],
  ['Traditional Attire', 'Traditional', styles[2], 'A personal take on timeless style'],
];
const steps = [
  [MessageCircle, 'Share Your Idea', 'Send a reference image or describe the style you have in mind.'],
  [Ruler, 'Get Expert Guidance', 'We’ll talk fabric, design and the fit that feels right for you.'],
  [CheckCheck, 'Confirm & Proceed', 'Agree on the details and quote before the making begins.'],
  [PackageCheck, 'Delivery / Pickup', 'We’ll let you know when your outfit is ready for its first outing.'],
];
const enquiry = title => `Hi McLily! I saw “${title}” in your tailoring style inspiration and would love to discuss something similar. Can we talk about fabric, fit and pricing?`;

export default function TailoringPage() {
  const [activeCategory, setActiveCategory] = useState('All');
  const [fabrics, setFabrics] = useState([]);
  const [selectedStyle, setSelectedStyle] = useState(styles[0].id);
  useEffect(() => {
    let active = true;
    catalog.get('/products?productType=fabric&limit=4').then(res => { if (active) setFabrics(res.data?.data || []); }).catch(() => {});
    return () => { active = false; };
  }, []);
  const filterStyles = category => {
    setActiveCategory(category);
    const next = category === 'All' ? styles : styles.filter(style => style.filter === category);
    if (!next.some(style => style.id === selectedStyle)) setSelectedStyle(next[0].id);
  };
  const visibleStyles = activeCategory === 'All' ? styles : styles.filter(style => style.filter === activeCategory);
  const request = (item, className = 'tailor-button tailor-button-primary') => <WhatsAppLink message={enquiry(item.title)} target="_blank" rel="noopener noreferrer" className={className}>Request something similar <ArrowRight size={15} /></WhatsAppLink>;
  return <div className="tailoring-page">
    <section className="tailor-hero" aria-labelledby="tailor-heading">
      <img src="/images/tailoring/atelier-hero.jpg" alt="Brown three-piece tailoring in a warm atelier setting" fetchPriority="high" />
      <div className="tailor-hero-wash" />
      <div className="tailor-hero-copy"><p className="tailor-eyebrow">McLily Tailoring Division</p><h1 id="tailor-heading">Tailored<br />To Your Style.</h1><p>From everyday essentials to special occasions, bring your ideas to life with an outfit designed around your style, body and needs.</p>
        <div className="tailor-hero-actions"><WhatsAppLink message="Hi McLily, I’d like to discuss a custom outfit. Can we talk about styles, fabrics and pricing?" target="_blank" rel="noopener noreferrer" className="tailor-button tailor-button-primary">Request Custom Outfit <MessageCircle size={16} /><ArrowRight size={15} /></WhatsAppLink><a href="#tailoring-gallery" className="tailor-button tailor-button-secondary">Explore Gallery <ArrowRight size={15} /></a></div>
        <div className="tailor-hero-footnote"><span>Made around you.</span><span>From the first idea to the final fit.</span></div>
      </div>
    </section>

    <div className="tailor-content">
      <nav className="tailor-categories" aria-label="Tailoring categories">{categories.map(([name, filter, item, text]) => <a key={filter} href="#style-inspiration" className="tailor-category pressable" onClick={() => filterStyles(filter)}><div><img src={item.image} alt="" style={{objectPosition:item.objectPosition || 'center top'}} loading="lazy" /></div><h2>{name}</h2><p>{text}</p><ArrowRight size={14} /></a>)}</nav>

      <section className="tailor-process" aria-labelledby="process-heading"><div className="tailor-section-heading"><div><p className="tailor-eyebrow">From a thought to a favourite</p><h2 id="process-heading">How It Works</h2></div><p>A simple conversation.<br />A piece that feels like you.</p></div><ol>{steps.map(([Icon, title, text], i) => <li key={title}><span className="tailor-step-icon"><Icon size={20} strokeWidth={1.3} /></span><div><span className="tailor-step-number">0{i+1}</span><div><h3>{title}</h3><p>{text}</p></div></div></li>)}</ol></section>

      <div id="tailoring-gallery" className="tailor-gallery-anchor"><TailoringOrbitGallery items={styles} heading="A closer look at your next idea." renderRequest={item => request(item, 'mcl-orbit__cta')} /></div>

      <section id="style-inspiration" className="tailor-inspiration" aria-labelledby="inspiration-heading"><div className="tailor-section-heading"><div><p className="tailor-eyebrow">The inspiration edit</p><h2 id="inspiration-heading">Find the shape of your style.</h2></div><p>Illustrative style references.<br />Your version starts with a conversation.</p></div>
        <div className="tailor-style-filters" aria-label="Filter style inspiration">{['All','Men','Women','Traditional','Corporate','Casual','Children'].map(category => <button key={category} className="pressable" aria-pressed={activeCategory===category} onClick={()=>filterStyles(category)}>{category}</button>)}</div>
        <div className="tailor-style-grid">{visibleStyles.map(item => <button key={item.id} type="button" className={`tailor-style-card ${selectedStyle===item.id?'is-selected':''}`} aria-pressed={selectedStyle===item.id} onClick={()=>setSelectedStyle(item.id)}><div><img src={item.image} alt={item.title} style={{objectPosition:item.objectPosition || 'center top'}} loading="lazy" /><span>{selectedStyle===item.id ? 'Selected reference' : 'Select this look'}</span></div><h3>{item.title}</h3><p>{item.category}</p></button>)}</div>
        {(() => { const selected=styles.find(item=>item.id===selectedStyle); return <div className="tailor-selected-style"><p><span>Your reference</span>{selected.title}</p>{request(selected)}</div>; })()}
      </section>

      <section className="tailor-lookbook" aria-labelledby="lookbook-heading"><div><p className="tailor-eyebrow">It’s all in the details</p><h2 id="lookbook-heading">Your style.<br />Your starting point.</h2><p>A silhouette, a colour, a detail you can’t stop thinking about. Bring it to us and let’s explore what it could become.</p><WhatsAppLink message="Hi McLily! I have a style reference I’d love to discuss for a custom outfit." target="_blank" rel="noopener noreferrer" className="tailor-text-link">Share your idea <ArrowRight size={16} /></WhatsAppLink></div><div className="tailor-lookbook-images"><img src="/images/tailoring/forest-agbada.jpg" alt="Forest green traditional outfit inspiration" loading="lazy" /><img src="/images/tailoring/olive-evening-gown.jpg" alt="Olive draped eveningwear inspiration" loading="lazy" /><img src="/images/tailoring/little-gentleman.jpg" alt="Ivory children's occasionwear inspiration" loading="lazy" /></div></section>

      {fabrics.length > 0 && <section className="tailor-fabrics" aria-labelledby="tailor-fabrics-heading"><div className="tailor-section-heading"><div><p className="tailor-eyebrow">Start with how it feels</p><h2 id="tailor-fabrics-heading">The fabric makes it yours.</h2></div><Link to="/fabrics" className="tailor-text-link">Browse All Fabrics <ArrowRight size={16} /></Link></div><div className="tailor-fabric-grid">{fabrics.map(fabric=><Link key={fabric._id} to={`/fabrics/${fabric.slug}`}><img src={fabric.images[0]} alt={fabric.name} loading="lazy" /><h3>{fabric.name}</h3><p>₦{fabric.pricePerYard.toLocaleString()} <span>/yd</span></p></Link>)}</div></section>}

      <section className="tailor-final-cta"><div><p className="tailor-eyebrow">Let’s make it personal</p><h2>Have a Style in Mind?</h2><p>Tell us what you’re imagining. We’ll take it from there.</p></div><WhatsAppLink message="Hi McLily, I have a style in mind and would like to discuss a custom outfit." target="_blank" rel="noopener noreferrer" className="tailor-button tailor-button-light">Let’s talk on WhatsApp <MessageCircle size={17} /></WhatsAppLink></section>
    </div>
  </div>;
}
