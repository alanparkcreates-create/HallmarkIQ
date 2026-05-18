import { supabase } from './supabase.js';

async function getToken() {
  const { data: { session } } = await supabase.auth.getSession();
  return session?.access_token ?? null;
}

async function apiFetch(path, options = {}) {
  const token = await getToken();
  const res = await fetch(path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });
  return res;
}

export async function getMe() {
  const res = await apiFetch('/auth/me');
  if (res.status === 401) return null;
  const data = await res.json();
  if (!res.ok) throw new Error(data.error);
  return data;
}

export async function startCheckout() {
  const res = await apiFetch('/billing/checkout', { method: 'POST' });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error);
  return data.url;
}

export async function openBillingPortal() {
  const res = await apiFetch('/billing/portal', { method: 'POST' });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error);
  return data.url;
}

export async function identifyJewelry(base64, mimeType) {
  const res = await apiFetch('/analyze', {
    method: 'POST',
    body: JSON.stringify({ base64, mimeType }),
  });

  if (res.status === 402) {
    const err = Object.assign(new Error('Free scan limit reached'), { paymentRequired: true });
    throw err;
  }
  if (res.status === 401) {
    const err = Object.assign(new Error('Session expired'), { sessionExpired: true });
    throw err;
  }

  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Identification failed');
  return data;
}
