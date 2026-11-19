/** デモツアーの案内役「青木さん」（オリジナルのインラインSVG・上半身・3表情）
 *  morning … にっこり笑顔＋右手を振る（ウェルカム・朝の場面）
 *  idea    … きりっとした眉・丸い口＋右上にアンバーのスパークル（説明の場面）
 *  done    … にっこり目（^ ^）＋右下にミントティールのチェック（小休止・エンディング）
 *  配色：紺のボブ #1E293B、インディゴのジャケット #4338CA＋白襟、肌 #FDE2C8、チーク #FDA4AF。
 *  装飾なので読み上げ対象にはしない（aria-hidden）。説明はポップアップの本文で伝える */
export type Mood = "morning" | "idea" | "done";

const INK = "#1E293B";
const SKIN = "#FDE2C8";
const MOUTH = "#9A3412";
const LINE = "#1E1B4B"; // 輪郭線（帯の紫の上でも形が分かるように）
const SKIN_LINE = "#D9A07E";

export default function AokiAvatar({ mood, size = 128 }: { mood: Mood; size?: number }) {
  return (
    <svg className={`aoki-figure mood-${mood}`} width={size} height={size} viewBox="0 0 140 140" aria-hidden="true" focusable="false">
      {/* 後ろ髪（肩までのボブ） */}
      <path d="M33 74 C28 38 47 20 70 20 C93 20 112 38 107 74 L108 98 C101 104 92 102 90 95 L90 62 L50 62 L50 95 C48 102 39 104 32 98 Z" fill={INK} stroke={LINE} strokeWidth="1.5" />
      {/* ジャケット・白いシャツ・襟 */}
      <path d="M18 141 C20 113 40 100 70 100 C100 100 120 113 122 141 Z" fill="#4338CA" stroke={LINE} strokeWidth="1.8" />
      <path d="M57 100 L70 126 L83 100 Z" fill="#FFFFFF" />
      <path d="M56 99 L68 124 L58 127 L50 104 Z" fill="#3730A3" />
      <path d="M84 99 L72 124 L82 127 L90 104 Z" fill="#3730A3" />
      {/* 首 */}
      <rect x="62" y="84" width="16" height="18" rx="5" fill={SKIN} />
      <rect x="62" y="86" width="16" height="5" fill="#F2C9A8" />
      {/* 耳と顔 */}
      <circle cx="46" cy="67" r="4.5" fill={SKIN} />
      <circle cx="94" cy="67" r="4.5" fill={SKIN} />
      <ellipse cx="70" cy="64" rx="24" ry="26" fill={SKIN} stroke={SKIN_LINE} strokeWidth="1.4" />
      {/* 前髪 */}
      <path d="M45 62 C44 41 56 31 71 31 C87 31 97 42 96 58 C85 56 77 50 70 43 C66 52 57 59 45 62 Z" fill={INK} />
      <path d="M45 62 C44 70 46 78 49 84 L47 64 Z" fill={INK} />
      <path d="M96 58 C97 68 95 78 92 84 L94 62 Z" fill={INK} />
      {/* チーク */}
      <ellipse cx="55.5" cy="75" rx="5" ry="3.6" fill="#FDA4AF" opacity="0.8" />
      <ellipse cx="84.5" cy="75" rx="5" ry="3.6" fill="#FDA4AF" opacity="0.8" />

      {mood === "morning" && (
        <>
          <path d="M53 66 Q58.5 60 64 66" fill="none" stroke={INK} strokeWidth="2.6" strokeLinecap="round" />
          <path d="M76 66 Q81.5 60 87 66" fill="none" stroke={INK} strokeWidth="2.6" strokeLinecap="round" />
          <path d="M61 76 Q70 88 79 76 Z" fill={MOUTH} />
          <path d="M64.5 80.5 Q70 85 75.5 80.5 Q70 83 64.5 80.5 Z" fill="#FB7185" />
          {/* 手を振る右腕 */}
          <g className="aoki-wave">
            <path d="M104 107 C113 99 117 88 115 76 L126 74 C130 92 126 106 113 118 Z" fill="#5B50E0" stroke={LINE} strokeWidth="1.8" strokeLinejoin="round" />
            <path d="M114.5 76.5 L126.5 74.5 L127.5 80 L115.5 82 Z" fill="#FFFFFF" stroke={LINE} strokeWidth="1.4" strokeLinejoin="round" />
            <ellipse cx="120.5" cy="64" rx="9" ry="10.5" fill={SKIN} stroke={SKIN_LINE} strokeWidth="1.4" />
            <path d="M115 55 L115 60 M119.5 53.5 L119.5 59.5 M124 54.5 L124 60" stroke={SKIN_LINE} strokeWidth="1.3" strokeLinecap="round" />
            <path d="M112 64 C109 61 110 57 113 58" fill="none" stroke={SKIN_LINE} strokeWidth="1.4" strokeLinecap="round" />
            <path d="M131 46 Q136 51 135 58" fill="none" stroke="#FDE68A" strokeWidth="2.4" strokeLinecap="round" />
            <path d="M127 40 Q134 43 137 49" fill="none" stroke="#FDE68A" strokeWidth="2.4" strokeLinecap="round" />
          </g>
        </>
      )}
      {mood === "idea" && (
        <>
          <path d="M52 55 L63 52.5" stroke={INK} strokeWidth="2.4" strokeLinecap="round" />
          <path d="M77 52.5 L88 55" stroke={INK} strokeWidth="2.4" strokeLinecap="round" />
          <ellipse cx="58.5" cy="65" rx="3" ry="3.8" fill={INK} />
          <ellipse cx="81.5" cy="65" rx="3" ry="3.8" fill={INK} />
          <circle cx="59.6" cy="63.6" r="1" fill="#FFFFFF" />
          <circle cx="82.6" cy="63.6" r="1" fill="#FFFFFF" />
          <ellipse cx="70" cy="80" rx="3.6" ry="4.2" fill={MOUTH} />
          <g className="aoki-spark">
            <path d="M117 14 L121 26 L133 30 L121 34 L117 46 L113 34 L101 30 L113 26 Z" fill="#FBBF24" stroke="#F59E0B" strokeWidth="1" />
            <path d="M101 8 L103 13 L108 15 L103 17 L101 22 L99 17 L94 15 L99 13 Z" fill="#FCD34D" />
          </g>
        </>
      )}
      {mood === "done" && (
        <>
          <path d="M53 67 L58.5 61 L64 67" fill="none" stroke={INK} strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M76 67 L81.5 61 L87 67" fill="none" stroke={INK} strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M60 75 Q70 90 80 75 Z" fill={MOUTH} />
          <path d="M64 81 Q70 87 76 81 Q70 84 64 81 Z" fill="#FB7185" />
          <g className="aoki-check">
            <circle cx="115" cy="114" r="15" fill="#10B981" stroke="#FFFFFF" strokeWidth="3" />
            <path d="M107.5 114 L113 119.5 L123 108.5" fill="none" stroke="#FFFFFF" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round" />
          </g>
        </>
      )}
    </svg>
  );
}
