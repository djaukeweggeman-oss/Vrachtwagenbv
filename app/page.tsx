'use client';

import { useState } from 'react';
import dynamic from 'next/dynamic';
import { UploadZone } from '@/components/UploadZone';
import { ConfigPanel } from '@/components/ConfigPanel';
import { RouteList } from '@/components/RouteList';
import { REGIONS, findRegionKey } from '@/lib/regions';
import { sortDayRoutes } from '@/lib/utils';
import { Address, RouteResponse, DayRoute } from '@/types';
import { MapPin, Truck, ChevronRight, User } from 'lucide-react';
import { RouteOptimizer } from '@/lib/optimization';

const LeafletMap = dynamic(() => import('@/components/LeafletMap'), {
    ssr: false,
    loading: () => <div className="h-[400px] w-full bg-slate-100 animate-pulse rounded-xl" />
});

export default function Home() {
    // State
    const [addresses, setAddresses] = useState<Address[]>([]);
    const [drivers, setDrivers] = useState<string[]>([]);
    const [driverBoxMap, setDriverBoxMap] = useState<Record<string, string>>({});
    const [selectedDriver, setSelectedDriver] = useState<string>("");
    const [startRegion, setStartRegion] = useState<string>("Shurgard Arnhem");
    const [endRegion, setEndRegion] = useState<string>("Shurgard Arnhem");
    const [customStartAdres, setCustomStartAdres] = useState<string>("");
    const [customEndAdres, setCustomEndAdres] = useState<string>("");
    const [isManualStartRegion, setIsManualStartRegion] = useState<boolean>(false);
    const [isManualEndRegion, setIsManualEndRegion] = useState<boolean>(false);
    const [step, setStep] = useState<number>(1);
    const [error, setError] = useState<string>("");
    const [isProcessing, setIsProcessing] = useState<boolean>(false);
    const [routeData, setRouteData] = useState<RouteResponse | null>(null);
    const [multiDayRoutes, setMultiDayRoutes] = useState<DayRoute[] | null>(null);

    // Bij upload: addresses, drivers, driverBoxMap vullen
    const handleUploadComplete = (data: { addresses: Address[], drivers: string[], driverBoxMap: Record<string, string> }) => {
        setAddresses(data.addresses);
        setDrivers(data.drivers);
        setDriverBoxMap(data.driverBoxMap || {});
        setSelectedDriver("");
        setStep(2);
        setError("");
        setRouteData(null);
        setMultiDayRoutes(null);
    };

    // Automatisch box selecteren bij driverkeuze
    const handleDriverChange = (driver: string) => {
        setSelectedDriver(driver);
        setIsManualStartRegion(false);
        setIsManualEndRegion(false);
        const box = driverBoxMap[driver];
        if (box) {
            const regionKey = findRegionKey(box);
            setStartRegion(regionKey);
            setEndRegion(regionKey);
        }
    };

    const handleStartRegionChange = (region: string) => {
        setStartRegion(region);
        setIsManualStartRegion(true);
    };

    const handleEndRegionChange = (region: string) => {
        setEndRegion(region);
        setIsManualEndRegion(true);
    };

    // Reset
    const reset = () => {
        setStep(1);
        setAddresses([]);
        setDrivers([]);
        setDriverBoxMap({});
        setSelectedDriver("");
        setStartRegion("Shurgard Arnhem");
        setEndRegion("Shurgard Arnhem");
        setCustomStartAdres("");
        setCustomEndAdres("");
        setIsManualStartRegion(false);
        setIsManualEndRegion(false);
        setError("");
        setRouteData(null);
        setMultiDayRoutes(null);
        setIsProcessing(false);
    };

    const handleCalculateRoute = async () => {
        setIsProcessing(true);
        setError("");
        try {
            const driverAddresses = addresses.filter(a => a.merchandiser === selectedDriver);
            if (driverAddresses.length === 0) {
                throw new Error("Geen adressen gevonden voor deze chauffeur.");
            }

            // --- RESOLVE START & END DEPOTS ---
            let finalStartDepot: any;
            let finalEndDepot: any;

            // Resolve Start
            if (startRegion === 'CUSTOM') {
                if (!customStartAdres.trim()) throw new Error("Voer een startadres in.");
                const coords = await RouteOptimizer.geocodeAddress(customStartAdres);
                if (!coords) throw new Error("Kon het startadres niet vinden.");
                finalStartDepot = { name: 'Eigen Startpunt', address: customStartAdres, ...coords };
            } else {
                finalStartDepot = REGIONS[startRegion];
            }

            // Resolve End
            if (endRegion === 'CUSTOM') {
                if (!customEndAdres.trim()) throw new Error("Voer een eindadres in.");
                const coords = await RouteOptimizer.geocodeAddress(customEndAdres);
                if (!coords) throw new Error("Kon het eindadres niet vinden.");
                finalEndDepot = { name: 'Eigen Eindpunt', address: customEndAdres, ...coords };
            } else {
                finalEndDepot = REGIONS[endRegion];
            }

            // Check if we have day information for multi-day planning
            const hasBezoekdag = driverAddresses.some(a => !!a.bezoekdag);

            if (hasBezoekdag) {
                // Group by day
                const daysMap = new Map<string, Address[]>();
                driverAddresses.forEach(addr => {
                    const dag = addr.bezoekdag || "Onbekend";
                    if (!daysMap.has(dag)) daysMap.set(dag, []);
                    daysMap.get(dag)!.push(addr);
                });

                const dayResults: DayRoute[] = [];
                for (const [dag, dayAddrs] of Array.from(daysMap.entries())) {
                    // Determine the correct box for THIS specific day
                    let dayStartDepot = finalStartDepot;
                    let dayEndDepot = finalEndDepot;
                    let dayBoxName = startRegion === 'CUSTOM' ? 'Eigen Adres' : startRegion;

                    // Only use day-specific boxes if the user HAS NOT manually overridden the region
                    if (!isManualStartRegion || !isManualEndRegion) {
                        const dayBox = dayAddrs.find(a => !!a.box)?.box;
                        if (dayBox) {
                            const dayRegionKey = findRegionKey(dayBox);
                            if (!isManualStartRegion) {
                                dayStartDepot = REGIONS[dayRegionKey];
                                dayBoxName = dayRegionKey;
                            }
                            if (!isManualEndRegion) {
                                dayEndDepot = REGIONS[dayRegionKey];
                            }
                        }
                    }

                    const result = await RouteOptimizer.optimizeRoute(dayStartDepot, dayAddrs, undefined, dayEndDepot);
                    dayResults.push({
                        bezoekdag: dag,
                        stops: result.stops,
                        totalDistanceKm: Math.round(result.totalDistance / 1000),
                        totalDurationMin: Math.round(result.totalDuration / 60),
                        totalPlaatsingen: dayAddrs.reduce((sum, a) => sum + (a.aantalPlaatsingen || 0), 0),
                        boxName: dayBoxName
                    });
                }
                setMultiDayRoutes(dayResults);
                setStep(3);
            } else {
                const result = await RouteOptimizer.optimizeRoute(finalStartDepot, driverAddresses, undefined, finalEndDepot);
                setRouteData(result);
                setStep(3);
            }
        } catch (e: any) {
            console.error("Route calculation error:", e);
            setError(e.message || "Er is een fout opgetreden bij het berekenen van de route.");
        } finally {
            setIsProcessing(false);
        }
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
                                        onChange={(e) => handleDriverChange(e.target.value)}
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
                                <ConfigPanel 
                                    selectedStartRegion={startRegion} 
                                    selectedEndRegion={endRegion}
                                    customStartAdres={customStartAdres}
                                    customEndAdres={customEndAdres}
                                    onStartRegionChange={handleStartRegionChange}
                                    onEndRegionChange={handleEndRegionChange}
                                    onCustomStartChange={setCustomStartAdres}
                                    onCustomEndChange={setCustomEndAdres}
                                />
                                {selectedDriver && driverBoxMap[selectedDriver] && (!isManualStartRegion || !isManualEndRegion) && (
                                    <div className="text-xs text-blue-600 mt-1 flex items-center gap-1">
                                        <span className="w-1.5 h-1.5 bg-blue-600 rounded-full animate-pulse"></span>
                                        Standaard gekoppeld aan box: <span className="font-semibold">{driverBoxMap[selectedDriver]}</span>
                                    </div>
                                )}
                                {(isManualStartRegion || isManualEndRegion) && (
                                    <div className="text-xs text-orange-600 mt-1 font-medium flex items-center gap-1">
                                        <span>⚠️ Handmatig aangepast</span>
                                        <button 
                                            onClick={() => {
                                                const box = driverBoxMap[selectedDriver];
                                                if (box) {
                                                    const regionKey = findRegionKey(box);
                                                    setStartRegion(regionKey);
                                                    setEndRegion(regionKey);
                                                    setIsManualStartRegion(false);
                                                    setIsManualEndRegion(false);
                                                }
                                            }}
                                            className="ml-2 text-[10px] underline hover:text-orange-700"
                                        >
                                            Herstellen
                                        </button>
                                    </div>
                                )}
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
                {step === 3 && (routeData || multiDayRoutes) && (
                    <div>
                        {multiDayRoutes ? (
                            <div className="space-y-8">
                                {/* Summary Card */}
                                <div className="bg-gradient-to-r from-blue-600 to-blue-700 rounded-2xl shadow-xl p-8 text-white">
                                    <h2 className="text-3xl font-bold mb-2">Gepland voor {selectedDriver}</h2>
                                    <p className="text-blue-100 mb-6">Multi-dag route planning</p>
                                    
                                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                                        <div className="bg-white/20 backdrop-blur rounded-xl p-4">
                                            <p className="text-blue-100 text-sm font-medium">Aantal Dagen</p>
                                            <p className="text-3xl font-bold mt-1">{multiDayRoutes.length}</p>
                                        </div>
                                        <div className="bg-white/20 backdrop-blur rounded-xl p-4">
                                            <p className="text-blue-100 text-sm font-medium">Totale Afstand</p>
                                            <p className="text-3xl font-bold mt-1">{Math.round(multiDayRoutes.reduce((sum, d) => sum + d.totalDistanceKm, 0)).toLocaleString('nl-NL')} km</p>
                                        </div>
                                        <div className="bg-white/20 backdrop-blur rounded-xl p-4">
                                            <p className="text-blue-100 text-sm font-medium">Totale Tijd</p>
                                            <p className="text-3xl font-bold mt-1">{Math.round(multiDayRoutes.reduce((sum, d) => sum + d.totalDurationMin, 0) / 60)}u</p>
                                        </div>
                                        <div className="bg-white/20 backdrop-blur rounded-xl p-4">
                                            <p className="text-blue-100 text-sm font-medium">Totale Plaatsingen</p>
                                            <p className="text-3xl font-bold mt-1">{multiDayRoutes.reduce((sum, d) => sum + d.totalPlaatsingen, 0)}</p>
                                        </div>
                                    </div>
                                </div>

                                {/* Day Cards */}
                                {sortDayRoutes(multiDayRoutes).map(day => {
                                    // Count only real stops (exclude START and ARNHEM/end)
                                    const realStopsCount = day.stops.filter(stop => 
                                        stop.filiaalnr !== 'START' && stop.filiaalnr !== 'ARNHEM' && 
                                        stop.formule !== 'START' && stop.formule !== 'ARNHEM'
                                    ).length;

                                    return (
                                    <div key={day.bezoekdag} className="bg-white rounded-2xl shadow-lg overflow-hidden border border-slate-100 animate-in fade-in slide-in-from-bottom-2">
                                        {/* Day Header - Responsive */}
                                        <div className="bg-gradient-to-r from-slate-50 to-slate-100 border-b border-slate-200 p-4 md:p-6">
                                            <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                                                <div className="flex-shrink-0">
                                                    <h3 className="text-xl md:text-2xl font-bold text-slate-900">{day.bezoekdag}</h3>
                                                    <div className="flex items-center gap-2 mt-1">
                                                        <span className="text-sm text-slate-600">{realStopsCount} stops</span>
                                                        <span className="text-slate-300">•</span>
                                                        <span className="text-sm font-medium text-blue-600 bg-blue-50 px-2 py-0.5 rounded-md">Box: {day.boxName}</span>
                                                    </div>
                                                </div>
                                                <div className="grid grid-cols-3 gap-2 md:gap-4 md:flex">
                                                    <div className="text-center md:text-right">
                                                        <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Afstand</p>
                                                        <p className="text-lg md:text-2xl font-black text-slate-800 mt-1">{day.totalDistanceKm}</p>
                                                        <p className="text-xs text-slate-500">km</p>
                                                    </div>
                                                    <div className="text-center md:text-right">
                                                        <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Reistijd</p>
                                                        <p className="text-lg md:text-2xl font-black text-slate-800 mt-1">{day.totalDurationMin}</p>
                                                        <p className="text-xs text-slate-500">min</p>
                                                    </div>
                                                    <div className="text-center md:text-right">
                                                        <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Plaatsingen</p>
                                                        <p className="text-lg md:text-2xl font-black text-blue-600 mt-1">{day.totalPlaatsingen}</p>
                                                        <p className="text-xs text-slate-500">items</p>
                                                    </div>
                                                </div>
                                            </div>
                                        </div>

                                        {/* Day Content - Responsive */}
                                        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 md:gap-6 p-4 md:p-6">
                                            {/* Route List */}
                                            <div className="lg:col-span-1">
                                                <RouteList route={day.stops} />
                                            </div>
                                            {/* Map */}
                                            <div className="lg:col-span-2 min-h-[300px] md:min-h-[400px]">
                                                <div className="h-full bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden">
                                                    <LeafletMap route={day.stops} />
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                    );
                                })}

                                <div className="flex flex-col sm:flex-row gap-4">
                                    <button onClick={() => setStep(2)} className="flex-1 py-3 bg-blue-600 text-white rounded-xl font-bold hover:bg-blue-700 transition-all shadow-lg shadow-blue-100">
                                        ⚙️ Aanpassingen maken
                                    </button>
                                    <button onClick={reset} className="flex-1 py-3 bg-white border-2 border-slate-200 text-slate-600 hover:border-blue-600 hover:bg-blue-50 rounded-xl font-bold transition-all">
                                        ← Nieuwe Planning
                                    </button>
                                </div>
                            </div>
                        ) : (
                            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 animate-in slide-in-from-bottom-4 duration-500">
                                <div className="lg:col-span-1 space-y-6">
                                    <div className="bg-white rounded-2xl shadow-lg p-6 flex flex-col gap-4 border border-slate-100">
                                        <div className="flex justify-between items-center pb-4 border-b border-slate-100">
                                            <div>
                                                <p className="text-sm text-slate-500 font-medium">Chauffeur</p>
                                                <p className="text-lg font-bold text-slate-800">{selectedDriver}</p>
                                            </div>
                                            <div className="h-10 w-10 bg-blue-50 rounded-full flex items-center justify-center text-blue-600 font-bold text-xl">
                                                {routeData!.stops.length - 1}
                                            </div>
                                        </div>

                                        <div className="grid grid-cols-2 gap-4">
                                            <div className="bg-slate-50 p-3 rounded-xl border border-slate-100">
                                                <p className="text-xs text-slate-500 uppercase font-bold tracking-wider">Afstand</p>
                                                <p className="text-2xl font-black text-slate-800">{Math.round((routeData?.totalDistance ?? 0) / 1000).toLocaleString('nl-NL')}</p>
                                            </div>
                                            <div className="bg-slate-50 p-3 rounded-xl border border-slate-100">
                                                <p className="text-xs text-slate-500 uppercase font-bold tracking-wider">Tijd</p>
                                                <p className="text-2xl font-black text-slate-800">{Math.round((routeData?.totalDuration ?? 0) / 60)}</p>
                                            </div>
                                        </div>
                                    </div>

                                    <div className="bg-white rounded-2xl shadow-lg overflow-hidden border border-slate-100 flex flex-col max-h-[600px]">
                                        <div className="p-4 bg-slate-50 border-b border-slate-100 flex justify-between items-center">
                                            <h3 className="font-bold text-slate-700 flex items-center gap-2">
                                                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-blue-600 text-[10px] font-bold text-white">
                                                    {routeData!.stops.length}
                                                </span>
                                                Stops
                                            </h3>
                                            <div className="flex gap-2">
                                                <button onClick={() => {
                                                    const csvContent = "data:text/csv;charset=utf-8," + routeData!.stops.map(s => `${s.filiaalnr},${s.formule},${s.straat},${s.plaats}`).join("\n");
                                                    const encodedUri = encodeURI(csvContent);
                                                    window.open(encodedUri);
                                                }} className="p-2 text-slate-400 hover:text-blue-600 transition-colors" title="Download CSV">
                                                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"></path></svg>
                                                </button>
                                            </div>
                                        </div>
                                        <div className="overflow-y-auto flex-1 p-2">
                                            <RouteList route={routeData!.stops} />
                                        </div>
                                    </div>

                                    <div className="flex flex-col gap-3">
                                        <button onClick={() => setStep(2)} className="w-full py-3 bg-blue-600 text-white rounded-xl font-bold hover:bg-blue-700 transition-all shadow-lg shadow-blue-100">
                                            ⚙️ Aanpassingen maken
                                        </button>
                                        <button onClick={reset} className="w-full py-3 bg-white border-2 border-slate-200 text-slate-600 hover:border-slate-300 hover:bg-slate-50 rounded-xl font-bold transition-all">
                                            Nieuwe Planning
                                        </button>
                                    </div>
                                </div>

                                <div className="lg:col-span-2 min-h-[500px] lg:h-[calc(100vh-140px)] sticky top-8">
                                    <div className="bg-white rounded-3xl shadow-xl overflow-hidden border border-slate-200 h-full relative group">
                                        <LeafletMap route={routeData!.stops} />
                                        <div className="absolute bottom-4 right-4 z-[400]">
                                            <a href={`https://www.google.com/maps/dir/${routeData!.stops.map(s => encodeURIComponent(s.volledigAdres)).join('/')}`} target="_blank" rel="noopener noreferrer" className="bg-white/90 backdrop-blur text-blue-600 px-4 py-2 rounded-lg font-bold shadow-lg hover:bg-blue-600 hover:text-white transition-all flex items-center gap-2 text-sm">
                                                <MapPin className="w-4 h-4" /> Open in Google Maps
                                            </a>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>
                )}
            </div>
        </main>
    );
}
