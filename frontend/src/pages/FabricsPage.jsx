import React, { useState, useEffect } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Layers, Loader2, Sparkles, ArrowLeft } from 'lucide-react';
import { useCart } from '../context/CartContext';
import api from '../api/catalog';

const FabricsPage = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const materialParam = searchParams.get('material') || '';

  const { addFabricItem } = useCart();
  const [fabrics, setFabrics] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [selectedMaterial, setSelectedMaterial] = useState(materialParam || 'All Materials');

  const materials = [
    'All Materials',
    'Cotton',
    'Linen',
    'Silk',
    'Ankara',
    'Wool',
    'Denim',
    'Chiffon',
    'Satin',
    'Lace',
    'Velvet',
    'Crepe',
  ];

  useEffect(() => {
    setSelectedMaterial(materialParam || 'All Materials');
  }, [materialParam]);

  useEffect(() => {
    const fetchFabrics = async () => {
      setLoading(true);
      setError(false);
      try {
        let endpoint = `/products?productType=fabric&limit=24`;
        if (selectedMaterial && selectedMaterial !== 'All Materials') {
          endpoint += `&material=${encodeURIComponent(selectedMaterial)}`;
        }

        const res = await api.get(endpoint);
        if (res.data?.success) {
          setFabrics(res.data.data);
        }
      } catch (err) {
        console.warn(err.message);
        setError(true);
        setFabrics([]);
      } finally {
        setLoading(false);
      }
    };

    fetchFabrics();
  }, [selectedMaterial]);

  const handleMaterialChange = (mat) => {
    setSelectedMaterial(mat);
    if (mat === 'All Materials') {
      searchParams.delete('material');
    } else {
      searchParams.set('material', mat);
    }
    setSearchParams(searchParams);
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8 space-y-6">
      <Link
        to="/"
        className="inline-flex items-center gap-1.5 text-xs font-semibold text-text-secondary hover:text-text-primary transition-colors"
      >
        <ArrowLeft className="w-4 h-4" />
        <span>Return to Home</span>
      </Link>

      {/* Header Banner */}
      <div className="bg-neutral-900 text-white rounded-3xl p-6 sm:p-10 relative overflow-hidden ">
        <div className="max-w-xl space-y-2.5 relative z-10">
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-white/10 text-xs font-semibold text-white">
            <Layers className="w-3.5 h-3.5" />
            <span>Priced & Sold by the Yard</span>
          </div>
          <h1 className="text-2xl sm:text-4xl font-editorial tracking-tight text-white">
            Authentic Fabrics by the Yard
          </h1>
          <p className="text-xs sm:text-sm text-neutral-300 font-light leading-relaxed">
            All fabrics are measured and cut with precision from fresh continuous rolls in 0.5-yard increments. Suitable for tailored outfits, kaftans, and luxury interior design.
          </p>
        </div>
      </div>

      {/* Material Filter Pills */}
      <div className="flex items-center gap-2 overflow-x-auto no-scrollbar pb-1">
        {materials.map((mat) => {
          const isSelected = selectedMaterial === mat || (!selectedMaterial && mat === 'All Materials');
          return (
            <button
              key={mat}
              onClick={() => handleMaterialChange(mat)}
              className={`px-4 py-2 rounded-full text-xs font-medium transition-all pressable whitespace-nowrap ${
                isSelected
                  ? 'bg-control-primary text-control-primary-text font-bold shadow-xs'
                  : 'bg-surface border border-border text-text-secondary hover:text-text-primary'
              }`}
            >
              {mat}
            </button>
          );
        })}
      </div>

      {/* Fabrics Grid */}
      {loading ? (
        <div className="py-24 flex items-center justify-center">
          <Loader2 className="w-8 h-8 text-text-tertiary animate-spin" />
        </div>
      ) : fabrics.length === 0 ? (
        <div className="py-20 text-center text-text-tertiary space-y-2">
          <p className="text-sm">{error ? 'Fabrics are unavailable right now. Please try again shortly.' : `No fabrics found in ${selectedMaterial}`}</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 sm:gap-6">
          {fabrics.map((fabric) => (
            <div
              key={fabric._id}
              className="group overflow-hidden rounded-xl"
            >
              <Link to={`/fabrics/${fabric.slug}`} className="block relative aspect-square overflow-hidden">
                <img
                  src={fabric.images?.[0]}
                  loading="lazy"
                  alt={fabric.name}
                  className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                />
                <span className="absolute top-2.5 right-2.5 bg-black/70 backdrop-blur-md text-white text-[10px] font-semibold px-2.5 py-1 rounded-full">
                  {fabric.material}
                </span>
              </Link>

              <div className="pt-3 space-y-2.5">
                <Link to={`/fabrics/${fabric.slug}`}>
                  <h3 className="text-sm font-medium text-text-primary line-clamp-1 hover:underline">
                    {fabric.name}
                  </h3>
                </Link>

                {/* Swatches */}
                <div className="flex items-center gap-1.5">
                  {fabric.colorVariants?.map((cv) => (
                    <span
                      key={cv._id}
                      title={cv.colorName}
                      style={{ backgroundColor: cv.swatchColor || '#888' }}
                      className="w-3.5 h-3.5 rounded-full border border-border inline-block shadow-2xs"
                    />
                  ))}
                  <span className="text-[11px] text-text-tertiary ml-1">
                    {fabric.colorVariants?.length || 1} shades
                  </span>
                </div>

                <div className="pt-2 border-t border-border flex items-center justify-between">
                  <div>
                    <span className="text-xs sm:text-sm font-bold text-text-primary">
                      ₦{fabric.pricePerYard.toLocaleString()}
                    </span>
                    <span className="text-xs text-text-tertiary"> /yd</span>
                  </div>

                  <button
                    disabled={!fabric.colorVariants?.[0] || (fabric.colorVariants[0].availableHalfYards ?? fabric.colorVariants[0].rollStockHalfYards) < 2}
                    onClick={() =>
                      addFabricItem({
                        product: fabric,
                        colorVariant: fabric.colorVariants?.[0],
                        yards: 1,
                      })
                    }
                    className="px-3.5 py-1.5 rounded-full bg-control-primary text-control-primary-text text-xs font-semibold pressable shadow-xs"
                  >
                    + 1 Yard
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default FabricsPage;
