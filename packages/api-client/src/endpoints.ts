import type {
  AssignManagerBody, CatalogLookupResult, CatalogSearchHit, ChangePasswordBody, CheckinBody, CheckinResponse, CheckoutBody,
  CheckoutResponse, CloseStallBody, CommitImportBody, CopyDetail, CopyDto, CopyListItem, CreateCopiesBody, CreateCopiesResponse,
  CreateGenreBody, CreateRackBody, CreateRowBody, CreateSaleBody, CreateStallBody, CreateStallResponse, CreateUserBody,
  CreateUserResponse, DashboardResponse, GenreDto, ImportJobDto, ImportRowDto, InventoryPage, LabelQueueItem, ListCopiesQuery,
  ListImportRowsQuery, ListSalesQuery, ListTitlesQuery, ListUsersQuery, LoginBody, LoginResponse, MeResponse, MoveCopyBody,
  MoveListItem, MovementDto, MovementsQuery, Page, PatchImportRowBody, PriceSuggestion, PublicCopyPage, RackDto, Reconciliation,
  ResetPasswordResponse, RowSlot, SaleDto, SaleListItem, SalesSummary, SalesSummaryQuery, ScanResolveResult, ShelfMapRack,
  ShelfRowDto, StallDto, TitleDetail, TitleDto, UpdateCopyBody, UpdateGenreBody, UpdateRackBody, UpdateRowBody, UpdateSettingsBody,
  UpdateStallBody, UpdateTitleBody, UpdateUserBody, UserDto, VoidSaleBody, VoidSaleResponse, WriteOffBody, ClientSettings,
  BulkRowsBody, ListAuditQuery, LabelTemplate,
} from '@bookstall/shared';
import type { ApiClient, Query } from './client.js';

const q = <T extends object>(o?: T) => o as Query | undefined;

/** One typed function per backend endpoint. Mutations that must be idempotent take a `clientRef` in the body. */
export function createApi(c: ApiClient) {
  const get = <T>(path: string, query?: object) => c.request<T>('GET', path, { query: q(query) });
  const post = <T>(path: string, body?: unknown) => c.request<T>('POST', path, { body: body ?? {} });
  const patch = <T>(path: string, body: unknown) => c.request<T>('PATCH', path, { body });

  return {
    client: c,

    auth: {
      login: (body: LoginBody) => c.request<LoginResponse>('POST', '/auth/login', { body, anonymous: true }),
      logout: (refreshToken?: string) => c.request<void>('POST', '/auth/logout', { body: refreshToken ? { refreshToken } : {}, anonymous: true }),
      me: () => get<MeResponse>('/auth/me'),
      changePassword: (body: ChangePasswordBody) => post<LoginResponse>('/auth/change-password', body),
    },

    users: {
      list: (p?: Partial<ListUsersQuery>) => get<Page<UserDto>>('/users', p),
      get: (id: string) => get<UserDto>(`/users/${id}`),
      create: (body: CreateUserBody) => post<CreateUserResponse>('/users', body),
      update: (id: string, body: UpdateUserBody) => patch<UserDto>(`/users/${id}`, body),
      resetPassword: (id: string) => post<ResetPasswordResponse>(`/users/${id}/reset-password`),
      slipUrl: (id: string, token: string) => c.url(`/users/${id}/credential-slip.pdf`, { token }),
      slip: (id: string, token: string) => c.blob('GET', `/users/${id}/credential-slip.pdf`, { query: { token } }),
    },

    genres: {
      list: (includeInactive = false) => get<GenreDto[]>('/genres', { includeInactive }),
      get: (id: string) => get<GenreDto>(`/genres/${id}`),
      create: (body: CreateGenreBody) => post<GenreDto>('/genres', body),
      update: (id: string, body: UpdateGenreBody) => patch<GenreDto>(`/genres/${id}`, body),
      putKeywords: (id: string, keywords: Array<{ keyword: string; weight?: number }>) =>
        c.request<GenreDto>('PUT', `/genres/${id}/keywords`, { body: { keywords } }),
    },

    shelves: {
      racks: () => get<RackDto[]>('/racks'),
      createRack: (body: CreateRackBody) => post<RackDto>('/racks', body),
      updateRack: (id: string, body: UpdateRackBody) => patch<RackDto>(`/racks/${id}`, body),
      rows: () => get<ShelfRowDto[]>('/rows'),
      createRow: (body: CreateRowBody) => post<ShelfRowDto>('/rows', body),
      bulkRows: (rackId: string, body: BulkRowsBody) => post<ShelfRowDto[]>(`/racks/${rackId}/rows/bulk`, body),
      updateRow: (id: string, body: UpdateRowBody) => patch<ShelfRowDto>(`/rows/${id}`, body),
      map: () => get<ShelfMapRack[]>('/shelves/map'),
      slots: (rowId: string) => get<{ row: ShelfRowDto; slots: RowSlot[] }>(`/shelves/rows/${rowId}/slots`),
      unshelved: (p?: { page?: number; pageSize?: number }) =>
        get<Page<{ id: string; code: string; title: string; genreCode: string; sellingPriceMinor: number }>>('/shelves/unshelved', p),
      placeUnshelved: () => post<{ placed: number; stillUnshelved: number }>('/shelves/place-unshelved'),
      rowSigns: (rowIds?: string[]) => c.blob('GET', '/shelves/row-signs.pdf', { query: { rowIds: rowIds?.join(',') } }),
    },

    catalog: {
      lookup: (isbn: string) => get<CatalogLookupResult>('/catalog/lookup', { isbn }),
      search: (qText: string, author?: string) => get<{ hits: CatalogSearchHit[]; warnings: string[] }>('/catalog/search', { q: qText, author }),
      priceSuggestion: (originalPriceMinor: number, condition: string) => get<PriceSuggestion>('/catalog/price-suggestion', { originalPriceMinor, condition }),
    },

    titles: {
      list: (p?: Partial<ListTitlesQuery>) => get<InventoryPage<import('@bookstall/shared').TitleListItem>>('/titles', p),
      get: (id: string) => get<TitleDetail>(`/titles/${id}`),
      update: (id: string, body: UpdateTitleBody) => patch<{ title: TitleDto; requiresRelocation: number }>(`/titles/${id}`, body),
      uploadCover: (id: string, form: FormData) => c.request<TitleDto>('POST', `/titles/${id}/cover`, { body: form }),
      relocate: (id: string) => post<{ moves: MoveListItem[]; notMoved: number; warnings: string[] }>(`/titles/${id}/relocate`),
    },

    copies: {
      create: (body: CreateCopiesBody) => post<CreateCopiesResponse>('/copies', body),
      list: (p?: Partial<ListCopiesQuery>) => get<InventoryPage<CopyListItem>>('/copies', p),
      get: (id: string) => get<CopyDetail>(`/copies/${id}`),
      byCode: (code: string) => get<CopyDetail>(`/copies/by-code/${encodeURIComponent(code)}`),
      update: (id: string, body: UpdateCopyBody) => patch<CopyDto>(`/copies/${id}`, body),
      writeOff: (id: string, body: WriteOffBody) => post<CopyDto>(`/copies/${id}/write-off`, body),
      move: (id: string, body: MoveCopyBody) => post<CopyDto>(`/copies/${id}/move`, body),
      qrSvg: (id: string) => c.blob('GET', `/copies/${id}/qr.svg`),
    },

    labels: {
      /** Any number of labels: ids travel in the body, so 500 do not overflow the URL. */
      pdf: (copyIds: string[], opts?: { template?: LabelTemplate; startPosition?: number }) =>
        c.blob('POST', '/labels/pdf', { body: { copyIds, ...opts } }),
      importPdf: (importJobId: string, template?: LabelTemplate) => c.blob('GET', '/labels/pdf', { query: { importJobId, template } }),
      queue: (p?: { page?: number; pageSize?: number; createdBy?: 'me'; importJobId?: string }) => get<Page<LabelQueueItem>>('/labels/queue', p),
      markPrinted: (copyIds: string[]) => post<{ updated: number }>('/labels/mark-printed', { copyIds }),
    },

    scan: {
      resolve: (value: string) => get<ScanResolveResult>('/scan/resolve', { value }),
    },

    stalls: {
      list: (status?: string) => get<StallDto[]>('/stalls', { status }),
      mine: () => get<{ stall: StallDto | null }>('/stalls/mine'),
      get: (id: string) => get<StallDto>(`/stalls/${id}`),
      create: (body: CreateStallBody) => post<CreateStallResponse>('/stalls', body),
      update: (id: string, body: UpdateStallBody) => patch<StallDto>(`/stalls/${id}`, body),
      activate: (id: string) => post<StallDto>(`/stalls/${id}/activate`),
      assign: (id: string, body: AssignManagerBody) => post<StallDto>(`/stalls/${id}/managers`, body),
      unassign: (id: string, userId: string) => c.request<StallDto>('DELETE', `/stalls/${id}/managers/${userId}`),
      remove: (id: string) => c.request<void>('DELETE', `/stalls/${id}`),
      checkout: (id: string, body: CheckoutBody) => post<CheckoutResponse>(`/stalls/${id}/checkout`, body),
      checkin: (body: CheckinBody) => post<CheckinResponse>('/checkin', body),
      pickList: (id: string, batchId: string) => c.blob('GET', `/stalls/${id}/pick-list.pdf`, { query: { batchId } }),
      inventory: (id: string, p?: Partial<ListTitlesQuery>) => get<InventoryPage<import('@bookstall/shared').TitleListItem>>(`/stalls/${id}/inventory`, p),
      movements: (id: string, p?: Partial<MovementsQuery>) => get<Page<MovementDto>>(`/stalls/${id}/movements`, p),
      reconciliation: (id: string) => get<Reconciliation>(`/stalls/${id}/reconciliation`),
      close: (id: string, body: CloseStallBody) => post<Reconciliation>(`/stalls/${id}/close`, body),
      reportPdf: (id: string) => c.blob('GET', `/stalls/${id}/report.pdf`),
      reportXlsx: (id: string) => c.blob('GET', `/stalls/${id}/report.xlsx`),
    },

    sales: {
      create: (body: CreateSaleBody) => post<SaleDto>('/sales', body),
      list: (p?: Partial<ListSalesQuery>) => get<Page<SaleListItem>>('/sales', p),
      get: (id: string) => get<SaleDto>(`/sales/${id}`),
      void: (id: string, body: VoidSaleBody) => post<VoidSaleResponse>(`/sales/${id}/void`, body),
      summary: (p?: Partial<SalesSummaryQuery>) => get<SalesSummary>('/sales/summary', p),
      receipt: (id: string, format: 'thermal' | 'a6' = 'thermal') => c.blob('GET', `/sales/${id}/receipt.pdf`, { query: { format } }),
      exportXlsx: (p?: Partial<ListSalesQuery>) => c.blob('GET', '/sales/export.xlsx', { query: q(p) }),
    },

    imports: {
      list: (p?: { page?: number; pageSize?: number }) => get<Page<ImportJobDto>>('/imports', p),
      get: (id: string) => get<ImportJobDto>(`/imports/${id}`),
      rows: (id: string, p?: Partial<ListImportRowsQuery>) => get<Page<ImportRowDto>>(`/imports/${id}/rows`, p),
      upload: (form: FormData) => c.request<{ jobId: string }>('POST', '/imports', { body: form }),
      patchRow: (id: string, rowId: string, body: PatchImportRowBody) => patch<ImportRowDto>(`/imports/${id}/rows/${rowId}`, body),
      skipRow: (id: string, rowId: string) => post<ImportRowDto>(`/imports/${id}/rows/${rowId}/skip`),
      commit: (id: string, body: CommitImportBody = { skipErrors: false }) => post<ImportJobDto>(`/imports/${id}/commit`, body),
      template: () => c.blob('GET', '/imports/template.xlsx'),
      result: (id: string) => c.blob('GET', `/imports/${id}/result.xlsx`),
    },

    settings: {
      get: () => get<{ settings?: Record<string, unknown>; client?: ClientSettings }>('/settings'),
      update: (body: UpdateSettingsBody) => patch<{ settings: Record<string, unknown> }>('/settings', body),
    },

    dashboard: { get: () => get<DashboardResponse>('/dashboard') },

    audit: {
      list: (p?: Omit<Partial<ListAuditQuery>, 'from' | 'to'> & { from?: string; to?: string }) =>
        get<Page<{ id: number; actorId: string | null; action: string; entityType: string; entityId: string; before: unknown; after: unknown; createdAt: string }>>('/audit-logs', p),
    },

    reports: { inventoryXlsx: () => c.blob('GET', '/reports/inventory.xlsx') },

    publicPages: {
      copy: (code: string) => c.request<PublicCopyPage>('GET', `/public/copies/${encodeURIComponent(code)}`, { anonymous: true }),
    },
  };
}

export type Api = ReturnType<typeof createApi>;
