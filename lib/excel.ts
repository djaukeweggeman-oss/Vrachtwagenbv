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

        // Debug: print first 10 rows as-is
        console.log("🔍 == RAW WORKSHEET DATA ==");
        if (worksheet['!ref']) {
            const range = XLSX.utils.decode_range(worksheet['!ref']);
            console.log(`Worksheet range: ${worksheet['!ref']} (rows 0-${range.e.r})`);

            // Print first 15 rows, first 5 columns
            for (let row = 0; row < Math.min(15, range.e.r + 1); row++) {
                const rowData = [];
                for (let col = 0; col < Math.min(5, range.e.c + 1); col++) {
                    const cellRef = XLSX.utils.encode_cell({ r: row, c: col });
                    const cell = worksheet[cellRef];
                    rowData.push(cell ? cell.v : "");
                }
                console.log(`Row ${row}: [${rowData.join(" | ")}]`);
            }
        }

        // Try to find data with a simple approach:
        // Look for first row with both an address-like value and a person's name
        let headerRowIdx = -1;
        const allRows = XLSX.utils.sheet_to_json<any>(worksheet, { header: 1 }) as any[][];
        
        console.log(`\n📊 Found ${allRows.length} total rows using header:1 mode`);
        
        // Find row with ADRES and MERCHANDISER column names
        for (let i = 0; i < Math.min(15, allRows.length); i++) {
            const row = allRows[i];
            if (row && Array.isArray(row)) {
                const rowStr = row.slice(0, 10).join(" | ");
                console.log(`Row ${i}: [${rowStr}]`);
                
                // Check if this row contains typical header values
                const rowAsString = row.join(" ").toUpperCase();
                if (rowAsString.includes('ADRES') && rowAsString.includes('MERCHAND')) {
                    headerRowIdx = i;
                    console.log(`✅ Found header row at index ${i}`);
                    break;
                }
            }
        }

        if (headerRowIdx === -1) {
            // Fallback: use row 8 (Excel row 9)
            headerRowIdx = 8;
            console.log(`⚠️ Using default header row index: ${headerRowIdx}`);
        }

        // Now parse data properly with the found header row
        const headerRow = allRows[headerRowIdx];
        console.log(`\n📋 Header row: [${headerRow.join(" | ")}]`);

        const addresses: Address[] = [];
        const uniqueDrivers = new Set<string>();

        // Process all following rows
        for (let i = headerRowIdx + 1; i < allRows.length; i++) {
            const row = allRows[i];
            if (!row || row.length === 0) continue;

            // Find indices of required columns (case-insensitive)
            const adresIdx = headerRow.findIndex((h: any) => String(h).toUpperCase().includes('ADRES'));
            const mercIdx = headerRow.findIndex((h: any) => String(h).toUpperCase().includes('MERCHAND'));
            const plaatsnaamIdx = headerRow.findIndex((h: any) => String(h).toUpperCase().includes('PLAATS'));
            const postcodeIdx = headerRow.findIndex((h: any) => String(h).toUpperCase().includes('POSTCODE'));
            const filiaalnrIdx = headerRow.findIndex((h: any) => String(h).toUpperCase().includes('FILIAALNR'));
            const formuleIdx = headerRow.findIndex((h: any) => String(h).toUpperCase().includes('FORMULE'));
            const bezoekdagIdx = headerRow.findIndex((h: any) => String(h).toUpperCase().includes('BEZOEKDAG'));
            const gripperboxIdx = headerRow.findIndex((h: any) => String(h).toUpperCase().includes('GRIPPERBOX'));

            if (adresIdx === -1 || mercIdx === -1) {
                if (i === headerRowIdx + 1) {
                    console.warn(`⚠️ Could not find ADRES (${adresIdx}) or MERCHANDISER (${mercIdx}) columns`);
                }
                continue;
            }

            const adres = row[adresIdx] ? String(row[adresIdx]).trim() : '';
            const merchandiser = row[mercIdx] ? String(row[mercIdx]).trim() : '';

            if (!adres || !merchandiser) {
                if (i === headerRowIdx + 1) {
                    console.log(`⚠️ Skipping row ${i}, adres="${adres}", merchandiser="${merchandiser}"`);
                }
                continue;
            }

            if (i === headerRowIdx + 1) {
                console.log(`✅ Successfully parsing! Example row ${i}:`, { adres, merchandiser });
            }

            uniqueDrivers.add(merchandiser);

            const plaats = plaatsnaamIdx >= 0 && row[plaatsnaamIdx] ? String(row[plaatsnaamIdx]).trim() : '';
            const postcode = postcodeIdx >= 0 && row[postcodeIdx] ? String(row[postcodeIdx]).trim() : '';
            const filiaalnr = filiaalnrIdx >= 0 && row[filiaalnrIdx] ? String(row[filiaalnrIdx]) : '';
            const formule = formuleIdx >= 0 && row[formuleIdx] ? String(row[formuleIdx]) : '';
            const bezoekdag = bezoekdagIdx >= 0 && row[bezoekdagIdx] ? excelDateToDayName(row[bezoekdagIdx]) : undefined;

            const volledigAdres = `${adres}, ${plaats}, Nederland`;

            // Count JA values after GRIPPERBOX
            let aantalPlaatsingen = 0;
            if (gripperboxIdx >= 0) {
                for (let j = gripperboxIdx + 1; j < row.length; j++) {
                    const val = row[j];
                    if (val !== null && val !== undefined && String(val).trim().toUpperCase() === 'JA') {
                        aantalPlaatsingen++;
                    }
                }
            }

            addresses.push({
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

        console.log(`✅ Extracted ${addresses.length} addresses from ${allRows.length - headerRowIdx - 1} data rows`);
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
                totalRows: allRows.length,
                totalAddresses: addresses.length,
                headerRowIndex: headerRowIdx
            });
            throw new Error(`Geen geldige adressen gevonden in het bestand. Header kolommen gevonden: ${headerRow.slice(0, 15).join(', ')}`);
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
