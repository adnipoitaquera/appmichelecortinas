import "./globals.css";

export const metadata = {
  title: "Michele Cortinas - Sistema de Gestão e Orçamentos",
  description: "Sistema de Gestão e Orçamentos",
};

export default function RootLayout({ children }) {
  return (
    <html lang="pt-BR">
      <head>
        <link rel="stylesheet" href="/persianas-materiais.css" />
        <link rel="stylesheet" href="/plano-corte-persianas.css" />
        <link rel="stylesheet" href="/layout-profissional.css" />
      </head>
      <body>{children}</body>
    </html>
  );
}
