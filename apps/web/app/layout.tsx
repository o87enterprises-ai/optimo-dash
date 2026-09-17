import "./globals.css";

export const metadata = {
  title: "SEO / AEO / GEO Dashboard",
  description: "Live SEO, AEO, GEO, backlinks, citations, reviews",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
