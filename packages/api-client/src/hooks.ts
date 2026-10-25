import { keepPreviousData, useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import type {
  CheckinBody, CheckoutBody, CreateCopiesBody, CreateSaleBody, ListCopiesQuery, ListSalesQuery, ListTitlesQuery,
  SalesSummaryQuery, UpdateCopyBody, UpdateSettingsBody, UpdateTitleBody, VoidSaleBody, CreateUserBody, UpdateUserBody,
} from '@bookstall/shared';
import { qk } from './keys.js';
import { useApi } from './provider.js';

/** Queries (read). Lists keep the previous page on screen while the next one loads. */
export function useMe(enabled = true) {
  const api = useApi();
  return useQuery({ queryKey: qk.me(), queryFn: api.auth.me, enabled, staleTime: 60_000 });
}
export function useDashboard() {
  const api = useApi();
  return useQuery({ queryKey: qk.dashboard(), queryFn: api.dashboard.get });
}
export function useGenres(includeInactive = false) {
  const api = useApi();
  return useQuery({ queryKey: [...qk.genres(), includeInactive], queryFn: () => api.genres.list(includeInactive), staleTime: 5 * 60_000 });
}
export function useTitles(params: Partial<ListTitlesQuery>) {
  const api = useApi();
  return useQuery({ queryKey: qk.titles.list(params), queryFn: () => api.titles.list(params), placeholderData: keepPreviousData });
}
export function useTitle(id: string | undefined) {
  const api = useApi();
  return useQuery({ queryKey: qk.titles.one(id ?? ''), queryFn: () => api.titles.get(id!), enabled: Boolean(id) });
}
export function useCopies(params: Partial<ListCopiesQuery>) {
  const api = useApi();
  return useQuery({ queryKey: qk.copies.list(params), queryFn: () => api.copies.list(params), placeholderData: keepPreviousData });
}
export function useCopyByCode(code: string | undefined) {
  const api = useApi();
  return useQuery({ queryKey: qk.copies.byCode(code ?? ''), queryFn: () => api.copies.byCode(code!), enabled: Boolean(code), retry: false });
}
export function useStalls(status?: string) {
  const api = useApi();
  return useQuery({ queryKey: qk.stalls.list(status), queryFn: () => api.stalls.list(status) });
}
export function useStall(id: string | undefined) {
  const api = useApi();
  return useQuery({ queryKey: qk.stalls.one(id ?? ''), queryFn: () => api.stalls.get(id!), enabled: Boolean(id) });
}
export function useSales(params: Partial<ListSalesQuery>) {
  const api = useApi();
  return useQuery({ queryKey: qk.sales.list(params), queryFn: () => api.sales.list(params), placeholderData: keepPreviousData });
}
export function useSalesSummary(params: Partial<SalesSummaryQuery>) {
  const api = useApi();
  return useQuery({ queryKey: qk.sales.summary(params), queryFn: () => api.sales.summary(params) });
}
export function useShelfMap() {
  const api = useApi();
  return useQuery({ queryKey: qk.shelves.map(), queryFn: api.shelves.map });
}

/** Mutations. Each invalidates what it can affect; the realtime socket does the same for other devices. */
const invalidateInventory = (qc: QueryClient) =>
  Promise.all([qc.invalidateQueries({ queryKey: qk.titles.all() }), qc.invalidateQueries({ queryKey: qk.copies.all() }), qc.invalidateQueries({ queryKey: qk.dashboard() })]);

export function useCreateCopies() {
  const api = useApi();
  const qc = useQueryClient();
  return useMutation({ mutationFn: (b: CreateCopiesBody) => api.copies.create(b), onSuccess: () => invalidateInventory(qc) });
}
export function useUpdateCopy(id: string) {
  const api = useApi();
  const qc = useQueryClient();
  return useMutation({ mutationFn: (b: UpdateCopyBody) => api.copies.update(id, b), onSuccess: () => invalidateInventory(qc) });
}
export function useUpdateTitle(id: string) {
  const api = useApi();
  const qc = useQueryClient();
  return useMutation({ mutationFn: (b: UpdateTitleBody) => api.titles.update(id, b), onSuccess: () => invalidateInventory(qc) });
}
export function useCreateSale() {
  const api = useApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (b: CreateSaleBody) => api.sales.create(b),
    onSuccess: () => Promise.all([invalidateInventory(qc), qc.invalidateQueries({ queryKey: qk.sales.all() }), qc.invalidateQueries({ queryKey: qk.stalls.all() })]),
  });
}
export function useVoidSale(id: string) {
  const api = useApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (b: VoidSaleBody) => api.sales.void(id, b),
    onSuccess: () => Promise.all([invalidateInventory(qc), qc.invalidateQueries({ queryKey: qk.sales.all() })]),
  });
}
export function useCheckout(stallId: string) {
  const api = useApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (b: CheckoutBody) => api.stalls.checkout(stallId, b),
    onSuccess: () => Promise.all([invalidateInventory(qc), qc.invalidateQueries({ queryKey: qk.stalls.all() })]),
  });
}
export function useCheckin() {
  const api = useApi();
  const qc = useQueryClient();
  return useMutation({ mutationFn: (b: CheckinBody) => api.stalls.checkin(b), onSuccess: () => Promise.all([invalidateInventory(qc), qc.invalidateQueries({ queryKey: qk.stalls.all() })]) });
}
export function useCreateUser() {
  const api = useApi();
  const qc = useQueryClient();
  return useMutation({ mutationFn: (b: CreateUserBody) => api.users.create(b), onSuccess: () => qc.invalidateQueries({ queryKey: qk.users.all() }) });
}
export function useUpdateUser(id: string) {
  const api = useApi();
  const qc = useQueryClient();
  return useMutation({ mutationFn: (b: UpdateUserBody) => api.users.update(id, b), onSuccess: () => qc.invalidateQueries({ queryKey: qk.users.all() }) });
}
export function useUpdateSettings() {
  const api = useApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (b: UpdateSettingsBody) => api.settings.update(b),
    onSuccess: () => Promise.all([qc.invalidateQueries({ queryKey: qk.settings() }), qc.invalidateQueries({ queryKey: qk.me() })]),
  });
}
