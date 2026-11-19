import {
  Children,
  cloneElement,
  isValidElement,
  useEffect,
  useId,
  useRef,
} from 'react';
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  Loader2,
  Search,
  X,
} from 'lucide-react';

export function PageHeading({ title, description, children }) {
  return (
    <div className="page-heading">
      <div>
        <h1>{title}</h1>
        {description && <p>{description}</p>}
      </div>
      {children}
    </div>
  );
}
export function Field({ label, hint, children }) {
  const id = useId();
  const hintId = id + '-hint';
  // A Field owns one form control, which may sit inside a wrapper (e.g. a password reveal control).
  function linkControl(child) {
    if (!isValidElement(child)) return child;
    if (['input', 'select', 'textarea'].includes(child.type)) {
      return cloneElement(child, {
        id,
        'aria-describedby':
          [child.props['aria-describedby'], hint ? hintId : null]
            .filter(Boolean)
            .join(' ') || undefined,
      });
    }
    return child.props.children
      ? cloneElement(child, {}, Children.map(child.props.children, linkControl))
      : child;
  }
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {Children.map(children, linkControl)}
      {hint && <small id={hintId}>{hint}</small>}
    </div>
  );
}
export function Notice({ children, tone = 'error' }) {
  return (
    <div
      className={`notice notice-${tone}`}
      role={tone === 'error' ? 'alert' : 'status'}
    >
      <AlertCircle size={20} className="shrink-0 mt-0.5" />
      <div>{children}</div>
    </div>
  );
}
export function Loading({ text = 'Loading…' }) {
  return (
    <div className="empty" role="status">
      <Loader2 size={24} className="spinner" />
      <p>{text}</p>
    </div>
  );
}
export function Empty({ title, children }) {
  return (
    <div className="empty">
      <h3>{title}</h3>
      <p>{children}</p>
    </div>
  );
}
export function SearchField({
  value,
  onChange,
  label = 'Search products',
  placeholder,
}) {
  return (
    <div className="search-field">
      <Search size={18} />
      <input
        className="control"
        type="search"
        aria-label={label}
        placeholder={placeholder || label}
        value={value}
        onChange={onChange}
      />
    </div>
  );
}
export function Status({ children, tone = '' }) {
  return (
    <span className={`status ${tone ? `status-${tone}` : ''}`}>{children}</span>
  );
}
export function Pagination({ page, pages, onChange, loading }) {
  if (pages <= 1) return null;
  return (
    <nav className="pagination" aria-label="Pagination">
      <button
        className="btn btn-icon"
        type="button"
        aria-label="Previous page"
        disabled={page <= 1 || loading}
        onClick={() => onChange(page - 1)}
      >
        <ArrowLeft size={18} />
      </button>
      <span>
        Page {page} of {pages}
      </span>
      <button
        className="btn btn-icon"
        type="button"
        aria-label="Next page"
        disabled={page >= pages || loading}
        onClick={() => onChange(page + 1)}
      >
        <ArrowRight size={18} />
      </button>
    </nav>
  );
}
export function Modal({ title, children, onClose, busy = false }) {
  const dialog = useRef(null);
  const titleId = useId();
  useEffect(() => {
    const node = dialog.current,
      previous = document.activeElement,
      overflow = document.body.style.overflow;
    node.showModal();
    document.body.style.overflow = 'hidden';
    return () => {
      node.close();
      document.body.style.overflow = overflow;
      if (previous?.isConnected) previous.focus();
    };
  }, []);
  return (
    <dialog
      ref={dialog}
      className="admin-dialog"
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onClose();
      }}
      onClick={(event) => {
        if (!busy && event.target === dialog.current) {
          const r = dialog.current.getBoundingClientRect();
          if (
            event.clientX < r.left ||
            event.clientX > r.right ||
            event.clientY < r.top ||
            event.clientY > r.bottom
          )
            onClose();
        }
      }}
    >
      <div className="dialog-head">
        <h2 id={titleId}>{title}</h2>
        <button
          className="btn btn-quiet btn-icon"
          type="button"
          aria-label="Close dialog"
          onClick={onClose}
          disabled={busy}
        >
          <X size={20} />
        </button>
      </div>
      <div className="dialog-body">{children}</div>
    </dialog>
  );
}
