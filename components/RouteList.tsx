import React from 'react';
import { Address } from '@/types';
import { MapPin, Navigation, Building2 } from 'lucide-react';

interface RouteListProps {
    route: Address[];
}

export function RouteList({ route }: RouteListProps) {
    if (!route || route.length === 0) return null;

    return (
        <div className="bg-white rounded-xl border border-border shadow-sm overflow-hidden flex flex-col h-[600px]">
            <div className="p-4 border-b border-border bg-gray-50 flex justify-between items-center sticky top-0 z-10">
                <h2 className="font-semibold flex items-center gap-2">
                    <Navigation className="w-5 h-5 text-primary" />
                    Route Overzicht ({route.length} stops)
                </h2>
            </div>

            <div className="overflow-y-auto flex-1 p-0">
                {route.map((stop, index) => (
                    <div
                        key={`${stop.filiaalnr}-${index}`}
                        className="group flex gap-4 p-4 border-b border-border hover:bg-blue-50/50 transition-colors last:border-0 relative"
                    >
                        {/* Stop Number Badge */}
                        <div className="flex-shrink-0">
                            <div className="w-8 h-8 rounded-full bg-primary text-primary-foreground flex items-center justify-center font-bold text-sm shadow-sm ring-2 ring-white">
                                {index + 1}
                            </div>
                            {index !== route.length - 1 && (
                                <div className="w-0.5 bg-gray-200 h-full absolute left-[2rem] top-10 -translate-x-1/2" />
                            )}
                        </div>

                        {/* Content */}
                        <div className="flex-1 min-w-0">
                            <div className="flex items-start justify-between gap-2">
                                <div>
                                    <h3 className="font-semibold text-gray-900 truncate">
                                        {stop.formule === 'START' ? 'Startpunt' : stop.formule || 'Winkel'}
                                        {stop.filiaalnr !== 'START' && <span className="text-muted-foreground font-normal ml-2">#{stop.filiaalnr}</span>}
                                    </h3>
                                    <p className="text-sm text-gray-600 mt-0.5 flex items-center gap-1.5">
                                        <MapPin className="w-3.5 h-3.5 shrink-0 text-gray-400" />
                                        {stop.straat}, {stop.plaats}
                                    </p>
                                    {typeof stop.aantalPlaatsingen !== 'undefined' && (
                                        <p className="text-sm text-gray-600 mt-1">Aantal plaatsingen: <span className="font-semibold">{stop.aantalPlaatsingen}</span></p>
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>
                ))}
            </div>

            <div className="p-4 border-t border-border bg-gray-50 text-center text-xs text-muted-foreground">
                Scroll voor meer • {route.length} adressen
            </div>
        </div>
    );
}
