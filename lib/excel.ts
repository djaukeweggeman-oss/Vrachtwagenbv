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

        // Read all rows as arrays so we can locate the real header row by keywords
        const allRows = XLSX.utils.sheet_to_json<any>(worksheet, { header: 1, defval: "" }) as any[][];
        console.log(`\n📊 Read ${allRows.length} total rows with header:1 mode`);

        // Determine header row by looking for familiar column names
        let headerRowIdx = -1;
        const headerKeywords = ['TERRNR', 'MERCHANDISER', 'ADRES', 'POSTCODE', 'PLAATSNAAM'];

        for (let i = 0; i < allRows.length; i++) {
            const row = allRows[i] as any[];
            if (!row || row.length === 0) continue;
            const upper = row.map(c => String(c).toUpperCase().trim());
            // count matches of keywords as substrings
            let matches = 0;
            for (const kw of headerKeywords) {
                if (upper.some(cell => cell.includes(kw))) {
                    matches++;
                }
            }
            console.log(`Row ${i}: [${upper.slice(0,10).join(' | ')}] (${matches} keyword matches)`);

            if (matches >= 2) {
                headerRowIdx = i;
                console.log(`✅ Header row detected at index ${i}`);
                break;
            }
        }

        if (headerRowIdx === -1) {
            // if still not found, fallback to 8
            headerRowIdx = 8;
            console.warn(`⚠️ Could not auto-detect header row, defaulting to index ${headerRowIdx}`);
        }

        // Now parse data properly with the found header row
        const headerRow = allRows[headerRowIdx];
        console.log(`\n📋 Header row: [${headerRow.join(" | ")}]`);

        // Helper that parses rows starting from a given header index and returns parsed addresses/drivers
        const parseWithHeader = (hdrIdx: number) => {
            const resultAddrs: Address[] = [];
            const resultDrivers = new Set<string>();

            const hdrRow = allRows[hdrIdx] as any[] || [];

            const adresIdx = hdrRow.findIndex((h: any) => String(h).toUpperCase().includes('ADRES'));
            const mercIdx = hdrRow.findIndex((h: any) => String(h).toUpperCase().includes('MERCHAND'));
            const plaatsnaamIdx = hdrRow.findIndex((h: any) => String(h).toUpperCase().includes('PLAATS'));
            const postcodeIdx = hdrRow.findIndex((h: any) => String(h).toUpperCase().includes('POSTCODE'));
            const filiaalnrIdx = hdrRow.findIndex((h: any) => String(h).toUpperCase().includes('FILIAALNR'));
            const formuleIdx = hdrRow.findIndex((h: any) => String(h).toUpperCase().includes('FORMULE'));
            const bezoekdagIdx = hdrRow.findIndex((h: any) => String(h).toUpperCase().includes('BEZOEKDAG'));
            const gripperboxIdx = hdrRow.findIndex((h: any) => String(h).toUpperCase().includes('GRIPPERBOX'));

            for (let i = hdrIdx + 1; i < allRows.length; i++) {
                const row = allRows[i];
                if (!row || row.length === 0) continue;

                if (adresIdx === -1 || mercIdx === -1) {
                    continue;
                }

                const adres = row[adresIdx] ? String(row[adresIdx]).trim() : '';
                const merchandiser = row[mercIdx] ? String(row[mercIdx]).trim() : '';
                if (!adres || !merchandiser) continue;

                resultDrivers.add(merchandiser);

                const plaats = plaatsnaamIdx >= 0 && row[plaatsnaamIdx] ? String(row[plaatsnaamIdx]).trim() : '';
                const postcode = postcodeIdx >= 0 && row[postcodeIdx] ? String(row[postcodeIdx]).trim() : '';
                const filiaalnr = filiaalnrIdx >= 0 && row[filiaalnrIdx] ? String(row[filiaalnrIdx]) : '';
                const formule = formuleIdx >= 0 && row[formuleIdx] ? String(row[formuleIdx]) : '';
                const bezoekdag = bezoekdagIdx >= 0 && row[bezoekdagIdx] ? excelDateToDayName(row[bezoekdagIdx]) : undefined;
                const volledigAdres = `${adres}, ${plaats}, Nederland`;

                let aantalPlaatsingen = 0;
                if (gripperboxIdx >= 0) {
                    for (let j = gripperboxIdx + 1; j < row.length; j++) {
                        const val = row[j];
                        if (val !== null && val !== undefined && String(val).trim().toUpperCase() === 'JA') {
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

        // parse using detected header
        let { addresses, drivers } = parseWithHeader(headerRowIdx);
        console.log(`✅ Parsed ${addresses.length} addresses using header index ${headerRowIdx}`);

        // if we got nothing, try alternate header rows nearby
        if (addresses.length === 0) {
            console.warn(`⚠️ No addresses parsed with header ${headerRowIdx}, trying nearby rows`);
            for (let tryIdx = 0; tryIdx < Math.min(allRows.length, 20); tryIdx++) {
                if (tryIdx === headerRowIdx) continue;
                const trial = parseWithHeader(tryIdx);
                if (trial.addresses.length > 0) {
                    headerRowIdx = tryIdx;
                    addresses = trial.addresses;
                    drivers = trial.drivers;
                    console.log(`✅ Successfully parsed ${addresses.length} addresses using alternative header ${tryIdx}`);
                    break;
                }
            }
        }

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
            throw new Error(`Geen geldige adressen gevonden in het bestand. Header kolommen gevonden: ${headerRow.slice(0, 15).join(', ')}`);
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
