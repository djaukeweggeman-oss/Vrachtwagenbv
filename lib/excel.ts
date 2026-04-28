import * as XLSX from 'xlsx';
import { Address } from '@/types';

/**
 * Convert Excel date serial number or Dutch date string to day name
 */
function excelDateToDayName(value: any): string | undefined {
    try {
        const strVal = String(value).trim();
        const days = ['Maandag', 'Dinsdag', 'Woensdag', 'Donderdag', 'Vrijdag', 'Zaterdag', 'Zondag'];

        // Direct match
        if (days.includes(strVal)) return strVal;

        // Handle common Dutch date strings like "maandag 2 maart"
        const lowerVal = strVal.toLowerCase();
        if (lowerVal.includes('maandag')) return 'Maandag';
        if (lowerVal.includes('dinsdag')) return 'Dinsdag';
        if (lowerVal.includes('woensdag')) return 'Woensdag';
        if (lowerVal.includes('donderdag')) return 'Donderdag';
        if (lowerVal.includes('vrijdag')) return 'Vrijdag';
        if (lowerVal.includes('zaterdag')) return 'Zaterdag';
        if (lowerVal.includes('zondag')) return 'Zondag';

        // Try to parse as a number (Excel date serial)
        const numVal = Number(value);
        if (isNaN(numVal)) {
            return strVal || undefined;
        }

        const excelEpoch = new Date(1899, 11, 30);
        const date = new Date(excelEpoch.getTime() + numVal * 86400000);
        const dayName = date.toLocaleDateString('nl-NL', { weekday: 'long' });
        return dayName.charAt(0).toUpperCase() + dayName.slice(1);
    } catch (e) {
        console.warn('Could not convert bezoekdag value:', value, e);
        return String(value).trim() || undefined;
    }
}

export const processExcel = async (buffer: ArrayBuffer): Promise<{ addresses: Address[], drivers: string[], driverBoxMap: Record<string, string> }> => {
    try {
        console.log("📊 Starting SUPER ROBUST Excel processing...");
        const workbook = XLSX.read(buffer, { type: 'buffer' });
        console.log("📋 Available sheets:", workbook.SheetNames);

        let globalBestResult = { addresses: [] as Address[], drivers: [] as string[], driverBoxMap: {} as Record<string, string>, sheetName: "" };

        // Priority for sheet names
        const sortedSheets = [...workbook.SheetNames].sort((a, b) => {
            const aUpper = a.toUpperCase();
            const bUpper = b.toUpperCase();
            const aWeight = aUpper.includes('PLANNING') ? 10 : (aUpper.includes('WEEK') ? 5 : 0);
            const bWeight = bUpper.includes('PLANNING') ? 10 : (bUpper.includes('WEEK') ? 5 : 0);
            return bWeight - aWeight;
        });

        for (const sheetName of sortedSheets) {
            console.log(`🔍 Testing sheet: ${sheetName}`);
            const worksheet = workbook.Sheets[sheetName];
            const allRows = XLSX.utils.sheet_to_json<any>(worksheet, { header: 1, defval: "" }) as any[][];

            if (!allRows || allRows.length === 0) continue;

            // Very lenient cleaner for keyword matching
            const cleanKey = (val: any) => String(val || '').trim().toUpperCase().replace(/[^A-Z]/g, '');

            const parseWithHeader = (hdrIdx: number) => {
                const hdrRow = allRows[hdrIdx] || [];
                const findCol = (keywords: string[]) => {
                    return hdrRow.findIndex(h => {
                        const val = cleanKey(h);
                        return keywords.some(k => val.includes(cleanKey(k)));
                    });
                };

                const adresIdx = findCol(['ADRES', 'STRAAT', 'STREET', 'ADDRESS']);
                const mercIdx = findCol(['MERCHANDISER', 'MERCHANSIDER', 'MERCHAND', 'MERCHAN', 'CHAUFFEUR', 'DRIVER', 'CHAUF']);

                if (adresIdx === -1 || mercIdx === -1) return null;

                const resultAddrs: Address[] = [];
                const resultDrivers = new Set<string>();

                const plaatsnaamIdx = findCol(['PLAATS', 'CITY', 'TOWN', 'LOCATION']);
                const postcodeIdx = findCol(['POSTCODE', 'ZIP']);
                const filiaalnrIdx = findCol(['FILIAAL', 'SHOP', 'STORE', 'WINKEL']);
                const formuleIdx = findCol(['FORMULE', 'BRAND', 'KRT']);
                const bezoekdagIdx = findCol(['BEZOEK', 'DAG', 'DAY']);
                const boxIdx = findCol(['BOX', 'DEPOT', 'OPSLAGBOX']);

                // Product columns (Ja/Nee for each brand) come AFTER 'Te verwijderen'
                // 'Te verwijderen' is the last standard header (col 11 in actual file)
                // Look for 'VERWIJDER' specifically; if not found, fall back to GOEDGEKEURD+2
                const teVerwijderenIdx = findCol(['VERWIJDER']);
                const goedgekeurdIdx2 = findCol(['GOEDGEKEURD']);
                // productStartIdx: column index of the first product placement column
                let productStartIdx: number;
                if (teVerwijderenIdx >= 0) {
                    productStartIdx = teVerwijderenIdx + 1;
                } else if (goedgekeurdIdx2 >= 0) {
                    productStartIdx = goedgekeurdIdx2 + 2; // skip 'Te verwijderen' too
                } else {
                    // Last resort: start 4 cols after the last known standard column
                    productStartIdx = Math.max(adresIdx, mercIdx, plaatsnaamIdx, postcodeIdx) + 4;
                }

                for (let i = hdrIdx + 1; i < allRows.length; i++) {
                    const row = allRows[i] || [];
                    if (row.length === 0) continue;

                    const adres = String(row[adresIdx] || '').trim();
                    const merchandiser = String(row[mercIdx] || '').trim();

                    // Skip empty mandatory fields or header repetitions
                    if (!adres || !merchandiser) continue;
                    // Skip rows where the address cell is literally a column header (not real addresses containing 'straat')
                    const cleanedAdres = cleanKey(adres);
                    if (cleanedAdres === 'ADRES' || cleanedAdres === 'STRAAT' || cleanedAdres === 'STREET' || cleanedAdres === 'ADDRESS') continue;

                    resultDrivers.add(merchandiser);

                    const plaats = plaatsnaamIdx >= 0 ? String(row[plaatsnaamIdx] || '').trim() : '';
                    const postcode = postcodeIdx >= 0 ? String(row[postcodeIdx] || '').trim() : '';
                    const filiaalnr = filiaalnrIdx >= 0 ? String(row[filiaalnrIdx] || '').trim() : '';
                    const formule = formuleIdx >= 0 ? String(row[formuleIdx] || '').trim() : '';
                    const bezoekdag = bezoekdagIdx >= 0 ? excelDateToDayName(row[bezoekdagIdx]) : undefined;
                    const box = boxIdx >= 0 ? String(row[boxIdx] || '').trim() : undefined;
                    // Include postcode so geocoding works even when plaatsnaam is empty
                    const volledigAdres = [adres, postcode, plaats, 'Nederland'].filter(Boolean).join(', ');

                    // Count 'Ja' values in the product placement columns only
                    let aantalPlaatsingen = 0;
                    for (let j = productStartIdx; j < row.length; j++) {
                        const val = String(row[j] || '').trim().toUpperCase();
                        if (val === 'JA') aantalPlaatsingen++;
                    }

                    resultAddrs.push({
                        filiaalnr, formule, straat: adres, postcode, plaats,
                        merchandiser, volledigAdres, aantalPlaatsingen, bezoekdag, box,
                    });
                }
                // Build driver → box mapping (use the most common box per driver)
                const driverBoxCount: Record<string, Record<string, number>> = {};
                for (const addr of resultAddrs) {
                    if (addr.box && addr.merchandiser) {
                        if (!driverBoxCount[addr.merchandiser]) driverBoxCount[addr.merchandiser] = {};
                        driverBoxCount[addr.merchandiser][addr.box] = (driverBoxCount[addr.merchandiser][addr.box] || 0) + 1;
                    }
                }
                const driverBoxMap: Record<string, string> = {};
                for (const [driver, boxes] of Object.entries(driverBoxCount)) {
                    // Pick the most frequent box for each driver
                    let maxCount = 0;
                    let bestBox = '';
                    for (const [box, count] of Object.entries(boxes)) {
                        if (count > maxCount) { maxCount = count; bestBox = box; }
                    }
                    if (bestBox) driverBoxMap[driver] = bestBox;
                }
                return { addresses: resultAddrs, drivers: Array.from(resultDrivers).sort(), driverBoxMap };
            };

            // Scan first 50 rows for the best possible header in this sheet
            let sheetBest = { addresses: [] as Address[], drivers: [] as string[], driverBoxMap: {} as Record<string, string> };
            for (let r = 0; r < Math.min(allRows.length, 50); r++) {
                const res = parseWithHeader(r);
                if (res && res.addresses.length > sheetBest.addresses.length) {
                    sheetBest = res;
                    // Optimization: if we found a good amount of data, assume we found the right header
                    if (res.addresses.length > 50) break;
                }
            }

            if (sheetBest.addresses.length > globalBestResult.addresses.length) {
                globalBestResult = { ...sheetBest, driverBoxMap: sheetBest.driverBoxMap || {}, sheetName };
                // Optimization: if we found a lot of data, we are likely done
                if (sheetBest.addresses.length > 100) break;
            }
        }

        if (globalBestResult.addresses.length === 0) {
            console.error("❌ FAILED TO FIND ANY DATA ACROSS ALL SHEETS");
            throw new Error("Kon geen geldige gegevens vinden. Zorg dat de kolommen 'Adres' en 'Merchandiser' (of 'Chauffeur') aanwezig zijn.");
        }

        console.log(`✅ Success! Found ${globalBestResult.addresses.length} addresses in sheet "${globalBestResult.sheetName}"`);

        const { addresses, drivers, driverBoxMap } = globalBestResult;
        const hasDayInfo = addresses.some(a => !!a.bezoekdag);
        let uniqueAddresses: Address[];

        if (hasDayInfo) {
            const grouped = new Map<string, Address>();
            for (const addr of addresses) {
                // Key includes filiaalnr, address, merchandiser and day to be safe
                // We use a combination that is unlikely to collide for different stops
                const key = `${addr.filiaalnr || ''}|${addr.volledigAdres}|${addr.merchandiser}|${addr.bezoekdag}`;
                if (grouped.has(key)) {
                    const existing = grouped.get(key)!;
                    existing.aantalPlaatsingen = (existing.aantalPlaatsingen || 0) + (addr.aantalPlaatsingen || 0);
                } else {
                    grouped.set(key, { ...addr });
                }
            }
            uniqueAddresses = Array.from(grouped.values());
        } else {
            const grouped = new Map<string, Address>();
            for (const addr of addresses) {
                const key = `${addr.filiaalnr || ''}|${addr.volledigAdres}|${addr.merchandiser}`;
                if (grouped.has(key)) {
                    const existing = grouped.get(key)!;
                    existing.aantalPlaatsingen = (existing.aantalPlaatsingen || 0) + (addr.aantalPlaatsingen || 0);
                } else {
                    grouped.set(key, { ...addr });
                }
            }
            uniqueAddresses = Array.from(grouped.values());
        }

        return { addresses: uniqueAddresses, drivers, driverBoxMap };

    } catch (error) {
        console.error("💥 Excel processing error:", error);
        throw error;
    }
};
