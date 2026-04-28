export interface Depot {
    name: string;
    address: string;
    postcode: string;
    stad: string;
    lat: number;
    lng: number;
}

export const REGIONS: Record<string, Depot> = {
    '1Box Best': {
        name: '1Box Best',
        address: 'Industrieweg 220',
        postcode: '5683 CH',
        stad: 'Best',
        lat: 51.5095,
        lng: 5.3990,
    },
    '1Box Breda': {
        name: '1Box Breda',
        address: 'Koele Mei 52',
        postcode: '4816 JD',
        stad: 'Breda',
        lat: 51.5730,
        lng: 4.7890,
    },
    '1Box Schiedam': {
        name: '1Box Schiedam',
        address: 'Philippusweg 2-8',
        postcode: '3125 AS',
        stad: 'Schiedam',
        lat: 51.9280,
        lng: 4.3780,
    },
    '1Box Sittard': {
        name: '1Box Sittard',
        address: 'Nusterweg 65',
        postcode: '6136 KT',
        stad: 'Sittard',
        lat: 51.0070,
        lng: 5.8520,
    },
    'Eurobox Hoofddorp': {
        name: 'Eurobox Hoofddorp',
        address: 'Parellaan 2',
        postcode: '2132 WS',
        stad: 'Hoofddorp',
        lat: 52.3024,
        lng: 4.6889,
    },
    'Smollan Sneek': {
        name: 'Smollan Sneek',
        address: 'Wagenmakersstraat 1',
        postcode: '8601 VA',
        stad: 'Sneek',
        lat: 53.0324,
        lng: 5.6550,
    },
    'Shurgard Apeldoorn': {
        name: 'Shurgard Apeldoorn',
        address: 'Nagelpoelweg 3',
        postcode: '7333 NZ',
        stad: 'Apeldoorn',
        lat: 52.2040,
        lng: 5.9530,
    },
    'Shurgard Arnhem': {
        name: 'Shurgard Arnhem',
        address: 'Dr. C. Lelyweg 2',
        postcode: '6827 BH',
        stad: 'Arnhem',
        lat: 51.9640,
        lng: 5.9270,
    },
    'Shurgard Groningen': {
        name: 'Shurgard Groningen',
        address: 'Peizerweg 130',
        postcode: '9727 AN',
        stad: 'Groningen',
        lat: 53.2280,
        lng: 6.5370,
    },
    'Shurgard Utrecht': {
        name: 'Shurgard Utrecht',
        address: 'Franciscusdreef 68-70',
        postcode: '3565 AC',
        stad: 'Utrecht',
        lat: 52.1100,
        lng: 5.1200,
    },
};

/**
 * Look up a region key by box name from the Excel file (fuzzy matching).
 * Returns the key if found, or 'Shurgard Arnhem' as fallback.
 */
export function findRegionKey(boxName: string): keyof typeof REGIONS {
    if (!boxName) return 'Shurgard Arnhem';

    const normalized = boxName.trim().toLowerCase();

    // Exact match (case-insensitive)
    for (const key of Object.keys(REGIONS)) {
        if (key.toLowerCase() === normalized) return key as keyof typeof REGIONS;
    }

    // Partial match: box name contains depot key or vice versa
    for (const key of Object.keys(REGIONS)) {
        const keyLower = key.toLowerCase();
        if (normalized.includes(keyLower) || keyLower.includes(normalized)) return key as keyof typeof REGIONS;
    }

    // Try matching just the city name
    for (const [key, region] of Object.entries(REGIONS)) {
        if (normalized.includes(region.stad.toLowerCase())) return key as keyof typeof REGIONS;
    }

    console.warn(`⚠️ Onbekende box "${boxName}", fallback naar Shurgard Arnhem`);
    return 'Shurgard Arnhem';
}

