import React, { useState } from 'react';
import type { DashboardPageId } from '../../navigation/routes';
import { HomeFloatingMenu } from './HomeFloatingMenu';
import { SidebarNavigation } from './SidebarNavigation';

interface AppLayoutProps {
  activePage: DashboardPageId;
  onSelectPage: (page: DashboardPageId) => void;
  children: React.ReactNode;
}

export const AppLayout: React.FC<AppLayoutProps> = ({
  activePage,
  onSelectPage,
  children,
}) => {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const isHome = activePage === 'home';

  return (
    <div className="min-h-screen bg-[#090D16] text-slate-100 flex flex-col lg:flex-row">
      {isHome ? (
        <HomeFloatingMenu activePage={activePage} onSelectPage={onSelectPage} />
      ) : (
        <SidebarNavigation
          activePage={activePage}
          onSelectPage={onSelectPage}
          collapsed={sidebarCollapsed}
          onToggleCollapse={() => setSidebarCollapsed((prev) => !prev)}
        />
      )}
      <div className="flex-1 min-w-0 flex flex-col">{children}</div>
    </div>
  );
};
