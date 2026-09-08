"use client";

import { useEffect, useState, useCallback, use } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

interface CustomerDetail {
  id: string;
  name: string;
  phone: string;
  email: string | null;
  status: 'ACTIVE' | 'INACTIVE';
  notes: string | null;
  tags: string;
  tagsList: string[];
  createdAt: string;
  updatedAt: string;
  appointments: {
    id: string;
    startAt: string;
    endAt: string;
    status: 'PENDING' | 'CONFIRMED' | 'CANCELLED' | 'COMPLETED' | 'NO_SHOW';
    price: number;
    depositAmount: number;
    paymentStatus: string;
    service: {
      id: string;
      name: string;
      durationMinutes: number;
    };
    staff: {
      id: string;
      name: string;
    };
  }[];
  stats: {
    totalAppointments: number;
    completed: number;
    cancelled: number;
    noShow: number;
    totalSpending: number;
    avgAppointmentValue: number;
    lastVisit: string | null;
    nextAppointment: string | null;
  };
}

export default function CustomerProfilePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const resolvedParams = use(params);
  const router = useRouter();

  const [customer, setCustomer] = useState<CustomerDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Editing State
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState('');
  const [editPhone, setEditPhone] = useState('');
  const [editEmail, setEditEmail] = useState('');
  const [editNotes, setEditNotes] = useState('');
  const [newTagInput, setNewTagInput] = useState('');
  const [saving, setSaving] = useState(false);

  const loadCustomer = useCallback(async () => {
    const token = localStorage.getItem('access_token');
    if (!token) {
      router.push('/login');
      return;
    }

    try {
      setLoading(true);
      setError('');
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api/v1';
      const res = await fetch(`${apiUrl}/customers/${resolvedParams.id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!res.ok) {
        if (res.status === 404) {
          throw new Error('Customer not found');
        }
        throw new Error('Failed to load customer profile');
      }

      const data: CustomerDetail = await res.json();
      setCustomer(data);
      setEditName(data.name);
      setEditPhone(data.phone);
      setEditEmail(data.email || '');
      setEditNotes(data.notes || '');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error fetching customer';
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, [resolvedParams.id, router]);

  useEffect(() => {
    loadCustomer();
  }, [loadCustomer]);

  const handleUpdateProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!customer) return;

    const token = localStorage.getItem('access_token');
    if (!token) return;

    try {
      setSaving(true);
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api/v1';

      const res = await fetch(`${apiUrl}/customers/${customer.id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          name: editName.trim(),
          phone: editPhone.trim(),
          email: editEmail.trim() || undefined,
          notes: editNotes.trim() || undefined,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || 'Failed to update customer');
      }

      setSuccess('Profile updated successfully!');
      setIsEditing(false);
      loadCustomer();
      setTimeout(() => setSuccess(''), 3000);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to update';
      setError(msg);
      setTimeout(() => setError(''), 4000);
    } finally {
      setSaving(false);
    }
  };

  const handleToggleStatus = async () => {
    if (!customer) return;
    const nextStatus = customer.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE';

    const token = localStorage.getItem('access_token');
    if (!token) return;

    try {
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api/v1';
      const res = await fetch(`${apiUrl}/customers/${customer.id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ status: nextStatus }),
      });

      if (!res.ok) {
        throw new Error('Failed to update status');
      }

      setSuccess(`Customer marked as ${nextStatus}`);
      loadCustomer();
      setTimeout(() => setSuccess(''), 3000);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to change status';
      setError(msg);
    }
  };

  const handleAddTag = async () => {
    if (!customer || !newTagInput.trim()) return;
    const tag = newTagInput.trim();
    if (customer.tagsList.includes(tag)) {
      setNewTagInput('');
      return;
    }

    const updatedTags = [...customer.tagsList, tag];
    await saveTags(updatedTags);
    setNewTagInput('');
  };

  const handleRemoveTag = async (tagToRemove: string) => {
    if (!customer) return;
    const updatedTags = customer.tagsList.filter((t) => t !== tagToRemove);
    await saveTags(updatedTags);
  };

  const saveTags = async (tags: string[]) => {
    if (!customer) return;
    const token = localStorage.getItem('access_token');
    if (!token) return;

    try {
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api/v1';
      await fetch(`${apiUrl}/customers/${customer.id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ tags }),
      });
      loadCustomer();
    } catch (err) {
      console.error('Failed to update tags', err);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[50vh]">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div>
      </div>
    );
  }

  if (error && !customer) {
    return (
      <div className="p-6 bg-red-50 border border-red-200 text-red-700 rounded-2xl max-w-lg mx-auto text-center mt-10">
        <p className="font-bold text-sm mb-2">{error}</p>
        <Link
          href="/dashboard/customers"
          className="text-xs font-semibold text-indigo-600 hover:text-indigo-700 underline"
        >
          ← Back to Customer Directory
        </Link>
      </div>
    );
  }

  if (!customer) return null;

  return (
    <div className="space-y-6">
      {/* Back link */}
      <div>
        <Link
          href="/dashboard/customers"
          className="text-xs font-bold text-slate-500 hover:text-slate-900 transition flex items-center gap-1"
        >
          ← Back to Customers
        </Link>
      </div>

      {/* Alerts */}
      {success && (
        <div className="p-3 bg-emerald-50 border border-emerald-200 text-emerald-700 text-xs rounded-xl flex justify-between font-medium">
          <span>{success}</span>
          <button onClick={() => setSuccess('')} className="font-bold">×</button>
        </div>
      )}
      {error && (
        <div className="p-3 bg-red-50 border border-red-200 text-red-700 text-xs rounded-xl flex justify-between font-medium">
          <span>{error}</span>
          <button onClick={() => setError('')} className="font-bold">×</button>
        </div>
      )}

      {/* Profile Header Card */}
      <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div className="flex items-center gap-4">
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-indigo-600 to-indigo-800 text-white flex items-center justify-center text-2xl font-black shadow-sm">
            {customer.name.charAt(0).toUpperCase()}
          </div>
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-extrabold text-slate-900 tracking-tight">{customer.name}</h1>
              <span
                className={`px-2.5 py-0.5 rounded-full text-xs font-bold ${
                  customer.status === 'ACTIVE'
                    ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                    : 'bg-slate-100 text-slate-600 border border-slate-300'
                }`}
              >
                {customer.status}
              </span>
            </div>
            <p className="text-xs font-mono text-slate-600 mt-1 font-semibold">
              {customer.phone} {customer.email && <span className="font-sans text-slate-400 font-normal ml-2">• {customer.email}</span>}
            </p>
            <p className="text-[11px] text-slate-400 mt-0.5">
              Customer since {new Date(customer.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <button
            onClick={handleToggleStatus}
            className={`px-3.5 py-2 text-xs font-bold rounded-xl border transition ${
              customer.status === 'ACTIVE'
                ? 'border-slate-300 text-slate-700 hover:bg-slate-50'
                : 'border-emerald-300 bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
            }`}
          >
            Mark {customer.status === 'ACTIVE' ? 'Inactive' : 'Active'}
          </button>
          <button
            onClick={() => setIsEditing(!isEditing)}
            className="px-3.5 py-2 bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-bold rounded-xl transition"
          >
            {isEditing ? 'Cancel Edit' : 'Edit Profile'}
          </button>
          <Link
            href="/dashboard/appointments"
            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold rounded-xl shadow-xs transition"
          >
            Book Appointment
          </Link>
        </div>
      </div>

      {/* Inline Edit Form */}
      {isEditing && (
        <form onSubmit={handleUpdateProfile} className="bg-white p-5 rounded-2xl border border-indigo-200 shadow-sm space-y-4 text-xs">
          <h3 className="text-sm font-bold text-slate-900 border-b border-slate-100 pb-2">Edit Customer Details</h3>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block font-semibold text-slate-700 mb-1">Full Name *</label>
              <input
                type="text"
                required
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                className="w-full px-3 py-1.5 border border-slate-300 rounded-lg bg-white focus:ring-2 focus:ring-indigo-500 font-medium"
              />
            </div>
            <div>
              <label className="block font-semibold text-slate-700 mb-1">Phone Number *</label>
              <input
                type="tel"
                required
                value={editPhone}
                onChange={(e) => setEditPhone(e.target.value)}
                className="w-full px-3 py-1.5 border border-slate-300 rounded-lg bg-white focus:ring-2 focus:ring-indigo-500 font-mono font-medium"
              />
            </div>
            <div>
              <label className="block font-semibold text-slate-700 mb-1">Email Address</label>
              <input
                type="email"
                value={editEmail}
                onChange={(e) => setEditEmail(e.target.value)}
                className="w-full px-3 py-1.5 border border-slate-300 rounded-lg bg-white focus:ring-2 focus:ring-indigo-500"
              />
            </div>
          </div>
          <div>
            <label className="block font-semibold text-slate-700 mb-1">Internal Notes</label>
            <textarea
              rows={2}
              value={editNotes}
              onChange={(e) => setEditNotes(e.target.value)}
              className="w-full px-3 py-1.5 border border-slate-300 rounded-lg bg-white focus:ring-2 focus:ring-indigo-500"
            ></textarea>
          </div>
          <div className="flex justify-end space-x-2">
            <button
              type="button"
              onClick={() => setIsEditing(false)}
              className="px-3 py-1.5 border border-slate-200 text-slate-600 rounded-lg hover:bg-slate-50 font-semibold"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-4 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-lg shadow-xs"
            >
              {saving ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        </form>
      )}

      {/* CRM Statistics Grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Total Spending */}
        <div className="p-5 bg-gradient-to-br from-indigo-900 to-indigo-700 text-white rounded-2xl shadow-xs">
          <span className="text-[11px] uppercase font-bold text-indigo-200 tracking-wider">Total Spending</span>
          <p className="text-3xl font-black mt-2">₹{customer.stats.totalSpending}</p>
          <p className="text-[11px] text-indigo-200 mt-1">Avg ₹{customer.stats.avgAppointmentValue} / visit</p>
        </div>

        {/* Total Appointments */}
        <div className="p-5 bg-white rounded-2xl border border-slate-200 shadow-xs">
          <span className="text-[11px] uppercase font-bold text-slate-400 tracking-wider">Total Bookings</span>
          <p className="text-3xl font-extrabold text-slate-900 mt-2">{customer.stats.totalAppointments}</p>
          <div className="flex items-center gap-2 mt-1 text-[11px] font-medium">
            <span className="text-emerald-600">{customer.stats.completed} done</span>
            <span className="text-slate-300">•</span>
            <span className="text-rose-500">{customer.stats.cancelled} cancelled</span>
          </div>
        </div>

        {/* Last Visit */}
        <div className="p-5 bg-white rounded-2xl border border-slate-200 shadow-xs">
          <span className="text-[11px] uppercase font-bold text-slate-400 tracking-wider">Last Visit</span>
          <p className="text-base font-extrabold text-slate-900 mt-2">
            {customer.stats.lastVisit
              ? new Date(customer.stats.lastVisit).toLocaleDateString(undefined, {
                  month: 'short',
                  day: 'numeric',
                  year: 'numeric',
                })
              : 'Never'}
          </p>
          <p className="text-[11px] text-slate-400 mt-1">
            {customer.stats.lastVisit
              ? new Date(customer.stats.lastVisit).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
              : 'No past completed visit'}
          </p>
        </div>

        {/* Next Appointment */}
        <div className="p-5 bg-white rounded-2xl border border-slate-200 shadow-xs">
          <span className="text-[11px] uppercase font-bold text-indigo-600 tracking-wider">Next Appointment</span>
          <p className="text-base font-extrabold text-slate-900 mt-2">
            {customer.stats.nextAppointment
              ? new Date(customer.stats.nextAppointment).toLocaleDateString(undefined, {
                  month: 'short',
                  day: 'numeric',
                  year: 'numeric',
                })
              : 'None scheduled'}
          </p>
          <p className="text-[11px] text-slate-400 mt-1">
            {customer.stats.nextAppointment
              ? new Date(customer.stats.nextAppointment).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
              : 'Ready for new booking'}
          </p>
        </div>
      </div>

      {/* Main Content: Notes, Tags & Appointment History */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column: Tags & Internal Notes */}
        <div className="space-y-6">
          {/* Customer Tags */}
          <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs">
            <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider mb-3">Customer Tags</h3>
            <div className="flex flex-wrap gap-1.5 mb-3">
              {customer.tagsList.length > 0 ? (
                customer.tagsList.map((t) => (
                  <span
                    key={t}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-indigo-50 text-indigo-700 border border-indigo-200 text-xs font-bold rounded-lg"
                  >
                    <span>{t}</span>
                    <button
                      onClick={() => handleRemoveTag(t)}
                      className="text-indigo-400 hover:text-indigo-700 font-extrabold text-sm"
                    >
                      ×
                    </button>
                  </span>
                ))
              ) : (
                <p className="text-xs text-slate-400">No tags assigned yet.</p>
              )}
            </div>

            <div className="flex gap-2">
              <input
                type="text"
                placeholder="Add tag (e.g. VIP)..."
                value={newTagInput}
                onChange={(e) => setNewTagInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleAddTag()}
                className="flex-1 px-3 py-1.5 border border-slate-300 rounded-lg text-xs bg-white focus:ring-2 focus:ring-indigo-500"
              />
              <button
                type="button"
                onClick={handleAddTag}
                className="px-3 py-1.5 bg-slate-900 text-white text-xs font-bold rounded-lg hover:bg-slate-800"
              >
                Add
              </button>
            </div>
          </div>

          {/* Internal Notes */}
          <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs">
            <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider mb-2">Private Internal Notes</h3>
            {customer.notes ? (
              <p className="text-xs text-slate-700 bg-amber-50/50 p-3 rounded-xl border border-amber-200/40 italic leading-relaxed">
                &ldquo;{customer.notes}&rdquo;
              </p>
            ) : (
              <p className="text-xs text-slate-400 py-2">No internal notes for this customer.</p>
            )}
          </div>
        </div>

        {/* Right Column: Appointment History (2 columns) */}
        <div className="lg:col-span-2 bg-white rounded-2xl border border-slate-200 p-6 shadow-xs">
          <div className="flex items-center justify-between pb-4 border-b border-slate-100">
            <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wider">
              Appointment History ({customer.appointments.length})
            </h3>
            <span className="text-xs text-slate-400">Newest visits first</span>
          </div>

          {customer.appointments.length === 0 ? (
            <div className="py-16 text-center">
              <p className="text-3xl text-slate-300 mb-2">📅</p>
              <h4 className="text-sm font-semibold text-slate-700">No appointment history</h4>
              <p className="text-xs text-slate-400 mt-1">This customer has not booked any appointments yet.</p>
            </div>
          ) : (
            <div className="divide-y divide-slate-100 mt-2">
              {customer.appointments.map((appt) => {
                const s = new Date(appt.startAt);
                return (
                  <div key={appt.id} className="py-3.5 flex items-center justify-between gap-4 text-xs">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-slate-900">
                          {s.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })} at{' '}
                          {s.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </span>
                        <span
                          className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
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
                      <p className="text-slate-600 text-[11px] mt-0.5">
                        {appt.service.name} ({appt.service.durationMinutes}m) with{' '}
                        <span className="text-indigo-700 font-semibold">{appt.staff.name}</span>
                      </p>
                    </div>

                    <div className="text-right">
                      <span className="font-extrabold text-slate-900 text-sm">₹{appt.price}</span>
                      {appt.depositAmount > 0 && (
                        <span className="block text-[10px] text-slate-400">Deposit: ₹{appt.depositAmount}</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
