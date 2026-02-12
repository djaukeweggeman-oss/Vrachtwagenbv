import * as XLSX from 'xlsx';
import { Address, ExcelRow } from '@/types';

export class ExcelProcessor {
    private static TARGET_MERCHANDISER = "Auke Weggeman";
    private static HEADER_ROW_INDEX = 8; // Row 9 (0-indexed is 8)

    static async processFile(buffer: ArrayBuffer): Promise<Address[]> {
        const workbook = XLSX.read(buffer, { type: 'array' });

        // 1. Find relevant sheet
        const sheetName = workbook.SheetNames.find(name =>
            name.toUpperCase().includes('PLANNING WEEK')
        );

        if (!sheetName) {
            throw new Error('Geen tabblad gevonden met naam "PLANNING WEEK..."');
        }

        const sheet = workbook.Sheets[sheetName];

        // 2. Parse data with explicit header row
        // range: 8 means start reading from row 9 (index 8)
        const jsonData = XLSX.utils.sheet_to_json<ExcelRow>(sheet, {
            range: this.HEADER_ROW_INDEX,
            defval: ""
        });

        if (jsonData.length === 0) {
            throw new Error('Geen data gevonden in het tabblad');
        }

        // 3. Filter and Map
        const addresses: Address[] = jsonData
            .filter(row => {
                // Case insensitive check just in case, though requirement says exact match
                return row['Merchandiser']?.toString().trim() === this.TARGET_MERCHANDISER;
            })
            .map(row => {
                // Validation of required fields
                if (!row.ADRES || !row.POSTCODE || !row.PLAATSNAAM) {
                    console.warn('Skipping row due to missing address data:', row);
                    return null;
                }

                const straat = row.ADRES.trim();
                const postcode = row.POSTCODE.toString().trim();
                const plaats = row.PLAATSNAAM.trim();

                return {
                    filiaalnr: row.FILIAALNR?.toString() || '',
                    formule: row.FORMULE || '',
                    straat,
                    postcode,
                    plaats,
                    merchandiser: row.Merchandiser || '',
                    volledigAdres: `${straat}, ${postcode} ${plaats}`
                };
            })
            .filter((addr): addr is Address => addr !== null);

        // 4. Deduplication based on composite key (address)
        const uniqueAddresses = Array.from(
            new Map(addresses.map(item => [item.volledigAdres, item])).values()
        );

        if (uniqueAddresses.length === 0) {
            throw new Error(`Geen adressen gevonden voor ${this.TARGET_MERCHANDISER}`);
        }

        return uniqueAddresses;
    }
}
