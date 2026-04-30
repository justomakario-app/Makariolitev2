import { createBrowserRouter, Navigate } from 'react-router-dom';
import { ProtectedRoute } from '@/components/layout/ProtectedRoute';
import { AppLayout } from '@/components/layout/AppLayout';
import { LoginScreen } from '@/components/login/LoginScreen';
import { DashboardPage } from '@/components/pages/DashboardPage';
import { CarrierPage } from '@/components/pages/CarrierPage';
import { ProduccionPage } from '@/components/pages/ProduccionPage';
import { NotificacionesPage } from '@/components/pages/NotificacionesPage';
import { CatalogoPage } from '@/components/pages/CatalogoPage';
import { EquipoPage } from '@/components/pages/EquipoPage';
import { HistoricoPage } from '@/components/pages/HistoricoPage';
import { ConfigPage, QRPage } from '@/components/pages/StubPages';

export const router = createBrowserRouter([
  { path: '/login', element: <LoginScreen /> },
  {
    path: '/',
    element: <ProtectedRoute><AppLayout /></ProtectedRoute>,
    children: [
      { index: true, element: <DashboardPage /> },
      { path: 'canal/:canal', element: <CarrierPage /> },
      { path: 'produccion', element: <ProduccionPage /> },
      { path: 'historico', element: <HistoricoPage /> },
      { path: 'catalogo', element: <CatalogoPage /> },
      { path: 'equipo', element: <EquipoPage /> },
      { path: 'notificaciones', element: <NotificacionesPage /> },
      { path: 'perfil', element: <ConfigPage /> },
      { path: 'qr', element: <QRPage /> },
      { path: '*', element: <Navigate to="/" replace /> },
    ],
  },
]);
