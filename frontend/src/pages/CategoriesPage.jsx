import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Search, ArrowRight } from 'lucide-react';
import SearchModal from '../components/SearchModal';

const categories = [
  ['Men', '/shop?category=Men', 'mclily-campaign-v2.jpg'],
  ['Women', '/shop?category=Women', 'womens-edit.jpg'],
  ['Shoes', '/shop?category=Shoes', 'footwear-edit.jpg'],
  ['Bags', '/shop?category=Bags', 'bags-edit.jpg'],
  ['Electronics', '/shop?category=Electronics', 'electronics-edit.jpg'],
  ['Home & Kitchen', '/shop?category=Appliances', 'home-edit.jpg'],
  ['Kids & Babies', '/shop?category=Kids', 'kids-edit.jpg'],
  ['Beauty', '/shop?category=Beauty', 'beauty-edit.jpg'],
  ['Fabrics by the Yard', '/fabrics', 'fabric-editorial-v2.jpg'],
  ['Bespoke Tailoring', '/tailoring', 'tailoring-campaign.jpg'],
];

export default function CategoriesPage() {
  const [searchOpen, setSearchOpen] = useState(false);
  return <div className="max-w-7xl mx-auto px-4 sm:px-8 py-5 sm:py-10">
    <div className="flex items-center justify-between mb-5 gap-6"><h1 className="text-2xl sm:text-3xl font-semibold tracking-tight">Find your everyday.</h1><span className="hidden sm:block text-sm text-text-secondary">Something for every part of life.</span></div>
    <button className="category-search pressable" onClick={() => setSearchOpen(true)}><Search size={17} strokeWidth={1.5} /><span>Search products, brands and more</span></button>
    <nav className="flex gap-2 overflow-x-auto no-scrollbar py-4 mb-1" aria-label="Browse collections">{[['All','/shop'],['Clothing','/shop?category=Clothing'],['Shoes','/shop?category=Shoes'],['Bags','/shop?category=Bags'],['Fabrics','/fabrics']].map(([label,path], i) => <Link key={path} to={path} className={`text-[11px] px-4 py-2 rounded-full whitespace-nowrap ${i === 0 ? 'bg-control-primary text-control-primary-text' : 'bg-surface text-text-secondary border border-border'}`}>{label}</Link>)}</nav>
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-5">
      {categories.map(([name,path,image]) => <Link className="category-tile pressable" to={path} key={path}><div><img src={`/images/${image}`} alt="" loading="lazy" /></div><span>{name}</span><small>{path === '/tailoring' ? 'Explore' : 'Shop Now'} <ArrowRight size={12} /></small></Link>)}
    </div>
    <SearchModal isOpen={searchOpen} onClose={() => setSearchOpen(false)} />
  </div>;
}
