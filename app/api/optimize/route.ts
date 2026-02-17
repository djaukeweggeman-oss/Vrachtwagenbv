import { NextRequest, NextResponse } from 'next/server';
import { Address, DayRoute } from '@/types';
import { REGIONS } from '@/lib/regions';
import { RouteOptimizer } from '@/lib/optimization';

// RouteXL API credentials - fallback hardcoded values
const ROUTEXL_USERNAME = process.env.ROUTEXL_USERNAME || 'Vrachtwagenbv';
const ROUTEXL_PASSWORD = process.env.ROUTEXL_PASSWORD || 'muhpev-0nawmu-Gaqkis';

// Helper to respect Nominatim rate limits (absolute max 1 request per second)
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function geocodeAddress(address: string): Promise<{ lat: number, lng: number } | null> {
    try {
        const query = encodeURIComponent(address);
        const url = `https://nominatim.openstreetmap.org/search?format=json&q=${query}&countrycodes=nl&limit=1`;
        const res = await fetch(url, {
            headers: {
                'User-Agent': 'VrachtwagenBV-RoutePlanner/1.0'
            }
        });
        const data = await res.json();
        if (data && data.length > 0) {
            return { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) };
        }
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

        // Geocode addresses if necessary
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

        // Get credentials from environment or use fallback
        const username = ROUTEXL_USERNAME;
        const password = ROUTEXL_PASSWORD;

        console.log('🔐 RouteXL API Request:');
        console.log(`- Using username: ${username}`);
        console.log(`- Credentials available: ${username && password ? '✓ YES' : '✗ NO'}`);

        if (!username || !password) {
            console.error('❌ No credentials available');
            return NextResponse.json({ error: 'Server RouteXL credentials ontbreken' }, { status: 500 });
        }

        const auth = Buffer.from(`${username}:${password}`).toString('base64');

        const res = await fetch('https://api.routexl.com/tour', {
            method: 'POST',
            headers: {
                'Authorization': `Basic ${auth}`,
                'Content-Type': 'application/x-www-form-urlencoded'
            },
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

            // If addresses include 'bezoekdag', group per dag and calculate separate routes
            const hasDayInfo = addresses.some(a => !!a.bezoekdag);

            if (!hasDayInfo) {
                // Ensure Arnhem as final stop (existing behavior)
                const arnhemRegion = REGIONS.ARNHEM;
                const arnhemAddress: Address = {
                    filiaalnr: 'ARNHEM',
                    formule: 'ARNHEM',
                    straat: arnhemRegion.address,
                    postcode: '',
                    plaats: arnhemRegion.name,
                    volledigAdres: arnhemRegion.address,
                    merchandiser: 'SYSTEM',
                    lat: arnhemRegion.lat,
                    lng: arnhemRegion.lng
                };

                const filtered = optimizedOrder.filter(s => {
                    if (!s) return false;
                    if (s.filiaalnr === 'ARNHEM') return false;
                    if (s.plaats && s.plaats.toLowerCase() === arnhemRegion.name.toLowerCase()) return false;
                    if (s.lat && s.lng) {
                        if (Math.abs(s.lat - arnhemRegion.lat) < 0.0005 && Math.abs(s.lng - arnhemRegion.lng) < 0.0005) return false;
                    }
                    return true;
                });

                filtered.push(arnhemAddress);

                return NextResponse.json({ stops: filtered, totalDistance: totalDistanceKm * 1000, totalDuration: totalDurationMin * 60 });
            }

            // Group addresses by bezoekdag for multi-day optimization
            const dayMap: Record<string, Address[]> = {};
            for (const a of addresses) {
                const day = (a.bezoekdag || 'Onbekend').toString();
                if (!dayMap[day]) dayMap[day] = [];
                dayMap[day].push(a);
            }

            const dayResults: DayRoute[] = [];

            for (const [day, addrs] of Object.entries(dayMap)) {
                console.log(`📅 Processing day: ${day} with ${addrs.length} addresses`);
                
                // Deduplicate per day on volledigAdres, but sum up plaatsingen
                const addressMap = new Map<string, Address>();
                for (const addr of addrs) {
                    if (addressMap.has(addr.volledigAdres)) {
                        const existing = addressMap.get(addr.volledigAdres)!;
                        existing.aantalPlaatsingen = (existing.aantalPlaatsingen || 0) + (addr.aantalPlaatsingen || 0);
                    } else {
                        addressMap.set(addr.volledigAdres, { ...addr });
                    }
                }
                
                const unique = Array.from(addressMap.values());
                console.log(`✅ After dedup for ${day}: ${addrs.length} → ${unique.length} unique addresses`);

                // Call RouteOptimizer for this day's addresses
                let optimized;
                try {
                    optimized = await RouteOptimizer.optimizeRoute(startRegion, unique);
                    console.log(`🗺️ Route optimized for ${day}: ${optimized.stops?.length} stops`);
                } catch (e) {
                    console.error('Route optimization failed for day', day, e);
                    // fallback: return the unique list as stops with zero totals
                    const totalPlaat = unique.reduce((s, a) => s + (a.aantalPlaatsingen || 0), 0);
                    dayResults.push({
                        bezoekdag: day,
                        stops: unique,
                        totalDistanceKm: 0,
                        totalDurationMin: 0,
                        totalPlaatsingen: totalPlaat
                    });
                    continue;
                }

                const totalPlaatsingen = (optimized.stops || []).reduce((s, a) => s + (a.aantalPlaatsingen || 0), 0);
                dayResults.push({
                    bezoekdag: day,
                    stops: optimized.stops,
                    totalDistanceKm: Math.round((optimized.totalDistance || 0) / 1000),
                    totalDurationMin: Math.round((optimized.totalDuration || 0) / 60),
                    totalPlaatsingen
                });
            }

            return NextResponse.json({ days: dayResults });

    } catch (e: any) {
        console.error('Optimize API error', e);
        return NextResponse.json({ error: e.message || 'Interne server fout' }, { status: 500 });
    }
}
