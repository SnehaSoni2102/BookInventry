import { lazy, Suspense, type ComponentType } from 'react';
import { createBrowserRouter } from 'react-router';
import { PageSkeleton } from '../components/states';
import { ForbiddenPage, NotFoundPage, RequireAuth, RequirePermission } from './guards';
import { Layout } from './Layout';
import type { Permission } from '@bookstall/shared';

const page = (load: () => Promise<{ default: ComponentType }>, any?: Permission[]) => {
  const C = lazy(load);
  const el = (
    <Suspense fallback={<PageSkeleton />}>
      <C />
    </Suspense>
  );
  return any ? <RequirePermission any={any}>{el}</RequirePermission> : el;
};

export const router = createBrowserRouter([
  { path: '/login', element: page(() => import('../features/auth/LoginPage')) },
  { path: '/b/:code', element: page(() => import('../features/public/PublicCopyPage')) },
  {
    element: <RequireAuth />,
    children: [
      { path: '/change-password', element: page(() => import('../features/auth/ChangePasswordPage')) },
      {
        element: <Layout />,
        children: [
          { index: true, element: page(() => import('../features/dashboard/DashboardPage')) },
          { path: 'scan', element: page(() => import('../features/scan/ScanStationPage')) },
          { path: 'books/new', element: page(() => import('../features/catalog/AddBookPage'), ['copy.create']) },
          { path: 'inventory', element: page(() => import('../features/inventory/InventoryPage'), ['inventory.read']) },
          { path: 'my-stall', element: page(() => import('../features/inventory/InventoryPage'), ['inventory.read.stall']) },
          { path: 'inventory/titles/:id', element: page(() => import('../features/inventory/TitleDetailPage'), ['inventory.read', 'inventory.read.stall']) },
          { path: 'copies/:code', element: page(() => import('../features/copies/CopyPage'), ['inventory.read', 'inventory.read.stall']) },
          { path: 'stalls', element: page(() => import('../features/stalls/StallsPage'), ['stall.manage', 'stall.checkout', 'stall.checkin']) },
          { path: 'stalls/:id', element: page(() => import('../features/stalls/StallDetailPage'), ['stall.manage', 'stall.checkout', 'stall.checkin']) },
          { path: 'sales', element: page(() => import('../features/sales/SalesPage'), ['sale.read.all', 'sale.read.own']) },
          { path: 'labels', element: page(() => import('../features/labels/LabelsPage'), ['label.print']) },
          { path: 'imports', element: page(() => import('../features/imports/ImportsPage'), ['import.manage']) },
          { path: 'imports/:id', element: page(() => import('../features/imports/ImportDetailPage'), ['import.manage']) },
          { path: 'shelves', element: page(() => import('../features/shelves/ShelvesPage'), ['shelf.manage', 'inventory.read']) },
          { path: 'genres', element: page(() => import('../features/shelves/GenresPage'), ['genre.manage']) },
          { path: 'users', element: page(() => import('../features/users/UsersPage'), ['user.manage']) },
          { path: 'settings', element: page(() => import('../features/settings/SettingsPage'), ['settings.manage']) },
          { path: 'audit', element: page(() => import('../features/settings/AuditPage'), ['audit.read']) },
          { path: '403', element: <ForbiddenPage /> },
          { path: '*', element: <NotFoundPage /> },
        ],
      },
    ],
  },
]);
