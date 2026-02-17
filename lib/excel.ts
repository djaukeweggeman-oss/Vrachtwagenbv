import * as XLSX from 'xlsx';
import { Address, ExcelRow } from '@/types';

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
                });
            } else {
                if (index < 5) { // Only log first 5 skipped rows to avoid spam
                    console.log(`⚠️ Skipping row ${index + 9}: ADRES=${row.ADRES}, Merchandiser=${row.Merchandiser}`);
                }
            }
        });

        console.log(`✅ Extracted ${addresses.length} addresses`);
        console.log(`👥 Found ${uniqueDrivers.size} unique drivers:`, Array.from(uniqueDrivers));

        // Deduplicatie op basis van volledigAdres EN Merchandiser
        const uniqueAddresses = addresses.filter((addr, index, self) =>
            index === self.findIndex((t) => (
                t.volledigAdres === addr.volledigAdres && t.merchandiser === addr.merchandiser
            ))
        );

        console.log(`🎯 After deduplication: ${uniqueAddresses.length} unique addresses`);

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
