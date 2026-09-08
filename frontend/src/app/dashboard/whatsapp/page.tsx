"use client";

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

interface WhatsAppConfig {
  configured: boolean;
  status: 'CONNECTED' | 'DISCONNECTED' | 'ERROR';
  webhookVerified: boolean;
  phoneNumberId: string | null;
  businessAccountId: string | null;
  displayPhoneNumber: string | null;
  hasAccessToken: boolean;
  maskedAccessToken: string | null;
  hasAppSecret: boolean;
  maskedAppSecret: string | null;
  verifyToken: string | null;
  lastError: string | null;
  updatedAt?: string;
}

interface WhatsAppMessageItem {
  id: string;
  whatsappMessageId: string;
  direction: 'INBOUND' | 'OUTBOUND';
  messageType: string;
  text: string | null;
  status: string;
  timestamp: string;
  customer?: {
    id: string;
    name: string;
    phone: string;
  };
}

interface ConversationSession {
  id: string;
  phoneNumber: string;
  state: string;
  serviceName: string | null;
  staffName: string | null;
  selectedDate: string | null;
  selectedSlot: string | null;
  appointmentId: string | null;
  expiresAt: string;
  updatedAt: string;
  customer?: {
    id: string;
    name: string;
    phone: string;
  };
}

export default function WhatsAppManagementPage() {
  const router = useRouter();

  const [activeTab, setActiveTab] = useState<'CONFIG' | 'LOGS' | 'CONVERSATIONS'>('CONFIG');

  const [config, setConfig] = useState<WhatsAppConfig | null>(null);
  const [loadingConfig, setLoadingConfig] = useState(true);
  const [messages, setMessages] = useState<WhatsAppMessageItem[]>([]);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [conversations, setConversations] = useState<ConversationSession[]>([]);
  const [loadingConversations, setLoadingConversations] = useState(false);

  const [totalMessages, setTotalMessages] = useState(0);
  const [page, setPage] = useState(1);
  const [directionFilter, setDirectionFilter] = useState('ALL');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [searchQuery, setSearchQuery] = useState('');

  // Form State
  const [phoneNumberId, setPhoneNumberId] = useState('');
  const [businessAccountId, setBusinessAccountId] = useState('');
  const [displayPhoneNumber, setDisplayPhoneNumber] = useState('');
  const [accessToken, setAccessToken] = useState('');
  const [appSecret, setAppSecret] = useState('');
  const [verifyToken, setVerifyToken] = useState('');

  // Action states
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [sendingTest, setSendingTest] = useState(false);
  const [testRecipient, setTestRecipient] = useState('');
  const [testMessageText, setTestMessageText] = useState('Hello! This is a test message from your WhatsApp Business system.');
  const [showSendModal, setShowSendModal] = useState(false);

  // Status Alerts
  const [successMsg, setSuccessMsg] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  const loadConfig = useCallback(async () => {
    const token = localStorage.getItem('access_token');
    if (!token) {
      router.push('/login');
      return;
    }

    try {
      setLoadingConfig(true);
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api/v1';
      const res = await fetch(`${apiUrl}/whatsapp/config`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!res.ok) throw new Error('Failed to load WhatsApp configuration');
      const data: WhatsAppConfig = await res.json();
      setConfig(data);

      if (data.configured) {
        setPhoneNumberId(data.phoneNumberId || '');
        setBusinessAccountId(data.businessAccountId || '');
        setDisplayPhoneNumber(data.displayPhoneNumber || '');
        setVerifyToken(data.verifyToken || '');
        setAccessToken(data.maskedAccessToken || '');
        setAppSecret(data.maskedAppSecret || '');
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error fetching config';
      setErrorMsg(msg);
    } finally {
      setLoadingConfig(false);
    }
  }, [router]);

  const loadMessages = useCallback(async () => {
    const token = localStorage.getItem('access_token');
    if (!token) return;

    try {
      setLoadingMessages(true);
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api/v1';
      const params = new URLSearchParams({
        page: page.toString(),
        limit: '15',
      });
      if (directionFilter !== 'ALL') params.append('direction', directionFilter);
      if (statusFilter !== 'ALL') params.append('status', statusFilter);
      if (searchQuery.trim()) params.append('search', searchQuery.trim());

      const res = await fetch(`${apiUrl}/whatsapp/messages?${params.toString()}`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!res.ok) throw new Error('Failed to load WhatsApp messages');
      const data = await res.json();
      setMessages(data.data || []);
      setTotalMessages(data.total || 0);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error fetching messages';
      setErrorMsg(msg);
    } finally {
      setLoadingMessages(false);
    }
  }, [page, directionFilter, statusFilter, searchQuery]);

  const loadConversations = useCallback(async () => {
    const token = localStorage.getItem('access_token');
    if (!token) return;

    try {
      setLoadingConversations(true);
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api/v1';
      const res = await fetch(`${apiUrl}/whatsapp/conversations`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!res.ok) throw new Error('Failed to load booking conversations');
      const data = await res.json();
      setConversations(data || []);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error fetching conversations';
      setErrorMsg(msg);
    } finally {
      setLoadingConversations(false);
    }
  }, []);

  useEffect(() => {
    loadConfig();
  }, [loadConfig]);

  useEffect(() => {
    if (activeTab === 'LOGS') {
      loadMessages();
    } else if (activeTab === 'CONVERSATIONS') {
      loadConversations();
    }
  }, [activeTab, loadMessages, loadConversations]);

  const handleSaveConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    const token = localStorage.getItem('access_token');
    if (!token) return;

    try {
      setSaving(true);
      setErrorMsg('');
      setSuccessMsg('');
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api/v1';

      const payload: any = {
        phoneNumberId: phoneNumberId.trim() || undefined,
        businessAccountId: businessAccountId.trim() || undefined,
        displayPhoneNumber: displayPhoneNumber.trim() || undefined,
        verifyToken: verifyToken.trim() || undefined,
      };

      if (accessToken && !accessToken.includes('••••')) {
        payload.accessToken = accessToken.trim();
      }
      if (appSecret && !appSecret.includes('••••')) {
        payload.appSecret = appSecret.trim();
      }

      const res = await fetch(`${apiUrl}/whatsapp/config`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || 'Failed to save configuration');
      }

      setSuccessMsg('✓ WhatsApp configuration saved successfully!');
      loadConfig();
      setTimeout(() => setSuccessMsg(''), 4000);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Save failed';
      setErrorMsg(msg);
      setTimeout(() => setErrorMsg(''), 5000);
    } finally {
      setSaving(false);
    }
  };

  const handleTestConnection = async () => {
    const token = localStorage.getItem('access_token');
    if (!token) return;

    try {
      setTesting(true);
      setErrorMsg('');
      setSuccessMsg('');
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api/v1';

      const res = await fetch(`${apiUrl}/whatsapp/test-connection`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || data.message || 'Connection test failed');
      }

      setSuccessMsg(`✓ Connected to Meta Cloud API! Verified: ${data.displayPhoneNumber || 'Active'}`);
      loadConfig();
      setTimeout(() => setSuccessMsg(''), 5000);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Connection test failed';
      setErrorMsg(msg);
      loadConfig();
      setTimeout(() => setErrorMsg(''), 6000);
    } finally {
      setTesting(false);
    }
  };

  const handleSendTestMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    const token = localStorage.getItem('access_token');
    if (!token || !testRecipient.trim()) return;

    try {
      setSendingTest(true);
      setErrorMsg('');
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api/v1';

      const res = await fetch(`${apiUrl}/whatsapp/send`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          recipientPhone: testRecipient.trim(),
          text: testMessageText.trim(),
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || 'Failed to send message');
      }

      setSuccessMsg(`✓ Message sent successfully to ${testRecipient}!`);
      setShowSendModal(false);
      setTestRecipient('');
      if (activeTab === 'LOGS') loadMessages();
      setTimeout(() => setSuccessMsg(''), 5000);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to send test message';
      setErrorMsg(msg);
      setTimeout(() => setErrorMsg(''), 6000);
    } finally {
      setSendingTest(false);
    }
  };

  const currentOrigin = typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3000';
  const webhookCallbackUrl = `${currentOrigin.replace(':3000', ':3001')}/api/v1/whatsapp/webhook`;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-extrabold text-slate-900 tracking-tight">WhatsApp Business Automation</h1>
          <p className="text-xs text-slate-500 mt-1">
            Meta Cloud API credentials, automated booking conversation engine, and live session monitoring.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setShowSendModal(true)}
            className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-xl shadow-xs transition flex items-center gap-1.5"
          >
            <span>💬</span> Send Message
          </button>
          <button
            onClick={handleTestConnection}
            disabled={testing || !config?.phoneNumberId}
            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-xs font-bold rounded-xl shadow-xs transition"
          >
            {testing ? 'Testing...' : 'Test Connection'}
          </button>
        </div>
      </div>

      {/* Alerts */}
      {successMsg && (
        <div className="p-3 bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs rounded-xl flex justify-between font-semibold">
          <span>{successMsg}</span>
          <button onClick={() => setSuccessMsg('')} className="font-bold">×</button>
        </div>
      )}
      {errorMsg && (
        <div className="p-3 bg-rose-50 border border-rose-200 text-rose-800 text-xs rounded-xl flex justify-between font-semibold">
          <span>{errorMsg}</span>
          <button onClick={() => setErrorMsg('')} className="font-bold">×</button>
        </div>
      )}

      {/* Navigation Tabs */}
      <div className="flex items-center border-b border-slate-200 gap-6 text-xs font-bold text-slate-600">
        <button
          onClick={() => setActiveTab('CONFIG')}
          className={`pb-3 transition relative flex items-center gap-1.5 ${
            activeTab === 'CONFIG' ? 'text-indigo-600 font-extrabold border-b-2 border-indigo-600' : 'hover:text-slate-900'
          }`}
        >
          <span>⚙️</span> Credentials & Webhooks
        </button>
        <button
          onClick={() => setActiveTab('CONVERSATIONS')}
          className={`pb-3 transition relative flex items-center gap-1.5 ${
            activeTab === 'CONVERSATIONS' ? 'text-indigo-600 font-extrabold border-b-2 border-indigo-600' : 'hover:text-slate-900'
          }`}
        >
          <span>🤖</span> Booking Conversations
          <span className="px-1.5 py-0.2 bg-emerald-100 text-emerald-700 text-[10px] rounded-full font-bold">Phase 8</span>
        </button>
        <button
          onClick={() => setActiveTab('LOGS')}
          className={`pb-3 transition relative flex items-center gap-1.5 ${
            activeTab === 'LOGS' ? 'text-indigo-600 font-extrabold border-b-2 border-indigo-600' : 'hover:text-slate-900'
          }`}
        >
          <span>💬</span> Message Event Logs
        </button>
      </div>

      {/* TAB 1: Credentials & Configuration */}
      {activeTab === 'CONFIG' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Status & Webhook Setup Box */}
          <div className="lg:col-span-1 space-y-6">
            <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs space-y-4">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400">Connection Status</h3>
              <div className="flex items-center gap-3">
                <span
                  className={`w-3.5 h-3.5 rounded-full ${
                    config?.status === 'CONNECTED'
                      ? 'bg-emerald-500 ring-4 ring-emerald-100'
                      : config?.status === 'ERROR'
                      ? 'bg-rose-500 ring-4 ring-rose-100'
                      : 'bg-slate-300'
                  }`}
                />
                <div>
                  <span className="text-sm font-bold text-slate-800">
                    {config?.status === 'CONNECTED' ? 'Connected & Active' : config?.status === 'ERROR' ? 'Connection Error' : 'Not Connected'}
                  </span>
                  <p className="text-[11px] text-slate-400">
                    {config?.displayPhoneNumber || 'No display number configured'}
                  </p>
                </div>
              </div>
            </div>

            {/* Webhook Configuration Box */}
            <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs space-y-4">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400">Meta Webhook Setup</h3>
              <div className="space-y-3 text-xs">
                <div>
                  <label className="block text-slate-500 font-bold mb-1">Callback URL (Copy to Meta)</label>
                  <div className="flex items-center gap-2">
                    <input
                      readOnly
                      value={webhookCallbackUrl}
                      className="w-full px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-lg font-mono text-[11px] text-slate-700 select-all"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-slate-500 font-bold mb-1">Verify Token</label>
                  <input
                    readOnly
                    value={config?.verifyToken || 'whatsapp_booking_verify_token_2026'}
                    className="w-full px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-lg font-mono text-[11px] text-slate-700 select-all"
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Credentials Form */}
          <div className="lg:col-span-2 bg-white p-6 rounded-2xl border border-slate-200 shadow-xs">
            <h2 className="text-sm font-bold text-slate-900 mb-4">Meta Cloud API Configuration</h2>

            {loadingConfig ? (
              <div className="py-8 text-center text-xs text-slate-400">Loading configuration...</div>
            ) : (
              <form onSubmit={handleSaveConfig} className="space-y-4 text-xs">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block font-bold text-slate-700 mb-1">Phone Number ID *</label>
                    <input
                      type="text"
                      required
                      placeholder="e.g. 104829104819204"
                      value={phoneNumberId}
                      onChange={(e) => setPhoneNumberId(e.target.value)}
                      className="w-full px-3 py-2 border border-slate-300 rounded-xl font-mono focus:ring-2 focus:ring-indigo-500"
                    />
                  </div>

                  <div>
                    <label className="block font-bold text-slate-700 mb-1">WhatsApp Business Account ID</label>
                    <input
                      type="text"
                      placeholder="e.g. 293810293810293"
                      value={businessAccountId}
                      onChange={(e) => setBusinessAccountId(e.target.value)}
                      className="w-full px-3 py-2 border border-slate-300 rounded-xl font-mono focus:ring-2 focus:ring-indigo-500"
                    />
                  </div>

                  <div>
                    <label className="block font-bold text-slate-700 mb-1">Display Phone Number</label>
                    <input
                      type="text"
                      placeholder="e.g. +91 98765 43210"
                      value={displayPhoneNumber}
                      onChange={(e) => setDisplayPhoneNumber(e.target.value)}
                      className="w-full px-3 py-2 border border-slate-300 rounded-xl focus:ring-2 focus:ring-indigo-500"
                    />
                  </div>

                  <div>
                    <label className="block font-bold text-slate-700 mb-1">Webhook Verify Token</label>
                    <input
                      type="text"
                      placeholder="e.g. your_custom_verify_token"
                      value={verifyToken}
                      onChange={(e) => setVerifyToken(e.target.value)}
                      className="w-full px-3 py-2 border border-slate-300 rounded-xl font-mono focus:ring-2 focus:ring-indigo-500"
                    />
                  </div>
                </div>

                <div className="space-y-4 pt-2">
                  <div>
                    <label className="block font-bold text-slate-700 mb-1">Permanent System User Access Token *</label>
                    <input
                      type="password"
                      placeholder={config?.hasAccessToken ? '•••••••••••• (Leave blank to keep unchanged)' : 'EAAG...'}
                      value={accessToken}
                      onChange={(e) => setAccessToken(e.target.value)}
                      className="w-full px-3 py-2 border border-slate-300 rounded-xl font-mono focus:ring-2 focus:ring-indigo-500"
                    />
                  </div>

                  <div>
                    <label className="block font-bold text-slate-700 mb-1">Meta App Secret (for HMAC SHA-256 validation) *</label>
                    <input
                      type="password"
                      placeholder={config?.hasAppSecret ? '•••••••• (Leave blank to keep unchanged)' : '32-character Meta App Secret'}
                      value={appSecret}
                      onChange={(e) => setAppSecret(e.target.value)}
                      className="w-full px-3 py-2 border border-slate-300 rounded-xl font-mono focus:ring-2 focus:ring-indigo-500"
                    />
                  </div>
                </div>

                <div className="pt-4 flex justify-end">
                  <button
                    type="submit"
                    disabled={saving}
                    className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl shadow-xs transition"
                  >
                    {saving ? 'Saving...' : 'Save Configuration'}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

      {/* TAB 2: Phase 8 Booking Conversations Monitor */}
      {activeTab === 'CONVERSATIONS' && (
        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-xs space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <h2 className="text-sm font-bold text-slate-900">Active WhatsApp Booking Sessions</h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Real-time tracking of customer conversation states, slot selections, and booking outcomes.
              </p>
            </div>
            <button
              onClick={loadConversations}
              disabled={loadingConversations}
              className="px-3 py-1.5 border border-slate-200 text-slate-700 hover:bg-slate-50 text-xs font-bold rounded-xl transition flex items-center gap-1"
            >
              <span>🔄</span> Refresh
            </button>
          </div>

          {loadingConversations ? (
            <div className="py-12 text-center text-xs text-slate-400">Loading conversation sessions...</div>
          ) : conversations.length === 0 ? (
            <div className="py-12 text-center text-xs text-slate-400">
              No active or historical booking conversations found.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs text-slate-600">
                <thead className="bg-slate-50 text-slate-400 uppercase text-[10px] font-bold border-y border-slate-100">
                  <tr>
                    <th className="py-2.5 px-3">Customer</th>
                    <th className="py-2.5 px-3">State</th>
                    <th className="py-2.5 px-3">Service</th>
                    <th className="py-2.5 px-3">Staff</th>
                    <th className="py-2.5 px-3">Date & Slot</th>
                    <th className="py-2.5 px-3">Appointment</th>
                    <th className="py-2.5 px-3">Updated</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {conversations.map((sess) => (
                    <tr key={sess.id} className="hover:bg-slate-50/60 transition">
                      <td className="py-3 px-3">
                        <span className="font-extrabold text-slate-900 block">{sess.customer?.name || 'Customer'}</span>
                        <span className="font-mono text-slate-400 text-[11px]">{sess.phoneNumber}</span>
                      </td>
                      <td className="py-3 px-3">
                        <span
                          className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                            sess.state === 'BOOKED'
                              ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                              : sess.state === 'CONFIRMING'
                              ? 'bg-amber-50 text-amber-700 border border-amber-200'
                              : sess.state === 'CANCELLED'
                              ? 'bg-rose-50 text-rose-700 border border-rose-200'
                              : 'bg-blue-50 text-blue-700 border border-blue-200'
                          }`}
                        >
                          {sess.state}
                        </span>
                      </td>
                      <td className="py-3 px-3 font-semibold text-slate-800">
                        {sess.serviceName || '—'}
                      </td>
                      <td className="py-3 px-3 text-slate-600">
                        {sess.staffName || '—'}
                      </td>
                      <td className="py-3 px-3">
                        {sess.selectedDate ? (
                          <div>
                            <span className="font-bold text-slate-800 block">{sess.selectedDate}</span>
                            {sess.selectedSlot && (
                              <span className="text-[11px] font-mono text-indigo-600">
                                {new Date(sess.selectedSlot).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                              </span>
                            )}
                          </div>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="py-3 px-3">
                        {sess.appointmentId ? (
                          <Link
                            href="/dashboard/appointments"
                            className="font-mono text-indigo-600 hover:text-indigo-800 font-bold underline"
                          >
                            #{sess.appointmentId.slice(0, 8).toUpperCase()}
                          </Link>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>
                      <td className="py-3 px-3 text-[11px] text-slate-400 whitespace-nowrap">
                        {new Date(sess.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* TAB 3: Message Event Logs */}
      {activeTab === 'LOGS' && (
        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-xs space-y-4">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
            <h2 className="text-sm font-bold text-slate-900">Message Event Stream ({totalMessages})</h2>
            <div className="flex items-center gap-2">
              <select
                value={directionFilter}
                onChange={(e) => setDirectionFilter(e.target.value)}
                className="px-2.5 py-1.5 border border-slate-200 rounded-xl text-xs bg-slate-50 font-semibold"
              >
                <option value="ALL">All Directions</option>
                <option value="INBOUND">Inbound</option>
                <option value="OUTBOUND">Outbound</option>
              </select>

              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="px-2.5 py-1.5 border border-slate-200 rounded-xl text-xs bg-slate-50 font-semibold"
              >
                <option value="ALL">All Statuses</option>
                <option value="RECEIVED">Received</option>
                <option value="SENT">Sent</option>
                <option value="DELIVERED">Delivered</option>
                <option value="READ">Read</option>
                <option value="FAILED">Failed</option>
              </select>
            </div>
          </div>

          {loadingMessages ? (
            <div className="py-12 text-center text-xs text-slate-400">Loading messages...</div>
          ) : messages.length === 0 ? (
            <div className="py-12 text-center text-xs text-slate-400">No message events found.</div>
          ) : (
            <div className="divide-y divide-slate-100 mt-2">
              {messages.map((msg) => (
                <div key={msg.id} className="py-3.5 flex items-start justify-between gap-4 text-xs">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span
                        className={`px-2 py-0.5 rounded-md font-bold text-[10px] ${
                          msg.direction === 'INBOUND'
                            ? 'bg-blue-50 text-blue-700 border border-blue-200'
                            : 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                        }`}
                      >
                        {msg.direction}
                      </span>
                      <span className="font-extrabold text-slate-900">
                        {msg.customer?.name || 'Customer'}
                      </span>
                      <span className="font-mono text-slate-500 font-semibold">
                        ({msg.customer?.phone || 'Unknown'})
                      </span>
                      <span className="text-slate-400 text-[11px]">• {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
                    </div>

                    <p className="text-slate-800 text-xs bg-slate-50 p-2.5 rounded-xl border border-slate-100 font-medium">
                      {msg.text || '[Non-text message payload]'}
                    </p>
                  </div>

                  <div className="text-right whitespace-nowrap">
                    <span
                      className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                        msg.status === 'READ'
                          ? 'bg-purple-50 text-purple-700 border border-purple-200'
                          : msg.status === 'DELIVERED'
                          ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                          : msg.status === 'SENT'
                          ? 'bg-blue-50 text-blue-700 border border-blue-200'
                          : msg.status === 'FAILED'
                          ? 'bg-rose-50 text-rose-700 border border-rose-200'
                          : 'bg-slate-100 text-slate-700'
                      }`}
                    >
                      {msg.status}
                    </span>
                    <span className="block text-[10px] font-mono text-slate-400 mt-1 max-w-[120px] truncate">
                      {msg.whatsappMessageId}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Send Test Message Modal */}
      {showSendModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-xl border border-slate-200 space-y-4">
            <div className="flex justify-between items-center pb-2 border-b border-slate-100">
              <h3 className="text-sm font-bold text-slate-900">Send WhatsApp Message</h3>
              <button
                onClick={() => setShowSendModal(false)}
                className="text-slate-400 hover:text-slate-600 font-bold"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSendTestMessage} className="space-y-3 text-xs">
              <div>
                <label className="block font-bold text-slate-700 mb-1">Recipient Phone *</label>
                <input
                  type="tel"
                  required
                  placeholder="e.g. +91 98765 43210 or 9876543210"
                  value={testRecipient}
                  onChange={(e) => setTestRecipient(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-xl font-mono focus:ring-2 focus:ring-emerald-500 font-medium"
                />
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">Message Body *</label>
                <textarea
                  rows={3}
                  required
                  value={testMessageText}
                  onChange={(e) => setTestMessageText(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-xl focus:ring-2 focus:ring-emerald-500"
                ></textarea>
              </div>

              <div className="flex justify-end space-x-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowSendModal(false)}
                  className="px-3.5 py-2 border border-slate-200 text-slate-600 rounded-xl hover:bg-slate-50 font-semibold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={sendingTest}
                  className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl shadow-xs"
                >
                  {sendingTest ? 'Sending...' : 'Send Message'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
