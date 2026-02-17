import * as XLSX from 'xlsx';
import { Address, ExcelRow } from '@/types';

/**
 * Convert Excel date serial number to Dutch day name (Maandag, Dinsdag, etc.)
 * Excel dates start from 1-1-1900, Unix epoch is 1-1-1970
 */
function excelDateToDayName(value: any): string | undefined {
    try {
        // If already a string that looks like a day name, return it
        const strVal = String(value).trim();
        if (['Maandag', 'Dinsdag', 'Woensdag', 'Donderdag', 'Vrijdag', 'Zaterdag', 'Zondag'].includes(strVal)) {
            return strVal;
        }

        // Try to parse as a number (Excel date serial)
        const numVal = Number(value);
        if (isNaN(numVal)) {
            return strVal || undefined; // Return original string if not a number
        }

        // Convert Excel serial number to JavaScript Date
        // Excel's epoch is 1-1-1900, but it has a leap year bug, so we use 25569 as offset to Unix epoch
        const excelEpoch = new Date(1899, 11, 30); // Excel's epoch (accounting for 1900 leap year bug)
        const date = new Date(excelEpoch.getTime() + numVal * 86400000);

        // Get Dutch day name (Maandag, Dinsdag, etc.)
        const dayName = date.toLocaleDateString('nl-NL', { weekday: 'long' });
        
        // Capitalize first letter (just in case)
        return dayName.charAt(0).toUpperCase() + dayName.slice(1);
    } catch (e) {
        console.warn('Could not convert bezoekdag value:', value, e);
        return String(value).trim() || undefined;
    }
}

export const processExcel = async (buffer: ArrayBuffer): Promise<{ addresses: Address[], drivers: string[] }> => {
    try {
        console.log("📊 Starting Excel processing...");
        const workbook = XLSX.read(buffer, { type: 'buffer' });

        console.log("📋 Available sheets:", workbook.SheetNames);

        // 1. Zoek het blad "PLANNING WEEK 08" (of pak de eerste als fallback)
        let sheetName = workbook.SheetNames.find(name => name.toUpperCase().includes('PLANNING'));
        if (!sheetName) sheetName = workbook.SheetNames[0];

        if (!sheetName) {
            throw new Error("Geen tabblad gevonden in het bestand.");
        }

        console.log("✅ Using sheet:", sheetName);

        const worksheet = workbook.Sheets[sheetName];

        // 2. Converteer naar JSON, startend vanaf rij 9 (header row)
        // range: 8 betekent start bij index 8 (dus rij 9 in Excel)
        const jsonData = XLSX.utils.sheet_to_json<ExcelRow>(worksheet, { range: 8, defval: "" });

        console.log(`📝 Found ${jsonData.length} rows in Excel`);
        if (jsonData.length > 0) {
            console.log("🔍 First row sample:", JSON.stringify(jsonData[0]));
            console.log("🔑 Available columns:", Object.keys(jsonData[0]));
        }

        const addresses: Address[] = [];
        const uniqueDrivers = new Set<string>();

        jsonData.forEach((row, index) => {
            // We hebben minimaal een adres en merchandiser nodig
            if (row.ADRES && row.Merchandiser) {

                const merchandiserName = String(row.Merchandiser).trim();
                uniqueDrivers.add(merchandiserName);

                // Schoon de data op
                const straat = String(row.ADRES).trim();
                const postcode = row.POSTCODE ? String(row.POSTCODE).trim() : '';
                const plaats = row.PLAATSNAAM ? String(row.PLAATSNAAM).trim() : '';

                // Maak volledig adres voor geocoding
                const volledigAdres = `${straat}, ${plaats}, Nederland`;

                // Bereken aantalPlaatsingen: alle kolommen rechts van 'GRIPPERBOX' tellen met waarde 'JA' (case-insensitive)
                let aantalPlaatsingen = 0;
                try {
                    const cols = Object.keys(row);
                    const gripperIndex = cols.findIndex(c => String(c).trim().toUpperCase() === 'GRIPPERBOX');
                    if (gripperIndex >= 0) {
                        for (let i = gripperIndex + 1; i < cols.length; i++) {
                            const val = row[cols[i]];
                            if (val !== null && val !== undefined) {
                                const s = String(val).trim().toUpperCase();
                                if (s === 'JA') aantalPlaatsingen++;
                            }
                        }
                    }
                } catch (e) {
                    console.warn('Fout bij berekenen aantalPlaatsingen voor rij', index + 9, e);
                }

                addresses.push({
                    filiaalnr: row.FILIAALNR ? String(row.FILIAALNR) : '',
                    formule: row.FORMULE ? String(row.FORMULE) : '',
                    straat,
                    postcode,
                    plaats,
                    merchandiser: merchandiserName,
                    volledigAdres,
                    aantalPlaatsingen,
                    bezoekdag: excelDateToDayName(row.Bezoekdag),
                });
            } else {
                if (index < 5) { // Only log first 5 skipped rows to avoid spam
                    console.log(`⚠️ Skipping row ${index + 9}: ADRES=${row.ADRES}, Merchandiser=${row.Merchandiser}`);
                }
            }
        });

        console.log(`✅ Extracted ${addresses.length} addresses`);
        console.log(`👥 Found ${uniqueDrivers.size} unique drivers:`, Array.from(uniqueDrivers));

        // Check if we have day information for multi-day optimization
        const hasDayInfo = addresses.some(a => !!a.bezoekdag);
        
        // Deduplicatie op basis van volledigAdres EN Merchandiser (EN optionally Bezoekdag)
        let uniqueAddresses: Address[];
        if (hasDayInfo) {
            // If we have day info, deduplicate including day (keep same address on different days separate)
            // But also sum up plaatsingen for duplicate addresses on the same day
            const grouped = new Map<string, Address>();
            
            for (const addr of addresses) {
                // Key: "adres|merchandiser|dag" to group duplicates on the same day
                const key = `${addr.volledigAdres}|${addr.merchandiser}|${addr.bezoekdag}`;
                
                if (grouped.has(key)) {
                    // Already have this address on this day, sum up plaatsingen
                    const existing = grouped.get(key)!;
                    existing.aantalPlaatsingen = (existing.aantalPlaatsingen || 0) + (addr.aantalPlaatsingen || 0);
                } else {
                    grouped.set(key, { ...addr });
                }
            }
            
            uniqueAddresses = Array.from(grouped.values());
            console.log(`🗓️ Day-aware deduplication: ${addresses.length} → ${uniqueAddresses.length} entries (summed plaatsingen)`);
        } else {
            // Original deduplication for single-day data
            uniqueAddresses = addresses.filter((addr, index, self) =>
                index === self.findIndex((t) => (
                    t.volledigAdres === addr.volledigAdres && t.merchandiser === addr.merchandiser
                ))
            );
            console.log(`🎯 After deduplication: ${uniqueAddresses.length} unique addresses`);
        }

        if (uniqueAddresses.length === 0) {
            console.error("❌ No valid addresses found!");
            throw new Error("Geen geldige adressen gevonden in het bestand.");
        }

        return {
            addresses: uniqueAddresses,
            drivers: Array.from(uniqueDrivers).sort()
        };

    } catch (error) {
        console.error("💥 Excel processing error:", error);
        throw error;
    }
};
