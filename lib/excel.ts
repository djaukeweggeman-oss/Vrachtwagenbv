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

        let sheetName = workbook.SheetNames.find(name => name.toUpperCase().includes('PLANNING'));
        if (!sheetName) sheetName = workbook.SheetNames[0];

        if (!sheetName) {
            throw new Error("Geen tabblad gevonden in het bestand.");
        }

        console.log("✅ Using sheet:", sheetName);
        const worksheet = workbook.Sheets[sheetName];

        // Read all rows as arrays
        const allRows = XLSX.utils.sheet_to_json<any>(worksheet, { header: 1, defval: "" }) as any[][];
        console.log(`[DEBUG] Total rows read with header:1 mode: ${allRows.length}`);

        // Helper that parses rows starting from a given header index and returns parsed addresses/drivers
        const parseWithHeader = (hdrIdx: number) => {
            const resultAddrs: Address[] = [];
            const resultDrivers = new Set<string>();

            const hdrRow = allRows[hdrIdx] as any[] || [];
            if (hdrIdx < 10 || hdrIdx % 5 === 0) {
                console.log(`📌 Checking Row ${hdrIdx}: [${hdrRow.slice(0, 15).map(v => String(v).substring(0, 20)).join(' | ')}]`);
            }

            const clean = (val: any) => String(val || '').trim().toUpperCase();

            // Find column indices with more robust matching
            const findCol = (keywords: string[]) => {
                return hdrRow.findIndex(h => {
                    const val = clean(h);
                    return keywords.some(k => val.includes(k.toUpperCase()));
                });
            };

            const adresIdx = findCol(['ADRES', 'STRAAT', 'STREET']);
            const mercIdx = findCol(['MERCHAND', 'CHAUFFEUR', 'DRIVER']);
            const plaatsnaamIdx = findCol(['PLAATS', 'CITY', 'TOWN']);
            const postcodeIdx = findCol(['POSTCODE', 'ZIP']);
            const filiaalnrIdx = findCol(['FILIAAL', 'SHOP', 'STORE', 'ID']);
            const formuleIdx = findCol(['FORMULE', 'BRAND', 'KRT']);
            const bezoekdagIdx = findCol(['BEZOEK', 'DAG', 'DAY']);
            const gripperboxIdx = findCol(['GRIPPER', 'BOX']);

            if (adresIdx === -1 || mercIdx === -1) {
                return { addresses: [], drivers: [] as string[] };
            }

            for (let i = hdrIdx + 1; i < allRows.length; i++) {
                const row = allRows[i] as any[];
                if (!row || row.length === 0) continue;

                const adres = row[adresIdx] ? String(row[adresIdx]).trim() : '';
                const merchandiser = row[mercIdx] ? String(row[mercIdx]).trim() : '';

                // Skip if address is empty or is the header name again
                if (!adres || clean(adres).includes('ADRES')) continue;
                if (!merchandiser) continue;

                resultDrivers.add(merchandiser);

                const plaats = plaatsnaamIdx >= 0 && row[plaatsnaamIdx] ? String(row[plaatsnaamIdx]).trim() : '';
                const postcode = postcodeIdx >= 0 && row[postcodeIdx] ? String(row[postcodeIdx]).trim() : '';
                const filiaalnr = filiaalnrIdx >= 0 && row[filiaalnrIdx] ? String(row[filiaalnrIdx]).trim() : '';
                const formule = formuleIdx >= 0 && row[formuleIdx] ? String(row[formuleIdx]).trim() : '';
                const bezoekdag = bezoekdagIdx >= 0 && row[bezoekdagIdx] ? excelDateToDayName(row[bezoekdagIdx]) : undefined;
                const volledigAdres = `${adres}, ${plaats}, Nederland`.replace(/, ,/g, ',');

                let aantalPlaatsingen = 0;
                if (gripperboxIdx >= 0) {
                    for (let j = gripperboxIdx + 1; j < row.length; j++) {
                        const val = row[j];
                        if (val !== null && val !== undefined && clean(val) === 'JA') {
                            aantalPlaatsingen++;
                        }
                    }
                }

                resultAddrs.push({
                    filiaalnr,
                    formule,
                    straat: adres,
                    postcode,
                    plaats,
                    merchandiser,
                    volledigAdres,
                    aantalPlaatsingen,
                    bezoekdag,
                });
            }

            return { addresses: resultAddrs, drivers: Array.from(resultDrivers).sort() };
        };

        // Header search loop - increase depth to 40 rows
        let bestHeaderIdx = -1;
        let bestResult = { addresses: [] as Address[], drivers: [] as string[] };

        console.log(`🔍 Searching for header in first 40 rows...`);
        for (let tryIdx = 0; tryIdx < Math.min(allRows.length, 40); tryIdx++) {
            const result = parseWithHeader(tryIdx);
            if (result.addresses.length > bestResult.addresses.length) {
                bestResult = result;
                bestHeaderIdx = tryIdx;
            }

            // If we found a significant number of addresses, we likely found the real header
            if (result.addresses.length >= 3) {
                break;
            }
        }

        if (bestHeaderIdx === -1) {
            console.error("❌ HEADER DETECTION FAILED. Row structure diagnostic:");
            allRows.slice(0, 15).forEach((r, i) => console.log(`Row ${i}:`, JSON.stringify(r ? r.slice(0, 10) : [])));
            throw new Error("Kon geen geldige header-rij vinden in het bestand. Zorg dat de kolommen 'Adres' en 'Merchandiser' aanwezig zijn.");
        }

        console.log(`✅ Best header found at index ${bestHeaderIdx} with ${bestResult.addresses.length} addresses`);

        // Use the best result we found
        let addresses = bestResult.addresses;
        let drivers = bestResult.drivers;
        let headerRowIdx = bestHeaderIdx;

        console.log(`👥 Drivers found:`, drivers);

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
                totalRows: allRows.length,
                totalAddresses: addresses.length,
                headerRowIndex: headerRowIdx
            });
            throw new Error(`Geen geldige adressen gevonden in het bestand.`);
        }

        return {
            addresses: uniqueAddresses,
            drivers: drivers
        };

    } catch (error) {
        console.error("💥 Excel processing error:", error);
        throw error;
    }
};
