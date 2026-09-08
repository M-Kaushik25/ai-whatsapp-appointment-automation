"use client";

import { useEffect, useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';

interface ServiceItem {
  id: string;
  name: string;
  description: string | null;
  durationMinutes: number;
  price: number;
  depositType: 'NONE' | 'FIXED' | 'PERCENTAGE';
  depositValue: number;
  active: boolean;
  createdAt: string;
}

export default function ServicesPage() {
  const [services, setServices] = useState<ServiceItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'ACTIVE' | 'INACTIVE'>('ALL');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Modal State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingService, setEditingService] = useState<ServiceItem | null>(null);
  const [formName, setFormName] = useState('');
  const [formDescription, setFormDescription] = useState('');
  const [formDuration, setFormDuration] = useState(30);
  const [formPrice, setFormPrice] = useState(500);
  const [formDepositType, setFormDepositType] = useState<'NONE' | 'FIXED' | 'PERCENTAGE'>('NONE');
  const [formDepositValue, setFormDepositValue] = useState(0);
  const [formActive, setFormActive] = useState(true);
  const [formError, setFormError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const router = useRouter();

  const fetchServices = async () => {
    const token = localStorage.getItem('access_token');
    if (!token) {
      router.push('/login');
      return;
    }

    try {
      setLoading(true);
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api/v1'}/services`,
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
        throw new Error('Failed to load services');
      }

      const data = await res.json();
      setServices(data);
    } catch (err: any) {
      setError(err.message || 'Error fetching services');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchServices();
  }, []);

  const openAddModal = () => {
    setEditingService(null);
    setFormName('');
    setFormDescription('');
    setFormDuration(30);
    setFormPrice(500);
    setFormDepositType('NONE');
    setFormDepositValue(0);
    setFormActive(true);
    setFormError('');
    setIsModalOpen(true);
  };

  const openEditModal = (s: ServiceItem) => {
    setEditingService(s);
    setFormName(s.name);
    setFormDescription(s.description || '');
    setFormDuration(s.durationMinutes);
    setFormPrice(s.price);
    setFormDepositType(s.depositType || 'NONE');
    setFormDepositValue(s.depositValue || 0);
    setFormActive(s.active);
    setFormError('');
    setIsModalOpen(true);
  };

  const handleFormSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');

    if (!formName.trim()) {
      setFormError('Service name is required');
      return;
    }
    if (formDuration <= 0) {
      setFormError('Duration must be greater than 0 minutes');
      return;
    }
    if (formPrice < 0) {
      setFormError('Price cannot be negative');
      return;
    }
    if (formDepositType === 'PERCENTAGE' && (formDepositValue < 0 || formDepositValue > 100)) {
      setFormError('Percentage deposit must be between 0% and 100%');
      return;
    }
    if (formDepositType === 'FIXED' && formDepositValue > formPrice) {
      setFormError('Fixed deposit cannot exceed service price');
      return;
    }

    const token = localStorage.getItem('access_token');
    if (!token) return;

    try {
      setSubmitting(true);
      const url = editingService
        ? `${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api/v1'}/services/${editingService.id}`
        : `${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api/v1'}/services`;

      const method = editingService ? 'PUT' : 'POST';

      const res = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          name: formName.trim(),
          description: formDescription.trim() || undefined,
          durationMinutes: Number(formDuration),
          price: Number(formPrice),
          depositType: formDepositType,
          depositValue: formDepositType === 'NONE' ? 0 : Number(formDepositValue),
          active: formActive,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.message || 'Operation failed');
      }

      setSuccess(editingService ? 'Service updated successfully!' : 'Service created successfully!');
      setIsModalOpen(false);
      fetchServices();
      setTimeout(() => setSuccess(''), 3000);
    } catch (err: any) {
      setFormError(err.message || 'Failed to save service');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`Are you sure you want to delete the service "${name}"?`)) {
      return;
    }

    const token = localStorage.getItem('access_token');
    if (!token) return;

    try {
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api/v1'}/services/${id}`,
        {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${token}` },
        },
      );

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.message || 'Failed to delete service');
      }

      setSuccess(`Service "${name}" removed.`);
      fetchServices();
      setTimeout(() => setSuccess(''), 3000);
    } catch (err: any) {
      setError(err.message || 'Error deleting service');
      setTimeout(() => setError(''), 3000);
    }
  };

  const filteredServices = useMemo(() => {
    return services.filter((s) => {
      const matchesSearch =
        s.name.toLowerCase().includes(search.toLowerCase()) ||
        (s.description && s.description.toLowerCase().includes(search.toLowerCase()));

      const matchesStatus =
        statusFilter === 'ALL' ||
        (statusFilter === 'ACTIVE' && s.active) ||
        (statusFilter === 'INACTIVE' && !s.active);

      return matchesSearch && matchesStatus;
    });
  }, [services, search, statusFilter]);

  return (
    <div className="space-y-6">
      {/* Top action header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Services</h1>
          <p className="text-sm text-slate-500 mt-1">
            Configure catalog, durations, pricing, and booking deposits.
          </p>
        </div>
        <button
          onClick={openAddModal}
          className="inline-flex items-center px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold rounded-lg shadow-xs transition gap-2"
        >
          <span>+</span> Add Service
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

      {/* Filter and Search Bar */}
      <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs flex flex-col md:flex-row gap-3 items-center justify-between">
        <div className="w-full md:w-80">
          <input
            type="text"
            placeholder="Search services..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full px-3.5 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </div>
        <div className="flex items-center space-x-1 bg-slate-100 p-1 rounded-lg w-full md:w-auto">
          {(['ALL', 'ACTIVE', 'INACTIVE'] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setStatusFilter(tab)}
              className={`px-3 py-1.5 rounded-md text-xs font-semibold transition ${
                statusFilter === tab
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {tab.charAt(0) + tab.slice(1).toLowerCase()}
            </button>
          ))}
        </div>
      </div>

      {/* Services List Grid */}
      {loading ? (
        <div className="flex justify-center p-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div>
        </div>
      ) : filteredServices.length === 0 ? (
        <div className="bg-white rounded-xl border border-dashed border-slate-300 p-12 text-center">
          <p className="text-slate-400 text-3xl mb-2">✂️</p>
          <h3 className="text-base font-semibold text-slate-800">No services found</h3>
          <p className="text-sm text-slate-500 mt-1">
            {services.length === 0
              ? 'Get started by creating your first service.'
              : 'No services match the active filter.'}
          </p>
          {services.length === 0 && (
            <button
              onClick={openAddModal}
              className="mt-4 px-4 py-2 bg-indigo-600 text-white text-sm font-semibold rounded-lg hover:bg-indigo-700"
            >
              Create Service
            </button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {filteredServices.map((svc) => (
            <div
              key={svc.id}
              className="bg-white rounded-xl border border-slate-200 p-5 shadow-xs flex flex-col justify-between hover:border-slate-300 transition"
            >
              <div>
                <div className="flex items-start justify-between gap-2">
                  <h3 className="text-base font-bold text-slate-900">{svc.name}</h3>
                  <span
                    className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                      svc.active
                        ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                        : 'bg-slate-100 text-slate-600 border border-slate-200'
                    }`}
                  >
                    {svc.active ? 'Active' : 'Inactive'}
                  </span>
                </div>

                {svc.description && (
                  <p className="text-xs text-slate-500 mt-2 line-clamp-2">
                    {svc.description}
                  </p>
                )}

                <div className="mt-4 pt-3 border-t border-slate-100 flex flex-wrap gap-y-2 justify-between text-xs text-slate-600">
                  <div className="flex items-center gap-1.5 font-medium">
                    <span className="text-slate-400">⏱</span> {svc.durationMinutes} mins
                  </div>
                  <div className="flex items-center gap-1.5 font-bold text-slate-900 text-sm">
                    ₹{svc.price.toLocaleString()}
                  </div>
                </div>

                <div className="mt-2 text-xs text-slate-500">
                  <span className="text-slate-400">Deposit: </span>
                  {svc.depositType === 'NONE' && (
                    <span className="text-slate-600 font-medium">No Deposit</span>
                  )}
                  {svc.depositType === 'FIXED' && (
                    <span className="text-indigo-600 font-semibold">₹{svc.depositValue} fixed</span>
                  )}
                  {svc.depositType === 'PERCENTAGE' && (
                    <span className="text-indigo-600 font-semibold">{svc.depositValue}% deposit</span>
                  )}
                </div>
              </div>

              <div className="mt-5 pt-3 border-t border-slate-100 flex justify-end space-x-2">
                <button
                  onClick={() => openEditModal(svc)}
                  className="px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100 rounded-md transition"
                >
                  Edit
                </button>
                <button
                  onClick={() => handleDelete(svc.id, svc.name)}
                  className="px-3 py-1.5 text-xs font-semibold text-red-600 hover:bg-red-50 rounded-md transition"
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Add / Edit Service Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4 backdrop-blur-xs">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-xl border border-slate-200">
            <div className="flex justify-between items-center pb-3 border-b border-slate-100">
              <h3 className="text-lg font-bold text-slate-900">
                {editingService ? 'Edit Service' : 'Add New Service'}
              </h3>
              <button
                onClick={() => setIsModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 text-lg font-bold"
              >
                ✕
              </button>
            </div>

            {formError && (
              <div className="mt-4 p-3 bg-red-50 border border-red-200 text-red-700 text-xs rounded-lg">
                {formError}
              </div>
            )}

            <form onSubmit={handleFormSubmit} className="mt-4 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Service Name *
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Haircut & Beard Trim"
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  className="w-full px-3.5 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Description
                </label>
                <textarea
                  rows={2}
                  placeholder="Service details and inclusions..."
                  value={formDescription}
                  onChange={(e) => setFormDescription(e.target.value)}
                  className="w-full px-3.5 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Duration (Minutes) *
                  </label>
                  <input
                    type="number"
                    min="1"
                    required
                    value={formDuration}
                    onChange={(e) => setFormDuration(Number(e.target.value))}
                    className="w-full px-3.5 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Price (₹) *
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    required
                    value={formPrice}
                    onChange={(e) => setFormPrice(Number(e.target.value))}
                    className="w-full px-3.5 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                  />
                </div>
              </div>

              {/* Deposit Configuration */}
              <div className="p-4 bg-slate-50 rounded-xl border border-slate-200 space-y-3">
                <label className="block text-xs font-bold text-slate-800">
                  Booking Deposit Configuration
                </label>
                <div className="grid grid-cols-3 gap-2">
                  {(['NONE', 'FIXED', 'PERCENTAGE'] as const).map((type) => (
                    <button
                      type="button"
                      key={type}
                      onClick={() => {
                        setFormDepositType(type);
                        if (type === 'NONE') setFormDepositValue(0);
                        if (type === 'PERCENTAGE' && formDepositValue > 100) setFormDepositValue(20);
                      }}
                      className={`py-2 px-2 text-xs font-semibold rounded-lg border text-center transition ${
                        formDepositType === type
                          ? 'bg-indigo-600 text-white border-indigo-600 shadow-xs'
                          : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-100'
                      }`}
                    >
                      {type === 'NONE' ? 'No Deposit' : type === 'FIXED' ? 'Fixed Amount' : 'Percentage'}
                    </button>
                  ))}
                </div>

                {formDepositType !== 'NONE' && (
                  <div className="pt-2">
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      {formDepositType === 'FIXED' ? 'Deposit Amount (₹)' : 'Deposit Percentage (%)'}
                    </label>
                    <input
                      type="number"
                      min="0"
                      max={formDepositType === 'PERCENTAGE' ? 100 : formPrice}
                      value={formDepositValue}
                      onChange={(e) => setFormDepositValue(Number(e.target.value))}
                      className="w-full px-3.5 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:outline-none bg-white"
                    />
                    <p className="text-[11px] text-slate-500 mt-1">
                      {formDepositType === 'FIXED'
                        ? `Customers will pay ₹${formDepositValue} in advance.`
                        : `Customers will pay ${formDepositValue}% of ₹${formPrice} = ₹${(
                            (formPrice * formDepositValue) /
                            100
                          ).toFixed(2)} in advance.`}
                    </p>
                  </div>
                )}
              </div>

              {/* Status Toggle */}
              <div className="flex items-center gap-2 pt-2">
                <input
                  type="checkbox"
                  id="formActive"
                  checked={formActive}
                  onChange={(e) => setFormActive(e.target.checked)}
                  className="w-4 h-4 text-indigo-600 rounded-sm border-slate-300 focus:ring-indigo-500"
                />
                <label htmlFor="formActive" className="text-xs font-medium text-slate-700 cursor-pointer">
                  Active (available for bookings in Phase 4)
                </label>
              </div>

              {/* Action buttons */}
              <div className="flex justify-end space-x-3 pt-4 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-4 py-2 border border-slate-300 text-slate-700 text-sm font-semibold rounded-lg hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold rounded-lg shadow-xs disabled:opacity-50"
                >
                  {submitting ? 'Saving...' : editingService ? 'Update Service' : 'Save Service'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
