import { Address } from '@/types';

// Startpunten configuratie
export const REGIONS = {
    ARNHEM: {
        name: 'Arnhem',
        address: 'Vlamoven 7, Arnhem',
        lat: 51.9866,
        lng: 5.9525
    },
    UTRECHT: {
        name: 'Utrecht',
        address: 'Franciscusdreef 68, Utrecht',
        lat: 52.1260,
        lng: 5.1054
    }
};

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

    static async optimizeRoute(startRegion: keyof typeof REGIONS, addresses: Address[]): Promise<{ stops: Address[], distance: number, duration: number }> {
        const startPoint = REGIONS[startRegion];

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
            // Fallback if nothing found
            return {
                stops: [
                    { ...validAddresses[0], filiaalnr: 'START', straat: startPoint.address, volledigAdres: startPoint.address, formule: 'START', merchandiser: 'SYSTEM', lat: startPoint.lat, lng: startPoint.lng },
                    ...validAddresses
                ],
                distance: 0,
                duration: 0
            };
        }

        // 2. Prepare RouteXL locations array
        // RouteXL expects an array of objects: name, lat, lng
        // The first location is the start point if not specified otherwise
        const locations = [
            {
                name: "Start",
                lat: startPoint.lat,
                lng: startPoint.lng,
                restrictions: {
                    ready: 0,
                    due: 999
                }
            },
            ...validAddresses.map((addr, index) => ({
                name: `Stop ${index + 1} - ${addr.filiaalnr}`, // Use unique name
                lat: addr.lat!,
                lng: addr.lng!,
                restrictions: {
                    ready: 0,
                    due: 999
                }
            }))
        ];

        // 3. Call RouteXL API
        const username = process.env.NEXT_PUBLIC_ROUTEXL_USERNAME;
        const password = process.env.NEXT_PUBLIC_ROUTEXL_PASSWORD;

        if (!username || !password) {
            throw new Error("RouteXL inloggegevens ontbreken. Stel NEXT_PUBLIC_ROUTEXL_USERNAME en NEXT_PUBLIC_ROUTEXL_PASSWORD in.");
        }

        const auth = btoa(`${username}:${password}`);

        try {
            const res = await fetch('https://api.routexl.com/tour', {
                method: 'POST',
                headers: {
                    'Authorization': `Basic ${auth}`,
                    'Content-Type': 'application/x-www-form-urlencoded' // RouteXL expects form or JSON? JSON usually better but docs vary. Let's try JSON first but RouteXL often uses form data for `locations`.
                    // Actually, RouteXL documentation says: POST to /tour with `locations` parameter (JSON array).
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
            console.log("RouteXL Response:", JSON.stringify(data, null, 2)); // DEBUG LOGGING

            // RouteXL returns: { id: "tour_id", count: N, ... , route: { "0": {...}, "1": {...} } }
            // The route object keys are the sequence order (0, 1, 2...)

            const optimizedOrder: Address[] = [];
            let totalDistance = 0; // cumulative km
            let totalDuration = 0; // cumulative min

            // Extract route values and sort by key (sequence)
            // Check if 'route' property exists
            if (!data.route) {
                console.error("No route object in response", data);
                throw new Error("Geen route ontvangen van RouteXL.");
            }

            const routeKeys = Object.keys(data.route).sort((a, b) => parseInt(a) - parseInt(b));

            routeKeys.forEach((key) => {
                const stop = data.route[key];
                // stop contains: { name, arrival, distance, ... }

                // Find the original address by matching name or coordinates
                // Our names were "Start" or "Stop N - ID"

                if (stop.name === "Start") {
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
                    // Try to find the matching address
                    // Our names are formatted as "Stop N - FILIAALNR"
                    // Extract the filiaalnr from the name and match

                    let match = null;

                    // Extract filiaalnr from stop name (format: "Stop 1 - 1498")
                    const nameMatch = stop.name.match(/Stop \d+ - (.+)/);
                    if (nameMatch) {
                        const filiaalnr = nameMatch[1];
                        match = validAddresses.find(a => a.filiaalnr === filiaalnr);
                    }

                    // Fallback to coordinate matching if name matching fails
                    if (!match) {
                        match = validAddresses.find(a =>
                            Math.abs(a.lat! - parseFloat(stop.lat)) < 0.001 &&
                            Math.abs(a.lng! - parseFloat(stop.lng)) < 0.001
                        );
                    }

                    if (match) {
                        optimizedOrder.push(match);
                    } else {
                        console.warn(`Could not match stop back to address: ${stop.name} (${stop.lat}, ${stop.lng})`);
                    }
                }

                // RouteXL gives cumulative distance in km? Or meters?
                // Usually km. Let's assume km.
                if (stop.distance) totalDistance = parseFloat(stop.distance); // This is cumulative distance at this stop
                // duration is usually minutes?
                if (stop.arrival) {
                    // arrival is relative time in minutes from start?
                    totalDuration = parseFloat(stop.arrival);
                }
            });

            console.log(`Optimized Route: ${optimizedOrder.length} stops`); // DEBUG

            return {
                stops: optimizedOrder,
                distance: totalDistance * 1000, // Convert km to meters for consistency
                duration: totalDuration * 60  // Convert min to seconds for consistency
            };

        } catch (e: any) {
            console.error("RouteXL Error", e);
            throw e; // Rethrow to show to user
        }
    }
}
