import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { supabase } from './supabaseClient';
import { useAuth } from './AuthContext';

const ProviderContext = createContext(null);

const PRODUCT_SELECT =
  'id, name, price, status, blurb, description, specs, features, images, category_id, provider_id, provider:profiles(email, name)';

function mapProductRow(row) {
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
    image: row.images?.[0] || '',
    category: row.category_id,
    providerListed: Boolean(row.provider_id),
    providerEmail: row.provider?.email || '',
    providerName: row.provider?.name || '',
  };
}

export function ProviderProvider({ children }) {
  const { user } = useAuth();
  const [providerProducts, setProviderProducts] = useState([]);
  // The full public catalog — mockData's static products plus every
  // provider's listings all now live in the same `products` table, so
  // there's no more "merge static + provider arrays" step.
  const [catalogProducts, setCatalogProducts] = useState([]);

  const refreshProviderProducts = useCallback(async () => {
    if (!user) {
      setProviderProducts([]);
      return;
    }
    const { data, error } = await supabase.from('products').select(PRODUCT_SELECT).eq('provider_id', user.id);
    if (error) {
      console.error('Failed to load provider products', error);
      return;
    }
    setProviderProducts((data || []).map(mapProductRow));
  }, [user]);

  const refreshCatalog = useCallback(async () => {
    const { data, error } = await supabase.from('products').select(PRODUCT_SELECT);
    if (error) {
      console.error('Failed to load catalog', error);
      return;
    }
    setCatalogProducts((data || []).map(mapProductRow));
  }, []);

  useEffect(() => {
    refreshProviderProducts();
    refreshCatalog();
  }, [refreshProviderProducts, refreshCatalog]);

  const addProviderProduct = useCallback(async (productDetails) => {
    if (!user) return null;
    const row = {
      provider_id: user.id,
      category_id: productDetails.category,
      name: productDetails.name,
      price: Number(productDetails.price) || 0,
      status: 'available',
      blurb: 'Provider listed gear',
      description: productDetails.description || 'Provider listed gear available for your next project.',
      images: productDetails.images?.length ? productDetails.images : [productDetails.image].filter(Boolean),
      specs: {
        Capacity: productDetails.capacity || 'Not specified',
        Weight: productDetails.weight || 'Not specified',
        Sensor: productDetails.sensor || 'Not specified',
        Condition: productDetails.condition || 'Good',
      },
      features: ['Provider listed', 'Available for rental'],
    };
    const { data, error } = await supabase.from('products').insert(row).select(PRODUCT_SELECT).single();
    if (error) {
      console.error('addProviderProduct failed', error);
      return null;
    }
    await Promise.all([refreshProviderProducts(), refreshCatalog()]);
    return mapProductRow(data);
  }, [user, refreshProviderProducts, refreshCatalog]);

  const removeProviderProduct = useCallback(async (productId) => {
    if (!user) return;
    const { error } = await supabase.from('products').delete().eq('id', productId).eq('provider_id', user.id);
    if (error) {
      console.error('removeProviderProduct failed', error);
      return;
    }
    await Promise.all([refreshProviderProducts(), refreshCatalog()]);
  }, [user, refreshProviderProducts, refreshCatalog]);

  const value = useMemo(() => ({
    providerProducts,
    catalogProducts,
    addProviderProduct,
    removeProviderProduct,
  }), [providerProducts, catalogProducts, addProviderProduct, removeProviderProduct]);

  return <ProviderContext.Provider value={value}>{children}</ProviderContext.Provider>;
}

export function useProviderCatalog() {
  const context = useContext(ProviderContext);
  if (!context) throw new Error('useProviderCatalog must be used within ProviderProvider');
  return context;
}
