"use client";

import React, { useState } from 'react';
import dynamic from 'next/dynamic';
import { UploadZone } from '@/components/UploadZone';
import { ConfigPanel } from '@/components/ConfigPanel';
import { RouteList } from '@/components/RouteList';
import { RouteOptimizer, REGIONS } from '@/lib/optimization';
import { Address } from '@/types';
import { Loader2, Download, Map as MapIcon, RotateCcw } from 'lucide-react';

// Dynamic import for Map to avoid SSR issues with Leaflet
const LeafletMap = dynamic(() => import('@/components/LeafletMap'), {
    ssr: false,
    loading: () => <div className="h-[600px] w-full bg-slate-100 animate-pulse rounded-xl flex items-center justify-center text-muted-foreground">Kaart laden...</div>
});

export default function Home() {
    const [selectedRegion, setSelectedRegion] = useState<keyof typeof REGIONS>('ARNHEM');
    const [route, setRoute] = useState<Address[]>([]);
    const [stats, setStats] = useState<{ distance: number, duration: number } | null>(null);
    const [isProcessing, setIsProcessing] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const handleUploadComplete = async (addresses: Address[]) => {
        setIsProcessing(true);
        setError(null);
        try {
            // Optimize the route immediately after upload
            const result = await RouteOptimizer.optimizeRoute(selectedRegion, addresses);
            setRoute(result.stops);
            setStats({ distance: result.distance, duration: result.duration });
        } catch (err: any) {
            console.error(err);
            setError(err.message || "Er is een fout opgetreden bij het optimaliseren.");
        } finally {
            setIsProcessing(false);
        }
    };

    const handleReset = () => {
        setRoute([]);
        setStats(null);
        setError(null);
    };

    const downloadCSV = () => {
        if (route.length === 0) return;

        const headers = ['Volgorde', 'Filiaal', 'Formule', 'Adres', 'Plaats', 'Merchandiser', 'Lat', 'Lng'];
        const rows = route.map((stop, index) => [
            index + 1,
            stop.filiaalnr,
            stop.formule,
            stop.straat,
            stop.plaats,
            stop.merchandiser,
            stop.lat,
            stop.lng
        ]);

        const csvContent = "data:text/csv;charset=utf-8,"
            + [headers.join(','), ...rows.map(e => e.join(','))].join('\n');

        const encodedUri = encodeURI(csvContent);
        const link = document.createElement("a");
        link.setAttribute("href", encodedUri);
        link.setAttribute("download", `route_optimalisatie_${new Date().toISOString().split('T')[0]}.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    return (
        <div className="container py-8 max-w-7xl mx-auto">
            <header className="mb-8 text-center sm:text-left sm:flex sm:items-end sm:justify-between border-b border-border pb-6">
                <div>
                    <h1 className="text-3xl font-extrabold tracking-tight text-gray-900 sm:text-4xl mb-2">
                        Vrachtwagen B.V. <span className="text-primary">routeplanner</span>
                    </h1>
                    <p className="text-lg text-muted-foreground">
                        Upload uw weekplanning en krijg direct de snelste route.
                    </p>
                </div>
                {route.length > 0 && (
                    <button
                        onClick={handleReset}
                        className="mt-4 sm:mt-0 btn btn-secondary text-sm flex items-center gap-2"
                    >
                        <RotateCcw className="w-4 h-4" />
                        Nieuwe Route
                    </button>
                )}
            </header>

            {error && (
                <div className="bg-red-50 text-red-700 p-4 rounded-lg mb-8 border border-red-200 shadow-sm animate-in fade-in slide-in-from-top-2">
                    <strong>Fout:</strong> {error}
                </div>
            )}

            {route.length === 0 ? (
                <div className="max-w-2xl mx-auto space-y-8 animate-in fade-in zoom-in-95 duration-500">
                    <ConfigPanel
                        selectedRegion={selectedRegion}
                        onRegionChange={setSelectedRegion}
                        disabled={isProcessing}
                    />

                    <div className="relative">
                        {isProcessing && (
                            <div className="absolute inset-0 bg-white/80 z-10 flex flex-col items-center justify-center rounded-xl backdrop-blur-sm">
                                <Loader2 className="w-12 h-12 text-primary animate-spin mb-4" />
                                <p className="text-lg font-medium text-gray-700">Route berekenen en optimaliseren...</p>
                                <p className="text-sm text-gray-500">Dit kan enkele seconden duren</p>
                            </div>
                        )}
                        <UploadZone onUploadComplete={handleUploadComplete} />
                    </div>
                </div>
            ) : (
                <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
                    <div className="flex flex-col sm:flex-row gap-4 justify-between items-center bg-white p-4 rounded-xl border border-border shadow-sm">
                        <div className="flex items-center gap-4">
                            <div className="bg-primary/10 p-3 rounded-lg">
                                <MapIcon className="w-6 h-6 text-primary" />
                            </div>
                            <div>
                                <h2 className="font-bold text-lg">Route Gereed</h2>
                                <div className="flex items-center gap-2 text-muted-foreground">
                                    <span>{route.length} stops</span>
                                    {stats && (
                                        <>
                                            <span>•</span>
                                            <span className="font-medium text-gray-900">{(stats.distance / 1000).toFixed(1)} km</span>
                                            <span>•</span>
                                            <span>{Math.round(stats.duration / 60)} min</span>
                                        </>
                                    )}
                                </div>
                            </div>
                        </div>

                        <div className="flex gap-3 w-full sm:w-auto">
                            <button
                                onClick={downloadCSV}
                                className="btn btn-secondary flex-1 sm:flex-none gap-2"
                            >
                                <Download className="w-4 h-4" />
                                CSV Export
                            </button>
                            <a
                                href={`https://www.google.com/maps/dir/${route.map(a => encodeURIComponent(a.volledigAdres)).join('/')}`}
                                target="_blank"
                                rel="noreferrer"
                                className="btn btn-primary flex-1 sm:flex-none gap-2"
                            >
                                Open in Maps
                            </a>
                        </div>
                    </div>

                    <div className="grid lg:grid-cols-3 gap-6 h-auto">
                        <div className="lg:col-span-1 order-2 lg:order-1">
                            <RouteList route={route} />
                        </div>
                        <div className="lg:col-span-2 order-1 lg:order-2 h-[600px]">
                            <LeafletMap route={route} />
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
