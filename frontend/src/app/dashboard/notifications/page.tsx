"use client";

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';

interface NotificationItem {
  id: string;
  businessId: string;
  appointmentId: string;
  customerId: string | null;
  type: string;
  recipientPhone: string;
  scheduledAt: string;
  sentAt: string | null;
  status: 'PENDING' | 'PROCESSING' | 'SENT' | 'FAILED' | 'CANCELLED';
  providerMessageId: string | null;
  attempts: number;
  maxAttempts: number;
  lastError: string | null;
  payload: string | null;
  createdAt: string;
  customer?: {
    name: string;
    phone: string;
  } | null;
  appointment?: {
    id: string;
    startAt: string;
    service?: { name: string; price: number };
    staff?: { name: string };
  };
}

interface ReminderSettings {
  id?: string;
  remindersEnabled: boolean;
  firstReminderMinutes: number;
  firstReminderEnabled: boolean;
  secondReminderMinutes: number;
  secondReminderEnabled: boolean;
  ownerNotificationEnabled: boolean;
  ownerNotificationPhone?: string | null;
}

export default function NotificationsPage() {
  const router = useRouter();
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [typeFilter, setTypeFilter] = useState('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(true);

  // Settings State
  const [settings, setSettings] = useState<ReminderSettings>({
    remindersEnabled: true,
    firstReminderMinutes: 1440,
    firstReminderEnabled: true,
    secondReminderMinutes: 120,
    secondReminderEnabled: true,
    ownerNotificationEnabled: true,
    ownerNotificationPhone: '',
  });
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [settingsLoading, setSettingsLoading] = useState(false);
  const [settingsSuccess, setSettingsSuccess] = useState(false);
  const [settingsError, setSettingsError] = useState('');

  // Details Modal
  const [selectedNotif, setSelectedNotif] = useState<NotificationItem | null>(null);

  const fetchNotifications = useCallback(async () => {
    const token = localStorage.getItem('access_token');
    if (!token) {
      router.push('/login');
      return;
    }

    try {
      setLoading(true);
      const queryParams = new URLSearchParams({
        page: page.toString(),
        limit: '15',
      });
      if (statusFilter !== 'ALL') queryParams.append('status', statusFilter);
      if (typeFilter !== 'ALL') queryParams.append('type', typeFilter);
      if (searchQuery.trim()) queryParams.append('search', searchQuery.trim());

      const res = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api/v1'}/notifications?${queryParams.toString()}`,
        {
          headers: { Authorization: `Bearer ${token}` },
        },
      );

      if (res.ok) {
        const data = await res.json();
        setNotifications(data.items || []);
        setTotalCount(data.total || 0);
      }
    } catch (err) {
      console.error('Failed to fetch notifications', err);
    } finally {
      setLoading(false);
    }
  }, [page, statusFilter, typeFilter, searchQuery, router]);

  const fetchSettings = useCallback(async () => {
    const token = localStorage.getItem('access_token');
    if (!token) return;

    try {
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api/v1'}/reminder-settings`,
        {
          headers: { Authorization: `Bearer ${token}` },
        },
      );
      if (res.ok) {
        const data = await res.json();
        setSettings(data);
      }
    } catch (err) {
      console.error('Failed to fetch reminder settings', err);
    }
  }, []);

  useEffect(() => {
    fetchNotifications();
    fetchSettings();
  }, [fetchNotifications, fetchSettings]);

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setSettingsLoading(true);
    setSettingsError('');
    setSettingsSuccess(false);

    const token = localStorage.getItem('access_token');
    if (!token) return;

    try {
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api/v1'}/reminder-settings`,
        {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            remindersEnabled: settings.remindersEnabled,
            firstReminderMinutes: Number(settings.firstReminderMinutes),
            firstReminderEnabled: settings.firstReminderEnabled,
            secondReminderMinutes: Number(settings.secondReminderMinutes),
            secondReminderEnabled: settings.secondReminderEnabled,
            ownerNotificationEnabled: settings.ownerNotificationEnabled,
            ownerNotificationPhone: settings.ownerNotificationPhone || undefined,
          }),
        },
      );

      if (res.ok) {
        setSettingsSuccess(true);
        setTimeout(() => setSettingsSuccess(false), 3000);
      } else {
        const err = await res.json();
        setSettingsError(err.message || 'Failed to update reminder settings');
      }
    } catch (err: any) {
      setSettingsError(err.message || 'Network error');
    } finally {
      setSettingsLoading(false);
    }
  };

  const getTypeBadge = (type: string) => {
    switch (type) {
      case 'BOOKING_CONFIRMATION':
        return (
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-800">
            🎉 Booking Confirmation
          </span>
        );
      case 'APPOINTMENT_REMINDER':
        return (
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-indigo-100 text-indigo-800">
            ⏰ Reminder
          </span>
        );
      case 'RESCHEDULE_CONFIRMATION':
        return (
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-100 text-amber-800">
            🔄 Rescheduled
          </span>
        );
      case 'CANCELLATION_CONFIRMATION':
        return (
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-rose-100 text-rose-800">
            ❌ Cancellation
          </span>
        );
      case 'OWNER_BOOKING_NOTIFICATION':
        return (
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-purple-100 text-purple-800">
            📅 Owner Alert
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-slate-100 text-slate-800">
            {type}
          </span>
        );
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'SENT':
        return (
          <span className="inline-flex items-center px-2.5 py-1 rounded-md text-xs font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
            SENT
          </span>
        );
      case 'PENDING':
        return (
          <span className="inline-flex items-center px-2.5 py-1 rounded-md text-xs font-bold bg-amber-50 text-amber-700 border border-amber-200">
            PENDING
          </span>
        );
      case 'PROCESSING':
        return (
          <span className="inline-flex items-center px-2.5 py-1 rounded-md text-xs font-bold bg-blue-50 text-blue-700 border border-blue-200 animate-pulse">
            PROCESSING
          </span>
        );
      case 'FAILED':
        return (
          <span className="inline-flex items-center px-2.5 py-1 rounded-md text-xs font-bold bg-rose-50 text-rose-700 border border-rose-200">
            FAILED
          </span>
        );
      case 'CANCELLED':
        return (
          <span className="inline-flex items-center px-2.5 py-1 rounded-md text-xs font-bold bg-slate-100 text-slate-600 border border-slate-200">
            CANCELLED
          </span>
        );
      default:
        return <span>{status}</span>;
    }
  };

  const parseMessageText = (payload: string | null) => {
    if (!payload) return null;
    try {
      const parsed = JSON.parse(payload);
      return parsed.message || null;
    } catch {
      return null;
    }
  };

  // Stats Counters
  const statsSent = notifications.filter((n) => n.status === 'SENT').length;
  const statsPending = notifications.filter((n) => n.status === 'PENDING').length;
  const statsFailed = notifications.filter((n) => n.status === 'FAILED').length;

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
      {/* Header & Settings Trigger */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-white p-6 rounded-2xl border border-slate-200 shadow-xs">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-black text-slate-900 tracking-tight">
              Appointment Notifications & Reminders
            </h1>
            <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-indigo-50 text-indigo-700 border border-indigo-200">
              Phase 9
            </span>
          </div>
          <p className="text-sm text-slate-500 mt-1">
            Automated WhatsApp reminders, booking confirmations, and business owner alerts.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={() => fetchNotifications()}
            className="px-3.5 py-2 text-sm font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors flex items-center gap-2"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            Refresh
          </button>
          <button
            onClick={() => setIsSettingsOpen(true)}
            className="px-4 py-2 text-sm font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg shadow-sm transition-all flex items-center gap-2"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            Reminder Settings
          </button>
        </div>
      </div>

      {/* Metrics Banner */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
          <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Total Recorded</div>
          <div className="text-2xl font-extrabold text-slate-900 mt-1">{totalCount}</div>
        </div>
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
          <div className="text-xs font-semibold text-emerald-600 uppercase tracking-wider">Sent (On Page)</div>
          <div className="text-2xl font-extrabold text-emerald-600 mt-1">{statsSent}</div>
        </div>
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
          <div className="text-xs font-semibold text-amber-600 uppercase tracking-wider">Pending (On Page)</div>
          <div className="text-2xl font-extrabold text-amber-600 mt-1">{statsPending}</div>
        </div>
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
          <div className="text-xs font-semibold text-rose-600 uppercase tracking-wider">Failed (On Page)</div>
          <div className="text-2xl font-extrabold text-rose-600 mt-1">{statsFailed}</div>
        </div>
      </div>

      {/* Filter & Search Toolbar */}
      <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs flex flex-col md:flex-row gap-4 justify-between items-center">
        {/* Search */}
        <div className="w-full md:w-80 relative">
          <input
            type="text"
            placeholder="Search by customer, phone, ID..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full px-3 py-2 pl-9 text-sm rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
          />
          <svg className="w-4 h-4 text-slate-400 absolute left-3 top-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
        </div>

        {/* Type Filter */}
        <div className="flex items-center gap-3 w-full md:w-auto">
          <select
            value={typeFilter}
            onChange={(e) => {
              setTypeFilter(e.target.value);
              setPage(1);
            }}
            className="px-3 py-2 text-sm rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white"
          >
            <option value="ALL">All Notification Types</option>
            <option value="BOOKING_CONFIRMATION">Booking Confirmations</option>
            <option value="APPOINTMENT_REMINDER">Appointment Reminders</option>
            <option value="RESCHEDULE_CONFIRMATION">Reschedules</option>
            <option value="CANCELLATION_CONFIRMATION">Cancellations</option>
            <option value="OWNER_BOOKING_NOTIFICATION">Owner Alerts</option>
          </select>

          {/* Status Tabs */}
          <div className="flex bg-slate-100 p-1 rounded-lg">
            {['ALL', 'PENDING', 'SENT', 'FAILED', 'CANCELLED'].map((st) => (
              <button
                key={st}
                onClick={() => {
                  setStatusFilter(st);
                  setPage(1);
                }}
                className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-all ${
                  statusFilter === st
                    ? 'bg-white text-indigo-700 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {st}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Notifications Table */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
        {loading ? (
          <div className="p-12 text-center text-slate-400 text-sm">
            <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600 mb-3"></div>
            <p>Loading notifications history...</p>
          </div>
        ) : notifications.length === 0 ? (
          <div className="p-12 text-center text-slate-500">
            <svg className="w-12 h-12 text-slate-300 mx-auto mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
            </svg>
            <p className="font-semibold text-base text-slate-700">No notifications found</p>
            <p className="text-xs text-slate-400 mt-1">
              {searchQuery || statusFilter !== 'ALL' || typeFilter !== 'ALL'
                ? 'Try adjusting your search or filters.'
                : 'Notifications will appear automatically when appointments are booked or reminders trigger.'}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-sm">
              <thead>
                <tr className="bg-slate-50/75 border-b border-slate-200 text-xs font-semibold text-slate-500 uppercase tracking-wider">
                  <th className="py-3.5 px-4">Type & Reference</th>
                  <th className="py-3.5 px-4">Recipient</th>
                  <th className="py-3.5 px-4">Appointment Info</th>
                  <th className="py-3.5 px-4">Scheduled / Sent Time</th>
                  <th className="py-3.5 px-4">Status</th>
                  <th className="py-3.5 px-4">Attempts</th>
                  <th className="py-3.5 px-4 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200/60">
                {notifications.map((item) => (
                  <tr key={item.id} className="hover:bg-slate-50/80 transition-colors">
                    <td className="py-4 px-4">
                      <div className="space-y-1">
                        <div>{getTypeBadge(item.type)}</div>
                        <div className="text-xs font-mono text-slate-400">
                          Appt #{item.appointmentId.slice(0, 8).toUpperCase()}
                        </div>
                      </div>
                    </td>
                    <td className="py-4 px-4">
                      <div className="font-medium text-slate-900">
                        {item.customer?.name || (item.type === 'OWNER_BOOKING_NOTIFICATION' ? 'Business Owner' : 'Customer')}
                      </div>
                      <div className="text-xs text-slate-500 font-mono">{item.recipientPhone}</div>
                    </td>
                    <td className="py-4 px-4">
                      {item.appointment ? (
                        <div>
                          <div className="font-medium text-slate-800">
                            {item.appointment.service?.name || 'Service'}
                          </div>
                          <div className="text-xs text-slate-500">
                            Staff: {item.appointment.staff?.name || 'Staff'}
                          </div>
                        </div>
                      ) : (
                        <span className="text-xs text-slate-400">—</span>
                      )}
                    </td>
                    <td className="py-4 px-4 text-xs space-y-0.5">
                      <div className="text-slate-700">
                        <span className="font-medium text-slate-500">Due:</span>{' '}
                        {new Date(item.scheduledAt).toLocaleString('en-GB', {
                          day: 'numeric',
                          month: 'short',
                          hour: 'numeric',
                          minute: '2-digit',
                        })}
                      </div>
                      {item.sentAt && (
                        <div className="text-emerald-700">
                          <span className="font-medium">Sent:</span>{' '}
                          {new Date(item.sentAt).toLocaleString('en-GB', {
                            day: 'numeric',
                            month: 'short',
                            hour: 'numeric',
                            minute: '2-digit',
                          })}
                        </div>
                      )}
                    </td>
                    <td className="py-4 px-4">
                      <div>{getStatusBadge(item.status)}</div>
                      {item.lastError && (
                        <div className="text-[11px] text-rose-600 mt-1 max-w-xs truncate" title={item.lastError}>
                          ⚠️ {item.lastError}
                        </div>
                      )}
                    </td>
                    <td className="py-4 px-4 text-xs font-mono text-slate-600">
                      {item.attempts}/{item.maxAttempts}
                    </td>
                    <td className="py-4 px-4 text-right">
                      <button
                        onClick={() => setSelectedNotif(item)}
                        className="px-2.5 py-1 text-xs font-medium text-indigo-600 hover:text-indigo-900 bg-indigo-50 hover:bg-indigo-100 rounded-md transition-colors"
                      >
                        Preview
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination Bar */}
        <div className="p-4 border-t border-slate-200 flex justify-between items-center text-xs text-slate-500">
          <div>
            Showing <span className="font-semibold">{notifications.length}</span> of{' '}
            <span className="font-semibold">{totalCount}</span> notifications
          </div>
          <div className="flex gap-2">
            <button
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              className="px-3 py-1.5 rounded-md border border-slate-300 disabled:opacity-40 hover:bg-slate-50 font-medium"
            >
              Previous
            </button>
            <button
              disabled={notifications.length < 15}
              onClick={() => setPage((p) => p + 1)}
              className="px-3 py-1.5 rounded-md border border-slate-300 disabled:opacity-40 hover:bg-slate-50 font-medium"
            >
              Next
            </button>
          </div>
        </div>
      </div>

      {/* Reminder Settings Modal */}
      {isSettingsOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full border border-slate-200 shadow-2xl overflow-hidden animate-in fade-in zoom-in duration-150">
            <div className="p-6 border-b border-slate-200 flex justify-between items-center bg-slate-50">
              <div>
                <h3 className="text-lg font-bold text-slate-900">Appointment Reminder Settings</h3>
                <p className="text-xs text-slate-500 mt-0.5">Configure automated notification timings and owner alerts.</p>
              </div>
              <button
                onClick={() => setIsSettingsOpen(false)}
                className="text-slate-400 hover:text-slate-600 rounded-lg p-1"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSaveSettings} className="p-6 space-y-5">
              {settingsSuccess && (
                <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-lg text-xs font-semibold text-emerald-800">
                  ✓ Reminder settings updated successfully!
                </div>
              )}
              {settingsError && (
                <div className="p-3 bg-rose-50 border border-rose-200 rounded-lg text-xs font-semibold text-rose-800">
                  ⚠️ {settingsError}
                </div>
              )}

              {/* Master Reminders Toggle */}
              <div className="flex items-center justify-between p-3.5 bg-indigo-50/50 rounded-xl border border-indigo-100">
                <div>
                  <div className="text-sm font-bold text-slate-900">Enable Automated Reminders</div>
                  <div className="text-xs text-slate-500">Send WhatsApp reminders to customers before appointments</div>
                </div>
                <input
                  type="checkbox"
                  checked={settings.remindersEnabled}
                  onChange={(e) => setSettings({ ...settings, remindersEnabled: e.target.checked })}
                  className="w-5 h-5 text-indigo-600 rounded focus:ring-indigo-500"
                />
              </div>

              {/* 1st Reminder */}
              <div className="space-y-2 p-3.5 bg-slate-50 rounded-xl border border-slate-200">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-bold text-slate-800">1st Reminder</span>
                  <input
                    type="checkbox"
                    checked={settings.firstReminderEnabled}
                    onChange={(e) => setSettings({ ...settings, firstReminderEnabled: e.target.checked })}
                    className="w-4 h-4 text-indigo-600 rounded focus:ring-indigo-500"
                  />
                </div>
                <div className="flex items-center gap-3">
                  <input
                    type="number"
                    min="1"
                    value={Math.round(settings.firstReminderMinutes / 60)}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        firstReminderMinutes: Math.max(1, Number(e.target.value)) * 60,
                      })
                    }
                    className="w-24 px-3 py-1.5 text-sm rounded-lg border border-slate-300 bg-white"
                  />
                  <span className="text-xs text-slate-600 font-medium">hours before appointment (Default: 24h)</span>
                </div>
              </div>

              {/* 2nd Reminder */}
              <div className="space-y-2 p-3.5 bg-slate-50 rounded-xl border border-slate-200">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-bold text-slate-800">2nd Reminder (Near-Term)</span>
                  <input
                    type="checkbox"
                    checked={settings.secondReminderEnabled}
                    onChange={(e) => setSettings({ ...settings, secondReminderEnabled: e.target.checked })}
                    className="w-4 h-4 text-indigo-600 rounded focus:ring-indigo-500"
                  />
                </div>
                <div className="flex items-center gap-3">
                  <input
                    type="number"
                    min="1"
                    value={Math.round(settings.secondReminderMinutes / 60)}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        secondReminderMinutes: Math.max(1, Number(e.target.value)) * 60,
                      })
                    }
                    className="w-24 px-3 py-1.5 text-sm rounded-lg border border-slate-300 bg-white"
                  />
                  <span className="text-xs text-slate-600 font-medium">hours before appointment (Default: 2h)</span>
                </div>
              </div>

              {/* Owner Notification Alert */}
              <div className="space-y-3 p-3.5 bg-purple-50/50 rounded-xl border border-purple-100">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-sm font-bold text-slate-900">Owner Booking Alerts</div>
                    <div className="text-xs text-slate-500">Receive WhatsApp notifications when a new booking occurs</div>
                  </div>
                  <input
                    type="checkbox"
                    checked={settings.ownerNotificationEnabled}
                    onChange={(e) => setSettings({ ...settings, ownerNotificationEnabled: e.target.checked })}
                    className="w-5 h-5 text-purple-600 rounded focus:ring-purple-500"
                  />
                </div>

                {settings.ownerNotificationEnabled && (
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Owner Notification WhatsApp Number
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. +91 98765 43210 (Leave blank for business default)"
                      value={settings.ownerNotificationPhone || ''}
                      onChange={(e) => setSettings({ ...settings, ownerNotificationPhone: e.target.value })}
                      className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 bg-white focus:ring-2 focus:ring-purple-500"
                    />
                  </div>
                )}
              </div>

              <div className="flex justify-end gap-3 pt-3 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setIsSettingsOpen(false)}
                  className="px-4 py-2 text-sm font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg"
                >
                  Close
                </button>
                <button
                  type="submit"
                  disabled={settingsLoading}
                  className="px-5 py-2 text-sm font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg shadow-sm disabled:opacity-50"
                >
                  {settingsLoading ? 'Saving...' : 'Save Settings'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Message Preview Modal */}
      {selectedNotif && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full border border-slate-200 shadow-2xl overflow-hidden animate-in fade-in zoom-in duration-150">
            <div className="p-4 border-b border-slate-200 flex justify-between items-center bg-slate-50">
              <div className="flex items-center gap-2">
                <span className="text-sm font-bold text-slate-900">WhatsApp Notification Preview</span>
              </div>
              <button
                onClick={() => setSelectedNotif(null)}
                className="text-slate-400 hover:text-slate-600 rounded-lg p-1"
              >
                ✕
              </button>
            </div>

            <div className="p-5 space-y-4">
              <div className="flex justify-between items-center text-xs">
                <span className="font-semibold text-slate-500">Recipient:</span>
                <span className="font-mono text-slate-800">{selectedNotif.recipientPhone}</span>
              </div>

              <div className="flex justify-between items-center text-xs">
                <span className="font-semibold text-slate-500">Status:</span>
                <span>{getStatusBadge(selectedNotif.status)}</span>
              </div>

              {/* Message Bubble Simulator */}
              <div className="bg-emerald-50/60 p-4 rounded-xl border border-emerald-100 text-slate-800 text-sm whitespace-pre-wrap font-sans shadow-2xs">
                {parseMessageText(selectedNotif.payload) ||
                  `⏰ Appointment Reminder\n\nHi ${selectedNotif.customer?.name || 'Customer'}!\n\nThis is a friendly reminder for your upcoming appointment with our salon.\n\nService: ${selectedNotif.appointment?.service?.name || 'Service'}\nStaff: ${selectedNotif.appointment?.staff?.name || 'Staff'}\nBooking reference: #${selectedNotif.appointmentId.slice(0, 8).toUpperCase()}\n\nSee you soon! 😊`}
              </div>

              {selectedNotif.providerMessageId && (
                <div className="text-[11px] text-slate-400 font-mono truncate">
                  Provider ID: {selectedNotif.providerMessageId}
                </div>
              )}
            </div>

            <div className="p-3 bg-slate-50 border-t border-slate-200 flex justify-end">
              <button
                onClick={() => setSelectedNotif(null)}
                className="px-4 py-1.5 text-xs font-semibold text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-100"
              >
                Close Preview
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
