import { createClient } from '@supabase/supabase-js';

let _client;
function db() {
  if (!_client) {
    _client = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_KEY,
    );
  }
  return _client;
}

export async function upsertUser(id, email) {
  const { data, error } = await db()
    .from('users')
    .upsert({ id, email }, { onConflict: 'id' })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function getUser(userId) {
  const { data, error } = await db()
    .from('users')
    .select('*')
    .eq('id', userId)
    .single();
  if (error) throw error;
  return data;
}

export async function updateUser(userId, fields) {
  const { error } = await db()
    .from('users')
    .update(fields)
    .eq('id', userId);
  if (error) throw error;
}

export async function updateUserByEmail(email, fields) {
  const { error } = await db()
    .from('users')
    .update(fields)
    .eq('email', email);
  if (error) throw error;
}
