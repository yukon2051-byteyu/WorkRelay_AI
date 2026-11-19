/** デモツアーの案内役「青木さん」のアバター（インラインSVG・3表情）
 *  morning … 笑顔＋右下に振る手（あいさつ・朝の場面）
 *  idea    … きりっとした眉・丸い口＋右上にアンバーのスパークル（説明の場面）
 *  done    … にっこり目（^ ^）＋右下にミントティールのチェック（小休止・エンディング）
 *  装飾なので読み上げ対象にはしない（aria-hidden）。説明はポップアップの本文で伝える */
export type Mood = "morning" | "idea" | "done";

export default function AokiAvatar({ mood, size = 48 }: { mood: Mood; size?: number }) {
  const ink = "#1E293B";
  const mouth = "#9A3412";
  return (
    <svg className={`aoki-avatar mood-${mood}`} width={size} height={size} viewBox="0 0 64 64" aria-hidden="true" focusable="false">
      <defs>
        <clipPath id={`aoki-clip-${mood}`}>
          <circle cx="32" cy="32" r="29" />
        </clipPath>
      </defs>
      {/* 丸い背景と枠線 */}
      <circle cx="32" cy="32" r="30" fill="#F5F3FF" stroke="#DDD6FE" strokeWidth="2" />
      <g clipPath={`url(#aoki-clip-${mood})`}>
        {/* 後ろ髪（ボブ） */}
        <path d="M15 36 C13 18 22 11 32 11 C42 11 51 18 49 36 L49 46 C45 48 42 47 41 44 L41 30 L23 30 L23 44 C22 47 19 48 15 46 Z" fill={ink} />
        {/* ジャケットと白襟 */}
        <path d="M8 66 C10 52 20 47 32 47 C44 47 54 52 56 66 Z" fill="#4338CA" />
        <path d="M25.5 47.5 L32 57 L38.5 47.5 L35 46.5 L32 51 L29 46.5 Z" fill="#FFFFFF" />
        <rect x="29" y="40" width="6" height="7" rx="2" fill="#FDE2C8" />
        {/* 顔 */}
        <ellipse cx="32" cy="31" rx="11.5" ry="12.5" fill="#FDE2C8" />
        {/* 前髪 */}
        <path d="M20.5 29 C21 19 27 15.5 33 15.5 C39.5 15.5 44 20 43.5 27 C38.5 25.5 34 22.5 31 19.5 C28.5 24 25 27 20.5 29 Z" fill={ink} />
        {/* チーク */}
        <circle cx="25.2" cy="35.5" r="2.3" fill="#FDA4AF" opacity="0.85" />
        <circle cx="38.8" cy="35.5" r="2.3" fill="#FDA4AF" opacity="0.85" />
        {/* 表情 */}
        {mood === "morning" && (
          <>
            <path d="M25.5 31.5 Q27.5 29.5 29.5 31.5" fill="none" stroke={ink} strokeWidth="1.6" strokeLinecap="round" />
            <path d="M34.5 31.5 Q36.5 29.5 38.5 31.5" fill="none" stroke={ink} strokeWidth="1.6" strokeLinecap="round" />
            <path d="M28 37 Q32 41.5 36 37" fill="none" stroke={mouth} strokeWidth="1.7" strokeLinecap="round" />
          </>
        )}
        {mood === "idea" && (
          <>
            <path d="M24.5 27.2 L29.5 26.2" stroke={ink} strokeWidth="1.5" strokeLinecap="round" />
            <path d="M34.5 26.2 L39.5 27.2" stroke={ink} strokeWidth="1.5" strokeLinecap="round" />
            <circle cx="27.3" cy="31" r="1.5" fill={ink} />
            <circle cx="36.7" cy="31" r="1.5" fill={ink} />
            <circle cx="32" cy="38" r="1.8" fill={mouth} />
          </>
        )}
        {mood === "done" && (
          <>
            <path d="M25 32 L27.4 29.6 L29.8 32" fill="none" stroke={ink} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M34.2 32 L36.6 29.6 L39 32" fill="none" stroke={ink} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M27.5 36.2 Q32 42 36.5 36.2 Z" fill={mouth} />
          </>
        )}
      </g>
      {/* 表情ごとの小物（丸の外にはみ出してよい） */}
      {mood === "morning" && (
        <g className="aoki-wave">
          <circle cx="53" cy="50" r="5.5" fill="#FDE2C8" stroke="#E7B998" strokeWidth="1" />
          <path d="M58.5 41.5 Q61 44 60.5 47" fill="none" stroke="#C4B5FD" strokeWidth="1.6" strokeLinecap="round" />
          <path d="M47.5 41 Q48.5 38.5 51 38" fill="none" stroke="#C4B5FD" strokeWidth="1.6" strokeLinecap="round" />
        </g>
      )}
      {mood === "idea" && (
        <path className="aoki-spark" d="M53 4 L55 10 L61 12 L55 14 L53 20 L51 14 L45 12 L51 10 Z" fill="#FBBF24" stroke="#F59E0B" strokeWidth="0.8" />
      )}
      {mood === "done" && (
        <g className="aoki-check">
          <circle cx="52" cy="52" r="8" fill="#10B981" stroke="#FFFFFF" strokeWidth="2" />
          <path d="M48 52 L51 55 L56.5 49.5" fill="none" stroke="#FFFFFF" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
        </g>
      )}
    </svg>
  );
}
