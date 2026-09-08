"use client";

import { useEffect, useState, use } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

interface StaffDetail {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  active: boolean;
  services: Array<{
    service: {
      id: string;
      name: string;
      durationMinutes: number;
      price: number;
    };
  }>;
  workingHours: Array<{
    id: string;
    dayOfWeek: number;
    startTime: string;
    endTime: string;
    enabled: boolean;
  }>;
  breaks: Array<{
    id: string;
    dayOfWeek: number;
    startTime: string;
    endTime: string;
  }>;
  leaves: Array<{
    id: string;
    startDate: string;
    endDate: string;
    reason: string | null;
  }>;
}

interface ServiceItem {
  id: string;
  name: string;
  durationMinutes: number;
  price: number;
  active: boolean;
}

const DAY_NAMES = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
];

export default function StaffDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const resolvedParams = use(params);
  const staffId = resolvedParams.id;

  const [staff, setStaff] = useState<StaffDetail | null>(null);
  const [allServices, setAllServices] = useState<ServiceItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'SERVICES' | 'HOURS' | 'BREAKS' | 'LEAVES'>('SERVICES');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Services Assignment state
  const [selectedServiceIds, setSelectedServiceIds] = useState<string[]>([]);
  const [savingServices, setSavingServices] = useState(false);

  // Working Hours state
  const [hoursState, setHoursState] = useState<
    Array<{ dayOfWeek: number; startTime: string; endTime: string; enabled: boolean }>
  >([]);
  const [savingHours, setSavingHours] = useState(false);

  // Breaks state
  const [isBreakModalOpen, setIsBreakModalOpen] = useState(false);
  const [breakDay, setBreakDay] = useState(1);
  const [breakStart, setBreakStart] = useState('13:00');
  const [breakEnd, setBreakEnd] = useState('14:00');
  const [breakError, setBreakError] = useState('');
  const [savingBreak, setSavingBreak] = useState(false);

  // Leave state
  const [isLeaveModalOpen, setIsLeaveModalOpen] = useState(false);
  const [leaveStart, setLeaveStart] = useState('');
  const [leaveEnd, setLeaveEnd] = useState('');
  const [leaveReason, setLeaveReason] = useState('');
  const [leaveError, setLeaveError] = useState('');
  const [savingLeave, setSavingLeave] = useState(false);

  const router = useRouter();

  const loadData = async () => {
    const token = localStorage.getItem('access_token');
    if (!token) {
      router.push('/login');
      return;
    }

    try {
      setLoading(true);
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api/v1';
      const headers = { Authorization: `Bearer ${token}` };

      const [staffRes, servicesRes] = await Promise.all([
        fetch(`${apiUrl}/staff/${staffId}`, { headers }),
        fetch(`${apiUrl}/services`, { headers }),
      ]);

      if (!staffRes.ok) {
        if (staffRes.status === 401) {
          localStorage.removeItem('access_token');
          router.push('/login');
          return;
        }
        throw new Error('Staff member not found');
      }

      const staffData: StaffDetail = await staffRes.json();
      const servicesData: ServiceItem[] = servicesRes.ok ? await servicesRes.json() : [];

      setStaff(staffData);
      setAllServices(servicesData);
      setSelectedServiceIds(staffData.services?.map((s) => s.service.id) || []);

      // Normalize 7 days of working hours (0=Sun .. 6=Sat)
      const hoursMap = new Map(staffData.workingHours?.map((h) => [h.dayOfWeek, h]));
      const fullWeek = [0, 1, 2, 3, 4, 5, 6].map((day) => {
        const existing = hoursMap.get(day);
        return {
          dayOfWeek: day,
          startTime: existing?.startTime || '10:00',
          endTime: existing?.endTime || '19:00',
          enabled: existing ? existing.enabled : day !== 0,
        };
      });
      setHoursState(fullWeek);
    } catch (err: any) {
      setError(err.message || 'Failed to load staff details');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [staffId]);

  // --- SAVE SERVICES ASSIGNMENT ---
  const handleSaveServices = async () => {
    const token = localStorage.getItem('access_token');
    if (!token) return;

    try {
      setSavingServices(true);
      setError('');
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api/v1'}/staff/${staffId}/services`,
        {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ serviceIds: selectedServiceIds }),
        },
      );

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.message || 'Failed to save assigned services');
      }

      setSuccess('Assigned services updated successfully!');
      loadData();
      setTimeout(() => setSuccess(''), 3000);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSavingServices(false);
    }
  };

  // --- SAVE WORKING HOURS ---
  const handleSaveHours = async () => {
    const token = localStorage.getItem('access_token');
    if (!token) return;

    // Validate client-side
    for (const item of hoursState) {
      if (item.enabled && item.startTime >= item.endTime) {
        setError(`On ${DAY_NAMES[item.dayOfWeek]}, start time must be earlier than end time.`);
        return;
      }
    }

    try {
      setSavingHours(true);
      setError('');
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api/v1'}/staff/${staffId}/working-hours`,
        {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ schedule: hoursState }),
        },
      );

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.message || 'Failed to save working hours');
      }

      setSuccess('Weekly schedule saved successfully!');
      loadData();
      setTimeout(() => setSuccess(''), 3000);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSavingHours(false);
    }
  };

  // --- ADD BREAK ---
  const handleAddBreak = async (e: React.FormEvent) => {
    e.preventDefault();
    setBreakError('');

    if (breakStart >= breakEnd) {
      setBreakError('Break start time must be before end time');
      return;
    }

    const token = localStorage.getItem('access_token');
    if (!token) return;

    try {
      setSavingBreak(true);
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api/v1'}/staff/${staffId}/breaks`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            dayOfWeek: Number(breakDay),
            startTime: breakStart,
            endTime: breakEnd,
          }),
        },
      );

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || 'Failed to add break');
      }

      setSuccess('Break scheduled successfully!');
      setIsBreakModalOpen(false);
      loadData();
      setTimeout(() => setSuccess(''), 3000);
    } catch (err: any) {
      setBreakError(err.message);
    } finally {
      setSavingBreak(false);
    }
  };

  const handleDeleteBreak = async (breakId: string) => {
    if (!confirm('Remove this break period?')) return;
    const token = localStorage.getItem('access_token');
    if (!token) return;

    try {
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api/v1'}/staff/${staffId}/breaks/${breakId}`,
        {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${token}` },
        },
      );

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.message || 'Failed to delete break');
      }

      setSuccess('Break removed.');
      loadData();
      setTimeout(() => setSuccess(''), 3000);
    } catch (err: any) {
      setError(err.message);
    }
  };

  // --- ADD LEAVE ---
  const handleAddLeave = async (e: React.FormEvent) => {
    e.preventDefault();
    setLeaveError('');

    if (!leaveStart || !leaveEnd) {
      setLeaveError('Start date and end date are required');
      return;
    }
    if (leaveStart > leaveEnd) {
      setLeaveError('Start date cannot be after end date');
      return;
    }

    const token = localStorage.getItem('access_token');
    if (!token) return;

    try {
      setSavingLeave(true);
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api/v1'}/staff/${staffId}/leaves`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            startDate: leaveStart,
            endDate: leaveEnd,
            reason: leaveReason.trim() || undefined,
          }),
        },
      );

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || 'Failed to add leave');
      }

      setSuccess('Staff leave registered successfully!');
      setIsLeaveModalOpen(false);
      setLeaveStart('');
      setLeaveEnd('');
      setLeaveReason('');
      loadData();
      setTimeout(() => setSuccess(''), 3000);
    } catch (err: any) {
      setLeaveError(err.message);
    } finally {
      setSavingLeave(false);
    }
  };

  const handleDeleteLeave = async (leaveId: string) => {
    if (!confirm('Remove this leave record?')) return;
    const token = localStorage.getItem('access_token');
    if (!token) return;

    try {
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api/v1'}/staff/${staffId}/leaves/${leaveId}`,
        {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${token}` },
        },
      );

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.message || 'Failed to delete leave');
      }

      setSuccess('Leave removed.');
      loadData();
      setTimeout(() => setSuccess(''), 3000);
    } catch (err: any) {
      setError(err.message);
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center p-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div>
      </div>
    );
  }

  if (!staff) {
    return (
      <div className="bg-white p-8 rounded-xl border border-slate-200 text-center">
        <p className="text-red-500 font-semibold">{error || 'Staff member not found'}</p>
        <Link
          href="/dashboard/staff"
          className="mt-4 inline-block px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-semibold"
        >
          ← Back to Staff Directory
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Back button & Staff profile header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center space-x-3">
          <Link
            href="/dashboard/staff"
            className="p-2 bg-white border border-slate-200 rounded-lg text-slate-600 hover:text-slate-900 hover:bg-slate-50 transition"
            title="Back to Staff"
          >
            ←
          </Link>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-bold text-slate-900">{staff.name}</h1>
              <span
                className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                  staff.active
                    ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                    : 'bg-slate-100 text-slate-600 border border-slate-200'
                }`}
              >
                {staff.active ? 'Active Provider' : 'Inactive'}
              </span>
            </div>
            <p className="text-xs text-slate-500 mt-0.5">
              {staff.phone || 'No phone'} • {staff.email || 'No email'}
            </p>
          </div>
        </div>
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

      {/* Sub-Navigation Tabs */}
      <div className="bg-white p-1 rounded-xl border border-slate-200 shadow-xs flex space-x-1 overflow-x-auto">
        {[
          { id: 'SERVICES', label: `Assigned Services (${selectedServiceIds.length})`, icon: '✂️' },
          { id: 'HOURS', label: 'Working Hours', icon: '🕒' },
          { id: 'BREAKS', label: `Breaks (${staff.breaks?.length || 0})`, icon: '☕' },
          { id: 'LEAVES', label: `Leaves (${staff.leaves?.length || 0})`, icon: '🏖️' },
        ].map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id as any)}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs sm:text-sm font-semibold whitespace-nowrap transition ${
              activeTab === tab.id
                ? 'bg-indigo-600 text-white shadow-xs'
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
            }`}
          >
            <span>{tab.icon}</span>
            <span>{tab.label}</span>
          </button>
        ))}
      </div>

      {/* TAB 1: SERVICES ASSIGNMENT */}
      {activeTab === 'SERVICES' && (
        <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-xs space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-4 border-b border-slate-100">
            <div>
              <h2 className="text-base font-bold text-slate-900">Assigned Services</h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Select which services {staff.name} is qualified to perform.
              </p>
            </div>
            <button
              onClick={handleSaveServices}
              disabled={savingServices}
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold rounded-lg shadow-xs transition disabled:opacity-50"
            >
              {savingServices ? 'Saving...' : 'Save Services'}
            </button>
          </div>

          {allServices.length === 0 ? (
            <div className="text-center py-8 text-slate-500 text-sm">
              No services found. <Link href="/dashboard/services" className="text-indigo-600 underline font-medium">Create services first</Link>.
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {allServices.map((svc) => {
                const isSelected = selectedServiceIds.includes(svc.id);
                return (
                  <label
                    key={svc.id}
                    className={`flex items-center p-3.5 rounded-xl border cursor-pointer transition select-none ${
                      isSelected
                        ? 'bg-indigo-50/60 border-indigo-300 ring-1 ring-indigo-500'
                        : 'bg-white border-slate-200 hover:bg-slate-50'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={(e) => {
                        if (e.target.checked) {
                          setSelectedServiceIds((prev) => [...prev, svc.id]);
                        } else {
                          setSelectedServiceIds((prev) => prev.filter((id) => id !== svc.id));
                        }
                      }}
                      className="w-4 h-4 text-indigo-600 rounded-sm border-slate-300 focus:ring-indigo-500"
                    />
                    <div className="ml-3">
                      <p className="text-sm font-bold text-slate-900">{svc.name}</p>
                      <p className="text-xs text-slate-500">
                        {svc.durationMinutes} mins • ₹{svc.price}
                      </p>
                    </div>
                  </label>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* TAB 2: WORKING HOURS */}
      {activeTab === 'HOURS' && (
        <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-xs space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-4 border-b border-slate-100">
            <div>
              <h2 className="text-base font-bold text-slate-900">Weekly Working Schedule</h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Enable or disable days and set operating shifts for {staff.name}.
              </p>
            </div>
            <button
              onClick={handleSaveHours}
              disabled={savingHours}
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold rounded-lg shadow-xs transition disabled:opacity-50"
            >
              {savingHours ? 'Saving Schedule...' : 'Save Schedule'}
            </button>
          </div>

          <div className="space-y-3">
            {hoursState.map((h, idx) => (
              <div
                key={h.dayOfWeek}
                className={`p-4 rounded-xl border transition flex flex-col sm:flex-row sm:items-center justify-between gap-4 ${
                  h.enabled
                    ? 'bg-white border-slate-200'
                    : 'bg-slate-50/70 border-dashed border-slate-200 opacity-60'
                }`}
              >
                <div className="flex items-center space-x-3 w-40">
                  <input
                    type="checkbox"
                    id={`day-${h.dayOfWeek}`}
                    checked={h.enabled}
                    onChange={(e) => {
                      const updated = [...hoursState];
                      updated[idx].enabled = e.target.checked;
                      setHoursState(updated);
                    }}
                    className="w-4 h-4 text-indigo-600 rounded-sm border-slate-300 focus:ring-indigo-500"
                  />
                  <label
                    htmlFor={`day-${h.dayOfWeek}`}
                    className="text-sm font-bold text-slate-900 cursor-pointer"
                  >
                    {DAY_NAMES[h.dayOfWeek]}
                  </label>
                </div>

                {h.enabled ? (
                  <div className="flex items-center space-x-3">
                    <div className="flex items-center space-x-1.5">
                      <span className="text-xs text-slate-500 font-medium">Start:</span>
                      <input
                        type="time"
                        value={h.startTime}
                        onChange={(e) => {
                          const updated = [...hoursState];
                          updated[idx].startTime = e.target.value;
                          setHoursState(updated);
                        }}
                        className="px-2.5 py-1.5 border border-slate-300 rounded-lg text-xs font-semibold focus:ring-2 focus:ring-indigo-500"
                      />
                    </div>
                    <span className="text-slate-400">→</span>
                    <div className="flex items-center space-x-1.5">
                      <span className="text-xs text-slate-500 font-medium">End:</span>
                      <input
                        type="time"
                        value={h.endTime}
                        onChange={(e) => {
                          const updated = [...hoursState];
                          updated[idx].endTime = e.target.value;
                          setHoursState(updated);
                        }}
                        className="px-2.5 py-1.5 border border-slate-300 rounded-lg text-xs font-semibold focus:ring-2 focus:ring-indigo-500"
                      />
                    </div>
                  </div>
                ) : (
                  <span className="text-xs font-semibold text-slate-400 italic">
                    Off / Closed
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* TAB 3: BREAKS */}
      {activeTab === 'BREAKS' && (
        <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-xs space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-4 border-b border-slate-100">
            <div>
              <h2 className="text-base font-bold text-slate-900">Scheduled Breaks</h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Breaks block out booking availability during working hours.
              </p>
            </div>
            <button
              onClick={() => {
                setBreakDay(1);
                setBreakStart('13:00');
                setBreakEnd('14:00');
                setBreakError('');
                setIsBreakModalOpen(true);
              }}
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold rounded-lg shadow-xs transition"
            >
              + Add Break
            </button>
          </div>

          {staff.breaks?.length === 0 ? (
            <div className="text-center py-8 text-slate-400 text-sm">
              No breaks configured for this staff member.
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
              {staff.breaks.map((b) => (
                <div
                  key={b.id}
                  className="p-4 rounded-xl border border-slate-200 bg-slate-50 flex items-center justify-between"
                >
                  <div>
                    <p className="text-xs font-bold text-indigo-700 uppercase tracking-wide">
                      {DAY_NAMES[b.dayOfWeek]}
                    </p>
                    <p className="text-sm font-semibold text-slate-900 mt-1">
                      {b.startTime} - {b.endTime}
                    </p>
                  </div>
                  <button
                    onClick={() => handleDeleteBreak(b.id)}
                    className="text-red-500 hover:text-red-700 p-1.5 text-xs font-bold"
                    title="Delete Break"
                  >
                    🗑️
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* TAB 4: LEAVES */}
      {activeTab === 'LEAVES' && (
        <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-xs space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-4 border-b border-slate-100">
            <div>
              <h2 className="text-base font-bold text-slate-900">Staff Leave & Vacations</h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Full-day leaves remove the staff member from the booking engine schedule.
              </p>
            </div>
            <button
              onClick={() => {
                setLeaveStart('');
                setLeaveEnd('');
                setLeaveReason('');
                setLeaveError('');
                setIsLeaveModalOpen(true);
              }}
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold rounded-lg shadow-xs transition"
            >
              + Record Leave
            </button>
          </div>

          {staff.leaves?.length === 0 ? (
            <div className="text-center py-8 text-slate-400 text-sm">
              No upcoming leaves recorded.
            </div>
          ) : (
            <div className="space-y-3">
              {staff.leaves.map((l) => (
                <div
                  key={l.id}
                  className="p-4 rounded-xl border border-slate-200 bg-slate-50 flex flex-col sm:flex-row sm:items-center justify-between gap-2"
                >
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-bold text-slate-900">
                        {new Date(l.startDate).toLocaleDateString()} → {new Date(l.endDate).toLocaleDateString()}
                      </span>
                    </div>
                    {l.reason && (
                      <p className="text-xs text-slate-500 mt-1">Reason: {l.reason}</p>
                    )}
                  </div>
                  <button
                    onClick={() => handleDeleteLeave(l.id)}
                    className="text-red-500 hover:text-red-700 p-1.5 text-xs font-bold self-end sm:self-auto"
                  >
                    Remove Leave 🗑️
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Add Break Modal */}
      {isBreakModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4 backdrop-blur-xs">
          <div className="bg-white rounded-2xl max-w-sm w-full p-6 shadow-xl border border-slate-200">
            <h3 className="text-base font-bold text-slate-900 pb-3 border-b border-slate-100">
              Add Staff Break
            </h3>

            {breakError && (
              <div className="mt-3 p-2.5 bg-red-50 border border-red-200 text-red-700 text-xs rounded-lg">
                {breakError}
              </div>
            )}

            <form onSubmit={handleAddBreak} className="mt-4 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Day of Week</label>
                <select
                  value={breakDay}
                  onChange={(e) => setBreakDay(Number(e.target.value))}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-indigo-500"
                >
                  {DAY_NAMES.map((dName, dIdx) => (
                    <option key={dIdx} value={dIdx}>
                      {dName}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Start Time</label>
                  <input
                    type="time"
                    required
                    value={breakStart}
                    onChange={(e) => setBreakStart(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs font-semibold"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">End Time</label>
                  <input
                    type="time"
                    required
                    value={breakEnd}
                    onChange={(e) => setBreakEnd(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs font-semibold"
                  />
                </div>
              </div>

              <div className="flex justify-end space-x-2 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setIsBreakModalOpen(false)}
                  className="px-3 py-1.5 border border-slate-300 text-slate-700 text-xs font-semibold rounded-lg hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingBreak}
                  className="px-4 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold rounded-lg shadow-xs"
                >
                  {savingBreak ? 'Adding...' : 'Add Break'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Add Leave Modal */}
      {isLeaveModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4 backdrop-blur-xs">
          <div className="bg-white rounded-2xl max-w-sm w-full p-6 shadow-xl border border-slate-200">
            <h3 className="text-base font-bold text-slate-900 pb-3 border-b border-slate-100">
              Record Staff Leave
            </h3>

            {leaveError && (
              <div className="mt-3 p-2.5 bg-red-50 border border-red-200 text-red-700 text-xs rounded-lg">
                {leaveError}
              </div>
            )}

            <form onSubmit={handleAddLeave} className="mt-4 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Start Date *</label>
                <input
                  type="date"
                  required
                  value={leaveStart}
                  onChange={(e) => setLeaveStart(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">End Date *</label>
                <input
                  type="date"
                  required
                  value={leaveEnd}
                  onChange={(e) => setLeaveEnd(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Reason (Optional)</label>
                <input
                  type="text"
                  placeholder="e.g. Personal vacation, Medical"
                  value={leaveReason}
                  onChange={(e) => setLeaveReason(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              <div className="flex justify-end space-x-2 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setIsLeaveModalOpen(false)}
                  className="px-3 py-1.5 border border-slate-300 text-slate-700 text-xs font-semibold rounded-lg hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingLeave}
                  className="px-4 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold rounded-lg shadow-xs"
                >
                  {savingLeave ? 'Recording...' : 'Record Leave'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
