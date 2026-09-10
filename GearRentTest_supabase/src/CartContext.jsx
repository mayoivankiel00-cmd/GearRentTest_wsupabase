import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { supabase } from './supabaseClient';
import { calculateSecurityDeposit } from './mockData';
import { getRentalHistoryId } from './rentalUtils';
import { useAuth } from './AuthContext';

const CartContext = createContext(null);
const DEFAULT_DAYS = 3;

// Every read joins the owning provider's profile so `providerEmail`/
// `providerName` keep working exactly like they did against mockData.js.
const PRODUCT_SELECT =
  'id, name, price, status, blurb, description, specs, features, images, category_id, provider_id, provider:profiles(email, name)';

function mapProductRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    price: Number(row.price),
    status: row.status,
    blurb: row.blurb,
    description: row.description,
    specs: row.specs || {},
    features: row.features || [],
    images: row.images || [],
    category: row.category_id,
    providerListed: Boolean(row.provider_id),
    providerEmail: row.provider?.email || '',
    providerName: row.provider?.name || '',
  };
}

function toMillis(value) {
  return value ? new Date(value).getTime() : null;
}

function mapRentalRow(row) {
  return {
    id: row.id,
    product: mapProductRow(row.products),
    days: row.days,
    status: row.status,
    statusLabel:
      row.status === 'returned' ? 'Returned' : row.status === 'finished' ? 'Finished renting' : 'Current possession',
    rentedAt: toMillis(row.rented_at),
    paidAt: toMillis(row.paid_at),
    returnAt: toMillis(row.return_at),
    finishedAt: toMillis(row.finished_at),
    rentalAmount: row.rental_amount != null ? Number(row.rental_amount) : null,
    securityDeposit: row.security_deposit != null ? Number(row.security_deposit) : null,
    depositStatus: row.deposit_status,
    depositHeldAt: toMillis(row.deposit_held_at),
    depositRefundedAt: toMillis(row.deposit_refunded_at),
    refundableAmount: row.refundable_amount != null ? Number(row.refundable_amount) : null,
  };
}

export function CartProvider({ children }) {
  const { user, isAuthenticated } = useAuth();
  const [items, setItems] = useState([]);
  const [rentedItems, setRentedItems] = useState([]);
  const [rentalHistory, setRentalHistory] = useState([]);
  const [deletedRentalHistoryIds, setDeletedRentalHistoryIds] = useState([]);

  const refreshCart = useCallback(async () => {
    if (!isAuthenticated || !user) {
      setItems([]);
      return;
    }
    const { data, error } = await supabase
      .from('cart_items')
      .select(`days, products (${PRODUCT_SELECT})`)
      .eq('user_id', user.id);
    if (error) {
      console.error('Failed to load cart', error);
      return;
    }
    setItems((data || []).map((row) => ({ product: mapProductRow(row.products), days: row.days })).filter((i) => i.product));
  }, [isAuthenticated, user]);

  const refreshRentals = useCallback(async () => {
    if (!isAuthenticated || !user) {
      setRentedItems([]);
      setRentalHistory([]);
      setDeletedRentalHistoryIds([]);
      return;
    }
    const { data, error } = await supabase
      .from('rentals')
      .select(
        `id, days, status, rented_at, paid_at, return_at, finished_at, rental_amount, security_deposit,
         deposit_status, deposit_held_at, deposit_refunded_at, refundable_amount, hidden_at,
         products (${PRODUCT_SELECT})`
      )
      .eq('user_id', user.id)
      .order('rented_at', { ascending: false });
    if (error) {
      console.error('Failed to load rentals', error);
      return;
    }
    const rows = (data || []).filter((row) => row.products).map(mapRentalRow);
    setRentedItems(rows.filter((r) => r.status === 'active'));
    setRentalHistory(rows.filter((r) => r.status !== 'active'));
    setDeletedRentalHistoryIds((data || []).filter((row) => row.hidden_at).map((row) => row.id));
  }, [isAuthenticated, user]);

  useEffect(() => {
    refreshCart();
    refreshRentals();
  }, [refreshCart, refreshRentals]);

  const addItem = useCallback(async (product, days = DEFAULT_DAYS) => {
    if (!user) return;
    const existing = items.find((i) => i.product.id === product.id);
    const nextDays = existing ? existing.days + days : days;
    const { error } = await supabase
      .from('cart_items')
      .upsert({ user_id: user.id, product_id: product.id, days: nextDays }, { onConflict: 'user_id,product_id' });
    if (error) {
      console.error('addItem failed', error);
      return;
    }
    await refreshCart();
  }, [items, user, refreshCart]);

  const removeItem = useCallback(async (productId) => {
    if (!user) return;
    await supabase.from('cart_items').delete().eq('user_id', user.id).eq('product_id', productId);
    await refreshCart();
  }, [user, refreshCart]);

  const updateItemDays = useCallback(async (productId, days) => {
    if (!user) return;
    await supabase.from('cart_items').update({ days }).eq('user_id', user.id).eq('product_id', productId);
    await refreshCart();
  }, [user, refreshCart]);

  const clearCart = useCallback(async () => {
    if (!user) return;
    await supabase.from('cart_items').delete().eq('user_id', user.id);
    setItems([]);
  }, [user]);

  // NOTE: pricing (rentalAmount/securityDeposit) is still computed on the
  // client here, matching the original app's behavior. For production this
  // should move into a trusted server-side function/RPC so a modified
  // client can't submit an arbitrary price — see the migration report.
  const completeRental = useCallback(async (rentalItems) => {
    if (!user || !rentalItems.length) return;
    const rentedAt = new Date();
    const rows = rentalItems.map((item) => ({
      user_id: user.id,
      product_id: item.product.id,
      days: item.days,
      status: 'active',
      rented_at: rentedAt.toISOString(),
      paid_at: rentedAt.toISOString(),
      return_at: new Date(rentedAt.getTime() + item.days * 86400000).toISOString(),
      rental_amount: item.product.price * item.days,
      security_deposit: calculateSecurityDeposit(item.product.price),
      deposit_status: 'held',
      deposit_held_at: rentedAt.toISOString(),
      refundable_amount: item.product.price * item.days + calculateSecurityDeposit(item.product.price),
    }));
    const { error } = await supabase.from('rentals').insert(rows);
    if (error) console.error('completeRental failed', error);
    await refreshRentals();
  }, [user, refreshRentals]);

  const returnRental = useCallback(async (rentalIndex) => {
    const rental = rentedItems[rentalIndex] || null;
    if (!rental) return null;

    const rentalDays = Math.max(1, Number(rental.days) || 1);
    const elapsedMilliseconds = rental.rentedAt ? Math.max(0, Date.now() - rental.rentedAt) : 0;
    const usedDays = Math.min(rentalDays, Math.max(1, Math.ceil(elapsedMilliseconds / 86400000)));
    const unusedDays = Math.max(0, rentalDays - usedDays);
    const securityDeposit = Number(rental.securityDeposit) || calculateSecurityDeposit(rental.product.price);
    const returnedAt = new Date();
    const refundableAmount = rental.product.price * unusedDays + securityDeposit;

    const { error } = await supabase
      .from('rentals')
      .update({
        status: 'returned',
        finished_at: returnedAt.toISOString(),
        deposit_status: 'refunded',
        deposit_refunded_at: returnedAt.toISOString(),
        refundable_amount: refundableAmount,
      })
      .eq('id', rental.id);
    if (error) {
      console.error('returnRental failed', error);
      return null;
    }

    await refreshRentals();
    return {
      ...rental,
      refundableAmount,
      refundedSecurityDeposit: securityDeposit,
      depositStatus: 'refunded',
      unusedDays,
    };
  }, [rentedItems, refreshRentals]);

  const finishRental = useCallback(async (rentalIndex) => {
    const rental = rentedItems[rentalIndex] || null;
    if (!rental) return null;

    const securityDeposit = Number(rental.securityDeposit) || calculateSecurityDeposit(rental.product.price);
    const finishedAt = new Date();

    const { error } = await supabase
      .from('rentals')
      .update({
        status: 'finished',
        finished_at: finishedAt.toISOString(),
        deposit_status: 'refunded',
        deposit_refunded_at: finishedAt.toISOString(),
        refundable_amount: securityDeposit,
      })
      .eq('id', rental.id);
    if (error) {
      console.error('finishRental failed', error);
      return null;
    }

    await refreshRentals();
    return { ...rental, refundedSecurityDeposit: securityDeposit };
  }, [rentedItems, refreshRentals]);

  // Soft-delete only — keeps the underlying financial record intact and
  // just hides it from the user's history view, same as the old
  // "deleted rental history ids" list did in localStorage.
  const removeRentalHistory = useCallback(async (rentalId) => {
    setRentalHistory((prev) => prev.filter((rental, index) => getRentalHistoryId(rental, index) !== rentalId));
    setDeletedRentalHistoryIds((prev) => (prev.includes(rentalId) ? prev : [...prev, rentalId]));
    const { error } = await supabase.from('rentals').update({ hidden_at: new Date().toISOString() }).eq('id', rentalId);
    if (error) console.error('removeRentalHistory failed', error);
  }, []);

  const value = useMemo(() => {
    const subtotal = items.reduce((sum, i) => sum + i.product.price * i.days, 0);
    const securityDeposit = items.reduce((sum, item) => sum + calculateSecurityDeposit(item.product.price), 0);
    const serviceFee = items.length ? 500 : 0;
    return {
      items,
      addItem,
      removeItem,
      updateItemDays,
      clearCart,
      rentedItems,
      rentalHistory,
      deletedRentalHistoryIds,
      completeRental,
      returnRental,
      finishRental,
      removeRentalHistory,
      count: items.length,
      subtotal,
      securityDeposit,
      serviceFee,
      total: subtotal + securityDeposit + serviceFee,
    };
  }, [
    items,
    addItem,
    removeItem,
    updateItemDays,
    clearCart,
    rentedItems,
    rentalHistory,
    deletedRentalHistoryIds,
    completeRental,
    returnRental,
    finishRental,
    removeRentalHistory,
  ]);

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart() {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error('useCart must be used within CartProvider');
  return ctx;
}
