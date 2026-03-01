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
        console.log("📊 Starting SUPER ROBUST Excel processing...");
        const workbook = XLSX.read(buffer, { type: 'buffer' });
        console.log("📋 Available sheets:", workbook.SheetNames);

        let globalBestResult = { addresses: [] as Address[], drivers: [] as string[], sheetName: "" };

        // Try all sheets that might contain data
        // Priority: Sheets with "PLANNING", then first sheet, then others
        const sortedSheets = [...workbook.SheetNames].sort((a, b) => {
            const aHasPlan = a.toUpperCase().includes('PLANNING') ? 1 : 0;
            const bHasPlan = b.toUpperCase().includes('PLANNING') ? 1 : 0;
            return bHasPlan - aHasPlan;
        });

        for (const sheetName of sortedSheets) {
            console.log(`🔍 Testing sheet: ${sheetName}`);
            const worksheet = workbook.Sheets[sheetName];
            const allRows = XLSX.utils.sheet_to_json<any>(worksheet, { header: 1, defval: "" }) as any[][];

            if (!allRows || allRows.length === 0) continue;

            const clean = (val: any) => String(val || '').trim().toUpperCase();

            const parseWithHeader = (hdrIdx: number) => {
                const resultAddrs: Address[] = [];
                const resultDrivers = new Set<string>();
                const hdrRow = allRows[hdrIdx] || [];

                const findCol = (keywords: string[]) => {
                    return hdrRow.findIndex(h => {
                        const val = clean(h);
                        return keywords.some(k => val.includes(k.toUpperCase()));
                    });
                };

                const adresIdx = findCol(['ADRES', 'STRAAT', 'STREET', 'ADDRESS']);
                const mercIdx = findCol(['MERCHAND', 'CHAUFFEUR', 'DRIVER', 'CHAUF']);

                if (adresIdx === -1 || mercIdx === -1) return null;

                const plaatsnaamIdx = findCol(['PLAATS', 'CITY', 'TOWN', 'LOCATION']);
                const postcodeIdx = findCol(['POSTCODE', 'ZIP']);
                const filiaalnrIdx = findCol(['FILIAAL', 'SHOP', 'STORE', 'ID']);
                const formuleIdx = findCol(['FORMULE', 'BRAND', 'KRT']);
                const bezoekdagIdx = findCol(['BEZOEK', 'DAG', 'DAY']);
                const gripperboxIdx = findCol(['GRIPPER', 'BOX']);

                for (let i = hdrIdx + 1; i < allRows.length; i++) {
                    const row = allRows[i] || [];
                    if (row.length === 0) continue;

                    const adres = String(row[adresIdx] || '').trim();
                    const merchandiser = String(row[mercIdx] || '').trim();

                    if (!adres || !merchandiser) continue;
                    if (clean(adres) === 'ADRES' || clean(adres).includes('STRAAT')) continue;

                    resultDrivers.add(merchandiser);

                    const plaats = plaatsnaamIdx >= 0 ? String(row[plaatsnaamIdx] || '').trim() : '';
                    const postcode = postcodeIdx >= 0 ? String(row[postcodeIdx] || '').trim() : '';
                    const filiaalnr = filiaalnrIdx >= 0 ? String(row[filiaalnrIdx] || '').trim() : '';
                    const formule = formuleIdx >= 0 ? String(row[formuleIdx] || '').trim() : '';
                    const bezoekdag = bezoekdagIdx >= 0 ? excelDateToDayName(row[bezoekdagIdx]) : undefined;
                    const volledigAdres = `${adres}, ${plaats}, Nederland`.replace(/, ,/g, ',').replace(/^, /, '');

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
                        filiaalnr, formule, straat: adres, postcode, plaats,
                        merchandiser, volledigAdres, aantalPlaatsingen, bezoekdag,
                    });
                }
                return { addresses: resultAddrs, drivers: Array.from(resultDrivers).sort() };
            };

            let sheetBest = { addresses: [] as Address[], drivers: [] as string[] };
            for (let r = 0; r < Math.min(allRows.length, 50); r++) {
                const res = parseWithHeader(r);
                if (res && res.addresses.length > sheetBest.addresses.length) {
                    sheetBest = res;
                    if (res.addresses.length > 20) break;
                }
            }

            if (sheetBest.addresses.length > globalBestResult.addresses.length) {
                globalBestResult = { ...sheetBest, sheetName };
                if (sheetBest.addresses.length > 50) break;
            }
        }

        if (globalBestResult.addresses.length === 0) {
            console.error("❌ ALL SHEETS FAILED.");
            throw new Error("Kon geen geldige gegevens vinden. Zorg dat de kolommen 'Adres' en 'Merchandiser' aanwezig zijn.");
        }

        const { addresses, drivers } = globalBestResult;
        const hasDayInfo = addresses.some(a => !!a.bezoekdag);
        let uniqueAddresses: Address[];

        if (hasDayInfo) {
            const grouped = new Map<string, Address>();
            for (const addr of addresses) {
                const key = `${addr.volledigAdres}|${addr.merchandiser}|${addr.bezoekdag}`;
                if (grouped.has(key)) {
                    const existing = grouped.get(key)!;
                    existing.aantalPlaatsingen = (existing.aantalPlaatsingen || 0) + (addr.aantalPlaatsingen || 0);
                } else {
                    grouped.set(key, { ...addr });
                }
            }
            uniqueAddresses = Array.from(grouped.values());
        } else {
            uniqueAddresses = addresses.filter((addr, index, self) =>
                index === self.findIndex((t) => (
                    t.volledigAdres === addr.volledigAdres && t.merchandiser === addr.merchandiser
                ))
            );
        }

        return { addresses: uniqueAddresses, drivers };
    } catch (error) {
        console.error("💥 Excel processing error:", error);
        throw error;
    }
};
