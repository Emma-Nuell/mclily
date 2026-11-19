import { Link } from 'react-router-dom';

export default function NotFoundPage() {
  return (
    <section className="account-page">
      <p className="section-eyebrow">404</p>
      <h1 className="text-3xl font-semibold">Page not found.</h1>
      <p className="mt-4 text-text-secondary">
        This page may have moved. You can continue browsing the shop.
      </p>
      <Link to="/shop" className="text-link mt-6">
        Back to the shop
      </Link>
    </section>
  );
}
