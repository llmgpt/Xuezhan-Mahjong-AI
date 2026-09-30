import { labelOf, suitOf, type Tile } from "../game/tiles";

const characters = ["一", "二", "三", "四", "五", "六", "七", "八", "九"];
const layouts: number[][][] = [
  [[32, 44]],
  [
    [32, 24],
    [32, 64],
  ],
  [
    [18, 22],
    [32, 44],
    [46, 66],
  ],
  [
    [18, 25],
    [46, 25],
    [18, 63],
    [46, 63],
  ],
  [
    [17, 22],
    [47, 22],
    [32, 44],
    [17, 66],
    [47, 66],
  ],
  [
    [18, 20],
    [46, 20],
    [18, 44],
    [46, 44],
    [18, 68],
    [46, 68],
  ],
  [
    [32, 15],
    [18, 32],
    [46, 32],
    [18, 53],
    [46, 53],
    [18, 73],
    [46, 73],
  ],
  [
    [18, 15],
    [46, 15],
    [18, 34],
    [46, 34],
    [18, 54],
    [46, 54],
    [18, 73],
    [46, 73],
  ],
  [
    [15, 20],
    [32, 20],
    [49, 20],
    [15, 44],
    [32, 44],
    [49, 44],
    [15, 68],
    [32, 68],
    [49, 68],
  ],
];

function Bird() {
  return (
    <g strokeLinecap="round" strokeLinejoin="round">
      <path d="M28 48C16 52 10 64 12 76C22 73 30 63 33 54" fill="#177b55" />
      <path
        d="M23 55L16 69M28 54L21 69M31 53L27 66"
        stroke="#77b17d"
        strokeWidth="2"
      />
      <path
        d="M35 24C51 29 54 45 43 56C38 61 27 61 23 55C16 44 21 36 30 32"
        fill="#188652"
        stroke="#0a603a"
        strokeWidth="1.5"
      />
      <path d="M31 37C38 30 46 36 43 44C40 51 30 55 27 48Z" fill="#42a772" />
      <path
        d="M28 40L39 39M27 44L38 43M28 48L35 47"
        stroke="#dbdeb0"
        strokeWidth="1.5"
      />
      <path
        d="M31 31C24 27 25 18 32 15C41 10 49 16 46 23L39 29L39 38"
        fill="#187642"
        stroke="#095b39"
        strokeWidth="1.5"
      />
      <path
        d="M32 15L29 10M35 14L35 8M39 14L41 9"
        stroke="#c92e35"
        strokeWidth="2.5"
      />
      <path d="M45 21L55 24L46 27Z" fill="#be2b35" />
      <circle cx="40" cy="20" r="2" fill="#fff8dc" />
      <circle cx="40.5" cy="20" r="1" fill="#152f35" />
      <path
        d="M35 60L34 72L27 76M41 58L43 70L49 73M34 72L39 76"
        fill="none"
        stroke="#be2b35"
        strokeWidth="2.4"
      />
    </g>
  );
}

export function MahjongFace({ tile }: { tile: Tile }) {
  const suit = suitOf(tile);
  const rank = (tile % 9) + 1;
  const points =
    suit === "tiao" && rank === 3
      ? [
          [32, 23],
          [18, 63],
          [46, 63],
        ]
      : layouts[rank - 1];
  return (
    <svg
      className={`tileFace face-${suit}`}
      viewBox="0 0 64 88"
      aria-hidden="true"
    >
      {suit === "wan" && (
        <g
          fontFamily="KaiTi, STKaiti, SimSun, serif"
          fontWeight="700"
          textAnchor="middle"
        >
          <text x="32" y="37" fontSize="34" fill="#183b52">
            {characters[rank - 1]}
          </text>
          <text x="32" y="77" fontSize="38" fill="#be2630">
            萬
          </text>
        </g>
      )}
      {suit === "tong" &&
        points.map(([x, y], index) => {
          const radius =
            rank === 1
              ? 21
              : rank === 2
                ? 12
                : rank <= 5
                  ? 10
                  : rank === 6
                    ? 9
                    : 7.5;
          const color =
            rank === 1 ||
            (rank === 5 && index === 2) ||
            (rank === 7 && index < 3)
              ? "#bd2936"
              : (rank === 3 && index === 1) ||
                  (rank === 9 && index >= 3 && index <= 5)
                ? "#168456"
                : "#195879";
          return (
            <g
              key={index}
              transform={`translate(${x} ${y})`}
              fill="none"
              stroke={color}
            >
              <circle r={radius} strokeWidth={rank === 1 ? 3.3 : 2.8} />
              <circle r={radius * 0.57} strokeWidth="1.9" />
              <circle r={radius * 0.18} fill={color} stroke="none" />
              {rank === 1 &&
                Array.from({ length: 8 }, (_, spoke) => (
                  <path
                    key={spoke}
                    d="M0 -10L0 -17"
                    strokeWidth="2"
                    transform={`rotate(${spoke * 45})`}
                  />
                ))}
            </g>
          );
        })}
      {suit === "tiao" &&
        (rank === 1 ? (
          <Bird />
        ) : (
          points.map(([x, y], index) => {
            const scale = rank <= 3 ? 1.15 : rank <= 6 ? 0.9 : 0.73;
            const color =
              (rank === 7 && index === 0) ||
              (rank === 9 && index >= 3 && index <= 5)
                ? "#b62e35"
                : "#08784a";
            return (
              <g
                key={index}
                transform={`translate(${x} ${y}) scale(${scale})`}
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path
                  d="M-3 -10L-3 10M3 -10L3 10"
                  stroke={color}
                  strokeWidth="3.8"
                />
                <path
                  d="M-6 -10H6M-6 0H6M-6 10H6"
                  stroke={color}
                  strokeWidth="3"
                />
                <path d="M-1 -7V-3M-1 3V7" stroke="#a9d491" strokeWidth="1.2" />
                <path d="M-5 -5L-8 -7M5 5L8 3" stroke={color} strokeWidth="2" />
              </g>
            );
          })
        ))}
    </svg>
  );
}

export function TilePiece({
  tile,
  className = "",
}: {
  tile: Tile;
  className?: string;
}) {
  return (
    <span
      className={`mahjongTile ${className}`}
      role="img"
      aria-label={labelOf(tile)}
      title={labelOf(tile)}
    >
      <MahjongFace tile={tile} />
    </span>
  );
}

export function TileBack() {
  return (
    <span className="tileBack" aria-hidden="true">
      <i />
    </span>
  );
}
