import { Address } from '@/types';
import { REGIONS } from './regions';

export class RouteOptimizer {

    // Helper to respect Nominatim rate limits (absolute max 1 request per second)
    private static async delay(ms: number) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    static async geocodeAddress(address: string): Promise<{ lat: number, lng: number } | null> {
        try {
            // Use Nominatim (OpenStreetMap) - Free, but requires User-Agent and rate limiting
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
        // The first location is the start point if not specified otherwise
        const locations = [
            {
                name: "START_DEPOT",
                lat: startPoint.lat,
                lng: startPoint.lng,
                restrictions: {
                    ready: 0,
                    due: 999
                }
            },
            ...validAddresses.map((addr, index) => ({
                name: `STOP_${index}`, // Uniquely identify each stop by its true index
                lat: addr.lat!,
                lng: addr.lng!,
                restrictions: {
                    ready: 0,
                    due: 999
                }
            }))
        ];

        // 3. Call RouteXL API
        const username = credentials?.username || process.env.ROUTEXL_USERNAME || process.env.NEXT_PUBLIC_ROUTEXL_USERNAME;
        const password = credentials?.password || process.env.ROUTEXL_PASSWORD || process.env.NEXT_PUBLIC_ROUTEXL_PASSWORD;

        if (!username || !password) {
            throw new Error("RouteXL inloggegevens ontbreken. Stel ROUTEXL_USERNAME en ROUTEXL_PASSWORD in in .env.local.");
        }

        const auth = btoa(`${username}:${password}`);

        try {
            const res = await fetch('https://api.routexl.com/tour', {
                method: 'POST',
                headers: {
                    'Authorization': `Basic ${auth}`,
                    'Content-Type': 'application/x-www-form-urlencoded'
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
                        postcode: '',
                        plaats: startPoint.name,
                        volledigAdres: startPoint.address,
                        merchandiser: 'SYSTEM',
                        lat: startPoint.lat,
                        lng: startPoint.lng
                    });
                } else {
                    // Match the precise index from "STOP_{index}"
                    const nameMatch = stop.name.match(/STOP_(\d+)/);
                    let match: Address | null = null;
                    
                    if (nameMatch) {
                        const originalIndex = parseInt(nameMatch[1], 10);
                        match = validAddresses[originalIndex];
                    }

                    // Fallback to coordinate matching if name matching completely fails somehow
                    if (!match) {
                        match = validAddresses.find(a =>
                            Math.abs(a.lat! - parseFloat(stop.lat)) < 0.001 &&
                            Math.abs(a.lng! - parseFloat(stop.lng)) < 0.001
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
