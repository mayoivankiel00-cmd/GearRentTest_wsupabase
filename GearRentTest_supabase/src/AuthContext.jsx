import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { supabase } from './supabaseClient';

const AuthContext = createContext(null);
const PENDING_SIGNUP_KEY = 'gearRentPendingSignup';

function normalizeEmail(email) {
  return typeof email === 'string' ? email.trim().toLowerCase() : '';
}

function readPendingSignup() {
  try {
    return JSON.parse(window.sessionStorage.getItem(PENDING_SIGNUP_KEY) || 'null');
  } catch {
    return null;
  }
}

function mapProfileToUser(authUser, profile) {
  if (!authUser) return null;
  return {
    id: authUser.id,
    email: authUser.email,
    name: profile?.name || '',
    tier: profile?.tier || 'Gear Renter',
    role: profile?.role || 'customer',
    balance: Number(profile?.balance) || 0,
    phone: profile?.phone || '',
    address: profile?.address || '',
    city: profile?.city || '',
    province: profile?.province || '',
    postalCode: profile?.postal_code || '',
    createdAt: profile?.created_at ? new Date(profile.created_at).getTime() : Date.now(),
  };
}

async function fetchProfile(userId) {
  const { data, error } = await supabase.from('profiles').select('*').eq('id', userId).maybeSingle();
  if (error) {
    console.error('Failed to load profile', error);
    return null;
  }
  return data;
}

export function AuthProvider({ children }) {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [pendingSignup, setPendingSignupState] = useState(readPendingSignup);

  const loadSession = useCallback(async (session) => {
    if (!session?.user) {
      setUser(null);
      setIsAuthenticated(false);
      return;
    }
    const profile = await fetchProfile(session.user.id);
    setUser(mapProfileToUser(session.user, profile));
    setIsAuthenticated(true);
  }, []);

  useEffect(() => {
    let isMounted = true;

    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!isMounted) return;
      loadSession(session).finally(() => setLoading(false));
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      loadSession(session);
    });

    return () => {
      isMounted = false;
      subscription.unsubscribe();
    };
  }, [loadSession]);

  // Checks whether an account already exists for this email. Mainly useful
  // for inline validation — sign-up itself still relies on Supabase's own
  // "already registered" error as the source of truth.
  const accountExists = useCallback(async (email) => {
    const { data } = await supabase
      .from('profiles')
      .select('id')
      .eq('email', normalizeEmail(email))
      .maybeSingle();
    return Boolean(data);
  }, []);

  // Returns { success, error, needsEmailConfirmation }. Callers should check
  // `success` rather than a bare boolean, since Supabase can fail for many
  // reasons (weak password, already registered, etc.) that are worth
  // surfacing to the user.
  const createAccount = useCallback(async (userData) => {
    const email = normalizeEmail(userData.email);
    const { data, error } = await supabase.auth.signUp({
      email,
      password: userData.password,
      options: { data: { name: userData.name } },
    });

    if (error) {
      return { success: false, error: error.message };
    }

    // The `on_auth_user_created` trigger creates the profile row; once it
    // exists we can also save the chosen membership tier.
    if (userData.tier && data.user) {
      await supabase.from('profiles').update({ tier: userData.tier }).eq('id', data.user.id);
    }

    if (data.session) {
      await loadSession(data.session);
    }

    return { success: true, needsEmailConfirmation: !data.session };
  }, [loadSession]);

  // Returns the signed-in user on success, or null on failure (mirrors the
  // original localStorage-backed behavior so SignIn.jsx barely has to change).
  const authenticate = useCallback(async (email, password) => {
    const { data, error } = await supabase.auth.signInWithPassword({
      email: normalizeEmail(email),
      password,
    });
    if (error || !data.user) return null;

    await loadSession(data.session);
    const profile = await fetchProfile(data.user.id);
    return mapProfileToUser(data.user, profile);
  }, [loadSession]);

  // Credits ANOTHER user's balance by email (e.g. paying out a gear
  // provider). This can't be a direct table write under RLS — only the
  // owner can update their own profile — so it goes through a
  // `security definer` Postgres function instead.
  const creditAccount = useCallback(async (email, amount) => {
    const creditAmount = Number(amount);
    const normalizedEmail = normalizeEmail(email);
    if (!normalizedEmail || !Number.isFinite(creditAmount) || creditAmount <= 0) return false;

    const { error } = await supabase.rpc('credit_user_balance', {
      target_email: normalizedEmail,
      amount: creditAmount,
    });
    if (error) {
      console.error('creditAccount failed', error);
      return false;
    }
    return true;
  }, []);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
    setUser(null);
    setIsAuthenticated(false);
  }, []);

  // Merges and persists partial updates to the signed-in user's own profile.
  // Applies the change to local state immediately (optimistic update) and
  // writes it to Supabase in the background.
  const updateUser = useCallback(async (updates) => {
    setUser((prev) => (prev ? { ...prev, ...updates } : prev));

    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.user) return;

    const patch = {};
    if ('name' in updates) patch.name = updates.name;
    if ('tier' in updates) patch.tier = updates.tier;
    if ('balance' in updates) patch.balance = updates.balance;
    if ('phone' in updates) patch.phone = updates.phone;
    if ('address' in updates) patch.address = updates.address;
    if ('city' in updates) patch.city = updates.city;
    if ('province' in updates) patch.province = updates.province;
    if ('postalCode' in updates) patch.postal_code = updates.postalCode;
    if (Object.keys(patch).length === 0) return;

    const { error } = await supabase.from('profiles').update(patch).eq('id', session.user.id);
    if (error) console.error('updateUser failed', error);
  }, []);

  // Stashes signup details while the user picks a membership tier, mirroring
  // the old sessionStorage handoff between SignUp and Memberships.
  const setPendingSignup = useCallback((data) => {
    window.sessionStorage.setItem(PENDING_SIGNUP_KEY, JSON.stringify(data));
    setPendingSignupState(data);
  }, []);

  const clearPendingSignup = useCallback(() => {
    window.sessionStorage.removeItem(PENDING_SIGNUP_KEY);
    setPendingSignupState(null);
  }, []);

  const value = {
    isAuthenticated,
    user,
    loading,
    pendingSignup,
    accountExists,
    createAccount,
    authenticate,
    creditAccount,
    signOut,
    updateUser,
    setPendingSignup,
    clearPendingSignup,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
