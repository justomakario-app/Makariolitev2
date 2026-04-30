// Re-export barrel para imports concisos.
// Los consumidores pueden hacer:
//   import { supabase, usernameToEmail } from '@macario/shared';
//   import type { Database } from '@macario/shared/types/database.types';
//   import { useAuth } from '@macario/shared/hooks/useAuth';

export { supabase, usernameToEmail } from './lib/supabase';
export { queryClient, sha256Hex } from './lib/queryClient';
export { fmt, skuName } from './lib/fmt';

export type { Database, Json } from './types/database.types';
