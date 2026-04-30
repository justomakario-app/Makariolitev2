import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import type { Database } from '../types/database.types';

type SkuCatalog = Database['public']['Tables']['sku_catalog']['Row'];
type SkuCategory = Database['public']['Tables']['sku_categories']['Row'];
type SkuInsert = Database['public']['Tables']['sku_catalog']['Insert'];
type SkuUpdate = Database['public']['Tables']['sku_catalog']['Update'];

export function useSkuCatalog(opts: { activeOnly?: boolean } = {}) {
  return useQuery({
    queryKey: ['sku-catalog', opts.activeOnly ?? true],
    queryFn: async (): Promise<SkuCatalog[]> => {
      let q = supabase.from('sku_catalog').select('*').order('sku');
      if (opts.activeOnly !== false) q = q.eq('activo', true);
      const { data, error } = await q;
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useSkuCategories() {
  return useQuery({
    queryKey: ['sku-categories'],
    queryFn: async (): Promise<SkuCategory[]> => {
      const { data, error } = await supabase
        .from('sku_categories')
        .select('*')
        .order('sort_order');
      if (error) throw error;
      return data ?? [];
    },
    staleTime: 5 * 60_000,
  });
}

export function useUpsertSku() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: { sku: string; data: SkuInsert | SkuUpdate; isNew: boolean }) => {
      if (vars.isNew) {
        const { error } = await supabase.from('sku_catalog').insert(vars.data as SkuInsert);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from('sku_catalog')
          .update(vars.data)
          .eq('sku', vars.sku);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sku-catalog'] });
      qc.invalidateQueries({ queryKey: ['carrier-table'] });
      qc.invalidateQueries({ queryKey: ['all-carriers'] });
    },
  });
}

export function useUpsertCategory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (name: string) => {
      const { error } = await supabase
        .from('sku_categories')
        .insert({ name: name.trim() });
      if (error && error.code !== '23505') throw error; // 23505 = unique violation OK
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sku-categories'] });
    },
  });
}

export function useToggleSkuActive() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: { sku: string; activo: boolean }) => {
      const { error } = await supabase
        .from('sku_catalog')
        .update({ activo: vars.activo })
        .eq('sku', vars.sku);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sku-catalog'] });
      qc.invalidateQueries({ queryKey: ['carrier-table'] });
    },
  });
}
