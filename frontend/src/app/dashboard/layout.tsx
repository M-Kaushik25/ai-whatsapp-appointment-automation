"use client";

import { useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import Link from 'next/link';

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [businessName, setBusinessName] = useState<string>('Business Dashboard');
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    const token = localStorage.getItem('access_token');
    if (!token) {
      router.push('/login');
      return;
    }

    const fetchProfile = async () => {
      try {
        const res = await fetch(
          `${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api/v1'}/business/profile`,
          {
            headers: {
              Authorization: `Bearer ${token}`,
            },
          },
        );

        if (res.ok) {
          const data = await res.json();
          setBusinessName(data.name || 'Business Dashboard');
        } else if (res.status === 401) {
          localStorage.removeItem('access_token');
          router.push('/login');
        }
      } catch (err) {
        console.error('Failed to load profile', err);
      }
    };

    fetchProfile();
  }, [router]);

  const handleLogout = () => {
    localStorage.removeItem('access_token');
    router.push('/login');
  };

  const navLinks = [
    { name: 'Overview', href: '/dashboard' },
    { name: 'Appointments', href: '/dashboard/appointments' },
    { name: 'Customers', href: '/dashboard/customers' },
    { name: 'Payments', href: '/dashboard/payments' },
    { name: 'Notifications', href: '/dashboard/notifications' },
    { name: 'Retention', href: '/dashboard/retention' },
    { name: 'WhatsApp', href: '/dashboard/whatsapp' },
    { name: 'Services', href: '/dashboard/services' },
    { name: 'Staff', href: '/dashboard/staff' },
    { name: 'Holidays', href: '/dashboard/holidays' },
  ];

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col font-sans">
      {/* Top Navigation Bar */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-30 shadow-xs">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16 items-center">
            <div className="flex items-center space-x-8">
              <div className="flex items-center space-x-3">
                <div className="w-9 h-9 rounded-lg bg-indigo-600 flex items-center justify-center text-white font-bold text-lg shadow-sm">
                  {businessName.charAt(0).toUpperCase()}
                </div>
                <div>
                  <span className="text-base font-bold text-slate-900 block leading-tight">{businessName}</span>
                  <span className="text-xs text-indigo-600 font-medium">Phase 3 • Management Suite</span>
                </div>
              </div>

              <nav className="hidden md:flex space-x-1">
                {navLinks.map((link) => {
                  const isActive =
                    pathname === link.href ||
                    (link.href !== '/dashboard' && pathname.startsWith(link.href));
                  return (
                    <Link
                      key={link.name}
                      href={link.href}
                      className={`px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                        isActive
                          ? 'bg-indigo-50 text-indigo-700 font-semibold'
                          : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
                      }`}
                    >
                      {link.name}
                    </Link>
                  );
                })}
              </nav>
            </div>

            <div className="flex items-center space-x-3">
              <button
                onClick={handleLogout}
                className="inline-flex items-center px-3.5 py-1.5 border border-slate-300 text-xs font-medium rounded-md text-slate-700 bg-white hover:bg-slate-50 hover:text-red-600 transition shadow-xs"
              >
                Sign Out
              </button>
            </div>
          </div>
        </div>

        {/* Mobile Navigation bar */}
        <div className="md:hidden border-t border-slate-100 px-4 py-2 flex space-x-1 overflow-x-auto">
          {navLinks.map((link) => {
            const isActive =
              pathname === link.href ||
              (link.href !== '/dashboard' && pathname.startsWith(link.href));
            return (
              <Link
                key={link.name}
                href={link.href}
                className={`px-3 py-1.5 rounded-md text-xs font-medium whitespace-nowrap ${
                  isActive
                    ? 'bg-indigo-50 text-indigo-700 font-semibold'
                    : 'text-slate-600 hover:bg-slate-100'
                }`}
              >
                {link.name}
              </Link>
            );
          })}
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-4 sm:p-6 lg:p-8">
        {children}
      </main>
    </div>
  );
}
