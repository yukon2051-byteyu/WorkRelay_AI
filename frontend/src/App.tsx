import { useEffect, useState } from "react";

type Health = { status: string; mode: string };

export default function App() {
  const [health, setHealth] = useState<Health | null>(null);
  const [error, setError] = useState<string | null>(null);

  // 画面を開いたときに一度だけ、バックエンドの /api/health を呼ぶ
  useEffect(() => {
    fetch("/api/health")
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then(setHealth)
      .catch((e) => setError(String(e)));
  }, []);

  return (
    <main style={{ fontFamily: "sans-serif", padding: 24 }}>
      <h1>WorkRelay AI</h1>
      {health && <p>サーバー接続：{health.status}（モード：{health.mode}）</p>}
      {error && <p style={{ color: "crimson" }}>サーバーに接続できません：{error}</p>}
      {!health && !error && <p>接続確認中…</p>}
    </main>
  );
}
