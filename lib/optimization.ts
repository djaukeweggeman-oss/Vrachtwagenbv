import { Address } from '@/types';
import { REGIONS } from './regions';

export class RouteOptimizer {

    // Helper to respect Nominatim rate limits (absolute max 1 request per second)
    private static async delay(ms: number) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    static async geocodeAddress(address: string): Promise<{ lat: number, lng: number } | null> {
        try {
            // 1. Try PDOK API (Dutch National Geocoder) - Very reliable for NL, no rate limits
            const pdokQuery = encodeURIComponent(address.replace(', Nederland', ''));
            const pdokUrl = `https://api.pdok.nl/bzk/locatieserver/search/v3_1/free?q=${pdokQuery}&fl=centroide_ll&rows=1`;
            
            try {
                const pdokRes = await fetch(pdokUrl);
                const pdokData = await pdokRes.json();

                if (pdokData?.response?.docs?.length > 0) {
                    const match = pdokData.response.docs[0].centroide_ll.match(/POINT\(([\d.]+) ([\d.]+)\)/);
                    if (match) {
                        return { lat: parseFloat(match[2]), lng: parseFloat(match[1]) };
                    }
                }
            } catch (e) {
                console.warn('PDOK geocoding failed, falling back to Nominatim', e);
            }

            // 2. Fallback to Nominatim (OpenStreetMap) - Free, but requires User-Agent and rate limiting
            const query = encodeURIComponent(address);
            const url = `https://nominatim.openstreetmap.org/search?format=json&q=${query}&countrycodes=nl&limit=1`;

            const res = await fetch(url, {
                headers: {
                    'User-Agent': 'VrachtwagenBV-RoutePlanner/1.0'
                }
            });

            const data = await res.json();

            if (data && data.length > 0) {
                return {
                    lat: parseFloat(data[0].lat),
                    lng: parseFloat(data[0].lon)
                };
            }
            return null;
        } catch (error) {
            console.error("Geocoding error:", error);
            return null;
        }
    }

    // Helper to calculate distance between two coordinates in km
    private static calculateHaversineDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
        const R = 6371; // Earth radius in km
        const dLat = (lat2 - lat1) * Math.PI / 180;
        const dLon = (lon2 - lon1) * Math.PI / 180;
        const a = 
            Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * 
            Math.sin(dLon / 2) * Math.sin(dLon / 2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        return R * c;
    }

    static async optimizeRoute(startDepot: any, addresses: Address[], credentials?: { username: string, password: string }, endDepot?: any): Promise<{ stops: Address[], totalDistance: number, totalDuration: number }> {
        const startPoint = startDepot;
        const endPoint = endDepot || startDepot;

        // 1. Geocode all addresses with RATE LIMITING
        // Nominatim strictly forbids bulk unrestricted scraping. We must throttle.
        const geocodedAddresses: Address[] = [];
        const validAddresses: Address[] = [];

        // Add Start Point First to the list we want to route
        // But we keep it separate for the OSRM call structure

        console.log("Start geocoding...");

        for (const addr of addresses) {
            if (addr.lat && addr.lng) {
                validAddresses.push(addr);
            } else {
                // Wait 1.1 seconds between requests to be safe and respectful
                await this.delay(1100);
                const coords = await this.geocodeAddress(addr.volledigAdres);
                if (coords) {
                    validAddresses.push({ ...addr, ...coords });
                } else {
                    console.warn(`Kon adres niet vinden: ${addr.volledigAdres}`);
                }
            }
        }

        if (validAddresses.length === 0) {
            // Fallback if nothing found: return only the START point
            return {
                stops: [
                    { filiaalnr: 'START', straat: startPoint.address, volledigAdres: startPoint.address, formule: 'START', merchandiser: 'SYSTEM', postcode: '', plaats: startPoint.name, lat: startPoint.lat, lng: startPoint.lng }
                ],
                totalDistance: 0,
                totalDuration: 0
            };
        }

        // 2. Prepare RouteXL locations array
        // RouteXL expects an array of objects: name, lat, lng
        const locations = [
            {
                name: "START_DEPOT",
                lat: Number(startPoint.lat.toFixed(6)),
                lng: Number(startPoint.lng.toFixed(6))
            },
            ...validAddresses.map((addr, index) => ({
                name: `STOP_${addr.filiaalnr || index}`,
                lat: Number(addr.lat!.toFixed(6)),
                lng: Number(addr.lng!.toFixed(6))
            }))
        ];

        const isLoop = endPoint.lat === startPoint.lat && endPoint.lng === startPoint.lng;
        
        locations.push({
            name: "END_DEPOT",
            lat: Number(endPoint.lat.toFixed(6)),
            lng: Number(endPoint.lng.toFixed(6))
        });

        // 3. Call RouteXL API
        const username = credentials?.username || process.env.ROUTEXL_USERNAME || process.env.NEXT_PUBLIC_ROUTEXL_USERNAME;
        const password = credentials?.password || process.env.ROUTEXL_PASSWORD || process.env.NEXT_PUBLIC_ROUTEXL_PASSWORD;

        if (!username || !password) {
            console.error("RouteXL credentials missing. Check .env.local");
            throw new Error("RouteXL inloggegevens ontbreken. Stel ROUTEXL_USERNAME en ROUTEXL_PASSWORD in in .env.local.");
        }

        console.log(`Calling RouteXL for ${username} with ${locations.length} locations...`);
        const auth = btoa(`${username}:${password}`);

        try {
            const res = await fetch('https://api.routexl.com/tour', {
                method: 'POST',
                headers: {
                    'Authorization': `Basic ${auth}`,
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'User-Agent': 'VrachtwagenBV-RoutePlanner/1.0'
                },
                body: `locations=${encodeURIComponent(JSON.stringify(locations))}`
            });

            if (!res.ok) {
                const errorText = await res.text();
                console.error("RouteXL Error Body:", errorText);
                if (res.status === 401) throw new Error("RouteXL inloggegevens onjuist.");
                if (res.status === 429) throw new Error("RouteXL limiet bereikt (max 20 stops gratis).");
                throw new Error(`RouteXL API Fout: ${res.statusText}`);
            }

            const data = await res.json();
            
            if (!data.route) {
                console.error("No route object in response", data);
                throw new Error("Geen route ontvangen van RouteXL.");
            }

            const optimizedOrder: Address[] = [];
            let totalDistanceKm = 0;
            let totalDurationMin = 0;

            const routeKeys = Object.keys(data.route).sort((a, b) => parseInt(a) - parseInt(b));

            routeKeys.forEach((key) => {
                const stop = data.route[key];

                if (stop.name === "START_DEPOT") {
                    optimizedOrder.push({
                        filiaalnr: 'START',
                        formule: 'START',
                        straat: startPoint.address,
                        postcode: startPoint.postcode || '',
                        plaats: startPoint.stad || startPoint.name,
                        volledigAdres: startPoint.address,
                        merchandiser: 'SYSTEM',
                        lat: startPoint.lat,
                        lng: startPoint.lng
                    });
                } else if (stop.name === "END_DEPOT") {
                    // We'll add this at the very end to avoid duplicates if it's the same as START
                    if (!isLoop) {
                        optimizedOrder.push({
                            filiaalnr: 'DEPOT_END',
                            formule: 'DEPOT',
                            straat: endPoint.address,
                            postcode: endPoint.postcode || '',
                            plaats: endPoint.stad || endPoint.name,
                            volledigAdres: endPoint.address,
                            merchandiser: 'SYSTEM',
                            lat: endPoint.lat,
                            lng: endPoint.lng
                        });
                    }
                } else {
                    // Match by filiaalnr first, then by STOP_{index}
                    const nameMatch = stop.name.match(/STOP_(.+)/);
                    let match: Address | null = null;
                    
                    if (nameMatch) {
                        const identifier = nameMatch[1];
                        // Try finding by filiaalnr
                        match = validAddresses.find(a => a.filiaalnr === identifier) || null;
                        
                        // Fallback to index if identifier was an index
                        if (!match && /^\d+$/.test(identifier)) {
                            const idx = parseInt(identifier, 10);
                            match = validAddresses[idx];
                        }
                    }

                    // Fallback to coordinate matching
                    if (!match) {
                        match = validAddresses.find(a =>
                            Math.abs(a.lat! - parseFloat(stop.lat)) < 0.0001 &&
                            Math.abs(a.lng! - parseFloat(stop.lng)) < 0.0001
                        ) || null;
                    }

                    if (match) {
                        optimizedOrder.push(match);
                    } else {
                        console.warn(`Could not match stop back to address: ${stop.name} (${stop.lat}, ${stop.lng})`);
                    }
                }

                if (stop.distance) totalDistanceKm = parseFloat(stop.distance); 
                if (stop.arrival) totalDurationMin = parseFloat(stop.arrival); 
            });

            // If it's a loop and we don't have the end depot yet, add it
            if (isLoop && optimizedOrder[optimizedOrder.length - 1]?.filiaalnr !== 'START') {
                 optimizedOrder.push({
                    filiaalnr: 'DEPOT_END',
                    formule: 'DEPOT',
                    straat: endPoint.address,
                    postcode: endPoint.postcode || '',
                    plaats: endPoint.stad || endPoint.name,
                    volledigAdres: endPoint.address,
                    merchandiser: 'SYSTEM',
                    lat: endPoint.lat,
                    lng: endPoint.lng
                });
            }

            // --- ADD THE FINAL LEG TO END DEPOT ---
            // If the last stop isn't already the endPoint, calculate the missing distance/time
            const lastStop = optimizedOrder[optimizedOrder.length - 1];
            if (lastStop && (lastStop.lat !== endPoint.lat || lastStop.lng !== endPoint.lng)) {
                // Calculate distance from last stop to end depot
                // Use Haversine * 1.3 (typical road distance factor)
                const finalLegKm = this.calculateHaversineDistance(
                    lastStop.lat!, lastStop.lng!,
                    endPoint.lat, endPoint.lng
                ) * 1.3; 
                
                // Estimate time (avg 50 km/h for the final leg)
                const finalLegMin = (finalLegKm / 50) * 60;
                
                totalDistanceKm += finalLegKm;
                totalDurationMin += finalLegMin;
            }

            console.log(`Optimized Route: ${optimizedOrder.length} stops`); // DEBUG

            const startAddress: Address = {
                filiaalnr: 'START',
                formule: 'DEPOT',
                straat: startPoint.address,
                postcode: startPoint.postcode || '',
                plaats: startPoint.stad || startPoint.name,
                volledigAdres: `${startPoint.address}, ${startPoint.postcode || ''} ${startPoint.stad || ''}`.trim(),
                merchandiser: 'SYSTEM',
                lat: startPoint.lat,
                lng: startPoint.lng
            };

            const endAddress: Address = {
                filiaalnr: 'DEPOT_END',
                formule: 'DEPOT',
                straat: endPoint.address,
                postcode: endPoint.postcode || '',
                plaats: endPoint.stad || endPoint.name,
                volledigAdres: `${endPoint.address}, ${endPoint.postcode || ''} ${endPoint.stad || ''}`.trim(),
                merchandiser: 'SYSTEM',
                lat: endPoint.lat,
                lng: endPoint.lng
            };

            // Filter out existing synthetic entries and the depot itself if it appears in the stops
            const coreStops = optimizedOrder.filter(s => {
                if (!s) return false;
                // Remove existing start/end markers
                if (s.filiaalnr === 'START' || s.filiaalnr === 'DEPOT_END') return false;
                
                // Also remove any stop that is exactly at the start or end depot location (to avoid duplicates)
                if (s.lat && s.lng) {
                    const distStart = Math.sqrt(Math.pow(s.lat - startPoint.lat, 2) + Math.pow(s.lng - startPoint.lng, 2));
                    const distEnd = Math.sqrt(Math.pow(s.lat - endPoint.lat, 2) + Math.pow(s.lng - endPoint.lng, 2));
                    if (distStart < 0.0005 || distEnd < 0.0005) return false;
                }
                return true;
            });

            // Combine: [START] -> [CORE STOPS] -> [END]
            const finalStops = [startAddress, ...coreStops, endAddress];

            return {
                stops: finalStops,
                totalDistance: totalDistanceKm * 1000, // Convert km to meters
                totalDuration: totalDurationMin * 60  // Convert minutes to seconds
            };

        } catch (e: any) {
            console.error("RouteXL Error", e);
            throw e; // Rethrow to show to user
        }
    }
}
