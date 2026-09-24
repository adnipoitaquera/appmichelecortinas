import { createClient } from '@supabase/supabase-js';
import { createUser } from '../../../lib/create-user.mjs';

export async function POST(request) {
  return createUser(request, { createClient, env: process.env });
}
