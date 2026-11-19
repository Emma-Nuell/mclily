import { createRequestId } from '../../vendor/requestId.mjs';
import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Camera,
  Check,
  Plus,
  Trash2,
  ArrowUp,
  ArrowUpRight,
} from 'lucide-react';
import api from '../api/client';
import { PageHeading, Field, Notice } from '../components/AdminUI';
import { storefrontUrl } from '../utils/products';
import { formatNaira } from '../utils/conversions';

const freshVariant = () => ({
  key: createRequestId(),
  size: '',
  color: '',
  stock: '',
});
export default function QuickPostPage() {
  const fileInput = useRef(null);
  const [type, setType] = useState('retail'),
    [name, setName] = useState(''),
    [price, setPrice] = useState('');
  const [images, setImages] = useState([]),
    [variants, setVariants] = useState([freshVariant()]);
  const [category, setCategory] = useState('Clothing'),
    [material, setMaterial] = useState('Other'),
    [description, setDescription] = useState(''),
    [featured, setFeatured] = useState(false);
  const [deliveryRequiresQuote, setDeliveryRequiresQuote] = useState(false);
  const [uploading, setUploading] = useState(false),
    [saving, setSaving] = useState(false),
    [error, setError] = useState(''),
    [published, setPublished] = useState(null);
  const busy = uploading || saving;
  const fabric = type === 'fabric';
  const updateVariant = (key, field, value) =>
    setVariants((rows) =>
      rows.map((row) => (row.key === key ? { ...row, [field]: value } : row))
    );
  async function upload(event) {
    const files = Array.from(event.target.files || []);
    if (!files.length) return;
    if (images.length + files.length > 8) {
      setError('You can add up to eight photos.');
      return;
    }
    if (
      files.some(
        (file) =>
          !['image/jpeg', 'image/png', 'image/webp', 'image/avif'].includes(
            file.type
          ) || file.size > 10 * 1024 * 1024
      )
    ) {
      setError('Use JPG, PNG, WebP or AVIF images, up to 10 MB each.');
      return;
    }
    setUploading(true);
    setError('');
    try {
      const data = new FormData();
      files.forEach((file) => data.append('images', file));
      const res = await api.post('/media/upload', data, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      if (!res.data?.success || !Array.isArray(res.data.data))
        throw new Error('Could not upload your photos.');
      setImages((previous) => [...previous, ...res.data.data]);
    } catch (err) {
      setError(err.response?.data?.message || err.message);
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = '';
    }
  }
  async function submit(event) {
    event.preventDefault();
    if (busy) return;
    setError('');
    if (!images.length) {
      setError('Add at least one product photo.');
      return;
    }
    if (
      !name.trim() ||
      !Number.isFinite(Number(price)) ||
      Number(price) <= 0 ||
      Math.abs(Number(price) * 100 - Math.round(Number(price) * 100)) > 0.000001
    ) {
      setError(
        'Enter a name and a positive price with at most two decimal places.'
      );
      return;
    }
    if (
      variants.some(
        (v) =>
          v.stock === '' ||
          !Number.isFinite(Number(v.stock)) ||
          Number(v.stock) < 0 ||
          !Number.isInteger(Number(v.stock) * (fabric ? 2 : 1))
      )
    ) {
      setError(
        fabric
          ? 'Enter stock for every colour in half-yard increments.'
          : 'Enter a whole-number stock quantity for every size/colour.'
      );
      return;
    }
    if (fabric && variants.some((v) => !v.color.trim())) {
      setError('Give each fabric colour or pattern a name.');
      return;
    }
    const labels = variants.map((v) =>
      fabric
        ? v.color.trim().toLowerCase()
        : JSON.stringify([
            v.size.trim().toLowerCase(),
            v.color.trim().toLowerCase(),
          ])
    );
    if (new Set(labels).size !== labels.length) {
      setError('Each size/colour combination must be different.');
      return;
    }
    setSaving(true);
    try {
      const payload = {
        productType: type,
        name: name.trim(),
        price: Number(price),
        images,
        description: description.trim() || name.trim(),
        isFeatured: featured,
        deliveryRequiresQuote,
        ...(fabric
          ? {
              category: 'Fabrics',
              material,
              pricePerYard: Number(price),
              colorVariants: variants.map((v) => ({
                colorName: v.color.trim(),
                rollStockHalfYards: Number(v.stock) * 2,
                image: images[0],
              })),
            }
          : {
              category,
              sizes: variants.map((v) => ({
                size: v.size.trim() || undefined,
                color: v.color.trim() || undefined,
                stock: Number(v.stock),
              })),
            }),
      };
      const res = await api.post('/products', payload);
      if (!res.data?.success)
        throw new Error(res.data?.message || 'Could not save your product.');
      setPublished(res.data.data);
    } catch (err) {
      setError(err.response?.data?.message || err.message);
    } finally {
      setSaving(false);
    }
  }
  function reset() {
    setPublished(null);
    setName('');
    setPrice('');
    setImages([]);
    setVariants([freshVariant()]);
    setDescription('');
    setFeatured(false);
    setDeliveryRequiresQuote(false);
    setError('');
  }
  if (published)
    return (
      <div className="page-stack form-narrow">
        <div className="notice">
          <Check size={22} />
          <div>
            <h2>Product added.</h2>
            <p className="mt-1">Saved to your product catalog.</p>
          </div>
        </div>
        <section className="panel panel-pad">
          <div className="list-row">
            <img className="product-thumb" src={published.images?.[0]} alt="" />
            <div className="row-info">
              <h1 className="text-xl">{published.name}</h1>
              <p className="row-meta">
                {formatNaira(fabric ? published.pricePerYard : published.price)}
                {fabric ? ' / yd' : ''}
              </p>
            </div>
          </div>
        </section>
        <div className="inline-actions">
          <button className="btn btn-primary" onClick={reset}>
            <Plus size={18} />
            Add another product
          </button>
          <Link className="btn" to="/products">
            View products
          </Link>
          <a
            className="btn btn-quiet"
            href={`${storefrontUrl}/product/${published.slug}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            View in store
            <ArrowUpRight size={17} />
          </a>
        </div>
      </div>
    );
  return (
    <div className="page-stack form-narrow">
      <PageHeading
        title="Add product"
        description="A photo, a name, a price and the stock you have."
      />
      <div className="segmented" aria-label="Product type">
        {[
          ['retail', 'Retail item'],
          ['fabric', 'Fabric by the yard'],
        ].map(([value, label]) => (
          <button
            key={value}
            type="button"
            disabled={busy}
            aria-pressed={type === value}
            onClick={() => {
              setType(value);
              setVariants([freshVariant()]);
            }}
          >
            {label}
          </button>
        ))}
      </div>
      <form className="form-stack" onSubmit={submit} noValidate>
        <fieldset
          disabled={busy}
          className="panel panel-pad form-stack border border-[var(--border-subtle)]"
        >
          <legend className="sr-only">Product information</legend>
          <div className="form-stack">
            <div className="field">
              <span>Product photos</span>
              <button
                className="photo-upload"
                type="button"
                onClick={() => fileInput.current?.click()}
              >
                <Camera size={26} strokeWidth={1.5} />
                <span>{uploading ? 'Uploading photos…' : 'Add photos'}</span>
                <small>Choose from your camera or photo library</small>
              </button>
              <input
                ref={fileInput}
                type="file"
                className="sr-only"
                aria-label="Choose product photos"
                accept="image/jpeg,image/png,image/webp,image/avif"
                multiple
                onChange={upload}
              />
            </div>
            {images.length > 0 && (
              <div className="photo-grid">
                {images.map((image, index) => (
                  <div className="photo-item" key={image + index}>
                    <img src={image} alt={`Product photo ${index + 1}`} />
                    <div className="inline-actions">
                      {index === 0 ? (
                        <small className="muted">Cover photo</small>
                      ) : (
                        <button
                          className="btn btn-quiet btn-icon"
                          type="button"
                          aria-label={`Make photo ${index + 1} the cover`}
                          onClick={() =>
                            setImages((previous) => [
                              previous[index],
                              ...previous.filter((_, i) => i !== index),
                            ])
                          }
                        >
                          <ArrowUp size={18} />
                        </button>
                      )}
                      <button
                        className="btn btn-quiet btn-icon"
                        type="button"
                        aria-label={`Remove photo ${index + 1}`}
                        onClick={() =>
                          setImages((previous) =>
                            previous.filter((_, i) => i !== index)
                          )
                        }
                      >
                        <Trash2 size={18} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
          <Field label="Product name">
            <input
              className="control"
              name="name"
              required
              maxLength={200}
              placeholder={
                fabric ? 'e.g. Blue floral Ankara' : 'e.g. Linen shirt'
              }
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </Field>
          <div className="form-grid">
            <Field label={fabric ? 'Price per yard (₦)' : 'Price (₦)'}>
              <input
                className="control"
                name="price"
                type="number"
                inputMode="decimal"
                min="0.01"
                step="0.01"
                required
                placeholder="0.00"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
              />
            </Field>
            <Field
              label={fabric ? 'Stock in yards' : 'Stock quantity'}
              hint={
                fabric
                  ? 'Half-yard increments, e.g. 12.5'
                  : 'Number of pieces you have'
              }
            >
              <input
                className="control"
                type="number"
                inputMode={fabric ? 'decimal' : 'numeric'}
                min="0"
                step={fabric ? '0.5' : '1'}
                required
                placeholder="0"
                value={variants[0].stock}
                onChange={(e) =>
                  updateVariant(variants[0].key, 'stock', e.target.value)
                }
              />
            </Field>
          </div>
          {fabric && (
            <Field label="Colour or pattern">
              <input
                className="control"
                required
                value={variants[0].color}
                placeholder="e.g. Blue floral"
                onChange={(e) =>
                  updateVariant(variants[0].key, 'color', e.target.value)
                }
              />
            </Field>
          )}
          <details className="disclosure">
            <summary>
              More details <span className="muted font-normal">(optional)</span>
            </summary>
            <div className="form-stack">
              {!fabric ? (
                <>
                  <Field label="Category">
                    <select
                      className="control"
                      value={category}
                      onChange={(e) => setCategory(e.target.value)}
                    >
                      {[
                        'Clothing',
                        'Shoes',
                        'Electronics',
                        'Appliances',
                        'Fashion Accessories',
                        'Beauty',
                      ].map((value) => (
                        <option key={value}>{value}</option>
                      ))}
                    </select>
                  </Field>
                  <div className="form-grid">
                    <Field label="Size">
                      <input
                        className="control"
                        placeholder="e.g. M, 42, one size"
                        value={variants[0].size}
                        onChange={(e) =>
                          updateVariant(variants[0].key, 'size', e.target.value)
                        }
                      />
                    </Field>
                    <Field label="Colour">
                      <input
                        className="control"
                        placeholder="e.g. Navy"
                        value={variants[0].color}
                        onChange={(e) =>
                          updateVariant(
                            variants[0].key,
                            'color',
                            e.target.value
                          )
                        }
                      />
                    </Field>
                  </div>
                </>
              ) : (
                <Field label="Material">
                  <select
                    className="control"
                    value={material}
                    onChange={(e) => setMaterial(e.target.value)}
                  >
                    {[
                      'Other',
                      'Cotton',
                      'Linen',
                      'Silk',
                      'Wool',
                      'Denim',
                      'Chiffon',
                      'Satin',
                      'Ankara',
                      'Lace',
                      'Polyester',
                      'Velvet',
                      'Crepe',
                    ].map((value) => (
                      <option key={value}>{value}</option>
                    ))}
                  </select>
                </Field>
              )}
              {variants.slice(1).map((variant, index) => (
                <div className="variant-row" key={variant.key}>
                  {!fabric && (
                    <Field label={`Size ${index + 2}`}>
                      <input
                        className="control"
                        value={variant.size}
                        onChange={(e) =>
                          updateVariant(variant.key, 'size', e.target.value)
                        }
                      />
                    </Field>
                  )}
                  <Field label={`Colour / pattern ${index + 2}`}>
                    <input
                      className="control"
                      value={variant.color}
                      required={fabric}
                      onChange={(e) =>
                        updateVariant(variant.key, 'color', e.target.value)
                      }
                    />
                  </Field>
                  <Field
                    label={
                      fabric
                        ? `Stock in yards ${index + 2}`
                        : `Stock quantity ${index + 2}`
                    }
                  >
                    <input
                      className="control"
                      type="number"
                      min="0"
                      step={fabric ? '.5' : '1'}
                      required
                      value={variant.stock}
                      onChange={(e) =>
                        updateVariant(variant.key, 'stock', e.target.value)
                      }
                    />
                  </Field>
                  <div className="variant-controls">
                    <button
                      className="btn btn-quiet"
                      type="button"
                      onClick={() =>
                        setVariants((previous) =>
                          previous.filter((v) => v.key !== variant.key)
                        )
                      }
                    >
                      <Trash2 size={17} />
                      Remove option
                    </button>
                  </div>
                </div>
              ))}
              <button
                className="btn w-fit"
                type="button"
                onClick={() =>
                  setVariants((previous) => [...previous, freshVariant()])
                }
              >
                <Plus size={18} />
                {fabric ? 'Add another colour' : 'Add another size / colour'}
              </button>
              <Field label="Description">
                <textarea
                  className="control"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Anything customers should know?"
                />
              </Field>
              <label className="check-row">
                <input
                  type="checkbox"
                  checked={featured}
                  onChange={(e) => setFeatured(e.target.checked)}
                />
                Feature on the storefront
              </label>
              <label className="check-row">
                <input
                  type="checkbox"
                  checked={deliveryRequiresQuote}
                  onChange={(e) => setDeliveryRequiresQuote(e.target.checked)}
                />
                Bulky or unusual item — delivery quote needed before online
                payment.
              </label>
            </div>
          </details>
        </fieldset>
        {error && <Notice>{error}</Notice>}
        <button className="btn btn-primary btn-wide" disabled={busy}>
          {saving
            ? 'Saving product…'
            : uploading
              ? 'Uploading photos…'
              : 'Save product'}
        </button>
      </form>
    </div>
  );
}
