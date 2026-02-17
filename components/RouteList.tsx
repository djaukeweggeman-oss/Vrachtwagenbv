import React from 'react';
import { Address } from '@/types';
import { MapPin, Navigation, Building2 } from 'lucide-react';

interface RouteListProps {
    route: Address[];
}

export function RouteList({ route }: RouteListProps) {
    if (!route || route.length === 0) return null;

    // Filter out START and ARNHEM/END stops for counting actual visits
    const realStops = route.filter(stop => 
        stop.filiaalnr !== 'START' && stop.filiaalnr !== 'ARNHEM' && stop.formule !== 'START' && stop.formule !== 'ARNHEM'
    );

    // Group by address and sum plaatsingen for display (excluding START/END)
    const displayStops = route.map((stop, index) => ({
        ...stop,
        displayIndex: index + 1
    }));

    return (
        <div className="bg-white rounded-xl border border-border shadow-sm overflow-hidden flex flex-col">
            <div className="p-4 border-b border-border bg-gray-50 flex justify-between items-center sticky top-0 z-10">
                <h2 className="font-semibold flex items-center gap-2">
                    <Navigation className="w-5 h-5 text-primary" />
                    Route Overzicht ({realStops.length} stops)
                </h2>
            </div>

            <div className="overflow-y-auto flex-1 p-0 max-h-[600px]">
                {displayStops.map((stop, index) => (
                    <div
                        key={`${stop.filiaalnr}-${index}`}
                        className="group flex gap-4 p-4 border-b border-border hover:bg-blue-50/50 transition-colors last:border-0 relative"
                    >
                        {/* Stop Number Badge */}
                        <div className="flex-shrink-0">
                            <div className="w-8 h-8 rounded-full bg-primary text-primary-foreground flex items-center justify-center font-bold text-sm shadow-sm ring-2 ring-white">
                                {stop.displayIndex}
                            </div>
                            {index !== displayStops.length - 1 && (
                                <div className="w-0.5 bg-gray-200 h-8 absolute left-[2rem] top-10 -translate-x-1/2" />
                            )}
                        </div>

                        {/* Content */}
                        <div className="flex-1 min-w-0">
                            <div className="flex items-start justify-between gap-2">
                                <div className="flex-1">
                                    <h3 className="font-semibold text-gray-900 truncate">
                                        {stop.formule === 'START' ? 'Startpunt' : stop.formule === 'ARNHEM' ? 'Eindpunt Arnhem' : stop.formule || 'Winkel'}
                                        {stop.filiaalnr !== 'START' && stop.filiaalnr !== 'ARNHEM' && <span className="text-muted-foreground font-normal ml-2">#{stop.filiaalnr}</span>}
                                    </h3>
                                    <p className="text-sm text-gray-600 mt-0.5 flex items-center gap-1.5">
                                        <MapPin className="w-3.5 h-3.5 shrink-0 text-gray-400" />
                                        {stop.straat}, {stop.plaats}
                                    </p>
                                    {typeof stop.aantalPlaatsingen !== 'undefined' && stop.aantalPlaatsingen > 0 && (
                                        <div className="mt-2 inline-flex items-center gap-1 bg-blue-100 text-blue-700 px-2.5 py-1 rounded-full text-xs font-semibold">
                                            <span>📦</span>
                                            <span>{stop.aantalPlaatsingen} {stop.aantalPlaatsingen === 1 ? 'plaatsing' : 'plaatsingen'}</span>
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>
                ))}
            </div>

            <div className="p-4 border-t border-border bg-gray-50 text-center text-xs text-muted-foreground">
                Scroll voor meer • {realStops.length} stops
            </div>
        </div>
    );
}
