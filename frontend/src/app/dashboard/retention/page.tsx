"use client";

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';

interface RetentionSettings {
  id?: string;
  businessId: string;
  rebookingFollowUpEnabled: boolean;
  rebookingFollowUpDays: number;
}

interface RetentionStats {
  total: number;
  pending: number;
  sent: number;
  skipped: number;
  failed: number;
}

interface CustomerFollowUp {
  id: string;
  businessId: string;
  customerId: string;
  sourceAppointmentId: string;
  type: string;
  scheduledAt: string;
  sentAt?: string | null;
  status: string;
  skipReason?: string | null;
  attempts: number;
  maxAttempts: number;
  lastError?: string | null;
  providerMessageId?: string | null;
  customer?: {
    id: string;
    name: string;
    phone: string;
    status: string;
  };
  sourceAppointment?: {
    id: string;
    startAt: string;
    status: string;
    service?: {
      name: string;
      price: number;
    };
    staff?: {
      name: string;
    };
  };
}

export default function RetentionPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [settingsLoading, setSettingsLoading] = useState(false);
  const [syncLoading, setSyncLoading] = useState(false);
  const [settings, setSettings] = useState<RetentionSettings>({
    businessId: '',
    rebookingFollowUpEnabled: true,
    rebookingFollowUpDays: 30,
  });
  const [stats, setStats] = useState<RetentionStats>({
    total: 0,
    pending: 0,
    sent: 0,
    skipped: 0,
    failed: 0,
  });
  const [followUps, setFollowUps] = useState<CustomerFollowUp[]>([]);
  const [totalItems, setTotalItems] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedItem, setSelectedItem] = useState<CustomerFollowUp | null>(null);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3500);
  };

  const getAuthToken = useCallback(() => {
    const token = localStorage.getItem('access_token');
    if (!token) {
      router.push('/login');
      return null;
    }
    return token;
  }, [router]);

  const fetchSettings = useCallback(async () => {
    const token = getAuthToken();
    if (!token) return;

    try {
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api/v1'}/retention/settings`,
        {
          headers: { Authorization: `Bearer ${token}` },
        }
      );
      if (res.ok) {
        const data = await res.json();
        setSettings(data);
      }
    } catch (err) {
      console.error('Failed to load retention settings', err);
    }
  }, [getAuthToken]);

  const fetchStats = useCallback(async () => {
    const token = getAuthToken();
    if (!token) return;

    try {
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api/v1'}/retention/stats`,
        {
          headers: { Authorization: `Bearer ${token}` },
        }
      );
      if (res.ok) {
        const data = await res.json();
        setStats(data);
      }
    } catch (err) {
      console.error('Failed to load retention stats', err);
    }
  }, [getAuthToken]);

  const fetchFollowUps = useCallback(async () => {
    const token = getAuthToken();
    if (!token) return;

    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.append('page', page.toString());
      params.append('limit', '15');
      if (statusFilter !== 'ALL') params.append('status', statusFilter);
      if (searchQuery.trim()) params.append('search', searchQuery.trim());

      const res = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api/v1'}/retention/follow-ups?${params.toString()}`,
        {
          headers: { Authorization: `Bearer ${token}` },
        }
      );

      if (res.ok) {
        const data = await res.json();
        setFollowUps(data.items || []);
        setTotalItems(data.total || 0);
        setTotalPages(data.totalPages || 1);
      }
    } catch (err) {
      console.error('Failed to load follow-up logs', err);
    } finally {
      setLoading(false);
    }
  }, [getAuthToken, page, statusFilter, searchQuery]);

  useEffect(() => {
    fetchSettings();
    fetchStats();
  }, [fetchSettings, fetchStats]);

  useEffect(() => {
    fetchFollowUps();
  }, [fetchFollowUps]);

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    const token = getAuthToken();
    if (!token) return;

    setSettingsLoading(true);
    try {
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api/v1'}/retention/settings`,
        {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            rebookingFollowUpEnabled: settings.rebookingFollowUpEnabled,
            rebookingFollowUpDays: Number(settings.rebookingFollowUpDays),
          }),
        }
      );

      if (res.ok) {
        const updated = await res.json();
        setSettings(updated);
        setShowSettingsModal(false);
        showToast('Retention settings updated successfully!');
        fetchStats();
        fetchFollowUps();
      } else {
        const err = await res.json();
        alert(err.message || 'Failed to update settings');
      }
    } catch (err) {
      console.error('Failed to save settings', err);
      alert('Error updating settings');
    } finally {
      setSettingsLoading(false);
    }
  };

  const handleSyncHistorical = async () => {
    const token = getAuthToken();
    if (!token) return;

    setSyncLoading(true);
    try {
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api/v1'}/retention/sync-historical`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
        }
      );

      if (res.ok) {
        const data = await res.json();
        showToast(`Synced ${data.synced || 0} historical completed appointment(s)!`);
        fetchStats();
        fetchFollowUps();
      } else {
        alert('Failed to sync historical appointments');
      }
    } catch (err) {
      console.error('Failed to sync historical appointments', err);
    } finally {
      setSyncLoading(false);
    }
  };

  const getStatusBadge = (status: string, skipReason?: string | null) => {
    switch (status) {
      case 'SENT':
        return <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-emerald-100 text-emerald-800">Sent</span>;
      case 'PENDING':
        return <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-800">Pending</span>;
      case 'PROCESSING':
        return <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">Processing</span>;
      case 'SKIPPED':
        return (
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-purple-100 text-purple-800" title={skipReason || 'Skipped'}>
            Skipped {skipReason === 'CUSTOMER_REBOOKED' ? '(Rebooked)' : ''}
          </span>
        );
      case 'FAILED':
        return <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800">Failed</span>;
      case 'CANCELLED':
        return <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-700">Cancelled</span>;
      default:
        return <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-800">{status}</span>;
    }
  };

  return (
    <div className="space-y-6">
      {/* Toast Notification */}
      {toastMessage && (
        <div className="fixed bottom-5 right-5 z-50 bg-slate-900 text-white px-4 py-3 rounded-lg shadow-lg text-sm flex items-center space-x-2 border border-slate-700 transition transform duration-200">
          <span>✅</span>
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Header & Actions */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Customer Retention & Rebooking</h1>
          <p className="text-sm text-slate-500 mt-1">
            Automated WhatsApp rebooking follow-ups for customers after previous completed visits.
          </p>
        </div>

        <div className="flex items-center space-x-3">
          <button
            onClick={handleSyncHistorical}
            disabled={syncLoading}
            className="inline-flex items-center px-3.5 py-2 border border-slate-300 text-xs font-medium rounded-lg text-slate-700 bg-white hover:bg-slate-50 shadow-xs transition"
          >
            {syncLoading ? 'Syncing...' : '🔄 Sync Historical'}
          </button>
          <button
            onClick={() => setShowSettingsModal(true)}
            className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-semibold rounded-lg text-white bg-indigo-600 hover:bg-indigo-700 shadow-sm transition"
          >
            ⚙️ Retention Settings
          </button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
          <span className="text-xs font-medium text-slate-500 block">Total Follow-ups</span>
          <span className="text-2xl font-bold text-slate-900 mt-1 block">{stats.total}</span>
        </div>
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
          <span className="text-xs font-medium text-amber-600 block">Scheduled / Pending</span>
          <span className="text-2xl font-bold text-amber-600 mt-1 block">{stats.pending}</span>
        </div>
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
          <span className="text-xs font-medium text-emerald-600 block">Delivered Messages</span>
          <span className="text-2xl font-bold text-emerald-600 mt-1 block">{stats.sent}</span>
        </div>
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
          <span className="text-xs font-medium text-purple-600 block">Skipped (Rebooked)</span>
          <span className="text-2xl font-bold text-purple-600 mt-1 block">{stats.skipped}</span>
        </div>
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
          <span className="text-xs font-medium text-red-600 block">Failed Delivery</span>
          <span className="text-2xl font-bold text-red-600 mt-1 block">{stats.failed}</span>
        </div>
      </div>

      {/* Status & Strategy Overview Card */}
      <div className="bg-linear-to-r from-indigo-50 to-blue-50 border border-indigo-100 rounded-xl p-5 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center space-x-2">
            <span className="font-semibold text-indigo-950 text-base">Rebooking Follow-Up Engine</span>
            <span
              className={`px-2 py-0.5 rounded text-xs font-bold ${
                settings.rebookingFollowUpEnabled
                  ? 'bg-emerald-100 text-emerald-800'
                  : 'bg-slate-200 text-slate-700'
              }`}
            >
              {settings.rebookingFollowUpEnabled ? 'ACTIVE' : 'DISABLED'}
            </span>
          </div>
          <p className="text-xs text-indigo-800 max-w-2xl">
            Automatically sends a WhatsApp invitation to rebook{' '}
            <strong className="font-bold">{settings.rebookingFollowUpDays} days</strong> after an appointment is completed. If the customer already booked another appointment in the meantime, the message is safely skipped to avoid spam.
          </p>
        </div>

        <button
          onClick={() => setShowSettingsModal(true)}
          className="text-xs font-semibold text-indigo-700 hover:text-indigo-900 bg-white px-3 py-1.5 rounded-md border border-indigo-200 shadow-xs"
        >
          Edit Delay ({settings.rebookingFollowUpDays} Days) →
        </button>
      </div>

      {/* Filter & Search Bar */}
      <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs flex flex-col sm:flex-row items-center justify-between gap-3">
        <div className="flex items-center space-x-2 w-full sm:w-auto">
          <div className="relative flex-1 sm:w-64">
            <input
              type="text"
              placeholder="Search customer, phone, ID..."
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setPage(1);
              }}
              className="w-full pl-9 pr-3 py-1.5 text-xs rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
            />
            <span className="absolute left-3 top-2 text-slate-400 text-xs">🔍</span>
          </div>

          <select
            value={statusFilter}
            onChange={(e) => {
              setStatusFilter(e.target.value);
              setPage(1);
            }}
            className="text-xs rounded-lg border border-slate-300 py-1.5 px-3 bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            <option value="ALL">All Statuses</option>
            <option value="PENDING">Pending</option>
            <option value="SENT">Sent</option>
            <option value="SKIPPED">Skipped</option>
            <option value="FAILED">Failed</option>
            <option value="CANCELLED">Cancelled</option>
          </select>
        </div>

        <div className="text-xs text-slate-500">
          Showing <strong>{followUps.length}</strong> of <strong>{totalItems}</strong> follow-ups
        </div>
      </div>

      {/* Follow-Ups Table */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200 text-left text-xs">
            <thead className="bg-slate-50 text-slate-600 font-semibold uppercase tracking-wider">
              <tr>
                <th className="py-3 px-4">Customer</th>
                <th className="py-3 px-4">Source Appointment</th>
                <th className="py-3 px-4">Scheduled Date</th>
                <th className="py-3 px-4">Status</th>
                <th className="py-3 px-4">Sent At / Details</th>
                <th className="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-slate-700">
              {loading ? (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-slate-400">
                    Loading retention follow-up history...
                  </td>
                </tr>
              ) : followUps.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-slate-400">
                    No retention follow-ups match the selected filters.
                  </td>
                </tr>
              ) : (
                followUps.map((item) => (
                  <tr key={item.id} className="hover:bg-slate-50 transition-colors">
                    <td className="py-3.5 px-4">
                      <div className="font-semibold text-slate-900">{item.customer?.name || 'Unknown'}</div>
                      <div className="text-[11px] text-slate-400">{item.customer?.phone || 'No phone'}</div>
                    </td>

                    <td className="py-3.5 px-4">
                      <div className="font-medium text-slate-800">
                        {item.sourceAppointment?.service?.name || 'Service Visit'}
                      </div>
                      <div className="text-[11px] text-slate-400">
                        Visit: {item.sourceAppointment?.startAt ? new Date(item.sourceAppointment.startAt).toLocaleDateString() : 'N/A'} • #{item.sourceAppointmentId.slice(0, 8).toUpperCase()}
                      </div>
                    </td>

                    <td className="py-3.5 px-4">
                      <div className="text-slate-800 font-medium">
                        {new Date(item.scheduledAt).toLocaleDateString()}
                      </div>
                      <div className="text-[11px] text-slate-400">
                        {new Date(item.scheduledAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </div>
                    </td>

                    <td className="py-3.5 px-4">
                      {getStatusBadge(item.status, item.skipReason)}
                    </td>

                    <td className="py-3.5 px-4">
                      {item.sentAt ? (
                        <div>
                          <span className="text-emerald-700 font-medium">{new Date(item.sentAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                          <span className="text-[11px] text-slate-400 block">{new Date(item.sentAt).toLocaleDateString()}</span>
                        </div>
                      ) : item.skipReason ? (
                        <div className="text-slate-500 text-[11px]">
                          Reason: <span className="font-medium text-purple-700">{item.skipReason}</span>
                        </div>
                      ) : item.lastError ? (
                        <div className="text-red-500 text-[11px] max-w-xs truncate" title={item.lastError}>
                          {item.lastError}
                        </div>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>

                    <td className="py-3.5 px-4 text-right">
                      <button
                        onClick={() => setSelectedItem(item)}
                        className="text-xs font-semibold text-indigo-600 hover:text-indigo-900 bg-indigo-50 hover:bg-indigo-100 px-2.5 py-1 rounded-md transition"
                      >
                        Preview
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="px-4 py-3 bg-slate-50 border-t border-slate-200 flex items-center justify-between">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="px-3 py-1 text-xs font-medium border border-slate-300 rounded-md bg-white disabled:opacity-50 hover:bg-slate-50"
            >
              Previous
            </button>
            <span className="text-xs text-slate-600">
              Page {page} of {totalPages}
            </span>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
              className="px-3 py-1 text-xs font-medium border border-slate-300 rounded-md bg-white disabled:opacity-50 hover:bg-slate-50"
            >
              Next
            </button>
          </div>
        )}
      </div>

      {/* Settings Modal */}
      {showSettingsModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-xs p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-slate-200">
            <h3 className="text-lg font-bold text-slate-900">Retention Follow-Up Settings</h3>
            <p className="text-xs text-slate-500 mt-1">
              Configure how long after an appointment completion to invite the customer back.
            </p>

            <form onSubmit={handleSaveSettings} className="mt-5 space-y-4">
              <div className="flex items-center justify-between p-3 rounded-xl bg-slate-50 border border-slate-200">
                <div>
                  <span className="text-sm font-semibold text-slate-800 block">Enable Follow-Ups</span>
                  <span className="text-xs text-slate-500">Automatically send rebooking prompts</span>
                </div>
                <input
                  type="checkbox"
                  checked={settings.rebookingFollowUpEnabled}
                  onChange={(e) =>
                    setSettings({ ...settings, rebookingFollowUpEnabled: e.target.checked })
                  }
                  className="h-5 w-5 text-indigo-600 rounded border-slate-300 focus:ring-indigo-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Follow-Up Delay (Days after completed visit)
                </label>
                <div className="flex gap-2 mb-2">
                  {[7, 14, 30, 60, 90].map((days) => (
                    <button
                      type="button"
                      key={days}
                      onClick={() => setSettings({ ...settings, rebookingFollowUpDays: days })}
                      className={`flex-1 py-1.5 text-xs font-medium rounded-lg border transition ${
                        settings.rebookingFollowUpDays === days
                          ? 'bg-indigo-600 text-white border-indigo-600'
                          : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                      }`}
                    >
                      {days}d
                    </button>
                  ))}
                </div>
                <input
                  type="number"
                  min="1"
                  max="365"
                  value={settings.rebookingFollowUpDays}
                  onChange={(e) =>
                    setSettings({ ...settings, rebookingFollowUpDays: Math.max(1, Number(e.target.value)) })
                  }
                  className="w-full text-xs px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              <div className="flex justify-end space-x-3 pt-3">
                <button
                  type="button"
                  onClick={() => setShowSettingsModal(false)}
                  className="px-4 py-2 border border-slate-300 text-xs font-semibold rounded-lg text-slate-700 hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={settingsLoading}
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold rounded-lg shadow-sm"
                >
                  {settingsLoading ? 'Saving...' : 'Save Settings'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Message Preview Modal */}
      {selectedItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-xs p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-2xl border border-slate-200 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div>
                <h3 className="text-base font-bold text-slate-900">Follow-Up Message Preview</h3>
                <span className="text-xs text-slate-500">Recipient: {selectedItem.customer?.name} ({selectedItem.customer?.phone})</span>
              </div>
              <button
                onClick={() => setSelectedItem(null)}
                className="text-slate-400 hover:text-slate-600 text-sm font-bold"
              >
                ✕
              </button>
            </div>

            {/* WhatsApp Chat Bubble Mock */}
            <div className="bg-[#EFEAE2] p-4 rounded-xl border border-slate-300 space-y-2 font-sans">
              <div className="max-w-xs bg-white text-slate-900 p-3.5 rounded-lg rounded-tl-none shadow-xs text-xs whitespace-pre-wrap leading-relaxed">
                {`Hi ${selectedItem.customer?.name || 'there'} 👋\n\nIt's been a while since your last appointment at our salon.\n\nWould you like to book another appointment?\n\nReply BOOK to get started.`}
                <div className="text-[10px] text-slate-400 text-right mt-1">
                  {selectedItem.sentAt ? new Date(selectedItem.sentAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Scheduled'}
                </div>
              </div>
            </div>

            {/* Details Grid */}
            <div className="bg-slate-50 p-3.5 rounded-xl border border-slate-200 text-xs space-y-1.5">
              <div className="flex justify-between">
                <span className="text-slate-500">Status:</span>
                <span className="font-semibold">{selectedItem.status}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Scheduled At:</span>
                <span className="font-medium text-slate-800">{new Date(selectedItem.scheduledAt).toLocaleString()}</span>
              </div>
              {selectedItem.sentAt && (
                <div className="flex justify-between">
                  <span className="text-slate-500">Sent At:</span>
                  <span className="font-medium text-slate-800">{new Date(selectedItem.sentAt).toLocaleString()}</span>
                </div>
              )}
              {selectedItem.skipReason && (
                <div className="flex justify-between">
                  <span className="text-slate-500">Skip Reason:</span>
                  <span className="font-medium text-purple-700">{selectedItem.skipReason}</span>
                </div>
              )}
              {selectedItem.providerMessageId && (
                <div className="flex justify-between">
                  <span className="text-slate-500">WhatsApp Message ID:</span>
                  <span className="font-mono text-[10px] text-slate-700">{selectedItem.providerMessageId}</span>
                </div>
              )}
              {selectedItem.lastError && (
                <div className="flex justify-between">
                  <span className="text-slate-500">Last Error:</span>
                  <span className="font-medium text-red-600">{selectedItem.lastError}</span>
                </div>
              )}
            </div>

            <div className="flex justify-end pt-2">
              <button
                onClick={() => setSelectedItem(null)}
                className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold rounded-lg"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
