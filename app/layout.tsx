import '@/styles/globals.css';
import type { Metadata } from 'next';

export const metadata: Metadata = {
    title: 'Vrachtwagen B.V. routeplanner',
    description: 'Automatische route planning en optimalisatie.',
};

export default function RootLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    return (
        <html lang="nl">
            <body>
                <main className="min-h-screen">
                    {children}
                </main>
            </body>
        </html>
    );
}
