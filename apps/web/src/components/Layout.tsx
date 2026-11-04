import { NavLink, Outlet } from 'react-router';
import { cx } from './ui';

const NAV = [
  { to: '/', label: 'Resumen', icon: '📊', end: true },
  { to: '/gastos', label: 'Gastos', icon: '💸', end: false },
  { to: '/ingresos', label: 'Ingresos', icon: '💰', end: false },
  { to: '/huchas', label: 'Huchas', icon: '🐷', end: false },
  { to: '/ajustes', label: 'Ajustes', icon: '⚙️', end: false },
];

export function Layout() {
  return (
    <div className="min-h-dvh pb-[calc(4.5rem+env(safe-area-inset-bottom))]">
      <main className="mx-auto max-w-2xl space-y-4 px-4 py-5">
        <Outlet />
      </main>

      <nav className="fixed inset-x-0 bottom-0 border-t border-slate-200 bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur dark:border-slate-800 dark:bg-slate-900/95">
        <div className="mx-auto flex max-w-2xl">
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                cx(
                  'flex min-w-0 flex-1 flex-col items-center gap-0.5 py-2.5 text-[11px] font-medium',
                  isActive ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-500 dark:text-slate-400',
                )
              }
            >
              <span className="text-xl leading-none">{item.icon}</span>
              {item.label}
            </NavLink>
          ))}
        </div>
      </nav>
    </div>
  );
}
