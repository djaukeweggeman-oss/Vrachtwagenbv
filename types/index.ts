export interface Address {
    filiaalnr: string;
    formule: string;
    straat: string;
    postcode: string;
    plaats: string;
    volledigAdres: string;
    merchandiser: string;
    lat?: number;
    lng?: number;
    aantalPlaatsingen?: number;
}

export interface RouteResponse {
    stops: Address[];
    totalDistance?: number;
    totalDuration?: number;
    geometry?: string; // Encoded polyline
}

export interface ExcelRow {
    TERRNR?: string | number;
    Merchandiser?: string;
    Bezoekdag?: string;
    Box?: string | number;
    FILIAALNR?: string | number;
    FORMULE?: string;
    ADRES?: string;
    POSTCODE?: string;
    PLAATSNAAM?: string;
    Opmerkingen?: string;
    [key: string]: any;
}
