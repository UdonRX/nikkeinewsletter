import "./globals.css";
import type { Metadata } from "next";
export const metadata: Metadata={title:"日経ニュースメール",description:"Gmailの日経ニュースメールを読むPWA"};
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="ja"><body>{children}</body></html>}
