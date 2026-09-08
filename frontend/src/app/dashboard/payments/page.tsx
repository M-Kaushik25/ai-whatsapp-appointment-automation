"use client";

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';

interface PaymentSettings {
  id?: string;
  businessId: string;
  paymentEnabled: boolean;
  paymentMode: string;
  depositAmount: number;
  depositPercentage: number;
  currency: string;
  paymentExpiryMinutes: number;
  autoCancelUnpaidAppointments: boolean;
  provider: string;
  keyId?: string | null;
  keySecret?: string | null;
  webhookSecret?: string | null;
}

interface PaymentStats {
  total: number;
  paid: number;
  pending: number;
  failed: number;
  expired: number;
  refunded: number;
  totalRevenue: number;
}

interface PaymentItem {
  id: string;
  businessId: string;
  appointmentId: string;
  customerId: string;
  amount: number;
  currency: string;
  type: string;
  status: string;
  provider: string;
  providerOrderId?: string | null;
  providerPaymentId?: string | null;
  paymentLink?: string | null;
  failureReason?: string | null;
  expiresAt?: string | null;
  paidAt?: string | null;
  createdAt: string;
  customer?: {
    id: string;
    name: string;
    phone: string;
  };
  appointment?: {
    id: string;
    startAt: string;
    price: number;
    paymentStatus: string;
    service?: {
      name: string;
    };
    staff?: {
      name: string;
    };
  };
}

export default function PaymentsPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [settingsLoading, setSettingsLoading] = useState(false);
  const [refundLoading, setRefundLoading] = useState(false);
  const [settings, setSettings] = useState<PaymentSettings>({
    businessId: '',
    paymentEnabled: false,
    paymentMode: 'NONE',
    depositAmount: 200,
    depositPercentage: 20,
    currency: 'INR',
    paymentExpiryMinutes: 30,
    autoCancelUnpaidAppointments: false,
    provider: 'MOCK',
    keyId: '',
    keySecret: '',
    webhookSecret: '',
  });

  const [stats, setStats] = useState<PaymentStats>({
    total: 0,
    paid: 0,
    pending: 0,
    failed: 0,
    expired: 0,
    refunded: 0,
    totalRevenue: 0,
  });

  const [payments, setPayments] = useState<PaymentItem[]>([]);
  const [totalItems, setTotalItems] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [searchQuery, setSearchQuery] = useState('');

  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [selectedPayment, setSelectedPayment] = useState<PaymentItem | null>(null);
  const [showRefundModal, setShowRefundModal] = useState<PaymentItem | null>(null);
  const [refundAmount, setRefundAmount] = useState<number>(0);
  const [refundReason, setRefundReason] = useState<string>('');
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
        `${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api/v1'}/payments/settings`,
        {
          headers: { Authorization: `Bearer ${token}` },
        }
      );
      if (res.ok) {
        const data = await res.json();
        setSettings(data);
      }
    } catch (err) {
      console.error('Failed to load payment settings', err);
    }
  }, [getAuthToken]);

  const fetchStats = useCallback(async () => {
    const token = getAuthToken();
    if (!token) return;

    try {
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api/v1'}/payments/stats`,
        {
          headers: { Authorization: `Bearer ${token}` },
        }
      );
      if (res.ok) {
        const data = await res.json();
        setStats(data);
      }
    } catch (err) {
      console.error('Failed to load payment stats', err);
    }
  }, [getAuthToken]);

  const fetchPayments = useCallback(async () => {
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
        `${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api/v1'}/payments?${params.toString()}`,
        {
          headers: { Authorization: `Bearer ${token}` },
        }
      );

      if (res.ok) {
        const data = await res.json();
        setPayments(data.items || []);
        setTotalItems(data.total || 0);
        setTotalPages(data.totalPages || 1);
      }
    } catch (err) {
      console.error('Failed to load payments', err);
    } finally {
      setLoading(false);
    }
  }, [getAuthToken, page, statusFilter, searchQuery]);

  useEffect(() => {
    fetchSettings();
    fetchStats();
  }, [fetchSettings, fetchStats]);

  useEffect(() => {
    fetchPayments();
  }, [fetchPayments]);

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    const token = getAuthToken();
    if (!token) return;

    setSettingsLoading(true);
    try {
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api/v1'}/payments/settings`,
        {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            paymentEnabled: settings.paymentEnabled,
            paymentMode: settings.paymentMode,
            depositAmount: Number(settings.depositAmount),
            depositPercentage: Number(settings.depositPercentage),
            currency: settings.currency,
            paymentExpiryMinutes: Number(settings.paymentExpiryMinutes),
            autoCancelUnpaidAppointments: settings.autoCancelUnpaidAppointments,
            provider: settings.provider,
            ...(settings.keyId && { keyId: settings.keyId }),
            ...(settings.keySecret && !settings.keySecret.startsWith('••••') && { keySecret: settings.keySecret }),
            ...(settings.webhookSecret && !settings.webhookSecret.startsWith('••••') && { webhookSecret: settings.webhookSecret }),
          }),
        }
      );

      if (res.ok) {
        const updated = await res.json();
        setSettings(updated);
        setShowSettingsModal(false);
        showToast('Payment settings saved successfully!');
        fetchStats();
      } else {
        const err = await res.json();
        alert(err.message || 'Failed to save settings');
      }
    } catch (err) {
      console.error('Failed to save settings', err);
      alert('Error updating payment settings');
    } finally {
      setSettingsLoading(false);
    }
  };

  const handleRefund = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!showRefundModal) return;
    const token = getAuthToken();
    if (!token) return;

    setRefundLoading(true);
    try {
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api/v1'}/payments/${showRefundModal.id}/refund`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            amount: Number(refundAmount),
            reason: refundReason,
          }),
        }
      );

      if (res.ok) {
        showToast('Refund processed successfully!');
        setShowRefundModal(null);
        fetchStats();
        fetchPayments();
      } else {
        const err = await res.json();
        alert(err.message || 'Refund failed');
      }
    } catch (err) {
      console.error('Refund failed', err);
      alert('Error processing refund');
    } finally {
      setRefundLoading(false);
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    showToast('Payment link copied to clipboard!');
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'PAID':
        return <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-800">Paid</span>;
      case 'INITIATED':
        return <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-blue-100 text-blue-800">Initiated</span>;
      case 'PENDING':
        return <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-100 text-amber-800">Pending</span>;
      case 'EXPIRED':
        return <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-slate-100 text-slate-700">Expired</span>;
      case 'FAILED':
        return <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-red-100 text-red-800">Failed</span>;
      case 'CANCELLED':
        return <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-slate-200 text-slate-700">Cancelled</span>;
      case 'REFUNDED':
        return <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-purple-100 text-purple-800">Refunded</span>;
      default:
        return <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-slate-100 text-slate-800">{status}</span>;
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

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Appointment Payments & Deposits</h1>
          <p className="text-sm text-slate-500 mt-1">
            Collect deposits or full payments seamlessly via WhatsApp booking and track transactions.
          </p>
        </div>

        <button
          onClick={() => setShowSettingsModal(true)}
          className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-semibold rounded-lg text-white bg-indigo-600 hover:bg-indigo-700 shadow-sm transition"
        >
          ⚙️ Payment Settings
        </button>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
          <span className="text-xs font-medium text-slate-500 block">Total Revenue</span>
          <span className="text-2xl font-bold text-slate-900 mt-1 block">₹{stats.totalRevenue.toLocaleString()}</span>
        </div>
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
          <span className="text-xs font-medium text-emerald-600 block">Completed / Paid</span>
          <span className="text-2xl font-bold text-emerald-600 mt-1 block">{stats.paid}</span>
        </div>
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
          <span className="text-xs font-medium text-blue-600 block">Pending / Initiated</span>
          <span className="text-2xl font-bold text-blue-600 mt-1 block">{stats.pending}</span>
        </div>
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
          <span className="text-xs font-medium text-purple-600 block">Refunded</span>
          <span className="text-2xl font-bold text-purple-600 mt-1 block">{stats.refunded}</span>
        </div>
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
          <span className="text-xs font-medium text-red-600 block">Failed / Expired</span>
          <span className="text-2xl font-bold text-red-600 mt-1 block">{stats.failed + stats.expired}</span>
        </div>
      </div>

      {/* Policy Banner */}
      <div className="bg-linear-to-r from-emerald-50 to-teal-50 border border-emerald-100 rounded-xl p-5 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center space-x-2">
            <span className="font-semibold text-emerald-950 text-base">Active Payment Policy:</span>
            <span
              className={`px-2.5 py-0.5 rounded text-xs font-bold ${
                settings.paymentEnabled
                  ? 'bg-emerald-200 text-emerald-900'
                  : 'bg-slate-200 text-slate-700'
              }`}
            >
              {settings.paymentEnabled ? settings.paymentMode : 'PAYMENTS DISABLED'}
            </span>
            <span className="text-xs text-emerald-800 font-medium">({settings.provider} Gateway)</span>
          </div>
          <p className="text-xs text-emerald-800 max-w-2xl">
            {settings.paymentMode === 'NONE' || !settings.paymentEnabled
              ? 'Appointments are booked without advance payment obligations.'
              : settings.paymentMode === 'FIXED_DEPOSIT'
              ? `Requires a fixed deposit of ₹${settings.depositAmount} to confirm the appointment.`
              : settings.paymentMode === 'PERCENTAGE_DEPOSIT'
              ? `Requires a ${settings.depositPercentage}% deposit based on service price.`
              : 'Requires 100% full payment in advance to secure the appointment.'}
          </p>
        </div>

        <button
          onClick={() => setShowSettingsModal(true)}
          className="text-xs font-semibold text-emerald-800 hover:text-emerald-900 bg-white px-3 py-1.5 rounded-md border border-emerald-200 shadow-xs"
        >
          Configure Policy →
        </button>
      </div>

      {/* Filters & Search */}
      <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs flex flex-col sm:flex-row items-center justify-between gap-3">
        <div className="flex items-center space-x-2 w-full sm:w-auto">
          <div className="relative flex-1 sm:w-64">
            <input
              type="text"
              placeholder="Search customer, phone, order ID..."
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setPage(1);
              }}
              className="w-full pl-9 pr-3 py-1.5 text-xs rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-indigo-500"
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
            <option value="PAID">Paid</option>
            <option value="INITIATED">Initiated</option>
            <option value="PENDING">Pending</option>
            <option value="EXPIRED">Expired</option>
            <option value="FAILED">Failed</option>
            <option value="REFUNDED">Refunded</option>
            <option value="CANCELLED">Cancelled</option>
          </select>
        </div>

        <div className="text-xs text-slate-500">
          Showing <strong>{payments.length}</strong> of <strong>{totalItems}</strong> payment records
        </div>
      </div>

      {/* Payments Table */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200 text-left text-xs">
            <thead className="bg-slate-50 text-slate-600 font-semibold uppercase tracking-wider">
              <tr>
                <th className="py-3 px-4">Customer</th>
                <th className="py-3 px-4">Appointment / Service</th>
                <th className="py-3 px-4">Amount</th>
                <th className="py-3 px-4">Status</th>
                <th className="py-3 px-4">Order / Gateway Ref</th>
                <th className="py-3 px-4">Created / Paid</th>
                <th className="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-slate-700">
              {loading ? (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-slate-400">
                    Loading payment transactions...
                  </td>
                </tr>
              ) : payments.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-slate-400">
                    No payment records match the selected filters.
                  </td>
                </tr>
              ) : (
                payments.map((p) => (
                  <tr key={p.id} className="hover:bg-slate-50 transition-colors">
                    <td className="py-3.5 px-4">
                      <div className="font-semibold text-slate-900">{p.customer?.name || 'Customer'}</div>
                      <div className="text-[11px] text-slate-400">{p.customer?.phone || '—'}</div>
                    </td>

                    <td className="py-3.5 px-4">
                      <div className="font-medium text-slate-800">{p.appointment?.service?.name || 'Service'}</div>
                      <div className="text-[11px] text-slate-400">
                        Appt: #{p.appointmentId.slice(0, 8).toUpperCase()} • Price: ₹{p.appointment?.price || p.amount}
                      </div>
                    </td>

                    <td className="py-3.5 px-4">
                      <div className="font-bold text-slate-900 text-sm">₹{p.amount}</div>
                      <div className="text-[10px] text-slate-400 uppercase">{p.type}</div>
                    </td>

                    <td className="py-3.5 px-4">
                      {getStatusBadge(p.status)}
                    </td>

                    <td className="py-3.5 px-4">
                      <div className="font-mono text-[11px] text-slate-700">{p.providerOrderId || '—'}</div>
                      <div className="text-[10px] text-slate-400">{p.provider}</div>
                    </td>

                    <td className="py-3.5 px-4">
                      <div className="text-slate-800 font-medium">
                        {new Date(p.createdAt).toLocaleDateString()}
                      </div>
                      <div className="text-[11px] text-slate-400">
                        {p.paidAt ? `Paid: ${new Date(p.paidAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : 'Unpaid'}
                      </div>
                    </td>

                    <td className="py-3.5 px-4 text-right space-x-2">
                      {p.paymentLink && p.status === 'INITIATED' && (
                        <button
                          onClick={() => copyToClipboard(p.paymentLink!)}
                          className="text-xs font-semibold text-blue-600 hover:text-blue-900 bg-blue-50 hover:bg-blue-100 px-2 py-1 rounded-md transition"
                        >
                          Copy Link
                        </button>
                      )}
                      {p.status === 'PAID' && (
                        <button
                          onClick={() => {
                            setShowRefundModal(p);
                            setRefundAmount(p.amount);
                            setRefundReason('');
                          }}
                          className="text-xs font-semibold text-purple-600 hover:text-purple-900 bg-purple-50 hover:bg-purple-100 px-2 py-1 rounded-md transition"
                        >
                          Refund
                        </button>
                      )}
                      <button
                        onClick={() => setSelectedPayment(p)}
                        className="text-xs font-semibold text-indigo-600 hover:text-indigo-900 bg-indigo-50 hover:bg-indigo-100 px-2.5 py-1 rounded-md transition"
                      >
                        Details
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

      {/* Payment Settings Modal */}
      {showSettingsModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-xs p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-2xl border border-slate-200 max-h-[90vh] overflow-y-auto">
            <h3 className="text-lg font-bold text-slate-900">Payment & Deposit Settings</h3>
            <p className="text-xs text-slate-500 mt-1">
              Configure advance payment requirements and gateway credentials.
            </p>

            <form onSubmit={handleSaveSettings} className="mt-5 space-y-4">
              <div className="flex items-center justify-between p-3 rounded-xl bg-slate-50 border border-slate-200">
                <div>
                  <span className="text-sm font-semibold text-slate-800 block">Enable Advance Payments</span>
                  <span className="text-xs text-slate-500">Require payments before appointments</span>
                </div>
                <input
                  type="checkbox"
                  checked={settings.paymentEnabled}
                  onChange={(e) => setSettings({ ...settings, paymentEnabled: e.target.checked })}
                  className="h-5 w-5 text-indigo-600 rounded border-slate-300 focus:ring-indigo-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Payment Mode</label>
                <select
                  value={settings.paymentMode}
                  onChange={(e) => setSettings({ ...settings, paymentMode: e.target.value })}
                  className="w-full text-xs rounded-lg border border-slate-300 py-2 px-3 bg-white text-slate-700 focus:ring-2 focus:ring-indigo-500"
                >
                  <option value="NONE">None (No advance payment)</option>
                  <option value="FIXED_DEPOSIT">Fixed Deposit (Fixed amount)</option>
                  <option value="PERCENTAGE_DEPOSIT">Percentage Deposit (% of service price)</option>
                  <option value="FULL_PAYMENT">Full Payment (100% upfront)</option>
                </select>
              </div>

              {settings.paymentMode === 'FIXED_DEPOSIT' && (
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Fixed Deposit Amount (₹)</label>
                  <input
                    type="number"
                    min="1"
                    value={settings.depositAmount}
                    onChange={(e) => setSettings({ ...settings, depositAmount: Number(e.target.value) })}
                    className="w-full text-xs px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
              )}

              {settings.paymentMode === 'PERCENTAGE_DEPOSIT' && (
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Deposit Percentage (%)</label>
                  <input
                    type="number"
                    min="1"
                    max="100"
                    value={settings.depositPercentage}
                    onChange={(e) => setSettings({ ...settings, depositPercentage: Number(e.target.value) })}
                    className="w-full text-xs px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Payment Expiry (Minutes)</label>
                  <input
                    type="number"
                    min="5"
                    value={settings.paymentExpiryMinutes}
                    onChange={(e) => setSettings({ ...settings, paymentExpiryMinutes: Number(e.target.value) })}
                    className="w-full text-xs px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Gateway Provider</label>
                  <select
                    value={settings.provider}
                    onChange={(e) => setSettings({ ...settings, provider: e.target.value })}
                    className="w-full text-xs rounded-lg border border-slate-300 py-2 px-3 bg-white text-slate-700 focus:ring-2 focus:ring-indigo-500"
                  >
                    <option value="MOCK">Mock Provider (Test/Simulation)</option>
                    <option value="RAZORPAY">Razorpay (India Gateway)</option>
                  </select>
                </div>
              </div>

              {settings.provider === 'RAZORPAY' && (
                <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl space-y-3">
                  <span className="text-xs font-bold text-slate-800 block">Razorpay API Credentials</span>
                  <div>
                    <label className="block text-[11px] font-medium text-slate-600 mb-1">Key ID</label>
                    <input
                      type="text"
                      placeholder="rzp_live_..."
                      value={settings.keyId || ''}
                      onChange={(e) => setSettings({ ...settings, keyId: e.target.value })}
                      className="w-full text-xs px-3 py-1.5 border border-slate-300 rounded-lg"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-medium text-slate-600 mb-1">Key Secret</label>
                    <input
                      type="password"
                      placeholder={settings.keySecret || 'Secret key'}
                      value={settings.keySecret || ''}
                      onChange={(e) => setSettings({ ...settings, keySecret: e.target.value })}
                      className="w-full text-xs px-3 py-1.5 border border-slate-300 rounded-lg"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-medium text-slate-600 mb-1">Webhook Secret</label>
                    <input
                      type="password"
                      placeholder={settings.webhookSecret || 'Webhook secret'}
                      value={settings.webhookSecret || ''}
                      onChange={(e) => setSettings({ ...settings, webhookSecret: e.target.value })}
                      className="w-full text-xs px-3 py-1.5 border border-slate-300 rounded-lg"
                    />
                  </div>
                </div>
              )}

              <div className="flex items-center space-x-2 pt-1">
                <input
                  type="checkbox"
                  id="autoCancel"
                  checked={settings.autoCancelUnpaidAppointments}
                  onChange={(e) => setSettings({ ...settings, autoCancelUnpaidAppointments: e.target.checked })}
                  className="h-4 w-4 text-indigo-600 rounded border-slate-300 focus:ring-indigo-500"
                />
                <label htmlFor="autoCancel" className="text-xs text-slate-700">
                  Auto-cancel appointment if payment expires without completion
                </label>
              </div>

              <div className="flex justify-end space-x-3 pt-3 border-t border-slate-100">
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

      {/* Details Modal */}
      {selectedPayment && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-xs p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-slate-200 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="text-base font-bold text-slate-900">Payment Details</h3>
              <button
                onClick={() => setSelectedPayment(null)}
                className="text-slate-400 hover:text-slate-600 text-sm font-bold"
              >
                ✕
              </button>
            </div>

            <div className="bg-slate-50 p-3.5 rounded-xl border border-slate-200 text-xs space-y-2">
              <div className="flex justify-between">
                <span className="text-slate-500">Transaction ID:</span>
                <span className="font-mono text-slate-800">{selectedPayment.id}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Amount:</span>
                <span className="font-bold text-slate-900">₹{selectedPayment.amount} {selectedPayment.currency}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Status:</span>
                <span>{getStatusBadge(selectedPayment.status)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Payment Type:</span>
                <span className="font-semibold">{selectedPayment.type}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Customer:</span>
                <span className="font-medium text-slate-800">{selectedPayment.customer?.name} ({selectedPayment.customer?.phone})</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Service:</span>
                <span className="font-medium text-slate-800">{selectedPayment.appointment?.service?.name}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Provider Order ID:</span>
                <span className="font-mono text-slate-800">{selectedPayment.providerOrderId || '—'}</span>
              </div>
              {selectedPayment.providerPaymentId && (
                <div className="flex justify-between">
                  <span className="text-slate-500">Provider Payment ID:</span>
                  <span className="font-mono text-slate-800">{selectedPayment.providerPaymentId}</span>
                </div>
              )}
              {selectedPayment.paymentLink && (
                <div className="pt-2 border-t border-slate-200">
                  <span className="text-slate-500 block mb-1">Payment Link:</span>
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      readOnly
                      value={selectedPayment.paymentLink}
                      className="w-full text-[11px] bg-white border border-slate-300 rounded px-2 py-1 truncate"
                    />
                    <button
                      onClick={() => copyToClipboard(selectedPayment.paymentLink!)}
                      className="px-2 py-1 text-xs bg-indigo-50 text-indigo-600 rounded font-semibold whitespace-nowrap"
                    >
                      Copy
                    </button>
                  </div>
                </div>
              )}
            </div>

            <div className="flex justify-end pt-2">
              <button
                onClick={() => setSelectedPayment(null)}
                className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold rounded-lg"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Refund Modal */}
      {showRefundModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-xs p-4">
          <div className="bg-white rounded-2xl max-w-sm w-full p-6 shadow-2xl border border-slate-200">
            <h3 className="text-base font-bold text-slate-900">Process Refund</h3>
            <p className="text-xs text-slate-500 mt-1">
              Issue a full or partial refund back to the customer.
            </p>

            <form onSubmit={handleRefund} className="mt-4 space-y-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Refund Amount (Max: ₹{showRefundModal.amount})
                </label>
                <input
                  type="number"
                  min="1"
                  max={showRefundModal.amount}
                  value={refundAmount}
                  onChange={(e) => setRefundAmount(Number(e.target.value))}
                  className="w-full text-xs px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Reason for Refund</label>
                <input
                  type="text"
                  placeholder="e.g. Customer cancelled appointment"
                  value={refundReason}
                  onChange={(e) => setRefundReason(e.target.value)}
                  className="w-full text-xs px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              <div className="flex justify-end space-x-3 pt-3">
                <button
                  type="button"
                  onClick={() => setShowRefundModal(null)}
                  className="px-4 py-2 border border-slate-300 text-xs font-semibold rounded-lg text-slate-700 hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={refundLoading}
                  className="px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white text-xs font-semibold rounded-lg shadow-sm"
                >
                  {refundLoading ? 'Processing...' : 'Confirm Refund'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
