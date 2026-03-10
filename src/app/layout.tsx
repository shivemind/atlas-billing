export const metadata = {
  title: "Atlas Billing",
  description: "AtlasPayments Billing Service",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
