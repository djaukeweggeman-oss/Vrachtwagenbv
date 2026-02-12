"use client";

import { useEffect, useState } from 'react';
import { MapContainer, TileLayer, Marker, Popup, Polyline, useMap } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import { Address } from '@/types';
import L from 'leaflet';

// Fix for default markers in Next.js
const iconUrl = 'https://unpkg.com/leaflet@1.7.1/dist/images/marker-icon.png';
const iconRetinaUrl = 'https://unpkg.com/leaflet@1.7.1/dist/images/marker-icon-2x.png';
const shadowUrl = 'https://unpkg.com/leaflet@1.7.1/dist/images/marker-shadow.png';

const DefaultIcon = L.icon({
    iconUrl,
    iconRetinaUrl,
    shadowUrl,
    iconSize: [25, 41],
    iconAnchor: [12, 41],
    popupAnchor: [1, -34],
    tooltipAnchor: [16, -28],
    shadowSize: [41, 41]
});

L.Marker.prototype.options.icon = DefaultIcon;

// Numbered Icon generator
const createNumberedIcon = (number: number) => {
    return L.divIcon({
        className: 'custom-div-icon',
        html: `<div style="background-color: #3b82f6; width: 24px; height: 24px; border-radius: 50%; color: white; display: flex; align-items: center; justify-content: center; font-weight: bold; font-size: 12px; border: 2px solid white; box-shadow: 0 2px 4px rgba(0,0,0,0.2);">${number}</div>`,
        iconSize: [24, 24],
        iconAnchor: [12, 12]
    });
};

interface MapProps {
    route: Address[];
}

function MapUpdater({ route }: { route: Address[] }) {
    const map = useMap();

    useEffect(() => {
        if (route.length > 0) {
            const bounds = L.latLngBounds(route.map(p => [p.lat || 0, p.lng || 0]));
            map.fitBounds(bounds, { padding: [50, 50] });
        }
    }, [route, map]);

    return null;
}

export default function LeafletMap({ route }: MapProps) {
    const [mounted, setMounted] = useState(false);

    useEffect(() => {
        setMounted(true);
    }, []);

    if (!mounted) return <div className="h-[600px] w-full bg-slate-100 animate-pulse rounded-xl" />;

    const centerPosition: [number, number] = route.length > 0 && route[0].lat && route[0].lng
        ? [route[0].lat, route[0].lng]
        : [52.1326, 5.2913]; // Netherlands center

    const polylinePositions = route
        .filter(p => p.lat && p.lng)
        .map(p => [p.lat!, p.lng!] as [number, number]);

    return (
        <div className="h-[600px] w-full rounded-xl overflow-hidden shadow-sm border border-border z-0">
            <MapContainer
                center={centerPosition}
                zoom={8}
                scrollWheelZoom={true}
                style={{ height: '100%', width: '100%' }}
            >
                <TileLayer
                    attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                    url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                />

                <MapUpdater route={route} />

                {route.map((stop, index) => (
                    stop.lat && stop.lng && (
                        <Marker
                            key={`${stop.filiaalnr}-${index}`}
                            position={[stop.lat, stop.lng]}
                            icon={createNumberedIcon(index + 1)}
                        >
                            <Popup>
                                <strong>Stop {index + 1}</strong><br />
                                {stop.volledigAdres}<br />
                                {stop.merchandiser}
                            </Popup>
                        </Marker>
                    )
                ))}

                {polylinePositions.length > 1 && (
                    <Polyline
                        positions={polylinePositions}
                        color="#3b82f6"
                        weight={4}
                        opacity={0.7}
                    />
                )}
            </MapContainer>
        </div>
    );
}
