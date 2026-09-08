'use client';
import { useEffect, useState } from 'react';

interface HealthData {
  status: string;
  db?: string;
  message?: string;
}

export default function Home() {
  const [healthStatus, setHealthStatus] = useState<HealthData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://127.0.0.1:3001/api/v1'}/health`)
      .then((res) => res.json())
      .then((data: HealthData) => {
        setHealthStatus(data);
        setLoading(false);
      })
      .catch((err) => {
        console.error(err);
        setHealthStatus({ status: 'error', message: 'Failed to reach backend' });
        setLoading(false);
      });
  }, []);

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center font-sans">
      <div className="bg-white p-8 rounded-xl shadow-lg w-full max-w-md border border-gray-100">
        <h1 className="text-2xl font-bold mb-6 text-gray-800 text-center">
          WhatsApp SaaS <br/> Phase 1 Setup
        </h1>
        
        <div className="space-y-4">
          <div className="p-4 rounded-lg bg-gray-50 border border-gray-100">
            <h2 className="text-sm font-semibold text-gray-500 mb-1">Frontend Status</h2>
            <div className="flex items-center text-green-600 font-medium">
              <span className="w-2 h-2 rounded-full bg-green-500 mr-2"></span>
              Running
            </div>
          </div>
          
          <div className="p-4 rounded-lg bg-gray-50 border border-gray-100">
            <h2 className="text-sm font-semibold text-gray-500 mb-1">Backend Connection</h2>
            {loading ? (
              <div className="text-gray-500">Checking...</div>
            ) : healthStatus?.status === 'ok' ? (
              <div className="flex flex-col">
                <div className="flex items-center text-green-600 font-medium">
                  <span className="w-2 h-2 rounded-full bg-green-500 mr-2"></span>
                  Connected
                </div>
                <div className="text-xs text-gray-500 mt-2 p-2 bg-gray-100 rounded">
                  {JSON.stringify(healthStatus)}
                </div>
              </div>
            ) : (
              <div className="flex flex-col">
                <div className="flex items-center text-red-600 font-medium">
                  <span className="w-2 h-2 rounded-full bg-red-500 mr-2"></span>
                  Failed
                </div>
                <div className="text-xs text-red-500 mt-2 p-2 bg-red-50 rounded">
                  {healthStatus?.message}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
