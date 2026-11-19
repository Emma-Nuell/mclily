import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { UserRound, ArrowRight, Heart, Package, LogOut, Loader2 } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { IS_PREVIEW_CATALOG } from '../api/catalog';
import api from '../api/client';
import InstallApp from '../components/InstallApp';

export default function AccountPage() {
  const { user, loading, login, register, logout } = useAuth();
  const [params, setParams] = useSearchParams();
  const signup = params.get('mode') === 'signup';
  const [form, setForm] = useState({ fullName: '', email: '', phone: '', credential: '', password: '' });
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [orders, setOrders] = useState([]);
  const [ordersLoading, setOrdersLoading] = useState(false);
  const [ordersError, setOrdersError] = useState('');
  useEffect(() => {
    if (!user) return;
    let active = true;
    setOrdersLoading(true);
    api.get('/orders/my-orders').then(res => { if (active) setOrders(res.data?.data || []); })
      .catch(() => { if (active) setOrdersError('Your orders are unavailable right now. Please try again later.'); })
      .finally(() => { if (active) setOrdersLoading(false); });
    return () => { active = false; };
  }, [user]);
  const update = event => setForm(old => ({ ...old, [event.target.name]: event.target.value }));
  const submit = async event => {
    event.preventDefault();
    setError('');
    if (signup && !form.email.trim()) { setError('Please enter an email address for account recovery.'); return; }
    setPending(true);
    try {
      if (signup) await register({ fullName: form.fullName.trim(), email: form.email.trim(), phone: form.phone.trim() || undefined, password: form.password });
      else await login(form.credential.trim(), form.password);
      setForm(old => ({ ...old, password: '' }));
    } catch (err) {
      setError(err.message === 'Network Error' ? 'We can’t reach the account service right now. Please try again when the backend is connected.' : err.message);
    } finally { setPending(false); }
  };
  const signOut = async () => {
    setPending(true); setError('');
    try { await logout(); } catch { setError('We couldn’t sign you out. Please try again.'); }
    finally { setPending(false); }
  };
  if (loading) return <div className="account-loading"><Loader2 className="animate-spin" aria-label="Loading account" /></div>;
  if (user) return <div className="account-page account-signed-in">
    <div className="account-intro"><span className="account-avatar">{user.fullName?.split(' ').map(part => part[0]).slice(0,2).join('') || <UserRound />}</span><p className="section-eyebrow">Your McLily</p><h1>Hello, {user.fullName?.split(' ')[0] || 'there'}.</h1><p>A little space for everything you love.</p></div>
    <div className="account-details"><h2>Account details</h2><dl><div><dt>Name</dt><dd>{user.fullName}</dd></div><div><dt>Email</dt><dd>{user.email || 'Not provided'}</dd></div><div><dt>Phone</dt><dd>{user.phone || 'Not provided'}</dd></div></dl></div>
    <Link className="account-row" to="/wishlist"><Heart size={19} strokeWidth={1.5} /><span>Your wishlist</span><ArrowRight size={16} /></Link>
    <section className="account-orders"><h2><Package size={19} strokeWidth={1.5} /> Your orders</h2>{ordersLoading ? <p>Loading orders…</p> : ordersError ? <p role="status">{ordersError}</p> : orders.length ? orders.map(order => <Link className="account-row" key={order._id} to={`/checkout/confirmation?order=${encodeURIComponent(order.orderNumber)}`}><span>{order.orderNumber}</span><small>{order.fulfillment?.status}</small><ArrowRight size={15} /></Link>) : <p>Your first find is waiting. <Link to="/shop">Explore the shop →</Link></p>}</section>
    {error && <p className="account-error" role="alert">{error}</p>}
    <InstallApp />
    <button className="account-signout" disabled={pending} onClick={signOut}><LogOut size={16} /> {pending ? 'Signing out…' : 'Sign out'}</button>
  </div>;
  return <div className="account-page">
    <div className="account-intro"><UserRound size={30} strokeWidth={1.2} /><p className="section-eyebrow">Your McLily</p><h1>{signup ? 'Make yourself at home.' : 'Good to see you.'}</h1><p>{signup ? 'Create an account for your next favourite find.' : 'Sign in to keep your favourites and orders close.'}</p></div>
    <div className="account-tabs" aria-label="Account access"><button aria-pressed={!signup} onClick={() => { setParams({}); setError(''); }}>Sign in</button><button aria-pressed={signup} onClick={() => { setParams({ mode:'signup' }); setError(''); }}>Create account</button></div>
    <form onSubmit={submit} className="account-form">
      {signup ? <><label htmlFor="account-name">Full name<input id="account-name" name="fullName" autoComplete="name" required value={form.fullName} onChange={update} /></label><label htmlFor="account-email">Email address<input id="account-email" name="email" type="email" autoComplete="email" required value={form.email} onChange={update} /></label><label htmlFor="account-phone">Phone<input id="account-phone" name="phone" type="tel" autoComplete="tel" value={form.phone} onChange={update} /></label></> : <label htmlFor="account-credential">Email or phone number<input id="account-credential" name="credential" autoComplete="username" required value={form.credential} onChange={update} /></label>}
      {signup && <p className="text-xs text-text-secondary">Email is used for account recovery. You can also sign in with your phone number.</p>}
      <label htmlFor="account-password">Password<input id="account-password" name="password" type="password" minLength={signup ? 8 : undefined} autoComplete={signup ? 'new-password' : 'current-password'} required value={form.password} onChange={update} /></label>
      {error && <p role="alert" className="account-error">{error}</p>}
      <button className="account-submit pressable" disabled={pending} type="submit">{pending ? <Loader2 size={17} className="animate-spin" /> : <>{signup ? 'Create account' : 'Sign in'}<ArrowRight size={17} /></>}</button>
    </form>
    {IS_PREVIEW_CATALOG && <p className="account-preview-note">You’re browsing a sample catalog. Sign-in and registration use the real account service and will be available when the backend is connected.</p>}
    {!signup && <Link to="/forgot-password" className="account-guest-link">Forgot your password?</Link>}<Link to="/wishlist" className="account-guest-link"><Heart size={15} /> View your saved items <ArrowRight size={13} /></Link>
    <InstallApp />
    <Link to="/shop" className="account-guest-link">Continue shopping as a guest <ArrowRight size={13} /></Link>
  </div>;
}
