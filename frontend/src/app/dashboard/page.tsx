"use client";

import { useEffect, useState } from 'react';
import Link from 'next/link';

interface DailyStats {
  date: string;
  total: number;
  confirmed: number;
  pending: number;
  completed: number;
  cancelled: number;
  noShow: number;
  estimatedRevenue: number;
}

interface AppointmentItem {
  id: string;
  startAt: string;
  endAt: string;
  status: 'PENDING' | 'CONFIRMED' | 'CANCELLED' | 'COMPLETED' | 'NO_SHOW';
  price: number;
  depositAmount: number;
  notes: string | null;
  customer: {
    id: string;
    name: string;
    phone: string;
    email: string | null;
  };
  service: {
    id: string;
    name: string;
    durationMinutes: number;
    price: number;
  };
  staff: {
    id: string;
    name: string;
  };
}

export default function DashboardOverviewPage() {
  const [profile, setProfile] = useState<{ id: string; name: string; slug: string; phone?: string } | null>(null);
  const [dailyStats, setDailyStats] = useState<DailyStats | null>(null);
  const [customerStats, setCustomerStats] = useState<{ totalCustomers: number; active: number; inactive: number; newThisMonth: number; returningCustomers: number } | null>(null);
  const [todayAppointments, setTodayAppointments] = useState<AppointmentItem[]>([]);
  const [upcomingAppointments, setUpcomingAppointments] = useState<AppointmentItem[]>([]);
  const [counts, setCounts] = useState({ services: 0, staff: 0, holidays: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const token = localStorage.getItem('access_token');
    if (!token) return;

    const loadData = async () => {
      try {
        setLoading(true);
        const headers = { Authorization: `Bearer ${token}` };
        const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api/v1';

        const todayStr = new Date().toISOString().slice(0, 10);

        const [
          profileRes,
          statsRes,
          custStatsRes,
          todayRes,
          upcomingRes,
          servicesRes,
          staffRes,
          holidaysRes,
        ] = await Promise.all([
          fetch(`${apiUrl}/business/profile`, { headers }),
          fetch(`${apiUrl}/appointments/stats/daily?date=${todayStr}`, { headers }),
          fetch(`${apiUrl}/customers/stats/summary`, { headers }),
          fetch(`${apiUrl}/appointments?date=${todayStr}`, { headers }),
          fetch(`${apiUrl}/appointments/upcoming?limit=5`, { headers }),
          fetch(`${apiUrl}/services`, { headers }),
          fetch(`${apiUrl}/staff`, { headers }),
          fetch(`${apiUrl}/holidays`, { headers }),
        ]);

        if (profileRes.ok) setProfile(await profileRes.json());
        if (statsRes.ok) setDailyStats(await statsRes.json());
        if (custStatsRes.ok) setCustomerStats(await custStatsRes.json());
        if (todayRes.ok) setTodayAppointments(await todayRes.json());
        if (upcomingRes.ok) setUpcomingAppointments(await upcomingRes.json());

        if (servicesRes.ok) {
          const s = await servicesRes.json();
          setCounts((prev) => ({ ...prev, services: s.length }));
        }
        if (staffRes.ok) {
          const st = await staffRes.json();
          setCounts((prev) => ({ ...prev, staff: st.length }));
        }
        if (holidaysRes.ok) {
          const h = await holidaysRes.json();
          setCounts((prev) => ({ ...prev, holidays: h.length }));
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Failed to load dashboard data';
        setError(message);
      } finally {
        setLoading(false);
      }
    };

    loadData();
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[50vh]">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4 bg-red-50 border border-red-200 text-red-700 rounded-lg">
        {error}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header Banner */}
      <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">
            Welcome, {profile?.name}
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            Appointment Management & Interactive Calendar Dashboard.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Link
            href="/dashboard/appointments"
            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold rounded-lg shadow-xs transition"
          >
            Open Calendar & Book
          </Link>
          <Link
            href="/dashboard/services"
            className="px-4 py-2 bg-white hover:bg-slate-50 border border-slate-300 text-slate-700 text-sm font-semibold rounded-lg shadow-xs transition"
          >
            Services Catalog
          </Link>
        </div>
      </div>

      {/* Daily Summary Metrics Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-6 gap-4">
        {/* Estimated Revenue */}
        <div className="col-span-2 bg-gradient-to-br from-indigo-900 to-indigo-700 text-white p-5 rounded-xl shadow-xs flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-xs uppercase font-semibold text-indigo-200 tracking-wider">Today&apos;s Estimated Revenue</span>
            <span className="w-7 h-7 rounded-full bg-white/10 flex items-center justify-center text-xs">₹</span>
          </div>
          <div className="mt-3">
            <p className="text-3xl font-extrabold">₹{dailyStats?.estimatedRevenue || 0}</p>
            <p className="text-xs text-indigo-200 mt-1">From active & completed bookings today</p>
          </div>
        </div>

        {/* Total Bookings */}
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
          <span className="text-[11px] uppercase font-semibold text-slate-400 tracking-wider">Total Today</span>
          <p className="text-2xl font-bold text-slate-900 mt-2">{dailyStats?.total || 0}</p>
        </div>

        {/* Confirmed */}
        <div className="bg-white p-4 rounded-xl border border-emerald-100 bg-emerald-50/20 shadow-xs">
          <span className="text-[11px] uppercase font-semibold text-emerald-700 tracking-wider">Confirmed</span>
          <p className="text-2xl font-bold text-emerald-700 mt-2">{dailyStats?.confirmed || 0}</p>
        </div>

        {/* Pending */}
        <div className="bg-white p-4 rounded-xl border border-amber-100 bg-amber-50/20 shadow-xs">
          <span className="text-[11px] uppercase font-semibold text-amber-700 tracking-wider">Pending</span>
          <p className="text-2xl font-bold text-amber-700 mt-2">{dailyStats?.pending || 0}</p>
        </div>

        {/* Completed */}
        <div className="bg-white p-4 rounded-xl border border-blue-100 bg-blue-50/20 shadow-xs">
          <span className="text-[11px] uppercase font-semibold text-blue-700 tracking-wider">Completed</span>
          <p className="text-2xl font-bold text-blue-700 mt-2">{dailyStats?.completed || 0}</p>
        </div>
      </div>

      {/* Main Grid: Today's Timeline & Upcoming Appointments */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Today's Schedule Timeline (2 columns) */}
        <div className="lg:col-span-2 bg-white rounded-xl border border-slate-200 p-6 shadow-xs">
          <div className="flex items-center justify-between pb-4 border-b border-slate-100">
            <div>
              <h2 className="text-base font-bold text-slate-900">Today&apos;s Appointments Timeline</h2>
              <p className="text-xs text-slate-500 mt-0.5">
                {new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}
              </p>
            </div>
            <Link
              href="/dashboard/appointments"
              className="text-xs font-semibold text-indigo-600 hover:text-indigo-700"
            >
              Full Calendar →
            </Link>
          </div>

          {todayAppointments.length === 0 ? (
            <div className="py-12 text-center">
              <p className="text-slate-400 text-3xl mb-2">☀️</p>
              <h3 className="text-sm font-semibold text-slate-700">No appointments scheduled for today</h3>
              <p className="text-xs text-slate-500 mt-1">Ready to take on new bookings or appointments.</p>
            </div>
          ) : (
            <div className="divide-y divide-slate-100 mt-2">
              {todayAppointments.map((appt) => {
                const s = new Date(appt.startAt);
                const e = new Date(appt.endAt);
                const isCancelled = appt.status === 'CANCELLED';

                return (
                  <div
                    key={appt.id}
                    className={`py-3.5 flex items-center justify-between gap-4 transition ${
                      isCancelled ? 'opacity-50' : 'hover:bg-slate-50/70 -mx-2 px-2 rounded-lg'
                    }`}
                  >
                    <div className="flex items-center gap-4">
                      <div className="w-16 text-center">
                        <span className="text-xs font-bold text-slate-900 block">
                          {s.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </span>
                        <span className="text-[10px] text-slate-400">
                          {e.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </div>
                      <div className="h-8 w-1 bg-indigo-600 rounded-full"></div>
                      <div>
                        <h4 className="text-sm font-semibold text-slate-900">{appt.customer.name}</h4>
                        <p className="text-xs text-slate-500">
                          {appt.service.name} • <span className="text-indigo-600 font-medium">{appt.staff.name}</span>
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-3">
                      <span className="text-xs font-semibold text-slate-900">₹{appt.price}</span>
                      <span
                        className={`px-2.5 py-0.5 rounded-full text-[11px] font-semibold ${
                          appt.status === 'CONFIRMED'
                            ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                            : appt.status === 'COMPLETED'
                            ? 'bg-blue-50 text-blue-700 border border-blue-200'
                            : appt.status === 'CANCELLED'
                            ? 'bg-rose-50 text-rose-700 border border-rose-200'
                            : 'bg-amber-50 text-amber-700 border border-amber-200'
                        }`}
                      >
                        {appt.status}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Upcoming Appointments & Business Resources (1 column) */}
        <div className="space-y-6">
          {/* Upcoming Card */}
          <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-xs">
            <h2 className="text-base font-bold text-slate-900 pb-3 border-b border-slate-100">
              Upcoming Bookings
            </h2>
            {upcomingAppointments.length === 0 ? (
              <p className="text-xs text-slate-500 py-6 text-center">No upcoming bookings found.</p>
            ) : (
              <div className="divide-y divide-slate-100 mt-2">
                {upcomingAppointments.map((appt) => {
                  const s = new Date(appt.startAt);
                  return (
                    <div key={appt.id} className="py-2.5 flex justify-between items-center text-xs">
                      <div>
                        <p className="font-semibold text-slate-900">{appt.customer.name}</p>
                        <p className="text-slate-500 text-[11px]">
                          {s.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} at{' '}
                          {s.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} • {appt.service.name}
                        </p>
                      </div>
                      <span className="font-semibold text-slate-700">₹{appt.price}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Quick Stats Grid */}
          <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-xs">
            <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">Resource Catalogs</h3>
            <div className="grid grid-cols-4 gap-2 text-center">
              <Link href="/dashboard/customers" className="p-3 bg-indigo-50/50 rounded-lg hover:bg-indigo-100/60 transition">
                <p className="text-lg font-extrabold text-indigo-700">{customerStats?.totalCustomers ?? 0}</p>
                <p className="text-[11px] font-semibold text-indigo-600 mt-0.5">Customers</p>
              </Link>
              <Link href="/dashboard/services" className="p-3 bg-slate-50 rounded-lg hover:bg-indigo-50/50 transition">
                <p className="text-lg font-bold text-slate-900">{counts.services}</p>
                <p className="text-[11px] text-slate-500 mt-0.5">Services</p>
              </Link>
              <Link href="/dashboard/staff" className="p-3 bg-slate-50 rounded-lg hover:bg-indigo-50/50 transition">
                <p className="text-lg font-bold text-slate-900">{counts.staff}</p>
                <p className="text-[11px] text-slate-500 mt-0.5">Staff</p>
              </Link>
              <Link href="/dashboard/holidays" className="p-3 bg-slate-50 rounded-lg hover:bg-indigo-50/50 transition">
                <p className="text-lg font-bold text-slate-900">{counts.holidays}</p>
                <p className="text-[11px] text-slate-500 mt-0.5">Holidays</p>
              </Link>
            </div>
          </div>

          {/* Customer CRM Highlights */}
          {customerStats && (
            <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-xs">
              <div className="flex items-center justify-between pb-2 border-b border-slate-100 mb-3">
                <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider">CRM Client Insights</h3>
                <Link href="/dashboard/customers" className="text-xs font-bold text-indigo-600 hover:text-indigo-700">
                  Directory →
                </Link>
              </div>
              <div className="grid grid-cols-2 gap-3 text-xs">
                <div className="p-3 bg-slate-50 rounded-xl">
                  <span className="text-slate-400 block text-[10px] uppercase font-bold">New This Month</span>
                  <p className="text-lg font-extrabold text-slate-900 mt-0.5">{customerStats.newThisMonth}</p>
                </div>
                <div className="p-3 bg-slate-50 rounded-xl">
                  <span className="text-slate-400 block text-[10px] uppercase font-bold">Returning Clients</span>
                  <p className="text-lg font-extrabold text-indigo-600 mt-0.5">{customerStats.returningCustomers}</p>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
