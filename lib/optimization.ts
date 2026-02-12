import { Address } from '@/types';

// Startpunten configuratie
export const REGIONS = {
    ARNHEM: {
        name: 'Arnhem',
        address: 'Vlamoven 7, Arnhem',
        lat: 51.9866, // Approx
        lng: 5.9525   // Approx
    },
    UTRECHT: {
        name: 'Utrecht',
        address: 'Franciscusdreef 68, Utrecht',
        lat: 52.1260, // Approx
        lng: 5.1054   // Approx
    }
};

const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;

export class RouteOptimizer {

    static async geocodeAddress(address: string): Promise<{ lat: number, lng: number } | null> {
        if (!MAPBOX_TOKEN) {
            console.warn("Geen Mapbox token gevonden. Mocking coordinates.");
            // Mock random coordinate nearby for testing without token
            return {
                lat: 52.0 + (Math.random() - 0.5) * 0.5,
                lng: 5.5 + (Math.random() - 0.5) * 0.5
            };
        }

        try {
            const query = encodeURIComponent(address);
            const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${query}.json?country=nl&limit=1&access_token=${MAPBOX_TOKEN}`;

            const res = await fetch(url);
            const data = await res.json();

            if (data.features && data.features.length > 0) {
                const [lng, lat] = data.features[0].center;
                return { lat, lng };
            }
            return null;
        } catch (error) {
            console.error("Geocoding error:", error);
            return null;
        }
    }

    static async optimizeRoute(startRegion: keyof typeof REGIONS, addresses: Address[]): Promise<{ stops: Address[], distance: number, duration: number }> {
        const startPoint = REGIONS[startRegion];

        // 1. Geocode all addresses if needed
        const geocodedAddresses = await Promise.all(
            addresses.map(async (addr) => {
                if (addr.lat && addr.lng) return addr;
                const coords = await this.geocodeAddress(addr.volledigAdres);
                return { ...addr, ...coords };
            })
        );

        const validAddresses = geocodedAddresses.filter(a => a.lat && a.lng);

        if (validAddresses.length === 0) {
            throw new Error("Geen geldige adressen gevonden om te optimaliseren.");
        }

        if (!MAPBOX_TOKEN) {
            // Return simple sorted list by fake distance if no token
            return {
                stops: [
                    { ...validAddresses[0], filiaalnr: 'START', straat: startPoint.address, volledigAdres: startPoint.address, formule: 'START', merchandiser: 'SYSTEM', lat: startPoint.lat, lng: startPoint.lng },
                    ...validAddresses
                ],
                distance: 0,
                duration: 0
            };
        }

        // 2. Prepare coordinates for Mapbox Optimization API
        // Format: longitude,latitude;longitude,latitude...
        // Start point first
        const coordinates = [
            `${startPoint.lng},${startPoint.lat}`,
            ...validAddresses.map(a => `${a.lng},${a.lat}`)
        ].join(';');

        // 3. Call Optimization API
        const url = `https://api.mapbox.com/optimized-trips/v1/mapbox/driving/${coordinates}?overview=full&steps=true&source=first&access_token=${MAPBOX_TOKEN}`;

        const res = await fetch(url);
        const data = await res.json();

        if (data.code !== 'Ok') {
            throw new Error(`Optimization failed: ${data.code}`);
        }

        // 4. Map result back to addresses based on waypoint indices
        const trip = data.trips[0];
        const optimizedOrder: Address[] = [];

        trip.waypoint_indices.forEach((originalIndex: number, i: number) => {
            if (originalIndex === 0) {
                // This is the start point
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
                // originalIndex maps to the input array (which was startPoint + validAddresses)
                // Since input array [0] was startPoint, validAddresses are at index - 1
                const address = validAddresses[originalIndex - 1];
                if (address) optimizedOrder.push(address);
            }
        });

        return {
            stops: optimizedOrder,
            distance: trip.distance, // in meters
            duration: trip.duration  // in seconds
        };
    }
}
