// 画面で使う小さなアイコン（外部ライブラリを増やさないよう、SVGを直接書く）
type P = { size?: number };
const base = (size = 16) => ({
  width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor",
  strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true,
});

export const IconToday = ({ size }: P) => (<svg {...base(size)}><path d="M9 11l3 3 8-8" /><path d="M20 12v6a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h9" /></svg>);
export const IconInbox = ({ size }: P) => (<svg {...base(size)}><path d="M22 12h-6l-2 3h-4l-2-3H2" /><path d="M5.5 5h13L22 12v6a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-6z" /></svg>);
export const IconCalendar = ({ size }: P) => (<svg {...base(size)}><rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" /></svg>);
export const IconChart = ({ size }: P) => (<svg {...base(size)}><path d="M3 3v18h18" /><path d="M7 15l4-4 3 3 5-6" /></svg>);
export const IconPlug = ({ size }: P) => (<svg {...base(size)}><path d="M9 2v6M15 2v6M6 8h12v4a6 6 0 0 1-12 0z" /><path d="M12 18v4" /></svg>);
export const IconMail = ({ size }: P) => (<svg {...base(size)}><rect x="2" y="4" width="20" height="16" rx="2" /><path d="M22 6l-10 7L2 6" /></svg>);
export const IconChat = ({ size }: P) => (<svg {...base(size)}><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>);
export const IconWarn = ({ size }: P) => (<svg {...base(size)}><path d="M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" /><path d="M12 9v4M12 17h.01" /></svg>);
export const IconCheck = ({ size }: P) => (<svg {...base(size)}><path d="M20 6L9 17l-5-5" /></svg>);
export const IconUp = ({ size }: P) => (<svg {...base(size)}><path d="M18 15l-6-6-6 6" /></svg>);
export const IconDown = ({ size }: P) => (<svg {...base(size)}><path d="M6 9l6 6 6-6" /></svg>);
export const IconClose = ({ size }: P) => (<svg {...base(size)}><path d="M18 6L6 18M6 6l12 12" /></svg>);
export const IconLink = ({ size }: P) => (<svg {...base(size)}><path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7" /><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7" /></svg>);
export const IconClock = ({ size }: P) => (<svg {...base(size)}><circle cx="12" cy="12" r="10" /><path d="M12 6v6l4 2" /></svg>);

export const ChannelIcon = ({ channel }: { channel: string }) =>
  channel === "teams" ? <IconChat size={14} /> : <IconMail size={14} />;
