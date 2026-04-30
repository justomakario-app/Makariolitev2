import { Outlet } from 'react-router-dom';
import { BottomTabs } from './BottomTabs';

export function MobileLayout() {
  return (
    <div className="m-app">
      <div className="m-content">
        <Outlet/>
      </div>
      <BottomTabs/>
    </div>
  );
}
