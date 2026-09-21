import "./globals.css";

export const metadata = {
  title: "SEO / AEO / GEO Dashboard",
  description: "Live SEO, AEO, GEO, backlinks, citations, reviews",
};

export const viewport = {
  // The dashboard is built to be usable on a phone, including on Termux.
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
