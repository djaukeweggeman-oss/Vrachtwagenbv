import { NextRequest, NextResponse } from 'next/server';
import { Address, DayRoute } from '@/types';
import { REGIONS } from '@/lib/regions';
import { RouteOptimizer } from '@/lib/optimization';

// RouteXL API credentials - must be set in .env.local
const ROUTEXL_USERNAME = process.env.ROUTEXL_USERNAME;
const ROUTEXL_PASSWORD = process.env.ROUTEXL_PASSWORD;

// Helper to respect Nominatim rate limits (absolute max 1 request per second)
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// Shared cache across API calls
const geocodeCache = new Map<string, { lat: number, lng: number }>();

async function geocodeAddress(address: string): Promise<{ lat: number, lng: number } | null> {
    if (geocodeCache.has(address)) return geocodeCache.get(address)!;

    try {
        // 1. Try PDOK API (Dutch National Geocoder) - Blazing fast, NO rate limits
        const pdokQuery = encodeURIComponent(address.replace(', Nederland', ''));
        const pdokUrl = `https://api.pdok.nl/bzk/locatieserver/search/v3_1/free?q=${pdokQuery}&fl=centroide_ll&rows=1`;
        const pdokRes = await fetch(pdokUrl);
        const pdokData = await pdokRes.json();

        if (pdokData?.response?.docs?.length > 0) {
            const match = pdokData.response.docs[0].centroide_ll.match(/POINT\(([\d.]+) ([\d.]+)\)/);
            if (match) {
                const coords = { lat: parseFloat(match[2]), lng: parseFloat(match[1]) };
                geocodeCache.set(address, coords);
                return coords;
            }
        }

        // 2. Fallback to Nominatim OpenStreetMap (Rate limited)
        await delay(500); 
        const query = encodeURIComponent(address);
        const url = `https://nominatim.openstreetmap.org/search?format=json&q=${query}&countrycodes=nl&limit=1`;
        const res = await fetch(url, { headers: { 'User-Agent': 'VrachtwagenBV-RoutePlanner/1.0' } });
        const data = await res.json();
        
        if (data && data.length > 0) {
            const coords = { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) };
            geocodeCache.set(address, coords);
            return coords;
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

        // Geocode addresses SEQUENTIALLY to respect rate limits (especially for Nominatim)
        const validAddresses: Address[] = [];
        
        console.log(`Starting sequential geocoding for ${addresses.length} addresses...`);
        for (const addr of addresses) {
            if (addr.lat && addr.lng) {
                validAddresses.push(addr);
                continue;
            }
            
            try {
                const coords = await geocodeAddress(addr.volledigAdres);
                if (coords) {
                    validAddresses.push({ ...addr, ...coords });
                } else {
                    console.warn('Kon adres niet vinden:', addr.volledigAdres);
                }
            } catch (e) {
                console.error(`Geocode error for ${addr.volledigAdres}:`, e);
            }
        }

        if (validAddresses.length === 0) {
            return NextResponse.json({
                stops: [{ filiaalnr: 'START', straat: startPoint.address, volledigAdres: startPoint.address, formule: 'START', merchandiser: 'SYSTEM', postcode: '', plaats: startPoint.name, lat: startPoint.lat, lng: startPoint.lng }],
                totalDistance: 0,
                totalDuration: 0
            });
        }

        // ⭐ CRITICAL: Check for multi-day BEFORE calling RouteXL
        const hasDayInfo = addresses.some(a => !!a.bezoekdag);

        if (hasDayInfo) {
            // 🗓️ MULTI-DAY PATH: Optimize per day individually to avoid "too many locations" error
            console.log('📅 Multi-day route detected. Processing per day...');

            // Group addresses by bezoekdag
            const dayMap: Record<string, Address[]> = {};
            for (const a of validAddresses) {
                const day = (a.bezoekdag || 'Onbekend').toString();
                if (!dayMap[day]) dayMap[day] = [];
                dayMap[day].push(a);
            }

            const dayResults: DayRoute[] = [];

            for (const [day, addrs] of Object.entries(dayMap)) {
                console.log(`📅 Processing day: ${day} with ${addrs.length} addresses`);
                
                // Deduplicate per day on filiaalnr + volledigAdres, summing up plaatsingen
                const addressMap = new Map<string, Address>();
                for (const addr of addrs) {
                    const key = `${addr.filiaalnr}|${addr.volledigAdres}`;
                    if (addressMap.has(key)) {
                        const existing = addressMap.get(key)!;
                        existing.aantalPlaatsingen = (existing.aantalPlaatsingen || 0) + (addr.aantalPlaatsingen || 0);
                    } else {
                        addressMap.set(key, { ...addr });
                    }
                }
                
                const unique = Array.from(addressMap.values());
                console.log(`✅ After dedup for ${day}: ${addrs.length} → ${unique.length} unique addresses`);

                // Call RouteOptimizer for this day's addresses
                let optimized;
                try {
                    optimized = await RouteOptimizer.optimizeRoute(startPoint, unique, { username: ROUTEXL_USERNAME, password: ROUTEXL_PASSWORD });
                    console.log(`🗺️ Route optimized for ${day}: ${optimized.stops?.length} stops`);
                } catch (e) {
                    console.error('Route optimization failed for day', day, e);
                    // fallback: return the unique list as stops with zero totals
                    const totalPlaat = unique.reduce((s, a) => s + (a.aantalPlaatsingen || 0), 0);
                    dayResults.push({
                        bezoekdag: day,
                        stops: unique,
                        totalDistanceKm: 0,
                        totalDistanceMeters: 0,
                        totalDurationMin: 0,
                        totalDurationSeconds: 0,
                        totalPlaatsingen: totalPlaat
                    });
                    continue;
                }

                const totalPlaatsingen = (optimized.stops || []).reduce((s, a) => s + (a.aantalPlaatsingen || 0), 0);
                dayResults.push({
                    bezoekdag: day,
                    stops: optimized.stops,
                    totalDistanceKm: Math.round((optimized.totalDistance || 0) / 1000),
                    totalDistanceMeters: optimized.totalDistance || 0,
                    totalDurationMin: Math.round((optimized.totalDuration || 0) / 60),
                    totalDurationSeconds: optimized.totalDuration || 0,
                    totalPlaatsingen
                });
            }

            return NextResponse.json({ days: dayResults });
        }

        // 🚗 SINGLE-DAY PATH: Original behavior - one big route
        console.log('🚗 Single-day route. Making one optimized route...');

        // Use the same logic as RouteOptimizer for consistency
        const optimized = await RouteOptimizer.optimizeRoute(startPoint, validAddresses, { username: ROUTEXL_USERNAME, password: ROUTEXL_PASSWORD });
        return NextResponse.json(optimized);

    } catch (e: any) {
        console.error('Optimize API error', e);
        return NextResponse.json({ error: e.message || 'Interne server fout' }, { status: 500 });
    }
}
