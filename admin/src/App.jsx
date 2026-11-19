import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { ThemeProvider } from './contexts/ThemeContext';
import { AuthProvider } from './contexts/AuthContext';
import ProtectedRoute from './components/ProtectedRoute';
import AdminLayout from './layouts/AdminLayout';
import LoginPage from './pages/LoginPage';
import DashboardPage from './pages/DashboardPage';
import QuickPostPage from './pages/QuickPostPage';
import InventoryPage from './pages/InventoryPage';
import OrdersPage from './pages/OrdersPage';
import PosPage from './pages/PosPage';
import MorePage from './pages/MorePage';
import CustomersPage, { CustomerDetailPage } from './pages/CustomersPage';
import PasswordRecoveryPage from './pages/PasswordRecoveryPage';
import EmailDeliveryPage from './pages/EmailDeliveryPage';
import ReportsPage from './pages/ReportsPage';

export default function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <BrowserRouter
          basename={import.meta.env.BASE_URL.replace(/\/$/, '') || '/'}
        >
          <Routes>
            {/* Public Auth Route */}
            <Route path="/login" element={<LoginPage />} />
            <Route path="/forgot-password" element={<PasswordRecoveryPage />} />
            <Route
              path="/reset-password"
              element={<PasswordRecoveryPage reset />}
            />

            {/* Authenticated Admin Management Routes */}
            <Route
              path="/"
              element={
                <ProtectedRoute>
                  <AdminLayout />
                </ProtectedRoute>
              }
            >
              <Route index element={<DashboardPage />} />
              <Route path="quick-post" element={<QuickPostPage />} />
              <Route path="products" element={<InventoryPage />} />
              <Route path="orders" element={<OrdersPage />} />
              <Route path="pos" element={<PosPage />} />
              <Route path="more" element={<MorePage />} />
              <Route path="customers" element={<CustomersPage />} />
              <Route path="customers/:id" element={<CustomerDetailPage />} />
              <Route path="email" element={<EmailDeliveryPage />} />
              <Route path="reports" element={<ReportsPage />} />
            </Route>

            {/* Fallback */}
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </ThemeProvider>
  );
}
