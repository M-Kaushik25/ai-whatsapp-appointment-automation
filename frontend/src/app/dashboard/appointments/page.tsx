"use client";

import { useEffect, useState, useMemo, useCallback } from 'react';
import { useRouter } from 'next/navigation';

interface AppointmentItem {
  id: string;
  startAt: string;
  endAt: string;
  status: 'PENDING' | 'CONFIRMED' | 'CANCELLED' | 'COMPLETED' | 'NO_SHOW';
  price: number;
  depositAmount: number;
  paymentStatus: string;
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
  createdAt: string;
  updatedAt: string;
}

interface ServiceItem {
  id: string;
  name: string;
  durationMinutes: number;
  price: number;
  depositType: string;
  depositValue: number;
  active: boolean;
}

interface StaffItem {
  id: string;
  name: string;
  active: boolean;
}

interface SlotItem {
  start: string;
  end: string;
  startTime: string;
  endTime: string;
  available: boolean;
  staffId?: string;
  staffName?: string;
}

type ViewMode = 'DAY' | 'WEEK' | 'LIST';

export default function AppointmentsPage() {
  const router = useRouter();

  // Core Data
  const [appointments, setAppointments] = useState<AppointmentItem[]>([]);
  const [services, setServices] = useState<ServiceItem[]>([]);
  const [staffList, setStaffList] = useState<StaffItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Calendar View & Navigation State
  const [viewMode, setViewMode] = useState<ViewMode>('DAY');
  const [currentDate, setCurrentDate] = useState<string>(() => new Date().toISOString().slice(0, 10));

  // Search & Filter State
  const [searchQuery, setSearchQuery] = useState('');
  const [staffFilter, setStaffFilter] = useState('ALL');
  const [serviceFilter, setServiceFilter] = useState('ALL');
  const [statusFilter, setStatusFilter] = useState('ALL');

  // Detail Modal State
  const [detailAppt, setDetailAppt] = useState<AppointmentItem | null>(null);
  const [isDetailModalOpen, setIsDetailModalOpen] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);

  // New Appointment Modal State
  const [isNewModalOpen, setIsNewModalOpen] = useState(false);
  const [selectedServiceId, setSelectedServiceId] = useState('');
  const [selectedStaffId, setSelectedStaffId] = useState('ANY');
  const [bookingDate, setBookingDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [availableSlots, setAvailableSlots] = useState<SlotItem[]>([]);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [selectedSlot, setSelectedSlot] = useState<SlotItem | null>(null);
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [customerEmail, setCustomerEmail] = useState('');
  const [notes, setNotes] = useState('');
  const [modalError, setModalError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Reschedule Modal State
  const [isRescheduleModalOpen, setIsRescheduleModalOpen] = useState(false);
  const [rescheduleAppt, setRescheduleAppt] = useState<AppointmentItem | null>(null);
  const [rescheduleDate, setRescheduleDate] = useState('');
  const [rescheduleSlots, setRescheduleSlots] = useState<SlotItem[]>([]);
  const [loadingRescheduleSlots, setLoadingRescheduleSlots] = useState(false);
  const [selectedRescheduleSlot, setSelectedRescheduleSlot] = useState<SlotItem | null>(null);
  const [rescheduleError, setRescheduleError] = useState('');
  const [rescheduling, setRescheduling] = useState(false);

  // Load Appointments based on current date / week
  const loadAppointments = useCallback(async () => {
    const token = localStorage.getItem('access_token');
    if (!token) {
      router.push('/login');
      return;
    }

    try {
      setLoading(true);
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api/v1';
      const headers = { Authorization: `Bearer ${token}` };

      let queryUrl = `${apiUrl}/appointments?`;

      if (viewMode === 'DAY') {
        queryUrl += `date=${currentDate}`;
      } else if (viewMode === 'WEEK') {
        const curr = new Date(currentDate);
        const day = curr.getDay(); // 0 (Sun) to 6 (Sat)
        const diff = curr.getDate() - day + (day === 0 ? -6 : 1); // Monday
        const monday = new Date(curr.setDate(diff));
        const sunday = new Date(monday);
        sunday.setDate(monday.getDate() + 6);

        const startIso = monday.toISOString().slice(0, 10);
        const endIso = sunday.toISOString().slice(0, 10);
        queryUrl += `startDate=${startIso}&endDate=${endIso}`;
      } else {
        // List View: Fetch all or search
        if (searchQuery.trim()) {
          queryUrl += `search=${encodeURIComponent(searchQuery.trim())}&`;
        }
      }

      if (staffFilter !== 'ALL') queryUrl += `&staffId=${staffFilter}`;
      if (serviceFilter !== 'ALL') queryUrl += `&serviceId=${serviceFilter}`;
      if (statusFilter !== 'ALL') queryUrl += `&status=${statusFilter}`;

      const [apptRes, svcRes, staffRes] = await Promise.all([
        fetch(queryUrl, { headers }),
        fetch(`${apiUrl}/services?active=true`, { headers }),
        fetch(`${apiUrl}/staff?active=true`, { headers }),
      ]);

      if (!apptRes.ok) {
        if (apptRes.status === 401) {
          localStorage.removeItem('access_token');
          router.push('/login');
          return;
        }
        throw new Error('Failed to load appointments');
      }

      const data = await apptRes.json();
      setAppointments(Array.isArray(data) ? data : data.items || []);
      if (svcRes.ok) setServices(await svcRes.json());
      if (staffRes.ok) setStaffList(await staffRes.json());
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to load appointments';
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [currentDate, viewMode, staffFilter, serviceFilter, statusFilter, searchQuery, router]);

  useEffect(() => {
    loadAppointments();
  }, [loadAppointments]);

  // Date Navigation Helpers
  const handlePrevDate = () => {
    const d = new Date(currentDate);
    if (viewMode === 'WEEK') {
      d.setDate(d.getDate() - 7);
    } else {
      d.setDate(d.getDate() - 1);
    }
    setCurrentDate(d.toISOString().slice(0, 10));
  };

  const handleNextDate = () => {
    const d = new Date(currentDate);
    if (viewMode === 'WEEK') {
      d.setDate(d.getDate() + 7);
    } else {
      d.setDate(d.getDate() + 1);
    }
    setCurrentDate(d.toISOString().slice(0, 10));
  };

  const handleToday = () => {
    setCurrentDate(new Date().toISOString().slice(0, 10));
  };

  // Fetch Available Slots when booking modal selections change
  useEffect(() => {
    if (!isNewModalOpen || !selectedServiceId || !bookingDate) {
      setAvailableSlots([]);
      return;
    }

    const fetchSlots = async () => {
      const token = localStorage.getItem('access_token');
      if (!token) return;

      try {
        setLoadingSlots(true);
        setSelectedSlot(null);
        setModalError('');
        const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api/v1';
        const res = await fetch(
          `${apiUrl}/availability?serviceId=${selectedServiceId}&staffId=${selectedStaffId}&date=${bookingDate}`,
          {
            headers: { Authorization: `Bearer ${token}` },
          },
        );

        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.message || 'Failed to fetch slots');
        }

        const data = await res.json();
        setAvailableSlots(data.slots || []);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Error fetching slots';
        setModalError(msg);
      } finally {
        setLoadingSlots(false);
      }
    };

    fetchSlots();
  }, [isNewModalOpen, selectedServiceId, selectedStaffId, bookingDate]);

  // Fetch Available Slots when rescheduling selections change
  useEffect(() => {
    if (!isRescheduleModalOpen || !rescheduleAppt || !rescheduleDate) {
      setRescheduleSlots([]);
      return;
    }

    const fetchRescheduleSlots = async () => {
      const token = localStorage.getItem('access_token');
      if (!token) return;

      try {
        setLoadingRescheduleSlots(true);
        setSelectedRescheduleSlot(null);
        setRescheduleError('');
        const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api/v1';
        const res = await fetch(
          `${apiUrl}/availability?serviceId=${rescheduleAppt.service.id}&staffId=${rescheduleAppt.staff.id}&date=${rescheduleDate}`,
          {
            headers: { Authorization: `Bearer ${token}` },
          },
        );

        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.message || 'Failed to fetch slots');
        }

        const data = await res.json();
        setRescheduleSlots(data.slots || []);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Error fetching slots';
        setRescheduleError(msg);
      } finally {
        setLoadingRescheduleSlots(false);
      }
    };

    fetchRescheduleSlots();
  }, [isRescheduleModalOpen, rescheduleAppt, rescheduleDate]);

  // STATUS TRANSITION ACTIONS
  const handleStatusTransition = async (action: 'confirm' | 'complete' | 'no-show' | 'cancel', id: string) => {
    const token = localStorage.getItem('access_token');
    if (!token) return;

    try {
      setActionLoading(true);
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api/v1';
      const res = await fetch(`${apiUrl}/appointments/${id}/${action}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.message || `Failed to ${action} appointment`);
      }

      setSuccess(`Appointment ${action}ed successfully.`);
      setIsDetailModalOpen(false);
      setDetailAppt(null);
      loadAppointments();
      setTimeout(() => setSuccess(''), 3000);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Action failed';
      setError(msg);
      setTimeout(() => setError(''), 4000);
    } finally {
      setActionLoading(false);
    }
  };

  // CREATE APPOINTMENT
  const handleCreateAppointment = async (e: React.FormEvent) => {
    e.preventDefault();
    setModalError('');

    if (!selectedServiceId) {
      setModalError('Please select a service');
      return;
    }
    if (!selectedSlot) {
      setModalError('Please select an available time slot');
      return;
    }
    if (!customerName.trim() || !customerPhone.trim()) {
      setModalError('Customer name and phone number are required');
      return;
    }

    const token = localStorage.getItem('access_token');
    if (!token) return;

    try {
      setSubmitting(true);
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api/v1'}/appointments`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            serviceId: selectedServiceId,
            staffId: selectedStaffId !== 'ANY' ? selectedStaffId : selectedSlot.staffId,
            startAt: selectedSlot.start,
            customerName: customerName.trim(),
            customerPhone: customerPhone.trim(),
            customerEmail: customerEmail.trim() || undefined,
            notes: notes.trim() || undefined,
          }),
        },
      );

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.message || 'Failed to create appointment');
      }

      setSuccess('Appointment booked successfully!');
      setIsNewModalOpen(false);
      setCustomerName('');
      setCustomerPhone('');
      setCustomerEmail('');
      setNotes('');
      setSelectedSlot(null);
      loadAppointments();
      setTimeout(() => setSuccess(''), 3000);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Booking failed';
      setModalError(msg);
    } finally {
      setSubmitting(false);
    }
  };

  // RESCHEDULE APPOINTMENT
  const handleRescheduleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!rescheduleAppt || !selectedRescheduleSlot) {
      setRescheduleError('Please choose an available slot');
      return;
    }

    const token = localStorage.getItem('access_token');
    if (!token) return;

    try {
      setRescheduling(true);
      setRescheduleError('');
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api/v1'}/appointments/${rescheduleAppt.id}/reschedule`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            startAt: selectedRescheduleSlot.start,
          }),
        },
      );

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || 'Failed to reschedule appointment');
      }

      setSuccess('Appointment rescheduled successfully!');
      setIsRescheduleModalOpen(false);
      setRescheduleAppt(null);
      loadAppointments();
      setTimeout(() => setSuccess(''), 3000);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Reschedule failed';
      setRescheduleError(msg);
    } finally {
      setRescheduling(false);
    }
  };

  // Calculate Week Days for Week View
  const weekDays = useMemo(() => {
    const curr = new Date(currentDate);
    const day = curr.getDay();
    const diff = curr.getDate() - day + (day === 0 ? -6 : 1);
    const monday = new Date(curr.setDate(diff));

    const days: { dateStr: string; label: string; dayName: string }[] = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(monday);
      d.setDate(monday.getDate() + i);
      const dateStr = d.toISOString().slice(0, 10);
      days.push({
        dateStr,
        dayName: d.toLocaleDateString(undefined, { weekday: 'short' }),
        label: d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
      });
    }
    return days;
  }, [currentDate]);

  // Hourly slots for Day View (08:00 to 20:00)
  const hoursGrid = useMemo(() => {
    const hours: string[] = [];
    for (let h = 8; h <= 20; h++) {
      hours.push(`${h.toString().padStart(2, '0')}:00`);
    }
    return hours;
  }, []);

  const selectedServiceObj = services.find((s) => s.id === selectedServiceId);

  return (
    <div className="space-y-6">
      {/* Top Header & View Mode Switcher */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white p-5 rounded-2xl border border-slate-200 shadow-xs">
        <div>
          <h1 className="text-2xl font-extrabold text-slate-900 tracking-tight">Appointment Calendar</h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Full management, calendar timeline, status lifecycle, and concurrency-safe bookings.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {/* View Mode Toggle Buttons */}
          <div className="bg-slate-100 p-1 rounded-xl flex items-center space-x-1 text-xs font-semibold">
            <button
              onClick={() => setViewMode('DAY')}
              className={`px-3 py-1.5 rounded-lg transition ${
                viewMode === 'DAY' ? 'bg-white text-indigo-700 shadow-xs font-bold' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Day View
            </button>
            <button
              onClick={() => setViewMode('WEEK')}
              className={`px-3 py-1.5 rounded-lg transition ${
                viewMode === 'WEEK' ? 'bg-white text-indigo-700 shadow-xs font-bold' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Week View
            </button>
            <button
              onClick={() => setViewMode('LIST')}
              className={`px-3 py-1.5 rounded-lg transition ${
                viewMode === 'LIST' ? 'bg-white text-indigo-700 shadow-xs font-bold' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              List View
            </button>
          </div>

          {/* Book Appointment Button */}
          <button
            onClick={() => {
              setSelectedServiceId(services[0]?.id || '');
              setSelectedStaffId('ANY');
              setBookingDate(currentDate);
              setModalError('');
              setIsNewModalOpen(true);
            }}
            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold rounded-xl shadow-xs transition flex items-center gap-1.5"
          >
            <span>+</span> Book Appointment
          </button>
        </div>
      </div>

      {/* Date Navigation & Filter Controls Bar */}
      <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs flex flex-wrap items-center justify-between gap-4">
        {/* Date Navigator */}
        <div className="flex items-center space-x-2">
          <button
            onClick={handlePrevDate}
            className="w-8 h-8 rounded-lg border border-slate-200 flex items-center justify-center text-slate-600 hover:bg-slate-50 text-sm font-bold"
            title="Previous"
          >
            ‹
          </button>
          <button
            onClick={handleToday}
            className="px-3 py-1.5 text-xs font-semibold text-slate-700 border border-slate-200 rounded-lg hover:bg-slate-50"
          >
            Today
          </button>
          <button
            onClick={handleNextDate}
            className="w-8 h-8 rounded-lg border border-slate-200 flex items-center justify-center text-slate-600 hover:bg-slate-50 text-sm font-bold"
            title="Next"
          >
            ›
          </button>

          <input
            type="date"
            value={currentDate}
            onChange={(e) => setCurrentDate(e.target.value)}
            className="px-3 py-1.5 border border-slate-300 rounded-lg text-xs bg-white focus:ring-2 focus:ring-indigo-500 font-medium"
          />

          <span className="text-xs font-bold text-slate-800 ml-2 hidden sm:inline">
            {viewMode === 'WEEK'
              ? `Week of ${weekDays[0]?.label} - ${weekDays[6]?.label}`
              : new Date(currentDate).toLocaleDateString(undefined, {
                  weekday: 'long',
                  month: 'long',
                  day: 'numeric',
                  year: 'numeric',
                })}
          </span>
        </div>

        {/* Filters & Search */}
        <div className="flex flex-wrap items-center gap-2 w-full lg:w-auto">
          {/* Search Box */}
          <input
            type="text"
            placeholder="Search customer, phone..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="px-3 py-1.5 border border-slate-300 rounded-lg text-xs bg-white focus:ring-2 focus:ring-indigo-500 w-full sm:w-44"
          />

          {/* Staff Filter */}
          <select
            value={staffFilter}
            onChange={(e) => setStaffFilter(e.target.value)}
            className="px-3 py-1.5 border border-slate-300 rounded-lg text-xs bg-white focus:ring-2 focus:ring-indigo-500"
          >
            <option value="ALL">All Staff</option>
            {staffList.map((st) => (
              <option key={st.id} value={st.id}>
                {st.name}
              </option>
            ))}
          </select>

          {/* Service Filter */}
          <select
            value={serviceFilter}
            onChange={(e) => setServiceFilter(e.target.value)}
            className="px-3 py-1.5 border border-slate-300 rounded-lg text-xs bg-white focus:ring-2 focus:ring-indigo-500"
          >
            <option value="ALL">All Services</option>
            {services.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>

          {/* Status Filter */}
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="px-3 py-1.5 border border-slate-300 rounded-lg text-xs bg-white focus:ring-2 focus:ring-indigo-500"
          >
            <option value="ALL">All Statuses</option>
            <option value="CONFIRMED">Confirmed</option>
            <option value="PENDING">Pending</option>
            <option value="COMPLETED">Completed</option>
            <option value="NO_SHOW">No-Show</option>
            <option value="CANCELLED">Cancelled</option>
          </select>
        </div>
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

      {/* ==================================================== */}
      {/* 1. DAY CALENDAR VIEW (TIMELINE) */}
      {/* ==================================================== */}
      {viewMode === 'DAY' && (
        <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-xs">
          <div className="flex items-center justify-between pb-4 border-b border-slate-100 mb-4">
            <h2 className="text-sm font-bold text-slate-800 uppercase tracking-wider">
              Schedule Timeline ({appointments.length} appointment{appointments.length === 1 ? '' : 's'})
            </h2>
            <span className="text-xs text-slate-500 font-medium">Click any appointment to view details or update status</span>
          </div>

          {loading ? (
            <div className="py-16 flex justify-center">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div>
            </div>
          ) : appointments.length === 0 ? (
            <div className="py-16 text-center">
              <p className="text-3xl text-slate-300 mb-2">🗓️</p>
              <h3 className="text-sm font-semibold text-slate-700">No appointments for this date</h3>
              <p className="text-xs text-slate-400 mt-1">Click &quot;+ Book Appointment&quot; above to schedule one.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {hoursGrid.map((hour) => {
                const hourNum = parseInt(hour.split(':')[0], 10);
                const matchingAppts = appointments.filter((a) => {
                  const s = new Date(a.startAt);
                  return s.getUTCHours() === hourNum;
                });

                return (
                  <div key={hour} className="flex items-start gap-4 pt-2">
                    <div className="w-14 text-right pt-2">
                      <span className="text-xs font-bold text-slate-400 font-mono">{hour}</span>
                    </div>

                    <div className="flex-1 min-h-[44px] border-t border-slate-100 pt-2 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                      {matchingAppts.map((appt) => {
                        const s = new Date(appt.startAt);
                        const e = new Date(appt.endAt);
                        return (
                          <div
                            key={appt.id}
                            onClick={() => {
                              setDetailAppt(appt);
                              setIsDetailModalOpen(true);
                            }}
                            className={`p-3 rounded-xl border cursor-pointer transition shadow-xs hover:shadow-md ${
                              appt.status === 'CONFIRMED'
                                ? 'bg-emerald-50/40 border-emerald-200 hover:border-emerald-300'
                                : appt.status === 'COMPLETED'
                                ? 'bg-blue-50/40 border-blue-200 hover:border-blue-300'
                                : appt.status === 'CANCELLED'
                                ? 'bg-rose-50/30 border-rose-200 opacity-60'
                                : appt.status === 'NO_SHOW'
                                ? 'bg-slate-100 border-slate-300 opacity-75'
                                : 'bg-amber-50/40 border-amber-200 hover:border-amber-300'
                            }`}
                          >
                            <div className="flex items-center justify-between gap-1">
                              <span className="text-[11px] font-extrabold text-slate-900">
                                {s.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} -{' '}
                                {e.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                              </span>
                              <span
                                className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                                  appt.status === 'CONFIRMED'
                                    ? 'bg-emerald-100 text-emerald-800'
                                    : appt.status === 'COMPLETED'
                                    ? 'bg-blue-100 text-blue-800'
                                    : appt.status === 'CANCELLED'
                                    ? 'bg-rose-100 text-rose-800'
                                    : 'bg-amber-100 text-amber-800'
                                }`}
                              >
                                {appt.status}
                              </span>
                            </div>

                            <p className="text-xs font-bold text-slate-900 mt-1.5">{appt.customer.name}</p>
                            <p className="text-[11px] text-slate-600 mt-0.5">
                              {appt.service.name} ({appt.service.durationMinutes}m) •{' '}
                              <span className="text-indigo-700 font-semibold">{appt.staff.name}</span>
                            </p>
                            <div className="mt-2 pt-1.5 border-t border-slate-200/50 flex justify-between text-[10px] text-slate-500">
                              <span>₹{appt.price}</span>
                              {appt.depositAmount > 0 && <span>Deposit: ₹{appt.depositAmount}</span>}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ==================================================== */}
      {/* 2. WEEK CALENDAR VIEW */}
      {/* ==================================================== */}
      {viewMode === 'WEEK' && (
        <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-xs overflow-x-auto">
          <div className="grid grid-cols-7 gap-3 min-w-[760px]">
            {weekDays.map((day) => {
              const dayAppts = appointments.filter((a) => {
                return new Date(a.startAt).toISOString().slice(0, 10) === day.dateStr;
              });

              const isToday = day.dateStr === new Date().toISOString().slice(0, 10);

              return (
                <div key={day.dateStr} className="flex flex-col rounded-xl border border-slate-200 bg-slate-50/50 p-2.5 min-h-[400px]">
                  <div className={`text-center pb-2 border-b border-slate-200 ${isToday ? 'text-indigo-600 font-black' : 'text-slate-700'}`}>
                    <span className="text-xs uppercase font-bold block">{day.dayName}</span>
                    <span className="text-sm font-extrabold">{day.label}</span>
                  </div>

                  <div className="mt-2 space-y-2 flex-1">
                    {dayAppts.length === 0 ? (
                      <p className="text-[10px] text-slate-400 text-center py-6">No bookings</p>
                    ) : (
                      dayAppts.map((appt) => {
                        const s = new Date(appt.startAt);
                        return (
                          <div
                            key={appt.id}
                            onClick={() => {
                              setDetailAppt(appt);
                              setIsDetailModalOpen(true);
                            }}
                            className={`p-2 rounded-lg border text-left cursor-pointer transition ${
                              appt.status === 'CONFIRMED'
                                ? 'bg-emerald-50 border-emerald-200 hover:border-emerald-300'
                                : appt.status === 'COMPLETED'
                                ? 'bg-blue-50 border-blue-200 hover:border-blue-300'
                                : appt.status === 'CANCELLED'
                                ? 'bg-rose-50 border-rose-200 opacity-50'
                                : 'bg-amber-50 border-amber-200 hover:border-amber-300'
                            }`}
                          >
                            <span className="text-[10px] font-bold text-slate-800 block">
                              {s.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            </span>
                            <p className="text-[11px] font-bold text-slate-900 truncate mt-0.5">{appt.customer.name}</p>
                            <p className="text-[10px] text-slate-500 truncate">{appt.service.name}</p>
                            <p className="text-[10px] font-semibold text-indigo-700 truncate">{appt.staff.name}</p>
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ==================================================== */}
      {/* 3. LIST VIEW */}
      {/* ==================================================== */}
      {viewMode === 'LIST' && (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
          <div className="p-4 border-b border-slate-100 flex justify-between items-center">
            <span className="text-xs font-bold text-slate-700 uppercase tracking-wider">
              Appointments ({appointments.length})
            </span>
          </div>

          {loading ? (
            <div className="py-12 flex justify-center">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div>
            </div>
          ) : appointments.length === 0 ? (
            <div className="p-12 text-center text-slate-500 text-xs">No appointments match the criteria.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 text-slate-500 font-semibold uppercase tracking-wider border-b border-slate-100">
                  <tr>
                    <th className="py-3 px-4">Date & Time</th>
                    <th className="py-3 px-4">Customer</th>
                    <th className="py-3 px-4">Service</th>
                    <th className="py-3 px-4">Staff</th>
                    <th className="py-3 px-4">Price</th>
                    <th className="py-3 px-4">Status</th>
                    <th className="py-3 px-4 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-slate-700">
                  {appointments.map((appt) => {
                    const s = new Date(appt.startAt);
                    const e = new Date(appt.endAt);
                    return (
                      <tr key={appt.id} className="hover:bg-slate-50/60 transition">
                        <td className="py-3 px-4 font-bold text-slate-900">
                          {s.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} <br />
                          <span className="text-[11px] font-normal text-slate-500">
                            {s.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} -{' '}
                            {e.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </span>
                        </td>
                        <td className="py-3 px-4">
                          <span className="font-semibold text-slate-900 block">{appt.customer.name}</span>
                          <span className="text-[11px] text-slate-400">{appt.customer.phone}</span>
                        </td>
                        <td className="py-3 px-4">
                          <span className="font-medium text-slate-800">{appt.service.name}</span>
                          <span className="text-[10px] text-slate-400 block">{appt.service.durationMinutes} mins</span>
                        </td>
                        <td className="py-3 px-4 font-semibold text-indigo-700">{appt.staff.name}</td>
                        <td className="py-3 px-4 font-bold text-slate-900">₹{appt.price}</td>
                        <td className="py-3 px-4">
                          <span
                            className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold ${
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
                        </td>
                        <td className="py-3 px-4 text-right">
                          <button
                            onClick={() => {
                              setDetailAppt(appt);
                              setIsDetailModalOpen(true);
                            }}
                            className="px-2.5 py-1 text-xs font-semibold text-indigo-600 hover:bg-indigo-50 rounded-md transition"
                          >
                            Inspect
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ==================================================== */}
      {/* 4. APPOINTMENT DETAIL MODAL */}
      {/* ==================================================== */}
      {isDetailModalOpen && detailAppt && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4 backdrop-blur-xs">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-2xl border border-slate-200 max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-start pb-3 border-b border-slate-100">
              <div>
                <span className="text-[11px] uppercase tracking-wider font-bold text-indigo-600">Appointment Details</span>
                <h3 className="text-lg font-extrabold text-slate-900 mt-0.5">{detailAppt.service.name}</h3>
              </div>
              <button
                onClick={() => setIsDetailModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 text-lg font-bold"
              >
                ✕
              </button>
            </div>

            <div className="mt-4 space-y-4 text-xs">
              {/* Status Header */}
              <div className="flex justify-between items-center p-3 bg-slate-50 rounded-xl border border-slate-200">
                <span className="text-slate-500 font-medium">Status</span>
                <span
                  className={`px-3 py-1 rounded-full text-xs font-extrabold ${
                    detailAppt.status === 'CONFIRMED'
                      ? 'bg-emerald-100 text-emerald-800'
                      : detailAppt.status === 'COMPLETED'
                      ? 'bg-blue-100 text-blue-800'
                      : detailAppt.status === 'CANCELLED'
                      ? 'bg-rose-100 text-rose-800'
                      : 'bg-amber-100 text-amber-800'
                  }`}
                >
                  {detailAppt.status}
                </span>
              </div>

              {/* Timing */}
              <div className="grid grid-cols-2 gap-3 p-3 bg-slate-50 rounded-xl border border-slate-200">
                <div>
                  <span className="text-slate-400 block font-semibold text-[10px] uppercase">Date</span>
                  <p className="font-bold text-slate-900 mt-0.5">
                    {new Date(detailAppt.startAt).toLocaleDateString(undefined, {
                      weekday: 'short',
                      month: 'short',
                      day: 'numeric',
                      year: 'numeric',
                    })}
                  </p>
                </div>
                <div>
                  <span className="text-slate-400 block font-semibold text-[10px] uppercase">Time</span>
                  <p className="font-bold text-slate-900 mt-0.5">
                    {new Date(detailAppt.startAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} -{' '}
                    {new Date(detailAppt.endAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} (
                    {detailAppt.service.durationMinutes}m)
                  </p>
                </div>
              </div>

              {/* Customer Info */}
              <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 space-y-1.5">
                <span className="text-slate-400 block font-semibold text-[10px] uppercase">Customer</span>
                <p className="font-bold text-slate-900 text-sm">{detailAppt.customer.name}</p>
                <p className="text-slate-600 font-mono">{detailAppt.customer.phone}</p>
                {detailAppt.customer.email && <p className="text-slate-500">{detailAppt.customer.email}</p>}
              </div>

              {/* Staff & Payment */}
              <div className="grid grid-cols-2 gap-3 p-3 bg-slate-50 rounded-xl border border-slate-200">
                <div>
                  <span className="text-slate-400 block font-semibold text-[10px] uppercase">Assigned Staff</span>
                  <p className="font-bold text-indigo-700 mt-0.5">{detailAppt.staff.name}</p>
                </div>
                <div>
                  <span className="text-slate-400 block font-semibold text-[10px] uppercase">Price & Deposit</span>
                  <p className="font-bold text-slate-900 mt-0.5">
                    ₹{detailAppt.price}{' '}
                    {detailAppt.depositAmount > 0 && (
                      <span className="text-slate-400 font-normal text-[11px]">(Deposit: ₹{detailAppt.depositAmount})</span>
                    )}
                  </p>
                </div>
              </div>

              {detailAppt.notes && (
                <div className="p-3 bg-amber-50/50 rounded-xl border border-amber-200/50">
                  <span className="text-amber-800 font-bold block text-[10px] uppercase">Notes</span>
                  <p className="text-slate-700 mt-0.5 italic">{detailAppt.notes}</p>
                </div>
              )}
            </div>

            {/* Context-Aware Action Buttons */}
            <div className="mt-6 pt-4 border-t border-slate-100 flex flex-wrap justify-end gap-2">
              {detailAppt.status === 'PENDING' && (
                <button
                  disabled={actionLoading}
                  onClick={() => handleStatusTransition('confirm', detailAppt.id)}
                  className="px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-lg text-xs transition"
                >
                  Confirm Appointment
                </button>
              )}

              {detailAppt.status === 'CONFIRMED' && (
                <>
                  <button
                    disabled={actionLoading}
                    onClick={() => handleStatusTransition('complete', detailAppt.id)}
                    className="px-3.5 py-1.5 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-lg text-xs transition"
                  >
                    Mark Completed
                  </button>
                  <button
                    disabled={actionLoading}
                    onClick={() => handleStatusTransition('no-show', detailAppt.id)}
                    className="px-3 py-1.5 bg-slate-600 hover:bg-slate-700 text-white font-bold rounded-lg text-xs transition"
                  >
                    Mark No-Show
                  </button>
                </>
              )}

              {detailAppt.status !== 'CANCELLED' && detailAppt.status !== 'COMPLETED' && (
                <>
                  <button
                    onClick={() => {
                      setRescheduleAppt(detailAppt);
                      setRescheduleDate(new Date(detailAppt.startAt).toISOString().slice(0, 10));
                      setIsDetailModalOpen(false);
                      setIsRescheduleModalOpen(true);
                    }}
                    className="px-3.5 py-1.5 border border-slate-300 text-slate-700 font-bold rounded-lg text-xs hover:bg-slate-50 transition"
                  >
                    Reschedule
                  </button>
                  <button
                    disabled={actionLoading}
                    onClick={() => {
                      if (confirm('Are you sure you want to cancel this appointment?')) {
                        handleStatusTransition('cancel', detailAppt.id);
                      }
                    }}
                    className="px-3.5 py-1.5 border border-rose-300 text-rose-600 font-bold rounded-lg text-xs hover:bg-rose-50 transition"
                  >
                    Cancel
                  </button>
                </>
              )}

              <button
                onClick={() => setIsDetailModalOpen(false)}
                className="px-3.5 py-1.5 border border-slate-200 text-slate-500 font-semibold rounded-lg text-xs hover:bg-slate-50"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ==================================================== */}
      {/* 5. CREATE APPOINTMENT MODAL */}
      {/* ==================================================== */}
      {isNewModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4 backdrop-blur-xs">
          <div className="bg-white rounded-2xl max-w-xl w-full p-6 shadow-xl border border-slate-200 max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center pb-3 border-b border-slate-100">
              <h3 className="text-lg font-bold text-slate-900">Create New Appointment</h3>
              <button
                onClick={() => setIsNewModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 text-lg font-bold"
              >
                ✕
              </button>
            </div>

            {modalError && (
              <div className="mt-4 p-3 bg-red-50 border border-red-200 text-red-700 text-xs rounded-lg">
                {modalError}
              </div>
            )}

            <form onSubmit={handleCreateAppointment} className="mt-4 space-y-4">
              {/* Service & Staff Selection */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Service *</label>
                  <select
                    required
                    value={selectedServiceId}
                    onChange={(e) => setSelectedServiceId(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-indigo-500"
                  >
                    {services.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name} ({s.durationMinutes}m - ₹{s.price})
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Staff Member *</label>
                  <select
                    value={selectedStaffId}
                    onChange={(e) => setSelectedStaffId(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-indigo-500"
                  >
                    <option value="ANY">Any Available Staff</option>
                    {staffList.map((st) => (
                      <option key={st.id} value={st.id}>
                        {st.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Date Selection */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Appointment Date *</label>
                <input
                  type="date"
                  required
                  value={bookingDate}
                  min={new Date().toISOString().slice(0, 10)}
                  onChange={(e) => setBookingDate(e.target.value)}
                  className="w-full px-3.5 py-2 border border-slate-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              {/* Live Available Slot Chips */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-2">
                  Select Available Time Slot *
                </label>
                {loadingSlots ? (
                  <div className="flex items-center space-x-2 py-4 text-xs text-slate-500 justify-center">
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-indigo-600"></div>
                    <span>Loading available slots...</span>
                  </div>
                ) : availableSlots.length === 0 ? (
                  <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl text-center text-xs text-slate-500">
                    No open slots on this date.
                  </div>
                ) : (
                  <div className="grid grid-cols-4 sm:grid-cols-6 gap-2 max-h-48 overflow-y-auto p-1">
                    {availableSlots.map((slot) => {
                      const isSelected = selectedSlot?.start === slot.start;
                      return (
                        <button
                          type="button"
                          key={slot.start}
                          onClick={() => setSelectedSlot(slot)}
                          className={`py-2 px-1 text-xs font-bold rounded-lg border transition ${
                            isSelected
                              ? 'bg-indigo-600 text-white border-indigo-600 shadow-xs ring-2 ring-indigo-300'
                              : 'bg-white text-slate-700 border-slate-200 hover:border-indigo-300 hover:bg-indigo-50/50'
                          }`}
                        >
                          {slot.startTime}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Customer Information */}
              <div className="p-4 bg-slate-50 rounded-xl border border-slate-200 space-y-3">
                <label className="block text-xs font-bold text-slate-800">
                  Customer Information
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-600 mb-0.5">Full Name *</label>
                    <input
                      type="text"
                      required
                      placeholder="e.g. Rahul Sharma"
                      value={customerName}
                      onChange={(e) => setCustomerName(e.target.value)}
                      className="w-full px-3 py-1.5 border border-slate-300 rounded-lg text-xs bg-white focus:ring-2 focus:ring-indigo-500"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-600 mb-0.5">Phone Number *</label>
                    <input
                      type="tel"
                      required
                      placeholder="+91 98765 43210"
                      value={customerPhone}
                      onChange={(e) => setCustomerPhone(e.target.value)}
                      className="w-full px-3 py-1.5 border border-slate-300 rounded-lg text-xs bg-white focus:ring-2 focus:ring-indigo-500"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 mb-0.5">Email (Optional)</label>
                  <input
                    type="email"
                    placeholder="customer@example.com"
                    value={customerEmail}
                    onChange={(e) => setCustomerEmail(e.target.value)}
                    className="w-full px-3 py-1.5 border border-slate-300 rounded-lg text-xs bg-white focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 mb-0.5">Special Notes</label>
                  <input
                    type="text"
                    placeholder="e.g. First time customer"
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    className="w-full px-3 py-1.5 border border-slate-300 rounded-lg text-xs bg-white focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
              </div>

              {/* Price & Deposit Summary */}
              {selectedServiceObj && (
                <div className="flex justify-between items-center px-4 py-2.5 bg-indigo-50/60 rounded-lg border border-indigo-100 text-xs">
                  <div>
                    <span className="text-slate-600 font-medium">Service Price: </span>
                    <span className="font-bold text-slate-900">₹{selectedServiceObj.price}</span>
                  </div>
                  <div>
                    <span className="text-slate-600 font-medium">Deposit Required: </span>
                    <span className="font-bold text-indigo-700">
                      {selectedServiceObj.depositType === 'NONE'
                        ? 'None'
                        : selectedServiceObj.depositType === 'FIXED'
                        ? `₹${selectedServiceObj.depositValue}`
                        : `${selectedServiceObj.depositValue}% (₹${(
                            (selectedServiceObj.price * selectedServiceObj.depositValue) /
                            100
                          ).toFixed(0)})`}
                    </span>
                  </div>
                </div>
              )}

              {/* Actions */}
              <div className="flex justify-end space-x-3 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setIsNewModalOpen(false)}
                  className="px-4 py-2 border border-slate-300 text-slate-700 text-xs font-semibold rounded-lg hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting || !selectedSlot}
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold rounded-lg shadow-xs disabled:opacity-50"
                >
                  {submitting ? 'Confirming...' : 'Confirm Appointment'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ==================================================== */}
      {/* 6. RESCHEDULE MODAL */}
      {/* ==================================================== */}
      {isRescheduleModalOpen && rescheduleAppt && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4 backdrop-blur-xs">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-xl border border-slate-200">
            <h3 className="text-base font-bold text-slate-900 pb-3 border-b border-slate-100">
              Reschedule Appointment
            </h3>
            <p className="text-xs text-slate-500 mt-1">
              Customer: <strong>{rescheduleAppt.customer.name}</strong> • Staff: <strong>{rescheduleAppt.staff.name}</strong>
            </p>

            {rescheduleError && (
              <div className="mt-3 p-2.5 bg-red-50 border border-red-200 text-red-700 text-xs rounded-lg">
                {rescheduleError}
              </div>
            )}

            <form onSubmit={handleRescheduleSubmit} className="mt-4 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">New Date *</label>
                <input
                  type="date"
                  required
                  min={new Date().toISOString().slice(0, 10)}
                  value={rescheduleDate}
                  onChange={(e) => setRescheduleDate(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Available Slots *</label>
                {loadingRescheduleSlots ? (
                  <div className="flex items-center space-x-2 py-4 text-xs text-slate-500 justify-center">
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-indigo-600"></div>
                    <span>Loading available times...</span>
                  </div>
                ) : rescheduleSlots.length === 0 ? (
                  <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-500 text-center">
                    No open slots on this date.
                  </div>
                ) : (
                  <div className="grid grid-cols-4 gap-2 max-h-40 overflow-y-auto p-1">
                    {rescheduleSlots.map((slot) => {
                      const isSelected = selectedRescheduleSlot?.start === slot.start;
                      return (
                        <button
                          type="button"
                          key={slot.start}
                          onClick={() => setSelectedRescheduleSlot(slot)}
                          className={`py-2 px-1 text-xs font-bold rounded-lg border transition ${
                            isSelected
                              ? 'bg-indigo-600 text-white border-indigo-600 shadow-xs ring-2 ring-indigo-300'
                              : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                          }`}
                        >
                          {slot.startTime}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              <div className="flex justify-end space-x-2 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setIsRescheduleModalOpen(false)}
                  className="px-3 py-1.5 border border-slate-300 text-slate-700 text-xs font-semibold rounded-lg hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={rescheduling || !selectedRescheduleSlot}
                  className="px-4 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold rounded-lg shadow-xs disabled:opacity-50"
                >
                  {rescheduling ? 'Rescheduling...' : 'Save New Time'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
