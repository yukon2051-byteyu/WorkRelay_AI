/** デモツアーの案内役「青木さん」。利用者が用意した画像（6種類）をそのまま表示する（アニメーションはしない）。
 *  morning … おはよう（手を振る）
 *  think   … 考える（？）
 *  idea    … ひらめき（電球）
 *  nod     … うんうん納得
 *  break1  … 小休止1（手を振る＋チェック）
 *  break2  … 小休止2（マグカップ）
 *  装飾なので読み上げ対象にはしない（alt=""）。説明はポップアップの本文で伝える */
import { AOKI_IMAGES } from "../assets/aokiImages";
import type { AokiMood } from "../assets/aokiImages";

export type Mood = AokiMood;

export default function AokiAvatar({ mood, size = 128 }: { mood: Mood; size?: number }) {
  const im = AOKI_IMAGES[mood];
  return (
    <img className={`aoki-figure mood-${mood}`} src={im.src} width={Math.round((size * im.width) / im.height)} height={size}
      alt="" aria-hidden="true" draggable={false} />
  );
}
