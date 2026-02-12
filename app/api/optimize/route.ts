import { NextRequest, NextResponse } from 'next/server';
import { Address } from '@/types';
import { REGIONS } from '@/lib/regions';

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function geocodeAddress(address: string): Promise<{ lat: number, lng: number } | null> {
    try {
        const query = encodeURIComponent(address);
        const url = `https://nominatim.openstreetmap.org/search?format=json&q=${query}&countrycodes=nl&limit=1`;
        const res = await fetch(url, {
            headers: { 'User-Agent': 'VrachtwagenBV-RoutePlanner/1.0' }
        });
        const data = await res.json();
        if (data && data.length > 0) return { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) };
        return null;
    } catch (e) {
        console.error('Server geocoding error', e);
        return null;
    }
}

export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        const startRegion: keyof typeof REGIONS = body.startRegion;
        const addresses: Address[] = body.addresses || [];
        const startPoint = REGIONS[startRegion];

        const validAddresses: Address[] = [];
        for (const addr of addresses) {
            if (addr.lat && addr.lng) validAddresses.push(addr);
            else {
                await delay(1100);
                const coords = await geocodeAddress(addr.volledigAdres);
                if (coords) validAddresses.push({ ...addr, ...coords });
                else console.warn('Kon adres niet vinden:', addr.volledigAdres);
            }
        }

        if (validAddresses.length === 0) {
            return NextResponse.json({
                stops: [{ filiaalnr: 'START', straat: startPoint.address, volledigAdres: startPoint.address, formule: 'START', merchandiser: 'SYSTEM', postcode: '', plaats: startPoint.name, lat: startPoint.lat, lng: startPoint.lng }],
                totalDistance: 0,
                totalDuration: 0
            });
        }

        const locations = [
            { name: 'Start', lat: startPoint.lat, lng: startPoint.lng, restrictions: { ready: 0, due: 999 } },
            ...validAddresses.map((addr, idx) => ({ name: `Stop ${idx + 1} - ${addr.filiaalnr}`, lat: addr.lat, lng: addr.lng, restrictions: { ready: 0, due: 999 } }))
        ];

        const username = process.env.ROUTEXL_USERNAME;
        const password = process.env.ROUTEXL_PASSWORD;
        if (!username || !password) {
            return NextResponse.json({ error: 'Server RouteXL credentials ontbreken' }, { status: 500 });
        }

        const auth = Buffer.from(`${username}:${password}`).toString('base64');

        const res = await fetch('https://api.routexl.com/tour', {
            method: 'POST',
            headers: { 'Authorization': `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
            body: `locations=${encodeURIComponent(JSON.stringify(locations))}`
        });

        if (!res.ok) {
            const text = await res.text();
            console.error('RouteXL server error:', res.status, text);
            return NextResponse.json({ error: text || 'RouteXL fout' }, { status: res.status });
        }

        const data = await res.json();
        if (!data.route) {
            console.error('Geen route in RouteXL response', data);
            return NextResponse.json({ error: 'Geen route ontvangen van RouteXL' }, { status: 500 });
        }

        const keys = Object.keys(data.route).sort((a, b) => parseInt(a) - parseInt(b));
        const optimizedOrder: Address[] = [];
        let totalDistanceKm = 0;
        let totalDurationMin = 0;

        for (const key of keys) {
            const stop = data.route[key];
            if (stop.name === 'Start') {
                optimizedOrder.push({ filiaalnr: 'START', formule: 'START', straat: startPoint.address, postcode: '', plaats: startPoint.name, volledigAdres: startPoint.address, merchandiser: 'SYSTEM', lat: startPoint.lat, lng: startPoint.lng });
            } else {
                const nameMatch = stop.name.match(/Stop \d+ - (.+)/);
                let match: Address | undefined = undefined;
                if (nameMatch) {
                    const filiaalnr = nameMatch[1];
                    match = validAddresses.find(a => a.filiaalnr === filiaalnr);
                }
                if (!match) {
                    match = validAddresses.find(a => Math.abs(a.lat! - parseFloat(stop.lat)) < 0.001 && Math.abs(a.lng! - parseFloat(stop.lng)) < 0.001);
                }
                if (match) optimizedOrder.push(match);
                else console.warn('Could not match stop back to address:', stop.name);
            }

            if (stop.distance) totalDistanceKm = parseFloat(stop.distance);
            if (stop.arrival) totalDurationMin = parseFloat(stop.arrival);
        }

        return NextResponse.json({ stops: optimizedOrder, totalDistance: totalDistanceKm * 1000, totalDuration: totalDurationMin * 60 });

    } catch (e: any) {
        console.error('Optimize API error', e);
        return NextResponse.json({ error: e.message || 'Interne server fout' }, { status: 500 });
    }
}
