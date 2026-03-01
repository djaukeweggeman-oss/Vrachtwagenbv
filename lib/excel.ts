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

        // 1. Zoek het blad "PLANNING" (of pak de eerste als fallback)
        let sheetName = workbook.SheetNames.find(name => name.toUpperCase().includes('PLANNING'));
        if (!sheetName) sheetName = workbook.SheetNames[0];

        if (!sheetName) {
            throw new Error("Geen tabblad gevonden in het bestand.");
        }

        console.log("✅ Using sheet:", sheetName);

        const worksheet = workbook.Sheets[sheetName];

        // 2. Zoek automatisch de header-rij door naar ADRES en Merchandiser kolommen te zoeken
        let headerRowIndex = 8; // Default: rij 9 (index 8)
        const maxRowsToCheck = 15;
        let foundHeaderRow = false;
        
        for (let i = 0; i < maxRowsToCheck; i++) {
            const testData = XLSX.utils.sheet_to_json<ExcelRow>(worksheet, { range: i, defval: "" });
            if (testData.length > 0) {
                const firstRow = testData[0];
                const allKeys = Object.keys(firstRow);
                const lowerCaseKeys = allKeys.map(k => k.toUpperCase());
                
                console.log(`🔎 Row ${i}: Keys = [${allKeys.join(', ')}]`);
                
                if (lowerCaseKeys.some(k => k.includes('ADRES')) && lowerCaseKeys.some(k => k.includes('MERCHANDISER'))) {
                    headerRowIndex = i;
                    console.log(`✅ Found headers at row ${i + 1}`);
                    foundHeaderRow = true;
                    break;
                }
            }
        }
        
        if (!foundHeaderRow) {
            console.warn(`⚠️ Could not find headers with ADRES + MERCHANDISER, using default row 9`);
        }

        // 3. Converteer naar JSON met gevonden header-rij
        const jsonData = XLSX.utils.sheet_to_json<ExcelRow>(worksheet, { range: headerRowIndex, defval: "" });

        console.log(`📝 Found ${jsonData.length} rows in Excel`);
        if (jsonData.length > 0) {
            console.log("🔍 First row sample:", JSON.stringify(jsonData[0]));
            console.log("🔑 Available columns:", Object.keys(jsonData[0]));
        } else {
            console.error("❌ No rows found after header row!");
        }

        // Helper function: case-insensitive column lookup
        const getColumnValue = (row: any, columnName: string): string | undefined => {
            const key = Object.keys(row).find(k => k.toUpperCase() === columnName.toUpperCase());
            const value = key ? String(row[key]).trim() : undefined;
            return value;
        };

        const addresses: Address[] = [];
        const uniqueDrivers = new Set<string>();

        jsonData.forEach((row, index) => {
            // Zoek case-insensitive naar ADRES en Merchandiser
            const adres = getColumnValue(row, 'ADRES');
            const merchandiser = getColumnValue(row, 'Merchandiser');

            // We hebben minimaal een adres en merchandiser nodig
            if (adres && merchandiser) {

                const merchandiserName = merchandiser;
                uniqueDrivers.add(merchandiserName);

                // Schoon de data op
                const straat = adres;
                const postcode = getColumnValue(row, 'POSTCODE') || '';
                const plaats = getColumnValue(row, 'PLAATSNAAM') || '';

                // Maak volledig adres voor geocoding
                const volledigAdres = `${straat}, ${plaats}, Nederland`;

                // Bereken aantalPlaatsingen: alle kolommen rechts van 'GRIPPERBOX' tellen met waarde 'JA' (case-insensitive)
                let aantalPlaatsingen = 0;
                try {
                    const cols = Object.keys(row);
                    const gripperIndex = cols.findIndex(c => c.toUpperCase().trim() === 'GRIPPERBOX');
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
                    console.warn('Fout bij berekenen aantalPlaatsingen voor rij', index + headerRowIndex + 1, e);
                }

                addresses.push({
                    filiaalnr: getColumnValue(row, 'FILIAALNR') || '',
                    formule: getColumnValue(row, 'FORMULE') || '',
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
                    console.log(`⚠️ Skipping row ${index + headerRowIndex + 1}: ADRES=${adres}, Merchandiser=${merchandiser}`);
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
            console.error("📊 Debug info:", {
                totalRows: jsonData.length,
                totalAddresses: addresses.length,
                headerRowIndex: headerRowIndex
            });
            throw new Error(`Geen geldige adressen gevonden in het bestand. Gevonden kolommen: ${jsonData.length > 0 ? Object.keys(jsonData[0]).join(', ') : 'Geen rijen'}`);
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
