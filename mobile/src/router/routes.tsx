import { createBrowserRouter, Navigate } from 'react-router-dom';
import { ProtectedRoute } from '@/components/layout/ProtectedRoute';
import { MobileLayout } from '@/components/layout/MobileLayout';
import { LoginScreen } from '@/components/pages/LoginScreen';
import { HomePage } from '@/components/pages/HomePage';
import { ProduccionPage } from '@/components/pages/ProduccionPage';
import { NotificacionesPage } from '@/components/pages/NotificacionesPage';
import {
  ScanPage, PerfilPage,
  CarrierPage, HistoricoPage, CatalogoPage, EquipoPage, ImportarPage,
} from '@/components/pages/StubPages';

export const router = createBrowserRouter(
  [
    { path: '/login', element: <LoginScreen/> },
    {
      path: '/',
      element: <ProtectedRoute><MobileLayout/></ProtectedRoute>,
      children: [
        { index: true, element: <HomePage/> },
        { path: 'produccion', element: <ProtectedRoute requireItem="produccion"><ProduccionPage/></ProtectedRoute> },
        { path: 'scan', element: <ScanPage/> },
        { path: 'notificaciones', element: <NotificacionesPage/> },
        { path: 'perfil', element: <PerfilPage/> },
        { path: 'canal/:canal', element: <ProtectedRoute requireItem="colecta"><CarrierPage/></ProtectedRoute> },
        { path: 'historico', element: <ProtectedRoute requireItem="historico"><HistoricoPage/></ProtectedRoute> },
        { path: 'catalogo', element: <ProtectedRoute requireItem="catalogo"><CatalogoPage/></ProtectedRoute> },
        { path: 'equipo', element: <ProtectedRoute requireItem="equipo"><EquipoPage/></ProtectedRoute> },
        { path: 'importar', element: <ImportarPage/> },
        { path: '*', element: <Navigate to="/" replace/> },
      ],
    },
  ],
  { basename: '/m' }
);
