"use client";

import React from 'react';
import { REGIONS } from '@/lib/regions';
import { MapPin } from 'lucide-react';

interface ConfigPanelProps {
    selectedStartRegion: string;
    selectedEndRegion: string;
    customStartAdres: string;
    customEndAdres: string;
    onStartRegionChange: (region: string) => void;
    onEndRegionChange: (region: string) => void;
    onCustomStartChange: (adres: string) => void;
    onCustomEndChange: (adres: string) => void;
    disabled?: boolean;
}

export function ConfigPanel({ 
    selectedStartRegion, 
    selectedEndRegion, 
    customStartAdres,
    customEndAdres,
    onStartRegionChange, 
    onEndRegionChange, 
    onCustomStartChange,
    onCustomEndChange,
    disabled 
}: ConfigPanelProps) {
    return (
        <div className="space-y-4">
            {/* Startpunt */}
            <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm transition-all hover:shadow-md">
                <div className="flex items-center gap-3 mb-3">
                    <div className="w-8 h-8 rounded-full bg-green-500 flex items-center justify-center text-white shadow-sm">
                        <MapPin className="w-4 h-4" />
                    </div>
                    <h2 className="font-bold text-slate-800">Beginpunt</h2>
                </div>

                <select
                    value={selectedStartRegion}
                    onChange={(e) => onStartRegionChange(e.target.value)}
                    disabled={disabled}
                    className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-green-500 outline-none transition-all text-sm font-semibold text-slate-700 appearance-none cursor-pointer"
                    style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 24 24' stroke='%2364748b'%3E%3Cpath stroke-linecap='round' stroke-linejoin='round' stroke-width='2' d='M19 9l-7 7-7-7'%3E%3C/path%3E%3C/svg%3E")`, backgroundRepeat: 'no-repeat', backgroundPosition: 'right 1rem center', backgroundSize: '1.25rem' }}
                >
                    {Object.entries(REGIONS).map(([key, value]) => (
                        <option key={`start-${key}`} value={key}>
                            {value.name} ({value.address})
                        </option>
                    ))}
                    <option value="CUSTOM">➕ Eigen Adres handmatig invoeren...</option>
                </select>

                {selectedStartRegion === 'CUSTOM' && (
                    <div className="mt-3 animate-in fade-in slide-in-from-top-2 duration-300">
                        <input
                            type="text"
                            placeholder="Typ hier het startadres..."
                            value={customStartAdres}
                            onChange={(e) => onCustomStartChange(e.target.value)}
                            disabled={disabled}
                            className="w-full px-4 py-3 bg-white border-2 border-green-100 rounded-xl focus:border-green-500 outline-none transition-all text-sm font-medium shadow-inner"
                        />
                    </div>
                )}
            </div>

            {/* Eindpunt */}
            <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm transition-all hover:shadow-md">
                <div className="flex items-center gap-3 mb-3">
                    <div className="w-8 h-8 rounded-full bg-red-500 flex items-center justify-center text-white shadow-sm">
                        <MapPin className="w-4 h-4" />
                    </div>
                    <h2 className="font-bold text-slate-800">Eindpunt</h2>
                </div>

                <select
                    value={selectedEndRegion}
                    onChange={(e) => onEndRegionChange(e.target.value)}
                    disabled={disabled}
                    className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-red-500 outline-none transition-all text-sm font-semibold text-slate-700 appearance-none cursor-pointer"
                    style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 24 24' stroke='%2364748b'%3E%3Cpath stroke-linecap='round' stroke-linejoin='round' stroke-width='2' d='M19 9l-7 7-7-7'%3E%3C/path%3E%3C/svg%3E")`, backgroundRepeat: 'no-repeat', backgroundPosition: 'right 1rem center', backgroundSize: '1.25rem' }}
                >
                    {Object.entries(REGIONS).map(([key, value]) => (
                        <option key={`end-${key}`} value={key}>
                            {value.name} ({value.address})
                        </option>
                    ))}
                    <option value="CUSTOM">➕ Eigen Adres handmatig invoeren...</option>
                </select>

                {selectedEndRegion === 'CUSTOM' && (
                    <div className="mt-3 animate-in fade-in slide-in-from-top-2 duration-300">
                        <input
                            type="text"
                            placeholder="Typ hier het eindadres..."
                            value={customEndAdres}
                            onChange={(e) => onCustomEndChange(e.target.value)}
                            disabled={disabled}
                            className="w-full px-4 py-3 bg-white border-2 border-red-100 rounded-xl focus:border-red-500 outline-none transition-all text-sm font-medium shadow-inner"
                        />
                    </div>
                )}
            </div>
        </div>
    );
}
