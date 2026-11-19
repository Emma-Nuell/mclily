import { MotionConfig } from 'framer-motion';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { ThemeProvider } from './context/ThemeContext';
import { CartProvider } from './context/CartContext';
import { WishlistProvider } from './context/WishlistContext';
import { AuthProvider } from './context/AuthContext';

import Navbar from './components/Navbar';
import BottomNav from './components/BottomNav';
import BagDrawer from './components/BagDrawer';
import Footer from './components/Footer';
import PwaStatus from './components/PwaStatus';
import PageMetadata from './components/PageMetadata';
import NotFoundPage from './pages/NotFoundPage';

import HomePage from './pages/HomePage';
import AccountPage from './pages/AccountPage';
import ShopPage from './pages/ShopPage';
import CategoriesPage from './pages/CategoriesPage';
import WishlistPage from './pages/WishlistPage';
import FabricsPage from './pages/FabricsPage';
import ProductDetailPage from './pages/ProductDetailPage';
import TailoringPage from './pages/TailoringPage';
import CheckoutPage from './pages/CheckoutPage';
import OrderConfirmationPage from './pages/OrderConfirmationPage';
import PasswordRecoveryPage from './pages/PasswordRecoveryPage';

function App() {
  return (
    <MotionConfig reducedMotion="user">
    <ThemeProvider>
      <AuthProvider>
        <WishlistProvider>
          <CartProvider>
            <Router>
              <PageMetadata />
              <div className="min-h-screen flex flex-col bg-background text-text-primary transition-colors duration-200">
                <Navbar />
                <main className="flex-1">
                  <PwaStatus />
                  <Routes>
                    <Route path="/" element={<HomePage />} />
                    <Route path="/shop" element={<ShopPage />} />
                    <Route path="/categories" element={<CategoriesPage />} />
                    <Route path="/account" element={<AccountPage />} />
                    <Route path="/forgot-password" element={<PasswordRecoveryPage />} />
                    <Route path="/reset-password" element={<PasswordRecoveryPage reset />} />
                    <Route path="/login" element={<Navigate to="/account" replace />} />
                    <Route path="/signup" element={<Navigate to="/account?mode=signup" replace />} />
                    <Route path="/wishlist" element={<WishlistPage />} />
                    <Route path="/fabrics" element={<FabricsPage />} />
                    <Route path="/product/:slug" element={<ProductDetailPage />} />
                    <Route path="/fabrics/:slug" element={<ProductDetailPage />} />
                    <Route path="/tailoring" element={<TailoringPage />} />
                    <Route path="/checkout" element={<CheckoutPage />} />
                    <Route path="/checkout/confirmation" element={<OrderConfirmationPage />} />
                    {/* Keep unknown routes consistent with the server's 404. */}
                    <Route path="*" element={<NotFoundPage />} />
                  </Routes>
                </main>
                <BagDrawer />
                <BottomNav />
                <Footer />
              </div>
            </Router>
          </CartProvider>
        </WishlistProvider>
      </AuthProvider>
    </ThemeProvider>
    </MotionConfig>
  );
}

export default App;
