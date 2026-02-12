'use client';

import { useState } from 'react';
import dynamic from 'next/dynamic';
import { UploadZone } from '@/components/UploadZone';
import { ConfigPanel } from '@/components/ConfigPanel';
import { RouteList } from '@/components/RouteList';
import { RouteOptimizer, REGIONS } from '@/lib/optimization';
import { Address, RouteResponse } from '@/types';
import { MapPin, Truck, ChevronRight, User } from 'lucide-react';

const LeafletMap = dynamic(() => import('@/components/LeafletMap'), {
    ssr: false,
    loading: () => <div className="h-[400px] w-full bg-slate-100 animate-pulse rounded-xl" />
});

export default function Home() {
    // State
    const [addresses, setAddresses] = useState<Address[]>([]);
    const [drivers, setDrivers] = useState<string[]>([]);
    const [selectedDriver, setSelectedDriver] = useState<string>("");
    const [startRegion, setStartRegion] = useState<keyof typeof REGIONS>('ARNHEM');
    const [routeData, setRouteData] = useState<RouteResponse | null>(null);

    const [isProcessing, setIsProcessing] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [step, setStep] = useState<1 | 2 | 3>(1); // 1=Upload, 2=Select Driver/Region, 3=Result

    const handleUploadComplete = (data: { addresses: Address[], drivers: string[] }) => {
        setAddresses(data.addresses);
        setDrivers(data.drivers);
        setStep(2);
        setError(null);
    };

    const handleCalculateRoute = async () => {
        if (!selectedDriver) {
            setError("Selecteer eerst een bestuurder.");
            return;
        }

        setIsProcessing(true);
        setError(null);

        try {
            // Filter addresses for the selected driver
            const driverAddresses = addresses.filter(a => a.merchandiser === selectedDriver);

            console.log(`🚗 Selected driver: ${selectedDriver}`);
            console.log(`📍 Found ${driverAddresses.length} addresses for this driver`);

            if (driverAddresses.length === 0) {
                throw new Error(`Geen adressen gevonden voor ${selectedDriver}`);
            }

            console.log(`🗺️ Starting route optimization from ${startRegion}...`);
            const result = await RouteOptimizer.optimizeRoute(startRegion, driverAddresses);
            console.log(`✅ Route optimization complete:`, result);
            setRouteData(result);
            setStep(3);
        } catch (err: any) {
            console.error(`❌ Route calculation error:`, err);
            setError(err.message || 'Er is een fout opgetreden bij het berekenen van de route.');
        } finally {
            setIsProcessing(false);
        }
    };

    const reset = () => {
        setAddresses([]);
        setDrivers([]);
        setSelectedDriver("");
        setRouteData(null);
        setStep(1);
        setError(null);
    };

    return (
        <main className="min-h-screen bg-slate-50 p-4 md:p-8 font-sans text-slate-900 flex flex-col items-center">
            <div className="w-full max-w-6xl space-y-8">

                {/* Header */}
                <div className="text-center space-y-2 py-8">
                    <div className="inline-flex items-center justify-center p-3 bg-blue-600 rounded-2xl shadow-lg shadow-blue-200 mb-4">
                        <Truck className="w-8 h-8 text-white" />
                    </div>
                    <h1 className="text-4xl font-extrabold tracking-tight text-slate-900">
                        Vrachtwagen B.V. <span className="text-blue-600">Routeplanner</span>
                    </h1>
                    <p className="text-lg text-slate-500 max-w-2xl mx-auto">
                        Upload uw weekplanning, kies uw chauffeur en krijg direct de snelste route.
                    </p>
                </div>

                {/* Error Message */}
                {error && (
                    <div className="bg-red-50 border-l-4 border-red-500 p-4 rounded-r shadow-sm animate-in fade-in slide-in-from-top-2">
                        <div className="flex">
                            <div className="ml-3">
                                <p className="text-sm text-red-700">{error}</p>
                            </div>
                        </div>
                    </div>
                )}

                {/* Step 1: Upload */}
                {step === 1 && (
                    <div className="max-w-2xl mx-auto bg-white rounded-3xl shadow-xl p-1 pointer-events-auto">
                        <UploadZone onUploadComplete={handleUploadComplete} />
                    </div>
                )}

                {/* Step 2: Configuration */}
                {step === 2 && (
                    <div className="max-w-2xl mx-auto bg-white rounded-3xl shadow-xl overflow-hidden animate-in zoom-in-95 duration-300">
                        <div className="bg-blue-600 p-6 text-white text-center">
                            <h2 className="text-2xl font-bold">Configureer Route</h2>
                            <p className="text-blue-100 opacity-90">Kies de bestuurder en het startpunt</p>
                        </div>

                        <div className="p-8 space-y-8">
                            {/* Driver Selection */}
                            <div className="space-y-3">
                                <label className="block text-sm font-semibold text-slate-700 uppercase tracking-wider">
                                    Wie gaat rijden?
                                </label>
                                <div className="relative">
                                    <User className="absolute left-3 top-3.5 h-5 w-5 text-slate-400" />
                                    <select
                                        value={selectedDriver}
                                        onChange={(e) => setSelectedDriver(e.target.value)}
                                        className="w-full pl-10 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all appearance-none text-lg text-slate-700 font-medium"
                                    >
                                        <option value="" disabled>Selecteer een chauffeur...</option>
                                        {drivers.map(driver => (
                                            <option key={driver} value={driver}>{driver}</option>
                                        ))}
                                    </select>
                                    <div className="absolute right-3 top-3.5 pointer-events-none">
                                        <ChevronRight className="h-5 w-5 text-slate-400 rotate-90" />
                                    </div>
                                </div>
                            </div>

                            {/* Region Selection */}
                            <div className="space-y-3">
                                <label className="block text-sm font-semibold text-slate-700 uppercase tracking-wider">
                                    Startpunt
                                </label>
                                <ConfigPanel selectedRegion={startRegion} onRegionChange={setStartRegion} />
                            </div>

                            {/* Action Button */}
                            <button
                                onClick={handleCalculateRoute}
                                disabled={isProcessing || !selectedDriver}
                                className="w-full py-4 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 disabled:cursor-not-allowed text-white rounded-xl font-bold text-lg shadow-lg hover:shadow-xl transition-all transform hover:-translate-y-0.5 active:translate-y-0 flex items-center justify-center gap-2"
                            >
                                {isProcessing ? (
                                    <>
                                        <span className="animate-spin rounded-full h-5 w-5 border-b-2 border-white"></span>
                                        Route Berekenen...
                                    </>
                                ) : (
                                    <>
                                        🚗 Start Routeberekening
                                    </>
                                )}
                            </button>

                            <button onClick={reset} className="w-full text-slate-400 text-sm hover:text-slate-600 transition-colors">
                                ← Terug naar uploaden
                            </button>
                        </div>
                    </div>
                )}

                {/* Step 3: Results */}
                {step === 3 && routeData && (
                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 animate-in slide-in-from-bottom-4 duration-500">

                        {/* Left Column: List & Stats */}
                        <div className="lg:col-span-1 space-y-6">

                            {/* Stats Card */}
                            <div className="bg-white rounded-2xl shadow-lg p-6 flex flex-col gap-4 border border-slate-100">
                                <div className="flex justify-between items-center pb-4 border-b border-slate-100">
                                    <div>
                                        <p className="text-sm text-slate-500 font-medium">Chauffeur</p>
                                        <p className="text-lg font-bold text-slate-800">{selectedDriver}</p>
                                    </div>
                                    <div className="h-10 w-10 bg-blue-50 rounded-full flex items-center justify-center text-blue-600 font-bold text-xl">
                                        {routeData.stops.length - 1}
                                    </div>
                                </div>

                                <div className="grid grid-cols-2 gap-4">
                                    <div className="bg-slate-50 p-3 rounded-xl border border-slate-100">
                                        <p className="text-xs text-slate-500 uppercase font-bold tracking-wider">Afstand</p>
                                        <p className="text-2xl font-black text-slate-800">
{Math.round((routeData.totalDistance?? 0) / 1000).toLocaleString('nl-NL')}
                                        </p>
                                    </div>
                                    <div className="bg-slate-50 p-3 rounded-xl border border-slate-100">
                                        <p className="text-xs text-slate-500 uppercase font-bold tracking-wider">Tijd</p>
                                        <p className="text-2xl font-black text-slate-800">
{Math.round((routeData.routeData.totalDuration ?? 0) / 60)}
                                        </p>
                                    </div>
                                </div>
                            </div>

                            <div className="bg-white rounded-2xl shadow-lg overflow-hidden border border-slate-100 flex flex-col max-h-[600px]">
                                <div className="p-4 bg-slate-50 border-b border-slate-100 flex justify-between items-center">
                                    <h3 className="font-bold text-slate-700 flex items-center gap-2">
                                        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-blue-600 text-[10px] font-bold text-white">
                                            {routeData.stops.length}
                                        </span>
                                        Stops
                                    </h3>
                                    {/* Export Actions */}
                                    <div className="flex gap-2">
                                        <button
                                            onClick={() => {
                                                const csvContent = "data:text/csv;charset=utf-8," +
                                                    routeData.stops.map(s => `${s.filiaalnr},${s.formule},${s.straat},${s.plaats}`).join("\n");
                                                const encodedUri = encodeURI(csvContent);
                                                window.open(encodedUri);
                                            }}
                                            className="p-2 text-slate-400 hover:text-blue-600 transition-colors"
                                            title="Download CSV"
                                        >
                                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"></path></svg>
                                        </button>
                                    </div>
                                </div>
                                <div className="overflow-y-auto flex-1 p-2">
                                    <RouteList route={routeData.stops} />
                                </div>
                            </div>

                            <button
                                onClick={reset}
                                className="w-full py-3 bg-white border-2 border-slate-200 text-slate-600 hover:border-slate-300 hover:bg-slate-50 rounded-xl font-bold transition-all"
                            >
                                Nieuwe Planning
                            </button>
                        </div>

                        {/* Right Column: Map */}
                        <div className="lg:col-span-2 min-h-[500px] lg:h-[calc(100vh-140px)] sticky top-8">
                            <div className="bg-white rounded-3xl shadow-xl overflow-hidden border border-slate-200 h-full relative group">
                                <LeafletMap route={routeData.stops} />
                                <div className="absolute bottom-4 right-4 z-[400]">
                                    <a
                                        href={`https://www.google.com/maps/dir/${routeData.stops.map(s => encodeURIComponent(s.volledigAdres)).join('/')}`}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="bg-white/90 backdrop-blur text-blue-600 px-4 py-2 rounded-lg font-bold shadow-lg hover:bg-blue-600 hover:text-white transition-all flex items-center gap-2 text-sm"
                                    >
                                        <MapPin className="w-4 h-4" /> Open in Google Maps
                                    </a>
                                </div>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </main>
    );
}
