"use client";

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

interface HolidayItem {
  id: string;
  date: string;
  name: string;
  createdAt: string;
}

export default function HolidaysPage() {
  const [holidays, setHolidays] = useState<HolidayItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Add Holiday Modal
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [formDate, setFormDate] = useState('');
  const [formName, setFormName] = useState('');
  const [formError, setFormError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const router = useRouter();

  const fetchHolidays = async () => {
    const token = localStorage.getItem('access_token');
    if (!token) {
      router.push('/login');
      return;
    }

    try {
      setLoading(true);
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api/v1'}/holidays`,
        {
          headers: { Authorization: `Bearer ${token}` },
        },
      );

      if (!res.ok) {
        if (res.status === 401) {
          localStorage.removeItem('access_token');
          router.push('/login');
          return;
        }
        throw new Error('Failed to load business holidays');
      }

      const data = await res.json();
      setHolidays(data);
    } catch (err: any) {
      setError(err.message || 'Error fetching holidays');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchHolidays();
  }, []);

  const handleCreateHoliday = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');

    if (!formDate || !formName.trim()) {
      setFormError('Date and Holiday Name are required');
      return;
    }

    const token = localStorage.getItem('access_token');
    if (!token) return;

    try {
      setSubmitting(true);
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api/v1'}/holidays`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            date: new Date(formDate).toISOString(),
            name: formName.trim(),
          }),
        },
      );

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || 'Failed to add holiday');
      }

      setSuccess('Holiday added successfully!');
      setIsModalOpen(false);
      setFormDate('');
      setFormName('');
      fetchHolidays();
      setTimeout(() => setSuccess(''), 3000);
    } catch (err: any) {
      setFormError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeleteHoliday = async (id: string, name: string) => {
    if (!confirm(`Delete holiday "${name}"?`)) return;

    const token = localStorage.getItem('access_token');
    if (!token) return;

    try {
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api/v1'}/holidays/${id}`,
        {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${token}` },
        },
      );

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.message || 'Failed to delete holiday');
      }

      setSuccess(`Holiday "${name}" deleted.`);
      fetchHolidays();
      setTimeout(() => setSuccess(''), 3000);
    } catch (err: any) {
      setError(err.message || 'Error deleting holiday');
      setTimeout(() => setError(''), 3000);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Business Holidays</h1>
          <p className="text-sm text-slate-500 mt-1">
            Specify business closures and national holidays to prevent appointments on those dates.
          </p>
        </div>
        <button
          onClick={() => {
            setFormDate('');
            setFormName('');
            setFormError('');
            setIsModalOpen(true);
          }}
          className="inline-flex items-center px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold rounded-lg shadow-xs transition gap-2"
        >
          <span>+</span> Add Holiday
        </button>
      </div>

      {/* Notifications */}
      {success && (
        <div className="p-3 bg-emerald-50 border border-emerald-200 text-emerald-700 text-sm rounded-lg flex justify-between">
          <span>{success}</span>
          <button onClick={() => setSuccess('')} className="font-bold">×</button>
        </div>
      )}
      {error && (
        <div className="p-3 bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg flex justify-between">
          <span>{error}</span>
          <button onClick={() => setError('')} className="font-bold">×</button>
        </div>
      )}

      {/* Holidays List */}
      {loading ? (
        <div className="flex justify-center p-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div>
        </div>
      ) : holidays.length === 0 ? (
        <div className="bg-white rounded-xl border border-dashed border-slate-300 p-12 text-center">
          <p className="text-slate-400 text-3xl mb-2">🏖️</p>
          <h3 className="text-base font-semibold text-slate-800">No holidays scheduled</h3>
          <p className="text-sm text-slate-500 mt-1">
            Add business holidays to prevent online bookings on festive or closed dates.
          </p>
          <button
            onClick={() => setIsModalOpen(true)}
            className="mt-4 px-4 py-2 bg-indigo-600 text-white text-sm font-semibold rounded-lg hover:bg-indigo-700"
          >
            Add Holiday
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {holidays.map((h) => {
            const dateObj = new Date(h.date);
            return (
              <div
                key={h.id}
                className="bg-white p-5 rounded-xl border border-slate-200 shadow-xs flex items-center justify-between"
              >
                <div className="flex items-center space-x-3.5">
                  <div className="w-11 h-11 rounded-xl bg-amber-50 text-amber-600 border border-amber-200/60 flex flex-col items-center justify-center font-bold text-xs">
                    <span className="text-[10px] uppercase tracking-wider text-amber-500">
                      {dateObj.toLocaleString('default', { month: 'short' })}
                    </span>
                    <span className="text-base leading-none text-slate-900 font-extrabold">
                      {dateObj.getUTCDate()}
                    </span>
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-slate-900">{h.name}</h3>
                    <p className="text-xs text-slate-500">
                      {dateObj.toLocaleDateString(undefined, {
                        weekday: 'short',
                        year: 'numeric',
                        month: 'short',
                        day: 'numeric',
                      })}
                    </p>
                  </div>
                </div>

                <button
                  onClick={() => handleDeleteHoliday(h.id, h.name)}
                  className="p-2 text-red-500 hover:text-red-700 hover:bg-red-50 rounded-lg text-xs font-bold"
                  title="Delete Holiday"
                >
                  🗑️
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* Add Holiday Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4 backdrop-blur-xs">
          <div className="bg-white rounded-2xl max-w-sm w-full p-6 shadow-xl border border-slate-200">
            <h3 className="text-base font-bold text-slate-900 pb-3 border-b border-slate-100">
              Add Business Holiday
            </h3>

            {formError && (
              <div className="mt-3 p-2.5 bg-red-50 border border-red-200 text-red-700 text-xs rounded-lg">
                {formError}
              </div>
            )}

            <form onSubmit={handleCreateHoliday} className="mt-4 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Holiday Date *
                </label>
                <input
                  type="date"
                  required
                  value={formDate}
                  onChange={(e) => setFormDate(e.target.value)}
                  className="w-full px-3.5 py-2 border border-slate-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Holiday Name / Reason *
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Diwali, Christmas, Store Renovation"
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  className="w-full px-3.5 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              <div className="flex justify-end space-x-2 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-3.5 py-2 border border-slate-300 text-slate-700 text-xs font-semibold rounded-lg hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold rounded-lg shadow-xs disabled:opacity-50"
                >
                  {submitting ? 'Saving...' : 'Add Holiday'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
