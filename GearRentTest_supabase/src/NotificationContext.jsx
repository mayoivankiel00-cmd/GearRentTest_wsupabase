import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { supabase } from './supabaseClient';
import { useAuth } from './AuthContext';

const NotificationContext = createContext(null);
// Kept only as an export for backward compatibility with any code that
// imported it — the admin channel is now a real `is_admin_channel` column
// instead of a sentinel recipient string.
export const ADMIN_NOTIFICATION_RECIPIENT = '__admin__';

const POLL_INTERVAL_MS = 20000;

function mapNotificationRow(row) {
  return {
    id: row.id,
    message: row.message,
    type: row.type,
    recipientEmail: row.recipient_user_id ? null : null, // no longer tracked by email — see recipientUserId
    recipientUserId: row.recipient_user_id,
    isAdminChannel: row.is_admin_channel,
    createdAt: row.created_at ? new Date(row.created_at).getTime() : Date.now(),
    read: row.read,
  };
}

export function NotificationProvider({ children }) {
  const { user, isAuthenticated } = useAuth();
  const [notifications, setNotifications] = useState([]);
  const [adminNotifications, setAdminNotifications] = useState([]);

  const refreshNotifications = useCallback(async () => {
    if (!isAuthenticated || !user) {
      setNotifications([]);
      return;
    }
    const { data, error } = await supabase
      .from('notifications')
      .select('*')
      .eq('is_admin_channel', false)
      .or(`recipient_user_id.eq.${user.id},recipient_user_id.is.null`)
      .order('created_at', { ascending: false })
      .limit(30);
    if (error) {
      console.error('Failed to load notifications', error);
      return;
    }
    setNotifications((data || []).map(mapNotificationRow));
  }, [isAuthenticated, user]);

  const refreshAdminNotifications = useCallback(async () => {
    if (!isAuthenticated || user?.role !== 'admin') {
      setAdminNotifications([]);
      return;
    }
    const { data, error } = await supabase
      .from('notifications')
      .select('*')
      .eq('is_admin_channel', true)
      .order('created_at', { ascending: false })
      .limit(30);
    if (error) {
      console.error('Failed to load admin notifications', error);
      return;
    }
    setAdminNotifications((data || []).map(mapNotificationRow));
  }, [isAuthenticated, user]);

  useEffect(() => {
    refreshNotifications();
    refreshAdminNotifications();
    const interval = window.setInterval(() => {
      refreshNotifications();
      refreshAdminNotifications();
    }, POLL_INTERVAL_MS);
    return () => window.clearInterval(interval);
  }, [refreshNotifications, refreshAdminNotifications]);

  // recipientEmail lets a user's action (e.g. renting gear) notify a
  // DIFFERENT user (the provider). If omitted, the notification targets
  // whoever is currently signed in.
  const addNotification = useCallback(async (message, type = 'info', recipientEmail = null) => {
    let recipientUserId = user?.id || null;
    if (recipientEmail) {
      const { data } = await supabase
        .from('profiles')
        .select('id')
        .eq('email', recipientEmail.trim().toLowerCase())
        .maybeSingle();
      recipientUserId = data?.id || null;
      if (!recipientUserId) return; // unknown recipient — nothing to notify
    }

    const { error } = await supabase.from('notifications').insert({
      message,
      type,
      recipient_user_id: recipientUserId,
      is_admin_channel: false,
    });
    if (error) {
      console.error('addNotification failed', error);
      return;
    }
    if (!recipientEmail || recipientUserId === user?.id) {
      await refreshNotifications();
    }
  }, [user, refreshNotifications]);

  const addAdminNotification = useCallback(async (message, type = 'info') => {
    const { error } = await supabase.from('notifications').insert({
      message,
      type,
      is_admin_channel: true,
    });
    if (error) console.error('addAdminNotification failed', error);
    await refreshAdminNotifications();
  }, [refreshAdminNotifications]);

  const markAllRead = useCallback(async () => {
    if (!user) return;
    setNotifications((current) => current.map((n) => ({ ...n, read: true })));
    const { error } = await supabase
      .from('notifications')
      .update({ read: true })
      .eq('is_admin_channel', false)
      .eq('recipient_user_id', user.id);
    if (error) console.error('markAllRead failed', error);
  }, [user]);

  const clearAllNotifications = useCallback(async () => {
    if (!user) return;
    setNotifications([]);
    const { error } = await supabase
      .from('notifications')
      .delete()
      .eq('is_admin_channel', false)
      .eq('recipient_user_id', user.id);
    if (error) console.error('clearAllNotifications failed', error);
  }, [user]);

  const markAdminNotificationsRead = useCallback(async () => {
    setAdminNotifications((current) => current.map((n) => ({ ...n, read: true })));
    const { error } = await supabase.from('notifications').update({ read: true }).eq('is_admin_channel', true);
    if (error) console.error('markAdminNotificationsRead failed', error);
  }, []);

  const clearAdminNotifications = useCallback(async () => {
    setAdminNotifications([]);
    const { error } = await supabase.from('notifications').delete().eq('is_admin_channel', true);
    if (error) console.error('clearAdminNotifications failed', error);
  }, []);

  const value = useMemo(() => ({
    notifications,
    unreadCount: notifications.filter((n) => !n.read).length,
    addNotification,
    addAdminNotification,
    markAllRead,
    clearAllNotifications,
    adminNotifications,
    adminUnreadCount: adminNotifications.filter((n) => !n.read).length,
    markAdminNotificationsRead,
    clearAdminNotifications,
  }), [
    notifications,
    addNotification,
    addAdminNotification,
    markAllRead,
    clearAllNotifications,
    adminNotifications,
    markAdminNotificationsRead,
    clearAdminNotifications,
  ]);

  return <NotificationContext.Provider value={value}>{children}</NotificationContext.Provider>;
}

export function useNotifications() {
  const context = useContext(NotificationContext);
  if (!context) throw new Error('useNotifications must be used within NotificationProvider');
  return context;
}
