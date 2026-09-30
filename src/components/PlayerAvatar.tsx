const palettes = [
  { background: "#efd8b8", shirt: "#397a83", hair: "#353e4b", skin: "#f4c49a" },
  { background: "#c6e1d1", shirt: "#a45148", hair: "#493f3e", skin: "#f3cfa7" },
  { background: "#f2d3c2", shirt: "#618da4", hair: "#463833", skin: "#ffd7b0" },
  { background: "#d4deee", shirt: "#807298", hair: "#554239", skin: "#f6c8a1" },
];

export function PlayerAvatar({ seat }: { seat: number }) {
  const colors = palettes[seat];
  return (
    <svg className="avatarPortrait" viewBox="0 0 100 100" aria-hidden="true">
      <circle cx="50" cy="50" r="50" fill={colors.background} />
      <path d="M13 102C13 77 29 70 50 70S88 79 89 102" fill={colors.shirt} />
      <path d="M41 65V79L50 87L61 78V63" fill={colors.skin} />
      {seat === 2 && (
        <path
          d="M23 61C14 46 17 16 41 11C70 3 86 26 79 64L64 82L35 80Z"
          fill={colors.hair}
        />
      )}
      <ellipse cx="28" cy="48" rx="6" ry="9" fill={colors.skin} />
      <ellipse cx="73" cy="48" rx="6" ry="9" fill={colors.skin} />
      <path
        d="M27 32Q50 14 75 33L72 58Q70 75 51 77Q32 75 28 58Z"
        fill={colors.skin}
      />
      <path
        d={
          seat === 3
            ? "M24 37Q15 15 36 13Q49 2 66 15Q82 18 77 42L64 32L57 22Q43 38 25 37"
            : seat === 2
              ? "M23 40Q19 15 49 13Q77 12 78 40L61 30L55 21Q42 37 23 40"
              : "M23 39Q17 14 42 13Q59 2 74 20L77 41L67 29Q46 41 28 32Z"
        }
        fill={colors.hair}
      />
      <path
        d="M35 45Q40 42 45 45M57 45Q62 42 67 45"
        fill="none"
        stroke={colors.hair}
        strokeWidth="2.8"
        strokeLinecap="round"
      />
      <ellipse cx="41" cy="50" rx="2.3" ry="3" fill="#34343c" />
      <ellipse cx="61" cy="50" rx="2.3" ry="3" fill="#34343c" />
      <path
        d="M49 53L47 59H52"
        fill="none"
        stroke="#d69d79"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
      <path
        d="M43 65Q51 71 59 64"
        fill="#fff6df"
        stroke="#b76c5d"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <ellipse cx="34" cy="58" rx="5" ry="2.5" fill="#e89582" opacity=".4" />
      <ellipse cx="68" cy="58" rx="5" ry="2.5" fill="#e89582" opacity=".4" />
      {seat === 1 && (
        <g fill="none" stroke="#6b493f" strokeWidth="2">
          <rect x="32" y="44" width="16" height="13" rx="5" />
          <rect x="54" y="44" width="16" height="13" rx="5" />
          <path d="M48 48H54" />
        </g>
      )}
      {seat === 3 && (
        <path d="M22 26Q42 8 74 26L73 19Q44 -1 24 14Z" fill="#8b99ac" />
      )}
      <path
        d="M35 77L50 88L65 77M50 88V100"
        fill="none"
        stroke="#fff9e8"
        strokeWidth="3"
        opacity=".65"
      />
    </svg>
  );
}
