import { RouterProvider } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from '@macario/shared/lib/queryClient';
import { router } from './router/routes';
import { ToastProvider } from './components/shared/Toast';

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <RouterProvider router={router}/>
      </ToastProvider>
    </QueryClientProvider>
  );
}
