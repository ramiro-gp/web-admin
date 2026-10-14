"use client";

export default function ErrorPage({ reset }: { reset: () => void }) {
  return <section className="empty-state" role="alert"><h1>No pudimos cargar esta sección</h1><p>Volvé a intentar. Si el problema continúa, revisá la conexión con la base de datos.</p><button className="button" onClick={reset}>Reintentar</button></section>;
}
