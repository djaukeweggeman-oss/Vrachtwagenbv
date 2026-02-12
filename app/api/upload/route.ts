import { NextRequest, NextResponse } from 'next/server';
import { processExcel } from '@/lib/excel';

export async function POST(req: NextRequest) {
    try {
        const formData = await req.formData();
        const file = formData.get('file') as File;

        if (!file) {
            return NextResponse.json(
                { error: 'Geen bestand geüpload' },
                { status: 400 }
            );
        }

        if (!file.name.endsWith('.xlsx')) {
            return NextResponse.json(
                { error: 'Alleen .xlsx bestanden worden geaccepteerd' },
                { status: 400 }
            );
        }

        const arrayBuffer = await file.arrayBuffer();
        const data = await processExcel(arrayBuffer);
        return NextResponse.json(data);

    } catch (error: any) {
        console.error('Processing Error:', error);
        return NextResponse.json(
            { error: error.message || 'Interne server fout bij verwerken bestand' },
            { status: 500 }
        );
    }
}
